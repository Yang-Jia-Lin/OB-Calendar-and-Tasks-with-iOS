import { request, type ClientRequest } from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { Notice, Modal, MarkdownRenderChild, getFrontMatterInfo, parseYaml, type Plugin, type TFile } from "obsidian";
import type { DesktopMutation, DesktopSnapshot } from "../Desktop/protocol";
import type { Discovery } from "../Desktop/server";
import type { TimerSnapshot } from "../../Shared/application";
import type { ActionResult, TimerState, TaskRef } from "./api";
import { ComponentsTimerButtons } from "./componentsButtons";
import { componentTaskBindings, nativeTimerLabels, toggleNoteTimer } from "./components";
import { DiaryUpdater, diaryDate, DEFAULT_DIARY_FOLDER, DEFAULT_DIARY_LAYOUT, DEFAULT_DIARY_LAYOUT_PATH } from "./diary";
import { mountDiaryButton } from "./diaryButton";
import { secondsText, elapsed } from "../../Shared/time";
import { clone } from "../../Shared/contracts";

/** Thin client. This module never constructs a timer controller, provider, or cloud worker. */
export class DesktopConnection {
  private request?: ClientRequest; private stopped = false; private retry?: ReturnType<typeof setTimeout>; private retryMs = 500;
  private listeners = new Set<(state: DesktopSnapshot | null) => void>(); snapshot: DesktopSnapshot | null = null;
  constructor(private file = path.join(process.env.LOCALAPPDATA || "", "CalendarTaskTimer/Desktop/connection.json")) {}
  private async discovery(): Promise<Discovery> {
    const data = JSON.parse(await fs.readFile(this.file, "utf8")) as Discovery;
    if (data.version !== 1 || !Number.isInteger(data.port) || data.port < 1 || data.port > 65535 || !/^[a-f0-9]{64}$/.test(data.token)) throw new Error("桌面连接信息无效。"); return data;
  }
  async call<T = any>(route: string, body?: unknown): Promise<T> {
    if(this.stopped)throw new Error("桌面连接插件已卸载，请重新加载。");
    const d = await this.discovery();
    return new Promise<T>((resolve, reject) => {
      const input = body === undefined ? undefined : JSON.stringify(body);
      const req = request({ hostname: "127.0.0.1", port: d.port, path: route, method: input ? "POST" : "GET", headers: { Authorization: "Bearer " + d.token, ...(input ? { "Content-Type": "application/json", "Content-Length": Buffer.byteLength(input) } : {}) }, timeout: 10000 }, response => {
        const parts: Buffer[] = []; let size = 0;
        response.on("data", chunk => { size += chunk.length; if (size > 8 * 1024 * 1024) { req.destroy(new Error("桌面响应过大。")); return; } parts.push(chunk); });
        response.on("end", () => { try { const data = JSON.parse(Buffer.concat(parts).toString("utf8")); response.statusCode === 200 ? resolve(data) : reject(new Error(data.error || "桌面操作失败。")); } catch { reject(new Error("桌面响应无效。")); } });
      });
      req.on("timeout", () => req.destroy(new Error("本机连接超时。"))); req.on("error", reject); req.end(input);
    });
  }
  async command(mutation: DesktopMutation) {
    const command = { ...mutation, version: 1, requestId: randomUUID() };
    try { return await this.call("/v1/command", command); }
    catch (e) {
      // One safe retry reuses the exact id after response loss. Domain errors are returned as-is.
      if (!/ECONN|超时|socket hang up/.test((e as Error).message)) throw e;
      return this.call("/v1/command", command);
    }
  }
  subscribe(fn: (state: DesktopSnapshot | null) => void) { if(this.stopped){fn(null);return()=>{};}this.listeners.add(fn); fn(this.snapshot); return () => this.listeners.delete(fn); }
  private notify() { for (const fn of this.listeners) { try { fn(this.snapshot); } catch {} } }
  async connect() {
    if (this.stopped) return;
    try {
      const d = await this.discovery(); if (this.stopped) return;
      const req = request({ hostname: "127.0.0.1", port: d.port, path: "/v1/events", headers: { Authorization: "Bearer " + d.token } }, response => {
        if (response.statusCode !== 200) { response.resume(); req.destroy(); return; }
        let buffer = ""; response.setEncoding("utf8");
        response.on("data", chunk => {
          buffer += chunk; if (buffer.length > 8 * 1024 * 1024) { req.destroy(); return; }
          let at: number; while ((at = buffer.indexOf("\n\n")) >= 0) { const event = buffer.slice(0, at); buffer = buffer.slice(at + 2); const data = event.split("\n").find(line => line.startsWith("data: "));
            if (data) { try { const snapshot = JSON.parse(data.slice(6)); if (snapshot.version === 1) { this.snapshot = snapshot; this.retryMs = 500; this.notify(); } } catch {} }
          }
        }); response.on("end", () => req.destroy());
      });
      this.request = req;
      req.on("error", () => {}); req.on("close", () => { if (this.request === req) { this.request = undefined; this.disconnected(); } }); req.end();
    } catch { this.disconnected(); }
  }
  private disconnected() { this.snapshot = null; this.notify(); if (this.stopped || this.retry) return; this.retry = setTimeout(() => { this.retry = undefined; void this.connect(); }, this.retryMs); this.retryMs = Math.min(30000, this.retryMs * 2); }
  stop() { this.stopped = true;this.snapshot=null;this.notify();if (this.retry) clearTimeout(this.retry); this.request?.destroy(); this.listeners.clear(); }
  reconnect() { this.retryMs=500;if (this.retry) { clearTimeout(this.retry); this.retry = undefined; } if (!this.request) void this.connect(); }
}
export class RemoteTimerApi {
  readonly version = 1;
  constructor(private connection: DesktopConnection) {}
  getState(): TimerState { const s = this.connection.snapshot; return { available: !!s, active: clone(s?.active || null), tasks: clone(s?.tasks || []), pending: s?.pending.length || 0 }; }
  getTimerState(): TimerSnapshot { return { available: !!this.connection.snapshot, active: clone(this.connection.snapshot?.active || null) }; }
  subscribe(fn: (state: TimerState) => void) { return this.connection.subscribe(() => fn(this.getState())); }
  subscribeTimer(fn: (state: TimerSnapshot) => void) { return this.connection.subscribe(() => fn(this.getTimerState())); }
  private async run(mutation: DesktopMutation): Promise<ActionResult> {
    if(!this.connection.snapshot)return{ok:false,code:"unavailable",message:"本机桌面应用未连接，请先唤起并等待连接。"};
    try { const result = await this.connection.command(mutation); return { ...result, ok: true, sessionId: result.sessionId || "" }; }
    catch (e) { return { ok: false, code: "action-error", message: (e as Error).message }; }
  }
  start(task: TaskRef) { return this.run({ action: "timer.start", task }); }
  pause(sessionId: string) { return this.run({ action: "timer.pause", sessionId }); }
  resume(sessionId: string) { return this.run({ action: "timer.resume", sessionId }); }
  finish(sessionId: string, completeTask = false) { return this.run({ action: "timer.finish", sessionId, completeTask }); }
  dispose(){this.connection.stop();}
}
class RemoteDiaryButton extends MarkdownRenderChild {
  private off?: () => void;
  constructor(root: HTMLElement, private note: string, private connector: ObsidianDesktopConnector) { super(root); }
  onload() { this.off = mountDiaryButton(this.containerEl, this.note, p => this.connector.updateDiaryFromNote(p)); }
  onunload() { this.off?.(); }
}
export class ObsidianDesktopConnector {
  readonly connection = new DesktopConnection(); readonly api = new RemoteTimerApi(this.connection);
  private buttons?: ComponentsTimerButtons; private diary!: DiaryUpdater;
  private active = true;
  constructor(private plugin: Plugin, private settings: any) {}
  configure(settings:{diaryFolder:string;diaryLayoutPath:string}){Object.assign(this.settings,settings);}
  async start() {
    const p = this.plugin;
    const status = p.addStatusBarItem();
    p.register(this.connection.subscribe(s => { status.textContent = s ? s.active ? `◷ ${s.active.title} ${secondsText(elapsed(s.active))}` : "桌面计时已连接" : "桌面计时未连接"; }));
    p.registerInterval(window.setInterval(() => { const s = this.connection.snapshot; if (s?.active) status.textContent = `◷ ${s.active.title} ${secondsText(elapsed(s.active))}`; this.buttons?.tick(); }, 1000));
    this.buttons = new ComponentsTimerButtons(document, { api: this.api, canWake:true, binding: note => this.bindings()[note], toggle: (note, expected) => this.toggleFromNote(note, false, expected) });
    const scopes = async () => {
      const items: { root: HTMLElement; labels: Set<string> }[] = [], reads: Promise<void>[] = [];
      p.app.workspace.iterateAllLeaves(leaf => { const file = (leaf.view as any).file as TFile | undefined; if (leaf.view.getViewType() === "components-file-view" && file?.extension === "components") reads.push(p.app.vault.read(file).then(raw => { items.push({ root: leaf.view.containerEl, labels: nativeTimerLabels(JSON.parse(raw)) }); }).catch(() => {})); });
      await Promise.all(reads); this.buttons?.setScopes(items);
    };
    p.registerEvent(p.app.workspace.on("layout-change", () => { void scopes(); }));
    p.registerEvent(p.app.vault.on("modify", file => { if (file.path.endsWith(".components")) void scopes(); }));
    p.app.workspace.onLayoutReady(() => { void scopes(); });
    p.addCommand({ id: "open", name: "打开桌面计时应用", callback: () => this.launch() });
    p.addRibbonIcon("timer", "打开桌面计时", () => this.launch());
    p.addCommand({ id: "start-note-task", name: "开始当前课题计时", callback: () => { void this.startFromNote(p.app.workspace.getActiveFile()?.path || ""); } });
    p.addCommand({ id: "finish-record-only", name: "结束计时只记工时", callback: () => { const s = this.api.getState().active; if (s) void this.api.finish(s.id, false).then(r => { if (!r.ok) new Notice(r.message); }); } });
    p.addCommand({ id: "pause-resume", name: "暂停／继续桌面计时", callback: () => { const s = this.api.getState().active; if (s) void (s.runningSince == null ? this.api.resume(s.id) : this.api.pause(s.id)); } });
    const base = (p.app.vault.adapter as any).getBasePath?.();
    this.diary = new DiaryUpdater({ available: () => this.active, read: note => p.app.vault.read(this.file(note)),
      date: (note, text) => { const info = getFrontMatterInfo(text); return diaryDate(note, info.exists ? parseYaml(info.frontmatter)?.["日记日期"] : undefined, this.settings.diaryFolder || DEFAULT_DIARY_FOLDER); },
      layout: async () => { const file = p.app.vault.getAbstractFileByPath(this.settings.diaryLayoutPath || DEFAULT_DIARY_LAYOUT_PATH); return file && "extension" in file ? p.app.vault.read(file as TFile) : DEFAULT_DIARY_LAYOUT; },
      snapshot: date => this.connection.call("/v1/day?date=" + date),
      backup: async (_note, text) => { const folder = path.join(base, p.manifest.dir || `.obsidian/plugins/${p.manifest.id}`, "diary-backups"); await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, `${Date.now()}-${randomUUID()}.md`), text, { flag: "wx" }); },
      process: (note, update) => p.app.vault.process(this.file(note), update).then(() => {}) });
    p.addCommand({ id: "update-diary-timeline", name: "更新当前日记时间轴", callback: () => { void this.updateDiaryFromNote(p.app.workspace.getActiveFile()?.path || "").then(r => new Notice(`已更新 ${r.count} 项`)).catch(e => new Notice(e.message)); } });
    p.registerMarkdownCodeBlockProcessor("calendar-task-timer-diary", (source, root, ctx) => { if (!source.trim()) ctx.addChild(new RemoteDiaryButton(root, ctx.sourcePath, this)); });
    await this.connection.connect();
  }
  private bindings() { return this.connection.snapshot?.settings.bindings || componentTaskBindings(this.settings.componentTaskBindings); }
  private launch() { window.open("ctt-desktop://open"); }
  private file(note: string): TFile { const file = this.plugin.app.vault.getAbstractFileByPath(note); if (!file || !("extension" in file) || file.extension !== "md") throw new Error("请打开日记 Markdown 文件。"); return file as TFile; }
  async startFromNote(note: string, chooseTask = false): Promise<ActionResult> {
    if (!this.connection.snapshot) {
      this.launch(); this.connection.reconnect();
      const connected = await new Promise<boolean>(resolve => { let off = () => {}; const timeout = setTimeout(() => { off(); resolve(false); }, 15000); off = this.connection.subscribe(s => { if (s) { clearTimeout(timeout); off(); resolve(true); } }); });
      if (!connected) return { ok: false, code: "unavailable", message: "桌面应用未连接，请检查安装或从托盘打开。" };
    }
    if (chooseTask || !this.bindings()[note]) {
      const tasks = this.connection.snapshot!.tasks.filter(t => !t.completed);
      const selected = await new Promise<TaskRef | null>(resolve => { const modal = new Modal(this.plugin.app); let settled = false; modal.titleEl.textContent = "选择课题对应的已有待办";
        for (const task of tasks) { const button = document.createElement("button"); button.textContent = task.title; button.onclick = () => { settled = true; resolve({ kind: task.kind === "reminder" ? "reminder" : "local", id: task.id, path: task.path! }); modal.close(); }; modal.contentEl.append(button); }
        modal.onClose = () => { if (!settled) resolve(null); }; modal.open(); });
      if (!selected) return { ok: false, code: "cancelled", message: "未选择任务。" };
      try { await this.connection.command({ action: "binding.save", note, task: selected }); const snapshot = await this.connection.call<DesktopSnapshot>("/v1/state"); this.connection.snapshot = snapshot; }
      catch (e) { return { ok: false, code: "action-error", message: (e as Error).message }; }
    }
    const result = await this.api.start(this.bindings()[note]); if (!result.ok) new Notice(result.message); return result;
  }
  async toggleFromNote(note: string, choose = false, expected?: string | null) { return choose ? this.startFromNote(note, true) : toggleNoteTimer(note, expected, { state: () => this.api.getState(), binding: path => this.bindings()[path], start: path => this.startFromNote(path), finish: id => this.api.finish(id, false) }); }
  updateDiaryFromNote(note: string) { return this.diary.update(note); }
  stop() { this.active = false; this.connection.stop(); this.buttons?.dispose(); }
}
