import { Component, MarkdownRenderer, type App } from "obsidian";

/** FCR owns this supported code-block renderer; no internal FCR objects or settings are copied. */
export class FcrCalendarPanel extends Component {
  private rendered = false;
  private stopped = false;
  constructor(private app: App, private root: HTMLElement) { super(); }
  onload() { void this.activate(); }
  async activate() {
    if (this.stopped || this.rendered) return;
    if (!(this.app as any).plugins?.getPlugin?.("full-calendar-remastered")) { this.root.textContent = "请启用 Full Calendar Remastered 后重新进入日历页。"; return; }
    this.rendered = true; this.root.replaceChildren();
    try { await MarkdownRenderer.render(this.app,"```fc-calendar\ntype: calendar\nview: dayGridMonth\nheight: fit\nheader: true\n```",this.root,"",this); }
    catch (e) { this.rendered = false; if (!this.stopped) this.root.textContent = `日历暂不可用：${(e as Error).message}。可使用上方“完整日历”入口。`; }
  }
  onunload() { this.stopped = true; this.root.replaceChildren(); }
}
