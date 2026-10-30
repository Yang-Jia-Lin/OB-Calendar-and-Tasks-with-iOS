import { clone, uid, sameEvent, sameEventContent, isMissingResource, type Syncable, type SyncInfo, type DeleteOperation, type DeleteTarget, type EditStep, type CalendarPort, type TaskPort, type Journal, type Session, type WorkRecord, type Task, type Segment } from "./contracts";
import { eventForSegment, validateSegments } from "./time";
export const blankJournal = (): Journal => ({ version: 2, active: null, records: [], operations: [] });
export function validateJournal(input: unknown): Journal {
  const data = clone(input) as Journal;
  if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.records)) throw new Error("计时日志格式不正确，已保留原文件。");
  data.operations ??= [];
  if (!Array.isArray(data.operations) || data.operations.some(o => !o.id || !o.step?.uid || !["pending", "saved"].includes(o.status))) throw new Error("日程修改日志损坏。");
  if (data.deletions && (!Array.isArray(data.deletions) || data.deletions.some(o => !o.id || !o.uid || !o.calendarId || !o.before || o.before.uid !== o.uid || !Number.isFinite(o.start) || !Number.isFinite(o.end) || !["pending", "saved"].includes(o.status)))) throw new Error("删除操作日志损坏。");
  for (const s of [data.active, ...data.records].filter(Boolean) as Session[]) {
    if (!s.id || !s.task?.id || !s.calendarId || !s.zone || !Number.isFinite(s.startedAt) || !Number.isFinite(s.lastHeartbeat) || !Array.isArray(s.segments) || (s.runningSince != null && !Number.isFinite(s.runningSince))) throw new Error("计时日志不完整。");
    new Intl.DateTimeFormat("en", { timeZone: s.zone });
    let end = -Infinity;
    for (const p of s.segments) {
      if (!Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end < p.start || p.start < end) throw new Error("计时日志区间损坏。");
      end = p.end;
    }
    if (s.runningSince != null && s.runningSince < end) throw new Error("计时日志区间重叠。");
  }
  for (const r of data.records) {
    if (!Number.isFinite(r.endedAt) || !["saved", "pending"].includes(r.status) || r.segments.some(p => !p.uid)) throw new Error("历史日志不完整。");
    if (r.edit) {
      validateSegments(r.edit.segments, Infinity);
      if (r.edit.steps.length !== r.edit.segments.length || r.edit.steps.some(p => !p.uid || !p.before || !p.after || !["prepared", "target-confirmed", "done"].includes(p.stage))) throw new Error("修改日志损坏。");
    }
  }
  for (const job of [...data.records, ...data.operations, ...(data.deletions || [])]) {
    if (job.sync && (!Number.isInteger(job.sync.revision) || job.sync.revision < 0 || !Number.isInteger(job.sync.attempt) || job.sync.attempt < 0 || !Number.isFinite(job.sync.retryAt))) throw new Error("同步进度日志损坏。");
  }
  data.version = 2;
  return data;
}
export function pauseSession(session: Session | null, now: number): Session {
  if (!session) throw new Error("没有正在计时的待办。");
  const s = clone(session);
  if (s.runningSince != null) {
    if (now < s.runningSince) throw new Error("系统时间倒退，请检查时间。");
    if (now > s.runningSince) s.segments.push({ start: s.runningSince, end: now });
    s.runningSince = null;
  }
  s.lastHeartbeat = now; return s;
}
export class TimerController {
  state: Journal;
  private serial: Promise<unknown> = Promise.resolve();
  private flights = new Map<string, Promise<unknown>>();
  private stopped = false;
  constructor(private deps: { state?: Journal; persist: (s: Journal) => Promise<void>; calendar: CalendarPort; tasks: TaskPort;
    now?: () => number; zone?: () => string; onChange?: () => void; background?: boolean }) { this.state = validateJournal(deps.state || blankJournal()); }
  private now() { return this.deps.now?.() ?? Date.now(); }
  private lock<T>(fn: () => Promise<T>): Promise<T> { const p = this.serial.then(fn); this.serial = p.catch(() => {}); return p; }
  private async commit(next: Journal, notify = true) { this.live(); await this.deps.persist(clone(next)); this.state = next; if (notify) this.deps.onChange?.(); }
  recover() { return this.lock(async () => { if (this.state.active?.runningSince == null) return false;
    const s = this.state.active; await this.commit({ ...this.state, active: pauseSession(s, Math.max(s.runningSince!, Math.min(s.lastHeartbeat, this.now()))) }); return true; }); }
  stopRemote() { this.stopped = true; }
  private live() { if (this.stopped) throw new Error("同步器已停止；操作保留到下次启动。"); }
  private info(job?: Syncable): SyncInfo { return { revision: job?.sync?.revision || 0, attempt: job?.sync?.attempt || 0, retryAt: job?.sync?.retryAt || 0, issue: job?.sync?.issue }; }
  private job(key: string) { const [type, id] = key.split(":"); return type === "work" ? this.state.records.find(r => r.id === id) : type === "event" ? this.state.operations.find(o => o.id === id) : this.state.deletions?.find(o => o.id === id); }
  jobs() { return [...this.state.records.filter(r => r.status === "pending").map(r => ({ key: `work:${r.id}`, value: r })), ...this.state.operations.filter(o => o.status === "pending").map(o => ({ key: `event:${o.id}`, value: o })), ...(this.state.deletions || []).filter(o => o.status === "pending").map(o => ({ key: `delete:${o.id}`, value: o }))]; }
  private async updateJob(key: string, change: (job: Syncable) => void) {
    const current = this.job(key); if (!current) throw new Error("同步操作不存在。");
    const next = clone(current); change(next);
    const [type, id] = key.split(":");
    await this.commit({ ...this.state, ...(type === "work" ? { records: this.state.records.map(r => r.id === id ? next as WorkRecord : r) } : type === "event" ? { operations: this.state.operations.map(o => o.id === id ? next as typeof o : o) } : { deletions: this.state.deletions!.map(o => o.id === id ? next as typeof o : o) }) });
  }
  requestRetry(key: string) { return this.lock(async () => {
    if (this.flights.has(key)) return;
    await this.updateJob(key, job => { job.error = ""; job.sync = { ...this.info(job), retryAt: 0, issue: undefined }; });
  }); }
  private runJob<T>(key: string, execute: () => Promise<T>, automatic = false): Promise<T> {
    const prior = this.flights.get(key); if (prior) return prior as Promise<T>;
    const promise = (async () => {
      const ready = await this.lock(async () => {
        this.live(); const current = this.job(key);
        if (automatic && (!current || current.status !== "pending" || (!current.sync && current.error) || current.sync?.issue && current.sync.issue !== "network" || (current.sync?.retryAt || 0) > this.now())) return false;
        if (current?.status === "pending") await this.updateJob(key, job => { job.sync = { ...this.info(job), attempt: (job.sync?.attempt || 0) + 1 }; });
        return true;
      });
      if (!ready) return clone(this.job(key)) as T;
      const result = await execute();
      await this.lock(async () => {
        this.live(); if (this.job(key)?.status !== "pending") return;
        await this.updateJob(key, job => {
          const info = this.info(job), issue = classifySyncError(job.error);
          job.sync = { ...info, issue, retryAt: issue === "network" ? this.now() + Math.round(Math.min(300000, 2000 * 2 ** Math.min(info.attempt - 1, 8)) * (.85 + Math.random() * .3)) : 0 };
        });
      });
      const current = this.job(key); return current ? clone(current) as T : result;
    })();
    this.flights.set(key, promise); void promise.finally(() => this.flights.delete(key)).catch(() => {}); return promise;
  }
  sync(key: string) { const [type, id] = key.split(":"); return this.runJob(key, async () => type === "work" ? this.flush(id) : type === "event" ? this.flushOperation(id) : this.flushDeletion(id), true); }
  private guard(key: string, revision: number) { this.live(); const current = this.job(key); if (!current || current.status !== "pending" || (current.sync?.revision || 0) !== revision) throw new Error("操作版本已变化，忽略旧同步结果。"); }
  start(task: Task, calendarId: string) { return this.lock(async () => {
    if (this.state.active) throw new Error("请先结束当前计时。");
    if (!task.id || !task.title.trim()) throw new Error("请选择有效待办。");
    this.deps.calendar.assertWritable(calendarId); const now = this.now();
    const active: Session = { id: uid(), title: task.title, task: clone(task), calendarId, zone: this.deps.zone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
      startedAt: now, runningSince: now, lastHeartbeat: now, segments: [] };
    await this.commit({ ...this.state, active });
  }); }
  pause() { return this.lock(() => this.commit({ ...this.state, active: pauseSession(this.state.active, this.now()) })); }
  resume() { return this.lock(async () => {
    const s = this.state.active, now = this.now();
    if (!s || s.runningSince != null) throw new Error("当前状态不能继续。");
    if (now < (s.segments.at(-1)?.end ?? s.startedAt)) throw new Error("系统时间倒退，请检查时间。");
    await this.commit({ ...this.state, active: { ...s, runningSince: now, lastHeartbeat: now } });
  }); }
  heartbeat() { return this.lock(async () => { if (this.state.active?.runningSince != null) await this.commit({ ...this.state,
    active: { ...this.state.active, lastHeartbeat: this.now() } }, false); }); }
  updateActive(patch: { startedAt?: number; calendarId?: string }, expectedId?: string) { return this.lock(async () => {
    const s = clone(this.state.active); if (!s) throw new Error("没有当前计时。");
    if (expectedId && s.id !== expectedId) throw new Error("当前计时已变化，请重新打开。");
    if (patch.calendarId) { this.deps.calendar.assertWritable(patch.calendarId); s.calendarId = patch.calendarId; }
    if (patch.startedAt != null) {
      const boundary = s.segments[0]?.end ?? (s.runningSince == null ? s.lastHeartbeat : this.now());
      if (!Number.isFinite(patch.startedAt) || patch.startedAt > this.now() || patch.startedAt > boundary - (s.segments.length ? 1000 : 0)) throw new Error("开始时间不能晚于首段结束或当前时间。");
      s.startedAt = patch.startedAt;
      if (s.segments.length) s.segments[0].start = patch.startedAt;
      else if (s.runningSince != null) s.runningSince = patch.startedAt;
      else if (patch.startedAt < boundary) s.segments.push({ start: patch.startedAt, end: boundary });
    }
    await this.commit({ ...this.state, active: s });
  }); }
  finish(completeTask = true) { return this.lock(async () => {
    const now = this.now(), s = pauseSession(this.state.active, now);
    const segments = s.segments.filter(p => p.end - p.start >= 1000).map((p, i) => ({ ...p, uid: `simple-task-timer-${s.id}-${i}`, saved: false }));
    validateSegments(segments, now);
    const record: WorkRecord = { ...s, segments, endedAt: now, completeTask, taskSaved: !completeTask, status: "pending", error: "", sync: this.info(), localFirst: !!this.deps.background && s.task.kind === "local" };
    await this.commit({ ...this.state, active: null, records: [...this.state.records, record] });
    if (record.localFirst && completeTask) {
      try { await this.deps.tasks.complete(record.task); record.taskSaved = true; await this.replace(record); }
      catch (e) { const durable = clone(this.state.records.find(r => r.id === record.id)!); durable.error = (e as Error).message; durable.sync = { ...this.info(durable), issue: "conflict" }; await this.replace(durable); return durable; }
    }
    return record;
  }).then(r => this.deps.background ? r : this.retry(r.id)); }
  retry(id: string) { return this.runJob(`work:${id}`, () => this.flush(id)); }
  private async replace(record: WorkRecord) { await this.commit({ ...this.state, records: this.state.records.map(r => r.id === record.id ? clone(record) : r) }); }
  private checkpointRecord(r: WorkRecord) { return this.lock(async () => { this.guard(`work:${r.id}`, r.sync?.revision || 0); await this.replace(r); }); }
  private async flush(id: string): Promise<WorkRecord> {
    let r = await this.lock(() => Promise.resolve(clone(this.state.records.find(r => r.id === id)))); if (!r) throw new Error("记录不存在。");
    if (r.status === "saved" && !r.edit) return r;
    try {
      this.live();
      if (r.localFirst && r.completeTask && !r.taskSaved) { await this.deps.tasks.complete(r.task); r.taskSaved = true; await this.checkpointRecord(r); }
      this.deps.calendar.assertWritable(r.calendarId);
      if (r.edit) {
        for (const step of r.edit.steps) { this.live(); await this.deps.calendar.reconcileStep(step, () => this.checkpointRecord(r!)); }
        r.calendarId = r.edit.calendarId; r.title = r.edit.title; r.segments = r.edit.segments.map((p, i) => ({ ...p, saved: true, snapshot: r!.edit!.steps[i].after }));
        r.startedAt = r.segments[0].start; r.endedAt = r.segments.at(-1)!.end; delete r.edit;
        await this.checkpointRecord(r);
      } else {
        for (const p of r.segments) {
          if (p.saved) continue;
          this.live();
          p.snapshot = await this.deps.calendar.ensureEvent(r.calendarId, eventForSegment(r, p)); p.saved = true;
          await this.checkpointRecord(r);
        }
      }
      this.live(); if (r.completeTask && !r.taskSaved) { await this.deps.tasks.complete(r.task); r.taskSaved = true; }
      await this.lock(async () => { this.guard(`work:${id}`, r!.sync?.revision || 0); r!.status = "saved"; r!.error = ""; await this.replace(r!); });
    } catch (e) {
      // A checkpoint may have failed: never persist newer confirmations over an older durable journal.
      await this.lock(async () => { this.guard(`work:${id}`, r!.sync?.revision || 0); r = clone(this.state.records.find(x => x.id === id)!); r.error = (e as Error).message; await this.replace(r); });
    }
    return r;
  }
  editRecord(id: string, draft: { title: string; calendarId: string; segments: Segment[]; snapshots?: import("./contracts").CalendarEvent[] }, expected: WorkRecord) { return this.lock(async () => {
    const current = this.state.records.find(r => r.id === id);
    if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("记录已变化，请重新打开。");
    if (current.status !== "saved" || current.edit) throw new Error("请先处理待同步操作，再修改记录。");
    if (this.state.deletions?.some(o => o.recordId === id && o.status !== "saved")) throw new Error("此记录有待同步的删除操作，请先处理。");
    const title = draft.title.trim(); if (!title) throw new Error("请填写标题。");
    this.deps.calendar.assertWritable(draft.calendarId); validateSegments(draft.segments, this.now());
    if (draft.segments.length !== current.segments.length) throw new Error("本版不增加或删除历史分段。");
    const r = clone(current);
    const steps = current.segments.map((p, i) => {
      const remote = this.deps.calendar.readByUid(current.calendarId, p.uid!);
      if (!remote) throw new Error("日历中的原记录已删除，请刷新；不会自动重建。");
      const before = draft.snapshots?.[i] ?? p.snapshot ?? eventForSegment(current, p);
      // Full snapshot is captured from the edit dialog, including migrated records.
      if (draft.snapshots?.[i] || p.snapshot ? !sameEventContent(remote, before) : !Object.entries(before).every(([k, v]) => v === undefined || JSON.stringify(remote[k]) === JSON.stringify(v))) throw new Error("日历记录已被外部修改，请刷新后重新打开。");
      const after = { ...remote, ...eventForSegment({ title }, { ...draft.segments[i], uid: p.uid }) };
      return { uid: p.uid!, fromCalendarId: current.calendarId, toCalendarId: draft.calendarId, before: clone(remote), after, stage: "prepared" as const };
    });
    r.status = "pending"; r.error = ""; r.sync = { revision: (r.sync?.revision || 0) + 1, attempt: 0, retryAt: 0 };
    r.edit = { calendarId: draft.calendarId, title, segments: draft.segments.map((p, i) => ({ start: p.start, end: p.end, uid: current.segments[i].uid })), steps };
    await this.replace(r); return r;
  }).then(r => this.deps.background ? r : this.retry(id)); }
  keepCalendarOnly(id: string) { return this.lock(async () => {
    if (this.flights.has(`work:${id}`)) throw new Error("此记录正在同步，请等本次请求结束。");
    const r = this.state.records.find(r => r.id === id); if (!r || r.edit || r.segments.some(p => !p.saved)) throw new Error("请先成功保存全部日历时间段。");
    await this.replace({ ...r, completeTask: false, taskSaved: true, status: "saved", error: "" });
  }); }
  saveEvent(step: EditStep) { return this.lock(async () => {
    if (this.jobs().some(j => j.key.startsWith("event:") && (j.value as import("./contracts").EventOperation).step.uid === step.uid)) throw new Error("此日程已有待同步修改，请先处理该项。");
    const id = uid();
    const op: import("./contracts").EventOperation = { id, title: step.after.title, step: clone(step), status: "pending", error: "", sync: this.info() };
    await this.commit({ ...this.state, operations: [...this.state.operations, op] }); return op;
  }).then(op => this.deps.background ? op : this.retryEvent(op.id)); }
  retryEvent(id: string) { return this.runJob(`event:${id}`, () => this.flushOperation(id)); }
  private async flushOperation(id: string) {
    let op = clone(this.state.operations.find(o => o.id === id)); if (!op) throw new Error("操作不存在。");
    if (op.status === "saved") return op;
    const revision = op.sync?.revision || 0;
    const checkpoint = () => this.lock(async () => { this.guard(`event:${id}`, revision); await this.commit({ ...this.state, operations: this.state.operations.map(o => o.id === id ? clone(op!) : o) }); });
    try { this.live(); await this.deps.calendar.reconcileStep(op.step, checkpoint); op.status = "saved"; op.error = ""; await checkpoint(); }
    catch (e) { op = clone(this.state.operations.find(o => o.id === id)!); op.error = (e as Error).message; await checkpoint(); }
    return op;
  }
  deleteEvent(target: DeleteTarget, range: { start: number; end: number }, record?: WorkRecord) { return this.lock(async () => {
    if (record) {
      const current = this.state.records.find(r => r.id === record.id);
      if (!current || JSON.stringify(current) !== JSON.stringify(record)) throw new Error("记录已变化，请重新打开。");
      if (current.status !== "saved" || current.edit || !current.segments.some(p => p.uid === target.uid) || current.calendarId !== target.calendarId) throw new Error("请先处理记录的待同步操作，再删除。");
    }
    if (this.state.deletions?.some(o => o.status !== "saved" && (o.recordId && o.recordId === record?.id || o.uid === target.uid && o.calendarId === target.calendarId))) throw new Error("此记录已在等待删除，请在待同步中重试。");
    if (this.state.operations.some(o => o.status !== "saved" && o.step.uid === target.uid && [o.step.fromCalendarId, o.step.toCalendarId].includes(target.calendarId))) throw new Error("此日程正在修改，请先处理待同步操作。");
    if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) throw new Error("删除记录的时间范围无效。");
    const remote = this.deps.calendar.readByUid(target.calendarId, target.uid);
    if (!remote || !sameEvent(remote, target.before)) throw new Error("日程已修改或删除，请刷新后重新打开。");
    const op: DeleteOperation = { ...clone(target), ...range, id: uid(), title: target.before.title, recordId: record?.id, status: "pending", error: "", sync: this.info() };
    await this.commit({ ...this.state, deletions: [...(this.state.deletions || []), op] });
    return op;
  }).then(op => this.deps.background ? op : this.retryDeletion(op.id)); }
  retryDeletion(id: string) { return this.runJob(`delete:${id}`, () => this.flushDeletion(id)); }
  reconcileDeletions() { return this.lock(async () => {
    let count = 0;
    for (const op of this.state.deletions?.filter(o => o.status === "pending") || []) {
      if (this.flights.has(`delete:${op.id}`)) continue;
      // Only read an available FCR calendar. This sends no DELETE and never recreates an event.
      if (!this.deps.calendar.hasCalendarData?.(op.calendarId)) continue;
      if (this.deps.calendar.readByUid(op.calendarId, op.uid)) continue;
      await this.confirmDeletion({ ...clone(op), resolution: "absent-in-fcr" }); count++;
    }
    return count;
  }); }
  confirmRemoteDeletion(id: string) { return this.lock(async () => {
    if (this.flights.has(`delete:${id}`)) throw new Error("此记录正在同步，请等本次请求结束再核对。");
    const op = this.state.deletions?.find(o => o.id === id); if (!op) throw new Error("删除请求不存在。");
    if (op.status === "saved") return;
    if (!isMissingResource(op.error)) throw new Error("此请求尚未报告资源不存在，请先刷新或重试。");
    const current = this.deps.calendar.readByUid(op.calendarId, op.uid);
    if (current && !sameEventContent(current, op.before)) throw new Error("日程内容已变化，请先在完整日历中核对。");
    await this.confirmDeletion({ ...clone(op), resolution: "user-confirmed-remote-deletion" });
  }); }
  private async confirmDeletion(op: DeleteOperation) {
    op.status = "saved"; op.error = "";
    const records = this.state.records.map(r => {
      if (r.id !== op.recordId) return r;
      const segments = r.segments.filter(p => p.uid !== op.uid);
      return { ...r, segments, startedAt: segments[0]?.start ?? r.startedAt, endedAt: segments.at(-1)?.end ?? r.endedAt };
    });
    await this.commit({ ...this.state, records, deletions: this.state.deletions!.map(o => o.id === op.id ? clone(op) : o) });
  }
  private async flushDeletion(id: string) {
    let op = clone(this.state.deletions?.find(o => o.id === id)); if (!op) throw new Error("删除操作不存在。");
    if (op.status === "saved") return op;
    try {
      this.live();
      await this.deps.calendar.deleteEvent(op);
      // Preserve the confirmed deletion as a tombstone; never complete/restore the original task here.
      op.resolution = "deleted"; await this.lock(async () => { this.guard(`delete:${id}`, op!.sync?.revision || 0); await this.confirmDeletion(op!); });
      op = clone(this.state.deletions!.find(o => o.id === id)!);
    } catch (e) {
      await this.lock(async () => { this.guard(`delete:${id}`, op!.sync?.revision || 0); op = clone(this.state.deletions!.find(o => o.id === id)!); op.error = (e as Error).message;
        await this.commit({ ...this.state, deletions: this.state.deletions!.map(o => o.id === id ? clone(op!) : o) }); });
    }
    return op;
  }
}
export function classifySyncError(message: string): SyncInfo["issue"] {
  if (/授权|请先连接|请启用兼容|scope|HTTP\s+(401|403)\b/i.test(message)) return "auth";
  if (/外部|已变化|已删除|找不到|不存在|同 UID|分类日历|无法|不允许|只读|HTTP\s+(404|410)\b/i.test(message)) return "conflict";
  if (/network|offline|fetch|timeout|timed? out|ECONN|ENET|网络|断网|超时|未确认|未能核对|尚未就绪|lost.*response|HTTP\s+(429|5\d\d)\b/i.test(message)) return "network";
  return "conflict";
}
