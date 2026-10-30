import { clone, uid, isMissingResource, type Task, type Calendar, type WorkRecord, type TimelineRow } from "../../Shared/contracts";
import { localInput, parseLocal } from "../../Shared/time";
import type { TimerController } from "../../Shared/timer";
import type { FcrBridge } from "../../Providers/Fcr/bridge";
import { el, button, field, options } from "./dom";
export interface DialogHost { open(title: string, render: (root: HTMLElement, close: () => void) => void): void; notice(text: string): void }
interface FormActions { save: () => Promise<void>; remove?: { label: string; message: string; run: () => Promise<void> } }
export class Dialogs {
  constructor(private host: DialogHost, private controller: TimerController, private bridge: FcrBridge,
    private calendars: () => Calendar[], private defaultCategory: () => string, private changed: () => Promise<void>, private retryDeletion?: (id: string) => Promise<unknown>) {}
  private form(title: string, render: (form: HTMLElement) => (() => Promise<void>) | FormActions) {
    this.host.open(title, (root, close) => {
      root.classList.add("ctt-dialog"); const form = el(root, "form", "ctt-dialog"); const result = render(form);
      const actions: FormActions = typeof result === "function" ? { save: result } : result;
      const message = el(form, "div", "ctt-dialog-error"); message.setAttribute("role", "alert");
      const confirm = el(form, "div", "ctt-delete-confirm"); confirm.hidden = true;
      const controls = el(form, "div", "ctt-dialog-controls");
      if (actions.remove) {
        el(confirm, "p", "", actions.remove.message);
        const confirmation = el(confirm, "div", "ctt-dialog-controls");
        const cancel = button(confirmation, "取消删除", () => { confirm.hidden = true; save.disabled = false; remove.focus(); });
        const remove = button(controls, actions.remove.label, () => { confirm.hidden = false; save.disabled = true; confirmDelete.focus(); }, "ctt-danger");
        const confirmDelete = button(confirmation, "确认删除", () => { void (async () => {
          confirmDelete.disabled = cancel.disabled = remove.disabled = true; message.textContent = "";
          try { await actions.remove!.run(); await this.changed(); close(); }
          catch (e) { message.textContent = (e as Error).message; confirmDelete.disabled = cancel.disabled = remove.disabled = false; }
        })(); }, "ctt-danger");
      }
      button(controls, "取消", close);
      const save = el(controls, "button", "ctt-primary", "保存"); save.type = "submit";
      form.onsubmit = async e => { e.preventDefault(); if (save.disabled) return; save.disabled = true; message.textContent = "";
        for (const b of controls.querySelectorAll("button")) b.disabled = true;
        try { await actions.save(); await this.changed(); close(); } catch (e) { message.textContent = (e as Error).message; for (const b of controls.querySelectorAll("button")) b.disabled = false; }
      };
    });
  }
  private category(form: HTMLElement, value: string) { const label = el(form, "label", "ctt-field"); el(label, "span", "", "分类"); const select = el(label, "select"); options(select, this.calendars(), value); select.required = true; select.setAttribute("aria-label", "分类"); return select; }
  deletion(id: string) {
    const op = this.controller.state.deletions?.find(o => o.id === id); if (!op || op.status === "saved") return;
    this.host.open("处理待删除记录", (root, close) => {
      root.classList.add("ctt-dialog"); el(root, "strong", "", op.title);
      const message = el(root, "p", "ctt-dialog-error", op.error || "删除结果尚未确认。"); message.setAttribute("role", "alert");
      const confirm = el(root, "div", "ctt-delete-confirm"); confirm.hidden = true;
      el(confirm, "p", "", `确认你已在远端删除“${op.title}”？这会清理该条本地残留和待删除状态，保留其他计时分段及原待办；不向日历发送新增或删除请求。`);
      const confirmation = el(confirm, "div", "ctt-dialog-controls");
      const controls = el(root, "div", "ctt-deletion-actions");
      const run = async (action: () => Promise<unknown>) => {
        for (const b of root.querySelectorAll("button")) b.disabled = true;
        try {
          await action(); await this.changed();
          const current = this.controller.state.deletions?.find(o => o.id === id);
          if (!current || current.status === "saved") { this.host.notice("本地删除状态已清理"); close(); return; }
          message.textContent = current.error || "删除结果尚未确认。"; cleanup.hidden = !isMissingResource(current.error);
        } catch (e) { message.textContent = (e as Error).message; }
        for (const b of root.querySelectorAll("button")) b.disabled = false;
        retry.disabled = !confirm.hidden;
      };
      const retry = button(controls, "重试删除", () => { void run(() => this.retryDeletion ? this.retryDeletion(id) : this.controller.retryDeletion(id)); });
      const cleanup = button(controls, "已在远端删除，清理本地残留", () => { confirm.hidden = false; retry.disabled = true; confirmCleanup.focus(); }); cleanup.hidden = !isMissingResource(op.error);
      button(confirmation, "取消", () => { confirm.hidden = true; retry.disabled = false; cleanup.focus(); });
      const confirmCleanup = button(confirmation, "确认清理", () => { void run(() => this.controller.confirmRemoteDeletion(id)); }, "ctt-danger");
      button(controls, "关闭", close);
    });
  }
  task(task: Task, save: (draft: Partial<Task>) => Promise<void>) {
    const expected = clone(task);
    this.form("编辑待办", form => {
      const title = field(form, "标题", "text", expected.title); title.required = true;
      const category = this.category(form, expected.calendarId || this.defaultCategory()); const due = field(form, "日期", "date", expected.due || "");
      return async () => { this.bridge.assertWritable(category.value); await save({ title: title.value, calendarId: category.value, due: due.value }); };
    });
  }
  start() {
    const active = this.controller.state.active; if (!active) return;
    this.form("修改开始时间", form => {
      const start = field(form, "开始时间", "datetime-local", localInput(active.startedAt)); start.required = true;
      return () => this.controller.updateActive({ startedAt: parseLocal(start.value) }, active.id);
    });
  }
  record(record: WorkRecord, selectedUid?: string) {
    if (record.status !== "saved" || record.edit || this.controller.state.deletions?.some(o => o.recordId === record.id && o.status !== "saved")) { this.host.notice(record.error || "请先在待同步中重试。"); return; }
    if (!record.segments.length) { this.host.notice("此计时记录已删除。"); return; }
    const expected = clone(record);
    const selected = Math.max(0, expected.segments.findIndex(p => p.uid === selectedUid));
    // Capture the current remote snapshots when opening, then compare again at submission.
    const originals = expected.segments.map(p => this.bridge.find(expected.calendarId, p.uid!));
    if (originals.some(x => !x)) { this.host.notice("部分日历记录已删除或移走，请在完整日历中核对。"); return; }
    const query = this.bridge.api().getEvents({}, []);
    const ranges = originals.map((o, i) => { const q = query.find(q => q.id === o!.id); return { start: q?.startMillis ?? expected.segments[i].start, end: q?.endMillis ?? expected.segments[i].end }; });
    this.form("编辑计时记录", form => {
      const title = field(form, "标题", "text", originals[0]!.event.title); title.required = true;
      const category = this.category(form, expected.calendarId);
      const segments = ranges.map((p, i) => {
        const box = el(form, "div", "ctt-segment"); if (ranges.length > 1) el(box, "div", "ctt-segment-label", `时段 ${i + 1}`);
        box.classList.toggle("is-selected", ranges.length > 1 && i === selected);
        const start = field(box, "开始时间", "datetime-local", localInput(p.start)), end = field(box, "结束时间", "datetime-local", localInput(p.end)); start.required = end.required = true;
        return { start, end };
      });
      const save = async () => {
        const result = await this.controller.editRecord(record.id, { title: title.value, calendarId: category.value,
          segments: segments.map(p => ({ start: parseLocal(p.start.value), end: parseLocal(p.end.value) })), snapshots: originals.map(o => clone(o!.event)) }, expected);
        this.host.notice(result.status === "saved" ? "计时记录已更新" : "修改已保存到本机，等待同步");
      };
      const original = originals[selected]!, range = ranges[selected];
      return { save, remove: this.bridge.canDelete(original) ? {
        label: ranges.length > 1 ? "删除此时段" : "删除记录",
        message: `删除“${original.event.title}”（${localInput(range.start).replace("T", " ")} — ${localInput(range.end).replace("T", " ")}）？${ranges.length > 1 ? "其他计时分段保留。" : ""}原待办及其完成状态保留。`,
        run: async () => {
          const target = this.bridge.prepareDeletion(original);
          const op = await this.controller.deleteEvent(target, range, expected);
          this.host.notice(op.status === "saved" ? "计时时段已删除" : "删除请求已保存，等待同步");
        }
      } : undefined };
    });
  }
  event(date: string, row?: TimelineRow) {
    if (row?.unsupported || (row && !row.original?.event.uid)) { this.host.notice("此日程请在完整日历中编辑。"); void this.bridge.openCalendar(); return; }
    const original = clone(row?.original), eventUid = original?.event.uid || `ctt-event-${uid()}`;
    this.form(original ? "编辑日程" : "新增日程", form => {
      const title = field(form, "标题", "text", row?.title || ""); title.required = true;
      const category = this.category(form, row?.calendarId || this.defaultCategory());
      const start = field(form, "开始时间", "datetime-local", row ? localInput(row.start) : `${date}T09:00:00`);
      const end = field(form, "结束时间", "datetime-local", row ? localInput(row.end) : `${date}T09:30:00`); start.required = end.required = true;
      const save = async () => {
        const step = await this.bridge.prepareEvent({ title: title.value, start: parseLocal(start.value), end: parseLocal(end.value), calendarId: category.value, uid: eventUid }, original);
        const op = await this.controller.saveEvent(step); this.host.notice(op.status === "saved" ? "日程已保存" : "日程修改已在本机保存，等待同步");
      };
      return { save, remove: original && this.bridge.canDelete(original) ? {
        label: "删除日程", message: `删除“${original.event.title}”及其日历事件？`,
        run: async () => {
          const target = this.bridge.prepareDeletion(original), op = await this.controller.deleteEvent(target, { start: row!.start, end: row!.end });
          this.host.notice(op.status === "saved" ? "日程已删除" : "删除请求已保存，等待同步");
        }
      } : undefined };
    });
  }
}
