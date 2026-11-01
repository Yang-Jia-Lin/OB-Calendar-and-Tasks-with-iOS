import { clone, type Calendar, type Journal, type Session, type Task, type TimelineRow } from "./contracts";
import { dayKey } from "./time";

export type AppPage = "timer" | "tasks" | "calendar";
export interface TaskRef { kind: "local"; path: string; id: string }
export interface TaskCompletion { id: string; task: TaskRef; title: string; calendarId: string; completedAt: number }
export interface SessionStore { load(): Promise<Journal>; save(state: Journal): Promise<void> }
export interface TaskRepository {
  list(): Promise<Task[]>;
  resolve(ref: TaskRef): Promise<Task>;
  setCompleted(task: Task, completed: boolean): Promise<void>;
  completions(): Promise<TaskCompletion[]>;
}
export interface CalendarDaySnapshot { date: string; sources: Calendar[]; calendars: Calendar[]; rows: TimelineRow[] }
export interface CalendarQuery { readDay(date: string): CalendarDaySnapshot }
/** Commands shared by host views; persistence, dialogs and network scheduling stay in adapters. */
export interface ApplicationActions {
  start(task: Task): void;
  complete(task: Task): void;
  pause(sessionId?: string): void;
  resume(sessionId?: string): void;
  finish(complete: boolean, sessionId?: string): void;
  date(value: string): void;
  add(title: string, due: string, category: string): Promise<boolean>;
}
export interface TaskFilters { association: "all" | "linked" | "unlinked"; status: "open" | "done" | "all"; due: "all" | "today" | "overdue" | "none" | "date"; date: string }
export const defaultFilters = (): TaskFilters => ({ association: "all", status: "open", due: "all", date: dayKey() });
export const refKey = (task: Pick<Task, "kind" | "path" | "id">) => JSON.stringify([task.kind, task.path || "", task.id]);
export const appPage = (value: unknown): AppPage => value === "timer" || value === "calendar" ? value : "tasks";
export const focusLimit = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? Math.max(1, Math.min(10, Math.round(value))) : 5;
export function focusRefs(value: unknown): TaskRef[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  return value.flatMap(r => { if (r?.kind !== "local" || typeof r.path !== "string" || !r.path || typeof r.id !== "string" || !r.id) return []; const key = refKey(r); if (seen.has(key)) return []; seen.add(key); return [{kind:"local" as const,path:r.path,id:r.id}]; });
}
export function filterTasks(tasks: Task[], filters: TaskFilters, linked: Set<string>, today = dayKey()) {
  return tasks.filter(t => (filters.status === "all" || t.completed === (filters.status === "done")) &&
    (filters.association === "all" || linked.has(refKey(t)) === (filters.association === "linked")) &&
    (filters.due === "all" || filters.due === "none" && !t.due || filters.due === "today" && t.due === today || filters.due === "overdue" && !!t.due && t.due < today || filters.due === "date" && t.due === filters.date));
}
export function focusTasks(tasks: Task[], pins: TaskRef[], limit = 5, today = dayKey()) {
  const available = new Map(tasks.filter(t => !t.completed).map(t => [refKey(t), t])), selected = new Map<string, Task>();
  for (const pin of pins) { const task = available.get(refKey(pin)); if (task) selected.set(refKey(task), task); }
  for (const task of tasks) if (!task.completed && task.due === today) selected.set(refKey(task), task);
  return [...selected.values()].slice(0, focusLimit(limit));
}
/** Topic snapshots change only when their owning data changes, independently of the clock. */
export class ApplicationState<T extends object> {
  private listeners = new Map<keyof T, Set<() => void>>();
  constructor(private value: T) {}
  get<K extends keyof T>(key: K): T[K] { return this.value[key]; }
  set<K extends keyof T>(key: K, value: T[K]) { if (Object.is(this.value[key], value)) return; this.value = {...this.value,[key]:value}; for (const fn of this.listeners.get(key) || []) { try { fn(); } catch {} } }
  subscribe<K extends keyof T>(key: K, fn: () => void) { let set = this.listeners.get(key); if (!set) { set = new Set(); this.listeners.set(key,set); } set.add(fn); return () => set!.delete(fn); }
  dispose() { this.listeners.clear(); }
}
export interface TimerSnapshot { available: boolean; active: Session | null }
export const timerSnapshot = (active: Session | null, available: boolean): TimerSnapshot => clone({active,available});
