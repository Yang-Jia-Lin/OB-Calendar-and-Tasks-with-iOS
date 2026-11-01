import { clone, sameEvent, isMissingResource, uid, type Calendar, type CalendarEvent, type CalendarPort, type DeleteTarget, type EditStep, type Entry, type TimelineRow } from "../../Shared/contracts";
import { calendarContent as comparableEventContent, sameCalendarContent as sameEventContent } from "./content";
import { dayKey, dateParts } from "../../Shared/time";
import type { CalendarQuery } from "../../Shared/application";
import { utcEvent, validateRule } from "./ical";
export interface CalendarDraft { title:string;start:number;end:number;calendarId:string;allDay:boolean;timezone?:string;task?:boolean;completed?:boolean;rrule?:string;description?:string;location?:string;uid?:string }
export interface CalendarApi {
  connect?(): Promise<void>;
  timeline?(date:string): TimelineRow[];
  getCalendarSources(): Calendar[];
  getProviderCapabilities(id: string): { canCreate?: boolean; canEdit?: boolean; canDelete?: boolean };
  getAllEvents(): { id: string; color?: string; events: { id: string; event: CalendarEvent }[] }[];
  getEvents(criteria: object, sorts: unknown[]): { id: string; startMillis?: number; endMillis?: number; isTask?: boolean; allDay?: boolean }[];
  createEvent(id: string, event: CalendarEvent): Promise<boolean>;
  updateEvent(id: string, event: CalendarEvent): Promise<boolean>;
  deleteEvent(id: string): Promise<void>;
  revalidateRemoteCalendars(force: boolean): void;
  openCalendar(): Promise<unknown>;
}
export function containsEvent(actual: CalendarEvent, desired: CalendarEvent) {
  const normalized = comparableEventContent(actual);
  return Object.entries(comparableEventContent(desired)).every(([key, value]) => value === undefined || sameEvent({ type: "", title: "", date: "", value: normalized[key] }, { type: "", title: "", date: "", value }));
}
function content(event: CalendarEvent): CalendarEvent {
  const { caldavHref: _href, etag: _etag, ...data } = clone(event); return data;
}
export class CalendarBridge implements CalendarPort, CalendarQuery {
  authorized: CalendarApi | null = null;
  get connected() { return this.authorized!==null; }
  constructor(private provider: CalendarApi) {}
  async connect(_interactive=false) { this.authorized=null;await this.provider.connect?.();this.authorized=this.provider; }
  api() { if (!this.authorized) throw new Error("请先配置日历连接。"); return this.authorized; }
  sources(): Calendar[] { return this.api().getCalendarSources().map(s => ({ id: s.id, name: s.name || s.id, color: s.color, type: s.type })); }
  readDay(date: string) {
    const sources = this.sources(), groups = this.api().getAllEvents();
    if (sources.filter(s=>s.type!=="caldavtasks").some(source => !groups.some(group => group.id === source.id))) throw new Error("日历缓存尚未就绪；保留已加载快照");
    return { date, sources, calendars: this.writableCalendars(), rows: this.timeline(date) };
  }
  writableCalendars() { return this.sources().filter(s => s.type === "caldav" && this.api().getProviderCapabilities(s.id)?.canCreate); }
  assertWritable(id: string) { if (!this.sources().some(s => s.id === id) || !this.api().getProviderCapabilities(id)?.canCreate) throw new Error("分类日历不可写或已移除，请重新选择。"); }
  entries(): Entry[] { return this.api().getAllEvents().flatMap(g => (g.events || []).map(x => ({ id: x.id, calendarId: g.id, color: g.color, event: clone(x.event) }))); }
  find(calendarId: string, eventUid: string) {
    const matches = this.api().getAllEvents().filter(g => g.id === calendarId).flatMap(g => (g.events || []).filter(x => x.event.uid === eventUid).map(x => ({ id: x.id, calendarId, color: g.color, event: clone(x.event) })));
    if (matches.length > 1) throw new Error("同一日历出现重复 UID，请先在完整日历中核对。");
    return matches[0];
  }
  readByUid(calendarId: string, eventUid: string) { return this.find(calendarId, eventUid)?.event; }
  hasCalendarData(calendarId: string) { return this.sources().some(c => c.id === calendarId) && this.api().getAllEvents().some(g => g.id === calendarId); }
  canDelete(original: Entry) { return !!original.event.uid && !!this.api().getProviderCapabilities(original.calendarId)?.canDelete; }
  prepareDeletion(original: Entry): DeleteTarget {
    if (!this.canDelete(original)) throw new Error("此日程无法在这里删除，请使用完整日历。");
    const current = this.find(original.calendarId, original.event.uid!);
    if (!current || !sameEvent(current.event, original.event)) throw new Error("日程已修改或删除，请刷新后重新打开。");
    return { calendarId: original.calendarId, uid: original.event.uid!, before: clone(original.event) };
  }
  async deleteEvent(target: DeleteTarget) {
    // Retrying a durable operation is idempotent; disappearance never triggers recreation.
    const current = this.find(target.calendarId, target.uid);
    if (!current) { if (!this.hasCalendarData(target.calendarId)) throw new Error("日历缓存尚未就绪，请稍后重试。"); return; }
    if (!this.canDelete(current)) throw new Error("日历不允许删除此日程。");
    if (!sameEventContent(current.event, target.before)) throw new Error("日程已被外部修改，停止删除；请先刷新核对。");
    try { await this.api().deleteEvent(current.id); }
    catch (e) {
      if (!isMissingResource(e)) throw e;
      // 日历服务 rolls a failed DELETE back into its cache. A 404 alone cannot settle the queue.
      this.refresh();
      throw new Error("日历资源不存在（HTTP 404/410）。刷新后会核对；若已在远端删除，可点此卡片清理本地残留。");
    }
    if (this.find(target.calendarId, target.uid)) throw new Error("删除结果未确认，请刷新后重试。");
  }
  async ensureEvent(calendarId: string, event: CalendarEvent) {
    this.assertWritable(calendarId);
    const old = this.readByUid(calendarId, event.uid!);
    if (old) { if (!containsEvent(old, event)) throw new Error("同一 UID 的日历内容已变化，停止重复写入。"); return clone(old); }
    if (!this.hasCalendarData(calendarId)) throw new Error("日历缓存尚未就绪，请稍后重试。");
    if (await this.api().createEvent(calendarId, content(event)) !== true) {
      this.refresh(); throw new Error("日历服务 未确认日历写入，已请求刷新；后台将核对 UID 后重试。");
    }
    const saved = this.readByUid(calendarId, event.uid!);
    if (!saved || !containsEvent(saved, event)) throw new Error("日历写入结果未能核对，请刷新后重试。");
    return clone(saved);
  }
  async reconcileStep(step: EditStep, checkpoint: () => Promise<void>) {
    if (step.stage === "done") return;
    this.assertWritable(step.toCalendarId);
    if (!step.fromCalendarId) { step.after = await this.ensureEvent(step.toCalendarId, step.after); step.stage = "done"; await checkpoint(); return; }
    const same = step.fromCalendarId === step.toCalendarId;
    let source = this.find(step.fromCalendarId, step.uid);
    let target = this.find(step.toCalendarId, step.uid);
    if (same) {
      if (!source) throw new Error("原日程已删除，不会自动重建。");
      if (!containsEvent(source.event, step.after)) {
        if (!sameEventContent(source.event, step.before)) throw new Error("原日程被外部修改，请刷新后重新编辑。");
        if (!this.api().getProviderCapabilities(source.calendarId)?.canEdit) throw new Error("原日程只读。");
        // Keep the current resource metadata, never replay the draft's stale ETag/href.
        const next = { ...source.event, ...content(step.after) };
        if (await this.api().updateEvent(source.id, next) !== true) {
          // 日历服务 returns false for provider failures, including HTTP 412, and rolls
          // its cache back. Refresh before retrying the same stable UID.
          this.refresh(); throw new Error("日历服务 未确认日程修改，已请求刷新；后台将核对远端内容后重试（网络失败或版本冲突）。");
        }
      }
      const saved = this.readByUid(step.toCalendarId, step.uid);
      if (!saved || !containsEvent(saved, step.after)) throw new Error("日程修改结果未能核对。");
      step.after = clone(saved); step.stage = "done"; await checkpoint(); return;
    }
    if (source && !sameEventContent(source.event, step.before)) throw new Error("原日程被外部修改，请先核对；尚未删除原日程。");
    if (!source && !target) throw new Error("来源和目标均找不到日程，不会自动重建。");
    if (!target) {
      if (step.stage === "target-confirmed") throw new Error("目标日程已被删除，停止移动。");
      if (!source) throw new Error("原日程不存在。");
      if (!this.api().getProviderCapabilities(source.calendarId)?.canDelete) throw new Error("来源日历不允许移动日程。");
      await this.ensureEvent(step.toCalendarId, step.after); target = this.find(step.toCalendarId, step.uid);
    }
    if (!target || !containsEvent(target.event, step.after)) throw new Error("目标日历中同 UID 内容不同，停止移动。");
    step.after = clone(target.event); step.stage = "target-confirmed"; await checkpoint();
    // Re-read both sides after the durable checkpoint before deleting anything.
    source = this.find(step.fromCalendarId, step.uid);
    const confirmed = this.readByUid(step.toCalendarId, step.uid);
    if (!confirmed || !containsEvent(confirmed, step.after)) throw new Error("目标日程已变化，保留来源。");
    if (source) {
      if (!sameEventContent(source.event, step.before)) throw new Error("来源日程已变化，保留来源。");
      if (!this.api().getProviderCapabilities(source.calendarId)?.canDelete) throw new Error("来源日历不允许删除。");
      await this.api().deleteEvent(source.id);
    }
    if (this.find(step.fromCalendarId, step.uid)) throw new Error("目标已保存，来源删除尚未确认；可安全重试。");
    if (!this.readByUid(step.toCalendarId, step.uid)) throw new Error("目标日程已消失，请刷新核对。");
    step.stage = "done"; await checkpoint();
  }
  timeline(date: string): TimelineRow[] {
    if(this.api().timeline)return this.api().timeline!(date);
    const dayStart = +new Date(`${date}T00:00:00`), nextDay = new Date(dayStart); nextDay.setDate(nextDay.getDate() + 1);
    const query = this.api().getEvents({}, []).filter(q => Number.isFinite(q.startMillis) && q.startMillis! < +nextDay && Math.max(q.startMillis!, (q.endMillis ?? q.startMillis! + 3600000) - 1) >= dayStart);
    const byId = new Map(query.map(e => [e.id, e]));
    const entries = this.api().getAllEvents().flatMap(g => (g.events || []).filter(x => byId.has(x.id)).map(x => ({ id: x.id, calendarId: g.id, color: g.color, event: clone(x.event) })));
    return entries.flatMap(original => {
      const e = original.event, q = byId.get(original.id);
      if (e.isTask || e.completed != null || !q || !Number.isFinite(q.startMillis)) return [];
      const start = q.startMillis!, end = q.endMillis ?? start + 3600000;
      if (date < dayKey(start) || date > dayKey(Math.max(start, end - 1))) return [];
      return [{ key: `${original.calendarId}:${original.id}`, title: e.title, calendarId: original.calendarId, color: original.color,
        start, end, allDay: e.allDay, original, unsupported: e.allDay || e.type !== "single" }];
    }).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
  }
  async prepareEvent(draft: { title: string; start: number; end: number; calendarId: string; uid?: string }, original?: Entry): Promise<EditStep> {
    if (!draft.title.trim() || !Number.isFinite(draft.start) || !Number.isFinite(draft.end) || draft.end <= draft.start) throw new Error("请填写标题和有效起止时间。");
    this.assertWritable(draft.calendarId);
    if (original) {
      const current = this.entries().find(e => e.id === original.id && e.calendarId === original.calendarId);
      if (!current || !sameEventContent(current.event, original.event)) throw new Error("日程已变化，请刷新后重新打开。");
    }
    const { dateParts } = await import("../../Shared/time");
    const start = dateParts(draft.start, "UTC"), end = dateParts(draft.end, "UTC");
    const after: CalendarEvent = { ...(original?.event || {}), type: "single", title: draft.title.trim(), uid: original?.event.uid || draft.uid || `ctt-event-${uid()}`,
      date: start.date, endDate: end.date, startTime: start.time, endTime: end.time, timezone: "UTC", allDay: false, isTask: false };
    if (original && !original.event.uid) throw new Error("此事件缺少稳定 UID，请在完整日历中编辑。");
    return { uid: after.uid!, fromCalendarId: original?.calendarId || "", toCalendarId: draft.calendarId,
      before: original?.event || after, after, stage: "prepared" };
  }
  refresh() { this.api().revalidateRemoteCalendars(true); }
  openCalendar() { return this.api().openCalendar(); }
  prepareCalendarEvent(draft:CalendarDraft,original?:Entry):EditStep {
    if(!draft.title.trim()||!Number.isFinite(draft.start)||!Number.isFinite(draft.end)||draft.end<=draft.start)throw new Error("请填写有效标题和起止时间。");this.assertWritable(draft.calendarId);
    const source=this.sources().find(s=>s.id===draft.calendarId)!;if(!!draft.task!==(source.type==="caldavtasks"))throw new Error("请选择与日程／待办类型一致的日历。");
    if(original){const current=this.entries().find(e=>e.id===original.id&&e.calendarId===original.calendarId);if(!current||!sameEventContent(current.event,original.event))throw new Error("日程已变化，请刷新后重新打开。");}
    validateRule(draft.rrule||"");const after:CalendarEvent={...original?.event,...utcEvent(draft.title.trim(),draft.start,draft.end),uid:original?.event.uid||draft.uid||`ctt-event-${uid()}`,type:draft.rrule===undefined?(original?.event.type||"single"):draft.rrule?"recurring":"single",description:draft.description||"",location:draft.location||""};
    if(draft.rrule!==undefined)after.rrule=draft.rrule;
    if(after.type==="recurring"&&!draft.allDay){const zone=draft.timezone||original?.event.timezone||"UTC",a=dateParts(draft.start,String(zone)),b=dateParts(draft.end,String(zone));Object.assign(after,{date:a.date,endDate:b.date,startTime:a.time,endTime:b.time,timezone:zone});}
    if(draft.allDay){after.date=dayKey(draft.start);after.endDate=dayKey(draft.end);delete after.startTime;delete after.endTime;delete after.timezone;after.allDay=true;}
    if(draft.task){after.isTask=true;after.due=after.date+(after.allDay?"":"T"+after.startTime+(after.timezone==="UTC"?"Z":""));after.endDate=after.date;after.endTime=after.startTime;if(draft.completed)after.completed=true;else delete after.completed;}
    return {uid:after.uid!,fromCalendarId:original?.calendarId||"",toCalendarId:draft.calendarId,before:original?.event||after,after,stage:"prepared"};
  }
}
export type CalendarService=Omit<CalendarBridge,"prepareCalendarEvent"> & Partial<Pick<CalendarBridge,"prepareCalendarEvent">>;
