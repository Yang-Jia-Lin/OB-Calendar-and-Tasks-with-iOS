/* 简洁待办计时 0.1.0 — source included in src/; MIT */
(function(outerRequire, outerModule) {
const modules = {"core": function(module, exports, require) {
"use strict";

const clone = value => JSON.parse(JSON.stringify(value));
const uid = () => globalThis.crypto.randomUUID();
const isDone = value => value === true || (typeof value === "string" && value.length > 0);
const legacyReminder = title => /creator of this list.*upgraded|where are my reminders|此列表的创建者.*升|哪里.*找到.*提醒|提醒事项.*在哪里/i.test(title || "");

function dateParts(ms, zone) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: zone, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", second: "2-digit", hourCycle: "h23"
  }).formatToParts(new Date(ms));
  const p = Object.fromEntries(parts.map(x => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
}

function dayKey(ms = Date.now(), zone = Intl.DateTimeFormat().resolvedOptions().timeZone) {
  return dateParts(ms, zone).date;
}

function secondsText(ms) {
  const total = Math.max(0, Math.floor(ms / 1000));
  return [Math.floor(total / 3600), Math.floor(total / 60) % 60, total % 60].map(x => String(x).padStart(2, "0")).join(":");
}

function elapsed(session, now = Date.now()) {
  if (!session) return 0;
  return session.segments.reduce((sum, x) => sum + Math.max(0, x.end - x.start), 0) +
    (session.runningSince == null ? 0 : Math.max(0, now - session.runningSince));
}

function newSession(task, calendarId, now, zone, id = uid()) {
  if (!task || !task.id || !String(task.title || "").trim()) throw new Error("请先选择一条待办。");
  if (!calendarId) throw new Error("请先选择用于接收计时记录的日历。");
  return { id, title: task.title, task: clone(task), calendarId, zone, startedAt: now,
    runningSince: now, lastHeartbeat: now, segments: [] };
}

function pauseSession(session, now) {
  if (!session) throw new Error("没有正在计时的待办。");
  const next = clone(session);
  if (next.runningSince != null) {
    if (now < next.runningSince) throw new Error("系统时间发生倒退，请核对电脑时间。");
    if (now > next.runningSince) next.segments.push({ start: next.runningSince, end: now });
    next.runningSince = null;
  }
  next.lastHeartbeat = now;
  return next;
}

function resumeSession(session, now) {
  if (!session || session.runningSince != null) throw new Error("当前计时状态不能继续。");
  return { ...clone(session), runningSince: now, lastHeartbeat: now };
}

function recoverSession(session) {
  if (!session || session.runningSince == null) return session;
  return pauseSession(session, Math.max(session.runningSince, Math.min(session.lastHeartbeat || session.runningSince, Date.now())));
}

function stopSession(session, now, completeTask) {
  const ended = pauseSession(session, now);
  const segments = ended.segments.filter(x => x.end - x.start >= 1000).map((x, i) => ({
    ...x, uid: `simple-task-timer-${ended.id}-${i}`, saved: false
  }));
  if (segments.length === 0) throw new Error("计时不足一秒，请稍后再结束。");
  return { ...ended, endedAt: now, segments, completeTask: !!completeTask, taskSaved: !completeTask,
    status: "pending", error: "" };
}

function eventForSegment(record, segment) {
  // Write UTC to avoid ambiguous wall times during daylight-saving transitions.
  // FCR and Apple Calendar convert these instants into their configured display zone.
  const start = dateParts(segment.start, "UTC");
  // FCR supports ISO seconds. Floor to seconds; each stored segment is at least one second.
  const end = dateParts(Math.max(segment.end, Math.floor(segment.start / 1000) * 1000 + 1000), "UTC");
  return { type: "single", uid: segment.uid, title: record.title, date: start.date,
    endDate: end.date, startTime: start.time, endTime: end.time, allDay: false,
    timezone: "UTC", isTask: false,
    description: `实际计时：${secondsText(segment.end - segment.start)}\n原待办：${record.title}\n记录编号：${segment.uid}` };
}

function blankJournal() { return { version: 1, active: null, records: [] }; }
function validateJournal(data) {
  if (!data || data.version !== 1 || !Array.isArray(data.records)) throw new Error("计时记录格式不正确。");
  const validateSession = (s, record) => {
    if (!s || typeof s.id !== "string" || !s.task || typeof s.task.id !== "string" || !s.calendarId || !s.zone || !Number.isFinite(s.startedAt) || !Array.isArray(s.segments)) throw new Error("计时记录不完整。");
    dateParts(s.startedAt, s.zone);
    if (s.runningSince != null && !Number.isFinite(s.runningSince)) throw new Error("计时开始时间不正确。");
    for (const part of s.segments) {
      if (!Number.isFinite(part.start) || !Number.isFinite(part.end) || part.end < part.start || (record && typeof part.uid !== "string")) throw new Error("计时时间段不正确。");
    }
  };
  if (data.active) validateSession(data.active, false);
  for (const record of data.records) validateSession(record, true);
  return clone(data);
}

// Transitions are persisted before remote effects. Failed effects remain in the outbox.
class TimerController {
  constructor({ state, persist, calendar, tasks, now = () => Date.now(), zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone, onChange = () => {} }) {
    this.state = validateJournal(state || blankJournal());
    this.persist = persist; this.calendar = calendar; this.tasks = tasks;
    this.now = now; this.zone = zone; this.onChange = onChange;
    this.serial = Promise.resolve();
  }
  lock(fn) {
    const result = this.serial.then(fn);
    this.serial = result.catch(() => {});
    return result;
  }
  async commit(next, notify = true) {
    await this.persist(clone(next));
    this.state = next;
    if (notify) this.onChange();
  }
  async recover() {
    if (!this.state.active || this.state.active.runningSince == null) return false;
    await this.commit({ ...this.state, active: recoverSession(this.state.active) });
    return true;
  }
  start(task, calendarId) { const now = this.now(); return this.lock(async () => {
    if (this.state.active) throw new Error("已有一条待办正在计时，请先结束它。");
    this.calendar.assertWritable(calendarId);
    await this.commit({ ...this.state, active: newSession(task, calendarId, now, this.zone()) });
  }); }
  pause() { const now = this.now(); return this.lock(() => this.commit({ ...this.state, active: pauseSession(this.state.active, now) })); }
  resume() { const now = this.now(); return this.lock(() => this.commit({ ...this.state, active: resumeSession(this.state.active, now) })); }
  heartbeat() { return this.lock(async () => {
    if (this.state.active?.runningSince != null) {
      await this.commit({ ...this.state, active: { ...this.state.active, lastHeartbeat: this.now() } }, false);
    }
  }); }
  finish(completeTask = true) { const now = this.now(); return this.lock(async () => {
    if (!this.state.active) throw new Error("没有正在计时的待办。");
    const record = stopSession(this.state.active, now, completeTask);
    await this.commit({ ...this.state, active: null, records: [...this.state.records, record] });
    return this.flushRecord(record.id);
  }); }
  retry(id) { return this.lock(() => this.flushRecord(id)); }
  async replaceRecord(nextRecord) {
    await this.commit({ ...this.state, records: this.state.records.map(r => r.id === nextRecord.id ? clone(nextRecord) : r) });
  }
  async flushRecord(id) {
    const existing = this.state.records.find(x => x.id === id);
    if (!existing) return null;
    let record = clone(existing);
    if (record.status === "saved") return record;
    try {
      this.calendar.assertWritable(record.calendarId);
      for (const part of record.segments) {
        if (part.saved) continue;
        await this.calendar.ensureEvent(record.calendarId, eventForSegment(record, part));
        part.saved = true;
        record.error = "";
        await this.replaceRecord(record);
      }
      if (record.completeTask && !record.taskSaved) {
        await this.tasks.complete(record.task);
        record.taskSaved = true;
      }
      record.status = "saved";
      record.error = "";
      await this.replaceRecord(record);
    } catch (error) {
      record.status = "pending";
      record.error = error.message || "写入失败，请重试。";
      await this.replaceRecord(record);
    }
    return record;
  }
  keepCalendarOnly(id) { return this.lock(async () => {
    const record = this.state.records.find(x => x.id === id);
    if (!record || record.segments.some(x => !x.saved)) throw new Error("请先成功保存全部日历时间段。");
    await this.replaceRecord({ ...record, completeTask: false, taskSaved: true, status: "saved", error: "" });
  }); }
}

module.exports = { clone, uid, isDone, legacyReminder, dateParts, dayKey, secondsText, elapsed,
  newSession, pauseSession, resumeSession, recoverSession, stopSession, eventForSegment,
  blankJournal, validateJournal, TimerController };

},
"tasks": function(module, exports, require) {
"use strict";
const { uid } = require("./core.cjs");

const LINE = /^(\s*-\s+\[)([ xX])(\]\s+)(.*)$/;
const MARK = /\s*<!--\s*simple-task:([a-zA-Z0-9-]+)\s*-->\s*$/;
const DUE = /(?:^|\s)📅\s*(\d{4}-\d{2}-\d{2})(?=\s|$)/;

function ensureTaskIds(text, makeId = uid) {
  const eol = text.includes("\r\n") ? "\r\n" : "\n";
  const seen = new Set();
  return text.split(/\r?\n/).map(line => {
    const match = line.match(LINE);
    if (!match) return line;
    const mark = match[4].match(MARK);
    if (mark && !seen.has(mark[1])) { seen.add(mark[1]); return line; }
    const id = makeId(); seen.add(id);
    return line.replace(MARK, "") + ` <!-- simple-task:${id} -->`;
  }).join(eol);
}

function parseTasks(text, path) {
  return text.split(/\r?\n/).flatMap((line, index) => {
    const m = line.match(LINE);
    if (!m) return [];
    const marker = m[4].match(MARK);
    if (!marker) return [];
    const body = m[4].replace(MARK, "");
    const due = body.match(DUE)?.[1] || "";
    return [{ id: marker[1], title: body.replace(DUE, "").trim(), due,
      completed: m[2].toLowerCase() === "x", kind: "local", path, line: index }];
  });
}

function completeTaskText(text, id) {
  let found = false;
  const next = text.replace(/[^\r\n]+/g, line => {
    const match = line.match(LINE);
    if (match && match[4].match(MARK)?.[1] === id) {
      found = true;
      return match[1] + "x" + match[3] + match[4];
    }
    return line;
  });
  if (!found) throw new Error("原待办已被删除或移动；日历记录会保留。");
  return next;
}

function taskLine(title, due = "", id = uid()) {
  const clean = String(title || "").replace(/[\r\n]+/g, " ").replace(/<!--|-->/g, "").trim();
  if (!clean) throw new Error("请填写待办名称。");
  if (due && (!/^\d{4}-\d{2}-\d{2}$/.test(due) || Number.isNaN(Date.parse(`${due}T00:00:00Z`)) || new Date(`${due}T00:00:00Z`).toISOString().slice(0, 10) !== due)) throw new Error("待办日期不正确。");
  return `- [ ] ${clean}${due ? ` 📅 ${due}` : ""} <!-- simple-task:${id} -->`;
}

class MarkdownTasks {
  constructor(app, getPath) { this.app = app; this.getPath = getPath; }
  path() {
    const path = String(this.getPath() || "待办计时/待办.md").replace(/\\/g, "/");
    if (path.startsWith("/") || path.split("/").some(x => x === ".." || x.startsWith(".")) || !path.endsWith(".md") || path.includes(":")) throw new Error("请使用笔记库内的普通 Markdown 文件路径。");
    return path;
  }
  async file(create = false) {
    const path = this.path();
    let file = this.app.vault.getAbstractFileByPath(path);
    if (!file && create) {
      const parts = path.split("/"); parts.pop();
      let folder = "";
      for (const part of parts) {
        folder = folder ? `${folder}/${part}` : part;
        if (!this.app.vault.getAbstractFileByPath(folder)) await this.app.vault.createFolder(folder);
      }
      file = await this.app.vault.create(path, "# 待办\n\n");
    }
    if (file && !file.extension) throw new Error("待办路径指向文件夹，请更改路径。");
    return file;
  }
  async list() {
    const file = await this.file();
    if (!file) return [];
    const text = await this.app.vault.read(file);
    const normalized = ensureTaskIds(text);
    if (normalized !== text) {
      // Recompute inside process, preserving concurrent user edits.
      await this.app.vault.process(file, current => ensureTaskIds(current));
      return parseTasks(await this.app.vault.read(file), file.path);
    }
    return parseTasks(text, file.path);
  }
  async add(title, due) {
    const line = taskLine(title, due);
    const file = await this.file(true);
    await this.app.vault.process(file, current => `${current.trimEnd()}\n${line}\n`);
  }
  async complete(task) {
    const file = this.app.vault.getAbstractFileByPath(task.path);
    if (!file || file.extension !== "md") throw new Error("找不到原待办文件；日历记录会保留。");
    await this.app.vault.process(file, current => completeTaskText(current, task.id));
  }
}

module.exports = { ensureTaskIds, parseTasks, completeTaskText, taskLine, MarkdownTasks };

},
"fcr": function(module, exports, require) {
"use strict";
const { clone, isDone, legacyReminder, dayKey } = require("./core.cjs");

const SCOPES = ["events:read", "events:write", "providers:read", "providers:write", "ui:open-calendar"];

function flattenEvents(groups) {
  if (!Array.isArray(groups)) return [];
  return groups.flatMap(group => (Array.isArray(group.events) ? group.events : []).flatMap(item => {
    if (!item || !item.event || !item.id) return [];
    return [{ id: item.id, event: item.event, calendarId: group.id, color: group.color }];
  }));
}

function taskFromEntry(item, source) {
  const e = item.event;
  const task = e.isTask === true || (e.completed !== undefined && e.completed !== null);
  if (!task || legacyReminder(e.title) || e.type !== "single") return null;
  return { id: item.id, uid: e.uid || "", title: e.title || "未命名待办", due: e.date || "",
    completed: isDone(e.completed), kind: "fcr", calendarId: item.calendarId,
    sourceName: source?.name || "FCR", sourceType: source?.type || "" };
}

function entryForDay(item, date, zone) {
  const e = item.event;
  if (e.isTask || e.completed != null || legacyReminder(e.title)) return null;
  if (e.type !== "single") return null;
  // QueryableEvent gives timezone-normalized milliseconds for single events.
  const eventZone = e.timezone || zone;
  const start = e.date;
  const end = e.endDate || start;
  if (!start || date < start || date > end) return null;
  return { ...item, title: e.title || "未命名日程", allDay: !!e.allDay,
    displayDate: date, crossDay: start !== end,
    startTime: date > start ? "00:00" : (e.startTime || ""),
    endTime: date < end ? "24:00" : (e.endTime || ""), timezone: eventZone };
}

class FcrBridge {
  constructor(app, readToken, writeToken) {
    this.app = app; this.readToken = readToken; this.writeToken = writeToken; this.authorized = null;
  }
  plugin() {
    return this.app.plugins?.getPlugin?.("full-calendar-remastered") ||
      this.app.plugins?.plugins?.["full-calendar-remastered"] || null;
  }
  async connect(interactive = false) {
    const api = this.plugin()?.api;
    if (!api || typeof api.withToken !== "function") throw new Error("请先安装并启用 Full Calendar Remastered 0.13.7 或兼容版本。");
    let token = await this.readToken();
    this.authorized = token ? api.withToken(token) : null;
    if (!this.authorized && interactive) {
      token = await api.requestAccess("simple-task-timer", "读取待办与日程，并将你主动结束的计时写入所选日历。", SCOPES);
      if (token) { await this.writeToken(token); this.authorized = api.withToken(token); }
    }
    if (!this.authorized) throw new Error("请点击“连接日历”，在 FCR 中授权。");
    // Validate the relevant scopes immediately, rather than failing after a timer stops.
    this.authorized.getCalendarSources();
    this.authorized.getAllEvents();
    return this;
  }
  api() {
    if (!this.authorized) throw new Error("日历尚未连接，请先连接 FCR。");
    return this.authorized;
  }
  sources() {
    // Never retain, log or export FCR credentials returned with a source object.
    return this.api().getCalendarSources().map(s => ({ id: s.id, name: s.name || s.id, type: s.type, color: s.color }));
  }
  writableCalendars() {
    // CalDAV honors our deterministic UID and resource URL, including after a network timeout.
    return this.sources().filter(s => s.type === "caldav" && this.api().getProviderCapabilities(s.id)?.canCreate);
  }
  assertWritable(calendarId) {
    if (!this.writableCalendars().some(s => s.id === calendarId)) throw new Error("接收日历不可写或已移除。请连接并选择一本可写的 iCloud／CalDAV 日历。");
  }
  entries() { return flattenEvents(this.api().getAllEvents()); }
  async ensureEvent(calendarId, event) {
    this.assertWritable(calendarId);
    const existing = this.entries().find(x => x.calendarId === calendarId && x.event.uid === event.uid);
    if (existing) return;
    const ok = await this.api().createEvent(calendarId, clone(event));
    if (ok !== true) throw new Error("日历写入未成功。计时已在电脑保存，可以稍后重试。");
  }
  remoteTasks() {
    const sources = this.sources();
    return this.entries().map(item => taskFromEntry(item, sources.find(s => s.id === item.calendarId))).filter(Boolean);
  }
  hasLegacyReminders() { return this.entries().some(x => legacyReminder(x.event.title)); }
  async complete(task) {
    const found = this.entries().find(x => x.calendarId === task.calendarId &&
      (task.uid ? x.event.uid === task.uid : x.id === task.id));
    if (!found) throw new Error("FCR 中找不到原待办，请先刷新日历，再重试完成。");
    if (found.event.type !== "single") throw new Error("首版暂不支持自动完成重复待办；日历记录会保留。");
    if (!taskFromEntry(found, {})) throw new Error("原条目已不再是待办；日历记录会保留。");
    if (isDone(found.event.completed)) return;
    const ok = await this.api().processEvent(found.id, current => {
      if (!taskFromEntry({ ...found, event: current }, {})) throw new Error("原条目已不再是待办。");
      return { ...current, isTask: true, completed: new Date().toISOString() };
    });
    if (ok !== true) throw new Error("计时已写入日历，但原待办完成状态未保存，请重试。");
  }
  dayEvents(date) {
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    // Use the public query engine for true timezone conversion; join raw entries for editing.
    let query;
    try { query = this.api().getEvents({}, []); } catch { query = []; }
    const byId = new Map(query.map(x => [x.id, x]));
    return this.entries().flatMap(item => {
      const q = byId.get(item.id);
      const raw = item.event;
      if (q && Number.isFinite(q.startMillis) && !raw.allDay && raw.type === "single" && !q.isTask) {
        const start = q.startMillis;
        const end = Number.isFinite(q.endMillis) ? q.endMillis : start + 3600000;
        const first = dayKey(start, zone);
        const last = dayKey(Math.max(start, end - 1), zone);
        if (date < first || date > last) return [];
        const format = ms => new Intl.DateTimeFormat("en-GB", { hour: "2-digit", minute: "2-digit", hourCycle: "h23", timeZone: zone }).format(new Date(ms));
        return [{ ...item, title: raw.title, allDay: false, displayDate: date, crossDay: first !== last, startMillis: start, endMillis: end,
          startTime: date > first ? "00:00" : format(start),
          endTime: date < last ? "24:00" : format(end), timezone: zone }];
      }
      const entry = entryForDay(item, date, zone);
      return entry ? [entry] : [];
    }).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.startTime.localeCompare(b.startTime));
  }
  recurringCount() { return this.entries().filter(x => x.event.type !== "single").length; }
  async saveManualEvent({ title, date, startTime, endTime, calendarId }, original = null) {
    const cleanTitle = String(title || "").trim();
    if (!cleanTitle) throw new Error("请填写日程标题。");
    const validDate = /^\d{4}-\d{2}-\d{2}$/.test(date) && Number.isFinite(Date.parse(`${date}T00:00:00Z`)) && new Date(`${date}T00:00:00Z`).toISOString().slice(0, 10) === date;
    const validTime = value => /^(?:[01]\d|2[0-3]):[0-5]\d(?::[0-5]\d)?$/.test(value);
    const seconds = value => value.split(":").reduce((sum, x, i) => sum + Number(x) * [3600, 60, 1][i], 0);
    if (!validDate || !validTime(startTime) || !validTime(endTime) || seconds(startTime) >= seconds(endTime)) throw new Error("请填写有效日期及开始、结束时间；跨日记录请在 FCR 中编辑。");
    const body = { ...(original?.event || {}), type: "single", title: cleanTitle, date, endDate: date,
      startTime, endTime, allDay: false, isTask: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    if (original) {
      if (original.event.type !== "single" || original.crossDay) throw new Error("请在 FCR 中编辑跨日或重复日程。");
      const capabilities = this.api().getProviderCapabilities(original.calendarId);
      if (!capabilities?.canEdit) throw new Error("该日程只读。");
      const current = this.entries().find(x => x.id === original.id && x.calendarId === original.calendarId);
      if (!current) throw new Error("日程已变化，请刷新后再编辑。");
      if (JSON.stringify(current.event) !== JSON.stringify(original.event)) throw new Error("日程已被其他位置修改，请关闭编辑框，刷新后再编辑。");
      const ok = await this.api().updateEvent(current.id, { ...current.event, ...body });
      if (ok !== true) throw new Error("日程修改未成功，请稍后重试。");
    } else {
      this.assertWritable(calendarId);
      const ok = await this.api().createEvent(calendarId, body);
      if (ok !== true) throw new Error("日程创建未成功，请稍后重试。");
    }
  }
  refresh() { this.api().revalidateRemoteCalendars(true); }
  openCalendar() { return this.api().openCalendar(); }
}

module.exports = { SCOPES, flattenEvents, taskFromEntry, entryForDay, FcrBridge };

},
"ui": function(module, exports, require) {
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

},
"plugin": function(module, exports, require) {
"use strict";
const { Plugin, ItemView, PluginSettingTab, Setting, Modal, Notice, normalizePath } = require("obsidian");
const { TimerController, blankJournal, validateJournal, dayKey, dateParts, elapsed, secondsText, clone, uid } = require("./core.cjs");
const { MarkdownTasks } = require("./tasks.cjs");
const { FcrBridge } = require("./fcr.cjs");
const { element, button, input, renderApp } = require("./ui.cjs");

const VIEW = "simple-task-timer-view";
const DEFAULT_SETTINGS = { targetCalendarId: "", tasksPath: "待办计时/待办.md", taskSource: "local" };

function hash(text) {
  let h = 2166136261;
  for (const c of text) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  return (h >>> 0).toString(16);
}

class TaskTimerView extends ItemView {
  constructor(leaf, owner) { super(leaf); this.owner = owner; }
  getViewType() { return VIEW; }
  getDisplayText() { return "待办计时"; }
  getIcon() { return "timer"; }
  async onOpen() { this.contentEl.addClass("stt-view-root"); this.render(); }
  async onClose() {}
  render() {
    const p = this.owner;
    renderApp(this.contentEl, p.model(), {
      connect: () => p.run(async () => { await p.bridge.connect(true); p.connected = true; await p.refreshData(); }),
      refresh: () => p.run(async () => {
        p.bridge.refresh(); await p.refreshData();
        p.later(() => p.refreshQuiet(), 1600); p.later(() => p.refreshQuiet(), 5000);
      }),
      settings: () => { p.app.setting.open(); p.app.setting.openTabById(p.manifest.id); },
      openCalendar: () => p.run(() => p.bridge.openCalendar()),
      changeCalendar: id => p.run(async () => { p.settings.targetCalendarId = id; await p.saveSettings(); }),
      changeTaskSource: source => p.run(async () => { p.settings.taskSource = source; await p.saveSettings(); await p.refreshData(); }),
      changeDate: date => { p.date = date; p.render(); },
      addTask: (title, due) => p.run(async () => {
        await p.localTasks.add(title, due); p.draft.title = ""; p.draft.due = ""; await p.refreshData();
      }),
      completeTask: task => p.run(async () => { await p.completeTask(task); await p.refreshData(); }),
      start: task => p.run(() => p.controller.start(task, p.settings.targetCalendarId)),
      pause: () => p.run(() => p.controller.pause()),
      resume: () => p.run(() => p.controller.resume()),
      finish: complete => p.run(async () => {
        const record = await p.controller.finish(complete);
        if (record.status === "saved") new Notice(complete ? "实际时间已写入日历，待办已完成。" : "实际时间已写入日历，待办仍保留。");
        else new Notice("计时已保存在本机，待同步记录可以稍后重试。");
        await p.refreshData();
      }),
      retry: id => p.run(async () => { await p.controller.retry(id); await p.refreshData(); }),
      keepCalendarOnly: id => p.run(async () => { await p.controller.keepCalendarOnly(id); await p.refreshData(); }),
      newEvent: () => new EventModal(p, null).open(),
      editEvent: event => {
        if (event.allDay || event.crossDay) {
          new Notice("全天与跨日日程请在完整 FCR 日历中编辑。");
          p.run(() => p.bridge.openCalendar());
        } else new EventModal(p, clone(event)).open();
      }
    });
  }
}

class EventModal extends Modal {
  constructor(owner, original) { super(owner.app); this.owner = owner; this.original = original; }
  onOpen() {
    const p = this.owner;
    const root = this.contentEl; root.replaceChildren();
    element(root, "h2", "", this.original ? "编辑日程" : "新增日程");
    const form = element(root, "form", "stt-modal-form");
    const addInput = (label, type, value) => input(element(form, "label", "", label), type, value, "", label);
    const original = this.original?.event;
    const zone = Intl.DateTimeFormat().resolvedOptions().timeZone;
    const displayedStart = Number.isFinite(this.original?.startMillis) ? dateParts(this.original.startMillis, zone) : null;
    const displayedEnd = Number.isFinite(this.original?.endMillis) ? dateParts(this.original.endMillis, zone) : null;
    const title = addInput("标题", "text", original?.title || ""); title.required = true;
    const date = addInput("日期", "date", displayedStart?.date || this.original?.displayDate || original?.date || p.date); date.required = true;
    const start = addInput("开始时间", "time", displayedStart?.time || original?.startTime || "09:00:00"); start.required = true; start.step = "1";
    const end = addInput("结束时间", "time", displayedEnd?.time || original?.endTime || "09:30:00"); end.required = true; end.step = "1";
    const label = element(form, "label", "", "日历");
    const calendar = element(label, "select");
    const sources = this.original ? p.bridge.sources().filter(s => s.id === this.original.calendarId) : p.bridge.writableCalendars();
    for (const s of sources) { const option = element(calendar, "option", "", s.name); option.value = s.id; }
    calendar.value = this.original?.calendarId || p.settings.targetCalendarId; calendar.disabled = !!this.original;
    const message = element(form, "div", "stt-muted");
    const controls = element(form, "div", "stt-modal-buttons");
    button(controls, "取消", () => this.close());
    const save = element(controls, "button", "mod-cta", "保存"); save.type = "submit";
    form.addEventListener("submit", async e => {
      e.preventDefault(); save.disabled = true; message.textContent = "正在保存…";
      try {
        await p.bridge.saveManualEvent({ title: title.value, date: date.value, startTime: start.value,
          endTime: end.value, calendarId: calendar.value }, this.original);
        await p.refreshData(); this.close(); new Notice("日程已保存。");
      } catch (error) { message.textContent = error.message; save.disabled = false; }
    });
    setTimeout(() => title.focus(), 50);
  }
  onClose() { this.contentEl.replaceChildren(); }
}

class TimerSettings extends PluginSettingTab {
  constructor(app, owner) { super(app, owner); this.owner = owner; }
  display() {
    const p = this.owner; const root = this.containerEl; root.replaceChildren();
    new Setting(root).setName("日历连接").setDesc("复用 FCR 中已连接的 iCloud 日历，不需要再次填写 Apple 密码。")
      .addButton(b => b.setButtonText("连接 FCR").onClick(() => p.run(async () => { await p.bridge.connect(true); p.connected = true; await p.refreshData(); this.display(); })));
    new Setting(root).setName("待办文件").setDesc("使用普通 Markdown 复选框保存，可随笔记同步。更换路径不会移动旧文件。")
      .addText(text => { text.setValue(p.settings.tasksPath).setPlaceholder("待办计时/待办.md"); text.inputEl.addEventListener("change", async () => {
        const value = text.inputEl.value;
        const old = p.settings.tasksPath;
        p.settings.tasksPath = value;
        try { p.localTasks.path(); await p.saveSettings(); await p.refreshData(); }
        catch (error) { p.settings.tasksPath = old; new Notice(error.message); }
      }); });
    const explanation = element(root, "p", "stt-muted", "首版：OB 待办、FCR 已加载的单次待办、正向计时、暂停、完成并写入 iCloud 日历。Apple 新版提醒事项没有在本插件中接入；不会用升级提示冒充待办。");
    explanation.style.marginTop = "20px";
    element(root, "p", "stt-muted", "暂停后的每段实际时间分别写入日历。计时记录会先保存到当前设备的独立记录文件；断网失败时请在“待同步”中重试。重新打开 OB 后，上次未结束的计时恢复为暂停状态。");
    new Setting(root).setName("打开待办文件").setDesc("在笔记中修改任务名称、日期或完成状态。")
      .addButton(b => b.setButtonText("打开").onClick(() => p.run(async () => {
        const file = await p.localTasks.file(true); await p.app.workspace.getLeaf(false).openFile(file);
      })));
  }
}

class SimpleTaskTimer extends Plugin {
  async onload() {
    const saved = await this.loadData() || {};
    this.settings = { ...DEFAULT_SETTINGS };
    for (const key of Object.keys(DEFAULT_SETTINGS)) if (typeof saved[key] === "string") this.settings[key] = saved[key];
    this.settings.taskSource = this.settings.taskSource === "fcr" ? "fcr" : "local";
    this.date = dayKey(); this.draft = { title: "", due: "" }; this.busy = false;
    this.error = ""; this.connected = false; this.localItems = []; this.pendingTimers = new Set();
    this.localTasks = new MarkdownTasks(this.app, () => this.settings.tasksPath);
    this.sessionToken = null;
    const vaultId = hash(this.app.vault.adapter.getBasePath?.() || this.app.vault.getName());
    this.secretKey = `simple-task-timer-${vaultId}`;
    this.bridge = new FcrBridge(this.app,
      () => this.app.secretStorage?.getSecret?.(this.secretKey) || this.sessionToken,
      async token => {
        if (this.app.secretStorage?.setSecret) await this.app.secretStorage.setSecret(this.secretKey, token);
        else this.sessionToken = token;
      });
    let deviceId;
    try {
      const key = `simple-task-timer-device-${vaultId}`;
      deviceId = window.localStorage.getItem(key);
      if (!/^[a-f0-9-]{36}$/i.test(deviceId || "")) { deviceId = uid(); window.localStorage.setItem(key, deviceId); }
    } catch { throw new Error("无法保存设备标识，为避免覆盖其他设备的计时记录，插件没有启动。"); }
    this.journalDir = normalizePath(`${this.manifest.dir || `${this.app.vault.configDir}/plugins/${this.manifest.id}`}/sessions`);
    await this.ensureFolder(this.journalDir);
    this.journalPath = `${this.journalDir}/${deviceId}.json`;
    const state = await this.readJournal();
    this.controller = new TimerController({ state, persist: next => this.persistJournal(next),
      calendar: this.bridge, tasks: { complete: task => this.completeTask(task) }, onChange: () => this.render() });
    this.recovered = await this.controller.recover();
    this.registerView(VIEW, leaf => new TaskTimerView(leaf, this));
    this.addRibbonIcon("timer", "打开待办计时", () => this.openView());
    this.addCommand({ id: "open", name: "打开待办计时", callback: () => this.openView() });
    this.addCommand({ id: "pause-resume", name: "暂停／继续当前计时", callback: () => this.run(() => this.controller.state.active?.runningSince == null ? this.controller.resume() : this.controller.pause()) });
    this.addCommand({ id: "finish", name: "结束计时并完成待办", callback: () => this.run(async () => { await this.controller.finish(true); await this.refreshData(); }) });
    this.addSettingTab(new TimerSettings(this.app, this));
    this.statusBar = this.addStatusBarItem();
    this.statusBar.addEventListener("click", () => this.openView());
    this.registerInterval(window.setInterval(() => this.updateClock(), 1000));
    this.registerInterval(window.setInterval(() => this.controller.heartbeat().catch(e => this.fail(e)), 15000));
    this.registerInterval(window.setInterval(() => { if (!this.busy) this.refreshQuiet(); }, 30000));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file.path === this.settings.tasksPath) this.later(() => this.refreshQuiet(), 150);
    }));
    this.app.workspace.onLayoutReady(async () => {
      try { await this.bridge.connect(false); this.connected = true; } catch { this.connected = false; }
      await this.refreshQuiet();
      if (this.recovered) new Notice("上次计时已恢复为暂停，保留到最后一次保存的时间。可点击“继续”。");
    });
    await this.refreshQuiet();
  }
  onunload() {
    for (const id of this.pendingTimers) window.clearTimeout(id);
    if (this.controller?.state.active?.runningSince != null) this.controller.pause().catch(() => {});
  }
  async ensureFolder(path) {
    let next = "";
    for (const segment of path.split("/")) {
      next = next ? `${next}/${segment}` : segment;
      if (!await this.app.vault.adapter.exists(next)) await this.app.vault.adapter.mkdir(next);
    }
  }
  async readJournal() {
    const adapter = this.app.vault.adapter;
    if (!await adapter.exists(this.journalPath)) {
      if (await adapter.exists(`${this.journalPath}.previous`)) {
        const restored = validateJournal(JSON.parse(await adapter.read(`${this.journalPath}.previous`)));
        this.lastGoodJournal = JSON.stringify(restored); return restored;
      }
      return blankJournal();
    }
    try {
      const raw = await adapter.read(this.journalPath);
      const state = validateJournal(JSON.parse(raw)); this.lastGoodJournal = raw; return state;
    } catch {
      if (await adapter.exists(`${this.journalPath}.previous`)) {
        const raw = await adapter.read(`${this.journalPath}.previous`);
        const state = validateJournal(JSON.parse(raw)); this.lastGoodJournal = raw;
        new Notice("计时记录从上一个有效版本恢复。原文件请保留检查。");
        // Preserve the corrupt file before any subsequent write.
        await adapter.copy(this.journalPath, `${this.journalPath}.damaged-${Date.now()}`);
        return state;
      }
      throw new Error("计时记录损坏，插件已停止加载以保护原文件。请保留 sessions 文件夹排查。");
    }
  }
  async persistJournal(state) {
    const raw = JSON.stringify(state, null, 2);
    if (this.lastGoodJournal) await this.app.vault.adapter.write(`${this.journalPath}.previous`, this.lastGoodJournal);
    await this.app.vault.adapter.write(this.journalPath, raw);
    this.lastGoodJournal = raw;
  }
  async saveSettings() { await this.saveData(this.settings); }
  completeTask(task) { return task.kind === "local" ? this.localTasks.complete(task) : this.bridge.complete(task); }
  later(fn, delay) {
    const id = window.setTimeout(() => { this.pendingTimers.delete(id); fn(); }, delay);
    this.pendingTimers.add(id);
    return id;
  }
  fail(error) { this.error = error?.message || String(error); this.render(); }
  async run(action) {
    if (this.busy) return;
    this.busy = true; this.error = ""; this.render();
    try { await action(); } catch (error) { this.fail(error); }
    finally { this.busy = false; this.render(); }
  }
  async refreshData() {
    this.localItems = await this.localTasks.list();
    this.render();
  }
  async refreshQuiet() { try { await this.refreshData(); } catch (error) { this.fail(error); } }
  model() {
    let calendars = [], sources = [], remoteTasks = [], events = [], legacyReminders = false, recurringCount = 0;
    let connectionError = "";
    if (this.connected) {
      try {
        calendars = this.bridge.writableCalendars(); sources = this.bridge.sources(); remoteTasks = this.bridge.remoteTasks();
        events = this.bridge.dayEvents(this.date); legacyReminders = this.bridge.hasLegacyReminders(); recurringCount = this.bridge.recurringCount();
      } catch (error) { connectionError = error.message; }
    }
    return { connected: this.connected, busy: this.busy, error: this.error || connectionError, calendars,
      targetCalendarId: this.settings.targetCalendarId, active: this.controller?.state.active,
      taskSource: this.settings.taskSource, tasks: this.settings.taskSource === "local" ? this.localItems : remoteTasks,
      draft: this.draft, date: this.date, events, legacyReminders, recurringCount,
      timezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
      calendarNames: Object.fromEntries(sources.map(s => [s.id, s.name])), records: this.controller?.state.records || [] };
  }
  render() {
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) leaf.view.render?.();
    this.updateClock();
  }
  updateClock() {
    const active = this.controller?.state.active;
    const text = secondsText(elapsed(active));
    for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) {
      const node = leaf.view.contentEl?.querySelector("[data-timer-readout]");
      if (node) node.textContent = text;
    }
    if (this.statusBar) this.statusBar.textContent = active ? `计时 ${text}${active.runningSince == null ? " · 暂停" : ""}` : "待办计时";
  }
  async openView() {
    let leaf = this.app.workspace.getLeavesOfType(VIEW)[0];
    if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true }); }
    await this.app.workspace.revealLeaf(leaf);
  }
}

module.exports = SimpleTaskTimer;

}};
const cache = {};
function load(id) {
 if (!id.startsWith('./')) return outerRequire(id);
 const name = id.slice(2).replace(/\.cjs$/, '');
 if (cache[name]) return cache[name].exports;
 if (!modules[name]) throw new Error('Unknown module: ' + id);
 const local = {exports: {}}; cache[name] = local;
 modules[name](local, local.exports, load); return local.exports;
}
outerModule.exports = load('./plugin.cjs');
})(require, module);
