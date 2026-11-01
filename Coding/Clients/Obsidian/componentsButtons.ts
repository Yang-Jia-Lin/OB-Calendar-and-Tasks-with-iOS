import { sameTask, type ActionResult, type TaskRef, type TimerApi } from "./api";
import type { TimerSnapshot } from "../../Shared/application";
import { elapsed, secondsText } from "../../Shared/time";

export interface NativeButtonScope { root: HTMLElement; labels: Set<string> }
interface NativeButton {
  field: HTMLElement; button: HTMLElement; label: HTMLElement; content: HTMLElement; note: string;
  expected: string | null; working: boolean; error: string; restore(): void;
}
const FIELD = ".components--DynamicDataView-PageProperty_button", VALUE = ".components--DynamicDataView-PageProperty-Value";

/** Decorates existing native fields only. The host's one-second status tick supplies the clock. */
export class ComponentsTimerButtons {
  private scopes: NativeButtonScope[] = [];
  private buttons = new Map<HTMLElement, NativeButton>();
  private observer: MutationObserver;
  private unsubscribe: () => void;
  private frame = 0;
  private stopped = false;
  private state: TimerSnapshot;
  constructor(private doc: Document, private host: {
    api: TimerApi; binding(note: string): TaskRef | undefined;
    toggle(note: string, expected: string | null): Promise<ActionResult>;
  }) {
    this.state = host.api.getTimerState();
    this.observer = new MutationObserver(changes => {
      if (changes.some(c => c.type === "attributes" ? (c.target as Element).matches(`a[data-href],${VALUE}`)
        : [...c.addedNodes, ...c.removedNodes].some(n => n.nodeType === 1))) this.schedule();
    });
    this.observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-href", "aria-label"] });
    this.unsubscribe = host.api.subscribeTimer(state => { this.state = state; for (const button of this.buttons.values()) this.paint(button); });
  }
  setScopes(scopes: NativeButtonScope[]) { if (!this.stopped) { this.scopes = scopes; this.reconcile(); } }
  private schedule() {
    if (this.frame || this.stopped) return;
    this.frame = this.doc.defaultView!.requestAnimationFrame(() => { this.frame = 0; this.reconcile(); });
  }
  private reconcile() {
    const found = new Set<HTMLElement>();
    for (const scope of this.scopes) {
      if (!scope.root.isConnected) continue;
      for (const field of scope.root.querySelectorAll<HTMLElement>(FIELD)) {
        const value = field.querySelector<HTMLElement>(VALUE);
        if (!value || !scope.labels.has(value.getAttribute("aria-label") || "")) continue;
        const card = field.closest(".components--DynamicDataView-PageCard");
        const link = card?.querySelector<HTMLAnchorElement>(".components--DynamicDataView-PageTitle a[data-href]");
        const note = link?.getAttribute("data-href");
        const button = value.querySelector<HTMLElement>(".components--DynamicDataView-Button"), label = button?.querySelector<HTMLElement>(".components--DynamicDataView-ButtonLabel");
        const content = field.closest<HTMLElement>(".components--DynamicDataView-PageCardContent");
        if (!note?.endsWith(".md") || !button || !label || !content || card?.classList.contains("components--DynamicDataView-PageCard_preview")) continue;
        found.add(field);
        const previous = this.buttons.get(field);
        if (previous?.button === button && previous.label === label && previous.note === note) continue;
        previous?.restore();
        this.buttons.set(field, this.mount(field, button, label, content, note));
      }
    }
    for (const [field, button] of this.buttons) if (!found.has(field)) { button.restore(); this.buttons.delete(field); }
    for (const button of this.buttons.values()) this.paint(button);
  }
  private mount(field: HTMLElement, button: HTMLElement, label: HTMLElement, content: HTMLElement, note: string): NativeButton {
    const original = { text: label.textContent || "", title: button.getAttribute("title"), role: button.getAttribute("role"), tab: button.getAttribute("tabindex"), aria: button.getAttribute("aria-label"), disabled: button.getAttribute("aria-disabled") };
    const item: NativeButton = { field, button, label, content, note, expected: null, working: false, error: "", restore: () => {} };
    const activate = (e: Event) => {
      e.preventDefault(); e.stopImmediatePropagation();
      if (item.working || !this.state.available || e instanceof MouseEvent && e.detail > 1) return;
      const expected = item.expected; item.working = true; item.error = ""; this.paint(item);
      void this.host.toggle(note, expected).then(r => { if (!r.ok && r.code !== "cancelled") item.error = r.message; })
        .catch(e => { item.error = (e as Error).message; }).finally(() => { item.working = false; if (!this.stopped && this.buttons.get(field) === item) this.paint(item); });
    };
    const key = (e: KeyboardEvent) => {
      if (e.key !== "Enter" && e.key !== " ") return;
      if (e.repeat) { e.preventDefault(); e.stopImmediatePropagation(); return; }
      activate(e);
    };
    button.addEventListener("click", activate, true); button.addEventListener("keydown", key, true);
    button.setAttribute("role", "button"); button.tabIndex = 0;
    field.classList.add("ctt-components-timer-field"); content.classList.add("ctt-components-timer-header");
    button.classList.add("ctt-components-timer-button");
    item.restore = () => {
      button.removeEventListener("click", activate, true); button.removeEventListener("keydown", key, true);
      label.textContent = original.text;
      for (const [name, value] of Object.entries({ title: original.title, role: original.role, tabindex: original.tab, "aria-label": original.aria, "aria-disabled": original.disabled })) value == null ? button.removeAttribute(name) : button.setAttribute(name, value);
      button.classList.remove("ctt-components-timer-button"); button.removeAttribute("data-ctt-state"); field.classList.remove("ctt-components-timer-field");
      if (!content.querySelector(".ctt-components-timer-field")) content.classList.remove("ctt-components-timer-header");
    };
    return item;
  }
  private paint(item: NativeButton) {
    const active = this.state.active, ref = this.host.binding(item.note), own = active && ref && sameTask(active.task, ref);
    item.expected = own ? active.id : null;
    const phase = !this.state.available ? "unavailable" : item.working ? "working" : own ? active.runningSince == null ? "paused" : "running" : active ? "blocked" : "idle";
    const text = phase === "unavailable" ? "计时插件已卸载" : item.working ? "处理中…" : own ? `${active.runningSince == null ? "已暂停" : "●"} ${secondsText(elapsed(active))} · 结束` : "开始计时";
    if (item.label.textContent !== text) item.label.textContent = text;
    item.button.dataset.cttState = phase;
    const title = item.error || (own ? "点击结束，只记录工时，保留任务未完成" : active ? `正在计时「${active.title}」，请先结束该会话` : "点击开始此课题关联的任务");
    if (item.button.title !== title) item.button.title = title;
    if (item.button.getAttribute("aria-label") !== text) item.button.setAttribute("aria-label", text);
    item.button.setAttribute("aria-disabled", String(item.working || !this.state.available));
  }
  dispose() {
    if (this.stopped) return; this.stopped = true; this.observer.disconnect(); this.unsubscribe();
    if (this.frame) this.doc.defaultView!.cancelAnimationFrame(this.frame);
    for (const button of this.buttons.values()) button.restore();
    this.buttons.clear(); this.scopes = [];
  }
}
