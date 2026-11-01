import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { componentTaskBindings, nativeTimerLabels } from "../Clients/Obsidian/components";

const source = readFileSync("Clients/Obsidian/CalendarTaskTimerStart.js", "utf8");
test("native Components button uses its own card file even while Home is active", async () => {
  const calls: unknown[] = [], module = { exports: {} as any };
  vm.runInNewContext(source, { module, app: { workspace: { getActiveFile: () => ({ path: "Home.components" }) }, plugins: {
    getPlugin: () => ({ startFromNote: async (...args: unknown[]) => { calls.push(args); return { ok: true, sessionId: "one" }; } })
  } }, obsidian: { Notice: class {} } });
  assert.equal(module.exports.scopes[0], "button");
  const result = await module.exports.entry.call({ currentFile: { path: "research.md" } });
  await module.exports.entry.call({ currentFile: { path: "reading.md" } }, true);
  assert.equal(result.sessionId, "one"); assert.deepEqual(calls, [["research.md", false], ["reading.md", true]]);
});
test("native adapter reports an unloaded or old timer plugin without a hidden fallback timer", async () => {
  let notices = 0; const module = { exports: {} as any };
  vm.runInNewContext(source, { module, app: { plugins: { getPlugin: () => null } }, obsidian: { Notice: class { constructor() { notices++; } } } });
  const result = await module.exports.entry.call({ currentFile: { path: "research.md" } });
  assert.equal(result.ok, false); assert.equal(result.code, "unavailable"); assert.equal(notices, 1);
});
test("Components bindings persist exact task references and reject title-only or malformed mappings", () => {
  const value = componentTaskBindings({ "a.md": { kind: "local", path: "tasks.md", id: "one", title: "ignored" },
    "b.md": { title: "same title", line: 3 }, "Home.components": { kind: "local", path: "tasks.md", id: "two" }, "c.md": null });
  assert.deepEqual(value, { "a.md": { kind: "local", path: "tasks.md", id: "one" } });
  assert.deepEqual(componentTaskBindings(null), {}); assert.deepEqual(componentTaskBindings([]), {});
});

test("native toggle script delegates to the newer host toggle without a second timer", async () => {
  const calls: unknown[] = [], module = { exports: {} as any };
  vm.runInNewContext(source, { module, app: { plugins: { getPlugin: () => ({ startFromNote: () => { throw new Error("wrong entry"); },
    toggleFromNote: async (...args: unknown[]) => { calls.push(args); return { ok: true }; } }) } }, obsidian: { Notice: class {} } });
  await module.exports.entry.call({ currentFile: { path: "research.md" } });
  assert.deepEqual(calls, [["research.md", false]]);
});
test("native decoration targets only unambiguous default timer actions, including aliases", () => {
  const property = (name: string, expression: string, alias?: string) => ({ type: "button", name, alias, options: { action: { type: "runScript", expression } } });
  assert.deepEqual([...nativeTimerLabels({ components: [{ properties: [property("开始", " CalendarTaskTimerStart( ); ", "课题计时"), property("选择", "CalendarTaskTimerStart(true)")] }] })], ["课题计时"]);
  assert.equal(nativeTimerLabels({ components: [{ properties: [property("开始", "CalendarTaskTimerStart()"), property("开始", "OtherAction()")] }] }).size, 0);
  assert.equal(nativeTimerLabels(null).size, 0);
});
