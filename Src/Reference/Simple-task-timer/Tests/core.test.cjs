"use strict";
const test = require("node:test");
const assert = require("node:assert/strict");
const { TimerController, newSession, pauseSession, resumeSession, recoverSession, stopSession,
  elapsed, eventForSegment, blankJournal, validateJournal, secondsText, legacyReminder } = require("../Src/core.cjs");
const { ensureTaskIds, parseTasks, completeTaskText, taskLine } = require("../Src/tasks.cjs");
const { FcrBridge, flattenEvents, taskFromEntry } = require("../Src/fcr.cjs");

const task = { id: "task-1", title: "周整理", kind: "local", path: "待办计时/待办.md" };
const zone = "Asia/Shanghai";
function harness(overrides = {}) {
  let now = Date.parse("2026-10-24T14:20:00+08:00");
  const saved = [], effects = [], remote = new Map();
  const calendar = {
    assertWritable(id) { assert.equal(id, "icloud"); },
    async ensureEvent(id, event) { effects.push("calendar"); remote.set(event.uid, event); }
  };
  const tasks = { async complete() { effects.push("task"); } };
  const controller = new TimerController({ state: blankJournal(), persist: async s => { saved.push(structuredClone(s)); },
    calendar, tasks, now: () => now, zone: () => zone, ...overrides });
  return { controller, saved, effects, remote, advance(ms) { now += ms; }, setNow(ms) { now = ms; } };
}

test("paused time is excluded and each resumed span becomes its own calendar interval", async () => {
  const h = harness();
  await h.controller.start(task, "icloud"); h.advance(60000); await h.controller.pause();
  h.advance(300000); await h.controller.resume(); h.advance(120000);
  const record = await h.controller.finish(true);
  assert.equal(record.status, "saved"); assert.equal(record.segments.length, 2);
  assert.equal(elapsed(record), 180000); assert.deepEqual(h.effects, ["calendar", "calendar", "task"]);
  const events = [...h.remote.values()];
  assert.equal(events[0].startTime, "06:20:00"); assert.equal(events[0].endTime, "06:21:00");
  assert.equal(events[1].startTime, "06:26:00"); assert.equal(events[1].endTime, "06:28:00");
});

test("record-only leaves the todo open", async () => {
  const h = harness(); await h.controller.start(task, "icloud"); h.advance(61000);
  const r = await h.controller.finish(false);
  assert.equal(r.status, "saved"); assert.deepEqual(h.effects, ["calendar"]);
});

test("cross-midnight writes the correct dates and seconds", () => {
  const start = Date.parse("2026-10-24T23:59:30Z");
  const record = stopSession(newSession(task, "icloud", start, zone, "r-1"), start + 90000, true);
  const e = eventForSegment(record, record.segments[0]);
  assert.equal(e.date, "2026-10-24"); assert.equal(e.endDate, "2026-10-25");
  assert.equal(e.startTime, "23:59:30"); assert.equal(e.endTime, "00:01:00"); assert.equal(e.timezone, "UTC");
});

test("timezone and daylight-saving offsets are converted without changing absolute elapsed time", () => {
  const start = Date.parse("2026-11-01T05:30:00Z");
  const record = stopSession(newSession(task, "icloud", start, "America/New_York", "r-dst"), start + 7200000, true);
  const e = eventForSegment(record, record.segments[0]);
  assert.equal(e.startTime, "05:30:00"); assert.equal(e.endTime, "07:30:00"); assert.equal(e.timezone, "UTC");
  assert.equal(elapsed(record), 7200000);
});

test("network failure retains the outbox and does not complete the todo", async () => {
  let online = false; let completed = 0;
  const calendar = { assertWritable() {}, async ensureEvent() { if (!online) throw new Error("offline"); } };
  const h = harness({ calendar, tasks: { async complete() { completed++; } } });
  await h.controller.start(task, "icloud"); h.advance(60000);
  const pending = await h.controller.finish(true);
  assert.equal(pending.status, "pending"); assert.equal(h.controller.state.active, null); assert.equal(completed, 0);
  assert.equal(h.saved.some(s => s.records.some(x => x.id === pending.id && !x.segments[0].saved)), true);
  online = true; const saved = await h.controller.retry(pending.id);
  assert.equal(saved.status, "saved"); assert.equal(completed, 1);
  await h.controller.retry(pending.id); assert.equal(completed, 1);
});

test("todo completion can be retried without creating the calendar event twice", async () => {
  let attempts = 0; let creates = 0;
  const h = harness({ calendar: { assertWritable() {}, async ensureEvent() { creates++; } },
    tasks: { async complete() { if (attempts++ === 0) throw new Error("task conflict"); } } });
  await h.controller.start(task, "icloud"); h.advance(10000);
  const pending = await h.controller.finish(true);
  assert.equal(pending.segments[0].saved, true); assert.equal(pending.status, "pending");
  await h.controller.retry(pending.id); assert.equal(creates, 1); assert.equal(attempts, 2);
});

test("completion failure offers an explicit calendar-only resolution", async () => {
  const h = harness({ tasks: { async complete() { throw new Error("deleted"); } } });
  await h.controller.start(task, "icloud"); h.advance(10000);
  const pending = await h.controller.finish(true);
  await h.controller.keepCalendarOnly(pending.id);
  const saved = h.controller.state.records[0]; assert.equal(saved.status, "saved"); assert.equal(saved.completeTask, false);
});

test("a failed local persist prevents every remote write", async () => {
  const h = harness(); await h.controller.start(task, "icloud"); h.advance(60000);
  h.controller.persist = async () => { throw new Error("disk full"); };
  await assert.rejects(h.controller.finish(), /disk full/);
  assert.equal(h.effects.length, 0); assert.notEqual(h.controller.state.active, null);
});

test("rapid double-finish cannot double-create or double-complete", async () => {
  const h = harness(); await h.controller.start(task, "icloud"); h.advance(10000);
  const results = await Promise.allSettled([h.controller.finish(true), h.controller.finish(true)]);
  assert.equal(results.filter(x => x.status === "fulfilled").length, 1);
  assert.deepEqual(h.effects, ["calendar", "task"]); assert.equal(h.controller.state.records.length, 1);
});

test("restart recovery pauses at the last heartbeat and excludes time with OB closed", () => {
  const session = newSession(task, "icloud", Date.now() - 3600000, zone, "recover-1");
  session.lastHeartbeat = session.startedAt + 45000;
  const restored = recoverSession(session);
  assert.equal(restored.runningSince, null); assert.equal(elapsed(restored), 45000);
  assert.equal(session.runningSince, session.startedAt);
});

test("clock rollback never creates a negative calendar interval", () => {
  const session = newSession(task, "icloud", 10000, zone, "clock");
  assert.throws(() => pauseSession(session, 9000), /倒退/);
});

test("corrupt journal is rejected rather than silently clearing history", () => {
  assert.throws(() => validateJournal({ version: 1, records: [{ id: "x", segments: [] }] }), /不完整/);
  assert.throws(() => validateJournal({ version: 9, records: [] }), /格式/);
});

test("checkbox completion uses a stable id across renaming, moving and duplicate titles", () => {
  const note = "# 待办\r\n\r\n- [ ] 同名 <!-- simple-task:a -->\r\n- [ ] 同名 <!-- simple-task:b -->\r\n正文保持原样\r\n";
  const renamed = note.replace("同名 <!-- simple-task:b", "新标题 <!-- simple-task:b");
  const completed = completeTaskText(renamed, "b");
  assert.ok(completed.includes("- [ ] 同名 <!-- simple-task:a -->"));
  assert.ok(completed.includes("- [x] 新标题 <!-- simple-task:b -->"));
  assert.ok(completed.includes("正文保持原样\r\n"));
  assert.equal(completeTaskText(completed, "b"), completed);
});

test("new manual checkboxes get ids and copied ids are repaired", () => {
  let i = 0;
  const normalized = ensureTaskIds("- [ ] A\n- [ ] B <!-- simple-task:old -->\n- [ ] C <!-- simple-task:old -->", () => `generated-${++i}`);
  const tasks = parseTasks(normalized, "tasks.md");
  assert.equal(new Set(tasks.map(t => t.id)).size, 3);
  assert.equal(ensureTaskIds(normalized), normalized);
});

test("todo text and dates are validated; deleted originals are not replaced by new todos", () => {
  const line = taskLine("周整理\n第二行", "2026-10-25", "task-x");
  const parsed = parseTasks(line, "tasks.md")[0];
  assert.equal(parsed.title, "周整理 第二行"); assert.equal(parsed.due, "2026-10-25");
  assert.throws(() => taskLine("task", "2026-02-30"), /日期/);
  assert.throws(() => completeTaskText("- [ ] other <!-- simple-task:a -->", "missing"), /已被删除/);
});

test("legacy Apple upgrade placeholders cannot appear as usable todos", () => {
  assert.equal(legacyReminder("此列表的创建者已升级这些提醒事项"), true);
  assert.equal(legacyReminder("Where are my reminders?"), true);
  const item = { id: "x", calendarId: "icloud", event: { title: "The creator of this list has upgraded these reminders.", type: "single", isTask: true } };
  assert.equal(taskFromEntry(item, {}), null);
  assert.equal(taskFromEntry({ ...item, event: { ...item.event, title: "周整理" } }, {}).title, "周整理");
});

test("FCR nested cache shape is normalized without retaining source credentials", () => {
  const groups = [{ id: "icloud", color: "red", events: [{ id: "one", event: { title: "A" } }] }];
  assert.equal(flattenEvents(groups)[0].event.title, "A");
  assert.deepEqual(flattenEvents(null), []);
});

function bridgeHarness() {
  const server = new Map(); let lostResponse = false; let creates = 0;
  let groups = [];
  const api = {
    getCalendarSources: () => [{ id: "icloud", name: "生活", type: "caldav", username: "secret-user", password: "secret-password" }, { id: "tasks", name: "任务", type: "caldavtasks" }],
    getProviderCapabilities: () => ({ canCreate: true, canEdit: true }),
    getAllEvents: () => groups,
    async createEvent(id, event) {
      creates++; server.set(event.uid, event);
      if (lostResponse) { lostResponse = false; return false; }
      groups = [{ id, events: [{ id: "remote-1", event }] }]; return true;
    },
    getEvents: () => []
  };
  const bridge = new FcrBridge({}, () => null, () => {}); bridge.authorized = api;
  return { bridge, api, server, loseResponse() { lostResponse = true; }, get creates() { return creates; } };
}

test("deterministic CalDAV UIDs deduplicate a lost-response retry", async () => {
  const h = bridgeHarness(); const event = { uid: "session-1-span-0", title: "周整理" };
  h.loseResponse(); await assert.rejects(h.bridge.ensureEvent("icloud", event), /未成功/);
  await h.bridge.ensureEvent("icloud", event);
  await h.bridge.ensureEvent("icloud", event);
  assert.equal(h.server.size, 1); assert.equal(h.creates, 2);
  assert.deepEqual(Object.keys(h.bridge.sources()[0]).sort(), ["color", "id", "name", "type"]);
});

test("task-only collections cannot be selected as event destinations", () => {
  const h = bridgeHarness();
  assert.deepEqual(h.bridge.writableCalendars().map(x => x.id), ["icloud"]);
  assert.throws(() => h.bridge.assertWritable("tasks"), /不可写/);
});

test("seconds formatter supports sessions longer than a day", () => {
  assert.equal(secondsText(90061000), "25:01:01");
  assert.equal(secondsText(-100), "00:00:00");
});

test("a todo converted to an ordinary event is never silently changed back", async () => {
  let writes = 0;
  const h = bridgeHarness();
  h.api.getAllEvents = () => [{ id: "icloud", events: [{ id: "task-now-event", event: { uid: "old-task", type: "single", title: "已转换为日程", completed: null, isTask: false } }] }];
  h.api.processEvent = async () => { writes++; return true; };
  await assert.rejects(h.bridge.complete({ id: "task-now-event", uid: "old-task", calendarId: "icloud" }), /不再是待办/);
  assert.equal(writes, 0);
});

test("a title-only calendar edit keeps user-supplied local seconds and rejects stale data", async () => {
  const h = bridgeHarness();
  const original = { id: "old", calendarId: "icloud", crossDay: false, event: { type: "single", uid: "u-1", title: "旧标题", date: "2026-10-24", endDate: "2026-10-24", startTime: "06:20:00", endTime: "06:20:02", allDay: false, timezone: "UTC" } };
  h.api.getAllEvents = () => [{ id: "icloud", events: [structuredClone(original)] }];
  let stored;
  h.api.updateEvent = async (id, body) => { stored = body; return true; };
  await h.bridge.saveManualEvent({ title: "新标题", date: "2026-10-24", startTime: "14:20:00", endTime: "14:20:02", calendarId: "icloud" }, original);
  assert.equal(stored.startTime, "14:20:00"); assert.equal(stored.endTime, "14:20:02"); assert.equal(stored.uid, "u-1");
  h.api.getAllEvents = () => [{ id: "icloud", events: [{ ...original, event: { ...original.event, title: "其他设备改过" } }] }];
  await assert.rejects(h.bridge.saveManualEvent({ title: "新标题", date: "2026-10-24", startTime: "14:20:00", endTime: "14:20:02" }, original), /其他位置修改/);
});
