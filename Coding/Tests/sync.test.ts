import test from "node:test";
import assert from "node:assert/strict";
import { TimerController, blankJournal, validateJournal, classifySyncError } from "../Shared/timer";
import { SyncWorker } from "../Shared/sync";
import { clone, type CalendarEvent, type CalendarPort, type Journal, type Task } from "../Shared/contracts";
import { pendingView } from "../Clients/Obsidian/syncStatus";
import { MarkdownTasks, taskLine } from "../Clients/Obsidian/tasks";
import { JournalStore } from "../Clients/Obsidian/journal";
import { mkdtemp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
const task: Task = { id: "local", title: "Local task", completed: false, kind: "local", calendarId: "a", path: "todo.md" };
function gate() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function until(condition: () => boolean) { for (let i = 0; i < 500; i++) { if (condition()) return; await new Promise(r => setTimeout(r, 2)); } assert.ok(condition(), "condition did not settle"); }
function harness(state: Journal = blankJournal()) {
  let now = Date.parse("2026-10-29T10:00:00Z"), persisted = clone(state), diskFails = false, taskFails = false, calls = 0, completed = 0;
  let wait: Promise<void> | undefined, failure = "", loseReply = false;
  const remote = new Map<string, CalendarEvent>();
  const calendar: CalendarPort = {
    assertWritable(id) { if (!["a", "b"].includes(id)) throw Error("分类日历已失效"); },
    hasCalendarData: () => true, readByUid: (id, uid) => clone(remote.get(`${id}:${uid}`)),
    async ensureEvent(id, event) {
      calls++; if (wait) await wait; if (failure) throw Error(failure);
      const key = `${id}:${event.uid}`; if (!remote.has(key)) remote.set(key, clone(event));
      if (loseReply) { loseReply = false; throw Error("lost create response"); }
      return clone(remote.get(key)!);
    },
    async reconcileStep(step, checkpoint) { calls++; if (wait) await wait; if (failure) throw Error(failure); remote.delete(`${step.fromCalendarId}:${step.uid}`); remote.set(`${step.toCalendarId}:${step.uid}`, clone(step.after)); step.stage = "done"; await checkpoint(); },
    async deleteEvent(target) { calls++; remote.delete(`${target.calendarId}:${target.uid}`); if (wait) await wait; if (failure) throw Error(failure); }
  };
  const c = new TimerController({ state, background: true, calendar, persist: async value => { if (diskFails) throw Error("disk full"); persisted = clone(value); },
    tasks: { complete: async () => { if (taskFails) throw Error("待办已在其他位置修改"); completed++; } }, now: () => now, zone: () => "UTC" });
  return { c, calendar, remote, durable: () => clone(persisted), now: () => now, advance: (ms = 2000) => { now += ms; }, calls: () => calls, completed: () => completed,
    wait: (p?: Promise<void>) => { wait = p; }, fail: (message = "") => { failure = message; }, failDisk: (value = true) => { diskFails = value; }, failTask: (value = true) => { taskFails = value; }, loseReply: () => { loseReply = true; } };
}
async function finished(h: ReturnType<typeof harness>, complete = false) { await h.c.start(task, "a"); h.advance(); return h.c.finish(complete); }

test("finish commits locally and completes the local task before any calendar call", async () => {
  const h = harness(), r = await finished(h, true);
  assert.equal(r.status, "pending"); assert.equal(r.localFirst, true); assert.equal(r.taskSaved, true); assert.equal(h.completed(), 1); assert.equal(h.calls(), 0); assert.equal(h.durable().active, null);
  await h.c.sync(`work:${r.id}`); assert.equal(h.remote.size, 1); assert.equal(h.completed(), 1);
});
test("a slow upload never holds the start/pause/resume/heartbeat lock or overwrites a newer active task", async () => {
  const h = harness(), r = await finished(h), hold = gate(); h.wait(hold.promise);
  const upload = h.c.sync(`work:${r.id}`); await until(() => h.calls() === 1);
  const next = { ...task, id: "next", title: "Next" }; await h.c.start(next, "b"); h.advance(10000); await h.c.pause(); await h.c.resume(); h.advance(); await h.c.heartbeat();
  const active = clone(h.c.state.active); hold.resolve(); await upload;
  assert.deepEqual(h.c.state.active, active); assert.equal(h.c.state.records[0].status, "saved"); assert.equal(h.durable().active?.title, "Next");
});
test("slow-response warning and repeated retry clicks never duplicate an in-flight upload", async t => {
  const h = harness(), r = await finished(h), hold = gate(); h.wait(hold.promise);
  const worker = new SyncWorker(h.c, { enabled: () => true, delayMs: 1, slowMs: 5, now: h.now }); t.after(() => worker.stop());
  worker.wake(); await until(() => worker.view.waiting); await worker.retry(`work:${r.id}`); worker.wake();
  await h.c.start({ ...task, id: "next" }, "a"); assert.equal(h.calls(), 1);
  hold.resolve(); await until(() => h.c.state.records[0].status === "saved"); assert.equal(h.remote.size, 1);
});
test("network errors persist exponential backoff and resume without a hot retry loop", async t => {
  const h = harness(), r = await finished(h); h.fail("network timeout");
  const worker = new SyncWorker(h.c, { enabled: () => true, delayMs: 1, now: h.now }); t.after(() => worker.stop()); worker.wake();
  await until(() => h.c.state.records[0].sync?.issue === "network");
  assert.equal(h.calls(), 1); assert.ok(h.c.state.records[0].sync!.retryAt > h.now());
  for (let i = 0; i < 5; i++) worker.wake(); await new Promise(r => setTimeout(r, 20)); assert.equal(h.calls(), 1);
  h.fail(); h.advance(5000); worker.wake(); await until(() => h.c.state.records[0].status === "saved"); assert.equal(h.calls(), 2);
});
test("authorization failures pause the queue until authorization resumes, while local timing continues", async t => {
  const h = harness(); await finished(h); h.fail("HTTP 401");
  const worker = new SyncWorker(h.c, { enabled: () => true, delayMs: 1, now: h.now }); t.after(() => worker.stop()); worker.wake();
  await until(() => h.c.state.records[0].sync?.issue === "auth"); await h.c.start({ ...task, id: "next" }, "a");
  h.fail(); await worker.resume("auth"); await until(() => h.c.state.records[0].status === "saved"); assert.equal(h.c.state.active?.task.id, "next");
});
test("old pending errors are preserved and do not automatically replay on upgrade", async t => {
  const h = harness(), r = await finished(h), state = h.durable(); delete state.records[0].sync; state.records[0].error = "请先连接 FCR 日历。";
  const restored = harness(state), worker = new SyncWorker(restored.c, { enabled: () => true, delayMs: 1, now: restored.now }); t.after(() => worker.stop());
  worker.wake(); await new Promise(r => setTimeout(r, 20)); assert.equal(restored.calls(), 0);
  assert.match(pendingView(restored.c.state)[0].error, /上次同步错误/);
  await worker.retry(`work:${r.id}`); await until(() => restored.c.state.records[0].status === "saved"); assert.equal(restored.calls(), 1);
});
test("conflicts are never automatically retried or cleared by a network-online hint", async t => {
  const h = harness(); await finished(h); h.fail("日程已被外部修改");
  const worker = new SyncWorker(h.c, { enabled: () => true, delayMs: 1, now: h.now }); t.after(() => worker.stop()); worker.wake();
  await until(() => h.c.state.records[0].sync?.issue === "conflict"); await worker.resume("network"); worker.wake(); await new Promise(r => setTimeout(r, 20));
  assert.equal(h.calls(), 1); assert.equal(h.remote.size, 0);
});
test("a locally completed task remains complete through offline failure and UID-based restart retry", async () => {
  const h = harness(), r = await finished(h, true); h.loseReply(); await h.c.sync(`work:${r.id}`);
  assert.equal(h.c.state.records[0].status, "pending"); assert.equal(h.completed(), 1); assert.equal(h.remote.size, 1);
  const restored = new TimerController({ state: h.durable(), background: true, persist: async () => {}, calendar: h.calendar, tasks: { complete: async () => { throw Error("must not complete twice"); } } });
  await restored.requestRetry(`work:${r.id}`); await restored.sync(`work:${r.id}`); assert.equal(restored.state.records[0].status, "saved"); assert.equal(h.remote.size, 1);
});
test("local task completion failure is durably recoverable and does not start cloud effects", async () => {
  const h = harness(); h.failTask(); const r = await finished(h, true);
  assert.equal(r.taskSaved, false); assert.equal(r.sync?.issue, "conflict"); assert.equal(h.calls(), 0); assert.equal(h.c.state.active, null);
  h.failTask(false); await h.c.requestRetry(`work:${r.id}`); await h.c.sync(`work:${r.id}`); assert.equal(h.completed(), 1); assert.equal(h.remote.size, 1);
});
test("an automatic job selected during local completion rechecks conflicts after acquiring the short lock", async t => {
  const h = harness(), hold = gate(); let attempts = 0;
  (h.c as any).deps.tasks.complete = async () => { attempts++; await hold.promise; throw Error("待办已在其他位置修改"); };
  const worker = new SyncWorker(h.c, { enabled: () => true, delayMs: 1, now: h.now }); t.after(() => worker.stop());
  (h.c as any).deps.onChange = () => worker.wake();
  await h.c.start(task, "a"); h.advance(); const finish = h.c.finish(true);
  await until(() => !!worker.view.activeKey); hold.resolve(); await finish; await until(() => !worker.view.activeKey);
  assert.equal(attempts, 1); assert.equal(h.calls(), 0); assert.equal(h.c.state.records[0].sync?.issue, "conflict");
});
test("failed durable finish cannot clear active timing or issue an upload", async () => {
  const h = harness(); await h.c.start(task, "a"); h.advance(); h.failDisk();
  await assert.rejects(h.c.finish(true), /disk full/); assert.ok(h.c.state.active); assert.equal(h.calls(), 0); assert.equal(h.completed(), 0);
});
test("pending manual edits return before network and their checkpoints preserve active timing", async () => {
  const h = harness(), hold = gate(); h.wait(hold.promise);
  const event: CalendarEvent = { uid: "schedule", title: "Future", type: "single", date: "2027-01-01", startTime: "10:00:00", endTime: "11:00:00", timezone: "UTC" };
  const op = await h.c.saveEvent({ uid: "schedule", fromCalendarId: "", toCalendarId: "a", before: event, after: event, stage: "prepared" });
  assert.equal(h.calls(), 0); const upload = h.c.sync(`event:${op.id}`); await until(() => h.calls() === 1);
  await h.c.start(task, "b"); h.advance(); await h.c.pause(); hold.resolve(); await upload;
  assert.equal(h.c.state.active?.task.id, task.id); assert.equal(h.c.state.active?.runningSince, null); assert.equal(h.c.state.operations[0].status, "saved");
});
test("in-flight optimistic DELETE absence cannot be mistaken for a confirmed external deletion", async () => {
  const h = harness(), r = await finished(h); await h.c.sync(`work:${r.id}`);
  const saved = clone(h.c.state.records[0]), part = saved.segments[0], hold = gate(); h.wait(hold.promise);
  const op = await h.c.deleteEvent({ uid: part.uid!, calendarId: "a", before: part.snapshot! }, part, saved);
  const deletion = h.c.sync(`delete:${op.id}`); await until(() => h.remote.size === 0);
  assert.equal(await h.c.reconcileDeletions(), 0); assert.equal(h.c.state.deletions![0].status, "pending");
  await assert.rejects(h.c.confirmRemoteDeletion(op.id), /正在同步/);
  await h.c.start({ ...task, id: "next" }, "b"); hold.resolve(); await deletion;
  assert.equal(h.c.state.records[0].segments.length, 0); assert.equal(h.c.state.active?.task.id, "next");
});
test("stopping a worker ignores late replies and preserves durable work for restart reconciliation", async t => {
  const h = harness(), r = await finished(h), hold = gate(); h.wait(hold.promise);
  const worker = new SyncWorker(h.c, { enabled: () => true, delayMs: 1, now: h.now }); worker.wake(); await until(() => h.calls() === 1);
  const before = h.durable(); worker.stop(); hold.resolve(); await until(() => worker.view.activeKey === null);
  assert.deepEqual(h.durable(), before); assert.equal(h.remote.size, 1); assert.equal(h.c.state.records[0].segments[0].saved, false);
  await assert.rejects(h.c.start(task, "a"), /停止/);
});
test("a replacement plugin instance waits for the old FCR request before retrying the same UID", async t => {
  const h = harness(), r = await finished(h), hold = gate(); h.wait(hold.promise);
  const channel = "test-reload-channel";
  const oldWorker = new SyncWorker(h.c, { channel, enabled: () => true, delayMs: 1, now: h.now }); oldWorker.wake(); await until(() => h.calls() === 1); oldWorker.stop();
  const restored = new TimerController({ state: h.durable(), background: true, persist: async () => {}, calendar: h.calendar, tasks: { complete: async () => {} } });
  const next = new SyncWorker(restored, { channel, enabled: () => true, delayMs: 1, now: h.now }); t.after(() => next.stop()); next.wake();
  await until(() => next.view.waiting); assert.equal(h.calls(), 1); await restored.start({ ...task, id: "new-task" }, "a");
  hold.resolve(); await until(() => restored.state.records[0].status === "saved"); assert.equal(h.remote.size, 1); assert.equal(restored.state.active?.task.id, "new-task");
});
test("same-object pending edits are rejected, preserving revision and UID", async () => {
  const h = harness(); const e: CalendarEvent = { uid: "one", type: "single", title: "A", date: "2027-01-01" };
  const step = { uid: "one", fromCalendarId: "", toCalendarId: "a", before: e, after: e, stage: "prepared" as const };
  await h.c.saveEvent(step); await assert.rejects(h.c.saveEvent({ ...step, after: { ...e, title: "B" } }), /待同步修改/);
  assert.equal(h.c.state.operations.length, 1); assert.equal(h.c.state.operations[0].sync?.revision, 0);
});
test("a replacement journal writer waits for pending writes and rejects stale instances", async () => {
  const root = path.resolve("../Results/Tests"); await mkdir(root, { recursive: true }); const dir = await mkdtemp(path.join(root, "writer-"));
  try {
    const file = path.join(dir, "session.json"), first = new JournalStore(file); await first.load(); await first.save(blankJournal());
    const second = new JournalStore(file); await second.load(); await assert.rejects(first.save(blankJournal()), /旧插件实例/); await second.save(blankJournal());
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test("local completion is idempotent after a crash, and refuses to overwrite edited task content", async () => {
  let text = taskLine(task.title, "", task.id, "a");
  const file = { path: "todo.md", extension: "md" }, app = { vault: { getAbstractFileByPath: () => file, process: async (_: unknown, fn: (s: string) => string) => { text = fn(text); } } };
  const tasks = new MarkdownTasks(app as any, () => "todo.md"); await tasks.completeLocal(task); const done = text; await tasks.completeLocal(task); assert.equal(text, done);
  text = taskLine("Externally edited", "", task.id, "a"); await assert.rejects(tasks.completeLocal(task), /其他位置修改/); assert.match(text, /Externally edited/);
});
test("sync metadata validates across schema v2 and error classes distinguish intervention", () => {
  const state = blankJournal() as any; state.operations.push({ id: "op", title: "", step: { uid: "u" }, status: "pending", sync: { revision: -1, attempt: 0, retryAt: 0 } });
  assert.throws(() => validateJournal(state), /同步进度/); assert.equal(classifySyncError("HTTP 503"), "network"); assert.equal(classifySyncError("HTTP 403"), "auth"); assert.equal(classifySyncError("HTTP 404"), "conflict");
});
