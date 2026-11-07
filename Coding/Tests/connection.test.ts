import test from "node:test";
import assert from "node:assert/strict";
import Module from "node:module";
import { FcrBridge, type FcrApi } from "../Providers/Fcr/bridge";
import { TimerController, blankJournal } from "../Shared/timer";
import { MarkdownTasks, taskLine, parseTasks, setTaskCompletionText, parseCompletions } from "../Clients/Obsidian/tasks";

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
  p.app = { vault: { getAbstractFileByPath: (path: string) => ({ path, name: path, extension: "md" }) }, plugins: { getPlugin: () => null } };
  p.tasks = { resolve: async () => ({ ...task }), restoreBound: async () => ({...task}), list:async()=>[task],completions:async()=>[] };
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
test("real card entry reopens completed tasks, recreates deleted bindings and rejects a competing session",async()=>{
  const h=connection("old"),p=pluginHarness(h);await h.bridge.connect();
  h.getScoped().getCalendarSources=()=>[{id:"research",name:"科研",type:"caldav"}];h.getScoped().getProviderCapabilities=()=>({canCreate:true});
  let text=taskLine("Original","","task","research"),now=Date.now();text=setTaskCompletionText(text,parseTasks(text,"tasks.md")[0],true,now,()=>"done");
  const file={path:"tasks.md",name:"tasks.md",extension:"md"};p.app={vault:{getAbstractFileByPath:(path:string)=>({...file,path,name:path}),read:async()=>text,process:async(_file:unknown,fn:(text:string)=>string)=>{text=fn(text);}},plugins:{getPlugin:()=>null}};
  p.settings.tasksPath="tasks.md";p.settings.defaultCalendarId="research";p.settings.componentTaskBindings={"research.md":{kind:"local",path:"tasks.md",id:"task"}};p.settings.componentTaskSnapshots={"research.md":{title:"Original",calendarId:"research",due:""}};
  p.tasks=new MarkdownTasks(p.app,()=>"tasks.md");p.controller=new TimerController({background:true,calendar:h.bridge,persist:async()=>{},tasks:{complete:async()=>{}},now:()=>now});p.initializeApi();
  assert.equal((await p.startFromNote("research.md")).ok,true);assert.equal(parseTasks(text,"tasks.md")[0].completed,false);assert.equal(parseCompletions(text).length,1);
  await assert.rejects(p.removeTask(parseTasks(text,"tasks.md")[0]),/先结束/);assert.equal(parseTasks(text,"tasks.md").length,1);
  now+=1000;await p.controller.finish(false);await p.tasks.remove(parseTasks(text,"tasks.md")[0]);
  assert.equal((await p.startFromNote("research.md")).ok,true);assert.equal(parseTasks(text,"tasks.md")[0].id,"task");assert.equal(parseTasks(text,"tasks.md")[0].title,"Original");assert.equal(parseCompletions(text).length,1);
  now+=1000;await p.controller.finish(false);await p.tasks.remove(parseTasks(text,"tasks.md")[0]);await p.controller.start({id:"other",path:"tasks.md",kind:"local",title:"Other",completed:false,calendarId:"research"},"research");
  assert.equal((await p.startFromNote("research.md")).ok,false);assert.equal(parseTasks(text,"tasks.md").length,0);
  now+=1000;await p.controller.finish(false);p.controller.state.records[0].completeTask=true;p.controller.state.records[0].taskSaved=false;
  const pending=await p.startFromNote("research.md");assert.equal(pending.ok,false);assert.match(pending.message,/完成状态待确认/);assert.equal(parseTasks(text,"tasks.md").length,0);
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
async function noteCreationHarness() {
  const h=connection("old"),p=pluginHarness(h);await h.bridge.connect();
  h.getScoped().getCalendarSources=()=>[{id:"research",name:"科研",type:"caldav"},{id:"work",name:"工作",type:"caldav"}];h.getScoped().getProviderCapabilities=()=>({canCreate:true});
  let text="",now=Date.now(),failWrite=false;const files=new Map<string,any>();
  const file=(path:string)=>{if(!files.has(path))files.set(path,{path,name:path.split("/").at(-1),extension:"md"});return files.get(path);};
  p.app={vault:{getAbstractFileByPath:file,read:async()=>text,process:async(_file:unknown,fn:(text:string)=>string)=>{if(failWrite){failWrite=false;throw Error("write failed");}text=fn(text);}},plugins:{getPlugin:()=>null}};
  p.settings.tasksPath="tasks.md";p.settings.defaultCalendarId="research";p.tasks=new MarkdownTasks(p.app,()=>"tasks.md");p.saveSettings=async()=>{};
  p.controller=new TimerController({background:true,calendar:h.bridge,persist:async()=>{},tasks:{complete:async()=>{}},now:()=>now});p.initializeApi();
  return {p,text:()=>text,advance:()=>{now+=2000;},failWrite:()=>{failWrite=true;}};
}
test("unbound cards create from the note title, preselect the default category and share repeated clicks",async()=>{
  const h=await noteCreationHarness(),p=h.p,calls:any[]=[];
  p.chooseNoteCategory=async(...args:any[])=>{calls.push(args);return "work";};
  const [a,b]=await Promise.all([p.startFromNote("课题/端边云平台.md"),p.startFromNote("课题/端边云平台.md")]);
  assert.equal(a.ok,true);assert.equal(b.sessionId,a.sessionId);assert.equal(calls.length,1);assert.equal(calls[0][0],"端边云平台");assert.equal(calls[0][2],"research");
  const tasks=parseTasks(h.text(),"tasks.md");assert.equal(tasks.length,1);assert.equal(tasks[0].title,"端边云平台");assert.equal(tasks[0].calendarId,"work");assert.equal(p.settings.componentTaskBindings["课题/端边云平台.md"].id,tasks[0].id);
});
test("cancel and failed binding persistence create no task; an active session opens no category picker",async()=>{
  const h=await noteCreationHarness(),p=h.p;let prompts=0;p.chooseNoteCategory=async()=>{prompts++;return null;};
  assert.equal((await p.startFromNote("取消.md")).code,"cancelled");assert.equal(h.text(),"");assert.equal(p.controller.state.active,null);
  p.chooseNoteCategory=async()=>"research";p.saveSettings=async()=>{throw Error("save failed");};
  const failed=await p.startFromNote("保存失败.md");assert.equal(failed.ok,false);assert.match(failed.message,/save failed/);assert.equal(h.text(),"");assert.equal(p.settings.componentTaskBindings["保存失败.md"],undefined);
  p.saveSettings=async()=>{};await p.controller.start({id:"active",title:"Active",kind:"local",path:"tasks.md",completed:false,calendarId:"research"},"research");
  p.chooseNoteCategory=async()=>{prompts++;return "work";};assert.equal((await p.startFromNote("其他课题.md")).ok,false);assert.equal(prompts,1);assert.equal(h.text(),"");
});
test("a failed task write retains its durable note identity so retry creates no duplicate",async()=>{
  const h=await noteCreationHarness(),p=h.p;let prompts=0;p.chooseNoteCategory=async()=>{prompts++;return "research";};h.failWrite();
  assert.equal((await p.startFromNote("端边云平台.md")).ok,false);const ref=p.settings.componentTaskBindings["端边云平台.md"];assert.ok(ref.id);assert.equal(h.text(),"");
  assert.equal((await p.startFromNote("端边云平台.md")).ok,true);assert.equal(prompts,1);const tasks=parseTasks(h.text(),"tasks.md");assert.equal(tasks.length,1);assert.equal(tasks[0].id,ref.id);
});


test("opening the timer waits for layout restoration and reuses its saved leaf", async () => {
  const p = new PluginClass(); let ready!:()=>void; const revealed:any[]=[]; let restored=false;
  const saved={id:"saved-right-tab"};
  p.app={workspace:{onLayoutReady:(cb:()=>void)=>{ready=cb;},getLeavesOfType:()=>{assert.ok(restored);return [saved];},getRightLeaf:()=>{throw Error("must reuse saved view");},revealLeaf:async(leaf:any)=>{revealed.push(leaf);}}};
  const opening=p.openView();assert.deepEqual(revealed,[]);restored=true;ready();await opening;assert.deepEqual(revealed,[saved]);
});
test("a missing timer opens in the existing right tab group and repeated opens reuse it", async () => {
  const p = new PluginClass(); const leaves:any[]=[]; const splits:boolean[]=[]; const revealed:any[]=[];
  const leaf={setViewState:async(state:any)=>{assert.equal(state.type,"calendar-task-timer-view");leaves.push(leaf);}};
  p.app={workspace:{onLayoutReady:(cb:()=>void)=>cb(),getLeavesOfType:()=>leaves,getRightLeaf:(split:boolean)=>{splits.push(split);return leaf;},getLeaf:()=>{throw Error("must not create a main tab");},revealLeaf:async(l:any)=>{revealed.push(l);}}};
  await p.openView();await p.openView();assert.deepEqual(splits,[false]);assert.deepEqual(revealed,[leaf,leaf]);assert.equal(leaves.length,1);
});
test("unavailable right sidebar never falls back to the main editor", async () => {
  const p=new PluginClass();p.app={workspace:{onLayoutReady:(cb:()=>void)=>cb(),getLeavesOfType:()=>[],getRightLeaf:()=>null,getLeaf:()=>{throw Error("main tab fallback");},revealLeaf:()=>{throw Error("missing leaf");}}};
  await p.openView();
});
test("startup cleanup can be disabled and preserves file properties and other sidebar views",()=>{
  const p=new PluginClass();const types=["backlink","all-properties","file-properties","bookmarks","calendar-task-timer-view"];
  p.app={workspace:{detachLeavesOfType:(type:string)=>{const i=types.indexOf(type);if(i>=0)types.splice(i,1);}}};
  p.settings.closeUnusedSidebarViewsOnStartup=false;p.closeUnusedSidebarViews();assert.equal(types.length,5);p.settings.closeUnusedSidebarViewsOnStartup=true;p.closeUnusedSidebarViews();assert.deepEqual(types,["file-properties","bookmarks","calendar-task-timer-view"]);
});
