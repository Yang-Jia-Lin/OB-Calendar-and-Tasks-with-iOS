"use strict";
(() => {
  var __defProp = Object.defineProperty;
  var __getOwnPropNames = Object.getOwnPropertyNames;
  var __esm = (fn, res, err) => function __init() {
    if (err) throw err[0];
    try {
      return fn && (res = (0, fn[__getOwnPropNames(fn)[0]])(fn = 0)), res;
    } catch (e) {
      throw err = [e], e;
    }
  };
  var __export = (target, all) => {
    for (var name in all)
      __defProp(target, name, { get: all[name], enumerable: true });
  };

  // Shared/time.ts
  var time_exports = {};
  __export(time_exports, {
    dateParts: () => dateParts,
    dayKey: () => dayKey,
    elapsed: () => elapsed,
    eventForSegment: () => eventForSegment,
    localInput: () => localInput,
    parseLocal: () => parseLocal,
    secondsText: () => secondsText,
    shiftDate: () => shiftDate,
    validateSegments: () => validateSegments
  });
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
  function validateSegments(parts, now) {
    if (!parts.length) throw new Error("\u81F3\u5C11\u4FDD\u7559\u4E00\u4E2A\u5B9E\u9645\u5DE5\u4F5C\u65F6\u6BB5\u3002");
    let previous = -Infinity;
    for (const p of parts) {
      if (!Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end - p.start < 1e3 || p.start < previous || p.end > now)
        throw new Error("\u65F6\u95F4\u6BB5\u987B\u81F3\u5C11\u4E00\u79D2\u3001\u987A\u5E8F\u4E0D\u91CD\u53E0\uFF0C\u4E14\u4E0D\u80FD\u5728\u672A\u6765\u3002");
      previous = p.end;
    }
  }
  function eventForSegment(record, part) {
    const start = dateParts(part.start, "UTC"), end = dateParts(part.end, "UTC");
    return {
      type: "single",
      uid: part.uid,
      title: record.title,
      date: start.date,
      endDate: end.date,
      startTime: start.time,
      endTime: end.time,
      allDay: false,
      timezone: "UTC",
      isTask: false,
      description: `\u5B9E\u9645\u8BA1\u65F6\uFF1A${secondsText(part.end - part.start)}
\u539F\u5F85\u529E\uFF1A${record.title}
\u8BB0\u5F55\u7F16\u53F7\uFF1A${part.uid}`
    };
  }
  function localInput(ms) {
    const p = dateParts(ms);
    return `${p.date}T${p.time}`;
  }
  function parseLocal(value) {
    const n = new Date(value).getTime();
    if (!Number.isFinite(n) || localInput(n).slice(0, value.length) !== value) throw new Error("\u65E5\u671F\u6216\u65F6\u95F4\u65E0\u6548\uFF0C\u8BF7\u68C0\u67E5\u672C\u5730\u65F6\u533A\u3002");
    return n;
  }
  function shiftDate(date2, delta) {
    const d = /* @__PURE__ */ new Date(`${date2}T12:00:00`);
    d.setDate(d.getDate() + delta);
    return dayKey(+d);
  }
  var formatters, dayKey;
  var init_time = __esm({
    "Shared/time.ts"() {
      "use strict";
      formatters = /* @__PURE__ */ new Map();
      dayKey = (ms = Date.now(), zone) => dateParts(ms, zone).date;
    }
  });

  // Shared/contracts.ts
  var clone = (value) => value == null ? value : JSON.parse(JSON.stringify(value));
  var uid = () => globalThis.crypto.randomUUID();
  function sameEvent(a, b) {
    const stable = (v) => Array.isArray(v) ? v.map(stable) : v && typeof v === "object" ? Object.fromEntries(Object.entries(v).filter(([, x]) => x !== void 0).sort(([a2], [b2]) => a2.localeCompare(b2)).map(([k, x]) => [k, stable(x)])) : v;
    return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
  }
  function comparableEventContent(event) {
    const { etag: _tag, caldavHref: _href, ...value } = event;
    if (value.type === "single" && (value.allDay === false || value.allDay == null)) {
      value.allDay ??= false;
      value.isTask ??= false;
      value.endDate ??= value.date;
      for (const field2 of ["startTime", "endTime"]) {
        const time = value[field2];
        if (typeof time === "string" && /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time)) value[field2] = `${time}:00`;
      }
    }
    return value;
  }
  function sameEventContent(a, b) {
    return sameEvent(comparableEventContent(a), comparableEventContent(b));
  }
  function isMissingResource(error2) {
    const value = error2;
    return value?.status === 404 || value?.status === 410 || /\bHTTP\s+(?:404|410)\b/i.test(typeof error2 === "string" ? error2 : value?.message || "");
  }

  // Providers/Fcr/bridge.ts
  init_time();
  function containsEvent(actual, desired) {
    const normalized = comparableEventContent(actual);
    return Object.entries(comparableEventContent(desired)).every(([key2, value]) => value === void 0 || sameEvent({ type: "", title: "", date: "", value: normalized[key2] }, { type: "", title: "", date: "", value }));
  }
  function content(event) {
    const { caldavHref: _href, etag: _etag, ...data } = clone(event);
    return data;
  }
  var FcrBridge = class {
    constructor(host2, readToken, writeToken) {
      this.host = host2;
      this.readToken = readToken;
      this.writeToken = writeToken;
    }
    host;
    readToken;
    writeToken;
    authorized = null;
    connecting;
    get connected() {
      return this.authorized !== null;
    }
    async connect(interactive = false) {
      if (this.connecting) {
        const previous = this.connecting;
        try {
          await previous;
          return;
        } catch (e) {
          if (!interactive) throw e;
          if (this.connecting === previous) this.connecting = void 0;
          return this.connect(true);
        }
      }
      const pending = this.connectNow(interactive);
      this.connecting = pending;
      try {
        await pending;
      } finally {
        if (this.connecting === pending) this.connecting = void 0;
      }
    }
    async connectNow(interactive) {
      this.authorized = null;
      const plugin = this.host.plugins?.getPlugin?.("full-calendar-remastered") ?? this.host.plugins?.plugins?.["full-calendar-remastered"];
      const api2 = plugin?.api;
      if (!api2?.withToken) throw new Error("\u8BF7\u542F\u7528\u517C\u5BB9\u516C\u5F00 API \u7684 Full Calendar Remastered\u3002");
      const validate = (candidate2) => {
        if (!candidate2) return null;
        candidate2.getCalendarSources();
        candidate2.getAllEvents();
        return candidate2;
      };
      const token = await this.readToken();
      let candidate = null;
      try {
        candidate = validate(token ? api2.withToken(token) : null);
      } catch {
        if (!interactive) throw new Error("FCR \u6388\u6743\u4E0D\u53EF\u7528\uFF0C\u8BF7\u70B9\u51FB\u201C\u8FDE\u63A5\u65E5\u5386\u201D\u91CD\u65B0\u6388\u6743\u3002");
      }
      if (!candidate && interactive) {
        const next = await api2.requestAccess("calendar-task-timer", "\u8BFB\u53D6\u65E5\u7A0B\uFF0C\u4FDD\u5B58\u53CA\u4FEE\u6539\u4F60\u4E3B\u52A8\u8BB0\u5F55\u7684\u5DE5\u65F6\u3002", ["events:read", "events:write", "providers:read", "providers:write", "ui:open-calendar"]);
        if (!next) throw new Error("\u672A\u5B8C\u6210 FCR \u6388\u6743\u3002\u53EF\u518D\u6B21\u70B9\u51FB\u201C\u8FDE\u63A5\u65E5\u5386\u201D\u6216\u5237\u65B0\u3002");
        try {
          candidate = validate(api2.withToken(next));
        } catch {
          throw new Error("FCR \u6388\u6743\u7F3A\u5C11\u65E5\u5386\u8BFB\u53D6\u6743\u9650\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u5E76\u5141\u8BB8\u6240\u9700\u6743\u9650\u3002");
        }
        if (!candidate) throw new Error("FCR \u672A\u63A5\u53D7\u65B0\u6388\u6743\uFF0C\u8BF7\u91CD\u65B0\u8FDE\u63A5\u3002");
        await this.writeToken(next);
      }
      if (!candidate) throw new Error("\u8BA1\u65F6\u63D2\u4EF6\u5C1A\u672A\u83B7\u5F97 FCR \u6388\u6743\uFF0C\u8BF7\u70B9\u51FB\u201C\u8FDE\u63A5\u65E5\u5386\u201D\u6216\u5237\u65B0\u540E\u6388\u6743\u3002");
      this.authorized = candidate;
    }
    api() {
      if (!this.authorized) throw new Error("\u8BF7\u5148\u8FDE\u63A5 FCR \u65E5\u5386\u3002");
      return this.authorized;
    }
    sources() {
      return this.api().getCalendarSources().map((s) => ({ id: s.id, name: s.name || s.id, color: s.color, type: s.type }));
    }
    writableCalendars() {
      return this.sources().filter((s) => s.type === "caldav" && this.api().getProviderCapabilities(s.id)?.canCreate);
    }
    assertWritable(id) {
      if (!this.writableCalendars().some((s) => s.id === id)) throw new Error("\u5206\u7C7B\u65E5\u5386\u4E0D\u53EF\u5199\u6216\u5DF2\u79FB\u9664\uFF0C\u8BF7\u91CD\u65B0\u9009\u62E9\u3002");
    }
    entries() {
      return this.api().getAllEvents().flatMap((g) => (g.events || []).map((x) => ({ id: x.id, calendarId: g.id, color: g.color, event: clone(x.event) })));
    }
    find(calendarId, eventUid) {
      const matches = this.api().getAllEvents().filter((g) => g.id === calendarId).flatMap((g) => (g.events || []).filter((x) => x.event.uid === eventUid).map((x) => ({ id: x.id, calendarId, color: g.color, event: clone(x.event) })));
      if (matches.length > 1) throw new Error("\u540C\u4E00\u65E5\u5386\u51FA\u73B0\u91CD\u590D UID\uFF0C\u8BF7\u5148\u5728\u5B8C\u6574\u65E5\u5386\u4E2D\u6838\u5BF9\u3002");
      return matches[0];
    }
    readByUid(calendarId, eventUid) {
      return this.find(calendarId, eventUid)?.event;
    }
    hasCalendarData(calendarId) {
      return this.sources().some((c) => c.id === calendarId) && this.api().getAllEvents().some((g) => g.id === calendarId);
    }
    canDelete(original) {
      return original.event.type === "single" && !original.event.allDay && !!original.event.uid && !!this.api().getProviderCapabilities(original.calendarId)?.canDelete;
    }
    prepareDeletion(original) {
      if (!this.canDelete(original)) throw new Error("\u6B64\u65E5\u7A0B\u65E0\u6CD5\u5728\u8FD9\u91CC\u5220\u9664\uFF0C\u8BF7\u4F7F\u7528\u5B8C\u6574\u65E5\u5386\u3002");
      const current = this.find(original.calendarId, original.event.uid);
      if (!current || !sameEvent(current.event, original.event)) throw new Error("\u65E5\u7A0B\u5DF2\u4FEE\u6539\u6216\u5220\u9664\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u6253\u5F00\u3002");
      return { calendarId: original.calendarId, uid: original.event.uid, before: clone(original.event) };
    }
    async deleteEvent(target) {
      const current = this.find(target.calendarId, target.uid);
      if (!current) {
        if (!this.hasCalendarData(target.calendarId)) throw new Error("\u65E5\u5386\u7F13\u5B58\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
        return;
      }
      if (!this.canDelete(current)) throw new Error("\u65E5\u5386\u4E0D\u5141\u8BB8\u5220\u9664\u6B64\u65E5\u7A0B\u3002");
      if (!sameEventContent(current.event, target.before)) throw new Error("\u65E5\u7A0B\u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u505C\u6B62\u5220\u9664\uFF1B\u8BF7\u5148\u5237\u65B0\u6838\u5BF9\u3002");
      try {
        await this.api().deleteEvent(current.id);
      } catch (e) {
        if (!isMissingResource(e)) throw e;
        this.refresh();
        throw new Error("\u65E5\u5386\u8D44\u6E90\u4E0D\u5B58\u5728\uFF08HTTP 404/410\uFF09\u3002\u5237\u65B0\u540E\u4F1A\u6838\u5BF9\uFF1B\u82E5\u5DF2\u5728\u8FDC\u7AEF\u5220\u9664\uFF0C\u53EF\u70B9\u6B64\u5361\u7247\u6E05\u7406\u672C\u5730\u6B8B\u7559\u3002");
      }
      if (this.find(target.calendarId, target.uid)) throw new Error("\u5220\u9664\u7ED3\u679C\u672A\u786E\u8BA4\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
    }
    async ensureEvent(calendarId, event) {
      this.assertWritable(calendarId);
      const old = this.readByUid(calendarId, event.uid);
      if (old) {
        if (!containsEvent(old, event)) throw new Error("\u540C\u4E00 UID \u7684\u65E5\u5386\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u505C\u6B62\u91CD\u590D\u5199\u5165\u3002");
        return clone(old);
      }
      if (!this.hasCalendarData(calendarId)) throw new Error("\u65E5\u5386\u7F13\u5B58\u5C1A\u672A\u5C31\u7EEA\uFF0C\u8BF7\u7A0D\u540E\u91CD\u8BD5\u3002");
      if (await this.api().createEvent(calendarId, content(event)) !== true) {
        this.refresh();
        throw new Error("FCR \u672A\u786E\u8BA4\u65E5\u5386\u5199\u5165\uFF0C\u5DF2\u8BF7\u6C42\u5237\u65B0\uFF1B\u540E\u53F0\u5C06\u6838\u5BF9 UID \u540E\u91CD\u8BD5\u3002");
      }
      const saved = this.readByUid(calendarId, event.uid);
      if (!saved || !containsEvent(saved, event)) throw new Error("\u65E5\u5386\u5199\u5165\u7ED3\u679C\u672A\u80FD\u6838\u5BF9\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
      return clone(saved);
    }
    async reconcileStep(step, checkpoint) {
      if (step.stage === "done") return;
      this.assertWritable(step.toCalendarId);
      if (!step.fromCalendarId) {
        step.after = await this.ensureEvent(step.toCalendarId, step.after);
        step.stage = "done";
        await checkpoint();
        return;
      }
      const same = step.fromCalendarId === step.toCalendarId;
      let source = this.find(step.fromCalendarId, step.uid);
      let target = this.find(step.toCalendarId, step.uid);
      if (same) {
        if (!source) throw new Error("\u539F\u65E5\u7A0B\u5DF2\u5220\u9664\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u5EFA\u3002");
        if (!containsEvent(source.event, step.after)) {
          if (!sameEventContent(source.event, step.before)) throw new Error("\u539F\u65E5\u7A0B\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u7F16\u8F91\u3002");
          if (!this.api().getProviderCapabilities(source.calendarId)?.canEdit) throw new Error("\u539F\u65E5\u7A0B\u53EA\u8BFB\u3002");
          const next = { ...source.event, ...content(step.after) };
          if (await this.api().updateEvent(source.id, next) !== true) {
            this.refresh();
            throw new Error("FCR \u672A\u786E\u8BA4\u65E5\u7A0B\u4FEE\u6539\uFF0C\u5DF2\u8BF7\u6C42\u5237\u65B0\uFF1B\u540E\u53F0\u5C06\u6838\u5BF9\u8FDC\u7AEF\u5185\u5BB9\u540E\u91CD\u8BD5\uFF08\u7F51\u7EDC\u5931\u8D25\u6216\u7248\u672C\u51B2\u7A81\uFF09\u3002");
          }
        }
        const saved = this.readByUid(step.toCalendarId, step.uid);
        if (!saved || !containsEvent(saved, step.after)) throw new Error("\u65E5\u7A0B\u4FEE\u6539\u7ED3\u679C\u672A\u80FD\u6838\u5BF9\u3002");
        step.after = clone(saved);
        step.stage = "done";
        await checkpoint();
        return;
      }
      if (source && !sameEventContent(source.event, step.before)) throw new Error("\u539F\u65E5\u7A0B\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u8BF7\u5148\u6838\u5BF9\uFF1B\u5C1A\u672A\u5220\u9664\u539F\u65E5\u7A0B\u3002");
      if (!source && !target) throw new Error("\u6765\u6E90\u548C\u76EE\u6807\u5747\u627E\u4E0D\u5230\u65E5\u7A0B\uFF0C\u4E0D\u4F1A\u81EA\u52A8\u91CD\u5EFA\u3002");
      if (!target) {
        if (step.stage === "target-confirmed") throw new Error("\u76EE\u6807\u65E5\u7A0B\u5DF2\u88AB\u5220\u9664\uFF0C\u505C\u6B62\u79FB\u52A8\u3002");
        if (!source) throw new Error("\u539F\u65E5\u7A0B\u4E0D\u5B58\u5728\u3002");
        if (!this.api().getProviderCapabilities(source.calendarId)?.canDelete) throw new Error("\u6765\u6E90\u65E5\u5386\u4E0D\u5141\u8BB8\u79FB\u52A8\u65E5\u7A0B\u3002");
        await this.ensureEvent(step.toCalendarId, step.after);
        target = this.find(step.toCalendarId, step.uid);
      }
      if (!target || !containsEvent(target.event, step.after)) throw new Error("\u76EE\u6807\u65E5\u5386\u4E2D\u540C UID \u5185\u5BB9\u4E0D\u540C\uFF0C\u505C\u6B62\u79FB\u52A8\u3002");
      step.after = clone(target.event);
      step.stage = "target-confirmed";
      await checkpoint();
      source = this.find(step.fromCalendarId, step.uid);
      const confirmed = this.readByUid(step.toCalendarId, step.uid);
      if (!confirmed || !containsEvent(confirmed, step.after)) throw new Error("\u76EE\u6807\u65E5\u7A0B\u5DF2\u53D8\u5316\uFF0C\u4FDD\u7559\u6765\u6E90\u3002");
      if (source) {
        if (!sameEventContent(source.event, step.before)) throw new Error("\u6765\u6E90\u65E5\u7A0B\u5DF2\u53D8\u5316\uFF0C\u4FDD\u7559\u6765\u6E90\u3002");
        if (!this.api().getProviderCapabilities(source.calendarId)?.canDelete) throw new Error("\u6765\u6E90\u65E5\u5386\u4E0D\u5141\u8BB8\u5220\u9664\u3002");
        await this.api().deleteEvent(source.id);
      }
      if (this.find(step.fromCalendarId, step.uid)) throw new Error("\u76EE\u6807\u5DF2\u4FDD\u5B58\uFF0C\u6765\u6E90\u5220\u9664\u5C1A\u672A\u786E\u8BA4\uFF1B\u53EF\u5B89\u5168\u91CD\u8BD5\u3002");
      if (!this.readByUid(step.toCalendarId, step.uid)) throw new Error("\u76EE\u6807\u65E5\u7A0B\u5DF2\u6D88\u5931\uFF0C\u8BF7\u5237\u65B0\u6838\u5BF9\u3002");
      step.stage = "done";
      await checkpoint();
    }
    timeline(date2) {
      const dayStart = +/* @__PURE__ */ new Date(`${date2}T00:00:00`), nextDay = new Date(dayStart);
      nextDay.setDate(nextDay.getDate() + 1);
      const query = this.api().getEvents({}, []).filter((q) => Number.isFinite(q.startMillis) && q.startMillis < +nextDay && Math.max(q.startMillis, (q.endMillis ?? q.startMillis + 36e5) - 1) >= dayStart);
      const byId = new Map(query.map((e) => [e.id, e]));
      const entries2 = this.api().getAllEvents().flatMap((g) => (g.events || []).filter((x) => byId.has(x.id)).map((x) => ({ id: x.id, calendarId: g.id, color: g.color, event: clone(x.event) })));
      return entries2.flatMap((original) => {
        const e = original.event, q = byId.get(original.id);
        if (e.isTask || e.completed != null || !q || !Number.isFinite(q.startMillis)) return [];
        const start = q.startMillis, end = q.endMillis ?? start + 36e5;
        if (date2 < dayKey(start) || date2 > dayKey(Math.max(start, end - 1))) return [];
        return [{
          key: `${original.calendarId}:${original.id}`,
          title: e.title,
          calendarId: original.calendarId,
          color: original.color,
          start,
          end,
          allDay: e.allDay,
          original,
          unsupported: e.allDay || e.type !== "single"
        }];
      }).sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
    }
    async prepareEvent(draft, original) {
      if (!draft.title.trim() || !Number.isFinite(draft.start) || !Number.isFinite(draft.end) || draft.end <= draft.start) throw new Error("\u8BF7\u586B\u5199\u6807\u9898\u548C\u6709\u6548\u8D77\u6B62\u65F6\u95F4\u3002");
      this.assertWritable(draft.calendarId);
      if (original) {
        const current = this.entries().find((e) => e.id === original.id && e.calendarId === original.calendarId);
        if (!current || !sameEventContent(current.event, original.event)) throw new Error("\u65E5\u7A0B\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u6253\u5F00\u3002");
      }
      const { dateParts: dateParts2 } = await Promise.resolve().then(() => (init_time(), time_exports));
      const start = dateParts2(draft.start, "UTC"), end = dateParts2(draft.end, "UTC");
      const after = {
        ...original?.event || {},
        type: "single",
        title: draft.title.trim(),
        uid: original?.event.uid || draft.uid || `ctt-event-${uid()}`,
        date: start.date,
        endDate: end.date,
        startTime: start.time,
        endTime: end.time,
        timezone: "UTC",
        allDay: false,
        isTask: false
      };
      if (original && !original.event.uid) throw new Error("\u6B64\u4E8B\u4EF6\u7F3A\u5C11\u7A33\u5B9A UID\uFF0C\u8BF7\u5728\u5B8C\u6574\u65E5\u5386\u4E2D\u7F16\u8F91\u3002");
      return {
        uid: after.uid,
        fromCalendarId: original?.calendarId || "",
        toCalendarId: draft.calendarId,
        before: original?.event || after,
        after,
        stage: "prepared"
      };
    }
    refresh() {
      this.api().revalidateRemoteCalendars(true);
    }
    openCalendar() {
      return this.api().openCalendar();
    }
  };

  // Shared/timer.ts
  init_time();
  var blankJournal = () => ({ version: 2, active: null, records: [], operations: [] });
  function validateJournal(input) {
    const data = clone(input);
    if (!data || ![1, 2].includes(data.version) || !Array.isArray(data.records)) throw new Error("\u8BA1\u65F6\u65E5\u5FD7\u683C\u5F0F\u4E0D\u6B63\u786E\uFF0C\u5DF2\u4FDD\u7559\u539F\u6587\u4EF6\u3002");
    data.operations ??= [];
    if (!Array.isArray(data.operations) || data.operations.some((o) => !o.id || !o.step?.uid || !["pending", "saved"].includes(o.status))) throw new Error("\u65E5\u7A0B\u4FEE\u6539\u65E5\u5FD7\u635F\u574F\u3002");
    if (data.deletions && (!Array.isArray(data.deletions) || data.deletions.some((o) => !o.id || !o.uid || !o.calendarId || !o.before || o.before.uid !== o.uid || !Number.isFinite(o.start) || !Number.isFinite(o.end) || !["pending", "saved"].includes(o.status)))) throw new Error("\u5220\u9664\u64CD\u4F5C\u65E5\u5FD7\u635F\u574F\u3002");
    for (const s of [data.active, ...data.records].filter(Boolean)) {
      if (!s.id || !s.task?.id || !s.calendarId || !s.zone || !Number.isFinite(s.startedAt) || !Number.isFinite(s.lastHeartbeat) || !Array.isArray(s.segments) || s.runningSince != null && !Number.isFinite(s.runningSince)) throw new Error("\u8BA1\u65F6\u65E5\u5FD7\u4E0D\u5B8C\u6574\u3002");
      new Intl.DateTimeFormat("en", { timeZone: s.zone });
      let end = -Infinity;
      for (const p of s.segments) {
        if (!Number.isFinite(p.start) || !Number.isFinite(p.end) || p.end < p.start || p.start < end) throw new Error("\u8BA1\u65F6\u65E5\u5FD7\u533A\u95F4\u635F\u574F\u3002");
        end = p.end;
      }
      if (s.runningSince != null && s.runningSince < end) throw new Error("\u8BA1\u65F6\u65E5\u5FD7\u533A\u95F4\u91CD\u53E0\u3002");
    }
    for (const r of data.records) {
      if (!Number.isFinite(r.endedAt) || !["saved", "pending"].includes(r.status) || r.segments.some((p) => !p.uid)) throw new Error("\u5386\u53F2\u65E5\u5FD7\u4E0D\u5B8C\u6574\u3002");
      if (r.edit) {
        validateSegments(r.edit.segments, Infinity);
        if (r.edit.steps.length !== r.edit.segments.length || r.edit.steps.some((p) => !p.uid || !p.before || !p.after || !["prepared", "target-confirmed", "done"].includes(p.stage))) throw new Error("\u4FEE\u6539\u65E5\u5FD7\u635F\u574F\u3002");
      }
    }
    for (const job of [...data.records, ...data.operations, ...data.deletions || []]) {
      if (job.sync && (!Number.isInteger(job.sync.revision) || job.sync.revision < 0 || !Number.isInteger(job.sync.attempt) || job.sync.attempt < 0 || !Number.isFinite(job.sync.retryAt))) throw new Error("\u540C\u6B65\u8FDB\u5EA6\u65E5\u5FD7\u635F\u574F\u3002");
    }
    data.version = 2;
    return data;
  }
  function pauseSession(session, now) {
    if (!session) throw new Error("\u6CA1\u6709\u6B63\u5728\u8BA1\u65F6\u7684\u5F85\u529E\u3002");
    const s = clone(session);
    if (s.runningSince != null) {
      if (now < s.runningSince) throw new Error("\u7CFB\u7EDF\u65F6\u95F4\u5012\u9000\uFF0C\u8BF7\u68C0\u67E5\u65F6\u95F4\u3002");
      if (now > s.runningSince) s.segments.push({ start: s.runningSince, end: now });
      s.runningSince = null;
    }
    s.lastHeartbeat = now;
    return s;
  }
  var TimerController = class {
    constructor(deps) {
      this.deps = deps;
      this.state = validateJournal(deps.state || blankJournal());
    }
    deps;
    state;
    serial = Promise.resolve();
    flights = /* @__PURE__ */ new Map();
    stopped = false;
    now() {
      return this.deps.now?.() ?? Date.now();
    }
    lock(fn) {
      const p = this.serial.then(fn);
      this.serial = p.catch(() => {
      });
      return p;
    }
    async commit(next, notify = true) {
      this.live();
      await this.deps.persist(clone(next));
      this.state = next;
      if (notify) this.deps.onChange?.();
    }
    recover() {
      return this.lock(async () => {
        if (this.state.active?.runningSince == null) return false;
        const s = this.state.active;
        await this.commit({ ...this.state, active: pauseSession(s, Math.max(s.runningSince, Math.min(s.lastHeartbeat, this.now()))) });
        return true;
      });
    }
    stopRemote() {
      this.stopped = true;
    }
    live() {
      if (this.stopped) throw new Error("\u540C\u6B65\u5668\u5DF2\u505C\u6B62\uFF1B\u64CD\u4F5C\u4FDD\u7559\u5230\u4E0B\u6B21\u542F\u52A8\u3002");
    }
    info(job) {
      return { revision: job?.sync?.revision || 0, attempt: job?.sync?.attempt || 0, retryAt: job?.sync?.retryAt || 0, issue: job?.sync?.issue };
    }
    job(key2) {
      const [type, id] = key2.split(":");
      return type === "work" ? this.state.records.find((r) => r.id === id) : type === "event" ? this.state.operations.find((o) => o.id === id) : this.state.deletions?.find((o) => o.id === id);
    }
    jobs() {
      return [...this.state.records.filter((r) => r.status === "pending").map((r) => ({ key: `work:${r.id}`, value: r })), ...this.state.operations.filter((o) => o.status === "pending").map((o) => ({ key: `event:${o.id}`, value: o })), ...(this.state.deletions || []).filter((o) => o.status === "pending").map((o) => ({ key: `delete:${o.id}`, value: o }))];
    }
    async updateJob(key2, change) {
      const current = this.job(key2);
      if (!current) throw new Error("\u540C\u6B65\u64CD\u4F5C\u4E0D\u5B58\u5728\u3002");
      const next = clone(current);
      change(next);
      const [type, id] = key2.split(":");
      await this.commit({ ...this.state, ...type === "work" ? { records: this.state.records.map((r) => r.id === id ? next : r) } : type === "event" ? { operations: this.state.operations.map((o) => o.id === id ? next : o) } : { deletions: this.state.deletions.map((o) => o.id === id ? next : o) } });
    }
    requestRetry(key2) {
      return this.lock(async () => {
        if (this.flights.has(key2)) return;
        await this.updateJob(key2, (job) => {
          job.error = "";
          job.sync = { ...this.info(job), retryAt: 0, issue: void 0 };
        });
      });
    }
    runJob(key2, execute, automatic = false) {
      const prior = this.flights.get(key2);
      if (prior) return prior;
      const promise = (async () => {
        const ready = await this.lock(async () => {
          this.live();
          const current2 = this.job(key2);
          if (automatic && (!current2 || current2.status !== "pending" || !current2.sync && current2.error || current2.sync?.issue && current2.sync.issue !== "network" || (current2.sync?.retryAt || 0) > this.now())) return false;
          if (current2?.status === "pending") await this.updateJob(key2, (job) => {
            job.sync = { ...this.info(job), attempt: (job.sync?.attempt || 0) + 1 };
          });
          return true;
        });
        if (!ready) return clone(this.job(key2));
        const result = await execute();
        await this.lock(async () => {
          this.live();
          if (this.job(key2)?.status !== "pending") return;
          await this.updateJob(key2, (job) => {
            const info = this.info(job), issue = classifySyncError(job.error);
            job.sync = { ...info, issue, retryAt: issue === "network" ? this.now() + Math.round(Math.min(3e5, 2e3 * 2 ** Math.min(info.attempt - 1, 8)) * (0.85 + Math.random() * 0.3)) : 0 };
          });
        });
        const current = this.job(key2);
        return current ? clone(current) : result;
      })();
      this.flights.set(key2, promise);
      void promise.finally(() => this.flights.delete(key2)).catch(() => {
      });
      return promise;
    }
    sync(key2) {
      const [type, id] = key2.split(":");
      return this.runJob(key2, async () => type === "work" ? this.flush(id) : type === "event" ? this.flushOperation(id) : this.flushDeletion(id), true);
    }
    guard(key2, revision) {
      this.live();
      const current = this.job(key2);
      if (!current || current.status !== "pending" || (current.sync?.revision || 0) !== revision) throw new Error("\u64CD\u4F5C\u7248\u672C\u5DF2\u53D8\u5316\uFF0C\u5FFD\u7565\u65E7\u540C\u6B65\u7ED3\u679C\u3002");
    }
    start(task, calendarId) {
      return this.lock(async () => {
        if (this.state.active) throw new Error("\u8BF7\u5148\u7ED3\u675F\u5F53\u524D\u8BA1\u65F6\u3002");
        if (!task.id || !task.title.trim()) throw new Error("\u8BF7\u9009\u62E9\u6709\u6548\u5F85\u529E\u3002");
        this.deps.calendar.assertWritable(calendarId);
        const now = this.now();
        const active = {
          id: uid(),
          title: task.title,
          task: clone(task),
          calendarId,
          zone: this.deps.zone?.() ?? Intl.DateTimeFormat().resolvedOptions().timeZone,
          startedAt: now,
          runningSince: now,
          lastHeartbeat: now,
          segments: []
        };
        await this.commit({ ...this.state, active });
      });
    }
    pause() {
      return this.lock(() => this.commit({ ...this.state, active: pauseSession(this.state.active, this.now()) }));
    }
    resume() {
      return this.lock(async () => {
        const s = this.state.active, now = this.now();
        if (!s || s.runningSince != null) throw new Error("\u5F53\u524D\u72B6\u6001\u4E0D\u80FD\u7EE7\u7EED\u3002");
        if (now < (s.segments.at(-1)?.end ?? s.startedAt)) throw new Error("\u7CFB\u7EDF\u65F6\u95F4\u5012\u9000\uFF0C\u8BF7\u68C0\u67E5\u65F6\u95F4\u3002");
        await this.commit({ ...this.state, active: { ...s, runningSince: now, lastHeartbeat: now } });
      });
    }
    heartbeat() {
      return this.lock(async () => {
        if (this.state.active?.runningSince != null) await this.commit({
          ...this.state,
          active: { ...this.state.active, lastHeartbeat: this.now() }
        }, false);
      });
    }
    updateActive(patch, expectedId) {
      return this.lock(async () => {
        const s = clone(this.state.active);
        if (!s) throw new Error("\u6CA1\u6709\u5F53\u524D\u8BA1\u65F6\u3002");
        if (expectedId && s.id !== expectedId) throw new Error("\u5F53\u524D\u8BA1\u65F6\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u3002");
        if (patch.calendarId) {
          this.deps.calendar.assertWritable(patch.calendarId);
          s.calendarId = patch.calendarId;
        }
        if (patch.startedAt != null) {
          const boundary = s.segments[0]?.end ?? (s.runningSince == null ? s.lastHeartbeat : this.now());
          if (!Number.isFinite(patch.startedAt) || patch.startedAt > this.now() || patch.startedAt > boundary - (s.segments.length ? 1e3 : 0)) throw new Error("\u5F00\u59CB\u65F6\u95F4\u4E0D\u80FD\u665A\u4E8E\u9996\u6BB5\u7ED3\u675F\u6216\u5F53\u524D\u65F6\u95F4\u3002");
          s.startedAt = patch.startedAt;
          if (s.segments.length) s.segments[0].start = patch.startedAt;
          else if (s.runningSince != null) s.runningSince = patch.startedAt;
          else if (patch.startedAt < boundary) s.segments.push({ start: patch.startedAt, end: boundary });
        }
        await this.commit({ ...this.state, active: s });
      });
    }
    finish(completeTask = true) {
      return this.lock(async () => {
        const now = this.now(), s = pauseSession(this.state.active, now);
        const segments = s.segments.filter((p) => p.end - p.start >= 1e3).map((p, i) => ({ ...p, uid: `simple-task-timer-${s.id}-${i}`, saved: false }));
        validateSegments(segments, now);
        const record = { ...s, segments, endedAt: now, completeTask, taskSaved: !completeTask, status: "pending", error: "", sync: this.info(), localFirst: !!this.deps.background && s.task.kind === "local" };
        await this.commit({ ...this.state, active: null, records: [...this.state.records, record] });
        if (record.localFirst && completeTask) {
          try {
            await this.deps.tasks.complete(record.task);
            record.taskSaved = true;
            await this.replace(record);
          } catch (e) {
            const durable = clone(this.state.records.find((r) => r.id === record.id));
            durable.error = e.message;
            durable.sync = { ...this.info(durable), issue: "conflict" };
            await this.replace(durable);
            return durable;
          }
        }
        return record;
      }).then((r) => this.deps.background ? r : this.retry(r.id));
    }
    retry(id) {
      return this.runJob(`work:${id}`, () => this.flush(id));
    }
    async replace(record) {
      await this.commit({ ...this.state, records: this.state.records.map((r) => r.id === record.id ? clone(record) : r) });
    }
    checkpointRecord(r) {
      return this.lock(async () => {
        this.guard(`work:${r.id}`, r.sync?.revision || 0);
        await this.replace(r);
      });
    }
    async flush(id) {
      let r = await this.lock(() => Promise.resolve(clone(this.state.records.find((r2) => r2.id === id))));
      if (!r) throw new Error("\u8BB0\u5F55\u4E0D\u5B58\u5728\u3002");
      if (r.status === "saved" && !r.edit) return r;
      try {
        this.live();
        if (r.localFirst && r.completeTask && !r.taskSaved) {
          await this.deps.tasks.complete(r.task);
          r.taskSaved = true;
          await this.checkpointRecord(r);
        }
        this.deps.calendar.assertWritable(r.calendarId);
        if (r.edit) {
          for (const step of r.edit.steps) {
            this.live();
            await this.deps.calendar.reconcileStep(step, () => this.checkpointRecord(r));
          }
          r.calendarId = r.edit.calendarId;
          r.title = r.edit.title;
          r.segments = r.edit.segments.map((p, i) => ({ ...p, saved: true, snapshot: r.edit.steps[i].after }));
          r.startedAt = r.segments[0].start;
          r.endedAt = r.segments.at(-1).end;
          delete r.edit;
          await this.checkpointRecord(r);
        } else {
          for (const p of r.segments) {
            if (p.saved) continue;
            this.live();
            p.snapshot = await this.deps.calendar.ensureEvent(r.calendarId, eventForSegment(r, p));
            p.saved = true;
            await this.checkpointRecord(r);
          }
        }
        this.live();
        if (r.completeTask && !r.taskSaved) {
          await this.deps.tasks.complete(r.task);
          r.taskSaved = true;
        }
        await this.lock(async () => {
          this.guard(`work:${id}`, r.sync?.revision || 0);
          r.status = "saved";
          r.error = "";
          await this.replace(r);
        });
      } catch (e) {
        await this.lock(async () => {
          this.guard(`work:${id}`, r.sync?.revision || 0);
          r = clone(this.state.records.find((x) => x.id === id));
          r.error = e.message;
          await this.replace(r);
        });
      }
      return r;
    }
    editRecord(id, draft, expected) {
      return this.lock(async () => {
        const current = this.state.records.find((r2) => r2.id === id);
        if (!current || JSON.stringify(current) !== JSON.stringify(expected)) throw new Error("\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u3002");
        if (current.status !== "saved" || current.edit) throw new Error("\u8BF7\u5148\u5904\u7406\u5F85\u540C\u6B65\u64CD\u4F5C\uFF0C\u518D\u4FEE\u6539\u8BB0\u5F55\u3002");
        if (this.state.deletions?.some((o) => o.recordId === id && o.status !== "saved")) throw new Error("\u6B64\u8BB0\u5F55\u6709\u5F85\u540C\u6B65\u7684\u5220\u9664\u64CD\u4F5C\uFF0C\u8BF7\u5148\u5904\u7406\u3002");
        const title = draft.title.trim();
        if (!title) throw new Error("\u8BF7\u586B\u5199\u6807\u9898\u3002");
        this.deps.calendar.assertWritable(draft.calendarId);
        validateSegments(draft.segments, this.now());
        if (draft.segments.length !== current.segments.length) throw new Error("\u672C\u7248\u4E0D\u589E\u52A0\u6216\u5220\u9664\u5386\u53F2\u5206\u6BB5\u3002");
        const r = clone(current);
        const steps = current.segments.map((p, i) => {
          const remote = this.deps.calendar.readByUid(current.calendarId, p.uid);
          if (!remote) throw new Error("\u65E5\u5386\u4E2D\u7684\u539F\u8BB0\u5F55\u5DF2\u5220\u9664\uFF0C\u8BF7\u5237\u65B0\uFF1B\u4E0D\u4F1A\u81EA\u52A8\u91CD\u5EFA\u3002");
          const before = draft.snapshots?.[i] ?? p.snapshot ?? eventForSegment(current, p);
          if (draft.snapshots?.[i] || p.snapshot ? !sameEventContent(remote, before) : !Object.entries(before).every(([k, v]) => v === void 0 || JSON.stringify(remote[k]) === JSON.stringify(v))) throw new Error("\u65E5\u5386\u8BB0\u5F55\u5DF2\u88AB\u5916\u90E8\u4FEE\u6539\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u6253\u5F00\u3002");
          const after = { ...remote, ...eventForSegment({ title }, { ...draft.segments[i], uid: p.uid }) };
          return { uid: p.uid, fromCalendarId: current.calendarId, toCalendarId: draft.calendarId, before: clone(remote), after, stage: "prepared" };
        });
        r.status = "pending";
        r.error = "";
        r.sync = { revision: (r.sync?.revision || 0) + 1, attempt: 0, retryAt: 0 };
        r.edit = { calendarId: draft.calendarId, title, segments: draft.segments.map((p, i) => ({ start: p.start, end: p.end, uid: current.segments[i].uid })), steps };
        await this.replace(r);
        return r;
      }).then((r) => this.deps.background ? r : this.retry(id));
    }
    keepCalendarOnly(id) {
      return this.lock(async () => {
        if (this.flights.has(`work:${id}`)) throw new Error("\u6B64\u8BB0\u5F55\u6B63\u5728\u540C\u6B65\uFF0C\u8BF7\u7B49\u672C\u6B21\u8BF7\u6C42\u7ED3\u675F\u3002");
        const r = this.state.records.find((r2) => r2.id === id);
        if (!r || r.edit || r.segments.some((p) => !p.saved)) throw new Error("\u8BF7\u5148\u6210\u529F\u4FDD\u5B58\u5168\u90E8\u65E5\u5386\u65F6\u95F4\u6BB5\u3002");
        await this.replace({ ...r, completeTask: false, taskSaved: true, status: "saved", error: "" });
      });
    }
    saveEvent(step) {
      return this.lock(async () => {
        if (this.jobs().some((j) => j.key.startsWith("event:") && j.value.step.uid === step.uid)) throw new Error("\u6B64\u65E5\u7A0B\u5DF2\u6709\u5F85\u540C\u6B65\u4FEE\u6539\uFF0C\u8BF7\u5148\u5904\u7406\u8BE5\u9879\u3002");
        const id = uid();
        const op = { id, title: step.after.title, step: clone(step), status: "pending", error: "", sync: this.info() };
        await this.commit({ ...this.state, operations: [...this.state.operations, op] });
        return op;
      }).then((op) => this.deps.background ? op : this.retryEvent(op.id));
    }
    retryEvent(id) {
      return this.runJob(`event:${id}`, () => this.flushOperation(id));
    }
    async flushOperation(id) {
      let op = clone(this.state.operations.find((o) => o.id === id));
      if (!op) throw new Error("\u64CD\u4F5C\u4E0D\u5B58\u5728\u3002");
      if (op.status === "saved") return op;
      const revision = op.sync?.revision || 0;
      const checkpoint = () => this.lock(async () => {
        this.guard(`event:${id}`, revision);
        await this.commit({ ...this.state, operations: this.state.operations.map((o) => o.id === id ? clone(op) : o) });
      });
      try {
        this.live();
        await this.deps.calendar.reconcileStep(op.step, checkpoint);
        op.status = "saved";
        op.error = "";
        await checkpoint();
      } catch (e) {
        op = clone(this.state.operations.find((o) => o.id === id));
        op.error = e.message;
        await checkpoint();
      }
      return op;
    }
    deleteEvent(target, range, record) {
      return this.lock(async () => {
        if (record) {
          const current = this.state.records.find((r) => r.id === record.id);
          if (!current || JSON.stringify(current) !== JSON.stringify(record)) throw new Error("\u8BB0\u5F55\u5DF2\u53D8\u5316\uFF0C\u8BF7\u91CD\u65B0\u6253\u5F00\u3002");
          if (current.status !== "saved" || current.edit || !current.segments.some((p) => p.uid === target.uid) || current.calendarId !== target.calendarId) throw new Error("\u8BF7\u5148\u5904\u7406\u8BB0\u5F55\u7684\u5F85\u540C\u6B65\u64CD\u4F5C\uFF0C\u518D\u5220\u9664\u3002");
        }
        if (this.state.deletions?.some((o) => o.status !== "saved" && (o.recordId && o.recordId === record?.id || o.uid === target.uid && o.calendarId === target.calendarId))) throw new Error("\u6B64\u8BB0\u5F55\u5DF2\u5728\u7B49\u5F85\u5220\u9664\uFF0C\u8BF7\u5728\u5F85\u540C\u6B65\u4E2D\u91CD\u8BD5\u3002");
        if (this.state.operations.some((o) => o.status !== "saved" && o.step.uid === target.uid && [o.step.fromCalendarId, o.step.toCalendarId].includes(target.calendarId))) throw new Error("\u6B64\u65E5\u7A0B\u6B63\u5728\u4FEE\u6539\uFF0C\u8BF7\u5148\u5904\u7406\u5F85\u540C\u6B65\u64CD\u4F5C\u3002");
        if (!Number.isFinite(range.start) || !Number.isFinite(range.end)) throw new Error("\u5220\u9664\u8BB0\u5F55\u7684\u65F6\u95F4\u8303\u56F4\u65E0\u6548\u3002");
        const remote = this.deps.calendar.readByUid(target.calendarId, target.uid);
        if (!remote || !sameEvent(remote, target.before)) throw new Error("\u65E5\u7A0B\u5DF2\u4FEE\u6539\u6216\u5220\u9664\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u65B0\u6253\u5F00\u3002");
        const op = { ...clone(target), ...range, id: uid(), title: target.before.title, recordId: record?.id, status: "pending", error: "", sync: this.info() };
        await this.commit({ ...this.state, deletions: [...this.state.deletions || [], op] });
        return op;
      }).then((op) => this.deps.background ? op : this.retryDeletion(op.id));
    }
    retryDeletion(id) {
      return this.runJob(`delete:${id}`, () => this.flushDeletion(id));
    }
    reconcileDeletions() {
      return this.lock(async () => {
        let count = 0;
        for (const op of this.state.deletions?.filter((o) => o.status === "pending") || []) {
          if (this.flights.has(`delete:${op.id}`)) continue;
          if (!this.deps.calendar.hasCalendarData?.(op.calendarId)) continue;
          if (this.deps.calendar.readByUid(op.calendarId, op.uid)) continue;
          await this.confirmDeletion({ ...clone(op), resolution: "absent-in-fcr" });
          count++;
        }
        return count;
      });
    }
    confirmRemoteDeletion(id) {
      return this.lock(async () => {
        if (this.flights.has(`delete:${id}`)) throw new Error("\u6B64\u8BB0\u5F55\u6B63\u5728\u540C\u6B65\uFF0C\u8BF7\u7B49\u672C\u6B21\u8BF7\u6C42\u7ED3\u675F\u518D\u6838\u5BF9\u3002");
        const op = this.state.deletions?.find((o) => o.id === id);
        if (!op) throw new Error("\u5220\u9664\u8BF7\u6C42\u4E0D\u5B58\u5728\u3002");
        if (op.status === "saved") return;
        if (!isMissingResource(op.error)) throw new Error("\u6B64\u8BF7\u6C42\u5C1A\u672A\u62A5\u544A\u8D44\u6E90\u4E0D\u5B58\u5728\uFF0C\u8BF7\u5148\u5237\u65B0\u6216\u91CD\u8BD5\u3002");
        const current = this.deps.calendar.readByUid(op.calendarId, op.uid);
        if (current && !sameEventContent(current, op.before)) throw new Error("\u65E5\u7A0B\u5185\u5BB9\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5148\u5728\u5B8C\u6574\u65E5\u5386\u4E2D\u6838\u5BF9\u3002");
        await this.confirmDeletion({ ...clone(op), resolution: "user-confirmed-remote-deletion" });
      });
    }
    async confirmDeletion(op) {
      op.status = "saved";
      op.error = "";
      const records = this.state.records.map((r) => {
        if (r.id !== op.recordId) return r;
        const segments = r.segments.filter((p) => p.uid !== op.uid);
        return { ...r, segments, startedAt: segments[0]?.start ?? r.startedAt, endedAt: segments.at(-1)?.end ?? r.endedAt };
      });
      await this.commit({ ...this.state, records, deletions: this.state.deletions.map((o) => o.id === op.id ? clone(op) : o) });
    }
    async flushDeletion(id) {
      let op = clone(this.state.deletions?.find((o) => o.id === id));
      if (!op) throw new Error("\u5220\u9664\u64CD\u4F5C\u4E0D\u5B58\u5728\u3002");
      if (op.status === "saved") return op;
      try {
        this.live();
        await this.deps.calendar.deleteEvent(op);
        op.resolution = "deleted";
        await this.lock(async () => {
          this.guard(`delete:${id}`, op.sync?.revision || 0);
          await this.confirmDeletion(op);
        });
        op = clone(this.state.deletions.find((o) => o.id === id));
      } catch (e) {
        await this.lock(async () => {
          this.guard(`delete:${id}`, op.sync?.revision || 0);
          op = clone(this.state.deletions.find((o) => o.id === id));
          op.error = e.message;
          await this.commit({ ...this.state, deletions: this.state.deletions.map((o) => o.id === id ? clone(op) : o) });
        });
      }
      return op;
    }
  };
  function classifySyncError(message) {
    if (/授权|请先连接|请启用兼容|scope|HTTP\s+(401|403)\b/i.test(message)) return "auth";
    if (/外部|已变化|已删除|找不到|不存在|同 UID|分类日历|无法|不允许|只读|HTTP\s+(404|410)\b/i.test(message)) return "conflict";
    if (/network|offline|fetch|timeout|timed? out|ECONN|ENET|网络|断网|超时|未确认|未能核对|尚未就绪|lost.*response|HTTP\s+(429|5\d\d)\b/i.test(message)) return "network";
    return "conflict";
  }

  // Preview/preview.ts
  init_time();

  // Shared/timeline.ts
  init_time();
  function mergeTimeline(remote, records, date2, operations = [], deletions = []) {
    const rows = clone(remote).filter((r) => !deletions.some((op) => op.status === "saved" && ["absent-in-fcr", "user-confirmed-remote-deletion"].includes(op.resolution || "") && op.calendarId === r.calendarId && op.uid === r.original?.event.uid && sameEventContent(op.before, r.original.event)));
    const index = new Map(rows.flatMap((r) => r.original?.event.uid ? [[`${r.calendarId}:${r.original.event.uid}`, r]] : []));
    for (const record of records) {
      const visible = record.edit ? { ...record, ...record.edit } : record;
      visible.segments.forEach((part) => {
        const found = index.get(`${visible.calendarId}:${part.uid}`);
        if (record.status === "saved") {
          if (found) {
            found.recordId = record.id;
            found.segmentUid = part.uid;
          }
          return;
        }
        const known = rows.filter((r) => r.original?.event.uid === part.uid && [record.calendarId, visible.calendarId].includes(r.calendarId));
        known.forEach((r) => {
          r.recordId = record.id;
          r.segmentUid = part.uid;
        });
        known.forEach((r) => rows.splice(rows.indexOf(r), 1));
        if (date2 < dayKey(part.start) || date2 > dayKey(Math.max(part.start, part.end - 1))) return;
        rows.push({
          key: `work:${record.id}:${part.uid}`,
          title: visible.title,
          calendarId: visible.calendarId,
          start: part.start,
          end: part.end,
          recordId: record.id,
          segmentUid: part.uid,
          pending: true,
          error: record.error
        });
      });
    }
    for (const op of operations.filter((o) => o.status === "pending")) {
      const step = op.step, event = step.after;
      const start = Date.parse(`${event.date}T${event.startTime}Z`), end = Date.parse(`${event.endDate || event.date}T${event.endTime}Z`);
      if (!Number.isFinite(start) || !Number.isFinite(end)) continue;
      const known = rows.filter((r) => r.original?.event.uid === step.uid && [step.fromCalendarId, step.toCalendarId].includes(r.calendarId));
      known.forEach((r) => rows.splice(rows.indexOf(r), 1));
      if (date2 < dayKey(start) || date2 > dayKey(Math.max(start, end - 1))) continue;
      rows.push({ key: `event-operation:${op.id}`, title: event.title, calendarId: step.toCalendarId, start, end, pending: true, error: op.error });
    }
    for (const op of deletions.filter((o) => o.status !== "saved")) {
      const known = rows.filter((r) => r.original?.event.uid === op.uid && r.calendarId === op.calendarId || r.recordId === op.recordId && r.segmentUid === op.uid);
      known.forEach((r) => rows.splice(rows.indexOf(r), 1));
      if (date2 < dayKey(op.start) || date2 > dayKey(Math.max(op.start, op.end - 1))) continue;
      rows.push({ key: `delete:${op.id}`, deletionId: op.id, title: op.title, calendarId: op.calendarId, start: op.start, end: op.end, recordId: op.recordId, segmentUid: op.uid, pending: true, deleting: true, error: op.error });
    }
    return rows.sort((a, b) => Number(b.allDay) - Number(a.allDay) || a.start - b.start);
  }

  // Clients/Obsidian/ui.ts
  init_time();

  // Clients/Obsidian/appearance.ts
  var DEFAULT_APPEARANCE = { fontSize: 15, fontWeight: 500 };
  function appearance(value) {
    return {
      fontSize: Number.isFinite(value?.fontSize) ? Math.max(13, Math.min(20, value.fontSize)) : DEFAULT_APPEARANCE.fontSize,
      fontWeight: [400, 500, 600].includes(value?.fontWeight ?? 0) ? value.fontWeight : DEFAULT_APPEARANCE.fontWeight
    };
  }
  function applyAppearance(root, value) {
    const normalized = appearance(value);
    root.style.setProperty("--ctt-font-size", `${normalized.fontSize}px`);
    root.style.setProperty("--ctt-font-weight", String(normalized.fontWeight));
  }
  function mountTimerView(content2) {
    content2.classList.add("ctt-view-host");
    content2.style.padding = "0";
    content2.style.overflow = "hidden";
    const mount = content2.ownerDocument.createElement("div");
    content2.replaceChildren(mount);
    return mount;
  }

  // Clients/Obsidian/dom.ts
  function el(parent, tag, cls = "", text) {
    const node = parent.ownerDocument.createElement(tag);
    node.className = cls;
    if (text != null) node.textContent = text;
    parent.append(node);
    return node;
  }
  function button(parent, text, action, cls = "", label) {
    const b = el(parent, "button", cls, text);
    b.type = "button";
    if (label) {
      b.title = label;
      b.setAttribute("aria-label", label);
    }
    b.onclick = action;
    return b;
  }
  function field(parent, label, type, value) {
    const l = el(parent, "label", "ctt-field");
    el(l, "span", "", label);
    const input = el(l, "input");
    input.type = type;
    input.value = value;
    input.setAttribute("aria-label", label);
    if (type === "datetime-local") input.step = "1";
    return input;
  }
  function options(select, sources, value, placeholder = "\u9009\u62E9\u5206\u7C7B") {
    const signature = JSON.stringify(sources.map((c) => [c.id, c.name]));
    if (select.dataset.options !== signature) {
      select.replaceChildren();
      const empty = el(select, "option", "", placeholder);
      empty.value = "";
      for (const c of sources) {
        const o = el(select, "option", "", c.name);
        o.value = c.id;
      }
      select.dataset.options = signature;
    }
    if (value && !sources.some((c) => c.id === value)) {
      if (!Array.from(select.options).some((o) => o.value === value)) {
        const o = el(select, "option", "", "\u5206\u7C7B\u5DF2\u4E0D\u53EF\u7528");
        o.value = value;
      }
    }
    select.value = value;
  }

  // Clients/Obsidian/categories.ts
  function categoryPreferences(value) {
    const ids = (v) => Array.isArray(v) ? [...new Set(v.filter((id) => typeof id === "string" && !!id))] : [];
    return { categoryOrder: ids(value?.categoryOrder), hiddenCategoryIds: ids(value?.hiddenCategoryIds) };
  }
  function orderedCategories(calendars2, value, visibleOnly = false) {
    const prefs = categoryPreferences(value), positions = new Map(prefs.categoryOrder.map((id, i) => [id, i]));
    return calendars2.filter((c) => !visibleOnly || !prefs.hiddenCategoryIds.includes(c.id)).map((c, i) => ({ c, i })).sort((a, b) => (positions.get(a.c.id) ?? Infinity) - (positions.get(b.c.id) ?? Infinity) || a.i - b.i).map((x) => x.c);
  }
  function renderCategorySettings(root, calendars2, initial2, save) {
    let prefs = categoryPreferences(initial2), busy2 = false, error2 = "";
    root.classList.add("ctt-category-settings");
    const update = async (next, focusId) => {
      if (busy2) return;
      const before = prefs;
      busy2 = true;
      error2 = "";
      prefs = next;
      draw();
      try {
        await save(next);
      } catch (e) {
        prefs = before;
        error2 = e.message;
      } finally {
        busy2 = false;
        draw();
        if (focusId) root.querySelector(`[data-category-index="${orderedCategories(calendars2, prefs).findIndex((c) => c.id === focusId)}"] input`)?.focus();
      }
    };
    const draw = () => {
      root.replaceChildren();
      el(root, "p", "ctt-muted", "\u6392\u5E8F\u548C\u9690\u85CF\u4EC5\u5F71\u54CD\u5F85\u529E\u7B5B\u9009\u680F\u3002\u201C\u5168\u90E8\u201D\u4ECD\u5305\u542B\u6240\u6709\u5F85\u529E\u3002");
      const list = el(root, "div", "ctt-category-setting-list");
      const categories2 = orderedCategories(calendars2, prefs);
      if (!categories2.length) el(list, "p", "ctt-muted", "\u8FDE\u63A5\u65E5\u5386\u540E\u53EF\u8BBE\u7F6E\u5206\u7C7B\u3002");
      categories2.forEach((c, index) => {
        const row = el(list, "div", "ctt-category-setting");
        row.dataset.categoryIndex = String(index);
        const label = el(row, "label", "ctt-category-visibility"), checkbox = el(label, "input");
        checkbox.type = "checkbox";
        checkbox.checked = !prefs.hiddenCategoryIds.includes(c.id);
        checkbox.disabled = busy2;
        checkbox.setAttribute("aria-label", `\u663E\u793A\u5206\u7C7B ${c.name}`);
        const dot = el(label, "span", "ctt-category-dot");
        dot.style.background = c.color || "var(--interactive-accent)";
        dot.setAttribute("aria-hidden", "true");
        el(label, "span", "", c.name);
        checkbox.onchange = () => {
          void update({ ...prefs, hiddenCategoryIds: checkbox.checked ? prefs.hiddenCategoryIds.filter((id) => id !== c.id) : [...prefs.hiddenCategoryIds, c.id] }, c.id);
        };
        const move = (offset) => {
          const order = categories2.map((c2) => c2.id), other = index + offset;
          [order[index], order[other]] = [order[other], order[index]];
          void update({ ...prefs, categoryOrder: [...order, ...prefs.categoryOrder.filter((id) => !order.includes(id))] }, c.id);
        };
        const up = button(row, "\u2191", () => move(-1), "ctt-category-move", `\u4E0A\u79FB ${c.name}`);
        up.disabled = busy2 || index === 0;
        const down = button(row, "\u2193", () => move(1), "ctt-category-move", `\u4E0B\u79FB ${c.name}`);
        down.disabled = busy2 || index === categories2.length - 1;
      });
      const message = el(root, "div", "ctt-dialog-error", error2);
      message.setAttribute("role", "alert");
      const reset = button(root, "\u6062\u590D\u9ED8\u8BA4\u6392\u5E8F\u4E0E\u663E\u793A", () => {
        void update({ categoryOrder: [], hiddenCategoryIds: [] });
      }, "ctt-quiet");
      reset.disabled = busy2;
    };
    draw();
  }

  // Clients/Obsidian/taskOrder.ts
  var TASK_SORT_LABELS = { manual: "\u624B\u52A8\u6392\u5E8F", due: "\u6309\u65E5\u671F", title: "\u6309\u6807\u9898" };
  function taskSort(value) {
    return value === "due" || value === "title" ? value : "manual";
  }
  function sortedTasks(tasks2, mode = "manual") {
    return tasks2.map((task, index) => ({ task, index })).sort((a, b) => {
      const cmp = mode === "due" ? (a.task.due || "9999").localeCompare(b.task.due || "9999") : mode === "title" ? a.task.title.localeCompare(b.task.title, "zh-CN", { numeric: true }) : 0;
      return cmp || a.index - b.index;
    }).map((x) => x.task);
  }
  function reorderTaskSlots(tasks2, nextIds, expectedIds) {
    const selected = new Set(expectedIds);
    if (!expectedIds.length || selected.size !== expectedIds.length || new Set(nextIds).size !== nextIds.length || nextIds.length !== expectedIds.length || nextIds.some((id) => !selected.has(id))) throw new Error("\u6392\u5E8F\u5217\u8868\u65E0\u6548\u3002");
    const current = tasks2.filter((t) => selected.has(t.id));
    if (current.length !== expectedIds.length || current.some((t, i2) => t.completed || t.id !== expectedIds[i2])) throw new Error("\u5F85\u529E\u987A\u5E8F\u6216\u5B8C\u6210\u72B6\u6001\u5DF2\u53D8\u5316\uFF0C\u8BF7\u5237\u65B0\u540E\u91CD\u8BD5\u3002");
    const byId = new Map(current.map((t) => [t.id, t]));
    let i = 0;
    return tasks2.map((t) => selected.has(t.id) ? byId.get(nextIds[i++]) : t);
  }

  // Clients/Obsidian/ui.ts
  var TimerUI = class {
    constructor(root, actions2) {
      this.root = root;
      this.actions = actions2;
      root.classList.add("ctt-shell");
      root.replaceChildren();
      this.header = el(root, "header", "ctt-header");
      el(this.header, "div", "ctt-brand", "\u65E5\u5386\u4E0E\u5F85\u529E");
      const tools = el(this.header, "nav", "ctt-tools");
      tools.setAttribute("aria-label", "\u65E5\u5386\u5DE5\u5177");
      this.connect = button(tools, "\u8FDE\u63A5\u65E5\u5386", actions2.connect, "ctt-primary");
      this.syncMenu = el(tools, "details", "ctt-sync-menu");
      this.syncMenu.hidden = true;
      this.syncSummary = el(this.syncMenu, "summary", "ctt-sync-summary");
      this.syncSummary.setAttribute("aria-label", "\u540C\u6B65\u72B6\u6001");
      const syncPanel = el(this.syncMenu, "div", "ctt-sync-panel");
      el(syncPanel, "strong", "", "\u540C\u6B65\u961F\u5217");
      this.syncError = el(syncPanel, "div", "ctt-dialog-error");
      this.syncError.setAttribute("role", "alert");
      this.pending = el(syncPanel, "div", "ctt-pending");
      root.ownerDocument.addEventListener("pointerdown", this.closeSync);
      root.ownerDocument.addEventListener("keydown", this.escapeSync);
      button(tools, "\u21BB", actions2.refresh, "ctt-icon", "\u5237\u65B0");
      button(tools, "\u5B8C\u6574\u65E5\u5386", actions2.openCalendar, "ctt-quiet");
      button(tools, "\u2699", actions2.settings, "ctt-icon", "\u8BBE\u7F6E");
      tools.append(this.syncMenu);
      this.error = el(root, "div", "ctt-error");
      this.error.setAttribute("role", "alert");
      this.error.hidden = true;
      this.timer = el(root, "section", "ctt-timer");
      this.timer.setAttribute("aria-label", "\u5F53\u524D\u8BA1\u65F6");
      this.status = el(this.timer, "div", "ctt-status");
      this.title = el(this.timer, "h2", "ctt-current-title");
      const dial = el(this.timer, "div", "ctt-clock");
      el(dial, "div", "ctt-clock-track");
      this.hand = el(dial, "div", "ctt-clock-hand");
      this.readout = el(dial, "div", "ctt-readout", "00:00");
      this.readout.setAttribute("aria-label", "\u7D2F\u8BA1\u4E13\u6CE8\u65F6\u95F4");
      el(this.timer, "div", "ctt-idle-label", "\u5F00\u59CB\u4E00\u4E2A\u4EFB\u52A1\u5427");
      const details = el(this.timer, "div", "ctt-session-details");
      this.started = button(details, "", actions2.editStart, "ctt-quiet", "\u4FEE\u6539\u5F00\u59CB\u65F6\u95F4");
      this.category = el(details, "select", "ctt-category");
      this.category.setAttribute("aria-label", "\u672C\u6B21\u8BA1\u65F6\u5206\u7C7B");
      this.category.onchange = () => actions2.category(this.category.value);
      this.controls = el(this.timer, "div", "ctt-timer-controls");
      this.pause = button(this.controls, "\u6682\u505C", () => this.model.active?.runningSince == null ? actions2.resume() : actions2.pause());
      button(this.controls, "\u7ED3\u675F\u5E76\u5B8C\u6210", () => actions2.finish(true), "ctt-primary");
      button(this.controls, "\u53EA\u8BB0\u65F6\u95F4", () => actions2.finish(false), "ctt-quiet");
      const body = el(root, "div", "ctt-body");
      const timeline = el(body, "section", "ctt-panel ctt-timeline");
      const top = el(timeline, "div", "ctt-panel-heading");
      el(top, "h3", "", "\u65F6\u95F4\u8F74");
      const timelineTools = el(top, "div", "ctt-timeline-tools");
      const nav = el(timelineTools, "div", "ctt-date-nav");
      button(nav, "\u2039", () => actions2.date(shiftDate(this.model.date, -1)), "ctt-icon", "\u524D\u4E00\u5929");
      this.dateInput = el(nav, "input");
      this.dateInput.type = "date";
      this.dateInput.setAttribute("aria-label", "\u65F6\u95F4\u8F74\u65E5\u671F");
      this.dateInput.onchange = () => {
        if (this.dateInput.value) actions2.date(this.dateInput.value);
      };
      button(nav, "\u4ECA\u5929", () => actions2.date(dayKey()), "ctt-quiet");
      button(nav, "\u203A", () => actions2.date(shiftDate(this.model.date, 1)), "ctt-icon", "\u540E\u4E00\u5929");
      button(timelineTools, "+", actions2.newEvent, "ctt-icon", "\u65B0\u589E\u65E5\u7A0B");
      this.rowList = el(timeline, "div", "ctt-timeline-list");
      this.rowList.setAttribute("aria-label", "\u5F53\u5929\u65E5\u7A0B\u4E0E\u5DE5\u65F6");
      const tasks2 = el(body, "section", "ctt-panel ctt-tasks");
      const taskHead = el(tasks2, "div", "ctt-panel-heading");
      el(taskHead, "h3", "", "\u5F85\u529E");
      const taskTools = el(taskHead, "div", "ctt-task-tools");
      this.taskSort = el(taskTools, "select", "ctt-task-sort");
      this.taskSort.setAttribute("aria-label", "\u5F85\u529E\u6392\u5E8F");
      for (const [value, text] of Object.entries(TASK_SORT_LABELS)) el(this.taskSort, "option", "", text).value = value;
      this.taskSort.onchange = () => {
        void actions2.sortTasks(taskSort(this.taskSort.value));
      };
      button(taskTools, "\u21C5", actions2.categorySettings, "ctt-icon", "\u5206\u7C7B\u6392\u5E8F\u4E0E\u663E\u793A");
      this.sortNotice = el(tasks2, "div", "ctt-sort-notice");
      this.sortNotice.setAttribute("role", "status");
      this.sortNotice.setAttribute("aria-live", "polite");
      this.tabs = el(tasks2, "div", "ctt-tabs");
      this.tabs.setAttribute("aria-label", "\u5F85\u529E\u5206\u7C7B\u7B5B\u9009");
      const taskScroll = el(tasks2, "div", "ctt-task-scroll");
      taskScroll.setAttribute("aria-label", "\u5F85\u529E\u5185\u5BB9");
      const form = el(taskScroll, "form", "ctt-inbox");
      this.taskTitle = el(form, "input", "ctt-new-title");
      this.taskTitle.placeholder = "\u6DFB\u52A0\u4E00\u4EF6\u8981\u505A\u7684\u4E8B\u2026";
      this.taskTitle.setAttribute("aria-label", "\u65B0\u5F85\u529E\u540D\u79F0");
      this.taskTitle.required = true;
      const addTools = el(form, "div", "ctt-inbox-tools");
      this.newCategory = el(addTools, "select");
      this.newCategory.setAttribute("aria-label", "\u65B0\u5F85\u529E\u5206\u7C7B");
      this.newCategory.required = true;
      const dateLabel = el(addTools, "div", "ctt-optional-date");
      const dateToggle = button(dateLabel, "+ \u65E5\u671F", () => {
        this.due.hidden = !this.due.hidden;
        if (!this.due.hidden) {
          this.due.focus();
          try {
            this.due.showPicker();
          } catch {
          }
        }
      }, "ctt-quiet", "\u8BBE\u7F6E\u5F85\u529E\u65E5\u671F");
      this.due = el(dateLabel, "input");
      this.due.type = "date";
      this.due.hidden = true;
      this.due.setAttribute("aria-label", "\u5F85\u529E\u65E5\u671F\uFF0C\u53EF\u7559\u7A7A");
      this.due.onchange = () => {
        dateToggle.hidden = !!this.due.value;
        if (!this.due.value) this.due.hidden = true;
      };
      const add = el(addTools, "button", "ctt-primary", "\u6DFB\u52A0");
      add.type = "submit";
      form.onsubmit = async (e) => {
        e.preventDefault();
        if (await actions2.add(this.taskTitle.value, this.due.value, this.newCategory.value)) {
          this.taskTitle.value = "";
          this.due.value = "";
          this.due.hidden = true;
          dateToggle.hidden = false;
          this.taskTitle.focus();
        }
      };
      this.taskList = el(taskScroll, "div", "ctt-task-list");
      this.taskList.setAttribute("aria-label", "\u672A\u5B8C\u6210\u5F85\u529E");
      this.observer = new ResizeObserver((entries2) => {
        const { width, height } = entries2[0].contentRect;
        root.classList.toggle("ctt-stacked", width < 840 || width / Math.max(1, height) < 1.15);
        root.style.setProperty("--ctt-focus-height", `${Math.max(380, Math.min(660, height * 0.62, height - 330))}px`);
        this.scheduleDensity();
      });
      this.observer.observe(root);
      this.densityObserver = new ResizeObserver(() => this.scheduleDensity());
      this.densityObserver.observe(this.rowList);
    }
    root;
    actions;
    model;
    filter = "";
    observer;
    densityObserver;
    densityFrame = 0;
    header;
    connect;
    error;
    timer;
    title;
    status;
    readout;
    hand;
    category;
    started;
    controls;
    pause;
    taskTitle;
    due;
    newCategory;
    tabs;
    taskList;
    rowList;
    dateInput;
    pending;
    syncMenu;
    syncSummary;
    syncError;
    pendingNodes = /* @__PURE__ */ new Map();
    closeSync = (e) => {
      if (this.syncMenu.open && !this.syncMenu.contains(e.target)) this.syncMenu.open = false;
    };
    escapeSync = (e) => {
      if (e.key === "Escape" && this.syncMenu.open) {
        this.syncMenu.open = false;
        this.syncSummary.focus();
        e.preventDefault();
      }
    };
    taskSort;
    sortNotice;
    dragged;
    taskNodes = /* @__PURE__ */ new Map();
    rowNodes = /* @__PURE__ */ new Map();
    update(m) {
      const old = this.model;
      this.model = m;
      applyAppearance(this.root, m.appearance);
      this.root.classList.toggle("ctt-active", !!m.active);
      this.root.classList.toggle("ctt-paused", !!m.active && m.active.runningSince == null);
      this.root.setAttribute("aria-busy", String(m.busy));
      this.connect.hidden = m.connected;
      this.taskSort.value = taskSort(m.taskSort);
      this.taskSort.disabled = m.busy;
      this.error.textContent = m.error;
      this.error.hidden = !m.error;
      this.title.textContent = m.active?.title || "";
      this.status.textContent = m.active ? m.active.runningSince == null ? "\u5DF2\u6682\u505C" : "\u4E13\u6CE8\u4E2D" : "";
      this.pause.textContent = m.active?.runningSince == null ? "\u7EE7\u7EED" : "\u6682\u505C";
      this.started.textContent = m.active ? `\u5F00\u59CB\u4E8E ${dateParts(m.active.startedAt).date.slice(5)} ${dateParts(m.active.startedAt).time.slice(0, 5)}` : "";
      options(this.category, m.calendars, m.active?.calendarId || "");
      const draft = this.newCategory.value;
      options(this.newCategory, m.calendars, !old || !draft || old.defaultCalendarId !== m.defaultCalendarId && !this.taskTitle.value ? m.defaultCalendarId : draft);
      if (this.root.ownerDocument.activeElement !== this.dateInput) this.dateInput.value = m.date;
      if (JSON.stringify(old?.calendars) !== JSON.stringify(m.calendars) || JSON.stringify(old?.categoryPreferences) !== JSON.stringify(m.categoryPreferences)) this.renderTabs();
      this.renderTasks();
      this.renderRows();
      this.syncMenu.hidden = !m.pending.length && !m.sync?.error;
      this.syncSummary.textContent = `${m.sync?.activeKey ? "\u21BB" : m.pending.some((p) => p.error) || m.sync?.error ? "!" : "\u2191"} ${m.pending.length}`;
      this.syncSummary.setAttribute("aria-label", `\u540C\u6B65\u72B6\u6001\uFF08${m.pending.length} \u6761\u5F85\u540C\u6B65\uFF09`);
      this.syncSummary.title = this.syncSummary.getAttribute("aria-label");
      this.syncError.textContent = m.sync?.error ? `\u540C\u6B65\u6682\u505C\uFF1A${m.sync.error}` : "";
      this.syncError.hidden = !m.sync?.error;
      const pendingIds = new Set(m.pending.map((p) => p.id));
      for (const [id, node] of this.pendingNodes) if (!pendingIds.has(id)) {
        node.root.remove();
        this.pendingNodes.delete(id);
      }
      for (const p of m.pending) {
        let node = this.pendingNodes.get(p.id);
        if (!node) {
          const row = el(this.pending, "div", "ctt-pending-row"), text = el(row, "div");
          const title = el(text, "strong"), status = el(text, "div", "ctt-muted"), error2 = el(text, "div", "ctt-muted");
          const buttons = el(row, "div", "ctt-sync-actions");
          const retry = button(buttons, "\u91CD\u8BD5", () => this.actions.retry(p.id));
          const keep = button(buttons, "\u4EC5\u4FDD\u7559\u65E5\u7A0B", () => this.actions.keep(p.id));
          const cleanup = button(buttons, "\u6E05\u7406\u672C\u5730\u6B8B\u7559", () => this.actions.resolveDeletion(p.id.slice(7)));
          node = { root: row, title, status, error: error2, retry, keep, cleanup };
          this.pendingNodes.set(p.id, node);
        }
        node.title.textContent = p.title;
        node.status.textContent = p.status || "\u672C\u673A\u5DF2\u4FDD\u5B58\uFF0C\u7B49\u5F85\u540C\u6B65";
        node.error.textContent = p.error;
        node.keep.hidden = !p.canKeep;
        node.cleanup.hidden = !p.canResolveMissing;
        node.retry.disabled = node.keep.disabled = node.cleanup.disabled = !!p.working || m.busy || !m.connected;
      }
      for (const b of this.controls.querySelectorAll("button")) b.disabled = m.busy;
      this.category.disabled = m.busy;
      this.started.disabled = m.busy;
      this.tick();
    }
    renderTabs() {
      const sources = orderedCategories(this.model.calendars, this.model.categoryPreferences, true);
      if (this.filter && !sources.some((c) => c.id === this.filter)) this.filter = "";
      this.tabs.replaceChildren();
      for (const c of [{ id: "", name: "\u5168\u90E8" }, ...sources]) {
        const b = button(this.tabs, c.name, () => {
          this.filter = c.id;
          this.renderTabs();
          this.renderTasks();
        }, "ctt-tab");
        b.classList.toggle("is-selected", c.id === this.filter);
        b.setAttribute("aria-pressed", String(c.id === this.filter));
      }
    }
    renderTasks() {
      const m = this.model, manual = taskSort(m.taskSort) === "manual", tasks2 = sortedTasks(m.tasks.filter((t) => !t.completed && (!this.filter || (t.calendarId || m.defaultCalendarId) === this.filter)), taskSort(m.taskSort));
      const ids = tasks2.map((t) => t.id);
      const visibleIds = new Set(ids);
      for (const [id, item] of this.taskNodes) if (!visibleIds.has(id)) {
        item.root.remove();
        this.taskNodes.delete(id);
      }
      this.taskList.querySelector(".ctt-empty")?.remove();
      if (!tasks2.length) el(this.taskList, "div", "ctt-empty", "\u6682\u65E0\u5F85\u529E");
      tasks2.forEach((task, i) => {
        let item = this.taskNodes.get(task.id);
        if (!item) {
          const root = el(this.taskList, "div", "ctt-task-row"), handle = button(root, "\u283F", () => {
          }, "ctt-drag-handle"), check = el(root, "input");
          check.type = "checkbox";
          const body = el(root, "div", "ctt-task-text"), text = button(body, "", () => {
          }, "ctt-task-title"), meta = el(body, "div", "ctt-task-meta");
          const start = button(root, "\u25B7", () => {
          }, "ctt-start", "\u5F00\u59CB\u8BA1\u65F6");
          item = { root, handle, check, text, meta, start };
          this.taskNodes.set(task.id, item);
        }
        item.root.dataset.taskId = task.id;
        item.handle.hidden = !manual;
        item.handle.disabled = m.busy;
        item.handle.draggable = manual && !m.busy;
        item.handle.setAttribute("aria-label", `\u6392\u5E8F ${task.title}`);
        item.handle.title = "\u62D6\u52A8\u6392\u5E8F\uFF1BAlt + \u2191 / \u2193 \u8C03\u6574\u987A\u5E8F";
        item.handle.onkeydown = (e) => {
          if (!manual || m.busy || !e.altKey || !["ArrowUp", "ArrowDown"].includes(e.key)) return;
          e.preventDefault();
          const to = i + (e.key === "ArrowUp" ? -1 : 1);
          if (to < 0 || to >= ids.length) return;
          const next = [...ids];
          [next[i], next[to]] = [next[to], next[i]];
          void this.saveOrder(next, ids, task.id);
        };
        item.handle.ondragstart = (e) => {
          if (!manual || m.busy || !e.dataTransfer) {
            e.preventDefault();
            return;
          }
          this.dragged = { id: task.id, ids: [...ids] };
          e.dataTransfer.effectAllowed = "move";
          e.dataTransfer.setData("text/plain", task.id);
          item.root.classList.add("is-dragging");
        };
        item.handle.ondragend = () => this.clearDrag();
        item.root.ondragover = (e) => {
          if (!this.dragged || !manual || m.busy) return;
          e.preventDefault();
          this.taskList.querySelectorAll(".is-drop-before,.is-drop-after").forEach((n) => n.classList.remove("is-drop-before", "is-drop-after"));
          item.root.classList.add(e.clientY > item.root.getBoundingClientRect().top + item.root.clientHeight / 2 ? "is-drop-after" : "is-drop-before");
        };
        item.root.ondrop = (e) => {
          if (!this.dragged || !manual || m.busy) return;
          e.preventDefault();
          const source = this.dragged, next = source.ids.filter((id) => id !== source.id), after = e.clientY > item.root.getBoundingClientRect().top + item.root.clientHeight / 2;
          this.clearDrag();
          if (source.id === task.id || !next.includes(task.id)) return;
          next.splice(next.indexOf(task.id) + Number(after), 0, source.id);
          void this.saveOrder(next, source.ids);
        };
        const categoryId = task.calendarId || m.defaultCalendarId, category = m.sources.find((c) => c.id === categoryId);
        item.text.textContent = task.title;
        item.text.onclick = () => this.actions.editTask(task);
        item.check.setAttribute("aria-label", `\u5B8C\u6210 ${task.title}`);
        item.check.checked = false;
        item.check.disabled = m.busy || m.active?.task.id === task.id;
        item.check.onchange = () => this.actions.complete(task);
        item.meta.textContent = [category?.name || "\u9009\u62E9\u5206\u7C7B", task.due].filter(Boolean).join(" \xB7 ");
        item.meta.style.setProperty("--ctt-category-color", category?.color || "var(--interactive-accent)");
        item.start.onclick = () => this.actions.start(task);
        item.start.disabled = m.busy || !!m.active || !m.connected || !m.calendars.some((c) => c.id === categoryId);
        if (this.taskList.children[i] !== item.root) this.taskList.insertBefore(item.root, this.taskList.children[i] || null);
      });
    }
    clearDrag() {
      this.dragged = void 0;
      this.taskList.querySelectorAll(".is-dragging,.is-drop-before,.is-drop-after").forEach((n) => n.classList.remove("is-dragging", "is-drop-before", "is-drop-after"));
    }
    async saveOrder(next, expected, focusId) {
      if (JSON.stringify(next) === JSON.stringify(expected)) return;
      const ok = await this.actions.reorderTasks(next, expected);
      this.sortNotice.textContent = ok ? "\u987A\u5E8F\u5DF2\u4FDD\u5B58" : "\u6392\u5E8F\u672A\u4FDD\u5B58\uFF0C\u8BF7\u91CD\u8BD5";
      if (focusId) this.taskNodes.get(focusId)?.handle.focus();
    }
    renderRows() {
      const m = this.model;
      const keys = new Set(m.rows.map((r) => r.key));
      for (const [key2, item] of this.rowNodes) if (!keys.has(key2)) {
        item.root.remove();
        this.rowNodes.delete(key2);
      }
      this.rowList.querySelector(".ctt-empty")?.remove();
      if (!m.rows.length) el(this.rowList, "div", "ctt-empty", m.connected ? "\u5F53\u5929\u6682\u65E0\u65E5\u7A0B" : "\u8FDE\u63A5\u65E5\u5386\u540E\u67E5\u770B\u65E5\u7A0B");
      m.rows.forEach((row, i) => {
        let item = this.rowNodes.get(row.key);
        if (!item) {
          const root = button(this.rowList, "", () => {
          }, "ctt-event"), time = el(root, "span", "ctt-event-time");
          const start = el(time, "span", "ctt-event-start"), link = el(time, "span", "ctt-event-time-link"), end = el(time, "span", "ctt-event-end");
          link.setAttribute("aria-hidden", "true");
          const body = el(root, "span", "ctt-event-body"), title = el(body, "span", "ctt-event-title"), meta = el(body, "span", "ctt-event-meta");
          item = { root, start, end, link, title, meta };
          this.rowNodes.set(row.key, item);
        }
        const startDate = dayKey(row.start), endDate = dayKey(Math.max(row.start, row.end - 1));
        item.start.textContent = row.allDay ? "\u5168\u5929" : m.date > startDate ? "00:00" : dateParts(row.start).time.slice(0, 5);
        item.end.textContent = row.allDay ? "" : m.date < endDate ? "24:00" : dateParts(row.end).time.slice(0, 5);
        item.end.hidden = item.link.hidden = !!row.allDay;
        item.title.textContent = row.title;
        item.meta.textContent = `${m.sources.find((c) => c.id === row.calendarId)?.name || "\u65E5\u5386"}${row.recordId ? " \xB7 \u8BA1\u65F6" : ""}${row.deleting ? " \xB7 \u5F85\u5220\u9664" : row.pending ? " \xB7 \u5F85\u540C\u6B65" : ""}`;
        item.root.style.setProperty("--ctt-category-color", row.color || m.sources.find((c) => c.id === row.calendarId)?.color || "var(--interactive-accent)");
        item.root.classList.toggle("is-pending", !!row.pending);
        item.root.title = row.error || "\u7F16\u8F91\u65E5\u7A0B";
        item.root.onclick = () => this.actions.editRow(row);
        if (this.rowList.children[i] !== item.root) this.rowList.insertBefore(item.root, this.rowList.children[i] || null);
      });
      this.scheduleDensity();
    }
    scheduleDensity() {
      if (this.densityFrame) return;
      this.densityFrame = requestAnimationFrame(() => {
        this.densityFrame = 0;
        const list = this.rowList;
        if (!list.clientWidth || !list.clientHeight) return;
        const style = getComputedStyle(list), wasCompact = list.classList.contains("is-compact");
        const cards = [...this.rowNodes.values()].map((item) => item.root);
        const natural = cards.reduce((height, card) => height + Math.max(85, card.offsetHeight + (wasCompact ? 10 : 0)), 0) + Math.max(0, cards.length - 1) * 14 + parseFloat(style.paddingTop) + parseFloat(style.paddingBottom);
        list.classList.toggle("is-compact", cards.length > 0 && ["auto", "scroll"].includes(style.overflowY) && natural > list.clientHeight + 2);
      });
    }
    tick() {
      const ms = elapsed(this.model?.active || null);
      this.readout.textContent = this.model?.active ? secondsText(ms) : "00:00";
      this.hand.style.transform = `rotate(${ms / 6e4 * 360}deg)`;
    }
    destroy() {
      this.observer.disconnect();
      this.densityObserver.disconnect();
      if (this.densityFrame) cancelAnimationFrame(this.densityFrame);
      this.root.ownerDocument.removeEventListener("pointerdown", this.closeSync);
      this.root.ownerDocument.removeEventListener("keydown", this.escapeSync);
      this.root.replaceChildren();
    }
  };

  // Clients/Obsidian/dialogs.ts
  init_time();
  var Dialogs = class {
    constructor(host2, controller2, bridge2, calendars2, defaultCategory, changed, retryDeletion) {
      this.host = host2;
      this.controller = controller2;
      this.bridge = bridge2;
      this.calendars = calendars2;
      this.defaultCategory = defaultCategory;
      this.changed = changed;
      this.retryDeletion = retryDeletion;
    }
    host;
    controller;
    bridge;
    calendars;
    defaultCategory;
    changed;
    retryDeletion;
    form(title, render2) {
      this.host.open(title, (root, close) => {
        root.classList.add("ctt-dialog");
        const form = el(root, "form", "ctt-dialog");
        const result = render2(form);
        const actions2 = typeof result === "function" ? { save: result } : result;
        const message = el(form, "div", "ctt-dialog-error");
        message.setAttribute("role", "alert");
        const confirm = el(form, "div", "ctt-delete-confirm");
        confirm.hidden = true;
        const controls = el(form, "div", "ctt-dialog-controls");
        if (actions2.remove) {
          el(confirm, "p", "", actions2.remove.message);
          const confirmation = el(confirm, "div", "ctt-dialog-controls");
          const cancel = button(confirmation, "\u53D6\u6D88\u5220\u9664", () => {
            confirm.hidden = true;
            save.disabled = false;
            remove.focus();
          });
          const remove = button(controls, actions2.remove.label, () => {
            confirm.hidden = false;
            save.disabled = true;
            confirmDelete.focus();
          }, "ctt-danger");
          const confirmDelete = button(confirmation, "\u786E\u8BA4\u5220\u9664", () => {
            void (async () => {
              confirmDelete.disabled = cancel.disabled = remove.disabled = true;
              message.textContent = "";
              try {
                await actions2.remove.run();
                await this.changed();
                close();
              } catch (e) {
                message.textContent = e.message;
                confirmDelete.disabled = cancel.disabled = remove.disabled = false;
              }
            })();
          }, "ctt-danger");
        }
        button(controls, "\u53D6\u6D88", close);
        const save = el(controls, "button", "ctt-primary", "\u4FDD\u5B58");
        save.type = "submit";
        form.onsubmit = async (e) => {
          e.preventDefault();
          if (save.disabled) return;
          save.disabled = true;
          message.textContent = "";
          for (const b of controls.querySelectorAll("button")) b.disabled = true;
          try {
            await actions2.save();
            await this.changed();
            close();
          } catch (e2) {
            message.textContent = e2.message;
            for (const b of controls.querySelectorAll("button")) b.disabled = false;
          }
        };
      });
    }
    category(form, value) {
      const label = el(form, "label", "ctt-field");
      el(label, "span", "", "\u5206\u7C7B");
      const select = el(label, "select");
      options(select, this.calendars(), value);
      select.required = true;
      select.setAttribute("aria-label", "\u5206\u7C7B");
      return select;
    }
    deletion(id) {
      const op = this.controller.state.deletions?.find((o) => o.id === id);
      if (!op || op.status === "saved") return;
      this.host.open("\u5904\u7406\u5F85\u5220\u9664\u8BB0\u5F55", (root, close) => {
        root.classList.add("ctt-dialog");
        el(root, "strong", "", op.title);
        const message = el(root, "p", "ctt-dialog-error", op.error || "\u5220\u9664\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\u3002");
        message.setAttribute("role", "alert");
        const confirm = el(root, "div", "ctt-delete-confirm");
        confirm.hidden = true;
        el(confirm, "p", "", `\u786E\u8BA4\u4F60\u5DF2\u5728\u8FDC\u7AEF\u5220\u9664\u201C${op.title}\u201D\uFF1F\u8FD9\u4F1A\u6E05\u7406\u8BE5\u6761\u672C\u5730\u6B8B\u7559\u548C\u5F85\u5220\u9664\u72B6\u6001\uFF0C\u4FDD\u7559\u5176\u4ED6\u8BA1\u65F6\u5206\u6BB5\u53CA\u539F\u5F85\u529E\uFF1B\u4E0D\u5411\u65E5\u5386\u53D1\u9001\u65B0\u589E\u6216\u5220\u9664\u8BF7\u6C42\u3002`);
        const confirmation = el(confirm, "div", "ctt-dialog-controls");
        const controls = el(root, "div", "ctt-deletion-actions");
        const run2 = async (action) => {
          for (const b of root.querySelectorAll("button")) b.disabled = true;
          try {
            await action();
            await this.changed();
            const current = this.controller.state.deletions?.find((o) => o.id === id);
            if (!current || current.status === "saved") {
              this.host.notice("\u672C\u5730\u5220\u9664\u72B6\u6001\u5DF2\u6E05\u7406");
              close();
              return;
            }
            message.textContent = current.error || "\u5220\u9664\u7ED3\u679C\u5C1A\u672A\u786E\u8BA4\u3002";
            cleanup.hidden = !isMissingResource(current.error);
          } catch (e) {
            message.textContent = e.message;
          }
          for (const b of root.querySelectorAll("button")) b.disabled = false;
          retry.disabled = !confirm.hidden;
        };
        const retry = button(controls, "\u91CD\u8BD5\u5220\u9664", () => {
          void run2(() => this.retryDeletion ? this.retryDeletion(id) : this.controller.retryDeletion(id));
        });
        const cleanup = button(controls, "\u5DF2\u5728\u8FDC\u7AEF\u5220\u9664\uFF0C\u6E05\u7406\u672C\u5730\u6B8B\u7559", () => {
          confirm.hidden = false;
          retry.disabled = true;
          confirmCleanup.focus();
        });
        cleanup.hidden = !isMissingResource(op.error);
        button(confirmation, "\u53D6\u6D88", () => {
          confirm.hidden = true;
          retry.disabled = false;
          cleanup.focus();
        });
        const confirmCleanup = button(confirmation, "\u786E\u8BA4\u6E05\u7406", () => {
          void run2(() => this.controller.confirmRemoteDeletion(id));
        }, "ctt-danger");
        button(controls, "\u5173\u95ED", close);
      });
    }
    task(task, save) {
      const expected = clone(task);
      this.form("\u7F16\u8F91\u5F85\u529E", (form) => {
        const title = field(form, "\u6807\u9898", "text", expected.title);
        title.required = true;
        const category = this.category(form, expected.calendarId || this.defaultCategory());
        const due = field(form, "\u65E5\u671F", "date", expected.due || "");
        return async () => {
          this.bridge.assertWritable(category.value);
          await save({ title: title.value, calendarId: category.value, due: due.value });
        };
      });
    }
    start() {
      const active = this.controller.state.active;
      if (!active) return;
      this.form("\u4FEE\u6539\u5F00\u59CB\u65F6\u95F4", (form) => {
        const start = field(form, "\u5F00\u59CB\u65F6\u95F4", "datetime-local", localInput(active.startedAt));
        start.required = true;
        return () => this.controller.updateActive({ startedAt: parseLocal(start.value) }, active.id);
      });
    }
    record(record, selectedUid) {
      if (record.status !== "saved" || record.edit || this.controller.state.deletions?.some((o) => o.recordId === record.id && o.status !== "saved")) {
        this.host.notice(record.error || "\u8BF7\u5148\u5728\u5F85\u540C\u6B65\u4E2D\u91CD\u8BD5\u3002");
        return;
      }
      if (!record.segments.length) {
        this.host.notice("\u6B64\u8BA1\u65F6\u8BB0\u5F55\u5DF2\u5220\u9664\u3002");
        return;
      }
      const expected = clone(record);
      const selected = Math.max(0, expected.segments.findIndex((p) => p.uid === selectedUid));
      const originals = expected.segments.map((p) => this.bridge.find(expected.calendarId, p.uid));
      if (originals.some((x) => !x)) {
        this.host.notice("\u90E8\u5206\u65E5\u5386\u8BB0\u5F55\u5DF2\u5220\u9664\u6216\u79FB\u8D70\uFF0C\u8BF7\u5728\u5B8C\u6574\u65E5\u5386\u4E2D\u6838\u5BF9\u3002");
        return;
      }
      const query = this.bridge.api().getEvents({}, []);
      const ranges = originals.map((o, i) => {
        const q = query.find((q2) => q2.id === o.id);
        return { start: q?.startMillis ?? expected.segments[i].start, end: q?.endMillis ?? expected.segments[i].end };
      });
      this.form("\u7F16\u8F91\u8BA1\u65F6\u8BB0\u5F55", (form) => {
        const title = field(form, "\u6807\u9898", "text", originals[0].event.title);
        title.required = true;
        const category = this.category(form, expected.calendarId);
        const segments = ranges.map((p, i) => {
          const box = el(form, "div", "ctt-segment");
          if (ranges.length > 1) el(box, "div", "ctt-segment-label", `\u65F6\u6BB5 ${i + 1}`);
          box.classList.toggle("is-selected", ranges.length > 1 && i === selected);
          const start = field(box, "\u5F00\u59CB\u65F6\u95F4", "datetime-local", localInput(p.start)), end = field(box, "\u7ED3\u675F\u65F6\u95F4", "datetime-local", localInput(p.end));
          start.required = end.required = true;
          return { start, end };
        });
        const save = async () => {
          const result = await this.controller.editRecord(record.id, {
            title: title.value,
            calendarId: category.value,
            segments: segments.map((p) => ({ start: parseLocal(p.start.value), end: parseLocal(p.end.value) })),
            snapshots: originals.map((o) => clone(o.event))
          }, expected);
          this.host.notice(result.status === "saved" ? "\u8BA1\u65F6\u8BB0\u5F55\u5DF2\u66F4\u65B0" : "\u4FEE\u6539\u5DF2\u4FDD\u5B58\u5230\u672C\u673A\uFF0C\u7B49\u5F85\u540C\u6B65");
        };
        const original = originals[selected], range = ranges[selected];
        return { save, remove: this.bridge.canDelete(original) ? {
          label: ranges.length > 1 ? "\u5220\u9664\u6B64\u65F6\u6BB5" : "\u5220\u9664\u8BB0\u5F55",
          message: `\u5220\u9664\u201C${original.event.title}\u201D\uFF08${localInput(range.start).replace("T", " ")} \u2014 ${localInput(range.end).replace("T", " ")}\uFF09\uFF1F${ranges.length > 1 ? "\u5176\u4ED6\u8BA1\u65F6\u5206\u6BB5\u4FDD\u7559\u3002" : ""}\u539F\u5F85\u529E\u53CA\u5176\u5B8C\u6210\u72B6\u6001\u4FDD\u7559\u3002`,
          run: async () => {
            const target = this.bridge.prepareDeletion(original);
            const op = await this.controller.deleteEvent(target, range, expected);
            this.host.notice(op.status === "saved" ? "\u8BA1\u65F6\u65F6\u6BB5\u5DF2\u5220\u9664" : "\u5220\u9664\u8BF7\u6C42\u5DF2\u4FDD\u5B58\uFF0C\u7B49\u5F85\u540C\u6B65");
          }
        } : void 0 };
      });
    }
    event(date2, row) {
      if (row?.unsupported || row && !row.original?.event.uid) {
        this.host.notice("\u6B64\u65E5\u7A0B\u8BF7\u5728\u5B8C\u6574\u65E5\u5386\u4E2D\u7F16\u8F91\u3002");
        void this.bridge.openCalendar();
        return;
      }
      const original = clone(row?.original), eventUid = original?.event.uid || `ctt-event-${uid()}`;
      this.form(original ? "\u7F16\u8F91\u65E5\u7A0B" : "\u65B0\u589E\u65E5\u7A0B", (form) => {
        const title = field(form, "\u6807\u9898", "text", row?.title || "");
        title.required = true;
        const category = this.category(form, row?.calendarId || this.defaultCategory());
        const start = field(form, "\u5F00\u59CB\u65F6\u95F4", "datetime-local", row ? localInput(row.start) : `${date2}T09:00:00`);
        const end = field(form, "\u7ED3\u675F\u65F6\u95F4", "datetime-local", row ? localInput(row.end) : `${date2}T09:30:00`);
        start.required = end.required = true;
        const save = async () => {
          const step = await this.bridge.prepareEvent({ title: title.value, start: parseLocal(start.value), end: parseLocal(end.value), calendarId: category.value, uid: eventUid }, original);
          const op = await this.controller.saveEvent(step);
          this.host.notice(op.status === "saved" ? "\u65E5\u7A0B\u5DF2\u4FDD\u5B58" : "\u65E5\u7A0B\u4FEE\u6539\u5DF2\u5728\u672C\u673A\u4FDD\u5B58\uFF0C\u7B49\u5F85\u540C\u6B65");
        };
        return { save, remove: original && this.bridge.canDelete(original) ? {
          label: "\u5220\u9664\u65E5\u7A0B",
          message: `\u5220\u9664\u201C${original.event.title}\u201D\u53CA\u5176\u65E5\u5386\u4E8B\u4EF6\uFF1F`,
          run: async () => {
            const target = this.bridge.prepareDeletion(original), op = await this.controller.deleteEvent(target, { start: row.start, end: row.end });
            this.host.notice(op.status === "saved" ? "\u65E5\u7A0B\u5DF2\u5220\u9664" : "\u5220\u9664\u8BF7\u6C42\u5DF2\u4FDD\u5B58\uFF0C\u7B49\u5F85\u540C\u6B65");
          }
        } : void 0 };
      });
    }
  };

  // Clients/Obsidian/status.ts
  init_time();
  function updateStatus(node, active, tasks2, mode = "manual") {
    const next = sortedTasks(tasks2.filter((t) => !t.completed), mode)[0];
    const text = active ? `\u25F7 ${active.runningSince == null ? "\u5DF2\u6682\u505C \xB7 " : ""}${active.title} \xB7 ${secondsText(elapsed(active))}` : next ? `\u4E0B\u4E00\u9879 \xB7 ${next.title}` : "\u25F7 \u6682\u65E0\u5F85\u529E";
    node.textContent = text;
    node.title = `${text}
\u70B9\u51FB\u6253\u5F00\u8BA1\u65F6\u4E0E\u5F85\u529E`;
    node.setAttribute("aria-label", `${text}\uFF0C\u6253\u5F00\u8BA1\u65F6\u4E0E\u5F85\u529E`);
  }
  function setupStatus(node, open) {
    node.classList.add("ctt-statusbar-item");
    node.setAttribute("role", "button");
    node.tabIndex = 0;
    node.onclick = open;
    node.onkeydown = (e) => {
      if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        open();
      }
    };
  }

  // Shared/sync.ts
  var leaseKey = /* @__PURE__ */ Symbol.for("calendar-task-timer.remote-channels.v1");
  var leases = globalThis[leaseKey] ||= /* @__PURE__ */ new Map();
  var SyncWorker = class {
    constructor(controller2, options2) {
      this.controller = controller2;
      this.options = options2;
    }
    controller;
    options;
    view = { activeKey: null, waiting: false, error: "" };
    timer;
    warning;
    stopped = false;
    running = false;
    pauseUntil = 0;
    now() {
      return this.options.now?.() ?? Date.now();
    }
    eligible() {
      return this.controller.jobs().filter(({ value: j }) => {
        if (!j.sync && j.error) return false;
        return !j.sync?.issue || j.sync.issue === "network";
      });
    }
    wake() {
      if (this.stopped || this.running) return;
      if (this.timer) clearTimeout(this.timer);
      if (!this.options.enabled()) return;
      const jobs = this.eligible();
      if (!jobs.length) return;
      const next = Math.max(this.pauseUntil, Math.min(...jobs.map((j) => j.value.sync?.retryAt || 0)));
      this.timer = setTimeout(() => {
        this.timer = void 0;
        void this.pump();
      }, Math.max(this.options.delayMs ?? 80, next - this.now()));
    }
    async resume(issue) {
      for (const j of this.controller.jobs().filter((j2) => j2.value.sync?.issue === issue)) await this.controller.requestRetry(j.key);
      this.wake();
    }
    async retry(key2) {
      await this.controller.requestRetry(key2);
      this.pauseUntil = 0;
      this.wake();
    }
    async pump() {
      if (this.stopped || this.running || !this.options.enabled()) return;
      const job = this.eligible().find((j) => (j.value.sync?.retryAt || 0) <= this.now());
      if (!job) {
        this.wake();
        return;
      }
      const channel = this.options.channel, previous = channel ? leases.get(channel) : void 0;
      if (previous) {
        this.running = true;
        this.view.waiting = true;
        this.view.error = "\u7B49\u5F85\u4E0A\u4E00\u63D2\u4EF6\u5B9E\u4F8B\u7684 FCR \u8BF7\u6C42\u7ED3\u675F\uFF0C\u672C\u5730\u8BA1\u65F6\u4ECD\u53EF\u7EE7\u7EED\u3002";
        this.options.changed?.();
        await previous.done;
        this.running = false;
        if (!this.stopped) {
          this.view.waiting = false;
          this.view.error = "";
          this.options.changed?.();
          this.wake();
        }
        return;
      }
      const token = /* @__PURE__ */ Symbol();
      let release;
      const done = new Promise((resolve) => {
        release = resolve;
      });
      if (channel) leases.set(channel, { token, done });
      this.running = true;
      this.view.activeKey = job.key;
      this.view.waiting = false;
      this.view.error = "";
      const start = this.now();
      this.options.changed?.();
      this.warning = setTimeout(() => {
        if (this.stopped) return;
        this.view.waiting = true;
        this.options.changed?.();
      }, this.options.slowMs ?? 15e3);
      try {
        await this.controller.sync(job.key);
      } catch (e) {
        if (!this.stopped) {
          this.view.error = e.message;
          this.pauseUntil = this.now() + 1e4;
        }
      } finally {
        if (channel && leases.get(channel)?.token === token) leases.delete(channel);
        release();
        if (this.warning) clearTimeout(this.warning);
        this.warning = void 0;
        this.running = false;
        this.view.activeKey = null;
        this.view.waiting = false;
        if (!this.stopped) {
          this.view.lastDurationMs = Math.max(0, this.now() - start);
          this.options.settled?.();
          this.options.changed?.();
          this.wake();
        }
      }
    }
    stop() {
      this.stopped = true;
      if (this.timer) clearTimeout(this.timer);
      if (this.warning) clearTimeout(this.warning);
      this.controller.stopRemote();
    }
  };

  // Clients/Obsidian/syncStatus.ts
  var syncKey = (id) => /^(work|event|delete):/.test(id) ? id : `work:${id}`;
  function pendingView(state, sync) {
    const items = [
      ...state.records.filter((r) => r.status !== "saved").map((r) => ({ id: r.id, key: `work:${r.id}`, title: r.edit?.title || r.title, value: r, canKeep: !r.edit && r.completeTask && !r.taskSaved && r.segments.every((p) => p.saved), canResolveMissing: false })),
      ...state.operations.filter((o) => o.status !== "saved").map((o) => ({ id: `event:${o.id}`, key: `event:${o.id}`, title: o.title, value: o, canKeep: false, canResolveMissing: false })),
      ...(state.deletions || []).filter((o) => o.status !== "saved").map((o) => ({ id: `delete:${o.id}`, key: `delete:${o.id}`, title: `\u5220\u9664 \xB7 ${o.title}`, value: o, canKeep: false, canResolveMissing: isMissingResource(o.error) }))
    ];
    return items.map(({ value, ...item }) => {
      const working = sync?.activeKey === item.key;
      const status = working ? sync?.waiting ? "\u7B49\u5F85 FCR \u54CD\u5E94\uFF0C\u672C\u5730\u64CD\u4F5C\u4ECD\u53EF\u7EE7\u7EED" : "\u6B63\u5728\u540C\u6B65" : value.sync?.issue === "auth" ? "\u7B49\u5F85\u65E5\u5386\u6388\u6743" : value.sync?.issue === "conflict" ? "\u9700\u8981\u6838\u5BF9" : value.sync?.issue === "network" ? "\u7B49\u5F85\u81EA\u52A8\u91CD\u8BD5" : value.error ? "\u4E0A\u6B21\u540C\u6B65\u5931\u8D25\uFF0C\u8BF7\u624B\u52A8\u91CD\u8BD5" : "\u672C\u673A\u5DF2\u4FDD\u5B58\uFF0C\u7B49\u5F85\u540C\u6B65";
      return { ...item, working, status, error: value.error ? `\u4E0A\u6B21\u540C\u6B65\u9519\u8BEF\uFF1A${value.error}` : "" };
    });
  }

  // Preview/preview.ts
  var key = "calendar-task-timer-preview-v2";
  var today = dayKey();
  var calendars = [{ id: "research", name: "\u79D1\u7814", type: "caldav", color: "#c8a0b2" }, { id: "work", name: "\u5DE5\u4F5C", type: "caldav", color: "#82a6c0" }, { id: "personal", name: "\u4E2A\u4EBA", type: "caldav", color: "#9bb69f" }];
  var tasks = [
    { id: "t1", title: "\u68B3\u7406\u8BBA\u6587\u4E2D\u7684\u6838\u5FC3\u95EE\u9898", calendarId: "research", due: today, completed: false, kind: "local" },
    { id: "t2", title: "\u6574\u7406\u591A\u6444\u50CF\u5934\u6570\u636E\u96C6", calendarId: "research", completed: false, kind: "local" },
    { id: "t3", title: "\u51C6\u5907\u9879\u76EE\u5468\u62A5", calendarId: "work", due: today, completed: false, kind: "local" },
    { id: "t4", title: "\u665A\u95F4\u9605\u8BFB", calendarId: "personal", completed: false, kind: "local" }
  ];
  var entries = [];
  var defaultCalendarId = "research";
  var date = today;
  var busy = false;
  var error = "";
  var offline = false;
  var typography = { ...DEFAULT_APPEARANCE };
  var categories = categoryPreferences();
  var syncDelay = 0;
  var worker;
  var sortMode = "manual";
  var instant = (time) => +/* @__PURE__ */ new Date(`${today}T${time}:00`);
  var firstTask = { id: "demo-work", title: "\u8BBA\u6587\u9605\u8BFB", kind: "local", completed: true, calendarId: "research" };
  var seed = blankJournal();
  var demoRecord = {
    id: "demo-session",
    title: "\u8BBA\u6587\u9605\u8BFB",
    task: firstTask,
    calendarId: "research",
    zone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    startedAt: instant("09:10"),
    endedAt: instant("10:00"),
    runningSince: null,
    lastHeartbeat: instant("10:00"),
    segments: [{ start: instant("09:10"), end: instant("10:00"), uid: "simple-task-timer-demo-session-0", saved: true }],
    completeTask: false,
    taskSaved: true,
    status: "saved",
    error: ""
  };
  var demoEvent = eventForSegment(demoRecord, demoRecord.segments[0]);
  demoRecord.segments[0] = { ...demoRecord.segments[0], snapshot: demoEvent };
  seed.records.push(demoRecord);
  entries.push({ id: "demo-event-1", calendarId: "research", event: demoEvent });
  var makeEvent = (id, title, start, end, calendarId) => {
    const a = dateParts(instant(start), "UTC"), b = dateParts(instant(end), "UTC");
    entries.push({ id, calendarId, event: { type: "single", uid: id, title, date: a.date, endDate: b.date, startTime: a.time, endTime: b.time, timezone: "UTC", allDay: false, isTask: false } });
  };
  makeEvent("demo-event-2", "\u9879\u76EE\u8BA8\u8BBA", "10:30", "11:15", "work");
  makeEvent("demo-event-3", "\u5B9E\u9A8C\u65B9\u6848\u6574\u7406", "14:00", "15:00", "research");
  makeEvent("demo-event-4", "\u5065\u8EAB", "19:00", "20:00", "personal");
  var initial = seed;
  try {
    const saved = JSON.parse(localStorage.getItem(key) || "null");
    if (saved) {
      initial = validateJournal(saved.journal);
      tasks = saved.tasks;
      entries = saved.entries;
      defaultCalendarId = saved.defaultCalendarId;
      typography = appearance(saved.typography);
      categories = categoryPreferences(saved.categories);
      sortMode = taskSort(saved.taskSort);
    }
  } catch {
  }
  var write = () => {
    localStorage.setItem(key, JSON.stringify({ journal: controller.state, tasks, entries, defaultCalendarId, typography, categories, taskSort: sortMode }));
  };
  var effect = async () => {
    if (syncDelay) await new Promise((resolve) => setTimeout(resolve, syncDelay));
    if (offline) throw new Error("\u6A21\u62DF\u65AD\u7F51\uFF1A\u64CD\u4F5C\u5DF2\u4FDD\u5B58\u5728\u672C\u673A\uFF0C\u8054\u7F51\u540E\u53EF\u91CD\u8BD5\u3002");
  };
  var api = {
    getCalendarSources: () => clone(calendars),
    getProviderCapabilities: () => ({ canCreate: true, canEdit: true, canDelete: true }),
    getAllEvents: () => calendars.map((c) => ({ ...c, events: entries.filter((e) => e.calendarId === c.id).map((e) => ({ id: e.id, event: clone(e.event) })) })),
    getEvents: () => entries.map((e) => ({ id: e.id, startMillis: +/* @__PURE__ */ new Date(`${e.event.date}T${e.event.startTime}${e.event.timezone === "UTC" ? "Z" : ""}`), endMillis: +/* @__PURE__ */ new Date(`${e.event.endDate || e.event.date}T${e.event.endTime}${e.event.timezone === "UTC" ? "Z" : ""}`), isTask: false })),
    createEvent: async (calendarId, event) => {
      await effect();
      entries.push({ id: uid(), calendarId, event: clone(event) });
      write();
      return true;
    },
    updateEvent: async (id, event) => {
      await effect();
      const found = entries.find((e) => e.id === id);
      if (!found) return false;
      found.event = clone(event);
      write();
      return true;
    },
    deleteEvent: async (id) => {
      await effect();
      entries = entries.filter((e) => e.id !== id);
      write();
    },
    revalidateRemoteCalendars: () => {
    },
    openCalendar: async () => {
      notice("\u9884\u89C8\u4EC5\u5C55\u793A\u65F6\u95F4\u8F74\uFF1B\u771F\u5B9E\u63D2\u4EF6\u4F1A\u6253\u5F00 FCR\u3002");
    }
  };
  var bridge = new FcrBridge({}, () => null, async () => {
  });
  bridge.authorized = api;
  var ui;
  var notice = (text) => {
    const node = document.querySelector("#toast");
    node.textContent = text;
    setTimeout(() => {
      if (node.textContent === text) node.textContent = "";
    }, 4e3);
  };
  var controller = new TimerController({
    state: initial,
    background: true,
    persist: async (state) => {
      localStorage.setItem(key, JSON.stringify({ journal: state, tasks, entries, defaultCalendarId, typography, categories, taskSort: sortMode }));
    },
    calendar: bridge,
    tasks: { complete: async (task) => {
      const found = tasks.find((t) => t.id === task.id);
      if (!found) throw new Error("\u5F85\u529E\u5DF2\u5220\u9664");
      if (!found.completed && found.title !== task.title) throw new Error("\u5F85\u529E\u5DF2\u53D8\u5316");
      found.completed = true;
      write();
    } },
    onChange: () => {
      render();
      worker?.wake();
    }
  });
  worker = new SyncWorker(controller, { enabled: () => true, changed: () => render(), settled: () => {
    write();
    render();
  } });
  var host = { notice, open: (title, render2) => {
    const restore = document.activeElement;
    const d = document.createElement("dialog");
    document.body.append(d);
    const root = el(d, "div", "ctt-dialog");
    applyAppearance(root, typography);
    el(root, "h2", "", title);
    render2(root, () => d.close());
    d.addEventListener("close", () => {
      d.remove();
      if (restore instanceof HTMLElement && restore.isConnected) restore.focus();
    });
    d.showModal();
  } };
  var dialogs = new Dialogs(host, controller, bridge, () => calendars, () => defaultCalendarId, async () => {
    write();
    render();
  }, (id) => worker.retry(`delete:${id}`));
  async function run(fn) {
    if (busy) return false;
    busy = true;
    error = "";
    render();
    try {
      await fn();
      return true;
    } catch (e) {
      error = e.message;
      return false;
    } finally {
      busy = false;
      render();
    }
  }
  function model() {
    const state = controller.state;
    return {
      connected: true,
      busy,
      error,
      sources: calendars,
      calendars,
      defaultCalendarId,
      active: state.active,
      tasks,
      date,
      appearance: typography,
      categoryPreferences: categories,
      taskSort: sortMode,
      rows: mergeTimeline(bridge.timeline(date), state.records, date, state.operations, state.deletions),
      pending: pendingView(state, worker?.view),
      sync: worker?.view
    };
  }
  function render() {
    ui?.update(model());
    updateStatus(document.querySelector("#preview-status"), controller.state.active, tasks, sortMode);
  }
  var actions = {
    connect: () => {
    },
    refresh: () => {
      void run(async () => {
        bridge.refresh();
        await controller.reconcileDeletions();
        notice("\u5DF2\u5237\u65B0\u793A\u4F8B\u65E5\u5386");
      });
    },
    openCalendar: () => {
      void bridge.openCalendar();
    },
    categorySettings: () => host.open("\u5206\u7C7B\u6392\u5E8F\u4E0E\u663E\u793A", (root, close) => {
      const categoryRoot = el(root, "div");
      renderCategorySettings(categoryRoot, calendars, categories, async (next) => {
        categories = next;
        write();
        render();
      });
      button(root, "\u5B8C\u6210", close);
    }),
    settings: () => host.open("\u9884\u89C8\u8BBE\u7F6E", (root, close) => {
      const l = el(root, "label", "ctt-field");
      el(l, "span", "", "\u9ED8\u8BA4\u5206\u7C7B");
      const select = el(l, "select");
      options(select, calendars, defaultCalendarId);
      const sizeLabel = el(root, "label", "ctt-field");
      el(sizeLabel, "span", "", "\u9875\u9762\u5B57\u53F7");
      const size = el(sizeLabel, "select");
      for (let n = 13; n <= 20; n++) {
        const option = el(size, "option", "", `${n}px`);
        option.value = String(n);
      }
      size.value = String(typography.fontSize);
      const weightLabel = el(root, "label", "ctt-field");
      el(weightLabel, "span", "", "\u9875\u9762\u5B57\u91CD");
      const weight = el(weightLabel, "select");
      for (const [v, title] of [[400, "\u5E38\u89C4"], [500, "\u9002\u4E2D"], [600, "\u52A0\u7C97"]]) {
        const option = el(weight, "option", "", title);
        option.value = String(v);
      }
      weight.value = String(typography.fontWeight);
      button(root, "\u4FDD\u5B58", () => {
        defaultCalendarId = select.value;
        typography = appearance({ fontSize: Number(size.value), fontWeight: Number(weight.value) });
        write();
        render();
        close();
      }, "ctt-primary");
    }),
    date: (value) => {
      date = value;
      render();
    },
    sortTasks: (mode) => run(async () => {
      const before = sortMode;
      sortMode = mode;
      try {
        write();
      } catch (e) {
        sortMode = before;
        throw e;
      }
    }),
    reorderTasks: (next, expected) => run(async () => {
      if (sortMode !== "manual") throw new Error("\u8BF7\u5148\u5207\u6362\u624B\u52A8\u6392\u5E8F\u3002");
      const before = tasks;
      tasks = reorderTaskSlots(tasks, next, expected);
      try {
        write();
      } catch (e) {
        tasks = before;
        throw e;
      }
    }),
    add: (title, due, calendarId) => run(async () => {
      if (!title.trim()) throw new Error("\u8BF7\u586B\u5199\u540D\u79F0\u3002");
      bridge.assertWritable(calendarId);
      tasks.push({ id: uid(), title, due, calendarId, completed: false, kind: "local" });
      write();
    }),
    start: (task) => {
      void run(() => controller.start(task, task.calendarId || defaultCalendarId));
    },
    complete: (task) => {
      task.completed = true;
      write();
      render();
    },
    editTask: (task) => dialogs.task(task, async (patch) => {
      Object.assign(task, patch);
      write();
    }),
    pause: () => {
      void run(() => controller.pause());
    },
    resume: () => {
      void run(() => controller.resume());
    },
    finish: (complete) => {
      void run(async () => {
        await controller.finish(complete);
        write();
      });
    },
    editStart: () => dialogs.start(),
    category: (id) => {
      void run(() => controller.updateActive({ calendarId: id }));
    },
    newEvent: () => dialogs.event(date),
    editRow: (row) => {
      if (row.deleting && row.deletionId) {
        dialogs.deletion(row.deletionId);
        return;
      }
      if (row.pending && !row.recordId) {
        notice(row.error || "\u8BF7\u5148\u91CD\u8BD5\u5F85\u540C\u6B65\u64CD\u4F5C\u3002");
        return;
      }
      if (row.recordId) dialogs.record(controller.state.records.find((r) => r.id === row.recordId), row.segmentUid);
      else dialogs.event(date, row);
    },
    resolveDeletion: (id) => dialogs.deletion(id),
    retry: (id) => {
      void run(async () => {
        await worker?.retry(syncKey(id));
      });
    },
    keep: (id) => {
      void run(() => controller.keepCalendarOnly(id));
    }
  };
  ui = new TimerUI(mountTimerView(document.querySelector("#app")), actions);
  setupStatus(document.querySelector("#preview-status"), () => document.querySelector(".ctt-shell").scrollTo({ top: 0 }));
  render();
  void controller.recover().then(() => worker?.wake());
  setInterval(() => {
    ui.tick();
    updateStatus(document.querySelector("#preview-status"), controller.state.active, tasks, sortMode);
  }, 1e3);
  setInterval(() => {
    void controller.heartbeat();
  }, 15e3);
  document.querySelector("#offline").onchange = (e) => {
    offline = e.target.checked;
    if (!offline) void worker?.resume("network");
  };
  document.querySelector("#sync-delay").onchange = (e) => {
    syncDelay = Number(e.target.value);
  };
  document.querySelector("#theme").onchange = (e) => document.documentElement.classList.toggle("theme-dark", e.target.checked);
  document.querySelector("#reset").onclick = () => {
    localStorage.removeItem(key);
    location.reload();
  };
  window.__preview = { controller, bridge, model, render, worker, setDelay: (ms) => {
    syncDelay = ms;
  }, tasks: () => tasks, entries: () => entries };
  window.addEventListener("beforeunload", () => worker?.stop());
})();
