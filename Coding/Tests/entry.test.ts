import test from "node:test";
import assert from "node:assert/strict";
import { TimerApi, taskRef } from "../Clients/Obsidian/api";
import { MarkdownTasks } from "../Clients/Obsidian/tasks";
import { TimerController } from "../Shared/timer";
import { clone, type Task, type CalendarPort } from "../Shared/contracts";
import { elapsed } from "../Shared/time";
import { toggleNoteTimer } from "../Clients/Obsidian/components";

function harness() {
  let now = Date.parse("2026-10-31T01:00:00Z"), enabled = true, writes = 0, completions = 0;
  const tasks: Task[] = ["a", "b"].map(id => ({ id, title: id, kind: "local", path: "tasks.md", calendarId: "research", completed: false }));
  const calendar: CalendarPort = {
    assertWritable: id => { if (!enabled || id !== "research") throw new Error("分类已失效"); },
    ensureEvent: async (_id, e) => { writes++; return e; }, readByUid: () => undefined,
    reconcileStep: async () => {}, deleteEvent: async () => {}
  };
  let api: TimerApi;
  const controller = new TimerController({ background: true, now: () => now, persist: async () => {}, calendar,
    tasks: { complete: async t => { tasks.find(x => x.id === t.id)!.completed = true; completions++; } }, onChange: () => api?.notify() });
  api = new TimerApi({ controller, execute: fn => fn(),
    resolve: async ref => { const t = tasks.find(t => t.id === ref.id && t.path === ref.path); if (!t) throw new Error("任务已移动"); return clone(t); },
    prepare: async t => { calendar.assertWritable(t.calendarId!); return t; }, refresh: async () => {},
    state: () => ({ available: true, active: controller.state.active, tasks, pending: controller.jobs().length }) });
  return { api, controller, tasks, advance: (ms: number) => { now += ms; }, disable: () => { enabled = false; }, counts: () => ({ writes, completions }) };
}
test("concurrent repeated starts return the same durable session without creating tasks", async () => {
  const h = harness(), ref = taskRef(h.tasks[0]);
  const results = await Promise.all([h.api.start(ref), h.api.start(ref), h.api.start(ref)]);
  assert.ok(results.every(r => r.ok)); assert.equal(new Set(results.map(r => r.ok && r.sessionId)).size, 1);
  assert.equal(h.tasks.length, 2); assert.equal(h.controller.state.records.length, 0);
});
test("start rereads the ID and category, rejects completed, moved and unavailable tasks", async () => {
  const h = harness(), ref = taskRef(h.tasks[0]); h.tasks[0].title = "改名后的任务";
  assert.ok((await h.api.start(ref)).ok); assert.equal(h.controller.state.active!.title, "改名后的任务");
  h.advance(2000); await h.api.finish(h.controller.state.active!.id);
  h.tasks[0].completed = true; assert.equal((await h.api.start(ref)).ok, false);
  h.tasks[0].completed = false; h.tasks[0].path = "moved.md"; assert.equal((await h.api.start(ref)).ok, false);
  h.tasks[0].path = "tasks.md"; h.disable(); assert.equal((await h.api.start(ref)).ok, false);
});
test("another task requires an explicit finish, leaving the active session intact", async () => {
  const h = harness(); await h.api.start(taskRef(h.tasks[0])); const id = h.controller.state.active!.id;
  const r = await h.api.start(taskRef(h.tasks[1])); assert.ok(!r.ok && r.code === "active-session" && r.sessionId === id);
  assert.equal(h.controller.state.active!.task.id, "a");
});
test("pause excludes gaps; record-only ends once and never completes the original task", async () => {
  const h = harness(); await h.api.start(taskRef(h.tasks[0])); const id = h.controller.state.active!.id;
  h.advance(2000); await h.api.pause(id); h.advance(60000); await h.api.resume(id); h.advance(3000);
  const results = await Promise.all([h.api.finish(id), h.api.finish(id)]);
  assert.equal(results.filter(r => r.ok).length, 1); assert.equal(h.controller.state.records.length, 1);
  assert.equal(elapsed(h.controller.state.records[0]), 5000); assert.equal(h.tasks[0].completed, false);
  await h.controller.sync(`work:${id}`); assert.deepEqual(h.counts(), { writes: 2, completions: 0 });
});
test("explicit finish-and-complete affects the same original task once", async () => {
  const h = harness(); await h.api.start(taskRef(h.tasks[0])); const id = h.controller.state.active!.id; h.advance(2000);
  const r = await h.api.finish(id, true); assert.ok(r.ok && r.recordId === id && r.pending);
  await h.controller.sync(`work:${id}`); await h.controller.sync(`work:${id}`);
  assert.equal(h.tasks[0].completed, true); assert.equal(h.tasks[1].completed, false);
  assert.deepEqual(h.counts(), { writes: 1, completions: 1 });
});
test("stale API pause, resume and finish cannot control a new session", async () => {
  const h = harness(); await h.api.start(taskRef(h.tasks[0])); const old = h.controller.state.active!.id; h.advance(2000); await h.api.finish(old);
  await h.api.start(taskRef(h.tasks[1])); const id = h.controller.state.active!.id;
  for (const result of [await h.api.pause(old), await h.api.resume(old), await h.api.finish(old, true)]) assert.ok(!result.ok && result.code === "stale-session");
  assert.equal(h.controller.state.active!.id, id); assert.equal(h.controller.state.records.length, 1);
});
test("controller validates the expected session inside its mutation lock", async () => {
  const h = harness(); await h.controller.start(h.tasks[0], "research"); const old = h.controller.state.active!.id;
  h.advance(2000); const ending = h.controller.finish(false, old), starting = h.controller.start(h.tasks[1], "research"), stale = h.controller.pause(old);
  await ending; await starting; await assert.rejects(stale, /已变化/);
  await assert.rejects(h.controller.resume(old), /已变化/); await assert.rejects(h.controller.finish(true, old), /已变化/);
  assert.equal(h.controller.state.active!.task.id, "b");
});
test("subscriber snapshots are isolated, broken consumers do not block persistence, unsubscribe and dispose release consumers", async () => {
  const h = harness(); let calls = 0;
  const unsubscribe = h.api.subscribe(s => { calls++; if (s.active) s.active.title = "修改外部快照"; });
  h.api.subscribe(() => { throw new Error("bad renderer"); });
  await h.api.start(taskRef(h.tasks[0])); assert.equal(h.controller.state.active!.title, "a");
  unsubscribe(); const before = calls; await h.api.pause(h.controller.state.active!.id); assert.equal(calls, before);
  let unload = 0; h.api.subscribe(s => { if (!s.available) unload++; }); h.api.dispose(); h.api.notify(); assert.equal(unload, 1);
  assert.equal((await h.api.finish(h.controller.state.active!.id)).ok, false);
});
test("slow background upload does not hold the entry or timer mutation locks", async () => {
  const h = harness(); let release!: () => void, entered!: () => void;
  const started = new Promise<void>(r => { entered = r; }), blocked = new Promise<void>(r => { release = r; });
  const deps = (h.controller as any).deps;
  deps.calendar.ensureEvent = async (_id: string, event: unknown) => { entered(); await blocked; return event; };
  await h.api.start(taskRef(h.tasks[0])); const old = h.controller.state.active!.id; h.advance(2000); await h.api.finish(old);
  const upload = h.controller.sync(`work:${old}`); await started;
  assert.ok((await h.api.start(taskRef(h.tasks[1]))).ok); assert.ok((await h.api.pause(h.controller.state.active!.id)).ok);
  release(); await upload; assert.equal(h.controller.state.active!.task.id, "b");
});
test("restored journal keeps task identity and recovers a running timer as paused", async () => {
  const h = harness(); await h.api.start(taskRef(h.tasks[0])); h.advance(15000); await h.controller.heartbeat();
  const state = clone(h.controller.state), id = state.active!.id;
  const restored = new TimerController({ state, background: true, persist: async () => {}, calendar: (h.controller as any).deps.calendar, tasks: { complete: async () => {} } });
  await restored.recover(); assert.equal(restored.state.active!.id, id); assert.equal(restored.state.active!.runningSince, null);
  assert.equal(restored.state.active!.task.path, "tasks.md"); assert.equal(elapsed(restored.state.active), 15000);
});
test("Markdown resolver is read-only and refuses wrong paths and ambiguous IDs", async () => {
  let text = "- [ ] first <!-- simple-task:a -->\n", changes = 0;
  const file = { path: "tasks.md", extension: "md" };
  const tasks = new MarkdownTasks({ vault: { getAbstractFileByPath: () => file, read: async () => text, process: () => { changes++; } } } as any, () => "tasks.md");
  assert.equal((await tasks.resolve({ kind: "local", path: "tasks.md", id: "a" })).title, "first");
  await assert.rejects(tasks.resolve({ kind: "local", path: "other.md", id: "a" }));
  text += "- [ ] duplicate <!-- simple-task:a -->\n"; await assert.rejects(tasks.resolve({ kind: "local", path: "tasks.md", id: "a" })); assert.equal(changes, 0);
});

test("single native button starts then finishes the same task without completing it", async () => {
  const h = harness(), host = { state: () => h.api.getState(), binding: () => taskRef(h.tasks[0]),
    start: () => h.api.start(taskRef(h.tasks[0])), finish: (id: string) => h.api.finish(id, false) };
  await toggleNoteTimer("research.md", null, host); const id = h.controller.state.active!.id;
  h.advance(2000); await toggleNoteTimer("research.md", id, host);
  assert.equal(h.controller.state.active, null); assert.equal(h.controller.state.records.length, 1);
  assert.equal(h.controller.state.records[0].id, id); assert.equal(h.tasks[0].completed, false);
});
test("an idle native snapshot cannot finish a session that just started elsewhere", async () => {
  const h = harness(); await h.api.start(taskRef(h.tasks[0])); const id = h.controller.state.active!.id;
  const result = await toggleNoteTimer("research.md", null, { state: () => h.api.getState(), binding: () => taskRef(h.tasks[0]),
    start: () => h.api.start(taskRef(h.tasks[0])), finish: () => { throw new Error("must not finish"); } });
  assert.ok(result.ok); assert.equal(h.controller.state.active!.id, id); assert.equal(h.controller.state.records.length, 0);
});
test("a stale native snapshot or changed note binding never ends a newer or different task", async () => {
  const h = harness(); await h.api.start(taskRef(h.tasks[0])); const old = h.controller.state.active!.id; h.advance(2000); await h.api.finish(old);
  await h.api.start(taskRef(h.tasks[0])); const current = h.controller.state.active!.id;
  const host = { state: () => h.api.getState(), binding: () => taskRef(h.tasks[0]), start: () => h.api.start(taskRef(h.tasks[0])), finish: (id: string) => h.api.finish(id, false) };
  assert.equal((await toggleNoteTimer("research.md", old, host)).ok, false);
  assert.equal((await toggleNoteTimer("research.md", current, { ...host, binding: () => taskRef(h.tasks[1]) })).ok, false);
  assert.equal(h.controller.state.active!.id, current); assert.equal(h.controller.state.records.length, 1);
});
