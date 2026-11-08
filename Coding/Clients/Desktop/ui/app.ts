import type { DesktopSnapshot, DesktopMutation, CommandResult, DiarySnapshot } from "../protocol";
import type { Task, WorkRecord, TimelineRow } from "../../../Shared/contracts";
import { elapsed, secondsText, dayKey } from "../../../Shared/time";
import { reminderMetadata } from "../../../Shared/scheduling";
import { MonthCalendar } from "./calendar";
import { orderedCategories } from "../../../Shared/categories";
import {taskOverdue,taskDisplayDate} from "../../../Shared/taskDates";
declare global { interface Window {
  __TAURI__?: { core: { invoke<T>(command: string, args?: object): Promise<T> }; event: { listen<T>(event: string, fn: (event: { payload: T }) => void): Promise<() => void> } };
  __CTT_TEST_API__?: (route: string, body?: unknown) => Promise<any>;
} }
const app = document.querySelector<HTMLDivElement>("#app")!, notice = document.querySelector<HTMLDivElement>("#notice")!;
const mode = new URLSearchParams(location.search).get("window") || "main";
document.documentElement.classList.toggle("island-window",mode==="island");
let state: DesktopSnapshot | undefined, selected = dayKey(), page = "tasks", filter = "open", query = "", listFilter = "", taskPage = 0, lastUndo = "", day: DiarySnapshot = { calendars: [], rows: [] }, requestGeneration = 0;
let calendar: MonthCalendar | undefined, daySignature = "", taskSignature = "", settingsSignature="", islandExpanded = false, disconnected = false;
const el = <K extends keyof HTMLElementTagNameMap>(tag: K, text = "", className = "") => { const node = document.createElement(tag); node.textContent = text; node.className = className; return node; };
const button = (text: string, run: () => unknown, className = "") => { const node = el("button", text, className); node.type = "button"; node.onclick = () => { void act(run); }; return node; };
const calendarChoices=()=>state?orderedCategories(state.settings.calendarSources.filter(s=>s.type==="caldav"&&!s.readOnly&&s.enabled!==false),state.settings,true):[];
function show(message: string, error = false) { notice.textContent = message; notice.title = message; notice.classList.toggle("error", error); }
async function act(fn: () => unknown) { try { return await fn(); } catch (e) { show(e instanceof Error ? e.message : String(e), true); return undefined; } }
async function api<T = any>(route: string, body?: unknown): Promise<T> {
  if (window.__CTT_TEST_API__) return window.__CTT_TEST_API__(route, body);
  if (!window.__TAURI__) throw new Error("桌面后台未连接，请从已安装的应用打开。这里不会启动第二个计时器。");
  return window.__TAURI__.core.invoke<T>("backend", { route, body: body === undefined ? null : body });
}
async function native(action: string) { if (window.__TAURI__) await window.__TAURI__.core.invoke("window_action", { action, label: mode }); }
async function command(mutation: DesktopMutation) {
  const result = await api<CommandResult>("/v1/command", { ...mutation, version: 1, requestId: crypto.randomUUID() });
  if (result.undoId) { lastUndo = result.undoId; const undo = document.querySelector<HTMLButtonElement>("#undo"); if (undo) undo.disabled = false; }
  await load(); return result;
}
function choose(date: string) { selected = date; daySignature = ""; taskSignature = ""; render(); void readDay(); }
async function readDay() {
  if (!state) return; const generation = ++requestGeneration;
  try { const data = await api<DiarySnapshot>("/v1/day?date=" + selected); if (generation !== requestGeneration) return; day = data; renderDay(); }
  catch (e) { if (generation === requestGeneration) { const root = document.querySelector("#day-rows"); if (root) root.textContent = (e as Error).message; } }
}
async function load() { state = await api<DesktopSnapshot>("/v1/state"); disconnected = false; render(); }
function timerText() {
  const active = state?.active, title = document.querySelector<HTMLElement>("#active-title"), clock = document.querySelector<HTMLElement>("#clock");
  if (title) title.textContent = active?.title || "当前没有计时";
  if (clock) clock.textContent = disconnected ? "连接断开" : active ? secondsText(elapsed(active)) : "00:00:00";
}
function renderTimer(root: HTMLElement) {
  const signature=JSON.stringify([state?.active?.id,state?.active?.title,state?.active?.runningSince==null,islandExpanded,disconnected]);
  if(root.dataset.signature===signature){timerText();return;}root.dataset.signature=signature;
  root.replaceChildren(); const text = el("div", "", "timer-copy"); text.append(el("strong", "", "active-title")); text.firstElementChild!.id = "active-title";
  const clock = el("span", "", "clock"); clock.id = "clock"; text.append(clock); root.append(text);
  if(mode==="island")text.onpointerdown=e=>{if(e.button===0)void act(()=>native("move"));};
  const active = state?.active;
  if (mode === "island") {const toggle=button(islandExpanded ? "收起" : "展开", async () => {toggle.disabled=true;try{const next=!islandExpanded;await native(next?"expand":"collapse");islandExpanded=next;renderTimer(root);}finally{toggle.disabled=false;}});toggle.id="island-toggle";toggle.title=islandExpanded?"收起计时控制":"展开计时控制";root.prepend(toggle);}
  if (mode !== "island" || islandExpanded) {
    if (active && !disconnected) {
      root.append(button(active.runningSince == null ? "继续" : "暂停", () => command({ action: active.runningSince == null ? "timer.resume" : "timer.pause", sessionId: active.id })));
      root.append(button("结束", () => command({ action: "timer.finish", sessionId: active.id, completeTask: false })));
      if (mode === "main") root.append(button("结束并完成", () => command({ action: "timer.finish", sessionId: active.id, completeTask: true })));
    }
    if (mode === "island") root.append(button("打开", () => native("main")));
  }
  if(mode==="island"){const hide=button("×",()=>native("hide"));hide.title="隐藏灵动岛";hide.setAttribute("aria-label","隐藏灵动岛");root.append(hide);}
  timerText();
}
function skeleton() {
  app.className = "app " + mode;
  if (mode === "island") { const timer = el("section", "", "island-timer"); timer.id = "timer"; app.append(timer); return; }
  const header = el("header"); header.dataset.tauriDragRegion = ""; header.append(el("strong", mode === "calendar" ? "桌面日历" : "日历与计时"));
  if (mode === "calendar") { delete header.dataset.tauriDragRegion; header.append(button("移动", () => native("move")), button("锁定／解锁", () => native("lock")), button("打开", () => native("main")), button("隐藏", () => native("hide"))); }
  else { header.append(button("桌面日历", () => native("calendar")), button("灵动岛", () => native("island"))); }
  app.append(header);
  const timer = el("section", "", "timer"); timer.id = "timer"; app.append(timer);
  if (mode === "main") {
    const nav = el("nav"); for (const [id, name] of [["tasks", "安排"], ["records", "记录"], ["settings", "设置"]]) nav.append(button(name, () => { page = id; buildBody(); render(); }));
    nav.append(button("刷新", async () => { await api("/v1/refresh", {}); await load(); })); app.append(nav);
    const status = el("div", "", "sync-status"); status.id = "sync-status"; app.append(status);
  }
  app.append(el("main")); buildBody();
}
function buildBody() {
  const main = app.querySelector("main"); if (!main) return; main.replaceChildren(); calendar = undefined; taskSignature = ""; daySignature = "";
  if (page === "settings" && mode === "main") { renderSettings(main); return; }
  if (page === "records" && mode === "main") { renderRecords(main); return; }
  main.className = mode === "main" ? "workspace" : "widget-body";
  if (mode === "main") {
    const pool = el("section", "", "task-pool"), tools = el("div", "", "tools"); pool.append(el("h2", "待办"));
    tools.append(button("新建", () => taskForm()), button("撤销安排", async () => { await command({ action: "undo", undoId: lastUndo }); lastUndo = ""; const b = document.querySelector<HTMLButtonElement>("#undo"); if (b) b.disabled = true; }));
    (tools.lastElementChild as HTMLButtonElement).id = "undo"; (tools.lastElementChild as HTMLButtonElement).disabled = !lastUndo; pool.append(tools);
    const today=button("今天待办",()=>{filter="today";selected=dayKey();taskPage=0;buildBody();render();});today.id="today-task-filter";today.setAttribute("aria-pressed",String(filter==="today"));tools.append(today);
    const search = el("input"); search.placeholder = "搜索待办"; search.setAttribute("aria-label", "搜索待办"); search.value = query; search.oninput = () => { query = search.value; taskPage = 0; taskSignature = ""; renderTasks(); }; pool.append(search);
    const select = el("select"); select.setAttribute("aria-label", "待办状态");
    for (const [value, label] of [["open", "待安排"], ["today", "今天（含逾期）"], ["all-open", "全部未完成"], ["overdue", "已逾期"], ["done", "已完成"]]) { const option = el("option", label); option.value = value; select.append(option); }
    select.value = filter; select.onchange = () => { filter = select.value; taskPage = 0; taskSignature = ""; renderTasks(); }; pool.append(select);
    const lists = el("select"); lists.id = "list-filter"; lists.setAttribute("aria-label", "分类筛选"); lists.onchange = () => { listFilter = lists.value; taskPage = 0; taskSignature = ""; renderTasks(); }; pool.append(lists);
    const tasks = el("div", "", "task-list"); tasks.id = "pool-tasks";
    tasks.ondragover = e => { e.preventDefault(); }; tasks.ondrop = e => { if ((e.target as HTMLElement).closest(".task-row")) return; e.preventDefault(); const id = e.dataTransfer?.getData("application/x-ctt-task"); if (id) void act(() => schedule(id, null)); };
    pool.append(tasks); main.append(pool);
  }
  const planning = el("section", "", "planning"), month = el("div"); month.id = "month"; planning.append(month);
  calendar = new MonthCalendar(month, selected, choose, (id, date) => { void act(() => schedule(id, date)); });
  const dayHead = el("div", "", "day-head"), date = el("h2"); date.id = "selected-date"; dayHead.append(date);
  if (mode === "main") dayHead.append(button("日程／补记", () => eventForm())); planning.append(dayHead);
  const tasks = el("div"); tasks.id = "day-tasks"; const rows = el("div"); rows.id = "day-rows"; planning.append(tasks, rows); main.append(planning);
}
async function schedule(id: string, date: string | null) { const task = state?.tasks.find(t => t.id === id); if (!task) throw new Error("任务已变化。"); await command({ action: "task.schedule", task, date }); show(date ? "安排已在本机保存，后台同步中。" : "已退回待安排。" ); }
function taskRow(task: Task, visible: Task[], editable: boolean) {
  const row = el("article", "", "task-row"); row.dataset.taskId = task.id;
  if (editable && !task.completed && !task.readonlyReason) {
    row.draggable = true; row.ondragstart = e => { e.dataTransfer?.setData("application/x-ctt-task", task.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; };
    row.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
    row.ondrop = e => { e.preventDefault(); e.stopPropagation(); const from = e.dataTransfer?.getData("application/x-ctt-task"); if (!from || from === task.id) return; const expected = visible.filter(t => !t.completed).map(t => t.id); if (!expected.includes(from)) { void act(() => schedule(from, task.scheduledDate || null)); return; } const next = expected.filter(id => id !== from); next.splice(next.indexOf(task.id), 0, from); void act(() => command({ action: "task.reorder", next, expected })); };
  }
  const check = el("input"); check.type = "checkbox"; check.checked = task.completed; check.setAttribute("aria-label", "完成 " + task.title); check.disabled = !!task.readonlyReason || !!task.pending;
  check.onchange = () => { check.disabled = true; void act(async () => { await command({ action: "task.update", task, patch: { completed: check.checked } }); }).finally(() => { check.disabled = false; check.checked = state?.tasks.find(t => t.id === task.id)?.completed ?? task.completed; }); };
  const copy = el("div", "", "task-copy"); copy.append(el("strong", task.title));if(taskOverdue(task)){row.classList.add("overdue");copy.append(el("span","逾期","overdue-badge"));}const details = [state?.lists.find(l => l.id === task.listId)?.name, task.due ? "截止 " + task.due : "", task.scheduledDate&&task.scheduledDate<dayKey()?"原安排 "+task.scheduledDate:"",task.pending ? "待同步" : "", task.readonlyReason || ""].filter(Boolean).join(" · "); copy.append(el("small", details));
  row.append(check, copy);
  if (!task.completed) row.append(button("计时", () => command({ action: "timer.start", task: { kind: task.kind === "reminder" ? "reminder" : "local", path: task.path!, id: task.id } })));
  if (editable) {row.append(button("编辑", () => taskForm(task)));const remove=button("删除",()=>deleteTask(task));remove.disabled=!!task.readonlyReason||!!task.pending;remove.title=task.readonlyReason||"删除此待办";row.append(remove);}
  return row;
}
function renderTasks() {
  if (!state) return;
  const root = document.querySelector("#pool-tasks"), dayTasks = document.querySelector("#day-tasks");
  const signature = JSON.stringify([state.tasks, filter, query, listFilter, selected, taskPage,dayKey()]); if (signature === taskSignature) return; taskSignature = signature;
  document.querySelector("#today-task-filter")?.setAttribute("aria-pressed",String(filter==="today"));
  if (root) {
    const tasks = state.tasks.filter(t => (!listFilter || t.listId === listFilter) && t.title.toLowerCase().includes(query.toLowerCase()) && (filter === "done" ? t.completed : !t.completed && (filter === "open" ? !t.scheduledDate : filter === "overdue" ? taskOverdue(t) : filter==="today"?taskDisplayDate(t)===dayKey():true)));
    root.replaceChildren(); const visible = tasks.slice(taskPage * 100, taskPage * 100 + 100); for (const task of visible) root.append(taskRow(task, visible, true));
    if (!tasks.length) root.append(el("p", "这里没有待办。可新建任务，或拖回任务取消安排。已有 OB 数据时，请先在设置中导入交接快照。", "empty"));
    if (tasks.length > 100) { const paging = el("div", "", "tools"); paging.append(button("上一页", () => { taskPage = Math.max(0, taskPage - 1); taskSignature = ""; renderTasks(); }), el("span", `${taskPage + 1} / ${Math.ceil(tasks.length / 100)}`), button("下一页", () => { taskPage = Math.min(Math.ceil(tasks.length / 100) - 1, taskPage + 1); taskSignature = ""; renderTasks(); })); root.append(paging); }
  }
  if (dayTasks) { const tasks = state.tasks.filter(t => taskDisplayDate(t)===selected); dayTasks.replaceChildren(); for (const task of tasks.slice(0, 100)) dayTasks.append(taskRow(task, tasks.slice(0, 100), mode === "main")); }
}
function renderDay() {
  const root = document.querySelector("#day-rows"); if (!root) return; root.replaceChildren();
  for (const row of day.rows) {
    const item = el("article", "", "timeline-row"); item.append(el("time", row.allDay ? "全天" : new Date(row.start).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })), el("span", row.title + (row.pending ? " · 待同步" : "")));
    if (row.error) item.append(el("small", row.error, "error"));
    if (mode === "main" && !row.deleting && (row.recordId||row.original&&!row.pending)) item.append(button("编辑", async () => {if(row.recordId)recordForm(await api<WorkRecord>("/v1/record?id="+encodeURIComponent(row.recordId)));else eventForm(row);}));
    root.append(item);
  }
  if (!day.rows.length) root.append(el("p", "当天暂无日程或工时记录", "empty"));
}
function render() {
  if (!state) return;
  if (!app.childElementCount) skeleton();
  const heading=app.querySelector("header strong");if(heading)heading.textContent=(mode==="calendar"?"桌面日历":"日历与计时")+(state.isolated?" · 离线示例":"");
  renderTimer(document.querySelector<HTMLElement>("#timer")!);
  const status = document.querySelector("#sync-status"); if (status) status.textContent = state.sync.error || (state.sync.refreshing ? "正在同步…" : state.pending.length ? `${state.pending.length} 项待同步` : state.sync.lastSync ? "最近同步 " + new Date(state.sync.lastSync).toLocaleTimeString() : "尚未连接云端，请在设置中连接");
  const date = document.querySelector("#selected-date"); if (date) date.textContent = selected;
  const lists = document.querySelector<HTMLSelectElement>("#list-filter"); if (lists && lists.dataset.signature !== JSON.stringify(state.lists)) { lists.dataset.signature = JSON.stringify(state.lists); lists.replaceChildren(); const all = el("option", "全部分类"); all.value = ""; lists.append(all); for (const list of state.lists) { const o = el("option", list.name); o.value = list.id; lists.append(o); } lists.value = listFilter; }
  calendar?.update(state.tasks, selected); renderTasks();
  if (mode === "main" && page === "settings" && settingsSignature!==JSON.stringify([state.settings,state.pending])) { const main = app.querySelector("main")!; main.replaceChildren(); renderSettings(main); }
  const signature = selected + ":" + state.revision; if (calendar && signature !== daySignature) { daySignature = signature; void readDay(); }
  if (state.recovery) show(state.recovery);
}
function form(title: string) {
  const dialog = el("dialog"), heading = el("h2", title), fields = el("form"), actions = el("div", "", "tools"); dialog.append(heading, fields, actions); document.body.append(dialog); dialog.showModal();
  const close = () => { dialog.close(); dialog.remove(); }; dialog.addEventListener("close", () => dialog.remove(), { once: true }); actions.append(button("取消", close));
  const field = (name: string, value = "", type = "text") => { const label = el("label", name), input = type === "textarea" ? el("textarea") : el("input"); if (input instanceof HTMLInputElement) input.type = type; input.value = value; input.setAttribute("aria-label", name); label.append(input); fields.append(label); return input; };
  const select = (name: string, values: { id: string; name: string }[], value = "") => { const label = el("label", name), input = el("select"); input.setAttribute("aria-label", name); for (const v of values) { const option = el("option", v.name); option.value = v.id; input.append(option); } if (value) input.value = value; label.append(input); fields.append(label); return input; };
  const submit = (run: () => Promise<unknown>) => { const save = button("保存", async () => { if (!fields.reportValidity()) return; save.disabled = true; try { await run(); close(); show("已保存到本机，后台处理同步。"); } finally { save.disabled = false; } }); actions.append(save); fields.onsubmit = e => { e.preventDefault(); save.click(); }; };
  return { dialog, fields, actions, field, select, submit, close };
}
function taskForm(task?: Task) {
  if (!state) return; const f = form(task ? "编辑待办" : "新建待办"), title = f.field("标题", task?.title || ""), due = f.field("截止日期", task?.due || "", "date"), notes = f.field("备注", task ? reminderMetadata(task.description).notes.trimEnd() : "", "textarea"); title.required = true;
  const list = f.select("分类", state.lists, task?.listId || state.settings.reminders.defaultListId);
  const frequency = f.select("重复", [{ id: "none", name: "不重复" }, { id: "daily", name: "每日" }, { id: "weekly", name: "每周指定星期" }, { id: "monthly", name: "每月" }], task?.repeat?.frequency || "none");
  const interval = f.field("重复间隔", String(task?.repeat?.interval || 1), "number"); const weekdays = f.field("每周星期（1-7，逗号分隔）", task?.repeat?.weekdays?.join(",") || "1");
  if (!task) { frequency.closest("label")!.remove(); interval.closest("label")!.remove(); weekdays.closest("label")!.remove(); f.fields.append(el("p", "创建并同步后，可在编辑中设置日／周／月重复规则。", "muted")); }
  if (task?.readonlyReason) {
    f.fields.append(el("p", task.readonlyReason, "error"));
    if (task.kind === "local") { list.disabled = false; f.actions.append(button("明确迁移到此提醒事项列表", async () => { await command({ action: "task.migrate", task: { kind: "local", path: task.path!, id: task.id }, listId: list.value }); f.close(); })); }
    return;
  }
  if (task) { const scheduled = f.field("安排日期", task.scheduledDate || "", "date"); f.actions.append(button("保存安排", () => command({ action: "task.schedule", task, date: scheduled.value || null }).then(() => f.close()))); f.actions.append(button("删除", () => {f.close();deleteTask(task);})); }
  f.submit(async () => {
    const repeat = frequency.value === "none" ? null : { frequency: frequency.value as "daily" | "weekly" | "monthly", interval: Number(interval.value), weekdays: frequency.value === "weekly" ? weekdays.value.split(",").map(Number) : [], zone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    if (task) {const signature=(r:Task["repeat"])=>JSON.stringify(r?[r.frequency,r.interval,r.weekdays,r.zone]:null);const patch:Partial<Task>={title:title.value,due:due.value,description:notes.value};if(list.value!==task.listId)patch.listId=list.value;if(signature(repeat)!==signature(task.repeat))patch.repeat=repeat;await command({action:"task.update",task,patch});}
    else await command({ action: "task.create", title: title.value, listId: list.value, due: due.value, description: notes.value });
  });
}
function deleteTask(task:Task){const f=form("删除待办");f.fields.append(el("p",`确认删除“${task.title}”？已记录的工时会保留。`));const remove=button("确认删除",async()=>{remove.disabled=true;try{await command({action:"task.delete",task});f.close();show("待办已删除，后台同步中。");}finally{remove.disabled=false;}});f.actions.append(remove);}
function localTime(n: number) { const date = new Date(n); return `${dayKey(n)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`; }
function editedTime(value:string,original?:number){return original!==undefined&&value===localTime(original)?original:+new Date(value);}
function eventForm(row?: TimelineRow) {
  if (!state) return; const f = form(row ? "编辑日程（重复事件修改整个系列）" : "日程／生活补记"), title = f.field("标题", row?.title || ""), start = f.field("开始", localTime(row?.seriesStart || row?.start || +new Date(selected + "T09:00:00")), "datetime-local"), end = f.field("结束", localTime(row?.seriesEnd || row?.end || +new Date(selected + "T10:00:00")), "datetime-local"); title.required = true;
  const sources = calendarChoices(), calendarId = f.select("日历", sources, row?.calendarId || state.settings.defaultCalendarId), allDay = f.select("全天", [{ id: "false", name: "否" }, { id: "true", name: "是（结束日期不包含）" }], row?.allDay ? "true" : "false"), rule = f.field("重复规则 RRULE（留空不重复）", String(row?.original?.event.rrule || "")), description = f.field("备注", String(row?.original?.event.description || ""), "textarea");
  if (row?.original) f.actions.append(button("删除日程／整个系列", async () => { if (confirm("删除此日程？重复日程将删除整个系列。")) { await command({ action: "event.delete", original: row.original!, start: row.start, end: row.end }); f.close(); } }));
  f.submit(() => command({ action: "event.save", original: row?.original, draft: { title: title.value, start: editedTime(start.value,row?.seriesStart??row?.start), end: editedTime(end.value,row?.seriesEnd??row?.end), calendarId: calendarId.value, allDay: allDay.value === "true", rrule: rule.value, description: description.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }));
}
function renderRecords(root: HTMLElement) {
  root.className = "records"; root.append(el("h2", "工时记录")); const tools = el("div", "", "tools"), from = el("input"), to = el("input"), rows = el("div"); from.type = to.type = "date"; from.value = selected.slice(0, 8) + "01"; to.value = selected; from.setAttribute("aria-label", "查询开始日期"); to.setAttribute("aria-label", "查询结束日期"); let offset = 0;
  const queryRecords = async () => { const result = await api<{ total: number; records: WorkRecord[] }>(`/v1/history?from=${from.value}&to=${to.value}&offset=${offset}`); rows.replaceChildren(el("p", `共 ${result.total} 条，当前 ${offset + 1}–${Math.min(result.total, offset + 100)}`)); for (const record of result.records) {
    const item = el("article", "", "record"); const visible = record.edit ? {...record,...record.edit} : record;
    item.append(el("strong", visible.title), el("span", `${new Date(record.startedAt).toLocaleString()} · ${secondsText(visible.segments.reduce((sum, p) => sum + p.end - p.start, 0))} · ${record.status === "saved" ? "已同步" : "待同步"}`), button("修改", () => recordForm(record)));
    if (record.completeTask && !record.taskSaved && record.segments.every(p=>p.saved)) item.append(button("确认仅保留工时，不完成原任务", async()=>{await command({action:"record.calendar-only",recordId:record.id});await queryRecords();})); rows.append(item);
  } };
  tools.append(from, to, button("查询", () => { offset = 0; return queryRecords(); }), button("上一页", () => { offset = Math.max(0, offset - 100); return queryRecords(); }), button("下一页", () => { offset += 100; return queryRecords(); }), button("补记", () => eventForm())); root.append(tools, rows); void act(queryRecords);
}
function recordForm(record: WorkRecord) {
  const f = form("编辑计时记录"), title = f.field("标题", record.title), calendarId = f.select("日历", state!.settings.calendarSources.filter(s => s.type === "caldav" && !s.readOnly), record.calendarId);
  const parts = record.segments.map((part, i) => ({ part, start: f.field(record.segments.length===1?"开始":`第 ${i + 1} 段开始`, localTime(part.start), "datetime-local"), end: f.field(record.segments.length===1?"结束":`第 ${i + 1} 段结束`, localTime(part.end), "datetime-local") }));
  f.submit(() => command({ action: "record.edit", record, title: title.value, calendarId: calendarId.value, segments: parts.map(p => ({ ...p.part, start: editedTime(p.start.value,p.part.start), end: editedTime(p.end.value,p.part.end) })) }));
}
function renderSettings(root: HTMLElement) {
  settingsSignature=JSON.stringify([state!.settings,state!.pending]);
  root.className = "settings"; root.append(el("h2", "账户与同步"));
  if(!state!.settings.ownershipAcknowledged&&!state!.isolated){root.append(el("p","已有 OB 用户先退出桌面，加载 0.7.0 旧模式并执行交接，再打开桌面导入；在交接前不会启动第二套计时或提交业务操作。"),button("全新使用：启用独立模式",()=>{const f=form("仅供没有旧计时／同步宿主的新用户"),label=el("label"),check=el("input");check.type="checkbox";label.append(check,el("span","我已停止旧计时器与同步，并确认不需要导入原 OB 数据"));f.fields.append(label);f.submit(()=>{if(!check.checked)throw new Error("请先停止旧写入者；已有数据请使用交接导入。");return command({action:"ownership.activate",stoppedOldWriters:true});});}));}
  root.append(button("连接提醒事项", () => { const f = form("iCloud 提醒事项登录"), username = f.field("Apple 账户"), password = f.field("账户密码", "", "password"), region = f.select("账户区域", [{ id: "china", name: "中国大陆" }, { id: "global", name: "其他地区" }]); f.submit(async () => { const result = await api("/v1/auth", { username: username.value, password: password.value, china: region.value === "china" }); password.value = ""; if (result.needsCode) { const code = form("双重认证"), input = code.field("验证码"); code.submit(async () => { await api("/v1/auth", { code: input.value }); await load(); }); } else await load(); }); }));
  root.append(button("添加日历／订阅", () => { const f = form("日历连接"), url = f.field("CalDAV 地址／ICS 订阅地址", "https://caldav.icloud.com/"), username = f.field("账户"), password = f.field("App 专用密码", "", "password"), type = f.select("类型", [{ id: "caldav", name: "CalDAV（iCloud 日历）" }, { id: "ics", name: "只读 ICS" }]); f.submit(async () => { await api("/v1/calendar", { url: url.value, username: username.value, password: password.value, ics: type.value === "ics" }); password.value = ""; await load(); }); }));
  root.append(button("管理日历来源",()=>{const f=form("日历来源（移除配置不删除云端数据）");let sources=structuredClone(state!.settings.calendarSources);const rows=el("div");f.fields.append(rows);const draw=()=>{rows.replaceChildren();for(const source of sources){const line=el("div","","tools"),check=el("input");check.type="checkbox";check.checked=source.enabled!==false;check.onchange=()=>source.enabled=check.checked;line.append(check,el("span",source.name),button("移除此连接",()=>{sources=sources.filter(s=>s.id!==source.id);draw();}));rows.append(line);}};draw();f.submit(()=>command({action:"calendar.configure",sources}));}));
  root.append(button("分类显示与顺序",()=>{const f=form("分类显示与顺序"),sources=state!.settings.calendarSources;let order=orderedCategories(sources,state!.settings).map(s=>s.id),hidden=new Set(state!.settings.hiddenCategoryIds||[]);const rows=el("div");f.fields.append(rows);const draw=()=>{rows.replaceChildren();order.forEach((id,index)=>{const line=el("div","","tools"),check=el("input");check.type="checkbox";check.checked=!hidden.has(id);check.onchange=()=>{check.checked?hidden.delete(id):hidden.add(id);};const move=(delta:number)=>{const other=index+delta;if(other<0||other>=order.length)return;[order[index],order[other]]=[order[other],order[index]];draw();};line.append(check,el("span",sources.find(s=>s.id===id)!.name),button("上移",()=>move(-1)),button("下移",()=>move(1)));rows.append(line);});};draw();f.submit(()=>command({action:"categories.save",order,hidden:[...hidden]}));}));
  root.append(button("工时日历与分类映射", () => { const f = form("工时日历"), sources = state!.settings.calendarSources.filter(s => s.type === "caldav" && !s.readOnly), defaultCalendar = f.select("默认工时日历", sources, state!.settings.defaultCalendarId), mappings = state!.lists.map(list => ({ id: list.id, input: f.select(list.name, sources, state!.settings.reminders.calendarMap[list.id] || state!.settings.defaultCalendarId) })); f.submit(() => command({ action: "settings.save", defaultCalendarId: defaultCalendar.value, calendarMap: Object.fromEntries(mappings.map(m => [m.id, m.input.value])) })); }));
  if(!state!.settings.metadataVerified)root.append(el("h3", "首次启用安排日期"), el("p", "在 Apple 原生提醒事项编辑专用样例并核对一次，完成后此入口自动收起。"), button("创建验证样例", async () => { show((await api("/v1/metadata-probe", {})).message); }), button("核对原生往返", async () => { show((await api("/v1/metadata-probe", { check: true })).message); await load(); }));
  if(state!.pending.length)root.append(el("h3", "待提交操作")); for (const pending of state?.pending || []) root.append(el("p", pending.error || "等待提交"), button("重试", async () => { await api("/v1/retry", { key: pending.key }); await load(); }));
  if(!state!.settings.migratedFrom)root.append(el("h3", "导入已有 OB 数据"), el("p", "仅用于尚未迁移的旧版数据。用保留的 OB 0.7.0 完成交接，再导入；现有桌面业务不会被覆盖。"), button("预览并导入交接快照", () => { const f = form("导入 OB 交接快照"), directory = f.field("交接目录（绝对路径）"); let digest = "";
    f.actions.append(button("预览", async () => { const result = await api("/v1/migration-preview", { directory: directory.value }); digest = result.digest; const summary = el("p", `${result.tasks} 个原生任务，${result.legacyTasks} 个旧本地任务，${result.records} 条工时，${result.bindings} 个课题绑定，${result.pending} 项待确认操作。`); f.fields.append(summary); directory.readOnly = true; }));
    f.submit(async () => { if (!digest) throw new Error("请先预览并核对导入内容。"); await api("/v1/migration-import", { directory: directory.value, digest }); await load(); }); }));
  root.append(el("p", "关闭主窗口后继续在托盘运行；明确退出会保存为暂停。睡眠与休眠继续计时。", "muted"));
}
async function start() {
  if (window.__TAURI__) {
    await window.__TAURI__.event.listen<DesktopSnapshot>("desktop-state", event => { state = event.payload; render(); });
    await window.__TAURI__.event.listen<string>("native-error",event=>show(event.payload,true));
    await window.__TAURI__.event.listen<string>("backend-error",event=>{disconnected=true;show(event.payload||"桌面后台连接中断",true);renderTimer(document.querySelector<HTMLElement>("#timer")!);});
    await window.__TAURI__.event.listen<boolean>("backend-ready", () => { void act(load); });
  }
  await load();
  if (window.__TAURI__) requestAnimationFrame(()=>requestAnimationFrame(()=>{void window.__TAURI__!.core.invoke("frontend_ready",{label:mode});}));
  setInterval(() => { if (!document.hidden) timerText(); }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { timerText(); void act(load); } });
}
void act(start);
