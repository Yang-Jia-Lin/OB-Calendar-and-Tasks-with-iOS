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
