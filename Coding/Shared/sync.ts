import type { TimerController } from "./timer";
export interface SyncView { activeKey: string | null; waiting: boolean; error: string; lastDurationMs?: number }
type RemoteLease = { token: symbol; done: Promise<void> };
const leaseKey = Symbol.for("calendar-task-timer.remote-channels.v1");
const leases: Map<string, RemoteLease> = (globalThis as any)[leaseKey] ||= new Map();
export class SyncWorker {
  readonly view: SyncView = { activeKey: null, waiting: false, error: "" };
  private timer?: ReturnType<typeof setTimeout>;
  private warning?: ReturnType<typeof setTimeout>;
  private stopped = false;
  private running = false;
  private pauseUntil = 0;
  constructor(private controller: TimerController, private options: { enabled: () => boolean; changed?: () => void; settled?: () => void; now?: () => number; delayMs?: number; slowMs?: number; channel?: string }) {}
  private now() { return this.options.now?.() ?? Date.now(); }
  private eligible() {
    return this.controller.jobs().filter(({ value: j }) => {
      // Preserve old unresolved errors for explicit review; do not replay conflicts on upgrade.
      if (!j.sync && j.error) return false;
      return !j.sync?.issue || j.sync.issue === "network";
    });
  }
  wake() {
    if (this.stopped || this.running) return;
    if (this.timer) clearTimeout(this.timer);
    if (!this.options.enabled()) return;
    const jobs = this.eligible(); if (!jobs.length) return;
    const next = Math.max(this.pauseUntil, Math.min(...jobs.map(j => j.value.sync?.retryAt || 0)));
    this.timer = setTimeout(() => { this.timer = undefined; void this.pump(); }, Math.max(this.options.delayMs ?? 80, next - this.now()));
  }
  async resume(issue: "network" | "auth") {
    for (const j of this.controller.jobs().filter(j => j.value.sync?.issue === issue)) await this.controller.requestRetry(j.key);
    this.wake();
  }
  async retry(key: string) { await this.controller.requestRetry(key); this.pauseUntil = 0; this.wake(); }
  private async pump() {
    if (this.stopped || this.running || !this.options.enabled()) return;
    const job = this.eligible().find(j => (j.value.sync?.retryAt || 0) <= this.now());
    if (!job) { this.wake(); return; }
    const channel = this.options.channel, previous = channel ? leases.get(channel) : undefined;
    if (previous) {
      this.running = true; this.view.waiting = true; this.view.error = "等待上一插件实例的 FCR 请求结束，本地计时仍可继续。"; this.options.changed?.();
      await previous.done; this.running = false;
      if (!this.stopped) { this.view.waiting = false; this.view.error = ""; this.options.changed?.(); this.wake(); } return;
    }
    const token = Symbol(); let release!: () => void;
    const done = new Promise<void>(resolve => { release = resolve; }); if (channel) leases.set(channel, { token, done });
    this.running = true; this.view.activeKey = job.key; this.view.waiting = false; this.view.error = "";
    const start = this.now(); this.options.changed?.();
    this.warning = setTimeout(() => {
      if (this.stopped) return;
      // No Promise.race: FCR has no cancellation guarantee. Never launch a second write.
      this.view.waiting = true; this.options.changed?.();
    }, this.options.slowMs ?? 15000);
    try { await this.controller.sync(job.key); }
    catch (e) { if (!this.stopped) { this.view.error = (e as Error).message; this.pauseUntil = this.now() + 10000; } }
    finally {
      if (channel && leases.get(channel)?.token === token) leases.delete(channel); release();
      if (this.warning) clearTimeout(this.warning); this.warning = undefined;
      this.running = false; this.view.activeKey = null; this.view.waiting = false;
      if (!this.stopped) { this.view.lastDurationMs = Math.max(0, this.now() - start); this.options.settled?.(); this.options.changed?.(); this.wake(); }
    }
  }
  stop() { this.stopped = true; if (this.timer) clearTimeout(this.timer); if (this.warning) clearTimeout(this.warning); this.controller.stopRemote(); }
}
