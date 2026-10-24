/* Browser-only development host. Synthetic data; no network or Apple credentials. */
(() => {
  const maps = JSON.parse(localStorage.getItem("stt-preview-files") || "null") || {};
  const callbacks = [];
  const save = () => localStorage.setItem("stt-preview-files", JSON.stringify(maps));
  const today = new Date().toLocaleDateString("en-CA");
  const filePath = "待办计时/待办.md";
  if (!maps[filePath]) {
    maps[filePath] = `# 待办\n\n- [ ] 阅读论文 📅 ${today} <!-- simple-task:demo-read -->\n- [ ] 整理笔记 📅 ${today} <!-- simple-task:demo-notes -->\n- [ ] 准备下周汇报 <!-- simple-task:demo-talk -->\n`;
    save();
  }
  const file = path => maps[path] == null ? null : { path, extension: path.endsWith(".md") ? "md" : "json" };
  const notify = path => callbacks.forEach(fn => fn(file(path)));
  const events = JSON.parse(localStorage.getItem("stt-preview-events") || "null") || [
    { id: "sample-1", event: { type: "single", title: "阅读与整理", date: today, endDate: today, startTime: "09:00", endTime: "10:30", allDay: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } },
    { id: "sample-2", event: { type: "single", title: "讨论", date: today, endDate: today, startTime: "15:00", endTime: "15:30", allDay: false, timezone: Intl.DateTimeFormat().resolvedOptions().timeZone } }
  ];
  const saveEvents = () => localStorage.setItem("stt-preview-events", JSON.stringify(events));
  HTMLElement.prototype.addClass = function(...classes) { this.classList.add(...classes); };
  HTMLElement.prototype.empty = function() { this.replaceChildren(); };
  let online = true;
  const api = {
    getCalendarSources: () => [{ id: "demo-calendar", type: "caldav", name: "计时记录（示例）", color: "#5982a4" }],
    getProviderCapabilities: () => ({ canCreate: true, canEdit: true, canDelete: true }),
    getAllEvents: () => [{ id: "demo-calendar", color: "#5982a4", events }],
    getEvents: () => events.map(item => {
      const e = item.event;
      const suffix = e.timezone === "UTC" ? "Z" : "";
      return { id: item.id, title: e.title, isTask: e.isTask,
        startMillis: Date.parse(`${e.date}T${e.startTime}${suffix}`),
        endMillis: Date.parse(`${e.endDate || e.date}T${e.endTime}${suffix}`) };
    }),
    async createEvent(calendarId, event) {
      if (!online) throw new Error("模拟断网：记录留在本机，恢复网络后可重试。");
      const old = event.uid && events.find(x => x.event.uid === event.uid);
      if (old) old.event = structuredClone(event);
      else events.push({ id: crypto.randomUUID(), event: structuredClone(event) });
      saveEvents(); return true;
    },
    async processEvent(id, fn) { const item = events.find(e => e.id === id); if (!item) return false; item.event = fn(item.event); saveEvents(); return true; },
    async updateEvent(id, event) { const item = events.find(e => e.id === id); if (!item || !online) return false; item.event = structuredClone(event); saveEvents(); return true; },
    revalidateRemoteCalendars() {},
    async openCalendar() { alert("正式插件会在这里打开 FCR 的完整日历。预览不连接真实账户。"); }
  };
  let leaf;
  const app = {
    vault: {
      configDir: ".obsidian", getName: () => "preview",
      adapter: {
        getBasePath: () => "preview",
        exists: async path => maps[path] != null,
        mkdir: async path => { maps[path] = ""; save(); },
        read: async path => maps[path],
        write: async (path, value) => { maps[path] = value; save(); },
        copy: async (a, b) => { maps[b] = maps[a]; save(); }
      },
      getAbstractFileByPath: file,
      read: async f => maps[f.path],
      async create(path, text) { maps[path] = text; save(); notify(path); return file(path); },
      async createFolder(path) { maps[path] = ""; save(); },
      async process(f, fn) { maps[f.path] = fn(maps[f.path]); save(); notify(f.path); },
      on(name, callback) { callbacks.push(callback); return () => {}; }
    },
    workspace: {
      getLeavesOfType: () => leaf?.view ? [leaf] : [],
      getLeaf: () => leaf,
      revealLeaf: async () => {},
      onLayoutReady: callback => setTimeout(callback, 10)
    },
    secretStorage: { getSecret: () => "preview-token", setSecret: () => {} },
    plugins: { getPlugin: () => ({ api: { withToken: () => api, requestAccess: async () => "preview-token" } }) },
    setting: { open() {}, openTabById() { alert("正式插件可在设置中更改待办笔记路径。预览无需配置账户。"); } }
  };
  class Plugin {
    constructor() { this.app = app; this.manifest = { id: "simple-task-timer", dir: ".obsidian/plugins/simple-task-timer" }; }
    loadData() { return Promise.resolve(JSON.parse(localStorage.getItem("stt-preview-settings") || "null") || { targetCalendarId: "demo-calendar" }); }
    saveData(data) { localStorage.setItem("stt-preview-settings", JSON.stringify(data)); return Promise.resolve(); }
    registerView(type, factory) { this.factory = factory; }
    addRibbonIcon() {} addCommand() {} addSettingTab() {} registerEvent() {}
    registerInterval() {}
    addStatusBarItem() { return document.getElementById("status"); }
  }
  class ItemView { constructor() { this.contentEl = document.getElementById("app"); } }
  class Modal {
    constructor() { this.shell = document.createElement("dialog"); this.contentEl = document.createElement("div"); this.shell.append(this.contentEl); }
    open() { document.body.append(this.shell); this.onOpen(); this.shell.showModal(); }
    close() { this.shell.close(); this.onClose?.(); this.shell.remove(); }
  }
  class PluginSettingTab {}
  class Setting {}
  class Notice {
    constructor(message) {
      const el = document.createElement("div"); el.className = "toast"; el.textContent = message;
      document.getElementById("notifications").append(el); setTimeout(() => el.remove(), 5000);
    }
  }
  window.require = name => {
    if (name !== "obsidian") throw new Error(`Unknown host module ${name}`);
    return { Plugin, ItemView, PluginSettingTab, Setting, Modal, Notice, normalizePath: path => path.replace(/\\/g, "/") };
  };
  window.module = { exports: {} };
  window.__startPreview = async () => {
    const plugin = new window.module.exports();
    leaf = { async setViewState() { this.view = plugin.factory(this); await this.view.onOpen(); }, async openFile() {} };
    await plugin.onload();
    await plugin.openView();
    window.__preview = { plugin, events, files: maps, setOnline(value) { online = value; } };
    const toggle = document.getElementById("simulate-offline");
    toggle.addEventListener("change", () => { online = !toggle.checked; });
    document.getElementById("reset-preview").addEventListener("click", () => { for (const key of Object.keys(localStorage)) if (key.startsWith("stt-preview") || key.startsWith("simple-task-timer-device")) localStorage.removeItem(key); location.reload(); });
    document.getElementById("dark-mode").addEventListener("change", e => document.body.classList.toggle("theme-dark", e.target.checked));
  };
})();
