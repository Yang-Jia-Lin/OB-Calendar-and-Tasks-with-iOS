import type { CalendarSource } from "../../Providers/Calendar/config";
import type { ReminderSettings, ReminderList } from "../../Providers/Reminders/provider";
import type { TaskRef, CalendarDaySnapshot } from "../../Shared/application";
import type { Journal, Task, WorkRecord, Entry, Segment } from "../../Shared/contracts";
import type { CalendarDraft } from "../../Providers/Calendar/bridge";
export const PROTOCOL_VERSION = 1;
export interface DesktopSettings {
  deviceId: string; defaultCalendarId: string; calendarSources: CalendarSource[]; reminders: ReminderSettings;
  bindings: Record<string, TaskRef>; snapshots: Record<string, Partial<Task>>;
  metadataVerified: boolean; migratedFrom?: string;
  ownershipAcknowledged?: boolean;
  categoryOrder?: string[]; hiddenCategoryIds?: string[];
}
export type DesktopMutation =
  | { action: "timer.start"; task: TaskRef }
  | { action: "timer.pause" | "timer.resume"; sessionId: string }
  | { action: "timer.finish"; sessionId: string; completeTask?: boolean }
  | { action: "task.create"; title: string; listId: string; due?: string; description?: string }
  | { action: "task.migrate"; task: TaskRef; listId: string }
  | { action: "task.update"; task: Task; patch: Partial<Task> }
  | { action: "task.delete"; task: Task }
  | { action: "task.schedule"; task: Task; date: string | null }
  | { action: "task.reorder"; next: string[]; expected: string[] }
  | { action: "undo"; undoId: string }
  | { action: "event.save"; draft: CalendarDraft; original?: Entry }
  | { action: "event.delete"; original: Entry; start: number; end: number }
  | { action: "record.edit"; record: WorkRecord; title: string; calendarId: string; segments: Segment[] }
  | { action: "record.calendar-only"; recordId: string }
  | { action: "settings.save"; defaultCalendarId: string; calendarMap: Record<string, string> }
  | { action: "calendar.configure"; sources: CalendarSource[] }
  | { action: "categories.save"; order: string[]; hidden: string[] }
  | { action: "ownership.activate"; stoppedOldWriters: true }
  | { action: "binding.save"; note: string; task: TaskRef }
  | { action: "shutdown" };
export type DesktopCommand = DesktopMutation & { version: 1; requestId: string };
export interface CommandResult { ok: true; sessionId?: string; recordId?: string; taskId?: string; undoId?: string; pending?: boolean }
export interface DesktopSnapshot {
  isolated?: boolean;
  version: 1; revision: number; active: Journal["active"]; tasks: Task[]; lists: ReminderList[];
  records: WorkRecord[]; settings: DesktopSettings; pending: { key: string; error: string }[];
  sync: { refreshing: boolean; lastSync: number; error: string }; recovery: string;
}
export type DiarySnapshot = Pick<CalendarDaySnapshot, "calendars" | "rows">;
