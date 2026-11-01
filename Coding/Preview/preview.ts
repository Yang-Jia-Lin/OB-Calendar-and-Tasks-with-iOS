import { mountNoteTaskForm } from "../Clients/Obsidian/noteTaskForm";
import { TimerApi, taskRef } from "../Clients/Obsidian/api";
import { componentsFixture } from "./componentsFixture";
import { diaryFixture } from "./diaryFixture";
import { FcrBridge, type FcrApi } from "../Providers/Fcr/bridge";
import { clone, uid, type Task, type Entry } from "../Shared/contracts";
import { TimerController, blankJournal, validateJournal } from "../Shared/timer";
import { dayKey, dateParts, eventForSegment } from "../Shared/time";
import { mergeTimeline } from "../Shared/timeline";
import { TimerUI, type ViewModel, type Actions } from "../Clients/Obsidian/ui";
import { el, options, button } from "../Clients/Obsidian/dom";
import { Dialogs, type DialogHost } from "../Clients/Obsidian/dialogs";
import { appearance, applyAppearance, mountTimerView, DEFAULT_APPEARANCE } from "../Clients/Obsidian/appearance";
import { setupStatus, updateStatus } from "../Clients/Obsidian/status";
import { categoryPreferences, renderCategorySettings } from "../Clients/Obsidian/categories";
import { reorderTaskSlots, taskSort, type TaskSort } from "../Clients/Obsidian/taskOrder";
import { SyncWorker } from "../Shared/sync";
import { pendingView, syncKey } from "../Clients/Obsidian/syncStatus";
import { appPage, focusLimit, focusRefs, refKey, type AppPage, type TaskCompletion, type TaskRef } from "../Shared/application";
const key = "calendar-task-timer-preview-v2", today = dayKey();
const calendars = [{ id: "research", name: "科研", type: "caldav", color: "#c8a0b2" }, { id: "work", name: "工作", type: "caldav", color: "#82a6c0" }, { id: "personal", name: "个人", type: "caldav", color: "#9bb69f" }];
let tasks: Task[] = [
  { id: "t1", title: "梳理论文中的核心问题", calendarId: "research", due: today, completed: false, kind: "local" },
  { id: "t2", title: "整理多摄像头数据集", calendarId: "research", completed: false, kind: "local" },
  { id: "t3", title: "准备项目周报", calendarId: "work", due: today, completed: false, kind: "local" },
  { id: "t4", title: "晚间阅读", calendarId: "personal", completed: false, kind: "local" }
];
let entries: Entry[] = [], defaultCalendarId = "research", date = today, busy = false, error = "", offline = false;
let page:AppPage="tasks", pins:TaskRef[]=[], candidateLimit=5, completions:TaskCompletion[]=[];
let calendarMounts=0,calendarDisposals=0;
let typography = { ...DEFAULT_APPEARANCE };
let categories = categoryPreferences();
let syncDelay = 0;
let worker: SyncWorker | undefined;
let sortMode: TaskSort = "manual";
const instant = (time: string) => +new Date(`${today}T${time}:00`);
const firstTask = { id: "demo-work", title: "论文阅读", kind: "local" as const, completed: true, calendarId: "research" };
const seed = blankJournal();
const demoRecord = { id: "demo-session", title: "论文阅读", task: firstTask, calendarId: "research", zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
  startedAt: instant("09:10"), endedAt: instant("10:00"), runningSince: null, lastHeartbeat: instant("10:00"), segments: [{ start: instant("09:10"), end: instant("10:00"), uid: "simple-task-timer-demo-session-0", saved: true }], completeTask: false, taskSaved: true, status: "saved" as const, error: "" };
const demoEvent = eventForSegment(demoRecord, demoRecord.segments[0]); demoRecord.segments[0] = { ...demoRecord.segments[0], snapshot: demoEvent } as typeof demoRecord.segments[0];
seed.records.push(demoRecord);
entries.push({ id: "demo-event-1", calendarId: "research", event: demoEvent });
const makeEvent = (id: string, title: string, start: string, end: string, calendarId: string) => {
  const a = dateParts(instant(start), "UTC"), b = dateParts(instant(end), "UTC");
  entries.push({ id, calendarId, event: { type: "single", uid: id, title, date: a.date, endDate: b.date, startTime: a.time, endTime: b.time, timezone: "UTC", allDay: false, isTask: false } });
};
makeEvent("demo-event-2", "项目讨论", "10:30", "11:15", "work"); makeEvent("demo-event-3", "实验方案整理", "14:00", "15:00", "research"); makeEvent("demo-event-4", "健身", "19:00", "20:00", "personal");
let initial = seed;
try { const saved = JSON.parse(localStorage.getItem(key) || "null"); if (saved) { initial = validateJournal(saved.journal); tasks = saved.tasks; entries = saved.entries; defaultCalendarId = saved.defaultCalendarId; typography = appearance(saved.typography); categories = categoryPreferences(saved.categories); sortMode = taskSort(saved.taskSort); } } catch { /* Invalid preview fixtures are reset; no real data exists here. */ }
tasks = tasks.map(t => ({ ...t, path: "preview-tasks.md" }));
try {const pref=JSON.parse(localStorage.getItem('ctt-workspace-prefs')||'{}');page=appPage(pref.page);pins=focusRefs(pref.pins);candidateLimit=focusLimit(pref.limit);completions=pref.completions||[];}catch{}
const writePrefs=()=>localStorage.setItem('ctt-workspace-prefs',JSON.stringify({page,pins,limit:candidateLimit,completions}));
const completeTask=(task:Task,done:boolean)=>{if(task.completed===done)return;task.completed=done;if(done)completions.push({id:uid(),task:taskRef(task),title:task.title,calendarId:task.calendarId||defaultCalendarId,completedAt:Date.now()});writePrefs();};
const write = () => { localStorage.setItem(key, JSON.stringify({ journal: controller.state, tasks, entries, defaultCalendarId, typography, categories, taskSort: sortMode })); };
const effect = async () => { if (syncDelay) await new Promise(resolve => setTimeout(resolve, syncDelay)); if (offline) throw new Error("模拟断网：操作已保存在本机，联网后可重试。"); };
const api: FcrApi = {
  getCalendarSources: () => clone(calendars), getProviderCapabilities: () => ({ canCreate: true, canEdit: true, canDelete: true }),
  getAllEvents: () => calendars.map(c => ({ ...c, events: entries.filter(e => e.calendarId === c.id).map(e => ({ id: e.id, event: clone(e.event) })) })),
  getEvents: () => entries.map(e => ({ id: e.id, startMillis: +new Date(`${e.event.date}T${e.event.startTime}${e.event.timezone === "UTC" ? "Z" : ""}`), endMillis: +new Date(`${e.event.endDate || e.event.date}T${e.event.endTime}${e.event.timezone === "UTC" ? "Z" : ""}`), isTask: false })),
  createEvent: async (calendarId, event) => { await effect(); entries.push({ id: uid(), calendarId, event: clone(event) }); write(); return true; },
  updateEvent: async (id, event) => { await effect(); const found = entries.find(e => e.id === id); if (!found) return false; found.event = clone(event); write(); return true; },
  deleteEvent: async id => { await effect(); entries = entries.filter(e => e.id !== id); write(); },
  revalidateRemoteCalendars: () => {}, openCalendar: async () => { notice("预览仅展示时间轴；真实插件会打开 FCR。"); }
};
const bridge = new FcrBridge({}, () => null, async () => {}); bridge.authorized = api;
let ui: TimerUI;
let timerApi: TimerApi | undefined;
const notice = (text: string) => { const node = document.querySelector<HTMLElement>("#toast")!; node.textContent = text; setTimeout(() => { if (node.textContent === text) node.textContent = ""; }, 4000); };
const controller = new TimerController({ state: initial, background: true, persist: async state => { localStorage.setItem(key, JSON.stringify({ journal: state, tasks, entries, defaultCalendarId, typography, categories, taskSort: sortMode })); }, calendar: bridge,
  tasks: { complete: async task => { const found = tasks.find(t => t.id === task.id); if (!found) throw new Error("待办已删除"); if (!found.completed && found.title !== task.title) throw new Error("待办已变化"); completeTask(found,true); write(); } }, ownerDeviceId:"preview-device",onChange: () => { render(); worker?.wake(); } });
worker = new SyncWorker(controller, { enabled: () => true, changed: () => render(), settled: () => { write(); render(); } });
const host: DialogHost = { notice, open: (title, render) => { const restore = document.activeElement; const d = document.createElement("dialog"); document.body.append(d); const root = el(d, "div", "ctt-dialog"); applyAppearance(root, typography); el(root, "h2", "", title); render(root, () => d.close()); d.addEventListener("close", () => { d.remove(); if (restore instanceof HTMLElement && restore.isConnected) restore.focus(); }); d.showModal(); } };
const dialogs = new Dialogs(host, controller, bridge, () => calendars, () => defaultCalendarId, async () => { write(); render(); }, id => worker!.retry(`delete:${id}`));
async function execute<T>(fn: () => Promise<T>): Promise<T> { if (busy) throw new Error("请稍后重试"); busy = true; error = ""; render(); try { return await fn(); } finally { busy = false; render(); } }
async function run(fn: () => Promise<unknown>) { try { await execute(fn); return true; } catch (e) { error = (e as Error).message; render(); return false; } }
const taskSeeds = new Map(tasks.map(t=>[t.id,clone(t)]));
timerApi = new TimerApi({ controller, execute, resolve: async (ref,context) => {
  let found = tasks.find(t => t.id === ref.id && t.path === ref.path);
  if(context?.source==="components" && ["research.md","reading.md"].includes(context.path || "")){if(controller.state.active&&controller.state.active.task.id!==ref.id)throw new Error("请先结束当前计时");if(!found){const seed=taskSeeds.get(ref.id);if(!seed)throw new Error("绑定已失效");found={...seed,completed:false};tasks.push(found);}else if(found.completed)completeTask(found,false);write();render();}
  if (!found) throw new Error("任务不存在"); return clone(found);
}, prepare: async task => { bridge.assertWritable(task.calendarId || defaultCalendarId); return { ...task, calendarId: task.calendarId || defaultCalendarId }; },
  refresh: async () => { write(); render(); }, state: () => ({ available: true, active: controller.state.active, tasks, pending: controller.jobs().length, sync: worker?.view }) });
const showResult = async (result: ReturnType<TimerApi["start"]>) => { const r = await result; if (!r.ok) { error = r.message; notice(r.message); render(); } };
function model(): ViewModel { const state = controller.state;
  return { connected: true, busy, error, sources: calendars, calendars, defaultCalendarId, active: state.active, tasks, date, appearance: typography, categoryPreferences: categories, taskSort: sortMode,
    rows: mergeTimeline(bridge.timeline(date), state.records, date, state.operations, state.deletions), pending: pendingView(state, worker?.view), sync: worker?.view,appPage:page,focusPins:pins,focusLimit:candidateLimit,linkedTasks:[{kind:"local",path:"preview-tasks.md",id:"t1"}],completions };
}
function render() { timerApi?.notify(); ui?.update(model()); updateStatus(document.querySelector<HTMLElement>("#preview-status")!, controller.state.active, tasks, sortMode); }
const actions: Actions = {
  page:value=>{page=value;writePrefs();},pin:task=>{const k=refKey(task);pins=pins.some(p=>refKey(p)===k)?pins.filter(p=>refKey(p)!==k):[...pins,taskRef(task)];writePrefs();render();},focusLimit:value=>{candidateLimit=focusLimit(value);writePrefs();render();},openCompletion:event=>{notice(`查看待办：${event.title}`);},
  mountCalendar:root=>{calendarMounts++;root.innerHTML='<h2>日历 · FCR 嵌入预览</h2><p>此处为模拟日历；实机使用 FCR 自带的 fc-calendar 渲染器。</p>';const add=button(root,'新增日程',()=>actions.newEvent());return {activate:()=>{},dispose:()=>{calendarDisposals++;add.remove();root.replaceChildren();}};},
  connect: () => {}, refresh: () => { void run(async () => { bridge.refresh(); await controller.reconcileDeletions(); notice("已刷新示例日历"); }); }, openCalendar: () => { void bridge.openCalendar(); },
  categorySettings: () => host.open("分类排序与显示", (root, close) => {
    const categoryRoot = el(root, "div"); renderCategorySettings(categoryRoot, calendars, categories, async next => { categories = next; write(); render(); });
    button(root, "完成", close);
  }),
  settings: () => host.open("预览设置", (root, close) => {
    const l = el(root, "label", "ctt-field"); el(l, "span", "", "默认分类"); const select = el(l, "select"); options(select, calendars, defaultCalendarId);
    const sizeLabel = el(root, "label", "ctt-field"); el(sizeLabel, "span", "", "页面字号"); const size = el(sizeLabel, "select");
    for (let n = 13; n <= 20; n++) { const option = el(size, "option", "", `${n}px`); option.value = String(n); } size.value = String(typography.fontSize);
    const weightLabel = el(root, "label", "ctt-field"); el(weightLabel, "span", "", "页面字重"); const weight = el(weightLabel, "select");
    for (const [v, title] of [[400, "常规"], [500, "适中"], [600, "加粗"]] as const) { const option = el(weight, "option", "", title); option.value = String(v); } weight.value = String(typography.fontWeight);
    button(root, "保存", () => { defaultCalendarId = select.value; typography = appearance({ fontSize: Number(size.value), fontWeight: Number(weight.value) }); write(); render(); close(); }, "ctt-primary"); }),
  date: value => { date = value; render(); },
  sortTasks: mode => run(async () => { const before = sortMode; sortMode = mode; try { write(); } catch (e) { sortMode = before; throw e; } }),
  reorderTasks: (next, expected) => run(async () => { if (sortMode !== "manual") throw new Error("请先切换手动排序。"); const before = tasks; tasks = reorderTaskSlots(tasks, next, expected); try { write(); } catch (e) { tasks = before; throw e; } }),
  add: (title, due, calendarId) => run(async () => { if (!title.trim()) throw new Error("请填写名称。"); bridge.assertWritable(calendarId); tasks.push({ id: uid(), path: "preview-tasks.md", title, due, calendarId, completed: false, kind: "local" }); write(); }),
  start: task => { void showResult(timerApi!.start(taskRef(task), { source: "view" })); },
  complete: task => { completeTask(task,!task.completed); write(); render(); }, editTask: task => dialogs.task(task, async patch => { Object.assign(task, patch); write(); },async()=>{if(controller.state.active?.task.id===task.id)throw new Error("请先结束这项任务的计时，再删除待办。");taskSeeds.set(task.id,clone(task));tasks=tasks.filter(t=>t.id!==task.id);write();}),
  pause: id => { void showResult(timerApi!.pause(id || "")); }, resume: id => { void showResult(timerApi!.resume(id || "")); }, finish: (complete, id) => { void showResult(timerApi!.finish(id || "", complete)); },
  editStart: () => dialogs.start(), category: id => { void run(() => controller.updateActive({ calendarId: id })); },
  newEvent: () => dialogs.event(date), editRow: row => { if (row.deleting && row.deletionId) { dialogs.deletion(row.deletionId); return; } if (row.pending && !row.recordId) { notice(row.error || "请先重试待同步操作。"); return; } if (row.recordId) dialogs.record(controller.state.records.find(r => r.id === row.recordId)!, row.segmentUid); else dialogs.event(date, row); },
  resolveDeletion: id => dialogs.deletion(id),
  retry: id => { void run(async () => { await worker?.retry(syncKey(id)); }); },
  keep: id => { void run(() => controller.keepCalendarOnly(id)); }
};
ui = new TimerUI(mountTimerView(document.querySelector<HTMLElement>("#app")!), actions);
setupStatus(document.querySelector<HTMLElement>("#preview-status")!, () => document.querySelector<HTMLElement>(".ctt-shell")!.scrollTo({ top: 0 }));
render(); void controller.recover().then(() => worker?.wake());
setInterval(() => { timerApi?.notify(); ui.tick(); updateStatus(document.querySelector<HTMLElement>("#preview-status")!, controller.state.active, tasks, sortMode); }, 1000); setInterval(() => { void controller.heartbeat(); }, 15000);
document.querySelector<HTMLInputElement>("#offline")!.onchange = e => { offline = (e.target as HTMLInputElement).checked; if (!offline) void worker?.resume("network"); };
document.querySelector<HTMLSelectElement>("#sync-delay")!.onchange = e => { syncDelay = Number((e.target as HTMLSelectElement).value); };
document.querySelector<HTMLInputElement>("#theme")!.onchange = e => document.documentElement.classList.toggle("theme-dark", (e.target as HTMLInputElement).checked);
document.querySelector<HTMLButtonElement>("#reset")!.onclick = () => { localStorage.removeItem(key); location.reload(); };
(window as any).__preview = { controller, bridge, model, render, ui, worker, api: timerApi, taskRef, setDelay: (ms: number) => { syncDelay = ms; }, tasks: () => tasks, entries: () => entries,calendarStats:()=>({mounts:calendarMounts,disposals:calendarDisposals}),completions:()=>completions };
(window as any).__preview.noteFormChoices=[];
(window as any).__preview.openNoteTaskForm=(defaultCategory:string,existing=false)=>host.open("创建计时待办 · 端边云平台",(root,close)=>mountNoteTaskForm(root,"端边云平台",calendars,defaultCategory,existing,choice=>{(window as any).__preview.noteFormChoices.push(choice);close();}));
window.addEventListener("beforeunload", () => worker?.stop());
if (new URLSearchParams(location.search).has("diary")) { document.querySelector<HTMLElement>("#app")!.style.display = "none"; (window as any).__diaryPreview = diaryFixture(); }
if (new URLSearchParams(location.search).has("components")) (window as any).__preview.native = componentsFixture(timerApi!, {
  "research.md": taskRef(tasks.find(t => t.id === "t1")!), "reading.md": taskRef(tasks.find(t => t.id === "t2")!)
});
