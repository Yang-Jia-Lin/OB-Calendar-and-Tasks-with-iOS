import { Temporal } from "temporal-polyfill";
import { clone, sameEventContent, type TimelineRow, type WorkRecord, type EventOperation, type DeleteOperation } from "./contracts";
import { dayKey } from "./time";
export function mergeTimeline(remote: TimelineRow[], records: WorkRecord[], date: string, operations: EventOperation[] = [], deletions: DeleteOperation[] = []): TimelineRow[] {
  // Suppress an unchanged stale FCR copy after absence was reconciled or explicitly confirmed.
  // A genuinely edited/restored event with different content remains visible.
  const rows = clone(remote).filter(r => !deletions.some(op => op.status === "saved" && ["absent-in-fcr", "user-confirmed-remote-deletion"].includes(op.resolution || "") && op.calendarId === r.calendarId && op.uid === r.original?.event.uid && sameEventContent(op.before, r.original.event)));
  const index = new Map(rows.flatMap(r => r.original?.event.uid ? [[`${r.calendarId}:${r.original.event.uid}`, r] as const] : []));
  for (const record of records) {
    const visible = record.edit ? { ...record, ...record.edit } : record;
    visible.segments.forEach(part => {
      const found = index.get(`${visible.calendarId}:${part.uid}`);
      if (record.status === "saved") { if (found) { found.recordId = record.id; found.segmentUid = part.uid; } return; } // Never resurrect saved work absent from FCR.
      // While moving, collapse both known copies into the one local pending row.
      const known = rows.filter(r => r.original?.event.uid === part.uid && [record.calendarId, visible.calendarId].includes(r.calendarId));
      known.forEach(r => { r.recordId = record.id; r.segmentUid = part.uid; });
      known.forEach(r => rows.splice(rows.indexOf(r), 1));
      if (date < dayKey(part.start) || date > dayKey(Math.max(part.start, part.end - 1))) return;
      rows.push({ key: `work:${record.id}:${part.uid}`, title: visible.title, calendarId: visible.calendarId, start: part.start, end: part.end,
        recordId: record.id, segmentUid: part.uid, pending: true, error: record.error });
    });
  }
  for (const op of operations.filter(o => o.status === "pending")) {
    const step = op.step, event = step.after;
    // prepareEvent always serializes manual edits in UTC.
    const instant=(date:string,time:string|undefined)=>{try{return event.allDay?+new Date(date+"T00:00:00"):event.timezone&&event.timezone!=="UTC"?Temporal.ZonedDateTime.from(`${date}T${time}[${event.timezone}]`).epochMilliseconds:Date.parse(`${date}T${time}${event.timezone==="UTC"?"Z":""}`);}catch{return NaN;}};
    const start=instant(event.date,event.startTime),end=event.isTask?start+(event.allDay?86400000:3600000):instant(event.endDate||event.date,event.endTime);
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
    const known = rows.filter(r => r.original?.event.uid === step.uid && [step.fromCalendarId, step.toCalendarId].includes(r.calendarId));
    known.forEach(r => rows.splice(rows.indexOf(r), 1));
    if (date < dayKey(start) || date > dayKey(Math.max(start, end - 1))) continue;
    rows.push({ key: `event-operation:${op.id}`, title: event.title, calendarId: step.toCalendarId, start, end, allDay:!!event.allDay, pending: true, error: op.error });
  }
  for (const op of deletions.filter(o => o.status !== "saved")) {
    const known = rows.filter(r => (r.original?.event.uid === op.uid && r.calendarId === op.calendarId) || (r.recordId === op.recordId && r.segmentUid === op.uid));
    known.forEach(r => rows.splice(rows.indexOf(r), 1));
    if (date < dayKey(op.start) || date > dayKey(Math.max(op.start, op.end - 1))) continue;
    rows.push({ key: `delete:${op.id}`, deletionId: op.id, title: op.title, calendarId: op.calendarId, start: op.start, end: op.end, recordId: op.recordId, segmentUid: op.uid, pending: true, deleting: true, error: op.error });
  }
  return rows.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
}
