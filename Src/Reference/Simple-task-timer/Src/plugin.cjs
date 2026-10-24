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
