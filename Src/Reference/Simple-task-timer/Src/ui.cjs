"use strict";
const { elapsed, secondsText, dayKey } = require("./core.cjs");

function element(parent, tag, cls, text) {
  const node = parent.ownerDocument.createElement(tag);
  if (cls) node.className = cls;
  if (text != null) node.textContent = text;
  parent.appendChild(node);
  return node;
}
function button(parent, text, action, cls = "", disabled = false) {
  const node = element(parent, "button", cls, text);
  node.type = "button"; node.disabled = disabled;
  node.addEventListener("click", action);
  return node;
}
function input(parent, type, value, placeholder, label) {
  const node = element(parent, "input");
  node.type = type; node.value = value || "";
  if (placeholder) node.placeholder = placeholder;
  if (label) node.setAttribute("aria-label", label);
  return node;
}
function shiftDate(date, offset) {
  const d = new Date(`${date}T12:00:00`);
  d.setDate(d.getDate() + offset);
  return dayKey(d.getTime());
}

function renderApp(root, model, actions) {
  const oldFocus = root.contains(root.ownerDocument.activeElement) ? root.ownerDocument.activeElement?.dataset?.draft : null;
  root.replaceChildren(); root.classList.add("simple-task-timer");
  const header = element(root, "header", "stt-header");
  const heading = element(header, "div");
  element(heading, "h2", "", "待办计时");
  element(heading, "p", "stt-muted", "开始做事，完成后留在日历里。");
  const tools = element(header, "div", "stt-inline");
  if (!model.connected) button(tools, "连接日历", actions.connect, "mod-cta", model.busy);
  else {
    element(tools, "span", "stt-connected", "日历已连接");
    button(tools, "刷新", actions.refresh, "", model.busy);
    button(tools, "完整日历", actions.openCalendar);
  }
  button(tools, "设置", actions.settings);
  if (model.error) element(root, "div", "stt-message stt-error", model.error);

  const target = element(root, "div", "stt-target");
  const label = element(target, "label", "", "计时写入"); label.htmlFor = "stt-target-calendar";
  const select = element(target, "select"); select.id = "stt-target-calendar";
  const emptyOption = element(select, "option", "", model.connected ? "选择一本 iCloud 日历…" : "连接 FCR 后选择日历"); emptyOption.value = "";
  for (const c of model.calendars) { const option = element(select, "option", "", c.name); option.value = c.id; }
  select.value = model.targetCalendarId || "";
  select.disabled = !model.connected || model.busy || !!model.active;
  select.addEventListener("change", () => actions.changeCalendar(select.value));

  const columns = element(root, "div", "stt-columns");
  const left = element(columns, "section", "stt-left");
  const timer = element(left, "section", "stt-timer");
  if (model.active) {
    const active = model.active;
    element(timer, "div", "stt-overline", active.runningSince == null ? "已暂停" : "正在计时");
    element(timer, "h3", "stt-current-title", active.title);
    const readout = element(timer, "div", "stt-time", secondsText(elapsed(active)));
    readout.dataset.timerReadout = "true";
    readout.setAttribute("aria-label", "累计专注时间");
    const controls = element(timer, "div", "stt-timer-controls");
    button(controls, active.runningSince == null ? "继续" : "暂停", active.runningSince == null ? actions.resume : actions.pause, "", model.busy);
    button(controls, "结束并完成", () => actions.finish(true), "mod-cta", model.busy);
    button(controls, "只记时间", () => actions.finish(false), "", model.busy);
    element(timer, "p", "stt-muted stt-small", "暂停不计时；结束后保存实际时间段。");
  } else {
    element(timer, "div", "stt-overline", "准备开始");
    element(timer, "div", "stt-time stt-idle", "00:00:00");
    element(timer, "p", "stt-muted", "选择下面一条待办，点击“计时”。");
  }

  const taskTop = element(left, "div", "stt-section-heading");
  element(taskTop, "h3", "", "待办");
  const sourceSelect = element(taskTop, "select"); sourceSelect.setAttribute("aria-label", "待办来源");
  for (const [value, title] of [["local", "OB 待办"], ["fcr", "FCR 待办"]]) {
    const option = element(sourceSelect, "option", "", title); option.value = value;
  }
  sourceSelect.value = model.taskSource;
  sourceSelect.addEventListener("change", () => actions.changeTaskSource(sourceSelect.value));

  if (model.taskSource === "local") {
    const form = element(left, "form", "stt-add-task");
    const titleInput = input(form, "text", model.draft.title, "添加一件要做的事…", "新待办名称");
    titleInput.dataset.draft = "title";
    titleInput.addEventListener("input", () => { model.draft.title = titleInput.value; });
    const details = element(form, "div", "stt-inline");
    const dueInput = input(details, "date", model.draft.due, "", "待办日期，可留空");
    dueInput.dataset.draft = "due";
    dueInput.addEventListener("input", () => { model.draft.due = dueInput.value; });
    element(details, "span", "stt-muted stt-small", "日期可留空");
    const add = element(details, "button", "mod-cta", "添加"); add.type = "submit"; add.disabled = model.busy;
    form.addEventListener("submit", e => { e.preventDefault(); actions.addTask(titleInput.value, dueInput.value); });
    element(left, "p", "stt-muted stt-small", "待办保存在笔记中，可随笔记同步；不会变成 Apple 提醒事项。");
  } else {
    element(left, "p", "stt-muted stt-small", "显示 FCR 已加载的带日期待办。重复待办暂不参与计时。");
    if (model.legacyReminders) element(left, "div", "stt-message", "iCloud 返回了旧版升级提示，真实 Apple 提醒事项尚未接入。这些提示已隐藏。");
  }

  const tasks = model.tasks.filter(t => !t.completed).sort((a, b) => (a.due || "9999").localeCompare(b.due || "9999"));
  const taskList = element(left, "div", "stt-task-list");
  if (!tasks.length) element(taskList, "p", "stt-empty", model.taskSource === "local" ? "添加第一条待办，就可以开始了。" : "暂时没有可读取的待办。你可以切换到 OB 待办。");
  for (const task of tasks) {
    const row = element(taskList, "div", "stt-task-row");
    const checkbox = input(row, "checkbox", "", "", `完成 ${task.title}`);
    checkbox.disabled = model.busy || model.active?.task?.id === task.id;
    checkbox.addEventListener("change", () => actions.completeTask(task));
    const text = element(row, "div", "stt-task-text");
    element(text, "div", "stt-task-title", task.title);
    const subtitle = [task.due ? `日期 ${task.due}` : "未设日期", task.sourceName].filter(Boolean).join(" · ");
    element(text, "div", "stt-muted stt-small", subtitle);
    button(row, "计时", () => actions.start(task), "stt-start", model.busy || !!model.active || !model.targetCalendarId);
  }
  const finishedCount = model.tasks.filter(t => t.completed).length;
  if (finishedCount) element(left, "p", "stt-muted stt-small", `已完成 ${finishedCount} 条（原始记录保留在待办来源中）`);

  const right = element(columns, "section", "stt-day");
  const nav = element(right, "div", "stt-section-heading");
  element(nav, "h3", "", "日历");
  const navTools = element(nav, "div", "stt-inline");
  button(navTools, "‹", () => actions.changeDate(shiftDate(model.date, -1))).setAttribute("aria-label", "前一天");
  button(navTools, "今天", () => actions.changeDate(dayKey()));
  button(navTools, "›", () => actions.changeDate(shiftDate(model.date, 1))).setAttribute("aria-label", "后一天");
  const dateInput = input(right, "date", model.date, "", "查看日历日期"); dateInput.classList.add("stt-day-picker");
  dateInput.addEventListener("change", () => { if (dateInput.value) actions.changeDate(dateInput.value); });
  const dayTools = element(right, "div", "stt-inline stt-day-actions");
  button(dayTools, "新增日程", actions.newEvent, "", !model.connected || !model.targetCalendarId || model.busy);
  element(dayTools, "span", "stt-muted stt-small", model.timezone);
  const dueTasks = model.tasks.filter(t => !t.completed && t.due === model.date);
  if (dueTasks.length) {
    const dueBox = element(right, "div", "stt-due-tasks");
    element(dueBox, "div", "stt-overline", "当天待办");
    for (const task of dueTasks) element(dueBox, "div", "stt-due-title", `□ ${task.title}`);
  }
  if (!model.connected) element(right, "p", "stt-empty", "连接 FCR 后，在这里查看日程。");
  else if (!model.events.length) element(right, "p", "stt-empty", "当天没有已加载的日程。");
  for (const event of model.events) {
    const row = element(right, "button", "stt-event"); row.type = "button";
    if (event.color) row.style.borderLeftColor = event.color;
    element(row, "div", "stt-event-time", event.allDay ? "全天" : `${event.startTime.slice(0, 5)} – ${event.endTime.slice(0, 5)}`);
    const body = element(row, "div");
    element(body, "div", "stt-event-title", event.title);
    element(body, "div", "stt-muted stt-small", model.calendarNames[event.calendarId] || "日历");
    row.addEventListener("click", () => actions.editEvent(event));
  }
  if (model.recurringCount) element(right, "p", "stt-muted stt-small", "此简洁视图仅展示单次日程；重复日程请点“完整日历”查看。");

  const pending = model.records.filter(r => r.status !== "saved");
  if (pending.length) {
    const box = element(root, "section", "stt-outbox");
    element(box, "h3", "", `待同步 ${pending.length} 条`);
    for (const r of pending) {
      const row = element(box, "div", "stt-pending-row");
      const info = element(row, "div");
      element(info, "strong", "", r.title);
      element(info, "div", "stt-muted stt-small", r.error || "记录已保存在本机，等待写入日历。");
      const controls = element(row, "div", "stt-inline");
      button(controls, "重试", () => actions.retry(r.id), "", model.busy || !model.connected);
      if (r.completeTask && !r.taskSaved && r.segments.every(s => s.saved)) button(controls, "仅保留日程", () => actions.keepCalendarOnly(r.id), "", model.busy);
    }
  }
  const recent = [...model.records].reverse().slice(0, 8);
  if (recent.length) {
    const history = element(root, "details", "stt-history");
    element(history, "summary", "", "最近计时记录");
    for (const r of recent) {
      const row = element(history, "div", "stt-history-row");
      element(row, "span", "", r.title);
      const duration = r.segments.reduce((sum, s) => sum + s.end - s.start, 0);
      element(row, "span", "stt-muted", `${secondsText(duration)} · ${r.status === "saved" ? "已保存" : "待同步"}`);
    }
  }
  if (oldFocus) root.querySelector(`[data-draft="${oldFocus}"]`)?.focus();
}

module.exports = { element, button, input, shiftDate, renderApp };
