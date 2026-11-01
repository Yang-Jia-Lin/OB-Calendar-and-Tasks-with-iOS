import { type Calendar, type Task, type Session, type TimelineRow } from "../../Shared/contracts";
import { dayKey, dateParts, elapsed, secondsText, shiftDate } from "../../Shared/time";
import { applyAppearance, type Appearance } from "./appearance";
import { orderedCategories, type CategoryPreferences } from "./categories";
import { el, button, options } from "./dom";
import { sortedTasks, taskSort, TASK_SORT_LABELS, type TaskSort } from "./taskOrder";
import type { SyncView } from "../../Shared/sync";
import { appPage, defaultFilters, filterTasks, focusTasks, refKey, type AppPage, type TaskCompletion, type TaskFilters, type TaskRef, type ApplicationActions } from "../../Shared/application";
export interface ViewModel {
  connected: boolean; busy: boolean; error: string; calendars: Calendar[]; sources: Calendar[];
  defaultCalendarId: string; active: Session | null; tasks: Task[]; date: string; rows: TimelineRow[];
  pending: { id: string; title: string; error: string; canKeep: boolean; canResolveMissing?: boolean; working?: boolean; status?: string }[];
  sync?: SyncView;
  appearance?: Partial<Appearance>;
  categoryPreferences?: CategoryPreferences;
  taskSort?: TaskSort;
  appPage?: AppPage; focusPins?: TaskRef[]; focusLimit?: number; linkedTasks?: TaskRef[]; completions?: TaskCompletion[];
}
export interface Actions extends ApplicationActions {
  connect(): void; refresh(): void; settings(): void; categorySettings(): void; openCalendar(): void;
  editTask(task: Task): void; editStart(): void; category(id: string): void;
  newEvent(): void; editRow(row: TimelineRow): void; retry(id: string): void; keep(id: string): void; resolveDeletion(id: string): void;
  sortTasks(mode: TaskSort): Promise<boolean>; reorderTasks(nextIds: string[], expectedIds: string[]): Promise<boolean>;
  page?(page: AppPage): void; pin?(task: Task): void; focusLimit?(limit: number): void; openCompletion?(event: TaskCompletion): void;
  mountCalendar?(root: HTMLElement): { activate(): void; dispose(): void };
}
export class TimerUI {
  private model!: ViewModel;
  private filter = "";
  private page: AppPage = "tasks";
  private filters: TaskFilters = defaultFilters();
  private pages = new Map<AppPage, HTMLElement>();
  private pageButtons = new Map<AppPage, HTMLButtonElement>();
  private pageScroll: Record<AppPage, number> = {timer:0,tasks:0,calendar:0};
  private calendar?: { activate(): void; dispose(): void };
  private focusList: HTMLElement;
  private focusCount: HTMLSelectElement;
  private focusNodes = new Map<string,{root:HTMLElement;title:HTMLElement;meta:HTMLElement;start:HTMLButtonElement}>();
  private timerBadge: HTMLElement;
  private filterDate: HTMLInputElement;
  private observer: ResizeObserver;
  private header: HTMLElement;
  private connect: HTMLButtonElement;
  private error: HTMLElement;
  private timer: HTMLElement;
  private title: HTMLElement;
  private status: HTMLElement;
  private readout: HTMLElement;
  private hand: HTMLElement;
  private category: HTMLSelectElement;
  private started: HTMLButtonElement;
  private controls: HTMLElement;
  private pause: HTMLButtonElement;
  private taskTitle: HTMLInputElement;
  private due: HTMLInputElement;
  private newCategory: HTMLSelectElement;
  private tabs: HTMLElement;
  private taskList: HTMLElement;
  private rowList: HTMLElement;
  private dateInput: HTMLInputElement;
  private pending: HTMLElement;
  private syncMenu: HTMLDetailsElement;
  private syncSummary: HTMLElement;
  private syncError: HTMLElement;
  private pendingNodes = new Map<string, { root: HTMLElement; title: HTMLElement; status: HTMLElement; error: HTMLElement; retry: HTMLButtonElement; keep: HTMLButtonElement; cleanup: HTMLButtonElement }>();
  private closeSync = (e: Event) => { if (this.syncMenu.open && !this.syncMenu.contains(e.target as Node)) this.syncMenu.open = false; };
  private escapeSync = (e: KeyboardEvent) => { if (e.key === "Escape" && this.syncMenu.open) { this.syncMenu.open = false; this.syncSummary.focus(); e.preventDefault(); } };
  private taskSort: HTMLSelectElement;
  private sortNotice: HTMLElement;
  private dragged?: { id: string; ids: string[] };
  private taskNodes = new Map<string, { root: HTMLElement; handle: HTMLButtonElement; text: HTMLButtonElement; meta: HTMLElement; timing: HTMLElement; pin: HTMLButtonElement; sessionId?: string; check: HTMLInputElement; start: HTMLButtonElement }>();
  private rowNodes = new Map<string, { root: HTMLButtonElement; start: HTMLElement; end: HTMLElement; link: HTMLElement; title: HTMLElement; meta: HTMLElement }>();
  constructor(private root: HTMLElement, private actions: Actions) {
    root.classList.add("ctt-shell"); root.replaceChildren();
    this.header = el(root, "header", "ctt-header"); el(this.header, "div", "ctt-brand", "日历与待办计时");
    const tools = el(this.header, "nav", "ctt-tools"); tools.setAttribute("aria-label", "日历工具");
    this.connect = button(tools, "连接日历", actions.connect, "ctt-primary");
    this.syncMenu = el(tools, "details", "ctt-sync-menu"); this.syncMenu.hidden = true;
    this.syncSummary = el(this.syncMenu, "summary", "ctt-sync-summary"); this.syncSummary.setAttribute("aria-label", "同步状态");
    const syncPanel = el(this.syncMenu, "div", "ctt-sync-panel"); el(syncPanel, "strong", "", "同步队列");
    this.syncError = el(syncPanel, "div", "ctt-dialog-error"); this.syncError.setAttribute("role", "alert");
    this.pending = el(syncPanel, "div", "ctt-pending");
    root.ownerDocument.addEventListener("pointerdown", this.closeSync); root.ownerDocument.addEventListener("keydown", this.escapeSync);
    button(tools, "↻", actions.refresh, "ctt-icon", "刷新"); button(tools, "完整日历", actions.openCalendar, "ctt-quiet"); button(tools, "⚙", actions.settings, "ctt-icon", "设置");
    tools.append(this.syncMenu);
    this.error = el(root, "div", "ctt-error"); this.error.setAttribute("role", "alert"); this.error.hidden = true;
    const navigation = el(root,"nav","ctt-page-tabs"); navigation.setAttribute("role","tablist"); navigation.setAttribute("aria-label","功能页面");
    const viewId=`ctt-${crypto.randomUUID()}`;
    for (const [id,label] of [["timer","计时"],["tasks","待办"],["calendar","日历"]] as const) {
      const b = button(navigation,label,()=>this.selectPage(id),"ctt-page-tab"); b.id=`${viewId}-tab-${id}`; b.setAttribute("role","tab"); b.setAttribute("aria-controls",`${viewId}-page-${id}`);
      b.onkeydown=e=>{if(!["ArrowLeft","ArrowRight","Home","End"].includes(e.key))return;e.preventDefault();const ids:AppPage[]=["timer","tasks","calendar"],i=ids.indexOf(id),next=e.key==="Home"?0:e.key==="End"?2:(i+(e.key==="ArrowLeft"?2:1))%3;this.selectPage(ids[next]);this.pageButtons.get(ids[next])!.focus();};
      this.pageButtons.set(id,b);
    }
    this.timerBadge=el(this.pageButtons.get("timer")!,"span","ctt-page-timer-badge"); this.timerBadge.setAttribute("aria-hidden","true");
    for(const id of ["timer","tasks","calendar"] as const){const panel=el(root,"section",`ctt-page ctt-${id}-page`);panel.id=`${viewId}-page-${id}`;panel.setAttribute("role","tabpanel");panel.setAttribute("aria-labelledby",`${viewId}-tab-${id}`);this.pages.set(id,panel);}
    this.timer = el(this.pages.get("timer")!, "section", "ctt-timer"); this.timer.setAttribute("aria-label", "当前计时");
    this.status = el(this.timer, "div", "ctt-status");
    this.title = el(this.timer, "h2", "ctt-current-title");
    const dial = el(this.timer, "div", "ctt-clock"); el(dial, "div", "ctt-clock-track"); this.hand = el(dial, "div", "ctt-clock-hand");
    this.readout = el(dial, "div", "ctt-readout", "00:00"); this.readout.setAttribute("aria-label", "累计专注时间");
    el(this.timer, "div", "ctt-idle-label", "开始一个任务吧");
    const details = el(this.timer, "div", "ctt-session-details"); this.started = button(details, "", actions.editStart, "ctt-quiet", "修改开始时间");
    this.category = el(details, "select", "ctt-category"); this.category.setAttribute("aria-label", "本次计时分类"); this.category.onchange = () => actions.category(this.category.value);
    this.controls = el(this.timer, "div", "ctt-timer-controls");
    this.pause = button(this.controls, "暂停", () => this.model.active?.runningSince == null ? actions.resume(this.model.active?.id || "") : actions.pause(this.model.active?.id || ""));
    button(this.controls, "结束并完成", () => actions.finish(true, this.model.active?.id || ""), "ctt-primary"); button(this.controls, "只记时间", () => actions.finish(false, this.model.active?.id || ""), "ctt-quiet");
    const focus = el(this.pages.get("timer")!,"section","ctt-focus-section"); const focusHead=el(focus,"div","ctt-panel-heading");el(focusHead,"h3","","重要待办");
    this.focusCount=el(focusHead,"select");this.focusCount.setAttribute("aria-label","计时页任务数量");for(let i=1;i<=10;i++)el(this.focusCount,"option","",`显示 ${i} 项`).value=String(i);this.focusCount.onchange=()=>this.actions.focusLimit?.(Number(this.focusCount.value));
    this.focusList=el(focus,"div","ctt-focus-list");button(focus,"查看全部待办",()=>this.selectPage("tasks"),"ctt-quiet");
    const body = el(this.pages.get("tasks")!, "div", "ctt-body");
    const timeline = el(body, "section", "ctt-panel ctt-timeline");
    const top = el(timeline, "div", "ctt-panel-heading"); el(top, "h3", "", "执行记录");
    const timelineTools = el(top, "div", "ctt-timeline-tools");
    const nav = el(timelineTools, "div", "ctt-date-nav"); button(nav, "‹", () => actions.date(shiftDate(this.model.date, -1)), "ctt-icon", "前一天");
    this.dateInput = el(nav, "input"); this.dateInput.type = "date"; this.dateInput.setAttribute("aria-label", "时间轴日期"); this.dateInput.onchange = () => { if (this.dateInput.value) actions.date(this.dateInput.value); };
    button(nav, "今天", () => actions.date(dayKey()), "ctt-quiet"); button(nav, "›", () => actions.date(shiftDate(this.model.date, 1)), "ctt-icon", "后一天");
    this.rowList = el(timeline, "div", "ctt-timeline-list"); this.rowList.setAttribute("aria-label", "当天工时与完成事项");
    const tasks = el(body, "section", "ctt-panel ctt-tasks"); const taskHead = el(tasks, "div", "ctt-panel-heading"); el(taskHead, "h3", "", "待办");
    const taskTools = el(taskHead, "div", "ctt-task-tools");
    this.taskSort = el(taskTools, "select", "ctt-task-sort"); this.taskSort.setAttribute("aria-label", "待办排序");
    for (const [value, text] of Object.entries(TASK_SORT_LABELS)) el(this.taskSort, "option", "", text).value = value;
    this.taskSort.onchange = () => { void actions.sortTasks(taskSort(this.taskSort.value)); };
    button(taskTools, "⇅", actions.categorySettings, "ctt-icon", "分类排序与显示");
    this.sortNotice = el(tasks, "div", "ctt-sort-notice"); this.sortNotice.setAttribute("role", "status"); this.sortNotice.setAttribute("aria-live", "polite");
    this.tabs = el(tasks, "div", "ctt-tabs"); this.tabs.setAttribute("aria-label", "待办分类筛选");
    const filters=el(tasks,"div","ctt-task-filters");
    for(const [key,label,choices] of [["association","关联筛选",{"all":"全部关联","linked":"Components 已关联","unlinked":"未关联"}],["status","完成状态",{"open":"未完成","done":"已完成","all":"全部状态"}],["due","截止日期筛选",{"all":"全部截止日期","today":"今天截止","overdue":"已逾期","none":"无截止日期","date":"指定截止日期"}]] as const){const select=el(filters,"select");select.setAttribute("aria-label",label);for(const [value,text] of Object.entries(choices))el(select,"option","",text).value=value;select.value=this.filters[key];select.onchange=()=>{(this.filters as any)[key]=select.value;this.filterDate.hidden=this.filters.due!=="date";this.renderTasks();this.tick();};}
    this.filterDate=el(filters,"input");this.filterDate.type="date";this.filterDate.value=this.filters.date;this.filterDate.hidden=true;this.filterDate.setAttribute("aria-label","指定截止日期");this.filterDate.onchange=()=>{this.filters.date=this.filterDate.value;this.renderTasks();this.tick();};
    const taskScroll = el(tasks, "div", "ctt-task-scroll"); taskScroll.setAttribute("aria-label", "待办内容");
    const form = el(taskScroll, "form", "ctt-inbox"); this.taskTitle = el(form, "input", "ctt-new-title"); this.taskTitle.placeholder = "添加一件要做的事…"; this.taskTitle.setAttribute("aria-label", "新待办名称"); this.taskTitle.required = true;
    const addTools = el(form, "div", "ctt-inbox-tools"); this.newCategory = el(addTools, "select"); this.newCategory.setAttribute("aria-label", "新待办分类"); this.newCategory.required = true;
    const dateLabel = el(addTools, "div", "ctt-optional-date");
    const dateToggle = button(dateLabel, "+ 日期", () => { this.due.hidden = !this.due.hidden; if (!this.due.hidden) { this.due.focus(); try { this.due.showPicker(); } catch {} } }, "ctt-quiet", "设置待办日期");
    this.due = el(dateLabel, "input"); this.due.type = "date"; this.due.hidden = true; this.due.setAttribute("aria-label", "待办日期，可留空");
    this.due.onchange = () => { dateToggle.hidden = !!this.due.value; if (!this.due.value) this.due.hidden = true; };
    const add = el(addTools, "button", "ctt-primary", "添加"); add.type = "submit";
    form.onsubmit = async e => { e.preventDefault(); if (await actions.add(this.taskTitle.value, this.due.value, this.newCategory.value)) { this.taskTitle.value = ""; this.due.value = ""; this.due.hidden = true; dateToggle.hidden = false; this.resetDraftCategory(); this.taskTitle.focus(); } };
    this.taskList = el(taskScroll, "div", "ctt-task-list"); this.taskList.setAttribute("aria-label", "未完成待办");
    this.observer = new ResizeObserver(entries => { const { width, height } = entries[0].contentRect;
      root.classList.toggle("ctt-stacked", width < 840 || width / Math.max(1, height) < 1.15);
      root.style.setProperty("--ctt-focus-height", `${Math.max(380, Math.min(660, height * .62, height - 330))}px`);
    }); this.observer.observe(root);
  }
  selectPage(page: AppPage, remember = true) {
    this.pageScroll[this.page]=this.root.scrollTop; this.page=page; this.root.dataset.page=page;
    for(const [id,panel] of this.pages) {panel.hidden=id!==page;const b=this.pageButtons.get(id)!;b.setAttribute("aria-selected",String(id===page));b.tabIndex=id===page?0:-1;}
    if(this.model){if(page==="tasks"){this.renderTasks();this.renderRows();}else if(page==="timer")this.renderFocus();else {if(!this.calendar)this.calendar=this.actions.mountCalendar?.(this.pages.get("calendar")!);this.calendar?.activate();}this.tick();}
    this.root.scrollTop=this.pageScroll[page]; if(remember)this.actions.page?.(page);
  }
  update(m: ViewModel) {
    const old = this.model; this.model = m;
    if(!old)this.selectPage(appPage(m.appPage),false);
    applyAppearance(this.root, m.appearance);
    this.root.classList.toggle("ctt-active", !!m.active); this.root.classList.toggle("ctt-paused", !!m.active && m.active.runningSince == null);
    this.root.setAttribute("aria-busy", String(m.busy)); this.connect.hidden = m.connected;
    this.taskSort.value = taskSort(m.taskSort); this.taskSort.disabled = m.busy;
    this.error.textContent = m.error; this.error.hidden = !m.error;
    this.title.textContent = m.active?.title || ""; this.status.textContent = m.active ? (m.active.runningSince == null ? "已暂停" : "专注中") : "";
    this.pause.textContent = m.active?.runningSince == null ? "继续" : "暂停";
    this.started.textContent = m.active ? `开始于 ${dateParts(m.active.startedAt).date.slice(5)} ${dateParts(m.active.startedAt).time.slice(0, 5)}` : "";
    options(this.category, m.calendars, m.active?.calendarId || "");
    const draft = this.newCategory.value;
    options(this.newCategory, m.calendars, (!old || !draft || (old.defaultCalendarId !== m.defaultCalendarId && !this.taskTitle.value)) ? (this.filter || m.defaultCalendarId) : draft);
    if (this.root.ownerDocument.activeElement !== this.dateInput) this.dateInput.value = m.date;
    if (JSON.stringify(old?.calendars) !== JSON.stringify(m.calendars) || JSON.stringify(old?.categoryPreferences) !== JSON.stringify(m.categoryPreferences)) this.renderTabs();
    this.focusCount.value=String(m.focusLimit || 5);
    if(this.page==="tasks"){this.renderTasks();this.renderRows();}else if(this.page==="timer")this.renderFocus();else this.calendar?.activate();
    this.syncMenu.hidden = !m.pending.length && !m.sync?.error;
    this.syncSummary.textContent = `${m.sync?.activeKey ? "↻" : m.pending.some(p => p.error) || m.sync?.error ? "!" : "↑"} ${m.pending.length}`;
    this.syncSummary.setAttribute("aria-label", `同步状态（${m.pending.length} 条待同步）`);
    this.syncSummary.title = this.syncSummary.getAttribute("aria-label")!;
    this.syncError.textContent = m.sync?.error ? `同步暂停：${m.sync.error}` : ""; this.syncError.hidden = !m.sync?.error;
    const pendingIds = new Set(m.pending.map(p => p.id));
    for (const [id, node] of this.pendingNodes) if (!pendingIds.has(id)) { node.root.remove(); this.pendingNodes.delete(id); }
    for (const p of m.pending) {
      let node = this.pendingNodes.get(p.id);
      if (!node) {
        const row = el(this.pending, "div", "ctt-pending-row"), text = el(row, "div");
        const title = el(text, "strong"), status = el(text, "div", "ctt-muted"), error = el(text, "div", "ctt-muted");
        const buttons = el(row, "div", "ctt-sync-actions");
        const retry = button(buttons, "重试", () => this.actions.retry(p.id));
        const keep = button(buttons, "仅保留日程", () => this.actions.keep(p.id));
        const cleanup = button(buttons, "清理本地残留", () => this.actions.resolveDeletion(p.id.slice(7)));
        node = { root: row, title, status, error, retry, keep, cleanup }; this.pendingNodes.set(p.id, node);
      }
      node.title.textContent = p.title; node.status.textContent = p.status || "本机已保存，等待同步"; node.error.textContent = p.error;
      node.keep.hidden = !p.canKeep; node.cleanup.hidden = !p.canResolveMissing;
      node.retry.disabled = node.keep.disabled = node.cleanup.disabled = !!p.working || m.busy || !m.connected;
    }
    for (const b of this.controls.querySelectorAll("button")) b.disabled = m.busy;
    this.category.disabled = m.busy; this.started.disabled = m.busy;
    this.tick();
  }
  private renderTabs() {
    const sources = orderedCategories(this.model.calendars, this.model.categoryPreferences, true); if (this.filter && !sources.some(c => c.id === this.filter)) { this.filter = ""; this.resetDraftCategory(); }
    this.tabs.replaceChildren();
    for (const c of [{ id: "", name: "全部" }, ...sources]) {
      const b = button(this.tabs, c.name, () => { this.filter = c.id; this.resetDraftCategory(); this.renderTabs(); this.renderTasks(); this.tick(); }, "ctt-tab");
      b.classList.toggle("is-selected", c.id === this.filter); b.setAttribute("aria-pressed", String(c.id === this.filter));
    }
  }
  private resetDraftCategory() { options(this.newCategory, this.model.calendars, this.filter || this.model.defaultCalendarId); }
  private taskSession(task: Task) {
    const active = this.model.active;
    return active && active.task.kind === task.kind && active.task.id === task.id &&
      (task.kind === "local" ? active.task.path === task.path : active.task.calendarId === task.calendarId) ? active : null;
  }
  private renderTasks() {
    const m = this.model, manual = taskSort(m.taskSort) === "manual" && this.filters.status==="open", linked=new Set((m.linkedTasks || []).map(refKey)), tasks = sortedTasks(filterTasks(m.tasks,this.filters,linked).filter(t => !this.filter || (t.calendarId || m.defaultCalendarId) === this.filter), taskSort(m.taskSort));
    const ids = tasks.map(t => t.id);
    const visibleIds = new Set(ids);
    for (const [id, item] of this.taskNodes) if (!visibleIds.has(id)) { item.root.remove(); this.taskNodes.delete(id); }
    this.taskList.querySelector(".ctt-empty")?.remove();
    if (!tasks.length) el(this.taskList, "div", "ctt-empty", "暂无待办");
    tasks.forEach((task, i) => {
      let item = this.taskNodes.get(task.id);
      if (!item) {
        const root = el(this.taskList, "div", "ctt-task-row"), handle = button(root, "⠿", () => {}, "ctt-drag-handle"), check = el(root, "input"); check.type = "checkbox";
        const body = el(root, "div", "ctt-task-text"), text = button(body, "", () => {}, "ctt-task-title"), meta = el(body, "div", "ctt-task-meta"), timing = el(body, "div", "ctt-task-timing");
        const pin=button(root,"☆",()=>{},"ctt-pin");const start = button(root, "▷", () => {}, "ctt-start", "开始计时"); item = { root, handle, check, text, meta, timing, pin, start }; this.taskNodes.set(task.id, item);
      }
      item.root.dataset.taskId = task.id;
      item.handle.hidden = !manual; item.handle.disabled = m.busy; item.handle.draggable = manual && !m.busy;
      item.handle.setAttribute("aria-label", `排序 ${task.title}`); item.handle.title = "拖动排序；Alt + ↑ / ↓ 调整顺序";
      item.handle.onkeydown = e => {
        if (!manual || m.busy || !e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
        e.preventDefault(); const to = i + (e.key === "ArrowUp" ? -1 : 1); if (to < 0 || to >= ids.length) return;
        const next = [...ids]; [next[i], next[to]] = [next[to], next[i]];
        void this.saveOrder(next, ids, task.id);
      };
      item.handle.ondragstart = e => {
        if (!manual || m.busy || !e.dataTransfer) { e.preventDefault(); return; }
        this.dragged = { id: task.id, ids: [...ids] }; e.dataTransfer.effectAllowed = "move"; e.dataTransfer.setData("text/plain", task.id); item!.root.classList.add("is-dragging");
      };
      item.handle.ondragend = () => this.clearDrag();
      item.root.ondragover = e => {
        if (!this.dragged || !manual || m.busy) return; e.preventDefault();
        this.taskList.querySelectorAll(".is-drop-before,.is-drop-after").forEach(n => n.classList.remove("is-drop-before", "is-drop-after"));
        item!.root.classList.add(e.clientY > item!.root.getBoundingClientRect().top + item!.root.clientHeight / 2 ? "is-drop-after" : "is-drop-before");
      };
      item.root.ondrop = e => {
        if (!this.dragged || !manual || m.busy) return; e.preventDefault();
        const source = this.dragged, next = source.ids.filter(id => id !== source.id), after = e.clientY > item!.root.getBoundingClientRect().top + item!.root.clientHeight / 2;
        this.clearDrag(); if (source.id === task.id || !next.includes(task.id)) return;
        next.splice(next.indexOf(task.id) + Number(after), 0, source.id); void this.saveOrder(next, source.ids);
      };
      const categoryId = task.calendarId || m.defaultCalendarId, category = m.sources.find(c => c.id === categoryId);
      const active = this.taskSession(task), paused = !!active && active.runningSince == null;
      item.sessionId = active?.id; item.timing.hidden = !active;
      item.root.dataset.timerState = active ? paused ? "paused" : "running" : "idle";
      item.root.classList.toggle("is-timing", !!active); item.root.classList.toggle("is-paused", paused);
      item.text.textContent = task.title; item.text.onclick = () => this.actions.editTask(task);
      item.check.setAttribute("aria-label", `${task.completed?"恢复":"完成"} ${task.title}`); item.check.checked = task.completed; item.check.disabled = m.busy || !!active;
      item.check.onchange = () => this.actions.complete(task);
      item.meta.textContent = [category?.name || "选择分类", task.due].filter(Boolean).join(" · "); item.meta.style.setProperty("--ctt-category-color", category?.color || "var(--interactive-accent)");
      if(task.completed){const completion=(m.completions || []).filter(e=>refKey(e.task)===refKey(task)).at(-1);item.meta.textContent+=completion?` · 插件完成于 ${dateParts(completion.completedAt).date} ${dateParts(completion.completedAt).time.slice(0,5)}`:" · 完成时间未知";}
      const pinned=(m.focusPins || []).some(p=>refKey(p)===refKey(task));item.pin.textContent=pinned?"★":"☆";item.pin.setAttribute("aria-pressed",String(pinned));item.pin.setAttribute("aria-label",`${pinned?"取消置顶":"置顶到计时页"} ${task.title}`);item.pin.onclick=()=>this.actions.pin?.(task);item.pin.disabled=m.busy;
      const label = active ? paused ? "继续计时" : "暂停计时" : "开始计时";
      item.start.textContent = active && !paused ? "Ⅱ" : "▷"; item.start.title = label; item.start.setAttribute("aria-label", label);
      item.start.onclick = () => { if (active) { if (paused) this.actions.resume(active.id); else this.actions.pause(active.id); } else this.actions.start(task); };
      item.start.disabled = task.completed || m.busy || (!active && (!!m.active || !m.connected || !m.calendars.some(c => c.id === categoryId)));
      // Only move DOM nodes if order actually changed, preserving focus on periodic refresh.
      if (this.taskList.children[i] !== item.root) this.taskList.insertBefore(item.root, this.taskList.children[i] || null);
    });
  }
  private renderFocus() {
    const m=this.model,tasks=focusTasks(m.tasks,m.focusPins || [],m.focusLimit || 5);
    const keys=new Set(tasks.map(refKey));for(const [key,node]of this.focusNodes)if(!keys.has(key)){node.root.remove();this.focusNodes.delete(key);}this.focusList.querySelector('.ctt-empty')?.remove();
    if(!tasks.length)el(this.focusList,"div","ctt-empty","今天没有截止任务，可在待办页用 ☆ 选择重要待办。");
    tasks.forEach((task,i)=>{const key=refKey(task);let node=this.focusNodes.get(key);if(!node){const row=el(this.focusList,"div","ctt-focus-task"),text=el(row,"div","ctt-task-text"),title=el(text,"div","ctt-task-title"),meta=el(text,"div","ctt-task-meta"),start=button(row,"开始计时",()=>{},"ctt-focus-start");node={root:row,title,meta,start};this.focusNodes.set(key,node);}node.root.dataset.taskId=task.id;node.title.textContent=task.title;node.meta.textContent=`${m.sources.find(c=>c.id===(task.calendarId||m.defaultCalendarId))?.name || "待办"}${task.due?` · 截止 ${task.due}`:""}`;
      const active=this.taskSession(task);node.start.textContent=active?"计时中":"开始计时";node.start.onclick=()=>this.actions.start(task);node.start.disabled=!!m.active||task.completed||m.busy||!m.connected||!m.calendars.some(c=>c.id===(task.calendarId||m.defaultCalendarId));if(this.focusList.children[i]!==node.root)this.focusList.insertBefore(node.root,this.focusList.children[i]||null);});
  }
  private clearDrag() { this.dragged = undefined; this.taskList.querySelectorAll(".is-dragging,.is-drop-before,.is-drop-after").forEach(n => n.classList.remove("is-dragging", "is-drop-before", "is-drop-after")); }
  private async saveOrder(next: string[], expected: string[], focusId?: string) {
    if (JSON.stringify(next) === JSON.stringify(expected)) return;
    const ok = await this.actions.reorderTasks(next, expected); this.sortNotice.textContent = ok ? "顺序已保存" : "排序未保存，请重试";
    if (focusId) this.taskNodes.get(focusId)?.handle.focus();
  }
  private renderRows() {
    const m = this.model;
    const works=m.rows.filter(r=>!!r.recordId), completions=(m.completions || []).filter(e=>dayKey(e.completedAt)===m.date);
    const entries=[...works.map(work=>({key:work.key,at:work.start,work,completion:undefined as TaskCompletion|undefined})),...completions.map(completion=>({key:`completion:${completion.id}`,at:completion.completedAt,work:undefined as TimelineRow|undefined,completion}))].sort((a,b)=>a.at-b.at||a.key.localeCompare(b.key));
    const keys = new Set(entries.map(r => r.key));
    for (const [key, item] of this.rowNodes) if (!keys.has(key)) { item.root.remove(); this.rowNodes.delete(key); }
    this.rowList.querySelector(".ctt-empty")?.remove();
    if (!entries.length) el(this.rowList, "div", "ctt-empty", "当天暂无已记录工时或完成事项");
    entries.forEach((entry, i) => {
      const row=entry.work;
      let item = this.rowNodes.get(entry.key);
      if (!item) {
        const root = button(this.rowList, "", () => {}, "ctt-event"), time = el(root, "span", "ctt-event-time");
        const start = el(time, "span", "ctt-event-start"), link = el(time, "span", "ctt-event-time-link"), end = el(time, "span", "ctt-event-end"); link.setAttribute("aria-hidden", "true");
        const body = el(root, "span", "ctt-event-body"), title = el(body, "span", "ctt-event-title"), meta = el(body, "span", "ctt-event-meta");
        item = { root, start, end, link, title, meta }; this.rowNodes.set(entry.key, item);
      }
      if(!row){const event=entry.completion!;item.start.textContent=dateParts(event.completedAt).time.slice(0,5);item.end.hidden=item.link.hidden=true;item.title.textContent=event.title;item.meta.textContent="完成事项";item.root.classList.add("ctt-completion");item.root.classList.remove("is-pending");item.root.title="查看原待办";item.root.onclick=()=>this.actions.openCompletion?.(event);if(this.rowList.children[i]!==item.root)this.rowList.insertBefore(item.root,this.rowList.children[i]||null);return;}
      const startDate = dayKey(row.start), endDate = dayKey(Math.max(row.start, row.end - 1));
      item.start.textContent = row.allDay ? "全天" : m.date > startDate ? "00:00" : dateParts(row.start).time.slice(0, 5);
      item.end.textContent = row.allDay ? "" : m.date < endDate ? "24:00" : dateParts(row.end).time.slice(0, 5);
      item.end.hidden = item.link.hidden = !!row.allDay;
      item.title.textContent = row.title;
      item.meta.textContent = `${m.sources.find(c => c.id === row.calendarId)?.name || "日历"}${row.recordId ? " · 计时" : ""}${row.deleting ? " · 待删除" : row.pending ? " · 待同步" : ""}`;
      item.root.style.setProperty("--ctt-category-color", row.color || m.sources.find(c => c.id === row.calendarId)?.color || "var(--interactive-accent)");
      item.root.classList.toggle("is-pending", !!row.pending); item.root.title = row.error || "编辑日程"; item.root.onclick = () => this.actions.editRow(row);
      if (this.rowList.children[i] !== item.root) this.rowList.insertBefore(item.root, this.rowList.children[i] || null);
    });
  }
  tick() {
    const ms = elapsed(this.model?.active || null); this.readout.textContent = this.model?.active ? secondsText(ms) : "00:00";
    this.timerBadge.textContent=this.model?.active?(this.model.active.runningSince==null?" · 已暂停":" · 计时中"):"";
    this.hand.style.transform = `rotate(${(ms / 60000) * 360}deg)`;
    const active = this.model?.active;
    if (active && this.page==="tasks") for (const item of this.taskNodes.values()) if (item.sessionId === active.id) item.timing.textContent = `${active.runningSince == null ? "已暂停" : "计时中"} · ${secondsText(ms)}`;
  }
  destroy() { this.calendar?.dispose();this.observer.disconnect(); this.root.ownerDocument.removeEventListener("pointerdown", this.closeSync); this.root.ownerDocument.removeEventListener("keydown", this.escapeSync); this.root.replaceChildren(); }
}
