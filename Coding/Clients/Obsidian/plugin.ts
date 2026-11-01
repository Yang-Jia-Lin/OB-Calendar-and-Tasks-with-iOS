import { Plugin, ItemView, PluginSettingTab, Setting, Modal, Notice, MarkdownRenderChild, getFrontMatterInfo, parseYaml, type WorkspaceLeaf, type TFile } from "obsidian";
import fs from "node:fs/promises";
import path from "node:path";
import { TimerController, blankJournal } from "../../Shared/timer";
import { uid, type Task, type TimelineRow, type Calendar } from "../../Shared/contracts";
import { dayKey } from "../../Shared/time";
import { mergeTimeline } from "../../Shared/timeline";
import { CalendarBridge } from "../../Providers/Calendar/bridge";
import { CalendarEngine } from "../../Providers/Calendar/engine";
import { calendarSources, calendarPreferences, type CalendarSource, type CalendarPreferences } from "../../Providers/Calendar/config";
import { setupCalendarEngine, CalendarCacheFile } from "./calendarStorage";
import { renderCalendarSettings } from "./calendarSettings";
import { MarkdownTasks } from "./tasks";
import { JournalStore, prepareLegacyImport, type Settings } from "./journal";
import { TimerUI, type ViewModel, type Actions } from "./ui";
import { Dialogs, type DialogHost } from "./dialogs";
import { appearance, applyAppearance, mountTimerView, DEFAULT_APPEARANCE } from "./appearance";
import { setupStatus, updateStatus } from "./status";
import { categoryPreferences, renderCategorySettings, type CategoryPreferences } from "./categories";
import { taskSort, TASK_SORT_LABELS, type TaskSort } from "./taskOrder";
import { SyncWorker } from "../../Shared/sync";
import { pendingView, syncKey } from "./syncStatus";
import { TimerApi, taskRef, sameTask, type ActionResult, type TaskRef } from "./api";
import { componentTaskBindings, componentTaskSnapshots, nativeTimerLabels, toggleNoteTimer } from "./components";
import { ComponentsTimerButtons, type NativeButtonScope } from "./componentsButtons";
import { DiaryUpdater, diaryDate, diaryPath, DEFAULT_DIARY_FOLDER, DEFAULT_DIARY_LAYOUT, DEFAULT_DIARY_LAYOUT_PATH } from "./diary";
import { mountDiaryButton } from "./diaryButton";
import { CalendarPanel } from "./calendarPanel";
import { mountNoteTaskForm } from "./noteTaskForm";
import { ApplicationState, appPage, focusLimit, focusRefs, refKey, type TaskCompletion, type SessionStore, type CalendarQuery } from "../../Shared/application";
const VIEW = "calendar-task-timer-view";
function hash(text: string) { let n = 2166136261; for (const c of text) n = Math.imul(n ^ c.charCodeAt(0), 16777619); return (n >>> 0).toString(16); }
class TimerView extends ItemView {
  ui?: TimerUI;
  private unsubs: (()=>void)[] = [];
  private queued = false;
  constructor(leaf: WorkspaceLeaf, private owner: CalendarTaskTimer) { super(leaf); }
  getViewType() { return VIEW; } getDisplayText() { return "日历与待办计时"; } getIcon() { return "timer"; }
  async onOpen() {
    this.ui = new TimerUI(mountTimerView(this.contentEl), {...this.owner.actions(),mountCalendar:root=>{
      return this.owner.mountCalendar(root);
    }});
    for(const key of ["tasks","session","execution","sync"] as const)this.unsubs.push(this.owner.application.subscribe(key,()=>{if(this.queued)return;this.queued=true;queueMicrotask(()=>{this.queued=false;this.render();});}));
    this.render();
  }
  render() { this.ui?.update(this.owner.application.get("view") || this.owner.model()); }
  async onClose() { for(const unsub of this.unsubs)unsub();this.unsubs=[];this.ui?.destroy();this.ui=undefined; }
}
class DiaryButton extends MarkdownRenderChild {
  private dispose?: () => void;
  constructor(root: HTMLElement, private source: string, private owner: CalendarTaskTimer) { super(root); }
  onload() { this.dispose = mountDiaryButton(this.containerEl, this.source, p => this.owner.updateDiaryFromNote(p)); }
  onunload() { this.dispose?.(); }
}
class FormModal extends Modal {
  private restore: Element | null = null;
  constructor(app: CalendarTaskTimer["app"], private title: string, private renderForm: (root: HTMLElement, close: () => void) => void) { super(app); }
  onOpen() { this.restore = document.activeElement; this.titleEl.textContent = this.title; this.contentEl.classList.add("ctt-dialog"); this.renderForm(this.contentEl, () => this.close()); }
  onClose() { this.contentEl.replaceChildren(); if (this.restore instanceof HTMLElement && this.restore.isConnected) this.restore.focus(); }
}
class NoteTaskModal extends Modal {
  private selected: string | null = null;
  constructor(app: CalendarTaskTimer["app"], private noteName: string, private calendars: Calendar[], private category: string, private existing: boolean, private done: (category: string | null) => void) { super(app); }
  onOpen() {
    this.titleEl.textContent = `${this.existing?"设置分类":"创建计时待办"} · ${this.noteName}`;
    mountNoteTaskForm(this.contentEl,this.noteName,this.calendars,this.category,this.existing,category=>{this.selected=category;this.close();});
  }
  onClose() { this.contentEl.replaceChildren(); this.done(this.selected); }
}
class TimerSettings extends PluginSettingTab {
  constructor(app: CalendarTaskTimer["app"], private owner: CalendarTaskTimer) { super(app, owner); }
  display() {
    const p = this.owner, root = this.containerEl; root.replaceChildren();
    renderCalendarSettings(root,p,()=>this.display());
    let calendars: { id: string; name: string }[] = []; try { calendars = p.bridge.writableCalendars(); } catch {}
    new Setting(root).setName("默认分类").setDesc("新待办预填此分类。日历失效时不会自动改投。")
      .addDropdown(d => { d.addOption("", "选择分类"); for (const c of calendars) d.addOption(c.id, c.name); d.setValue(p.settings.defaultCalendarId).onChange(async value => { p.settings.defaultCalendarId = value; await p.saveSettings(); p.render(); }); });
    new Setting(root).setName("待办分类排序与显示");
    const categoryRoot = root.ownerDocument.createElement("div"); root.append(categoryRoot);
    renderCategorySettings(categoryRoot, calendars, p.settings, next => p.saveCategoryPreferences(next));
    new Setting(root).setName("待办显示顺序").setDesc("手动模式可拖动任务左侧手柄，或用 Alt + ↑ / ↓ 排序。")
      .addDropdown(d => d.addOptions(TASK_SORT_LABELS).setValue(taskSort(p.settings.taskSort)).onChange(value => { void p.run(() => p.saveTaskSort(taskSort(value))); }));
    new Setting(root).setName("页面字号").setDesc("计时、待办和时间轴一起调整。")
      .addSlider(s => s.setLimits(13, 20, 1).setValue(appearance(p.settings).fontSize).setDynamicTooltip().onChange(async value => { p.settings.fontSize = value; p.render(); await p.saveSettings(); }));
    new Setting(root).setName("页面字重").addDropdown(d => d.addOptions({ "400": "常规", "500": "适中", "600": "加粗" }).setValue(String(appearance(p.settings).fontWeight)).onChange(async value => { p.settings.fontWeight = Number(value); p.render(); await p.saveSettings(); }));
    new Setting(root).setName("待办文件").addText(t => { t.setValue(p.settings.tasksPath); t.inputEl.onchange = () => { void p.run(async () => { const before = p.settings.tasksPath; p.settings.tasksPath = t.inputEl.value; try { p.tasks.path(); await p.saveSettings(); await p.refresh(); } catch (e) { p.settings.tasksPath = before; throw e; } }); }; });
    new Setting(root).setName("打开待办文件").addButton(b => b.setButtonText("打开").onClick(() => { void p.run(async () => { const file = await p.tasks.file(true); if (file) await p.app.workspace.getLeaf(false).openFile(file); }); }));
    new Setting(root).setName("日记时间轴").setDesc("日记中的按钮或“更新当前日记时间轴”命令只替换生成区，保留手写内容；快照使用日历当前已加载数据。");
    for (const [key, label, fallback] of [["diaryFolder", "日记目录", DEFAULT_DIARY_FOLDER], ["diaryLayoutPath", "时间轴排版模板", DEFAULT_DIARY_LAYOUT_PATH]] as const) {
      new Setting(root).setName(label).setDesc(key === "diaryLayoutPath" ? "可在 Obsidian 中直接编辑；保留 {{timeline}}。模板不存在时使用内置排版。" : "只允许更新此目录内、文件名含年月日的日记。")
        .addText(t => { t.setValue(p.settings[key] || fallback); t.inputEl.onchange = () => { void (async () => {
          try { const next = diaryPath(t.inputEl.value, fallback); if (key === "diaryLayoutPath" && !next.endsWith(".md")) throw new Error("排版模板须为 Markdown 文件。"); p.settings[key] = next; await p.saveSettings(); }
          catch (e) { t.setValue(p.settings[key] || fallback); new Notice((e as Error).message); }
        })(); }; });
    }
    const bindings = componentTaskBindings(p.settings.componentTaskBindings);
    if (Object.keys(bindings).length) {
      new Setting(root).setName("Components 卡片按钮绑定").setDesc("卡片使用 Components 原生按钮；任务关联保存在本插件设置中。");
      for (const [note, ref] of Object.entries(bindings)) new Setting(root).setName(note).setDesc(p.model().tasks.find(t => t.path === ref.path && t.id === ref.id)?.title || "原待办已删除；下次开始会恢复")
        .addButton(b => b.setButtonText("修改分类").onClick(() => { void p.configureNoteTask(note).then(() => this.display()).catch(e => new Notice((e as Error).message)); }));
    }
    new Setting(root).setName("导入旧版数据").setDesc("先结束计时并禁用旧插件。仅导入当前设备设置和日志；原文件与授权令牌保留。新版已有记录时不允许覆盖。")
      .addButton(b => b.setButtonText(p.settings.importedLegacy ? "已导入" : "导入旧版").setDisabled(p.settings.importedLegacy).onClick(() => { void p.run(async () => { await p.importLegacy(); this.display(); }); }));
  }
}
export default class CalendarTaskTimer extends Plugin {
  settings: Settings = { defaultCalendarId: "", tasksPath: "待办计时/待办.md", importedLegacy: false, ...DEFAULT_APPEARANCE };
  controller!: TimerController; bridge!: CalendarBridge; engine!:CalendarEngine; private calendarStore?:CalendarCacheFile; tasks!: MarkdownTasks; dialogs!: Dialogs;
  worker?: SyncWorker;
  api!: TimerApi;
  readonly application = new ApplicationState<{view:ViewModel|null;tasks:Task[];session:ViewModel["active"];execution:object|null;sync:object|null}>({view:null,tasks:[],session:null,execution:null,sync:null});
  private completionEvents: TaskCompletion[] = [];
  private calendarCache = new Map<string, typeof this.calendarView>();
  private noteChoices = new Map<string, Promise<TaskRef | null>>();
  private noteToggles = new Map<string, Promise<ActionResult>>();
  private componentButtons?: ComponentsTimerButtons;
  private diary!: DiaryUpdater;
  private componentRevision = 0;
  get connected() { return this.bridge?.connected ?? false; }
  private busy = false; private error = ""; private date = dayKey(); private items: Task[] = [];
  private store!: JournalStore; private base = ""; private vaultId = ""; private pluginDir = ""; private status?: HTMLElement;
  private sessionStore!: SessionStore; private calendarQuery!: CalendarQuery;
  private importing = false; private timers = new Set<number>();
  private unloaded = false; private snapshotQueued = false;
  private calendarView: { date: string; sources: ViewModel["sources"]; calendars: ViewModel["calendars"]; rows: TimelineRow[]; error: string } = { date: "", sources: [], calendars: [], rows: [], error: "" };
  async onload() {
    const data = await this.loadData() || {};
    for (const k of ["defaultCalendarId", "tasksPath"] as const) if (typeof data[k] === "string") this.settings[k] = data[k];
    this.settings.importedLegacy = data.importedLegacy === true;
    this.settings.calendarSources=calendarSources(data.calendarSources);this.settings.calendarPreferences=calendarPreferences(data.calendarPreferences);if(typeof data.calendarMigration==="string")this.settings.calendarMigration=data.calendarMigration;
    Object.assign(this.settings, appearance(data));
    Object.assign(this.settings, categoryPreferences(data));
    this.settings.taskSort = taskSort(data.taskSort);
    this.settings.componentTaskBindings = componentTaskBindings(data.componentTaskBindings);
    this.settings.componentTaskSnapshots = componentTaskSnapshots(data.componentTaskSnapshots);
    this.settings.appPage=appPage(data.appPage);this.settings.focusPins=focusRefs(data.focusPins);this.settings.focusLimit=focusLimit(data.focusLimit);
    for (const [key, fallback] of [["diaryFolder", DEFAULT_DIARY_FOLDER], ["diaryLayoutPath", DEFAULT_DIARY_LAYOUT_PATH]] as const) {
      try { this.settings[key] = diaryPath(data[key], fallback); } catch { this.settings[key] = fallback; }
    }
    this.base = (this.app.vault.adapter as any).getBasePath?.(); if (!this.base) throw new Error("本版仅支持桌面 Obsidian。");
    this.vaultId = hash(this.base); this.pluginDir = path.join(this.base, this.manifest.dir || `${this.app.vault.configDir}/plugins/${this.manifest.id}`);
    const key = `calendar-task-timer-device-${this.vaultId}`;
    let device = window.localStorage.getItem(key); if (!/^[a-f0-9-]{36}$/i.test(device || "")) { device = uid(); window.localStorage.setItem(key, device); }
    this.store = new JournalStore(path.join(this.pluginDir, "sessions", `${device}.json`));
    this.sessionStore = this.store;
    const calendar=await setupCalendarEngine(this,this.pluginDir,()=>{if(!this.unloaded){this.scheduleSnapshot();this.worker?.wake();}},async()=>{this.settings.appPage="calendar";await this.openView();this.render();for(const leaf of this.app.workspace.getLeavesOfType(VIEW))(leaf.view as TimerView).ui?.selectPage("calendar");});
    this.engine=calendar.engine;this.calendarStore=calendar.store;this.bridge=new CalendarBridge(this.engine);
    this.calendarQuery = this.bridge;
    this.tasks = new MarkdownTasks(this.app, () => this.settings.tasksPath);
    const state = await this.sessionStore.load();
    if (state.legacyImport && !this.settings.importedLegacy) { this.settings = { ...this.settings, ...state.legacyImport, importedLegacy: true }; await this.saveSettings(); }
    this.controller = new TimerController({ state, persist: s => this.sessionStore.save(s), calendar: this.bridge, background: true, ownerDeviceId:device!,
      tasks: { complete: task => this.completeOriginal(task) }, onChange: () => { this.render(); this.worker?.wake(); } });
    const recovered = await this.controller.recover();
    this.initializeApi();
    this.initializeDiary();
    this.componentButtons = new ComponentsTimerButtons(document, { api: this.api,
      binding: note => componentTaskBindings(this.settings.componentTaskBindings)[note],
      toggle: (note, expected) => this.toggleFromNote(note, false, expected) });
    this.worker = new SyncWorker(this.controller, { channel: this.store.file.toLowerCase(), enabled: () => this.connected && !this.importing && !this.unloaded && navigator.onLine !== false,
      changed: () => this.render(), settled: () => { this.readCalendarView(); this.scheduleSnapshot(); } });
    const host: DialogHost = { open: (title, render) => new FormModal(this.app, title, (root, close) => { applyAppearance(root, this.settings); render(root, close); }).open(), notice: text => { new Notice(text); } };
    this.dialogs = new Dialogs(host, this.controller, this.bridge, () => this.bridge.writableCalendars(), () => this.settings.defaultCalendarId, () => this.refreshLocal(), id => this.worker!.retry(`delete:${id}`),()=>calendarPreferences(this.settings.calendarPreferences).timezone);
    this.registerView(VIEW, leaf => new TimerView(leaf, this)); this.addRibbonIcon("timer", "日历与待办计时", () => { void this.openView(); });
    this.addCommand({ id: "open", name: "打开计时与时间轴", callback: () => { void this.openView(); } });
    this.addCommand({ id: "start-note-task", name: "开始当前课题的计时任务", callback: () => { void this.startFromNote(this.app.workspace.getActiveFile()?.path || ""); } });
    this.addCommand({ id: "pause-resume", name: "暂停／继续当前计时", callback: () => { const s = this.api.getState().active; void this.showResult(s?.runningSince == null ? this.api.resume(s?.id || "") : this.api.pause(s.id)); } });
    this.addCommand({ id: "finish-record-only", name: "结束计时只记时间", callback: () => this.actions().finish(false) });
    this.addCommand({ id: "finish", name: "结束计时并完成待办", callback: () => this.actions().finish(true) });
    this.addCommand({ id: "update-diary-timeline", name: "更新当前日记时间轴", callback: () => {
      void this.updateDiaryFromNote(this.app.workspace.getActiveFile()?.path || "").then(r => new Notice(`日记时间轴已更新，共 ${r.count} 项`)).catch(e => new Notice((e as Error).message));
    } });
    this.registerMarkdownCodeBlockProcessor("calendar-task-timer-diary", (source, el, ctx) => {
      if (source.trim()) { el.textContent = "日记更新按钮不需要脚本参数。"; return; }
      ctx.addChild(new DiaryButton(el, ctx.sourcePath, this));
    });
    this.addSettingTab(new TimerSettings(this.app, this)); this.status = this.addStatusBarItem(); setupStatus(this.status, () => { void this.openView(); });
    this.registerInterval(window.setInterval(() => this.tick(), 1000));
    this.registerInterval(window.setInterval(() => { if (!this.importing) void this.controller.heartbeat().catch(e => this.fail(e)); }, 15000));
    this.registerInterval(window.setInterval(() => { if (!this.busy) void this.refresh(true).catch(e => this.fail(e)); }, 30000));
    this.registerEvent(this.app.vault.on("modify", file => {
      if (file.path === this.settings.tasksPath) this.later(() => { void this.refreshLocal().catch(e => this.fail(e)); }, 180);
      if (file.path.endsWith(".components")) void this.refreshComponentButtons();
    }));
    this.registerEvent(this.app.workspace.on("layout-change", () => { void this.refreshComponentButtons(); }));
    this.app.workspace.onLayoutReady(() => { void (async () => { try { await this.bridge.connect(false); await this.worker?.resume("auth"); } catch {} await this.refresh();void this.engine.refresh().catch(e=>this.fail(e)); if (recovered) new Notice("上次计时已恢复为暂停。"); })().catch(e => this.fail(e)); });
    this.registerInterval(window.setInterval(()=>{if(!this.unloaded&&navigator.onLine!==false)void this.engine.refresh().catch(e=>this.fail(e));},120000));
    const online = () => { void this.engine.refresh().catch(e=>this.fail(e)); void this.worker?.resume("network").catch(e => this.fail(e)); };
    window.addEventListener("online", online); this.register(() => window.removeEventListener("online", online));
    // Save an extra heartbeat when hidden; crash recovery stops at the last durable heartbeat.
    const visibility = () => { if (document.visibilityState === "hidden") void this.controller.heartbeat().catch(e => this.fail(e)); };
    document.addEventListener("visibilitychange", visibility); this.register(() => document.removeEventListener("visibilitychange", visibility));
    await this.refresh();
    await this.refreshComponentButtons();
  }
  onunload() { this.unloaded = true;this.engine?.stop();this.calendarStore?.stop(); this.application.dispose();this.componentButtons?.dispose(); this.api?.dispose(); this.worker?.stop(); for (const id of this.timers) window.clearTimeout(id); }
  private diaryFile(note: string): TFile {
    const file = this.app.vault.getAbstractFileByPath(note);
    if (!file || !("extension" in file) || file.extension !== "md") throw new Error("请先打开一篇日记。");
    return file as TFile;
  }
  private initializeDiary() {
    this.diary = new DiaryUpdater({
      available: () => !this.unloaded,
      read: note => this.app.vault.read(this.diaryFile(note)),
      date: (note, text) => { const info = getFrontMatterInfo(text); const fm = info.exists ? parseYaml(info.frontmatter) : {};
        return diaryDate(note, fm?.["日记日期"], this.settings.diaryFolder || DEFAULT_DIARY_FOLDER); },
      layout: async () => { const file = this.app.vault.getAbstractFileByPath(this.settings.diaryLayoutPath || DEFAULT_DIARY_LAYOUT_PATH);
        if (!file) return DEFAULT_DIARY_LAYOUT;
        if (!("extension" in file) || file.extension !== "md") throw new Error("日记时间轴模板不是 Markdown 文件。");
        return this.app.vault.read(file as TFile); },
      snapshot: async date => {
        if (!this.connected) throw new Error("请先在插件中连接日历，原时间轴已保留。");
        const calendars = this.bridge.sources().filter(c=>c.type!=="caldavtasks"), groups = this.bridge.api().getAllEvents();
        if (!calendars.length || calendars.some(c => !groups.some(g => g.id === c.id))) throw new Error("部分日历尚未加载，请在日历同步完成后重试；原时间轴已保留。");
        const state = this.controller.state;
        return { calendars, rows: mergeTimeline(this.bridge.timeline(date), state.records, date, state.operations, state.deletions) };
      },
      backup: async (_note, text) => { const folder = path.join(this.pluginDir, "diary-backups"); await fs.mkdir(folder, { recursive: true }); await fs.writeFile(path.join(folder, `${Date.now()}-${uid()}.md`), text, { flag: "wx" }); },
      process: async (note, update) => { const file = this.diaryFile(note); await this.app.vault.process(file, text => { if (file.path !== note) throw new Error("日记已移动或重命名，请重新更新。"); return update(text); }); }
    });
  }
  updateDiaryFromNote(note: string) { return this.diary.update(note); }
  private async refreshComponentButtons() {
    const revision = ++this.componentRevision, sources: { file: TFile; root: HTMLElement }[] = [];
    this.app.workspace.iterateAllLeaves(leaf => {
      const file = (leaf.view as unknown as { file?: TFile }).file;
      if (leaf.view.getViewType() === "components-file-view" && file?.extension === "components") sources.push({ file, root: leaf.view.containerEl });
    });
    const reads = new Map<string, Promise<Set<string>>>();
    const scopes: NativeButtonScope[] = await Promise.all(sources.map(async ({ file, root }) => {
      let read = reads.get(file.path);
      if (!read) { read = this.app.vault.read(file).then(text => nativeTimerLabels(JSON.parse(text))).catch(() => new Set<string>()); reads.set(file.path, read); }
      return { root, labels: await read };
    }));
    if (!this.unloaded && revision === this.componentRevision) this.componentButtons?.setScopes(scopes);
  }
  private initializeApi() {
    this.api = new TimerApi({ controller: this.controller, resolve: async (ref,context) => {
      if(context?.source!=="components")return this.tasks.resolve(ref);
      const note=context.path || "",binding=componentTaskBindings(this.settings.componentTaskBindings)[note],file=this.app.vault.getAbstractFileByPath(note);
      if(!binding||refKey(binding)!==refKey(ref)||!file||!("extension" in file)||file.extension!=="md")throw new Error("课题绑定无效，请检查课题与待办文件设置。");
      const active=this.controller.state.active;
      if(active){if(sameTask(active.task,ref))return active.task;throw new Error("请先结束当前计时，再开始另一个课题。");}
      if(this.controller.state.records.some(r=>r.completeTask&&!r.taskSaved&&sameTask(r.task,ref)))throw new Error("此任务还有完成状态待确认，请先处理同步队列。");
      if((this.app as any).plugins?.getPlugin?.("simple-task-timer")?.controller?.state?.active)throw new Error("旧插件仍在计时，请先结束旧版会话。");
      if(!this.connected)throw new Error("请先连接日历。");
      const seed=componentTaskSnapshots(this.settings.componentTaskSnapshots)[note] || this.items.find(t=>sameTask(t,ref)) || {title:file.name.replace(/\.md$/i,""),calendarId:this.settings.defaultCalendarId,due:""};
      const task=await this.tasks.restoreBound(ref,seed,current=>this.bridge.assertWritable(current.calendarId || this.settings.defaultCalendarId));
      await this.refreshLocal();return task;
    },
      prepare: async task => {
        if ((this.app as any).plugins?.getPlugin?.("simple-task-timer")?.controller?.state?.active) throw new Error("旧插件仍在计时，请先结束旧版会话。");
        const category = task.calendarId || this.settings.defaultCalendarId; this.bridge.assertWritable(category);
        if (!task.calendarId) await this.tasks.update(task, { calendarId: category });
        return this.tasks.resolve(taskRef(task));
      }, execute: action => this.execute(action), refresh: () => this.refreshLocal(),
      state: () => ({ available: !this.unloaded, active: this.controller.state.active, tasks: this.items, pending: this.controller.jobs().length, sync: this.worker?.view }) });
  }
  async openView() { let leaf = this.app.workspace.getLeavesOfType(VIEW)[0]; if (!leaf) { leaf = this.app.workspace.getLeaf("tab"); await leaf.setViewState({ type: VIEW, active: true }); } await this.app.workspace.revealLeaf(leaf); }
  openCalendarForm(title:string,render:(root:HTMLElement,close:()=>void)=>void){new FormModal(this.app,title,(root,close)=>{applyAppearance(root,this.settings);render(root,close);}).open();}
  calendarNotice(message:string){new Notice(message);}
  async setSources(sources:CalendarSource[]){const next=calendarSources(sources),before=this.settings.calendarSources;this.settings.calendarSources=next;try{await this.saveSettings();}catch(e){this.settings.calendarSources=before;throw e;}this.engine.migrationError="";this.engine.configure(next);if(next.some(s=>s.enabled!==false))await this.bridge.connect();else this.bridge.authorized=null;this.error="";await this.refresh();void this.engine.refresh().then(()=>this.engine.refresh()).catch(e=>this.fail(e));await this.worker?.resume("auth");}
  async setCalendarPreferences(prefs:CalendarPreferences){const before=this.settings.calendarPreferences;this.settings.calendarPreferences=calendarPreferences(prefs);try{await this.saveSettings();}catch(e){this.settings.calendarPreferences=before;throw e;}this.engine.configure(this.engine.sourceConfigs());this.render();}
  calendarRows(from:number,to:number){const state=this.controller.state,remote=this.engine.rows(from,to),rows=new Map<string,TimelineRow>();let date=new Date(from);date.setHours(0,0,0,0);for(let i=0;i<400&&+date<to;i++){for(const row of mergeTimeline(remote,state.records,dayKey(+date),state.operations,state.deletions))if(row.start<to&&row.end>from)rows.set(row.key,row);date.setDate(date.getDate()+1);}return [...rows.values()];}
  mountCalendar(root:HTMLElement){return new CalendarPanel(root,{preferences:()=>calendarPreferences(this.settings.calendarPreferences),sources:()=>this.engine.getCalendarSources(),rows:(a,b)=>this.calendarRows(a,b),state:()=>this.engine.state,writable:id=>this.engine.getProviderCapabilities(id).canEdit,subscribe:fn=>{const a=this.engine.subscribe(fn),b=this.application.subscribe("execution",fn);return ()=>{a();b();};},create:(start,end,allDay)=>this.dialogs.calendar(start,end,allDay),edit:row=>{if(row.recordId||row.pending)this.actions().editRow(row);else this.dialogs.calendar(row.start,row.end,!!row.allDay,row);},move:async(row,start,end,allDay)=>{if(!row.original||row.pending||row.original.event.type==="recurring")throw new Error("请打开日程编辑整个周期系列。");await this.execute(async()=>{if(row.recordId){const record=this.controller.state.records.find(r=>r.id===row.recordId)!;const segments=record.segments.map(s=>s.uid===row.segmentUid?{start,end}:{start:s.start,end:s.end});await this.controller.editRecord(record.id,{title:record.title,calendarId:record.calendarId,segments},record);}else{const event=row.original!.event,step=this.bridge.prepareCalendarEvent({title:event.title,start,end,allDay,calendarId:row.calendarId,rrule:String(event.rrule||""),description:event.description,location:String(event.location||"")},row.original);await this.controller.saveEvent(step);}await this.refreshLocal();});},notice:message=>new Notice(message)});}
  async saveSettings() { await this.saveData(this.settings); }
  configureNoteTask(notePath: string): Promise<TaskRef | null> {
    const existing = this.noteChoices.get(notePath); if (existing) return existing;
    const choice = this.chooseNoteTask(notePath); this.noteChoices.set(notePath, choice);
    void choice.finally(() => this.noteChoices.delete(notePath)).catch(() => {}); return choice;
  }
  private chooseNoteCategory(title: string, calendars: Calendar[], category: string, existing: boolean) {
    return new Promise<string|null>(resolve=>{const modal=new NoteTaskModal(this.app,title,calendars,category,existing,resolve);this.register(()=>modal.close());modal.open();});
  }
  private async chooseNoteTask(notePath: string) {
    const file=this.app.vault.getAbstractFileByPath(notePath);
    if(!file||!("extension" in file)||file.extension!=="md")throw new Error("请从一张 Markdown 课题卡片或课题笔记开始计时。");
    if(this.controller.state.active)throw new Error("请先结束当前计时，再设置课题分类。");
    const previous=componentTaskBindings(this.settings.componentTaskBindings)[notePath],current=this.items.find(t=>previous&&sameTask(t,previous));
    const title=current?.title || file.name.replace(/\.md$/i,""),calendars=this.bridge.writableCalendars();
    if(!calendars.length)throw new Error("没有可写分类，请先连接并设置日历。");
    const category=await this.chooseNoteCategory(title,calendars,current?.calendarId || this.settings.defaultCalendarId,!!previous);
    if(!category||this.unloaded)return null;
    return this.execute(async()=>{
      if(this.controller.state.active)throw new Error("请先结束当前计时，再设置课题分类。");
      if(this.app.vault.getAbstractFileByPath(notePath)!==file)throw new Error("课题笔记已移动，请重新打开。");
      this.bridge.assertWritable(category);
      const before=componentTaskBindings(this.settings.componentTaskBindings),beforeSnapshots=componentTaskSnapshots(this.settings.componentTaskSnapshots);
      const ref=before[notePath] || {kind:"local" as const,path:this.tasks.path(),id:uid()},seed={title,due:current?.due||"",calendarId:category};
      this.settings.componentTaskBindings={...before,[notePath]:ref};this.settings.componentTaskSnapshots={...beforeSnapshots,[notePath]:seed};
      try{await this.saveSettings();}catch(e){this.settings.componentTaskBindings=before;this.settings.componentTaskSnapshots=beforeSnapshots;throw e;}
      await this.tasks.configureBound(ref,seed);await this.refreshLocal();return ref;
    });
  }
  async startFromNote(notePath: string, chooseTask = false, notify = true): Promise<ActionResult> {
    let result: ActionResult;
    try {
      if (this.unloaded) return { ok: false, code: "unavailable", message: "计时插件已卸载。" };
      const file = this.app.vault.getAbstractFileByPath(notePath);
      if (!file || !("extension" in file) || file.extension !== "md") throw new Error("请从课题卡片开始，或先打开对应课题笔记。");
      const ref = !chooseTask && componentTaskBindings(this.settings.componentTaskBindings)[notePath] || await this.configureNoteTask(notePath);
      result = ref ? await this.api.start(ref, { source: "components", path: notePath }) : { ok: false, code: "cancelled", message: "已取消设置课题待办。" };
    } catch (e) { result = { ok: false, code: "action-error", message: (e as Error).message }; }
    if (notify) await this.showResult(Promise.resolve(result)); return result;
  }
  private async removeTask(task: Task) {
    await this.execute(async()=>{
      if(this.controller.state.active && sameTask(this.controller.state.active.task,taskRef(task)))throw new Error("请先结束这项任务的计时，再删除待办。");
      if(this.controller.state.records.some(r=>r.completeTask&&!r.taskSaved&&sameTask(r.task,taskRef(task))))throw new Error("此任务还有完成状态待确认，请先处理同步队列。");
      const snapshots=componentTaskSnapshots(this.settings.componentTaskSnapshots);
      for(const [note,ref] of Object.entries(componentTaskBindings(this.settings.componentTaskBindings)))if(sameTask(task,ref))snapshots[note]={title:task.title,due:task.due||"",calendarId:task.calendarId||this.settings.defaultCalendarId};
      this.settings.componentTaskSnapshots=snapshots;await this.saveSettings();await this.tasks.remove(task);await this.refreshLocal();
    });
  }
  toggleFromNote(notePath: string, chooseTask = false, expectedSession?: string | null): Promise<ActionResult> {
    if (this.unloaded) return Promise.resolve({ ok: false, code: "unavailable", message: "计时插件已卸载。" });
    const ref = componentTaskBindings(this.settings.componentTaskBindings)[notePath], key = ref ? JSON.stringify(ref) : notePath;
    const previous = this.noteToggles.get(key); if (previous) return previous;
    const action = (async () => {
      const result = chooseTask ? await this.startFromNote(notePath, true, false) : await toggleNoteTimer(notePath, expectedSession, {
        state: () => this.api.getState(), binding: note => componentTaskBindings(this.settings.componentTaskBindings)[note],
        start: note => this.startFromNote(note, false, false), finish: id => this.api.finish(id, false)
      });
      await this.showResult(Promise.resolve(result)); return result;
    })();
    this.noteToggles.set(key, action);
    void action.finally(() => { if (!this.unloaded) this.later(() => { if (this.noteToggles.get(key) === action) this.noteToggles.delete(key); }, 350); }).catch(() => {});
    return action;
  }
  async saveTaskSort(mode: TaskSort) {
    const previous = this.settings.taskSort; this.settings.taskSort = mode;
    try { await this.saveSettings(); } catch (e) { this.settings.taskSort = previous; throw e; }
    this.render();
  }
  async saveCategoryPreferences(next: CategoryPreferences) {
    const previous = categoryPreferences(this.settings); Object.assign(this.settings, categoryPreferences(next));
    try { await this.saveSettings(); } catch (e) { Object.assign(this.settings, previous); throw e; }
    this.render();
  }
  private openCategorySettings() {
    new FormModal(this.app, "分类排序与显示", (root, close) => {
      applyAppearance(root, this.settings);
      const categoryRoot = root.ownerDocument.createElement("div"); root.append(categoryRoot);
      renderCategorySettings(categoryRoot, this.model().calendars, this.settings, next => this.saveCategoryPreferences(next));
      const done = root.ownerDocument.createElement("button"); done.textContent = "完成"; done.onclick = close; root.append(done);
    }).open();
  }
  private later(fn: () => void, ms: number) { const id = window.setTimeout(() => { this.timers.delete(id); fn(); }, ms); this.timers.add(id); }
  private scheduleSnapshot() { if (this.snapshotQueued || this.unloaded) return; this.snapshotQueued = true; this.later(() => { this.snapshotQueued = false; if (!this.unloaded) void this.refresh().catch(e => this.fail(e)); }, 200); }
  private async refreshLocal() { this.items = await this.tasks.list();this.completionEvents=await this.tasks.completions(); if (!this.unloaded) { this.render(); this.worker?.wake(); } }
  private fail(e: unknown) { this.error = (e as Error).message || String(e); this.render(); }
  private async execute<T>(fn: () => Promise<T>): Promise<T> {
    if (this.unloaded || this.busy || this.importing) throw new Error("插件正在处理本地操作，请稍后重试。");
    this.busy = true; this.error = ""; this.render();
    try { return await fn(); } finally { this.busy = false; this.render(); }
  }
  async run(fn: () => Promise<unknown>): Promise<boolean> { try { await this.execute(fn); return true; } catch (e) { this.fail(e); return false; } }
  private async showResult(result: Promise<ActionResult>) {
    const r = await result;
    if (!r.ok) { if (r.code !== "cancelled") { this.fail(new Error(r.message)); new Notice(r.message); } }
    else if (r.recordId) new Notice(r.warning || "本机已保存，工时将在后台同步");
  }
  private async completeOriginal(task: Task) {
    if (task.kind === "local") { await this.tasks.completeLocal(task); return; }
    const entry = this.bridge.entries().find(e => e.calendarId === task.calendarId && (task.uid ? e.event.uid === task.uid : e.id === task.id));
    if (!entry || entry.event.type !== "single" || !(entry.event.isTask || entry.event.completed != null)) throw new Error("旧版原待办不存在或不再支持完成；工时已保留。");
    if (entry.event.completed) return;
    if (await this.bridge.api().updateEvent(entry.id, { ...entry.event, isTask: true, completed: new Date().toISOString() }) !== true) throw new Error("工时已保存，原待办完成待重试。");
  }
  private readCalendarView() {
    const previous=this.calendarCache.get(this.date) || {date:this.date,sources:this.calendarView.sources,calendars:this.calendarView.calendars,rows:[],error:""};
    try {
      if(!this.connected)throw new Error("日历未连接；保留已加载快照");
      this.calendarView={...this.calendarQuery.readDay(this.date),error:""};this.calendarCache.set(this.date,this.calendarView);
      if(this.calendarCache.size>14)this.calendarCache.delete(this.calendarCache.keys().next().value!);
    }catch(e){this.calendarView={...previous,error:(e as Error).message};}
  }
  async refresh(reconcileDeletions = false) {
    this.items = await this.tasks.list();
    this.completionEvents=await this.tasks.completions();
    if (this.connected && !this.settings.defaultCalendarId) {
      const matches = this.bridge.writableCalendars().filter(c => c.name.replace(/[^\p{L}\p{N}]/gu, "") === "科研");
      if (matches.length === 1) { this.settings.defaultCalendarId = matches[0].id; await this.saveSettings(); }
    }
    if (reconcileDeletions && this.connected) await this.controller.reconcileDeletions();
    this.readCalendarView();
    this.render();
    this.worker?.wake();
  }
  model(): ViewModel {
    const { sources, calendars, rows: remote, error: calendarError } = this.calendarView;
    const error = this.error || calendarError; let rows = remote;
    const state = this.controller?.state || blankJournal();
    rows = mergeTimeline(rows, state.records, this.date, state.operations, state.deletions);
    const pending = pendingView(state, this.worker?.view);
    return { connected: this.connected, busy: this.busy, error, sources, calendars, defaultCalendarId: this.settings.defaultCalendarId, active: state.active, tasks: this.items, date: this.date, rows, pending, sync: this.worker?.view, appearance: appearance(this.settings), categoryPreferences: categoryPreferences(this.settings), taskSort: taskSort(this.settings.taskSort),appPage:appPage(this.settings.appPage),focusPins:focusRefs(this.settings.focusPins),focusLimit:focusLimit(this.settings.focusLimit),linkedTasks:Object.values(componentTaskBindings(this.settings.componentTaskBindings)),completions:this.completionEvents };
  }
  actions(): Actions { return {
    page:page=>{this.settings.appPage=page;this.render();void this.saveSettings().catch(e=>new Notice((e as Error).message));},
    pin:task=>{const pins=focusRefs(this.settings.focusPins),key=refKey(task);this.settings.focusPins=pins.some(p=>refKey(p)===key)?pins.filter(p=>refKey(p)!==key):[...pins,taskRef(task)];this.render();void this.saveSettings().catch(e=>new Notice((e as Error).message));},
    focusLimit:value=>{this.settings.focusLimit=focusLimit(value);this.render();void this.saveSettings().catch(e=>new Notice((e as Error).message));},
    openCompletion:event=>{const task=this.items.find(t=>refKey(t)===refKey(event.task));if(task)this.dialogs.task(task,patch=>this.tasks.update(task,patch),()=>this.removeTask(task));else new Notice("原待办已不存在，完成记录已保留。");},
    connect: () => { if(this.engine&&!this.engine.sourceConfigs().length){this.actions().settings();return;}void this.run(async () => { await this.bridge.connect(true); await this.worker?.resume("auth"); await this.refresh(); }); },
    refresh: () => { void this.run(async () => { if (!this.connected) await this.bridge.connect(true); await this.worker?.resume("auth"); this.bridge.refresh(); await this.refresh(); this.later(() => { void this.refresh(true).catch(e => this.fail(e)); }, 1800); this.later(() => { void this.refresh(true).catch(e => this.fail(e)); }, 5000); }); },
    settings: () => { const setting = (this.app as any).setting; setting.open(); setting.openTabById(this.manifest.id); },
    categorySettings: () => this.openCategorySettings(),
    openCalendar: () => { void this.run(async () => { await this.bridge.connect(true); await this.bridge.openCalendar(); await this.refresh(); }); }, date: value => { this.date = value; this.readCalendarView(); this.render(); },
    sortTasks: mode => this.run(() => this.saveTaskSort(mode)),
    reorderTasks: (next, expected) => this.run(async () => { if (taskSort(this.settings.taskSort) !== "manual") throw new Error("请先切换手动排序。"); await this.tasks.reorder(next, expected); this.items = await this.tasks.list(); }),
    add: (title, due, calendarId) => this.run(async () => { this.bridge.assertWritable(calendarId); await this.tasks.add(title, due, calendarId); await this.refreshLocal(); }),
    start: task => { void this.showResult(this.api.start(taskRef(task), { source: "view" })); },
    complete: task => { void this.run(async () => { if(this.controller.state.active?.task.id===task.id&&this.controller.state.active.task.path===task.path)throw new Error("请先结束这项任务的计时。");await this.tasks.setCompleted(task,!task.completed); await this.refreshLocal(); }); },
    editTask: task => this.dialogs.task(task, patch => this.tasks.update(task, patch),()=>this.removeTask(task)),
    pause: id => { void this.showResult(this.api.pause(id ?? this.api.getState().active?.id ?? "")); },
    resume: id => { void this.showResult(this.api.resume(id ?? this.api.getState().active?.id ?? "")); },
    finish: (complete, id) => { void this.showResult(this.api.finish(id ?? this.api.getState().active?.id ?? "", complete)); },
    editStart: () => this.dialogs.start(), category: id => { void this.run(() => this.controller.updateActive({ calendarId: id })); },
    newEvent: () => { try { this.dialogs.event(this.date); } catch (e) { this.fail(e); } },
    editRow: row => { try { if (row.deleting && row.deletionId) { this.dialogs.deletion(row.deletionId); return; } if (row.pending && !row.recordId) { new Notice(row.error || "请先在待同步中重试。"); return; } if (row.recordId) this.dialogs.record(this.controller.state.records.find(r => r.id === row.recordId)!, row.segmentUid); else this.dialogs.event(this.date, row); } catch (e) { this.fail(e); } },
    resolveDeletion: id => this.dialogs.deletion(id),
    retry: id => { void this.run(async () => { await this.worker?.retry(syncKey(id)); this.render(); }); },
    keep: id => { void this.run(async () => { await this.controller.keepCalendarOnly(id); await this.refresh(); }); }
  }; }
  render() { if (this.unloaded) return; const m=this.model();this.application.set("view",m);this.application.set("tasks",m.tasks);this.application.set("session",m.active);this.application.set("execution",{rows:m.rows,completions:m.completions,date:m.date});this.application.set("sync",{pending:m.pending,error:m.error,sync:m.sync});this.tick(); }
  private tick() { if (this.unloaded) return; this.api?.notify(); for (const leaf of this.app.workspace.getLeavesOfType(VIEW)) (leaf.view as TimerView).ui?.tick();
    if (this.status) updateStatus(this.status, this.controller?.state.active || null, this.items, taskSort(this.settings.taskSort)); }
  async importLegacy() {
    if (this.settings.importedLegacy) throw new Error("此设备已经导入过旧版。");
    const plugins = (this.app as any).plugins;
    const oldDir = path.join(this.base, this.app.vault.configDir, "plugins/simple-task-timer");
    const oldDevice = window.localStorage.getItem(`simple-task-timer-device-${this.vaultId}`);
    if (!oldDevice || !/^[a-f0-9-]{36}$/i.test(oldDevice)) throw new Error("找不到当前设备旧日志标识，不会猜测导入其他设备记录。");
    const legacySettings = JSON.parse(await fs.readFile(path.join(oldDir, "data.json"), "utf8"));
    const legacyRaw = await fs.readFile(path.join(oldDir, "sessions", `${oldDevice}.json`), "utf8");
    const imported = prepareLegacyImport(legacySettings, JSON.parse(legacyRaw), this.controller.state, !!(plugins?.enabledPlugins?.has("simple-task-timer") || plugins?.getPlugin?.("simple-task-timer")));
    const testPath = new MarkdownTasks(this.app, () => imported.settings.tasksPath); testPath.path();
    this.importing = true;
    try {
      const backup = path.join(this.pluginDir, "Migration", String(Date.now())); await fs.mkdir(backup, { recursive: true });
      await fs.writeFile(path.join(backup, "legacy-journal.json"), legacyRaw, { mode: 0o600 });
      await fs.writeFile(path.join(backup, "settings.json"), JSON.stringify({ before: this.settings, imported: imported.settings }, null, 2), { mode: 0o600 });
      await this.sessionStore.save(imported.journal); this.controller.state = imported.journal;
      this.settings = { ...this.settings, ...imported.settings }; await this.saveSettings(); await this.refresh(); new Notice("旧设置与当前设备记录已导入，请检查日历连接。");
    } finally { this.importing = false; }
  }
}
