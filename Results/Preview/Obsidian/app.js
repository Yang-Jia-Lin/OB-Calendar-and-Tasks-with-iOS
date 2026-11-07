"use strict";
(() => {
  // Shared/time.ts
  var formatters = /* @__PURE__ */ new Map();
  function dateParts(ms, zone) {
    if (!zone) {
      const d = new Date(ms), pad = (n) => String(n).padStart(2, "0");
      return { date: `${String(d.getFullYear()).padStart(4, "0")}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`, time: `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}` };
    }
    let formatter = formatters.get(zone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-CA", {
        timeZone: zone,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hourCycle: "h23"
      });
      if (formatters.size >= 16) formatters.delete(formatters.keys().next().value);
      formatters.set(zone, formatter);
    }
    const p = Object.fromEntries(formatter.formatToParts(new Date(ms)).map((x) => [x.type, x.value]));
    return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}:${p.second}` };
  }
  function secondsText(ms) {
    const n = Math.max(0, Math.floor(ms / 1e3));
    return [Math.floor(n / 3600), Math.floor(n / 60) % 60, n % 60].map((v) => String(v).padStart(2, "0")).join(":");
  }
  function elapsed(s, now = Date.now()) {
    return s ? s.segments.reduce((sum, p) => sum + p.end - p.start, 0) + (s.runningSince == null ? 0 : Math.max(0, now - s.runningSince)) : 0;
  }

  // Clients/Obsidian/api.ts
  var sameTask = (task, ref) => task.kind === ref.kind && task.path === ref.path && task.id === ref.id;

  // Clients/Obsidian/componentsButtons.ts
  var FIELD = ".components--DynamicDataView-PageProperty_button";
  var VALUE = ".components--DynamicDataView-PageProperty-Value";
  var ComponentsTimerButtons = class {
    constructor(doc, host) {
      this.doc = doc;
      this.host = host;
      this.state = host.api.getTimerState();
      this.observer = new MutationObserver((changes) => {
        if (changes.some((c) => c.type === "attributes" ? c.target.matches(`a[data-href],${VALUE}`) : [...c.addedNodes, ...c.removedNodes].some((n) => n.nodeType === 1))) this.schedule();
      });
      this.observer.observe(doc.documentElement, { childList: true, subtree: true, attributes: true, attributeFilter: ["data-href", "aria-label"] });
      this.unsubscribe = host.api.subscribeTimer((state) => {
        this.state = state;
        for (const button of this.buttons.values()) this.paint(button);
      });
    }
    doc;
    host;
    scopes = [];
    buttons = /* @__PURE__ */ new Map();
    observer;
    unsubscribe;
    frame = 0;
    stopped = false;
    state;
    setScopes(scopes) {
      if (!this.stopped) {
        this.scopes = scopes;
        this.reconcile();
      }
    }
    tick() {
      if (!this.stopped) for (const button of this.buttons.values()) this.paint(button);
    }
    schedule() {
      if (this.frame || this.stopped) return;
      this.frame = this.doc.defaultView.requestAnimationFrame(() => {
        this.frame = 0;
        this.reconcile();
      });
    }
    reconcile() {
      const found = /* @__PURE__ */ new Set();
      for (const scope of this.scopes) {
        if (!scope.root.isConnected) continue;
        for (const field of scope.root.querySelectorAll(FIELD)) {
          const value = field.querySelector(VALUE);
          if (!value || !scope.labels.has(value.getAttribute("aria-label") || "")) continue;
          const card = field.closest(".components--DynamicDataView-PageCard");
          const link = card?.querySelector(".components--DynamicDataView-PageTitle a[data-href]");
          const note = link?.getAttribute("data-href");
          const button = value.querySelector(".components--DynamicDataView-Button"), label = button?.querySelector(".components--DynamicDataView-ButtonLabel");
          const content = field.closest(".components--DynamicDataView-PageCardContent");
          if (!note?.endsWith(".md") || !button || !label || !content || card?.classList.contains("components--DynamicDataView-PageCard_preview")) continue;
          found.add(field);
          const previous = this.buttons.get(field);
          if (previous?.button === button && previous.label === label && previous.note === note) continue;
          previous?.restore();
          this.buttons.set(field, this.mount(field, button, label, content, note));
        }
      }
      for (const [field, button] of this.buttons) if (!found.has(field)) {
        button.restore();
        this.buttons.delete(field);
      }
      for (const button of this.buttons.values()) this.paint(button);
    }
    mount(field, button, label, content, note) {
      const original = { text: label.textContent || "", title: button.getAttribute("title"), role: button.getAttribute("role"), tab: button.getAttribute("tabindex"), aria: button.getAttribute("aria-label"), disabled: button.getAttribute("aria-disabled") };
      const item = { field, button, label, content, note, expected: null, working: false, error: "", restore: () => {
      } };
      const activate = (e) => {
        e.preventDefault();
        e.stopImmediatePropagation();
        if (item.working || !this.state.available && !this.host.canWake || e instanceof MouseEvent && e.detail > 1) return;
        const expected = item.expected;
        item.working = true;
        item.error = "";
        this.paint(item);
        void this.host.toggle(note, expected).then((r) => {
          if (!r.ok && r.code !== "cancelled") item.error = r.message;
        }).catch((e2) => {
          item.error = e2.message;
        }).finally(() => {
          item.working = false;
          if (!this.stopped && this.buttons.get(field) === item) this.paint(item);
        });
      };
      const key = (e) => {
        if (e.key !== "Enter" && e.key !== " ") return;
        if (e.repeat) {
          e.preventDefault();
          e.stopImmediatePropagation();
          return;
        }
        activate(e);
      };
      button.addEventListener("click", activate, true);
      button.addEventListener("keydown", key, true);
      button.setAttribute("role", "button");
      button.tabIndex = 0;
      field.classList.add("ctt-components-timer-field");
      content.classList.add("ctt-components-timer-header");
      button.classList.add("ctt-components-timer-button");
      item.restore = () => {
        button.removeEventListener("click", activate, true);
        button.removeEventListener("keydown", key, true);
        label.textContent = original.text;
        for (const [name, value] of Object.entries({ title: original.title, role: original.role, tabindex: original.tab, "aria-label": original.aria, "aria-disabled": original.disabled })) value == null ? button.removeAttribute(name) : button.setAttribute(name, value);
        button.classList.remove("ctt-components-timer-button");
        button.removeAttribute("data-ctt-state");
        field.classList.remove("ctt-components-timer-field");
        if (!content.querySelector(".ctt-components-timer-field")) content.classList.remove("ctt-components-timer-header");
      };
      return item;
    }
    paint(item) {
      const active = this.state.active, ref = this.host.binding(item.note), own = active && ref && sameTask(active.task, ref);
      item.expected = own ? active.id : null;
      const phase = !this.state.available ? "unavailable" : item.working ? "working" : own ? active.runningSince == null ? "paused" : "running" : active ? "blocked" : "idle";
      const text = item.working ? "\u5904\u7406\u4E2D\u2026" : phase === "unavailable" ? this.host.canWake ? "\u8FDE\u63A5\u8BA1\u65F6\u5E94\u7528" : "\u8BA1\u65F6\u63D2\u4EF6\u5DF2\u5378\u8F7D" : own ? `${active.runningSince == null ? "\u5DF2\u6682\u505C" : "\u25CF"} ${secondsText(elapsed(active))} \xB7 \u7ED3\u675F` : "\u5F00\u59CB\u8BA1\u65F6";
      if (item.label.textContent !== text) item.label.textContent = text;
      item.button.dataset.cttState = phase;
      const title = item.error || (!this.state.available && this.host.canWake ? "\u70B9\u51FB\u5524\u8D77\u672C\u673A\u8BA1\u65F6\u5E94\u7528\u5E76\u7B49\u5F85\u8FDE\u63A5\uFF0C\u4E0D\u5728 OB \u5185\u53E6\u8D77\u8BA1\u65F6" : own ? "\u70B9\u51FB\u7ED3\u675F\uFF0C\u53EA\u8BB0\u5F55\u5DE5\u65F6\uFF0C\u4FDD\u7559\u4EFB\u52A1\u672A\u5B8C\u6210" : active ? `\u6B63\u5728\u8BA1\u65F6\u300C${active.title}\u300D\uFF0C\u8BF7\u5148\u7ED3\u675F\u8BE5\u4F1A\u8BDD` : "\u70B9\u51FB\u5F00\u59CB\u6B64\u8BFE\u9898\u5173\u8054\u7684\u4EFB\u52A1");
      if (item.button.title !== title) item.button.title = title;
      if (item.button.getAttribute("aria-label") !== text) item.button.setAttribute("aria-label", text);
      item.button.setAttribute("aria-disabled", String(item.working || !this.state.available && !this.host.canWake));
    }
    dispose() {
      if (this.stopped) return;
      this.stopped = true;
      this.observer.disconnect();
      this.unsubscribe();
      if (this.frame) this.doc.defaultView.cancelAnimationFrame(this.frame);
      for (const button of this.buttons.values()) button.restore();
      this.buttons.clear();
      this.scopes = [];
    }
  };

  // Clients/Obsidian/components.ts
  async function toggleNoteTimer(note, expected, host) {
    const state = host.state(), ref = host.binding(note), active = state.active;
    if (expected === null) return host.start(note);
    if (typeof expected === "string") {
      if (!ref || active?.id !== expected || !sameTask(active.task, ref)) return { ok: false, code: "stale-session", message: "\u5361\u7247\u5BF9\u5E94\u7684\u8BA1\u65F6\u5DF2\u53D8\u5316\uFF0C\u8BF7\u6309\u6700\u65B0\u72B6\u6001\u91CD\u8BD5\u3002" };
      return host.finish(expected);
    }
    return active && ref && sameTask(active.task, ref) ? host.finish(active.id) : host.start(note);
  }

  // Preview/componentsFixture.ts
  function componentsFixture(api, bindings, canWake = false) {
    const style = document.createElement("style");
    style.textContent = `
    #ctt-native-fixture { position:fixed;top:65px;left:20px;width:900px;max-width:calc(100vw - 40px);z-index:30;background:var(--background-primary);border:1px solid var(--background-modifier-border);padding:12px;box-shadow:0 8px 30px #0002; }
    #ctt-native-fixture .fixture-cards { display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:12px; }
    #ctt-native-fixture .components--DynamicDataView-PageCard { position:relative;min-width:0;border:1px solid var(--background-modifier-border);border-radius:10px; }
    #ctt-native-fixture .components--DynamicDataView-PageCardContent { padding-block:8px; }
    #ctt-native-fixture .components--DynamicDataView-PageContextMenu { position:absolute;top:4px;right:4px;z-index:3;display:flex;width:60px;height:24px;background:var(--background-primary);opacity:0; }
    #ctt-native-fixture .components--DynamicDataView-PageCard:hover .components--DynamicDataView-PageContextMenu { opacity:1; }
    #ctt-native-fixture .components--DynamicDataView-PageContextMenu button { width:30px;height:24px;padding:0; }

    #ctt-native-fixture .components--DynamicDataView-PageTitle { display:flex;align-items:center;padding-inline:8px;overflow:hidden;font-size:14px;line-height:1.4; }
    #ctt-native-fixture .components--DynamicDataView-PageTitleLink { width:100%;overflow:hidden; }
    #ctt-native-fixture .components--DynamicDataView-PageTitle a { color:var(--text-normal);text-decoration:none;white-space:nowrap; }
    #ctt-native-fixture .components--DynamicDataView-PagePropertyList { display:flex;flex-direction:column;gap:2px;padding:4px 8px; }
    #ctt-native-fixture .ctt-components-timer-header > .components--DynamicDataView-PagePropertyList { display:contents; }
    #ctt-native-fixture .components--DynamicDataView-Button { display:inline-flex;position:relative; }
    #ctt-native-fixture .components--DynamicDataView-ButtonLabel { display:flex;align-items:center;padding:4px 8px;min-width:30px;border-radius:4px;border:1px solid var(--background-modifier-border);cursor:pointer;font-size:13px; }
  `;
    document.head.append(style);
    const root = document.createElement("aside");
    root.id = "ctt-native-fixture";
    root.innerHTML = `<div class="fixture-cards">${[["research.md", "\u89C6\u9891\u611F\u77E5\u4F18\u5316"], ["reading.md", "Paper Reading"]].map(([path, title]) => `
    <div class="components--DynamicDataView-PageCard" data-note="${path}"><div class="components--DynamicDataView-PageContextMenu"><button aria-label="\u7F16\u8F91">\u270E</button><button aria-label="\u66F4\u591A">\u22EF</button></div><div class="components--DynamicDataView-PageCardContent">
      <div class="components--DynamicDataView-PageTitle"><div class="components--DynamicDataView-PageTitleLink"><a class="internal-link" data-href="${path}" href="${path}">${title}</a></div></div>
      <div class="components--DynamicDataView-PagePropertyList">
        <div class="components--DynamicDataView-PageProperty components--DynamicDataView-PageProperty_button"><div class="components--DynamicDataView-PageProperty-Value" aria-label="\u5F00\u59CB\u8BA1\u65F6"><span class="components--DynamicDataView-Button"><div class="components--DynamicDataView-ButtonLabel">\u5F00\u59CB\u8BA1\u65F6</div></span></div></div>
        <div class="components--DynamicDataView-PageProperty"><p>\u8BFE\u9898\u4E2D\u7684\u539F\u6709\u4EFB\u52A1\u5217\u8868</p><p>\u25A1 \u7EE7\u7EED\u7814\u7A76\u5DE5\u4F5C</p></div>
      </div>
    </div></div>`).join("")}</div>`;
    document.body.append(root);
    const counts = { escapedClicks: 0, toggleCalls: 0 };
    root.addEventListener("click", () => {
      counts.escapedClicks++;
    });
    const toggle = (note, expected) => {
      counts.toggleCalls++;
      return toggleNoteTimer(note, expected, {
        state: () => api.getState(),
        binding: (note2) => bindings[note2],
        start: (note2) => api.start(bindings[note2], { source: "components", path: note2 }),
        finish: (id) => api.finish(id, false)
      });
    };
    const manager = new ComponentsTimerButtons(document, { api, canWake, binding: (note) => bindings[note], toggle });
    manager.setScopes([{ root, labels: /* @__PURE__ */ new Set(["\u5F00\u59CB\u8BA1\u65F6"]) }]);
    return { root, manager, counts, toggle, dispose: () => {
      manager.dispose();
      root.remove();
      style.remove();
    } };
  }

  // Preview/connectorFixture.ts
  function connectorFixture() {
    const tasks = [{ id: "one", title: "\u89C6\u9891\u611F\u77E5\u4F18\u5316", kind: "reminder", path: "sample", completed: false }, { id: "two", title: "Paper Reading", kind: "reminder", path: "sample", completed: false }];
    let active = null, available = true;
    const listeners = /* @__PURE__ */ new Set(), records = [];
    const snapshot = () => ({ available, active }), notify = () => {
      for (const fn of listeners) fn(snapshot());
    };
    const api = {
      getState: () => ({ ...snapshot(), tasks, pending: 0 }),
      getTimerState: snapshot,
      subscribeTimer: (fn) => {
        listeners.add(fn);
        fn(snapshot());
        return () => {
          listeners.delete(fn);
        };
      },
      async start(ref) {
        await new Promise((r) => setTimeout(r, 50));
        if (!available) return { ok: false, code: "unavailable", message: "\u684C\u9762\u672A\u8FDE\u63A5" };
        if (active) return { ok: false, code: "active-session", message: "\u5DF2\u6709\u8BA1\u65F6" };
        const now = Date.now();
        active = { id: crypto.randomUUID(), task: tasks.find((t) => t.id === ref.id), title: tasks.find((t) => t.id === ref.id).title, calendarId: "cal", zone: "Asia/Shanghai", startedAt: now, runningSince: now, lastHeartbeat: now, segments: [] };
        notify();
        return { ok: true, sessionId: active.id };
      },
      async finish(id) {
        if (active?.id !== id) return { ok: false, code: "stale-session", message: "\u8BA1\u65F6\u5DF2\u53D8\u5316" };
        records.push(active);
        active = null;
        notify();
        return { ok: true, sessionId: id };
      }
    };
    const native = componentsFixture(api, { "research.md": { kind: "reminder", path: "sample", id: "one" }, "reading.md": { kind: "reminder", path: "sample", id: "two" } }, true);
    const tick = setInterval(() => native.manager.tick(), 1e3);
    return { native, records, state: api.getState, pause: () => {
      if (active?.runningSince) {
        active.segments.push({ start: active.runningSince, end: Date.now() });
        active.runningSince = null;
        notify();
      }
    }, resume: () => {
      if (active && active.runningSince === null) {
        active.runningSince = Date.now();
        notify();
      }
    }, disconnect: () => {
      available = false;
      active = null;
      notify();
    }, dispose: () => {
      clearInterval(tick);
      native.dispose();
    } };
  }

  // Clients/Obsidian/diary.ts
  var DIARY_START = "<!-- ctt-diary-timeline:start -->";
  var DIARY_END = "<!-- ctt-diary-timeline:end -->";
  var DIARY_BUTTON = "```calendar-task-timer-diary\n```";
  var DEFAULT_DIARY_FOLDER = "00-Record/Calendar/Daily";
  var DEFAULT_DIARY_LAYOUT = `### \u5F53\u5929\u65F6\u95F4\u8F74

{{timeline}}

> \u65E5\u8BB0\u65E5\u671F\uFF1A{{date}} \xB7 \u5FEB\u7167\u66F4\u65B0\uFF1A{{updated}}
> \u6765\u6E90\uFF1A\u65E5\u5386\u5F53\u524D\u5DF2\u52A0\u8F7D\u6570\u636E\u53CA\u672C\u673A\u5DF2\u7ED3\u675F\u5DE5\u65F6\uFF1B\u65E5\u5386\u540C\u6B65\u5B8C\u6210\u540E\u53EF\u518D\u6B21\u66F4\u65B0\u3002
`;
  function diaryPath(value, fallback) {
    const p = typeof value === "string" ? value.trim().replace(/\\/g, "/").replace(/\/$/, "") : fallback;
    if (!p || p.startsWith("/") || p.split("/").some((s) => !s || s === "." || s === ".." || s.startsWith(".")) || /[:\x00-\x1f]/.test(p)) throw new Error("\u65E5\u8BB0\u8DEF\u5F84\u987B\u4E3A\u5E93\u5185\u666E\u901A\u6587\u4EF6\u5939\u6216\u6587\u4EF6\u8DEF\u5F84\u3002");
    return p;
  }
  function validDiaryDay(value) {
    if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
    const n = Date.parse(`${value}T00:00:00Z`);
    return Number.isFinite(n) && new Date(n).toISOString().slice(0, 10) === value;
  }
  function diaryDate(path, property, folder = DEFAULT_DIARY_FOLDER) {
    if (!path.startsWith(`${diaryPath(folder, DEFAULT_DIARY_FOLDER)}/`) || !path.endsWith(".md")) throw new Error("\u8BF7\u6253\u5F00\u65E5\u8BB0\u76EE\u5F55\u5185\u7684 Markdown \u65E5\u8BB0\u3002");
    const match = path.split("/").at(-1).slice(0, -3).match(/^(\d{4})年(\d{1,2})月(\d{1,2})日(?:\s+.*)?$/);
    if (!match) throw new Error("\u65E5\u8BB0\u6587\u4EF6\u540D\u9700\u8981\u5305\u542B\u5E74\u6708\u65E5\u3002");
    const fromName = `${match[1]}-${match[2].padStart(2, "0")}-${match[3].padStart(2, "0")}`;
    if (!validDiaryDay(fromName)) throw new Error("\u65E5\u8BB0\u6587\u4EF6\u540D\u4E2D\u7684\u65E5\u671F\u65E0\u6548\u3002");
    if (property !== void 0 && property !== null && property !== "") {
      if (!validDiaryDay(property)) throw new Error("\u65E5\u8BB0\u65E5\u671F\u5C5E\u6027\u65E0\u6548\uFF0C\u8BF7\u4F7F\u7528 YYYY-MM-DD\u3002");
      return property;
    }
    return fromName;
  }
  function inline(value) {
    return value.replace(/[\r\n\t]+/g, " ").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/[\\`*_{}\[\]()!|~]/g, (c) => `\\${c}`);
  }
  function renderDiary(date, rows, calendars, layout = DEFAULT_DIARY_LAYOUT, now = Date.now()) {
    if (!validDiaryDay(date)) throw new Error("\u65E5\u8BB0\u65E5\u671F\u65E0\u6548\u3002");
    if (layout.split("{{timeline}}").length !== 2 || layout.includes(DIARY_START) || layout.includes(DIARY_END)) throw new Error("\u65F6\u95F4\u8F74\u6A21\u677F\u987B\u4E14\u53EA\u80FD\u5305\u542B\u4E00\u4E2A {{timeline}}\uFF0C\u4E0D\u80FD\u5305\u542B\u751F\u6210\u533A\u6807\u8BB0\u3002");
    const start = +/* @__PURE__ */ new Date(`${date}T00:00:00`), next = new Date(start);
    next.setDate(next.getDate() + 1);
    const end = +next, names = new Map(calendars.map((c) => [c.id, c.name]));
    for (const r of rows) if (!Number.isFinite(r.start) || !Number.isFinite(r.end) || r.end <= r.start) throw new Error("\u65E5\u5386\u5B58\u5728\u65E0\u6548\u65F6\u95F4\u6BB5\uFF0C\u4FDD\u7559\u539F\u65F6\u95F4\u8F74\u3002");
    const visible = rows.filter((r) => r.start < end && r.end > start).sort((a, b) => Number(!!b.allDay) - Number(!!a.allDay) || a.start - b.start || a.key.localeCompare(b.key));
    const lines = visible.map((r) => {
      const time = r.allDay ? "\u5168\u5929" : `${r.start < start ? "00:00" : dateParts(r.start).time.slice(0, 5)}\u2013${r.end >= end ? "24:00" : dateParts(r.end).time.slice(0, 5)}${r.start < start || r.end > end ? "\uFF08\u8DE8\u65E5\uFF09" : ""}`;
      const kind = r.recordId ? "\u5B9E\u9645\u5DE5\u65F6" : "\u65E5\u7A0B";
      const state = r.deleting ? " \xB7 \u5F85\u5220\u9664" : r.pending ? " \xB7 \u5F85\u540C\u6B65" : "";
      return `| ${time} | ${inline(r.title)} | ${inline(names.get(r.calendarId) || "\u672A\u547D\u540D\u65E5\u5386")} | ${kind}${state} |`;
    });
    const timeline = lines.length ? ["| \u65F6\u95F4 | \u5185\u5BB9 | \u65E5\u5386 | \u7C7B\u578B |", "| --- | --- | --- | --- |", ...lines].join("\n") : "\u5F53\u5929\u6682\u65E0\u5DF2\u52A0\u8F7D\u7684\u65E5\u7A0B\u6216\u5DF2\u7ED3\u675F\u5DE5\u65F6\u3002";
    const at = dateParts(now);
    const tokens = { timeline, date, updated: `${at.date} ${at.time}` };
    return { markdown: layout.replace(/\{\{(timeline|date|updated)\}\}/g, (_, k) => tokens[k]).trim(), count: visible.length };
  }
  function diaryRegion(text) {
    const found = [];
    let fence = "";
    for (const m of text.matchAll(/[^\n]+\n?|\n/g)) {
      const line = m[0].replace(/\r?\n$/, ""), token = line.trim();
      const f = line.match(/^ {0,3}(`{3,}|~{3,})/);
      if (f) {
        if (!fence) fence = f[1];
        else if (f[1][0] === fence[0] && f[1].length >= fence.length) fence = "";
      }
      if (line.includes(DIARY_START) || line.includes(DIARY_END)) {
        if (fence || token !== DIARY_START && token !== DIARY_END) throw new Error("\u65F6\u95F4\u8F74\u6807\u8BB0\u4F4D\u7F6E\u5F02\u5E38\uFF0C\u672A\u6539\u52A8\u7B14\u8BB0\u3002");
        found.push({ type: token === DIARY_START ? "start" : "end", from: m.index, to: m.index + m[0].length });
      }
    }
    if (!found.length) return null;
    if (found.length !== 2 || found[0].type !== "start" || found[1].type !== "end") throw new Error("\u65F6\u95F4\u8F74\u6807\u8BB0\u7F3A\u5931\u3001\u91CD\u590D\u6216\u987A\u5E8F\u5F02\u5E38\uFF0C\u672A\u6539\u52A8\u7B14\u8BB0\u3002");
    return { from: found[0].to, to: found[1].from, content: text.slice(found[0].to, found[1].from) };
  }
  function replaceDiary(text, markdown) {
    if (markdown.includes(DIARY_START) || markdown.includes(DIARY_END)) throw new Error("\u751F\u6210\u5185\u5BB9\u5305\u542B\u4FDD\u7559\u6807\u8BB0\u3002");
    const newline = text.includes("\r\n") ? "\r\n" : "\n";
    const block = markdown.replace(/\r?\n/g, newline) + newline;
    const region = diaryRegion(text);
    if (region) return text.slice(0, region.from) + block + text.slice(region.to);
    const bom = text.startsWith("\uFEFF") ? 1 : 0;
    let at = bom;
    if (/^---\r?\n/.test(text.slice(bom))) {
      const frontmatter = text.slice(bom).match(/^---\r?\n[\s\S]*?^---[ \t]*(?:\r?\n|$)/m);
      if (!frontmatter) throw new Error("\u7B14\u8BB0\u5C5E\u6027\u533A\u672A\u95ED\u5408\uFF0C\u672A\u6539\u52A8\u7B14\u8BB0\u3002");
      at += frontmatter[0].length;
    }
    const section = `${DIARY_BUTTON}

${DIARY_START}
${markdown}
${DIARY_END}

`.replace(/\r?\n/g, newline);
    return text.slice(0, at) + (at && !text.slice(0, at).endsWith("\n") ? newline : "") + section + text.slice(at);
  }
  var DiaryUpdater = class {
    constructor(ports) {
      this.ports = ports;
    }
    ports;
    pending = /* @__PURE__ */ new Map();
    update(path) {
      const existing = this.pending.get(path);
      if (existing) return existing;
      const promise = this.write(path);
      this.pending.set(path, promise);
      void promise.finally(() => this.pending.delete(path)).catch(() => {
      });
      return promise;
    }
    async write(path) {
      const p = this.ports;
      if (!p.available()) throw new Error("\u63D2\u4EF6\u5DF2\u5378\u8F7D\uFF0C\u8BF7\u91CD\u65B0\u52A0\u8F7D\u3002");
      const before = await p.read(path), date = p.date(path, before), region = diaryRegion(before);
      const layout = await p.layout(), snapshot = await p.snapshot(date);
      const result = renderDiary(date, snapshot.rows, snapshot.calendars, layout);
      if (replaceDiary(before, result.markdown) === before) return { count: result.count, changed: false };
      if (!p.available()) throw new Error("\u63D2\u4EF6\u5DF2\u5378\u8F7D\uFF0C\u4FDD\u7559\u539F\u7B14\u8BB0\u3002");
      await p.backup(path, before);
      await p.process(path, (current) => {
        if (!p.available()) throw new Error("\u63D2\u4EF6\u5DF2\u5378\u8F7D\uFF0C\u4FDD\u7559\u539F\u7B14\u8BB0\u3002");
        if (p.date(path, current) !== date || diaryRegion(current)?.content !== region?.content) throw new Error("\u65E5\u8BB0\u65E5\u671F\u6216\u751F\u6210\u533A\u5DF2\u88AB\u4FEE\u6539\uFF0C\u8BF7\u91CD\u65B0\u66F4\u65B0\u3002");
        return replaceDiary(current, result.markdown);
      });
      return { count: result.count, changed: true };
    }
  };

  // Clients/Obsidian/diaryButton.ts
  function mountDiaryButton(root, path, update) {
    root.classList.add("ctt-diary-controls");
    const button = root.ownerDocument.createElement("button"), status = root.ownerDocument.createElement("span");
    button.type = "button";
    button.textContent = "\u66F4\u65B0\u65F6\u95F4\u8F74";
    status.className = "ctt-diary-status";
    status.setAttribute("role", "status");
    status.setAttribute("aria-live", "polite");
    root.append(button, status);
    let disposed = false;
    const click = async () => {
      if (button.disabled || disposed) return;
      button.disabled = true;
      status.textContent = "\u6B63\u5728\u751F\u6210\u65E5\u8BB0\u5FEB\u7167\u2026";
      try {
        const result = await update(path);
        if (!disposed) status.textContent = `${result.changed ? "\u5DF2\u66F4\u65B0" : "\u5185\u5BB9\u5DF2\u662F\u6700\u65B0\u5FEB\u7167"}\uFF0C\u5171 ${result.count} \u9879`;
      } catch (e) {
        if (!disposed) status.textContent = `\u672A\u66F4\u65B0\uFF1A${e instanceof Error ? e.message : String(e)}`;
      } finally {
        if (!disposed) button.disabled = false;
      }
    };
    button.addEventListener("click", click);
    return () => {
      disposed = true;
      button.removeEventListener("click", click);
    };
  }

  // Preview/diaryFixture.ts
  function diaryFixture() {
    const state = { text: `---
\u65E5\u8BB0\u65E5\u671F: 2026-10-31
---
${DIARY_START}
\u65E7\u5FEB\u7167
${DIARY_END}

### \u6211\u7684\u8865\u5145
\u4FDD\u7559\u8FD9\u6BB5\u624B\u5199\u60F3\u6CD5\u3002

### \u4ECA\u65E5\u65B0\u8BB0\uFF0F\u4FEE\u6539
\u4FDD\u7559\u539F\u6709\u67E5\u8BE2\u3002`, fail: false, calls: 0, backups: 0 };
    const root = document.createElement("section");
    root.id = "ctt-diary-fixture";
    root.style.cssText = "max-width:850px;margin:20px auto;padding:20px;background:var(--background-primary);border:1px solid var(--background-modifier-border);border-radius:12px";
    const heading = document.createElement("h2");
    heading.textContent = "\u65E5\u8BB0\u65F6\u95F4\u8F74 \xB7 \u6309\u94AE\u9884\u89C8";
    const controls = document.createElement("div"), content = document.createElement("pre");
    content.style.cssText = "white-space:pre-wrap;overflow-wrap:anywhere";
    content.textContent = state.text;
    root.append(heading, controls, content);
    document.body.prepend(root);
    const updater = new DiaryUpdater({
      available: () => true,
      read: async () => state.text,
      date: (p) => diaryDate(p, "2026-10-31"),
      layout: async () => DEFAULT_DIARY_LAYOUT,
      snapshot: async () => {
        state.calls++;
        await new Promise((r) => setTimeout(r, 150));
        if (state.fail) throw Error("\u65E5\u5386\u672A\u8FDE\u63A5\uFF0C\u539F\u5185\u5BB9\u5DF2\u4FDD\u7559");
        return { calendars: [{ id: "a", name: "\u79D1\u7814" }], rows: [{ key: "work", title: "\u89C6\u9891\u611F\u77E5\u4F18\u5316", recordId: "one", calendarId: "a", start: +/* @__PURE__ */ new Date("2026-10-31T09:00"), end: +/* @__PURE__ */ new Date("2026-10-31T10:00") }] };
      },
      backup: async () => {
        state.backups++;
      },
      process: async (_p, update) => {
        state.text = update(state.text);
        content.textContent = state.text;
      }
    });
    const dispose = mountDiaryButton(controls, "00-Record/Calendar/Daily/2026\u5E7410\u670831\u65E5 \u661F\u671F\u516D.md", (p) => updater.update(p));
    return { state, dispose };
  }

  // Preview/preview.ts
  if (new URLSearchParams(location.search).has("diary")) window.__diaryPreview = diaryFixture();
  else window.__connectorPreview = connectorFixture();
})();
