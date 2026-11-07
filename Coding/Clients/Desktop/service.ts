import { createHash } from "node:crypto";
import { CalendarEngine } from "../../Providers/Calendar/engine";
import { CalendarBridge } from "../../Providers/Calendar/bridge";
import { calendarSources, validUrl } from "../../Providers/Calendar/config";
import type { CalendarTransport } from "../../Providers/Calendar/dav";
import { RemindersProvider, reminderRef, type ReminderRpc } from "../../Providers/Reminders/provider";
import { TimerController } from "../../Shared/timer";
import { SyncWorker } from "../../Shared/sync";
import { clone, type Task } from "../../Shared/contracts";
import { refKey, type TaskRef } from "../../Shared/application";
import { mergeTimeline } from "../../Shared/timeline";
import { validDay, reminderMetadata, withReminderMetadata } from "../../Shared/scheduling";
import type { CommandResult, DesktopCommand, DesktopSnapshot, DiarySnapshot } from "./protocol";
import { DesktopStore } from "./store";
import { inspectExport, importExport } from "./migration";
import path from "node:path";
import { uptime } from "node:os";
export interface SecretPort { get(key: string): Promise<string | null>; set(key: string, value: string): Promise<void>; reload?():void }
export const desktopTransport: CalendarTransport = async input => {
  // Do not forward credentials across redirects supplied by an external server.
  const response = await fetch(input.url, { method: input.method, headers: input.headers, body: input.body, redirect: "error", signal: AbortSignal.timeout(45000) });
  return { status: response.status, text: await response.text(), headers: Object.fromEntries(response.headers.entries()) };
};
const canonical = (value: any): string => JSON.stringify(value, (_key, x) => x && typeof x === "object" && !Array.isArray(x) ? Object.fromEntries(Object.keys(x).sort().map(k => [k, x[k]])) : x);
export class DesktopService {
  readonly engine: CalendarEngine; readonly bridge: CalendarBridge; readonly reminders: RemindersProvider;
  controller!: TimerController; worker!: SyncWorker; recovery = ""; error = "";
  isolated=false;
  private commands: Promise<unknown> = Promise.resolve(); private listeners = new Set<() => void>();
  private heartbeat?: ReturnType<typeof setInterval>; private refreshTimer?: ReturnType<typeof setTimeout>;
  private notification?: ReturnType<typeof setTimeout>; private closed = false; private refreshFlight?: Promise<void>;
  private autoSync = false;
  private clockAnchor={wall:Date.now(),uptime:uptime()*1000};
  constructor(readonly store: DesktopStore, readonly rpc: ReminderRpc, readonly secrets: SecretPort, transport: CalendarTransport = desktopTransport) {
    this.engine = new CalendarEngine({ transport, secret: key => secrets.get(key), persist: calendar => store.update({ calendar }), timezone: () => Intl.DateTimeFormat().resolvedOptions().timeZone, open: async () => {} });
    this.bridge = new CalendarBridge(this.engine);
    this.reminders = new RemindersProvider(rpc, {
      settings: () => store.data.settings.reminders,
      calendar: id => store.data.settings.reminders.calendarMap[id] || store.data.settings.defaultCalendarId,
      persist: reminders => store.update({ reminders }, "reminders"), changed: () => this.changed(),
      migrated: async (from, to) => { const settings = clone(store.data.settings); for (const [note, ref] of Object.entries(settings.bindings)) if (refKey(ref) === refKey(from)) settings.bindings[note] = to; await store.update({ settings }, "settings"); }
    });
  }
  async initialize(background = true) {
    this.autoSync = background;
    await this.store.load(); this.engine.configure(this.store.data.settings.calendarSources, this.store.data.calendar);
    if (this.store.data.settings.calendarSources.some(s => s.enabled !== false)) await this.bridge.connect();
    this.reminders.load(this.store.data.reminders);
    this.controller = new TimerController({ state: this.store.data.journal, ownerDeviceId: this.store.data.settings.deviceId, background: true,
      calendar: this.bridge, tasks: { complete: (task, context) => { if (task.kind !== "reminder") throw new Error("旧本地任务无法自动确认完成；请核对原笔记，或明确选择仅保留工时。"); return this.reminders.completeRemote(task, context); } },
      persist: journal => this.store.update({ journal }, "journal"), onChange: () => this.changed() });
    if (await this.controller.recover()) this.recovery = "上次程序异常退出，已恢复为暂停；请核对最后已保存的时间，可在记录中修正。";
    const coordinator = {
      jobs: () => [...this.controller.jobs(), ...this.reminders.jobs()],
      sync: (key: string) => key.startsWith("reminder:") ? this.reminders.sync(key) : this.controller.sync(key),
      requestRetry: (key: string) => key.startsWith("reminder:") ? this.reminders.requestRetry(key) : this.controller.requestRetry(key),
      stopRemote: () => { this.controller.stopRemote(); this.reminders.stop(); }
    };
    this.worker = new SyncWorker(coordinator as any, { enabled: () => !this.closed&&this.store.data.settings.ownershipAcknowledged===true&&!this.isolated, changed: () => this.changed(), settled: () => this.changed(), channel: this.store.file });
    this.engine.subscribe(() => this.changed());
    if (background) {
      this.heartbeat = setInterval(() => { void this.clockCheckpoint().catch(e => { this.error = e.message; this.changed(); }); }, 15000);
      void this.refresh(); this.scheduleRefresh(); this.worker.wake();
    }
  }
  private scheduleRefresh(delay = 120000) {
    if (this.closed) return;
    this.refreshTimer = setTimeout(() => { void this.refresh().finally(() => this.scheduleRefresh(this.error || this.engine.state.error || this.reminders.error ? 300000 : 120000)); }, delay);
  }
  async clockCheckpoint() {
    const wall=Date.now(),ticks=uptime()*1000,drift=(wall-this.clockAnchor.wall)-(ticks-this.clockAnchor.uptime);
    this.clockAnchor={wall,uptime:ticks};const active = this.controller.state.active;
    // Windows uptime includes sleep (libuv uses GetTickCount64), unlike a wall-clock edit.
    if (active?.runningSince != null && (wall < Math.max(active.runningSince, active.lastHeartbeat)||Math.abs(drift)>2000)) {
      await this.controller.recover(); this.recovery = "系统时钟发生异常变化，计时已按可靠边界暂停，请核对后继续。";this.changed();
    } else await this.controller.heartbeat();
  }
  async systemClockChanged() { await this.clockCheckpoint(); }
  private changed() {
    if (this.closed || this.notification) return;
    this.notification = setTimeout(() => { this.notification = undefined; if (this.autoSync) this.worker?.wake(); for (const fn of this.listeners) { try { fn(); } catch {} } }, 30);
  }
  subscribe(fn: () => void) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  taskList(): Task[] {
    return [...(this.store.data.legacyTasks || []).filter(t => !this.reminders.data.aliases[refKey(t)]).map(t => ({ ...t, readonlyReason: "旧 Markdown 任务：保留计时，完成／编辑请先受控迁移到提醒事项。" })), ...this.reminders.list()].map(task => {
      try { return { ...task, scheduledDate: reminderMetadata(task.description).metadata.scheduledDate }; }
      catch (e) { return { ...task, scheduledDate: null, readonlyReason: (e as Error).message }; }
    });
  }
  snapshot(): DesktopSnapshot {
    return { version: 1, isolated:this.isolated, revision: this.store.data.revision, active: clone(this.controller.state.active), tasks: this.taskList(), lists: clone(this.reminders.data.lists),
      records: clone(this.controller.state.records.slice(-200)), settings: clone(this.store.data.settings),
      pending: [...this.controller.jobs(), ...this.reminders.jobs()].map(j => ({ key: j.key, error: j.value.error })),
      sync: { refreshing: !!this.refreshFlight, lastSync: Math.max(this.reminders.data.syncedAt, this.engine.state.lastSync), error: this.error || this.reminders.error || this.engine.state.error || this.worker?.view.error || "" }, recovery: this.recovery };
  }
  day(date: string): DiarySnapshot {
    if (!validDay(date)) throw new Error("日期无效。");
    const snapshot = this.bridge.readDay(date);
    return { calendars: snapshot.sources.filter(s => s.type !== "caldavtasks"), rows: mergeTimeline(snapshot.rows, this.controller.state.records, date, this.controller.state.operations, this.controller.state.deletions) };
  }
  history(from: string, to: string, offset = 0) {
    if (!validDay(from) || !validDay(to) || from > to || !Number.isInteger(offset) || offset < 0) throw new Error("查询日期范围无效。");
    const a = +new Date(from + "T00:00:00"), b = new Date(to + "T00:00:00"); b.setDate(b.getDate() + 1);
    const records = this.controller.state.records.filter(r => r.endedAt >= a && r.startedAt < +b).reverse();
    return { total: records.length, records: clone(records.slice(offset, offset + 100)) };
  }
  async refresh() {
    if(this.isolated){this.changed();return;}
    if (this.refreshFlight) return this.refreshFlight;
    this.refreshFlight = (async () => {
      try { await Promise.all([this.engine.refresh(), this.reminders.refresh()]); this.error = ""; await this.worker?.resume("network"); }
      catch (e) { this.error = (e as Error).message; }
      finally { this.refreshFlight = undefined; this.changed(); }
    })(); this.changed(); return this.refreshFlight;
  }
  private task(ref: TaskRef) {
    const alias = this.reminders.data.aliases[refKey(ref)]; if (alias) return this.reminders.resolve(alias);
    if (ref.kind === "local") { const task = this.taskList().find(t => refKey(t) === refKey(ref)); if (!task) throw new Error("旧任务不存在。"); return task; }
    return this.reminders.resolve(ref);
  }
  command(command: DesktopCommand): Promise<CommandResult> {
    const p = this.commands.then(() => this.execute(command)); this.commands = p.catch(() => {}); return p;
  }
  private async execute(c: DesktopCommand): Promise<CommandResult> {
    if (c.version !== 1 || !/^[a-zA-Z0-9-]{8,128}$/.test(c.requestId) || typeof c.action !== "string") throw new Error("本机指令版本或请求 ID 无效。");
    const fingerprint = createHash("sha256").update(canonical(c)).digest("hex"), previous = this.store.data.receipts[c.requestId];
    if (previous) { if (previous.fingerprint !== fingerprint) throw new Error("相同请求 ID 携带了不同指令。"); return clone(previous.result); }
    if (this.closed) throw new Error("后台正在退出。");
    if(!this.isolated&&!this.store.data.settings.ownershipAcknowledged&&!["settings.save","calendar.configure","categories.save","ownership.activate","shutdown"].includes(c.action))throw new Error("请先导入已冻结的 OB 交接快照；全新用户可在设置中确认已停止旧写入者，再启用独立模式。");
    let partition: "journal" | "reminders" | "settings" | "undo" = "journal";
    let result: (data: typeof this.store.data) => CommandResult = () => ({ ok: true });
    if (c.action.startsWith("task.") || c.action === "undo") partition = "reminders";
    if (c.action === "settings.save" || c.action === "binding.save" || c.action === "calendar.configure" || c.action === "categories.save"||c.action==="ownership.activate") partition = "settings";
    if (c.action === "timer.start") result = data => ({ ok: true, sessionId: data.journal.active!.id });
    if (c.action === "timer.finish") result = () => ({ ok: true, sessionId: c.sessionId, recordId: c.sessionId, pending: true });
    if (c.action === "timer.pause" || c.action === "timer.resume") result = () => ({ ok: true, sessionId: c.sessionId });
    if (c.action === "task.create") result = () => ({ ok: true, taskId: "Reminder/" + c.requestId.toUpperCase(), pending: true });
    if (c.action === "task.migrate") result = data => ({ ok: true, taskId: data.reminders.aliases[refKey(c.task)]?.id || data.reminders.operations.find(o => o.migration && refKey(o.migration) === refKey(c.task))?.task.id, pending: true });
    if (c.action === "task.schedule") result = () => ({ ok: true, undoId: c.requestId, pending: true });
    try {
      await this.store.withReceipt({ id: c.requestId, fingerprint, partition, action:c.action, result }, async () => {
        switch (c.action) {
          case "timer.start": {
            const task = this.task(c.task);
            if (task.completed) throw new Error("任务已完成。");
            const active = this.controller.state.active;
            if (active) {
              if (refKey(active.task as TaskRef) !== refKey(c.task)) throw new Error("请先结束当前计时，再切换任务。");
              await this.store.update({ journal: this.controller.state }, "journal"); break;
            }
            await this.controller.start(task, task.calendarId || this.store.data.settings.defaultCalendarId); break;
          }
          case "timer.pause": await this.controller.pause(c.sessionId); break;
          case "timer.resume": {
            if (this.controller.state.active?.id !== c.sessionId) throw new Error("计时会话已变化。");
            if (this.controller.state.active.runningSince != null) await this.store.update({ journal: this.controller.state }, "journal"); else await this.controller.resume(c.sessionId); break;
          }
          case "timer.finish": await this.controller.finish(c.completeTask === true, c.sessionId); break;
          case "task.create": {
            if (!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i.test(c.requestId)) throw new Error("创建任务需要 UUID 请求身份。");
            if (c.due && !validDay(c.due)) throw new Error("截止日期无效。");
            await this.reminders.create(c.title, c.listId, { due: c.due || "", description: c.description || "" }, undefined, "Reminder/" + c.requestId.toUpperCase()); break;
          }
          case "task.update": {
            const allowed: Partial<Task> = {};
            for (const key of ["title", "due", "dueInstant", "dueZone", "description", "repeat", "completed"] as const) if (Object.hasOwn(c.patch, key)) (allowed as any)[key] = c.patch[key];
            if (allowed.due && !validDay(allowed.due)) throw new Error("截止日期无效。");
            if (Object.hasOwn(allowed, "description")) allowed.description = withReminderMetadata(allowed.description || "", reminderMetadata(c.task.description).metadata);
            await this.reminders.update(c.task, allowed); break;
          }
          case "task.migrate": {
            if (c.task.kind !== "local" || !/^[a-f0-9-]{36}$/i.test(c.requestId)) throw new Error("请使用稳定 UUID 迁移本地任务。");
            const task = this.task(c.task);
            await this.reminders.create(task.title, c.listId, { due: task.due, description: task.description || "" }, c.task, "Reminder/" + c.requestId.toUpperCase());
            await this.store.update({ reminders: this.reminders.data }, "reminders"); break;
          }
          case "task.delete": await this.reminders.remove(c.task); break;
          case "task.schedule": {
            this.requireMetadata();
            if (c.date !== null && !validDay(c.date)) throw new Error("安排日期无效。");
            const current = this.task(reminderRef(c.task)), old = reminderMetadata(current.description);
            if (c.task.revision !== current.revision || c.task.description !== current.description) throw new Error("任务已在外部修改，请刷新后重新安排。");
            // The undo identity is durable before queuing the mutation, so a crash cannot lose its provenance.
            if (!this.store.data.undo.some(x => x.id === c.requestId)) await this.store.change(data => ({ undo: [...data.undo, { id: c.requestId, task: clone(current), before: old.metadata.scheduledDate, after: c.date }] }), "undo");
            await this.queueDescription(current, withReminderMetadata(current.description || "", { ...old.metadata, scheduledDate: c.date })); break;
          }
          case "task.reorder": await this.reminders.reorder(c.next, c.expected, this.reminders.list()); break;
          case "undo": {
            this.requireMetadata(); const entry = this.store.data.undo.find(x => x.id === c.undoId);
            if (!entry || entry.undone) throw new Error("该安排没有可撤销记录。");
            const current = this.task(reminderRef(entry.task)), parsed = reminderMetadata(current.description);
            const expectedNotes = withReminderMetadata(entry.task.description || "", { ...reminderMetadata(entry.task.description).metadata, scheduledDate: entry.after });
            const operation = [...this.reminders.data.operations].reverse().find(o => o.task.id === current.id && (o.action==="create"?o.task.description:o.patch?.description) === expectedNotes && (o.before?.revision||o.task.revision) === entry.task.revision);
            const expectedRevision = operation?.confirmed?.revision || entry.task.revision;
            if (current.description !== expectedNotes || parsed.metadata.scheduledDate !== entry.after || current.revision !== expectedRevision || current.title !== entry.task.title || current.due !== entry.task.due || current.completed !== entry.task.completed) throw new Error("任务已被再次修改，停止撤销以保护新内容。");
            await this.queueDescription(current, withReminderMetadata(current.description || "", { ...parsed.metadata, scheduledDate: entry.before }));
            await this.store.change(data => ({ undo: data.undo.map(x => x.id === entry.id ? { ...x, undone: true } : x) }), "undo"); break;
          }
          case "event.save": await this.controller.saveEvent(this.bridge.prepareCalendarEvent(c.draft, c.original)); break;
          case "event.delete": await this.controller.deleteEvent(this.bridge.prepareDeletion(c.original), { start: c.start, end: c.end }); break;
          case "record.edit": await this.controller.editRecord(c.record.id, { title: c.title, calendarId: c.calendarId, segments: c.segments }, c.record); break;
          case "record.calendar-only": await this.controller.keepCalendarOnly(c.recordId); break;
          case "settings.save": {
            this.bridge.assertWritable(c.defaultCalendarId);
            for (const [id, calendar] of Object.entries(c.calendarMap)) { if (!this.reminders.data.lists.some(l => l.id === id)) throw new Error("提醒事项列表不存在。"); this.bridge.assertWritable(calendar); }
            await this.store.change(data => ({ settings: { ...data.settings, defaultCalendarId: c.defaultCalendarId, reminders: { ...data.settings.reminders, calendarMap: clone(c.calendarMap) } } }), "settings"); break;
          }
          case "calendar.configure": {
            const sources = calendarSources(c.sources), retained = new Set(sources.filter(s=>s.enabled!==false).map(s=>s.id));
            const protectedIds = new Set([this.controller.state.active?.calendarId, ...this.controller.jobs().flatMap(j=>{const value=j.value as any;return [value.calendarId,value.edit?.calendarId,value.step?.fromCalendarId,value.step?.toCalendarId,...(value.edit?.steps||[]).flatMap((s:any)=>[s.fromCalendarId,s.toCalendarId])];})].filter(Boolean));
            for(const id of protectedIds) if(!retained.has(id)) throw new Error("此日历仍有关联计时或待提交操作，不能停用或移除。");
            await this.store.change(data=>({settings:{...data.settings,calendarSources:sources}}),"settings");
            this.engine.configure(sources,this.store.data.calendar);this.bridge.authorized=null;if(retained.size)await this.bridge.connect();break;
          }
          case "categories.save": {
            const ids=new Set(this.store.data.settings.calendarSources.map(s=>s.id));
            if(!Array.isArray(c.order)||!Array.isArray(c.hidden)||[...c.order,...c.hidden].some(id=>!ids.has(id))||new Set(c.order).size!==c.order.length||new Set(c.hidden).size!==c.hidden.length) throw new Error("分类设置无效。");
            await this.store.change(data=>({settings:{...data.settings,categoryOrder:c.order,hiddenCategoryIds:c.hidden}}),"settings");break;
          }
          case "ownership.activate": {if(c.stoppedOldWriters!==true)throw new Error("请先明确停止旧计时与同步宿主。");await this.store.change(data=>({settings:{...data.settings,ownershipAcknowledged:true}}),"settings");break;}
          case "binding.save": {
            if (!c.note.endsWith(".md") || c.note.startsWith("/") || c.note.split(/[\\/]/).some(x => x === "..")) throw new Error("课题路径无效。");
            const task = this.task(c.task);
            await this.store.change(data => ({ settings: { ...data.settings, bindings: { ...data.settings.bindings, [c.note]: clone(c.task) }, snapshots: { ...data.settings.snapshots, [c.note]: clone(task) } } }), "settings"); break;
          }
          case "shutdown": {
            if (this.controller.state.active?.runningSince != null) await this.controller.pause(this.controller.state.active.id);
            else await this.store.update({ journal: this.controller.state }, "journal"); break;
          }
          default: throw new Error("未知本机指令。");
        }
      });
    } catch (e) { if (!this.store.data.receipts[c.requestId]) throw e; }
    const receipt = this.store.data.receipts[c.requestId];
    if (!receipt) throw new Error("操作未获得持久化确认。");
    this.changed(); return clone(receipt.result);
  }
  private requireMetadata() { if (!this.store.data.settings.metadataVerified) throw new Error("请先在设置中完成安排日期的 Apple 原生往返验证；暂不修改真实任务备注。"); }
  private async queueDescription(task:Task,description:string) { if (!await this.reminders.amendUnsentDescription(task,description)) await this.reminders.update(task,{description}); }
  async authenticate(args: any) {
    if(this.isolated&&(args.username||args.password||args.code))throw new Error("这是离线示例窗口。正式使用前请从托盘退出示例，再运行已安装的应用。");
    if (args.importDir) throw new Error("桌面版不接受未受控的会话目录导入。");
    const result = args.code ? await this.rpc.call("code", { code: String(args.code) }) : await this.reminders.connect({ username: args.username, password: args.password, china: args.china !== false });
    if (!result.needsCode) {
      await this.store.change(data => ({ settings: { ...data.settings, reminders: { ...data.settings.reminders, enabled: true, accountId: result.accountId } } }));
      await this.refresh(); await this.worker.resume("auth");
    }
    this.changed(); return { needsCode: !!result.needsCode };
  }
  async addCalendar(input: { url: string; username: string; password: string; name?: string; ics?: boolean }) {
    if(this.isolated)throw new Error("离线示例不连接真实账户。");
    validUrl(input.url); const key = "caldav-" + createHash("sha256").update(input.username + input.url).digest("hex").slice(0, 24);
    if (!input.ics) await this.secrets.set(key, input.password);
    const found = input.ics ? [{ url: input.url, name: input.name || "订阅", color: "#658da8", components: ["VEVENT"] }] : await this.engine.dav.discover(input.url, input.username, key);
    const added = found.filter(x => x.components.includes("VEVENT")).map(x => {
      const type=input.ics?"ics":"caldav",existing=this.store.data.settings.calendarSources.find(s=>s.url===x.url&&s.username===input.username&&s.type===type);
      return {...x,name:existing?.name||x.name,color:existing?.color||x.color,id:existing?.id||"calendar-"+createHash("sha256").update(JSON.stringify([type,x.url,input.username])).digest("hex").slice(0,20),type,username:input.username,secretKey:input.ics?"":key,readOnly:!!input.ics};
    });
    if (!added.length) throw new Error("未发现可用日历。");
    const sources = calendarSources([...this.store.data.settings.calendarSources.filter(s => !added.some(x => x.id === s.id)), ...added]);
    await this.store.change(data => ({ settings: { ...data.settings, calendarSources: sources } }));
    this.engine.configure(sources, this.store.data.calendar); await this.bridge.connect(); await this.refresh(); this.changed(); return { count: added.length };
  }
  async metadataProbe(check = false) {
    if(this.isolated)throw new Error("离线示例不写入真实提醒事项；请在正式应用完成原生往返验证。");
    if(!this.store.data.settings.ownershipAcknowledged)throw new Error("请先完成旧写入者交接或确认独立模式。");
    if (!check) {
      if (this.reminders.jobs().length) throw new Error("请先处理待同步任务，再创建验证样例。");
      const ref = await this.reminders.create("[CTT 验证] 安排日期往返", this.store.data.settings.reminders.defaultListId || this.reminders.data.lists[0]?.id, { description: withReminderMetadata("请在 Apple 原生提醒事项中，在这段说明后添加 CTT-NATIVE-EDIT-OK，保留应用信息区。", { scheduledDate: "2026-11-07" }) });
      const op = this.reminders.data.operations.find(x => x.task.id === ref.id)!; await this.reminders.sync("reminder:" + op.id);
      if (this.reminders.data.operations.find(x => x.id === op.id)?.status !== "saved") throw new Error("验证样例尚未同步成功，请处理同步异常。");
      return { message: "样例已创建。请在 Apple 原生提醒事项中添加标记 CTT-NATIVE-EDIT-OK，然后点击核对。" };
    }
    await this.reminders.refresh();
    const matches = this.reminders.list().filter(t => t.title === "[CTT 验证] 安排日期往返" && t.description?.split("CTT-NATIVE-EDIT-OK").length === 3 && reminderMetadata(t.description).metadata.scheduledDate === "2026-11-07");
    if (matches.length !== 1) throw new Error("未读取到唯一且完整的原生编辑样例，请等待同步后重试；安排功能仍受保护。");
    await this.store.change(data => ({ settings: { ...data.settings, metadataVerified: true } })); this.changed(); return { message: "原生编辑与安排日期往返已核对，可安排任务。验证样例可手动删除。" };
  }
  async retry(key: string) { if(this.isolated||!this.store.data.settings.ownershipAcknowledged)throw new Error("当前模式不提交云端操作；请先完成宿主交接。");await this.worker.retry(key); }
  async migrationPreview(directory: string) {
    if(this.isolated)throw new Error("请先退出离线示例，再在正式应用导入业务快照。");
    const { item, digest } = await inspectExport(directory);
    return { digest, records: item.data.journal.records.length, tasks: item.data.reminders.items.length, legacyTasks: item.data.legacyTasks?.length || 0, bindings: Object.keys(item.data.settings.bindings).length, pending: item.data.reminders.operations.filter(o => o.status === "pending").length + item.data.journal.records.filter(o => o.status === "pending").length + item.data.journal.operations.filter(o => o.status === "pending").length };
  }
  async migrationImport(directory: string, digest: string) {
    if(this.isolated)throw new Error("离线示例不导入真实业务数据。");
    if (this.controller.state.active || this.worker.view.activeKey || this.refreshFlight) throw new Error("后台正在处理数据，请稍后重试导入。");
    const data = await importExport(directory, digest, this.store.data, path.dirname(this.store.file));
    this.secrets.reload?.();
    await this.store.update(data); this.reminders.load(data.reminders); this.engine.configure(data.settings.calendarSources, data.calendar);
    if (data.settings.calendarSources.length) await this.bridge.connect();
    this.controller = new TimerController({ state: data.journal, ownerDeviceId: data.settings.deviceId, background: true, calendar: this.bridge, tasks: { complete: (task, context) => { if (task.kind !== "reminder") throw new Error("旧本地任务无法自动确认完成；请核对原笔记，或明确选择仅保留工时。"); return this.reminders.completeRemote(task, context); } }, persist: journal => this.store.update({ journal }, "journal"), onChange: () => this.changed() });
    this.changed(); this.worker.wake(); return { ok: true };
  }
  async close() {
    if (this.closed) return; this.closed = true;
    if (this.heartbeat) clearInterval(this.heartbeat); if (this.refreshTimer) clearTimeout(this.refreshTimer); if (this.notification) clearTimeout(this.notification);
    this.worker.stop(); this.engine.stop(); (this.rpc as any).stop?.(); await this.store.settled(); this.listeners.clear();
  }
}
