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
