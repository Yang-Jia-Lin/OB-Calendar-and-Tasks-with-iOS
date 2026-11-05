import { clone, type Task, type Session } from "../../Shared/contracts";
import type { TimerController } from "../../Shared/timer";
import type { SyncView } from "../../Shared/sync";
import { timerSnapshot, type TimerSnapshot } from "../../Shared/application";
export type { TaskRef } from "../../Shared/application";
import type { TaskRef } from "../../Shared/application";

export interface EntryContext { source: "view" | "command" | "markdown" | "components"; path?: string }
export interface TimerState {
  available: boolean; active: Session | null; tasks: Task[]; pending: number; sync?: SyncView;
}
export type ActionResult = { ok: true; sessionId: string; recordId?: string; pending?: boolean; warning?: string }
  | { ok: false; code: "unavailable" | "active-session" | "stale-session" | "invalid-task" | "action-error" | "cancelled"; message: string; sessionId?: string };
class EntryError extends Error {
  constructor(readonly code: Extract<ActionResult, { ok: false }>["code"], message: string) { super(message); }
}
export const taskRef = (task: Task): TaskRef => ({ kind: task.kind === "reminder" ? "reminder" : "local", path: task.path || "", id: task.id });
export const sameTask = (task: Task, ref: TaskRef) => task.kind === ref.kind && task.path === ref.path && task.id === ref.id;

/** Local host API v1. No calendar credentials, mutable journal, or remote calls are exposed. */
export class TimerApi {
  readonly version = 1;
  private listeners = new Set<(state: TimerState) => void>();
  private timerListeners = new Set<(state: TimerSnapshot) => void>();
  private serial: Promise<unknown> = Promise.resolve();
  private disposed = false;
  constructor(private host: {
    controller: TimerController;
    resolve(ref: TaskRef, context?: EntryContext): Promise<Task>;
    prepare(task: Task): Promise<Task>;
    execute<T>(action: () => Promise<T>): Promise<T>;
    state(): TimerState;
    timerState?(): TimerSnapshot;
    refresh(): Promise<void>;
  }) {}
  getState(): TimerState { return clone({ ...this.host.state(), available: !this.disposed }); }
  subscribe(listener: (state: TimerState) => void) {
    if (this.disposed) { listener(this.getState()); return () => {}; }
    this.listeners.add(listener);
    try { listener(this.getState()); } catch { this.listeners.delete(listener); }
    return () => { this.listeners.delete(listener); };
  }
  getTimerState(): TimerSnapshot { return this.host.timerState ? clone({...this.host.timerState(),available:!this.disposed}) : timerSnapshot(this.host.controller.state.active,!this.disposed); }
  subscribeTimer(listener: (state: TimerSnapshot) => void) {
    if (this.disposed) { listener(this.getTimerState()); return () => {}; }
    this.timerListeners.add(listener); try { listener(this.getTimerState()); } catch { this.timerListeners.delete(listener); }
    return () => { this.timerListeners.delete(listener); };
  }
  notify() {
    for (const listener of this.listeners) { try { listener(this.getState()); } catch {} }
    for (const listener of this.timerListeners) { try { listener(this.getTimerState()); } catch {} }
  }
  dispose() { this.disposed = true; this.notify(); this.listeners.clear(); this.timerListeners.clear(); }
  private action(fn: () => Promise<ActionResult>): Promise<ActionResult> {
    const result = this.serial.then(async (): Promise<ActionResult> => {
      if (this.disposed) return { ok: false, code: "unavailable", message: "计时插件已卸载，请重新加载。" };
      try { return await this.host.execute(fn); }
      catch (e) { return { ok: false, code: e instanceof EntryError ? e.code : "action-error", message: (e as Error).message || String(e), sessionId: this.host.controller.state.active?.id }; }
    });
    this.serial = result; return result;
  }
  start(ref: TaskRef, context?: EntryContext) { return this.action(async () => {
    if (!ref || !["local","reminder"].includes(ref.kind) || !ref.id || !ref.path) throw new EntryError("invalid-task", "请提供待办文件路径和稳定任务 ID。");
    const current = await this.host.resolve(ref,context);
    if (current.completed) throw new EntryError("invalid-task", "此任务已完成，请选择未完成任务。");
    const active = this.host.controller.state.active;
    if (active) {
      if (sameTask(active.task, taskRef(current))) return { ok: true, sessionId: active.id };
      throw new EntryError("active-session", `正在计时「${active.title}」，请先明确结束该会话再切换任务。`);
    }
    const task = await this.host.prepare(current);
    if (task.completed) throw new EntryError("invalid-task", "此任务已完成，请选择未完成任务。");
    await this.host.controller.start(task, task.calendarId!);
    return { ok: true, sessionId: this.host.controller.state.active!.id };
  }); }
  private session(id: string) {
    if (!id || this.host.controller.state.active?.id !== id) throw new EntryError("stale-session", "此会话已结束或切换，请使用当前状态重试。");
  }
  pause(sessionId: string) { return this.action(async () => { this.session(sessionId); await this.host.controller.pause(sessionId); return { ok: true, sessionId }; }); }
  resume(sessionId: string) { return this.action(async () => { this.session(sessionId); if (this.host.controller.state.active!.runningSince == null) await this.host.controller.resume(sessionId); return { ok: true, sessionId }; }); }
  finish(sessionId: string, completeTask = false) { return this.action(async () => {
    this.session(sessionId);
    const record = await this.host.controller.finish(completeTask === true, sessionId);
    // Once durable, a view refresh failure must not turn a successful finish into an apparent failed write.
    let warning = record.error;
    try { await this.host.refresh(); } catch (e) { warning ||= (e as Error).message; }
    return { ok: true, sessionId, recordId: record.id, pending: record.status === "pending", warning };
  }); }
}
