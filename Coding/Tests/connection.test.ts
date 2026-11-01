import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { FcrBridge, type FcrApi } from "../Providers/Fcr/bridge";
import { TimerController, blankJournal } from "../Shared/timer";

function connection(saved: string | null = null) {
  let token = saved, requests = 0, refreshes = 0, opens = 0;
  let accepted = saved, approved: string | null = "new-grant";
  let scoped: FcrApi = {
    getCalendarSources: () => [], getProviderCapabilities: () => ({}), getAllEvents: () => [], getEvents: () => [],
    createEvent: async () => true, updateEvent: async () => true, deleteEvent: async () => {},
    revalidateRemoteCalendars: () => { refreshes++; }, openCalendar: async () => { opens++; }
  };
  const api = {
    withToken: (value: string) => value === accepted ? scoped : null,
    requestAccess: async (id: string, _reason: string, scopes: string[]) => {
      assert.equal(id, "calendar-task-timer"); assert.deepEqual(scopes, ["events:read", "events:write", "providers:read", "providers:write", "ui:open-calendar"]);
      requests++; accepted = approved; return approved;
    }
  };
  const host = { plugins: { getPlugin: () => ({ api }) } };
  const bridge = new FcrBridge(host, () => token, async value => { token = value; });
  return { bridge, api, host, requests: () => requests, refreshes: () => refreshes, opens: () => opens, token: () => token,
    revoke() { accepted = null; }, cancel() { approved = null; }, scoped(value: FcrApi) { scoped = value; }, getScoped: () => scoped };
}

test("silent startup without a token never opens authorization", async () => {
  const h = connection(); await assert.rejects(h.bridge.connect(), /尚未获得 FCR 授权/);
  assert.equal(h.requests(), 0); assert.equal(h.bridge.connected, false);
});
test("explicit connection obtains and saves the scoped grant", async () => {
  const h = connection(); await h.bridge.connect(true); assert.equal(h.requests(), 1); assert.equal(h.token(), "new-grant"); assert.equal(h.bridge.connected, true);
  await h.bridge.connect(true); assert.equal(h.requests(), 1);
});
test("revoked authorization is replaced on the next explicit connection", async () => {
  const h = connection("old"); await h.bridge.connect(); h.revoke();
  await h.bridge.connect(true); assert.equal(h.requests(), 1); assert.equal(h.bridge.connected, true);
});
test("missing read scope resets connected state and allows reauthorization", async () => {
  const h = connection("old"), working = h.getScoped(); await h.bridge.connect();
  h.scoped({ ...working, getAllEvents: () => { throw new Error("Missing required scope: events:read"); } });
  await assert.rejects(h.bridge.connect(), /重新授权/); assert.equal(h.bridge.connected, false);
  h.api.requestAccess = async () => { h.scoped(working); return "old"; };
  await h.bridge.connect(true); assert.equal(h.bridge.connected, true);
});
test("canceling authorization does not refresh, open a calendar, or claim a connection", async () => {
  const h = connection(); h.cancel(); await assert.rejects(h.bridge.connect(true), /未完成 FCR 授权/);
  assert.equal(h.bridge.connected, false); assert.equal(h.refreshes(), 0); assert.equal(h.opens(), 0); assert.equal(h.token(), null);
});
test("token persistence failure never publishes an unpersisted connection", async () => {
  const h = connection(), bridge = new FcrBridge(h.host, () => null, async () => { throw new Error("secret storage failed"); });
  await assert.rejects(bridge.connect(true), /secret storage failed/); assert.equal(bridge.connected, false);
});
test("overlapping startup and toolbar requests share one authorization prompt", async () => {
  const h = connection(); let release!: (value: string | null) => void;
  const token = new Promise<string | null>(resolve => { release = resolve; });
  const bridge = new FcrBridge(h.host, () => token, async () => {});
  const startup = assert.rejects(bridge.connect(), /尚未获得/);
  const first = bridge.connect(true), second = bridge.connect(true); release(null);
  await Promise.all([startup, first, second]); assert.equal(h.requests(), 1); assert.equal(bridge.connected, true);
});

// Exercise the real Obsidian toolbar wiring with only the host classes mocked.
const loader = Module as any, originalLoad = loader._load;
loader._load = function(id: string, ...args: any[]) {
  if (id === "obsidian") return { Plugin: class {}, ItemView: class {}, PluginSettingTab: class {}, Modal: class {}, Notice: class {}, MarkdownRenderChild: class {}, Component: class {} };
  return originalLoad.call(this, id, ...args);
};
let PluginClass: any;
try { PluginClass = require("../Clients/Obsidian/plugin").default; } finally { loader._load = originalLoad; }
function pluginHarness(h: ReturnType<typeof connection>) {
  const p = new PluginClass(); p.bridge = h.bridge; p.calendarQuery = h.bridge; p.render = () => {}; p.refresh = async () => {}; p.later = () => {};
  return p;
}
test("calendar query rejects incomplete provider cache and preserves the last valid host snapshot", async () => {
  const h = connection("old"), p = pluginHarness(h); await h.bridge.connect();
  h.scoped({...h.getScoped(),getCalendarSources:()=>[{id:"research",name:"科研",type:"caldav"}],getAllEvents:()=>[{id:"research",events:[]}]});
  await h.bridge.connect();
  p.readCalendarView(); const valid=p.calendarView; assert.equal(valid.sources.length,1); assert.equal(valid.error,"");
  h.scoped({...h.getScoped(),getAllEvents:()=>[]}); await h.bridge.connect();
  p.readCalendarView(); assert.deepEqual(p.calendarView.sources,valid.sources); assert.match(p.calendarView.error,/缓存尚未就绪/);
  Object.assign(h.getScoped(),{getAllEvents:()=>{throw Error("remote unavailable");}});
  p.readCalendarView(); assert.deepEqual(p.calendarView.sources,valid.sources); assert.match(p.calendarView.error,/remote unavailable/);
});
async function settled(p: any) { for (let i = 0; i < 30 && p.busy; i++) await new Promise(resolve => setImmediate(resolve)); assert.equal(p.busy, false); }

test("toolbar refresh authorizes a disconnected plugin before calling FCR refresh", async () => {
  const h = connection(), p = pluginHarness(h); p.actions().refresh(); await settled(p);
  assert.equal(h.requests(), 1); assert.equal(h.refreshes(), 1); assert.equal(p.connected, true); assert.equal(p.error, "");
});
test("toolbar full calendar reconnects after a saved grant was revoked", async () => {
  const h = connection("old"), p = pluginHarness(h); await h.bridge.connect(); h.revoke();
  p.actions().openCalendar(); await settled(p); assert.equal(h.requests(), 1); assert.equal(h.opens(), 1); assert.equal(p.connected, true);
});
test("canceling toolbar authorization preserves disconnected state and a useful error", async () => {
  const h = connection(), p = pluginHarness(h); h.cancel(); p.actions().refresh(); await settled(p);
  assert.equal(h.refreshes(), 0); assert.equal(p.connected, false); assert.match(p.error, /未完成 FCR 授权/);
});
test("local timer start and repeated rendering reuse the FCR snapshot without event scans or writes", async () => {
  const h = connection("old"), p = pluginHarness(h); await h.bridge.connect();
  const api = h.getScoped(); let scans = 0, writes = 0;
  api.getCalendarSources = () => [{ id: "research", name: "科研", type: "caldav" }]; api.getProviderCapabilities = () => ({ canCreate: true });
  api.getAllEvents = () => { scans++; return []; }; api.getEvents = () => { scans++; return []; };
  api.createEvent = async () => { writes++; return true; };
  const task = { id: "task", title: "Local", completed: false, kind: "local" as const, path: "tasks.md", calendarId: "research" };
  p.app = { plugins: { getPlugin: () => null } }; p.items = [task];
  p.controller = new TimerController({ state: blankJournal(), calendar: h.bridge, persist: async () => {}, tasks: { complete: async () => {} }, onChange: () => { p.model(); } });
  p.render = () => { p.model(); }; p.readCalendarView(); scans = 0;
  p.refresh = async () => { throw new Error("start must not perform a full refresh"); };
  p.tasks = { resolve: async () => ({ ...task }) }; p.initializeApi();
  p.actions().start(task); await new Promise(resolve => setImmediate(resolve)); await settled(p); for (let i = 0; i < 5; i++) p.model();
  assert.equal(p.error, ""); assert.equal(p.controller.state.active?.title, "Local"); assert.equal(scans, 0); assert.equal(writes, 0);
});

test("native card entry starts its configured task through the same host API without opening another view", async () => {
  const h = connection("old"), p = pluginHarness(h); await h.bridge.connect();
  h.getScoped().getCalendarSources = () => [{ id: "research", name: "科研", type: "caldav" }];
  h.getScoped().getProviderCapabilities = () => ({ canCreate: true });
  const task = { id: "task", path: "tasks.md", title: "Existing", kind: "local" as const, completed: false, calendarId: "research" };
  p.app = { vault: { getAbstractFileByPath: (path: string) => ({ path, extension: "md" }) }, plugins: { getPlugin: () => null } };
  p.tasks = { resolve: async () => ({ ...task }) };
  p.settings.componentTaskBindings = { "research.md": { kind: "local", path: "tasks.md", id: "task" } };
  p.controller = new TimerController({ background: true, calendar: h.bridge, persist: async () => {}, tasks: { complete: async () => {} } });
  p.initializeApi(); p.openView = () => { throw new Error("must stay on Home"); };
  const a = await p.startFromNote("research.md"), b = await p.startFromNote("research.md");
  assert.ok(a.ok && b.ok); assert.equal(a.sessionId, b.sessionId); assert.equal(p.controller.state.active?.task.id, "task");
});
test("cancelling a native button task choice starts no timer and raises no error", async () => {
  const p = pluginHarness(connection()); p.app = { vault: { getAbstractFileByPath: () => ({ extension: "md" }) } };
  p.configureNoteTask = async () => null;
  const result = await p.startFromNote("research.md"); assert.equal(result.code, "cancelled"); assert.equal(p.error, "");
});

test("rapid native toggle invocations share one flight instead of starting then immediately ending", async () => {
  const p = pluginHarness(connection()), task = { id: "one", path: "tasks.md", kind: "local", completed: false, title: "One" };
  p.settings.componentTaskBindings = { "research.md": { kind: "local", path: "tasks.md", id: "one" } };
  let starts = 0, finishes = 0;
  p.api = { getState: () => ({ available: true, active: null, tasks: [task], pending: 0 }), finish: () => { finishes++; } };
  p.startFromNote = async () => { starts++; return { ok: true, sessionId: "first" }; };
  const results = await Promise.all([p.toggleFromNote("research.md"), p.toggleFromNote("research.md")]);
  assert.equal(starts, 1); assert.equal(finishes, 0); assert.equal(results[0].sessionId, results[1].sessionId);
});
