import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { DesktopStore } from "../Clients/Desktop/store";
import { DesktopService } from "../Clients/Desktop/service";
import { startServer } from "../Clients/Desktop/server";
import { reminderMetadata, withReminderMetadata, SCHEDULE_START, SCHEDULE_END } from "../Shared/scheduling";
import { elapsed } from "../Shared/time";
import { reminderRef } from "../Providers/Reminders/provider";
import type { DesktopCommand, DesktopMutation } from "../Clients/Desktop/protocol";
import type { Task } from "../Shared/contracts";
import { inspectExport } from "../Clients/Desktop/migration";
import { createHash } from "node:crypto";
import { uptime } from "node:os";
const cmd = (mutation: DesktopMutation): DesktopCommand => ({ ...mutation, version: 1, requestId: randomUUID() });
async function harness() {
  const root = await fs.mkdtemp(path.resolve("../Agents/Tests/desktop-")); const store = new DesktopStore(path.join(root, "state.json"));
  const task: Task = { id: "Reminder/task", title: "研究", path: "icloud:account", kind: "reminder", accountId: "account", listId: "list", completed: false, revision: "r1", due: "2026-12-31", description: "用户备注\n" };
  const source = { id: "cal", name: "科研", type: "caldav" as const, url: "https://example.test/cal/", username: "example", secretKey: "key" };
  await store.update({ settings: { ...store.data.settings, ownershipAcknowledged:true, defaultCalendarId: "cal", calendarSources: [source], metadataVerified: true, reminders: { enabled: true, accountId: "account", defaultListId: "list", calendarMap: { list: "cal" } } },
    calendar: { version: 1, sources: { cal: { resources: [], syncedAt: 1, authority: JSON.stringify([source.type, source.url, source.username]) } } },
    reminders: { ...store.data.reminders, accountId: "account", items: [task], lists: [{ id: "list", name: "科研" }] } });
  const rpc = { async call() { throw new Error("offline"); } }, secrets = { async get() { return "test"; }, async set() {} };
  const service = new DesktopService(store, rpc, secrets, async () => { throw new Error("offline"); }); await service.initialize(false);
  return { root, store, service, task, async close() { await service.close(); await fs.rm(root, { recursive: true, force: true }); } };
}
test("reminder app block preserves user prefix/suffix and rejects malformed or unknown data", () => {
  const block = withReminderMetadata("手写\r\n", { scheduledDate: "2026-11-08" }) + "\n末尾备注";
  const changed = withReminderMetadata(block, { scheduledDate: null });
  assert.ok(changed.startsWith("手写\r\n")); assert.ok(changed.endsWith("\n末尾备注"));
  assert.equal(reminderMetadata(changed).metadata.scheduledDate, null);
  assert.throws(() => reminderMetadata(block + SCHEDULE_START), /损坏/);
  assert.throws(() => reminderMetadata(SCHEDULE_START + '{"scheduledDate":"2026-02-30"}' + SCHEDULE_END), /无效/);
  assert.throws(() => reminderMetadata(SCHEDULE_START + '{"newField":1}' + SCHEDULE_END), /版本/);
});
test("a fresh installation opens without any configured cloud account", async () => {
  const root = await fs.mkdtemp(path.resolve("../Agents/Tests/desktop-empty-"));
  const service = new DesktopService(new DesktopStore(path.join(root, "state.json")), { async call() { throw new Error("must not call"); } }, { async get() { return null; }, async set() {} });
  try { await service.initialize(false); assert.equal(service.snapshot().active, null); assert.equal(service.snapshot().tasks.length, 0); }
  finally { await service.close(); await fs.rm(root, { recursive: true, force: true }); }
});
test("durable request receipt survives a lost response and application restart", async () => {
  const h = await harness();
  try {
    const request = cmd({ action: "timer.start", task: reminderRef(h.task) }); const result = await h.service.command(request);
    assert.ok(result.sessionId); assert.deepEqual(await h.service.command(request), result);
    await h.service.close();
    const recovered = new DesktopService(new DesktopStore(h.store.file), h.service.rpc, h.service.secrets, async () => { throw new Error("offline"); });
    await recovered.initialize(false);
    assert.deepEqual(await recovered.command(request), result); assert.equal(recovered.controller.state.active?.runningSince, null);
    assert.equal(recovered.controller.state.active?.id, result.sessionId); await recovered.close();
  } finally { await h.close(); }
});
test("one request id cannot be reused for another mutation; stale session cannot finish a newer one", async () => {
  const h = await harness(); try {
    const request = cmd({ action: "timer.start", task: reminderRef(h.task) }); const started = await h.service.command(request);
    await assert.rejects(h.service.command({ ...request, action: "shutdown" }), /不同指令/);
    await assert.rejects(h.service.command(cmd({ action: "timer.finish", sessionId: "stale" })), /变化/);
    assert.equal(h.service.snapshot().active?.id, started.sessionId);
  } finally { await h.close(); }
});
test("sleep passage counts, explicit pause does not, and finish is local before any network", async () => {
  const h = await harness(); try {
    const result = await h.service.command(cmd({ action: "timer.start", task: reminderRef(h.task) })); const session = h.service.controller.state.active!;
    const beforeSleep = elapsed(session, session.startedAt + 1000), afterSleep = elapsed(session, session.startedAt + 3601000);
    assert.equal(afterSleep - beforeSleep, 3600000);
    // Use an actual valid historic span without waiting for the wall clock.
    session.runningSince = session.startedAt = Date.now() - 5000;
    await h.service.command(cmd({ action: "timer.pause", sessionId: result.sessionId! })); const paused = h.service.snapshot().active!;
    assert.equal(elapsed(paused, Date.now() + 3600000), elapsed(paused));
    const finish = cmd({ action: "timer.finish", sessionId: result.sessionId!, completeTask: false });
    const record = await h.service.command(finish); assert.equal(record.pending, true); assert.equal(h.service.snapshot().active, null); assert.equal(h.store.data.journal.records.length, 1);
    await h.service.command(finish); assert.equal(h.store.data.journal.records.length, 1); assert.equal(h.store.data.journal.records[0].completeTask, false);
  } finally { await h.close(); }
});
test("scheduling changes only planned date, keeps due date and allows durable guarded undo", async () => {
  const h = await harness(); try {
    const scheduled = await h.service.command(cmd({ action: "task.schedule", task: h.task, date: "2026-11-08" }));
    let task = h.service.snapshot().tasks[0]; assert.equal(task.due, "2026-12-31"); assert.equal(task.scheduledDate, "2026-11-08"); assert.ok(task.description?.startsWith("用户备注\n"));
    assert.equal(h.store.data.journal.operations.length, 0); assert.equal(h.store.data.journal.records.length, 0);
    // Simulate a confirmed server revision before undoing, as native provider disallows two pending edits.
    const op = h.service.reminders.data.operations[0]; const data = { ...h.service.reminders.data, items: [{ ...task, pending: false, revision: "r2" }], operations: [{ ...op, confirmed: { ...task, pending: false, revision: "r2" }, status: "saved" as const }] };
    h.service.reminders.load(data); await h.store.update({ reminders: data });
    await h.service.command(cmd({ action: "undo", undoId: scheduled.undoId! })); task = h.service.snapshot().tasks[0];
    assert.equal(task.scheduledDate, null); assert.equal(task.due, "2026-12-31");
  } finally { await h.close(); }
});
test("unverified metadata and externally changed descriptions never overwrite a task", async () => {
  const h = await harness(); try {
    await h.store.update({ settings: { ...h.store.data.settings, metadataVerified: false } });
    await assert.rejects(h.service.command(cmd({ action: "task.schedule", task: h.task, date: "2026-11-08" })), /往返/);
    assert.equal(h.store.data.reminders.operations.length, 0);
    await h.store.update({ settings: { ...h.store.data.settings, metadataVerified: true } });
    await assert.rejects(h.service.command(cmd({ action: "task.schedule", task: { ...h.task, description: "旧备注" }, date: null })), /外部修改/);
    assert.equal(h.store.data.reminders.operations.length, 0);
  } finally { await h.close(); }
});
test("disk failure cannot publish a successful start or its receipt", async () => {
  const h = await harness(); try {
    const original = h.store.update.bind(h.store); h.store.update = async () => { throw new Error("disk full"); };
    const request = cmd({ action: "timer.start", task: reminderRef(h.task) });
    await assert.rejects(h.service.command(request), /disk full/); assert.equal(h.service.snapshot().active, null); assert.equal(h.store.data.receipts[request.requestId], undefined);
    h.store.update = original;
    await h.service.command(request); assert.ok(h.store.data.receipts[request.requestId]);
  } finally { await h.close(); }
});
test("loopback API rejects unauthenticated requests and browser origins; authenticated clients share state", async () => {
  const h = await harness(); const server = await startServer(h.service, path.join(h.root, "connection.json"));
  try {
    const url = `http://127.0.0.1:${server.discovery.port}/v1/state`, auth = { Authorization: "Bearer " + server.discovery.token };
    assert.equal((await fetch(url)).status, 403); assert.equal((await fetch(url, { headers: { ...auth, Origin: "https://example.test" } })).status, 403);
    assert.equal((await fetch(url, { headers: auth })).status, 200);
    await h.service.command(cmd({ action: "timer.start", task: reminderRef(h.task) }));
    const state = await (await fetch(url, { headers: auth })).json() as any; assert.equal(state.active.id, h.service.snapshot().active?.id);
  } finally { await server.close(); await h.close(); }
});
test("rapid offline arrangements and undo coalesce only operations durably marked never dispatched", async () => {
  const h = await harness(); try {
    const first = await h.service.command(cmd({ action: "task.schedule", task: h.task, date: "2026-11-08" }));
    await h.service.command(cmd({ action: "task.schedule", task: h.service.snapshot().tasks[0], date: "2026-11-09" }));
    assert.equal(h.store.data.reminders.operations.length, 1);
    const latestUndo = h.store.data.undo.at(-1)!;
    await h.service.command(cmd({ action: "undo", undoId: latestUndo.id })); assert.equal(h.service.snapshot().tasks[0].scheduledDate, "2026-11-08");
    // A failed remote request has a durable dispatch marker; do not change its fixed wire body.
    await h.service.reminders.sync("reminder:" + h.store.data.reminders.operations[0].id);
    assert.equal(h.store.data.reminders.operations[0].dispatched, true);
    await assert.rejects(h.service.command(cmd({ action: "undo", undoId: first.undoId! })), /待同步/);
  } finally { await h.close(); }
});
test("new reminder identity is SDK-compatible and deterministic across lost responses", async () => {
  const h = await harness(); try {
    const request = cmd({ action: "task.create", title: "新待办", listId: "list", due: "2026-12-31" });
    const result = await h.service.command(request); assert.equal(result.taskId, "Reminder/" + request.requestId.toUpperCase());
    await h.service.command(request); assert.equal(h.store.data.reminders.operations.length, 1);
  } finally { await h.close(); }
});
test("migration preview rejects live old writers, tampered private files, and changed handoff identity", async () => {
  const h = await harness(); try {
    const source = path.join(h.root, "source"), exported = path.join(h.root, "export"); await fs.mkdir(source); await fs.mkdir(exported);
    const item = { version: 1, id: randomUUID(), sourcePluginDir: source, stopped: true, data: { ...h.store.data, journal: { ...h.store.data.journal, active: null } }, hashes: { "wire.json": createHash("sha256").update("original").digest("hex") } };
    await fs.writeFile(path.join(exported, "wire.json"), "original"); await fs.writeFile(path.join(exported, "export.json"), JSON.stringify(item)); await fs.writeFile(path.join(source, "data.json"), "{}");
    await assert.rejects(inspectExport(exported), /尚未停止/);
    await fs.writeFile(path.join(source, "data.json"), JSON.stringify({ desktopConnection: true, desktopHandoffId: item.id }));
    assert.equal((await inspectExport(exported)).item.id, item.id);
    await fs.writeFile(path.join(exported, "wire.json"), "changed"); await assert.rejects(inspectExport(exported), /校验失败/);
    await fs.writeFile(path.join(source, "data.json"), JSON.stringify({ desktopConnection: true, desktopHandoffId: randomUUID() })); await assert.rejects(inspectExport(exported), /过期/);
  } finally { await h.close(); }
});
test("durable previous snapshot survives primary corruption and repair does not back up damaged bytes", async () => {
  const h = await harness(); try {
    await h.store.update({ settings: { ...h.store.data.settings, metadataVerified: false } });
    await h.store.update({ settings: { ...h.store.data.settings, metadataVerified: true } });
    await fs.writeFile(h.store.file, "damaged");
    const repaired = new DesktopStore(h.store.file); await repaired.load(); assert.equal(repaired.data.settings.metadataVerified, false);
    await repaired.update({ settings: { ...repaired.data.settings, metadataVerified: true } });
    const previous = JSON.parse(await fs.readFile(h.store.file + ".previous", "utf8")); assert.equal(previous.settings.metadataVerified, false);
    assert.ok((await fs.readdir(h.root)).some(file => file.includes("damaged-")));
  } finally { await h.close(); }
});
test("finishing a repeat occurrence clears only its plan date for the next cycle", async () => {
  const h = await harness(); try {
    const task: Task = { ...h.task, due: "2026-11-07", description: withReminderMetadata("手写备注", { scheduledDate: "2026-11-07" }), repeat: { frequency: "daily", interval: 1, zone: "Asia/Shanghai" } };
    h.service.reminders.load({ ...h.service.reminders.data, items: [task] });
    await h.service.reminders.update(task, { completed: true });
    const next = h.service.reminders.data.operations[0].cycle!.next;
    assert.equal(reminderMetadata(next.description).metadata.scheduledDate, null); assert.ok(next.description?.startsWith("手写备注\n")); assert.notEqual(next.due, task.due);
  } finally { await h.close(); }
});
test("benign resume clock notifications keep running, while wall-clock jumps pause safely",async()=>{
  const h=await harness();try{
    await h.service.command(cmd({action:"timer.start",task:reminderRef(h.task)}));
    (h.service as any).clockAnchor={wall:Date.now()-5000,uptime:uptime()*1000-5000};
    await h.service.systemClockChanged();assert.notEqual(h.service.snapshot().active?.runningSince,null);
    (h.service as any).clockAnchor={wall:Date.now()-10000,uptime:uptime()*1000-1000};
    await h.service.systemClockChanged();assert.equal(h.service.snapshot().active?.runningSince,null);assert.match(h.service.recovery,/时钟/);
  }finally{await h.close();}
});
test("a newly created offline task can be arranged and undone before its fixed creation request is dispatched",async()=>{
  const h=await harness();try{
    const created=await h.service.command(cmd({action:"task.create",title:"离线新任务",listId:"list"}));
    const task=h.service.snapshot().tasks.find(t=>t.id===created.taskId)!;
    const arranged=await h.service.command(cmd({action:"task.schedule",task,date:"2026-11-08"}));
    assert.equal(h.service.snapshot().tasks.find(t=>t.id===created.taskId)!.scheduledDate,"2026-11-08");
    await h.service.command(cmd({action:"undo",undoId:arranged.undoId!}));
    assert.equal(h.service.snapshot().tasks.find(t=>t.id===created.taskId)!.scheduledDate,null);
    assert.equal(h.service.reminders.data.operations.length,1);assert.equal(h.service.reminders.data.operations[0].action,"create");
  }finally{await h.close();}
});
test("unclaimed desktop hosts cannot time or write business data before handoff or explicit standalone setup",async()=>{
  const h=await harness();try{
    await h.store.update({settings:{...h.store.data.settings,ownershipAcknowledged:false}});
    await assert.rejects(h.service.command(cmd({action:"timer.start",task:reminderRef(h.task)})),/交接快照/);
    await assert.rejects(h.service.command(cmd({action:"task.create",title:"不得提交",listId:"list"})),/交接快照/);
    assert.equal(h.service.snapshot().active,null);assert.equal(h.service.reminders.data.operations.length,0);
    await h.service.command(cmd({action:"ownership.activate",stoppedOldWriters:true}));
    await h.service.command(cmd({action:"timer.start",task:reminderRef(h.task)}));assert.ok(h.service.snapshot().active);
  }finally{await h.close();}
});
test("calendar reauthorization preserves imported source identity and different principals remain separate",async()=>{
  const h=await harness();try{
    h.service.engine.dav.discover=async()=>[{url:"https://example.test/cal/",name:"云端名称",color:"#123456",components:["VEVENT"]}];
    await h.service.addCalendar({url:"https://example.test/",username:"example",password:"fixture"});
    assert.equal(h.store.data.settings.calendarSources.length,1);assert.equal(h.store.data.settings.calendarSources[0].id,"cal");
    await h.service.addCalendar({url:"https://example.test/",username:"another-principal",password:"fixture"});
    assert.equal(h.store.data.settings.calendarSources.length,2);assert.notEqual(h.store.data.settings.calendarSources[0].id,h.store.data.settings.calendarSources[1].id);
  }finally{await h.close();}
});
