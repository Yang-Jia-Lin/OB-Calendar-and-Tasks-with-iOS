import type { DesktopSnapshot, DesktopMutation, CommandResult, DiarySnapshot } from "../protocol";
import type { Task, WorkRecord, TimelineRow } from "../../../Shared/contracts";
import { elapsed, secondsText, dayKey } from "../../../Shared/time";
import { reminderMetadata } from "../../../Shared/scheduling";
import { MonthCalendar } from "./calendar";
import { appearanceSettings, startAppearance } from "./appearance";
import { orderedCategories } from "../../../Shared/categories";
import {taskOverdue,taskDisplayDate} from "../../../Shared/taskDates";
declare global { interface Window {
  __TAURI__?: { core: { invoke<T>(command: string, args?: object): Promise<T> }; event: { listen<T>(event: string, fn: (event: { payload: T }) => void): Promise<() => void> } };
  __CTT_TEST_API__?: (route: string, body?: unknown) => Promise<any>;
} }
const app = document.querySelector<HTMLDivElement>("#app")!, notice = document.querySelector<HTMLDivElement>("#notice")!;
const mode = new URLSearchParams(location.search).get("window") || "main";
document.documentElement.classList.toggle("island-window",mode==="island");
let state: DesktopSnapshot | undefined, selected = dayKey(), page = "today", taskPage = 0, lastUndo = "", requestGeneration = 0, pushGeneration = 0;
const taskFilters = { today: { status: "today", query: "", list: "" }, tasks: { status: "open", query: "", list: "" } };
const currentFilters = () => page === "today" ? taskFilters.today : taskFilters.tasks;
let viewDate = dayKey(), historySignature = -1, refreshHistory: (() => Promise<void>) | undefined;
let calendar: MonthCalendar | undefined, daySignature = "", taskSignature = "", settingsSignature="", islandExpanded = false, disconnected = false;
const calendarLayout = {
  view: "month" as "month" | "week", poolOpen: true, togglePool() {
    calendarLayout.poolOpen = !calendarLayout.poolOpen;
    const pool = app.querySelector<HTMLElement>("#calendar-task-pool");
    if (!pool) return;
    pool.hidden = !calendarLayout.poolOpen;
    pool.parentElement!.classList.toggle("pool-closed", pool.hidden);
    calendar?.update(state!.tasks, selected);
    app.querySelector<HTMLButtonElement>(".calendar-controls [aria-controls]")?.focus();
  }
};
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
  if (!window.__TAURI__) await load();
  return result;
}
function choose(date: string) { selected = date; render(); }
async function readDay(root: HTMLElement, date: string) {
  const generation = ++requestGeneration;
  if (root.dataset.date !== date) {
    root.dataset.date = date;
    root.replaceChildren(el("p", "正在读取本机日历…", "empty"));
  }
  try {
    const data = await api<DiarySnapshot>("/v1/day?date=" + date);
    if (generation === requestGeneration && root.isConnected) renderDay(root, data);
  } catch (e) {
    if (generation !== requestGeneration || !root.isConnected) return;
    root.querySelector(".day-error")?.remove();
    if (!root.querySelector(".timeline-row")) root.replaceChildren();
    root.append(el("p", (e as Error).message, "day-error error"));
  }
}
function acceptSnapshot(next: DesktopSnapshot) {
  if (state && next.revision < state.revision) return;
  state = next;
  disconnected = false;
  render();
}
async function load() {
  const generation = pushGeneration;
  const next = await api<DesktopSnapshot>("/v1/state?view=desktop");
  if (generation === pushGeneration || !state || next.revision > state.revision) acceptSnapshot(next);
}
function timerText() {
  const active = state?.active, title = document.querySelector<HTMLElement>("#active-title"), clock = document.querySelector<HTMLElement>("#clock");
  if (title) title.textContent = active?.title || "当前没有计时";
  if (clock) clock.textContent = disconnected ? "连接断开" : active ? secondsText(elapsed(active)) : "00:00:00";
}
const startTask = (task: Task) => command({ action: "timer.start", task: { kind: task.kind === "reminder" ? "reminder" : "local", path: task.path!, id: task.id } });
function renderTimerPicker(root: HTMLElement) {
  const picker = root.querySelector<HTMLSelectElement>("select");
  const tasks = state?.tasks.filter(task => !task.completed) || [];
  const signature = JSON.stringify(tasks.map(task => [task.id, task.title]));
  if (picker?.dataset.signature === signature) return;
  const selected = picker?.value;
  const label = el("label", "选择待办"), select = el("select");
  select.dataset.signature = signature;
  for (const task of tasks) select.add(new Option(task.title, task.id));
  if (tasks.some(task => task.id === selected)) select.value = selected!;
  const start = button("开始计时", () => {
    const task = state?.tasks.find(task => task.id === select.value && !task.completed);
    if (task) return startTask(task);
  }, "primary-button");
  start.disabled = !tasks.length; select.disabled = !tasks.length;
  if (!tasks.length) select.add(new Option("暂无可计时的待办", ""));
  label.append(select); root.replaceChildren(label, start);
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
  if (mode === "main") {
    const sidebar = el("aside", "", "sidebar"), nav = el("nav");
    nav.setAttribute("aria-label", "主导航");
    sidebar.append(button("新建", () => taskForm(), "primary-button"));
    for (const [id, name] of [["tasks", "日历"], ["today", "今天"], ["timer", "计时"], ["records", "记录"]]) {
      const tab = button(name, () => { if (id !== page) { page = id; taskPage = 0; buildBody(); render(); } });
      tab.dataset.page = id;
      nav.append(tab);
    }
    sidebar.append(nav);
    const footer = el("div", "", "sidebar-footer"), settings = button("设置", () => { if (page !== "settings") { page = "settings"; buildBody(); render(); } });
    settings.dataset.page = "settings";
    footer.append(settings, button("桌面日历", () => native("calendar")), button("灵动岛", () => native("island")), button("刷新", async () => {
      await api("/v1/refresh", {});
      if (!window.__TAURI__) { daySignature = ""; await load(); }
    }, "refresh-button"));
    const status = el("div", "", "sync-status"); status.id = "sync-status";
    sidebar.append(footer, status);
    app.append(sidebar, el("main")); buildBody(); return;
  }
  app.append(header);
  const timer = el("section", "", "timer"); timer.id = "timer"; app.append(timer);
  app.append(el("main")); buildBody();
}
function buildBody() {
  const main = app.querySelector("main"); if (!main) return; main.replaceChildren(); calendar = undefined; taskSignature = ""; daySignature = "";
  requestGeneration++; refreshHistory = undefined; historySignature = -1;
  if (page === "settings" && mode === "main") { renderSettings(main); return; }
  if (page === "records" && mode === "main") { renderRecords(main); return; }
  if (page === "timer" && mode === "main") {
    main.className = "timer-view";
    const card = el("section", "", "timer-card"), timer = el("div", "", "timer"), picker = el("div", "", "timer-picker");
    timer.id = "timer"; picker.id = "timer-picker";
    card.append(el("h2", "计时"), timer, picker); main.append(card); return;
  }
  const today = mode === "main" && page === "today";
  main.className = today ? "today-view" : mode === "main" ? "workspace" : "widget-body";
  if (mode === "main") {
    const filters = currentFilters(), pool = el("section", "", "task-pool"), top = el("div", "", "task-heading"), tools = el("div", "", "task-filters");
    const heading = el("h2", today ? "今天" : "待办");
    top.append(heading, button("新建待办", () => taskForm(), "primary-button"));
    if (today) {
      const date = el("time");
      date.id = "today-date";
      heading.append(date);
    } else {
      const undo = button("撤销安排", async () => { await command({ action: "undo", undoId: lastUndo }); lastUndo = ""; undo.disabled = true; });
      undo.id = "undo"; undo.disabled = !lastUndo;
      const close = button("×", calendarLayout.togglePool);
      close.setAttribute("aria-label", "收起任务池");
      heading.textContent = "任务池";
      top.replaceChildren(heading, undo, close);
      pool.id = "calendar-task-pool";
      pool.hidden = !calendarLayout.poolOpen;
      main.classList.toggle("pool-closed", pool.hidden);
    }
    pool.append(top, tools);
    const search = el("input"); search.type = "search"; search.placeholder = "搜索待办"; search.setAttribute("aria-label", "搜索待办"); search.value = filters.query;
    const filterChanged = () => { taskPage = 0; renderTasks(); };
    search.oninput = () => { filters.query = search.value; filterChanged(); }; tools.append(search);
    const select = el("select"); select.setAttribute("aria-label", "待办状态");
    for (const [value, label] of [["open", "待安排"], ["today", "今天（含逾期）"], ["all-open", "全部未完成"], ["overdue", "已逾期"], ["done", "已完成"]]) { const option = el("option", label); option.value = value; select.append(option); }
    select.value = filters.status; select.onchange = () => { filters.status = select.value; filterChanged(); }; tools.append(select);
    const lists = el("select"); lists.id = "list-filter"; lists.setAttribute("aria-label", "分类筛选"); lists.onchange = () => { filters.list = lists.value; filterChanged(); }; tools.append(lists);
    const tasks = el("div", "", "task-list"); tasks.id = "pool-tasks";
    if (!today) {
      tasks.ondragover = e => { e.preventDefault(); }; tasks.ondrop = e => { if ((e.target as HTMLElement).closest(".task-row")) return; e.preventDefault(); const id = e.dataTransfer?.getData("application/x-ctt-task"); if (id) void act(() => schedule(id, null)); };
    }
    pool.append(tasks); main.append(pool);
    if (today) return;
  }
  const planning = el("section", "", "planning"), month = el("div"); month.id = "month"; planning.append(month);
  calendar = new MonthCalendar(month, selected, choose, (id, date) => { void act(() => schedule(id, date)); }, mode === "main" ? calendarLayout : undefined);
  const dayHead = el("div", "", "day-head"), date = el("h2"); date.id = "selected-date"; dayHead.append(date);
  if (mode === "main") dayHead.append(button("日程／补记", () => eventForm())); planning.append(dayHead);
  const tasks = el("div"); tasks.id = "day-tasks"; const rows = el("div"); rows.id = "day-rows"; planning.append(tasks, rows); main.append(planning);
}
async function schedule(id: string, date: string | null) { const task = state?.tasks.find(t => t.id === id); if (!task) throw new Error("任务已变化。"); await command({ action: "task.schedule", task, date }); show(date ? "安排已在本机保存，后台同步中。" : "已退回待安排。" ); }
function taskRow(task: Task, visible: Task[], editable: boolean, today = false, compact = today) {
  const row = el("article", "", "task-row"); row.dataset.taskId = task.id;
  if (editable && !today && !task.completed && !task.readonlyReason) {
    row.draggable = true; row.ondragstart = e => { e.dataTransfer?.setData("application/x-ctt-task", task.id); if (e.dataTransfer) e.dataTransfer.effectAllowed = "move"; };
    row.ondragover = e => { e.preventDefault(); e.stopPropagation(); };
    row.ondrop = e => { e.preventDefault(); e.stopPropagation(); const from = e.dataTransfer?.getData("application/x-ctt-task"); if (!from || from === task.id) return; const expected = visible.filter(t => !t.completed).map(t => t.id); if (!expected.includes(from)) { void act(() => schedule(from, task.scheduledDate || null)); return; } const next = expected.filter(id => id !== from); next.splice(next.indexOf(task.id), 0, from); void act(() => command({ action: "task.reorder", next, expected })); };
  }
  const check = el("input"); check.type = "checkbox"; check.checked = task.completed; check.setAttribute("aria-label", "完成 " + task.title); check.disabled = !!task.readonlyReason || !!task.pending;
  check.onchange = () => {
    check.disabled = true;
    void act(() => command({ action: "task.update", task, patch: { completed: check.checked } })).then(result => {
      if (!result) { check.disabled = false; check.checked = task.completed; }
    });
  };
  const copy = el("div", "", "task-copy"); copy.append(el("strong", task.title));if(taskOverdue(task)){row.classList.add("overdue");copy.append(el("span","逾期","overdue-badge"));}const details = [state?.lists.find(l => l.id === task.listId)?.name, task.due ? "截止 " + task.due : "", task.scheduledDate&&task.scheduledDate<dayKey()?"原安排 "+task.scheduledDate:"",task.pending ? "待同步" : "", task.readonlyReason || ""].filter(Boolean).join(" · "); copy.append(el("small", details));
  row.append(check, copy);
  if (!task.completed) row.append(button("计时", () => startTask(task)));
  if (editable && compact) {
    const menu = el("details", "", "task-menu"), summary = el("summary", "⋯");
    summary.setAttribute("aria-label", "操作 " + task.title);
    const actions = el("div", "", "task-menu-actions");
    actions.append(button("编辑", () => { menu.open = false; taskForm(task); }));
    const remove = button("删除", () => { menu.open = false; deleteTask(task); });
    remove.disabled = !!task.readonlyReason || !!task.pending;
    actions.append(remove); menu.append(summary, actions); row.append(menu);
  } else if (editable) {row.append(button("编辑", () => taskForm(task)));const remove=button("删除",()=>deleteTask(task));remove.disabled=!!task.readonlyReason||!!task.pending;remove.title=task.readonlyReason||"删除此待办";row.append(remove);}
  return row;
}
function renderTasks() {
  if (!state) return;
  const root = document.querySelector("#pool-tasks"), dayTasks = document.querySelector("#day-tasks");
  if (!root && !dayTasks) return;
  const today = dayKey(), { status, query, list } = currentFilters(), onTodayPage = page === "today" && mode === "main";
  const signature = JSON.stringify([state.tasks, state.lists, status, query, list, selected, taskPage, today]); if (signature === taskSignature) return; taskSignature = signature;
  if (root) {
    const titleQuery = query.trim().toLowerCase();
    const tasks = state.tasks.filter(t => (!list || t.listId === list) && t.title.toLowerCase().includes(titleQuery) && (status === "done" ? t.completed : !t.completed && (status === "open" ? !t.scheduledDate : status === "overdue" ? taskOverdue(t, today) : status === "today" ? taskDisplayDate(t, today) === today : true)));
    taskPage = Math.min(taskPage, Math.max(0, Math.ceil(tasks.length / 100) - 1));
    root.replaceChildren(); const visible = tasks.slice(taskPage * 100, taskPage * 100 + 100); for (const task of visible) root.append(taskRow(task, visible, true, onTodayPage, true));
    if (!tasks.length) root.append(el("p", status === "today" && !list && !titleQuery ? "今天暂无待办" : "没有符合当前筛选的待办", "empty"));
    if (tasks.length > 100) { const paging = el("div", "", "tools"); paging.append(button("上一页", () => { taskPage = Math.max(0, taskPage - 1); taskSignature = ""; renderTasks(); }), el("span", `${taskPage + 1} / ${Math.ceil(tasks.length / 100)}`), button("下一页", () => { taskPage = Math.min(Math.ceil(tasks.length / 100) - 1, taskPage + 1); taskSignature = ""; renderTasks(); })); root.append(paging); }
  }
  if (dayTasks) { const tasks = state.tasks.filter(t => taskDisplayDate(t, today) === selected).slice(0, 100); dayTasks.replaceChildren(); for (const task of tasks) dayTasks.append(taskRow(task, tasks, mode === "main")); }
}
function renderDay(root: HTMLElement, day: DiarySnapshot) {
  root.replaceChildren();
  for (const row of day.rows) {
    const item = el("article", "", "timeline-row"); item.append(el("time", row.allDay ? "全天" : timeRange(row.start, row.end, root.dataset.date), "time-range"), el("span", row.title + (row.pending ? " · 待同步" : "")));
    if (row.error) item.append(el("small", row.error, "error"));
    if (mode === "main" && !row.pending && (row.recordId || row.original)) item.append(button("编辑", async () => {if(row.recordId)recordForm(await api<WorkRecord>("/v1/record?id="+encodeURIComponent(row.recordId)));else eventForm(row);}));
    root.append(item);
  }
  if (!day.rows.length) root.append(el("p", "当天暂无日程或工时记录", "empty"));
}
function render() {
  if (!state) return;
  if (!app.childElementCount) skeleton();
  const heading=app.querySelector("header strong");if(heading)heading.textContent=(mode==="calendar"?"桌面日历":"日历与计时")+(state.isolated?" · 离线示例":"");
  const timer = app.querySelector<HTMLElement>("#timer");
  if (timer) renderTimer(timer);
  const picker = app.querySelector<HTMLElement>("#timer-picker");
  if (picker) { picker.hidden = !!state.active || disconnected; if (!picker.hidden) renderTimerPicker(picker); }
  const status = document.querySelector("#sync-status"); if (status) status.textContent = state.sync.error || (state.sync.refreshing ? "正在同步…" : state.pending.length ? `${state.pending.length} 项待同步` : state.sync.lastSync ? "最近同步 " + new Date(state.sync.lastSync).toLocaleTimeString() : "尚未连接云端，请在设置中连接");
  const date = document.querySelector("#selected-date"); if (date) date.textContent = selected;
  const today = app.querySelector<HTMLTimeElement>("#today-date");
  viewDate = dayKey();
  if (today && today.dateTime !== viewDate) { today.dateTime = viewDate; today.textContent = new Date(viewDate + "T12:00:00").toLocaleDateString("zh-CN", { month: "long", day: "numeric", weekday: "long" }); }
  for (const tab of app.querySelectorAll<HTMLButtonElement>("[data-page]")) {
    if (tab.dataset.page === page) tab.setAttribute("aria-current", "page"); else tab.removeAttribute("aria-current");
    if (tab.dataset.page === "timer") tab.classList.toggle("running", !!state.active);
  }
  const lists = document.querySelector<HTMLSelectElement>("#list-filter"); if (lists && lists.dataset.signature !== JSON.stringify(state.lists)) { lists.dataset.signature = JSON.stringify(state.lists); lists.replaceChildren(); const all = el("option", "全部分类"); all.value = ""; lists.append(all); for (const list of state.lists) { const o = el("option", list.name); o.value = list.id; lists.append(o); } const filters = currentFilters(); if (![...lists.options].some(option => option.value === filters.list)) filters.list = ""; lists.value = filters.list; }
  calendar?.update(state.tasks, selected); renderTasks();
  if (mode === "main" && page === "settings" && settingsSignature!==JSON.stringify([state.settings,state.pending])) { const main = app.querySelector("main")!; main.replaceChildren(); renderSettings(main); }
  const dayRoot = app.querySelector<HTMLElement>("#day-rows"), signature = [selected, state.calendarRevision, state.journalRevision].join(":");
  if (dayRoot && signature !== daySignature) { daySignature = signature; void readDay(dayRoot, selected); }
  if (refreshHistory && historySignature !== state.historyRevision) { historySignature = state.historyRevision; void act(refreshHistory); }
  if (state.recovery) show(state.recovery);
}
function form(title: string) {
  const dialog = el("dialog"), heading = el("h2", title), fields = el("form"), actions = el("div", "", "tools"); dialog.append(heading, fields, actions); document.body.append(dialog); dialog.showModal();
  const close = () => { dialog.close(); dialog.remove(); }; dialog.addEventListener("close", () => dialog.remove(), { once: true }); actions.append(button("取消", close));
  const field = (name: string, value = "", type = "text") => { const label = el("label", name), input = type === "textarea" ? el("textarea") : el("input"); if (input instanceof HTMLInputElement) input.type = type; input.value = value; input.setAttribute("aria-label", name); label.append(input); fields.append(label); return input; };
  const select = (name: string, values: { id: string; name: string }[], value = "") => { const label = el("label", name), input = el("select"); input.setAttribute("aria-label", name); for (const v of values) { const option = el("option", v.name); option.value = v.id; input.append(option); } if (value) input.value = value; label.append(input); fields.append(label); return input; };
  const submit = (run: () => Promise<unknown>) => {
    const error = el("p", "", "form-error error"); error.setAttribute("role", "alert");
    dialog.insertBefore(error, actions);
    const save = button("保存", async () => {
      if (!fields.reportValidity()) return;
      error.textContent = ""; save.disabled = true;
      try { await run(); close(); show("已保存到本机，后台处理同步。"); }
      catch (e) { error.textContent = e instanceof Error ? e.message : String(e); }
      finally { save.disabled = false; }
    });
    actions.append(save); fields.onsubmit = e => { e.preventDefault(); save.click(); };
  };
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
function timeRange(start: number, end: number, currentDate?: string) {
  const [startDate, startTime] = localTime(start).split("T"), [endDate, endTime] = localTime(end).split("T");
  const crossDay = startDate !== endDate;
  const first = crossDay || startDate !== currentDate ? `${startDate} ${startTime}` : startTime;
  return `${first}–${crossDay ? endDate + " " : ""}${endTime}`;
}
function editedTime(value:string,original?:number){return original!==undefined&&value===localTime(original)?original:+new Date(value);}
function eventForm(row?: TimelineRow) {
  if (!state) return; const f = form(row ? "编辑日程（重复事件修改整个系列）" : "日程／生活补记"), title = f.field("标题", row?.title || ""), start = f.field("开始", localTime(row?.seriesStart || row?.start || +new Date(selected + "T09:00:00")), "datetime-local"), end = f.field("结束", localTime(row?.seriesEnd || row?.end || +new Date(selected + "T10:00:00")), "datetime-local"); title.required = true;
  const sources = calendarChoices(), calendarId = f.select("日历", sources, row?.calendarId || state.settings.defaultCalendarId), allDay = f.select("全天", [{ id: "false", name: "否" }, { id: "true", name: "是（结束日期不包含）" }], row?.allDay ? "true" : "false"), rule = f.field("重复规则 RRULE（留空不重复）", String(row?.original?.event.rrule || "")), description = f.field("备注", String(row?.original?.event.description || ""), "textarea");
  if (row?.original) f.actions.append(button("删除日程／整个系列", async () => { if (confirm("删除此日程？重复日程将删除整个系列。")) { await command({ action: "event.delete", original: row.original!, start: row.start, end: row.end }); f.close(); } }));
  f.submit(() => command({ action: "event.save", original: row?.original, draft: { title: title.value, start: editedTime(start.value,row?.seriesStart??row?.start), end: editedTime(end.value,row?.seriesEnd??row?.end), calendarId: calendarId.value, allDay: allDay.value === "true", rrule: rule.value, description: description.value, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }));
}
function renderRecords(root: HTMLElement) {
  root.className = "records"; root.append(el("h2", "工时记录")); const tools = el("div", "", "tools"), from = el("input"), to = el("input"), rows = el("div"); from.type = to.type = "date"; from.value = selected.slice(0, 8) + "01"; to.value = selected; from.setAttribute("aria-label", "查询开始日期"); to.setAttribute("aria-label", "查询结束日期"); let offset = 0;
  let generation = 0, total = 0, range = { from: from.value, to: to.value };
  const queryRecords = async () => {
    const request = ++generation;
    const result = await api<{ total: number; records: WorkRecord[] }>(`/v1/history?from=${range.from}&to=${range.to}&offset=${offset}`);
    if (request !== generation || !rows.isConnected) return;
    total = result.total;
    if (offset && offset >= total) { offset = Math.max(0, Math.floor((total - 1) / 100) * 100); return queryRecords(); }
    previous.disabled = offset === 0; next.disabled = offset + 100 >= total;
    rows.replaceChildren(el("p", total ? `共 ${total} 条 · ${offset + 1}–${Math.min(total, offset + 100)}` : "这段时间暂无工时记录", "empty"));
    for (const record of result.records) {
      const item = el("article", "", "record"), visible = record.edit || record;
      const start = visible.segments[0]?.start ?? record.startedAt, end = visible.segments.at(-1)?.end ?? record.endedAt;
      item.append(el("strong", visible.title), el("time", timeRange(start, end), "time-range"), el("span", secondsText(visible.segments.reduce((sum, p) => sum + p.end - p.start, 0))), el("span", record.status === "saved" ? "已同步" : "待同步"));
      if (record.error) item.append(el("small", record.error, "error"));
      if (record.status === "saved" && visible.segments.length) item.append(button("修改", () => recordForm(record)));
      if (record.completeTask && !record.taskSaved && record.segments.every(p => p.saved)) item.append(button("确认仅保留工时，不完成原任务", () => command({ action: "record.calendar-only", recordId: record.id })));
      rows.append(item);
    }
  };
  const previous = button("上一页", () => { offset = Math.max(0, offset - 100); return queryRecords(); });
  const next = button("下一页", () => { offset += 100; return queryRecords(); });
  previous.disabled = next.disabled = true;
  tools.append(from, to, button("查询", () => { range = { from: from.value, to: to.value }; offset = 0; return queryRecords(); }), previous, next, button("补记", () => eventForm()));
  root.append(tools, rows);
  refreshHistory = queryRecords;
}
function recordForm(record: WorkRecord) {
  if (record.status !== "saved") throw new Error("这条记录有待同步的操作，请在同步后再编辑。");
  const f = form("编辑计时记录"), title = f.field("标题", record.title), calendarId = f.select("日历", state!.settings.calendarSources.filter(s => s.type === "caldav" && !s.readOnly), record.calendarId);
  const parts = record.segments.map((part, i) => ({ part, start: f.field(record.segments.length===1?"开始":`第 ${i + 1} 段开始`, localTime(part.start), "datetime-local"), end: f.field(record.segments.length===1?"结束":`第 ${i + 1} 段结束`, localTime(part.end), "datetime-local") }));
  f.submit(() => command({ action: "record.edit", record, title: title.value, calendarId: calendarId.value, segments: parts.map(p => ({ ...p.part, start: editedTime(p.start.value,p.part.start), end: editedTime(p.end.value,p.part.end) })) }));
}
function renderSettings(root: HTMLElement) {
  settingsSignature=JSON.stringify([state!.settings,state!.pending]);
  root.className = "settings"; root.append(appearanceSettings(), el("h2", "账户与同步"));
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
  if (mode === "main") startAppearance();
  if (window.__TAURI__) {
    await window.__TAURI__.event.listen<DesktopSnapshot>("desktop-state", event => { pushGeneration++; acceptSnapshot(event.payload); });
    await window.__TAURI__.event.listen<string>("native-error",event=>show(event.payload,true));
    await window.__TAURI__.event.listen<string>("backend-error",event=>{disconnected=true;show(event.payload||"桌面后台连接中断",true);const timer = app.querySelector<HTMLElement>("#timer"); if (timer) renderTimer(timer);});
    await window.__TAURI__.event.listen<boolean>("backend-ready", () => { state = undefined; daySignature = ""; historySignature = -1; void act(load); });
  }
  await load();
  if (window.__TAURI__) requestAnimationFrame(()=>requestAnimationFrame(()=>{void window.__TAURI__!.core.invoke("frontend_ready",{label:mode});}));
  setInterval(() => { if (!document.hidden) { if (viewDate !== dayKey()) render(); else timerText(); } }, 1000);
  document.addEventListener("visibilitychange", () => { if (!document.hidden) { timerText(); void act(load); } });
}
void act(start);
