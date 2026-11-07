/** App-owned reminder metadata. Never use a due date as a planned date. */
export const SCHEDULE_START = "[CalendarTaskTimer:v1]";
export const SCHEDULE_END = "[/CalendarTaskTimer]";
export interface ScheduleMetadata { scheduledDate: string | null; topicId?: string }
export function validDay(value: unknown): value is string {
  return typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value + "T00:00:00Z")) && new Date(value + "T00:00:00Z").toISOString().slice(0, 10) === value;
}
export function reminderMetadata(description = ""): { notes: string; metadata: ScheduleMetadata; start: number; end: number } {
  const start = description.indexOf(SCHEDULE_START), close = description.indexOf(SCHEDULE_END);
  if (description.includes("[CalendarTaskTimer:") && start < 0) throw new Error("应用备注区版本暂不支持，原备注已保留。");
  if (start < 0 && close < 0) return { notes: description, metadata: { scheduledDate: null }, start: -1, end: -1 };
  if (start < 0 || close < start || description.indexOf(SCHEDULE_START, start + 1) >= 0 || description.indexOf(SCHEDULE_END, close + 1) >= 0) throw new Error("应用备注区损坏或重复，停止修改以保留原备注。");
  let data: any;
  try { data = JSON.parse(description.slice(start + SCHEDULE_START.length, close)); } catch { throw new Error("应用备注区无法解析，原备注已保留。"); }
  if (!data || typeof data !== "object" || Array.isArray(data) || Object.keys(data).some(k => !["scheduledDate", "topicId"].includes(k)) || data.scheduledDate != null && !validDay(data.scheduledDate) || data.topicId != null && (typeof data.topicId !== "string" || data.topicId.length > 256)) throw new Error("应用备注区版本或日期无效，原备注已保留。");
  const end = close + SCHEDULE_END.length;
  return { notes: description.slice(0, start) + description.slice(end), metadata: { scheduledDate: data.scheduledDate ?? null, ...(data.topicId ? { topicId: data.topicId } : {}) }, start, end };
}
export function withReminderMetadata(description: string, metadata: ScheduleMetadata): string {
  if (metadata.scheduledDate != null && !validDay(metadata.scheduledDate)) throw new Error("安排日期无效。");
  const parsed = reminderMetadata(description);
  const block = SCHEDULE_START + "\n" + JSON.stringify(metadata) + "\n" + SCHEDULE_END;
  return parsed.start < 0 ? description + (description && !description.endsWith("\n") ? "\n" : "") + block : description.slice(0, parsed.start) + block + description.slice(parsed.end);
}
