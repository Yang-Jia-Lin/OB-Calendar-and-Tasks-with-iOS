import type { Session, WorkRecord, Segment, CalendarEvent } from "./contracts";
const formatters = new Map<string, Intl.DateTimeFormat>();
export function dateParts(ms: number, zone?: string) {
  if (!zone) {
    const d = new Date(ms), pad = (n: number) => String(n).padStart(2, "0");
    return { date: `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` };
  }
  let formatter = formatters.get(zone);
  if (!formatter) { formatter = new Intl.DateTimeFormat("en-CA", { timeZone: zone,
    year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }); if (formatters.size >= 16) formatters.delete(formatters.keys().next().value!); formatters.set(zone, formatter); }
  const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}
export const dayKey = (ms = Date.now(), zone?: string) => dateParts(ms, zone).date;
export function secondsText(ms: number) {
  const n = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map(v => String(v).padStart(2, "0")).join(":");
}
export function elapsed(s: Session | null, now = Date.now()) {
  return s ? s.segments.reduce((sum, p) => sum + p.end - p.start, 0) + (s.runningSince == null ? 0 : Math.max(0, now - s.runningSince)) : 0;
}
export function validateSegments(parts: Segment[], now: number) {
  if (!parts.length) throw new Error("至少保留一个实际工作时段。");
  let previous = -Infinity;
  for (const p of parts) {
    if (!Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end - p.start < 1000 || p.start < previous || p.end > now)
      throw new Error("时间段须至少一秒、顺序不重叠，且不能在未来。");
    previous = p.end;
  }
}
export function eventForSegment(record: Pick<WorkRecord, "title">, part: Segment): CalendarEvent {
  const start = dateParts(part.start, "UTC"), end = dateParts(part.end, "UTC");
  return { type: "single", uid: part.uid, title: record.title, date: start.date, endDate: end.date,
    startTime: start.time, endTime: end.time, allDay: false, timezone: "UTC", isTask: false,
    description: `实际计时：${secondsText(part.end - part.start)}\n原待办：${record.title}\n记录编号：${part.uid}` };
}
export function localInput(ms: number) { const p = dateParts(ms); return `${p.date}T${p.time}`; }
export function parseLocal(value: string) {
  const n = new Date(value).getTime();
  if (!Number.isFinite(n) || localInput(n).slice(0, value.length) !== value) throw new Error("日期或时间无效，请检查本地时区。");
  return n;
}
export function shiftDate(date: string, delta: number) { const d = new Date(`${date}T12:00:00`); d.setDate(d.getDate() + delta); return dayKey(+d); }
