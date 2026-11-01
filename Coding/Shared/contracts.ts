export interface Task {
  id: string; title: string; due?: string; completed: boolean;
  kind: "local" | "fcr"; path?: string; calendarId?: string; uid?: string;
}
export interface Calendar { id: string; name: string; color?: string; type?: string }
export interface CalendarEvent {
  type: string; title: string; uid?: string; date: string; endDate?: string;
  startTime?: string; endTime?: string; allDay?: boolean; timezone?: string;
  isTask?: boolean; completed?: unknown; description?: string;
  [key: string]: unknown;
}
export interface Entry { id: string; calendarId: string; event: CalendarEvent; color?: string }
export interface Segment {
  start: number; end: number; uid?: string; saved?: boolean;
  snapshot?: CalendarEvent;
}
export interface Session {
  ownerDeviceId?: string;
  id: string; title: string; task: Task; calendarId: string; zone: string;
  startedAt: number; runningSince: number | null; lastHeartbeat: number; segments: Segment[];
}
export interface SyncInfo { revision: number; attempt: number; retryAt: number; issue?: "network" | "auth" | "conflict" | "legacy" }
export interface Syncable { status: "pending" | "saved"; error: string; sync?: SyncInfo }
export interface WorkRecord extends Session {
  endedAt: number; completeTask: boolean; taskSaved: boolean;
  status: "pending" | "saved"; error: string;
  edit?: { calendarId: string; title: string; segments: Segment[]; steps: EditStep[] };
  sync?: SyncInfo; localFirst?: boolean;
}
export interface EditStep {
  uid: string; fromCalendarId: string; toCalendarId: string;
  before: CalendarEvent; after: CalendarEvent;
  // Each step remains in the journal until both sides have been reconciled.
  stage: "prepared" | "target-confirmed" | "done";
}
export interface EventOperation extends Syncable { id: string; title: string; step: EditStep }
export interface DeleteTarget { calendarId: string; uid: string; before: CalendarEvent }
export interface DeleteOperation extends DeleteTarget {
  id: string; title: string; recordId?: string; status: "pending" | "saved"; error: string;
  start: number; end: number;
  resolution?: "deleted" | "absent-in-fcr" | "user-confirmed-remote-deletion";
  sync?: SyncInfo;
}
export interface Journal { version: 2; active: Session | null; records: WorkRecord[]; operations: EventOperation[];
  deletions?: DeleteOperation[];
  legacyImport?: { defaultCalendarId: string; tasksPath: string } }
export interface CalendarPort {
  assertWritable(id: string): void;
  ensureEvent(calendarId: string, event: CalendarEvent): Promise<CalendarEvent>;
  readByUid(calendarId: string, uid: string): CalendarEvent | undefined;
  reconcileStep(step: EditStep, checkpoint: () => Promise<void>): Promise<void>;
  deleteEvent(target: DeleteTarget): Promise<void>;
  hasCalendarData?(calendarId: string): boolean;
}
export interface TaskPort { complete(task: Task): Promise<void> }
export interface TimelineRow {
  key: string; title: string; calendarId: string; color?: string;
  start: number; end: number; allDay?: boolean; original?: Entry;
  recordId?: string; segmentUid?: string; deletionId?: string; pending?: boolean; deleting?: boolean; error?: string; unsupported?: boolean;
}
export const clone = <T>(value: T): T => value == null ? value : JSON.parse(JSON.stringify(value));
export const uid = () => globalThis.crypto.randomUUID();
export function sameEvent(a: CalendarEvent, b: CalendarEvent): boolean {
  const stable = (v: unknown): unknown => Array.isArray(v) ? v.map(stable) : v && typeof v === "object"
    ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== undefined).sort(([a], [b]) => a.localeCompare(b)).map(([k, x]) => [k, stable(x)])) : v;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
// CalDAV round trips can omit default fields and format zero seconds as HH:mm.
// Normalize only equivalent representations; never round away nonzero seconds,
// alter timezones, or change the inclusive/exclusive semantics of all-day events.
export function comparableEventContent(event: CalendarEvent): CalendarEvent {
  const { etag: _tag, caldavHref: _href, ...value } = event;
  if (value.type === "single" && (value.allDay === false || value.allDay == null)) {
    value.allDay ??= false;
    value.isTask ??= false;
    value.endDate ??= value.date;
    for (const field of ["startTime", "endTime"] as const) {
      const time = value[field];
      if (typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) value[field] = `${time}:00`;
    }
  }
  return value;
}
export function sameEventContent(a: CalendarEvent, b: CalendarEvent) {
  return sameEvent(comparableEventContent(a), comparableEventContent(b));
}
export function isMissingResource(error: unknown) {
  const value = error as { status?: number; message?: string } | null;
  return value?.status === 404 || value?.status === 410 || /\bHTTP\s+(?:404|410)\b/i.test(typeof error === "string" ? error : value?.message || "");
}
