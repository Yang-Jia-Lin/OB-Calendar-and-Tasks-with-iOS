import test from "node:test";
import assert from "node:assert/strict";
import { TimerController, blankJournal, validateJournal } from "../Shared/timer";
import { clone, type Task, type CalendarEvent, type EditStep, type CalendarPort, type Journal } from "../Shared/contracts";
import { elapsed, dateParts, eventForSegment, validateSegments } from "../Shared/time";
import { mergeTimeline } from "../Shared/timeline";
import { ensureTaskIds, parseTasks, taskLine, updateTaskText } from "../Clients/Obsidian/tasks";
import { prepareLegacyImport, JournalStore } from "../Clients/Obsidian/journal";
import { mkdtemp, readFile, writeFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
const task: Task = { id: "t", title: "阅读", completed: false, kind: "local", path: "待办.md", calendarId: "research" };
function harness() {
  let now = Date.parse("2026-10-25T12:00:00+08:00"), persistFails = false, completeFails = false;
  const effects: string[] = [], remote = new Map<string, CalendarEvent>(); const durable: Journal[] = [];
  const calendar: CalendarPort = {
    assertWritable(id) { if (!["research", "work"].includes(id)) throw new Error("not writable"); },
    readByUid(id, uid) { return clone(remote.get(`${id}:${uid}`)); },
    hasCalendarData(id) { return ["research", "work"].includes(id); },
    async ensureEvent(id, event) { effects.push("calendar"); const key = `${id}:${event.uid}`; const existing = remote.get(key); if (!existing) remote.set(key, clone(event)); return clone(remote.get(key)!); },
    async reconcileStep(step, checkpoint) { remote.delete(`${step.fromCalendarId}:${step.uid}`); remote.set(`${step.toCalendarId}:${step.uid}`, clone(step.after)); step.stage = "done"; await checkpoint(); },
    async deleteEvent(target) { effects.push("delete"); remote.delete(`${target.calendarId}:${target.uid}`); }
  };
  const controller = new TimerController({ calendar, state: blankJournal(), persist: async s => { if (persistFails) throw new Error("disk full"); durable.push(clone(s)); },
    tasks: { complete: async () => { effects.push("task"); if (completeFails) throw new Error("task failed"); } }, now: () => now, zone: () => "Asia/Shanghai" });
  return { controller, calendar, remote, effects, durable, now: () => now, advance(ms: number) { now += ms; }, failDisk(v = true) { persistFails = v; }, failTask(v = true) { completeFails = v; } };
}
test("pause gaps are excluded and resumed spans keep separate stable UIDs", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(60000); await h.controller.pause(); h.advance(300000); await h.controller.resume(); h.advance(120000);
  const r = await h.controller.finish(true); assert.equal(elapsed(r), 180000); assert.equal(r.segments.length, 2); assert.notEqual(r.segments[0].uid, r.segments[1].uid); assert.deepEqual(h.effects, ["calendar", "calendar", "task"]);
});
test("record-only leaves the task open", async () => { const h = harness(); await h.controller.start(task, "research"); h.advance(3000); await h.controller.finish(false); assert.deepEqual(h.effects, ["calendar"]); });
test("one active session and double-finish cannot produce duplicates", async () => {
  const h = harness(); await h.controller.start(task, "research"); await assert.rejects(h.controller.start(task, "research")); h.advance(4000);
  const result = await Promise.allSettled([h.controller.finish(true), h.controller.finish(true)]); assert.equal(result.filter(x => x.status === "fulfilled").length, 1); assert.equal(h.remote.size, 1);
});
test("local persist failure prevents start and calendar effects", async () => { const h = harness(); h.failDisk(); await assert.rejects(h.controller.start(task, "research")); assert.equal(h.controller.state.active, null); assert.equal(h.effects.length, 0); });
test("failed finish persist leaves the live session recoverable", async () => { const h = harness(); await h.controller.start(task, "research"); h.advance(3000); h.failDisk(); await assert.rejects(h.controller.finish(true)); assert.ok(h.controller.state.active); assert.equal(h.remote.size, 0); });
test("task completion failure retries only completion", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); h.failTask(); const r = await h.controller.finish(true); assert.equal(r.status, "pending"); h.failTask(false); await h.controller.retry(r.id); assert.deepEqual(h.effects, ["calendar", "task", "task"]);
});
test("calendar-only resolution does not recreate an already saved event", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); h.failTask(); const r = await h.controller.finish(true); await h.controller.keepCalendarOnly(r.id); assert.equal(h.controller.state.records[0].status, "saved"); assert.equal(h.remote.size, 1);
});
test("active start can be backdated and category changed without changing task classification", async () => {
  const h = harness(); await h.controller.start(task, "research"); const start = h.controller.state.active!.startedAt;
  await h.controller.updateActive({ startedAt: start - 600000, calendarId: "work" }); assert.equal(elapsed(h.controller.state.active, h.now()), 600000); assert.equal(h.controller.state.active!.task.calendarId, "research");
  await assert.rejects(h.controller.updateActive({ startedAt: start + 1 })); await assert.rejects(h.controller.updateActive({ calendarId: "deleted" }));
});
test("backdating a resumed session moves only first start, preserving pause", async () => {
  const h = harness(); await h.controller.start(task, "research"); const start = h.controller.state.active!.startedAt; h.advance(60000); await h.controller.pause(); h.advance(90000); await h.controller.resume(); h.advance(60000);
  await h.controller.updateActive({ startedAt: start - 60000 }); assert.equal(elapsed(h.controller.state.active, h.now()), 180000); assert.equal(h.controller.state.active!.runningSince, start + 150000);
  await assert.rejects(h.controller.updateActive({ startedAt: start + 60000 }));
});
test("restart recovery pauses at durable heartbeat", async () => { const h = harness(); await h.controller.start(task, "research"); h.advance(15000); await h.controller.heartbeat(); h.advance(3600000); await h.controller.recover(); assert.equal(elapsed(h.controller.state.active), 15000); assert.equal(h.controller.state.active!.runningSince, null); });
test("clock rollback cannot save negative spans", async () => { const h = harness(); await h.controller.start(task, "research"); h.advance(-1000); await assert.rejects(h.controller.pause()); assert.equal(h.remote.size, 0); });
test("UTC records preserve cross-midnight and DST instants", () => {
  const start = Date.parse("2026-10-25T23:59:30Z"), event = eventForSegment({ title: "跨日" }, { start, end: start + 90000, uid: "s" });
  assert.equal(event.date, "2026-10-25"); assert.equal(event.endDate, "2026-10-26"); assert.equal(event.endTime, "00:01:00");
  assert.equal(dateParts(Date.parse("2026-11-01T05:30Z"), "America/New_York").time, "01:30:00"); assert.equal(dateParts(Date.parse("2026-11-01T06:30Z"), "America/New_York").time, "01:30:00");
});
test("segment validation rejects future, overlap, reverse, zero and absent intervals", () => {
  for (const segments of [[], [{ start: 1, end: 1 }], [{ start: 2, end: 1 }], [{ start: 0, end: 2000 }, { start: 1000, end: 3000 }], [{ start: 0, end: 20000 }]]) assert.throws(() => validateSegments(segments, 10000));
});
test("history edit preserves all UIDs and task category", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(60000); const r = await h.controller.finish(false);
  const result = await h.controller.editRecord(r.id, { title: "新标题", calendarId: "work", segments: r.segments.map(p => ({ ...p, start: p.start - 1000 })) }, clone(r));
  assert.equal(result.status, "saved"); assert.equal(result.calendarId, "work"); assert.equal(result.segments[0].uid, r.segments[0].uid); assert.equal(result.task.calendarId, "research"); assert.equal(h.remote.size, 1);
});
test("history edits reject a remote deletion and concurrent change", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(60000); const r = await h.controller.finish(false); const key = `research:${r.segments[0].uid}`;
  h.remote.get(key)!.title = "external";
  await assert.rejects(h.controller.editRecord(r.id, { title: "edit", calendarId: "research", segments: r.segments }, r), /外部修改/);
  h.remote.delete(key); await assert.rejects(h.controller.editRecord(r.id, { title: "edit", calendarId: "research", segments: r.segments }, r), /删除/);
});
test("history external changes can be edited after reopening with a fresh snapshot", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(60000); const r = await h.controller.finish(false); const key = `research:${r.segments[0].uid}`; h.remote.get(key)!.title = "external";
  const result = await h.controller.editRecord(r.id, { title: "new", calendarId: "research", segments: r.segments, snapshots: [clone(h.remote.get(key)!)] }, clone(r)); assert.equal(result.status, "saved");
});
test("history editing tolerates a metadata-only refresh but still detects content changes", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(60000); const r = await h.controller.finish(false);
  const key = `research:${r.segments[0].uid}`;
  Object.assign(h.remote.get(key)!, { etag: "new-version", caldavHref: "same-content.ics" });
  const result = await h.controller.editRecord(r.id, { title: "new", calendarId: "research", segments: r.segments }, clone(r));
  assert.equal(result.status, "saved"); assert.equal(result.title, "new");
  h.remote.get(key)!.endTime = "23:59:00";
  await assert.rejects(h.controller.editRecord(result.id, { title: "again", calendarId: "research", segments: result.segments }, clone(result)), /外部修改/);
});
test("pending records cannot be edited before reconciliation", async () => { const h = harness(); h.calendar.ensureEvent = async () => { throw new Error("offline"); }; await h.controller.start(task, "research"); h.advance(2000); const r = await h.controller.finish(true); await assert.rejects(h.controller.editRecord(r.id, { title: "x", calendarId: "work", segments: r.segments }, r), /待同步/); });
test("timeline joins saved work by UID and does not resurrect deleted remote work", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(2000); const r = await h.controller.finish(false), p = r.segments[0];
  const row = { key: "remote", title: "阅读", calendarId: "research", start: p.start, end: p.end, original: { id: "fcr-id", calendarId: "research", event: eventForSegment(r, p) } };
  const joined = mergeTimeline([row], [r], "2026-10-25"); assert.equal(joined.length, 1); assert.equal(joined[0].recordId, r.id); assert.equal(mergeTimeline([], [r], "2026-10-25").length, 0);
});
test("pending work appears without an FCR event", async () => { const h = harness(); h.calendar.ensureEvent = async () => { throw new Error("offline"); }; await h.controller.start(task, "research"); h.advance(2000); const r = await h.controller.finish(false); const rows = mergeTimeline([], [r], "2026-10-25"); assert.equal(rows.length, 1); assert.equal(rows[0].pending, true); });
test("markdown category roundtrip preserves IDs, due and completion", () => {
  const text = taskLine("Hello", "2026-10-26", "old-id", "账户/科研?x=a", true), parsed = parseTasks(text, "t.md")[0]; assert.equal(parsed.id, "old-id"); assert.equal(parsed.calendarId, "账户/科研?x=a"); assert.equal(parsed.completed, true);
  const updated = updateTaskText(text, parsed, { title: "New", calendarId: "work", due: "" }); const next = parseTasks(updated, "t.md")[0]; assert.equal(next.title, "New"); assert.equal(next.id, parsed.id); assert.equal(next.completed, true); assert.equal(next.due, "");
});
test("markdown surgical updates preserve surrounding notes and CRLF", () => {
  const text = `# Heading\r\n\r\n  ${taskLine("Old", "", "id")}\r\nOther text\r\n`, t = parseTasks(text, "t.md")[0];
  const next = updateTaskText(text, t, { title: "New" }); assert.equal(next, text.replace("Old", "New"));
});
test("copied task IDs repaired and stale task changes rejected", () => {
  const text = ensureTaskIds("- [ ] A <!-- simple-task:id -->\n- [ ] B <!-- simple-task:id -->", () => "new-id"), parsed = parseTasks(text, "t.md"); assert.deepEqual(parsed.map(t => t.id), ["id", "new-id"]);
  assert.throws(() => updateTaskText(text.replace("A", "changed"), parsed[0], { title: "edit" }), /修改/); assert.throws(() => taskLine("a", "2026-02-30"));
});
test("legacy import upgrades schema while keeping original UIDs and confirmation flags", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(2000); const r = await h.controller.finish(false); const raw: any = clone(h.controller.state); raw.version = 1; delete raw.operations;
  const imported = prepareLegacyImport({ targetCalendarId: "research", tasksPath: "old/t.md", token: "must-not-copy" }, raw, blankJournal(), false);
  assert.equal(imported.journal.version, 2); assert.equal(imported.journal.records[0].segments[0].uid, r.segments[0].uid); assert.equal(imported.journal.records[0].segments[0].saved, true); assert.ok(!JSON.stringify(imported.settings).includes("token")); assert.equal(raw.version, 1);
});
test("legacy import refuses enabled plugin, active sessions and overwriting new records", async () => {
  const h = harness(); await h.controller.start(task, "research"); assert.throws(() => prepareLegacyImport({}, h.controller.state, blankJournal(), false), /未结束/); assert.throws(() => prepareLegacyImport({}, blankJournal(), blankJournal(), true), /禁用/);
  h.advance(2000); await h.controller.finish(false); assert.throws(() => prepareLegacyImport({}, blankJournal(), h.controller.state, false), /覆盖/);
});
test("journal rejects invalid versions and broken intervals", () => { assert.throws(() => validateJournal({ version: 9, records: [] })); assert.throws(() => validateJournal({ version: 1, active: { id: "x" }, records: [] })); });
test("atomic journal recovers valid previous data without destroying damaged file", async () => {
  const dir = await mkdtemp(path.resolve("../Results/Tests/ctt-test-"));
  try { const file = path.join(dir, "sessions.json"), store = new JournalStore(file); await store.load(); await store.save(blankJournal()); await store.save(blankJournal()); await writeFile(file, "broken"); const restored = await new JournalStore(file).load(); assert.equal(restored.version, 2); assert.ok((await readdir(dir)).some(f => f.includes("damaged"))); assert.equal(await readFile(file, "utf8"), "broken"); }
  finally { await rm(dir, { recursive: true }); }
});
test("a zero-duration paused session can be corrected without silently resuming", async () => {
  const h = harness(); await h.controller.start(task, "research"); const start = h.controller.state.active!.startedAt; await h.controller.pause();
  await h.controller.updateActive({ startedAt: start - 30000 }); assert.equal(h.controller.state.active!.runningSince, null); assert.equal(elapsed(h.controller.state.active, h.now()), 30000);
});
test("stale start dialog cannot edit a different active session", async () => {
  const h = harness(); await h.controller.start(task, "research"); const id = h.controller.state.active!.id; h.advance(2000); await h.controller.finish(false); await h.controller.start(task, "research");
  await assert.rejects(h.controller.updateActive({ startedAt: h.now() - 1000 }, id), /已变化/);
});
test("manual operations persist before remote effects and survive failure", async () => {
  const h = harness(); const step: EditStep = { uid: "manual", fromCalendarId: "", toCalendarId: "work", before: {} as CalendarEvent, after: eventForSegment({ title: "future" }, { start: h.now() + 60000, end: h.now() + 120000, uid: "manual" }), stage: "prepared" };
  h.calendar.reconcileStep = async () => { assert.equal(h.durable.at(-1)!.operations.length, 1); throw new Error("offline"); };
  const result = await h.controller.saveEvent(step); assert.equal(result.status, "pending");
  const rows = mergeTimeline([], [], "2026-10-25", h.controller.state.operations); assert.equal(rows.length, 1); assert.equal(rows[0].pending, true);
});
test("history mutation persist failure prevents all remote edits", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false); h.failDisk();
  await assert.rejects(h.controller.editRecord(r.id, { title: "new", calendarId: "work", segments: r.segments }, r));
  assert.ok(h.remote.has(`research:${r.segments[0].uid}`)); assert.ok(!h.remote.has(`work:${r.segments[0].uid}`));
});
test("category metadata stays invisible to the old timer's checkbox title parser", () => {
  const text = taskLine("Readable", "", "old-id", "research");
  const checkbox = text.split("\n")[0]; assert.equal(checkbox.replace(/^\s*-\s+\[.\]\s+/, "").replace(/\s*<!--\s*simple-task:[a-zA-Z0-9-]+\s*-->\s*$/, ""), "Readable");
  const task = parseTasks(text, "t.md")[0]; const updated = updateTaskText(text, task, { calendarId: "work" });
  assert.equal(updated.match(/ctt-category:/g)?.length, 1); assert.equal(parseTasks(updated, "t.md")[0].calendarId, "work");
});
test("deleting a selected work segment preserves other segments, UIDs and task state", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(60000); await h.controller.pause(); h.advance(60000); await h.controller.resume(); h.advance(60000); const r = await h.controller.finish(true), first = r.segments[0];
  const priorTasks = h.effects.filter(e => e === "task").length;
  const op = await h.controller.deleteEvent({ calendarId: r.calendarId, uid: first.uid!, before: clone(first.snapshot!) }, first, clone(r));
  assert.equal(op.status, "saved"); assert.equal(h.controller.state.records[0].segments.length, 1); assert.equal(h.controller.state.records[0].segments[0].uid, r.segments[1].uid);
  assert.equal(h.controller.state.records[0].taskSaved, true); assert.equal(h.effects.filter(e => e === "task").length, priorTasks); assert.equal(h.remote.size, 1);
});
test("deleting the last segment leaves a tombstone and record retry cannot recreate it", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), part = r.segments[0];
  const op = await h.controller.deleteEvent({ calendarId: r.calendarId, uid: part.uid!, before: part.snapshot! }, part, r);
  assert.equal(h.controller.state.records[0].segments.length, 0); assert.equal(validateJournal(h.controller.state).deletions![0].status, "saved");
  await h.controller.retry(r.id); await h.controller.retryDeletion(op.id); assert.equal(h.remote.size, 0); assert.equal(h.effects.filter(e => e === "delete").length, 1);
});
test("delete persist failure prevents remote deletion", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), p = r.segments[0]; h.failDisk();
  await assert.rejects(h.controller.deleteEvent({ calendarId: r.calendarId, uid: p.uid!, before: p.snapshot! }, p, r)); assert.equal(h.remote.size, 1); assert.ok(!h.effects.includes("delete"));
});
test("failed work deletion survives restart and retries without affecting task completion", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), p = r.segments[0];
  const remove = h.calendar.deleteEvent; h.calendar.deleteEvent = async () => { throw new Error("offline"); };
  const op = await h.controller.deleteEvent({ calendarId: r.calendarId, uid: p.uid!, before: p.snapshot! }, p, r); assert.equal(op.status, "pending"); assert.equal(h.controller.state.records[0].segments.length, 1);
  const rows = mergeTimeline([], h.controller.state.records, "2026-10-25", [], h.controller.state.deletions); assert.equal(rows.length, 1); assert.equal(rows[0].deleting, true);
  h.calendar.deleteEvent = remove;
  const restored = new TimerController({ state: clone(h.controller.state), calendar: h.calendar, persist: async () => {}, tasks: { complete: async () => { assert.fail("deletion must not change task completion"); } } });
  await restored.retryDeletion(op.id); assert.equal(restored.state.records[0].segments.length, 0); assert.equal(h.remote.size, 0);
});
test("pending deletion blocks history edit and duplicate deletion", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), p = r.segments[0], target = { calendarId: r.calendarId, uid: p.uid!, before: p.snapshot! };
  h.calendar.deleteEvent = async () => { throw new Error("offline"); }; await h.controller.deleteEvent(target, p, r);
  await assert.rejects(h.controller.editRecord(r.id, { title: "new", calendarId: "research", segments: r.segments }, r), /删除/);
  await assert.rejects(h.controller.deleteEvent(target, p, r), /等待删除/); assert.equal(h.controller.state.deletions!.length, 1);
});
test("external changes between opening and confirming deletion are rejected", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), p = r.segments[0]; h.remote.get(`research:${p.uid}`)!.title = "external";
  await assert.rejects(h.controller.deleteEvent({ calendarId: r.calendarId, uid: p.uid!, before: p.snapshot! }, p, r), /修改或删除/); assert.equal(h.remote.size, 1); assert.equal(h.controller.state.deletions?.length ?? 0, 0);
});
test("delete tombstones require matching event identity", () => {
  assert.throws(() => validateJournal({ ...blankJournal(), deletions: [{ id: "delete", uid: "one", calendarId: "research", before: { uid: "different" }, start: 0, end: 1, status: "pending" }] }), /删除操作日志/);
});
test("a lost local confirmation after remote deletion recovers from the durable request", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), p = r.segments[0], remove = h.calendar.deleteEvent;
  h.calendar.deleteEvent = async target => { await remove(target); h.failDisk(); };
  await assert.rejects(h.controller.deleteEvent({ calendarId: r.calendarId, uid: p.uid!, before: p.snapshot! }, p, r));
  assert.equal(h.remote.size, 0); assert.equal(h.controller.state.deletions![0].status, "pending"); assert.equal(h.controller.state.records[0].segments.length, 1);
  h.failDisk(false); h.calendar.deleteEvent = remove; await h.controller.retryDeletion(h.controller.state.deletions![0].id);
  assert.equal(h.controller.state.records[0].segments.length, 0); assert.equal(h.controller.state.deletions![0].status, "saved"); assert.equal(h.remote.size, 0);
});
test("refresh reconciliation clears externally removed work without sending another DELETE", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), p = r.segments[0];
  h.calendar.deleteEvent = async () => { throw new Error("CalDAV request failed (HTTP 404):"); };
  await h.controller.deleteEvent({ calendarId: r.calendarId, uid: p.uid!, before: p.snapshot! }, p, r);
  h.remote.delete(`research:${p.uid}`);
  assert.equal(await h.controller.reconcileDeletions(), 1); assert.equal(h.controller.state.records[0].segments.length, 0); assert.equal(h.controller.state.deletions![0].resolution, "absent-in-fcr"); assert.ok(!h.effects.includes("delete"));
  const stale = { key: "stale", title: r.title, calendarId: r.calendarId, start: p.start, end: p.end, original: { id: "stale", calendarId: r.calendarId, event: p.snapshot! } };
  assert.equal(mergeTimeline([stale], h.controller.state.records, "2026-10-25", [], h.controller.state.deletions).length, 0);
});
test("missing calendar data never settles pending deletions as successful", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), p = r.segments[0];
  h.calendar.deleteEvent = async () => { throw new Error("HTTP 404"); }; await h.controller.deleteEvent({ calendarId: r.calendarId, uid: p.uid!, before: p.snapshot! }, p, r);
  h.remote.clear(); h.calendar.hasCalendarData = () => false; assert.equal(await h.controller.reconcileDeletions(), 0); assert.equal(h.controller.state.deletions![0].status, "pending");
});
test("a 404 with a still-cached event remains pending until user confirms remote deletion", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), p = r.segments[0];
  h.calendar.deleteEvent = async () => { throw new Error("HTTP 404"); }; const op = await h.controller.deleteEvent({ calendarId: r.calendarId, uid: p.uid!, before: p.snapshot! }, p, r);
  assert.equal(await h.controller.reconcileDeletions(), 0); await h.controller.confirmRemoteDeletion(op.id);
  assert.equal(h.controller.state.deletions![0].resolution, "user-confirmed-remote-deletion"); assert.equal(h.controller.state.records[0].segments.length, 0); assert.equal(h.remote.size, 1); assert.ok(!h.effects.includes("delete"));
  const row = { key: "stale", title: r.title, calendarId: "research", start: p.start, end: p.end, original: { id: "stale", calendarId: "research", event: { ...p.snapshot!, caldavHref: "refreshed.ics", etag: "new-tag" } } };
  assert.equal(mergeTimeline([row], h.controller.state.records, "2026-10-25", [], h.controller.state.deletions).length, 0);
  row.original.event.title = "restored and edited"; assert.equal(mergeTimeline([row], h.controller.state.records, "2026-10-25", [], h.controller.state.deletions).length, 1);
});
test("user cleanup is unavailable for ordinary network failures and stops on external edits", async () => {
  const h = harness(); await h.controller.start(task, "research"); h.advance(3000); const r = await h.controller.finish(false), p = r.segments[0];
  h.calendar.deleteEvent = async () => { throw new Error("offline"); }; const op = await h.controller.deleteEvent({ calendarId: r.calendarId, uid: p.uid!, before: p.snapshot! }, p, r);
  await assert.rejects(h.controller.confirmRemoteDeletion(op.id), /资源不存在/);
  h.calendar.deleteEvent = async () => { throw new Error("HTTP 404"); }; await h.controller.retryDeletion(op.id); h.remote.get(`research:${p.uid}`)!.title = "changed";
  await assert.rejects(h.controller.confirmRemoteDeletion(op.id), /内容已变化/); assert.equal(h.controller.state.deletions![0].status, "pending");
});
