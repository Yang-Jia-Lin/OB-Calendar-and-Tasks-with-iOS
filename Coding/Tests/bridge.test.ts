import test from "node:test";
import assert from "node:assert/strict";
import { FcrBridge, containsEvent, type FcrApi } from "../Providers/Fcr/bridge";
import { clone, sameEventContent, type CalendarEvent, type Entry, type EditStep } from "../Shared/contracts";
const event: CalendarEvent = { type: "single", uid: "stable", title: "Reading", date: "2026-10-25", endDate: "2026-10-25", startTime: "01:00:00", endTime: "02:00:00", allDay: false, timezone: "UTC", isTask: false };
function harness() {
  let entries: Entry[] = [{ id: "old", calendarId: "a", event: clone(event) }], creates = 0, deletes = 0, updates = 0, lostCreate = false, lostUpdate = false, deleteFails = false;
  const api: FcrApi = {
    getCalendarSources: () => [{ id: "a", name: "科研", type: "caldav" }, { id: "b", name: "工作", type: "caldav" }, { id: "readonly", name: "Feed", type: "ical" }],
    getProviderCapabilities: id => ({ canCreate: id !== "readonly", canEdit: id !== "readonly", canDelete: id !== "readonly" }),
    getAllEvents: () => ["a", "b", "readonly"].map(id => ({ id, events: entries.filter(e => e.calendarId === id).map(e => ({ id: e.id, event: clone(e.event) })) })),
    getEvents: () => entries.map(e => ({ id: e.id, startMillis: Date.parse(`${e.event.date}T${e.event.startTime}Z`), endMillis: Date.parse(`${e.event.endDate}T${e.event.endTime}Z`) })),
    createEvent: async (id, e) => { creates++; entries.push({ id: "created-" + creates, calendarId: id, event: clone(e) }); if (lostCreate) { lostCreate = false; throw new Error("lost create response"); } return true; },
    updateEvent: async (id, e) => { updates++; entries.find(e => e.id === id)!.event = clone(e); if (lostUpdate) { lostUpdate = false; throw new Error("lost update response"); } return true; },
    deleteEvent: async id => { deletes++; if (deleteFails) throw new Error("delete failed"); entries = entries.filter(e => e.id !== id); }, revalidateRemoteCalendars: () => {}, openCalendar: async () => {}
  };
  const bridge = new FcrBridge({}, () => null, async () => {}); bridge.authorized = api;
  const step = (): EditStep => ({ uid: "stable", fromCalendarId: "a", toCalendarId: "b", before: clone(event), after: { ...event, title: "Changed" }, stage: "prepared" });
  return { bridge, api, step, entries: () => entries, creates: () => creates, deletes: () => deletes, updates: () => updates,
    loseCreate() { lostCreate = true; }, loseUpdate() { lostUpdate = true; }, deleteFails(v = true) { deleteFails = v; } };
}
test("readonly feeds never become task categories", () => { const h = harness(); assert.deepEqual(h.bridge.writableCalendars().map(c => c.id), ["a", "b"]); assert.throws(() => h.bridge.assertWritable("readonly")); });
test("ensure rejects conflicting UID rather than treating it as saved", async () => { const h = harness(); await assert.rejects(h.bridge.ensureEvent("a", { ...event, title: "conflict" })); assert.equal(h.creates(), 0); });
test("lost create response is reconciled without a duplicate", async () => { const h = harness(); h.loseCreate(); await assert.rejects(h.bridge.ensureEvent("b", event)); await h.bridge.ensureEvent("b", event); assert.equal(h.creates(), 1); });
test("category move checkpoints target before deleting source", async () => {
  const h = harness(), s = h.step(), stages: string[] = []; await h.bridge.reconcileStep(s, async () => { stages.push(s.stage); if (s.stage === "target-confirmed") assert.equal(h.deletes(), 0); });
  assert.deepEqual(stages, ["target-confirmed", "done"]); assert.equal(h.entries().length, 1); assert.equal(h.entries()[0].calendarId, "b");
});
test("partial move survives restart and retries source deletion only", async () => {
  const h = harness(), s = h.step(); h.deleteFails(); await assert.rejects(h.bridge.reconcileStep(s, async () => {})); assert.equal(s.stage, "target-confirmed"); assert.equal(h.entries().length, 2);
  const restored = clone(s); h.deleteFails(false); await h.bridge.reconcileStep(restored, async () => {}); assert.equal(h.creates(), 1); assert.equal(h.entries().length, 1);
});
test("lost move-create response is located by the original UID", async () => { const h = harness(), s = h.step(); h.loseCreate(); await assert.rejects(h.bridge.reconcileStep(s, async () => {})); await h.bridge.reconcileStep(s, async () => {}); assert.equal(h.creates(), 1); assert.equal(h.entries().length, 1); });
test("target checkpoint failure never deletes source", async () => { const h = harness(), s = h.step(); await assert.rejects(h.bridge.reconcileStep(s, async () => { throw new Error("disk full"); })); assert.equal(h.deletes(), 0); assert.equal(h.entries().length, 2); });
test("external source change stops move without creating anything", async () => { const h = harness(), s = h.step(); h.entries()[0].event.title = "External"; await assert.rejects(h.bridge.reconcileStep(s, async () => {}), /外部修改/); assert.equal(h.creates(), 0); });
test("conflicting target prevents source deletion", async () => { const h = harness(), s = h.step(); h.entries().push({ id: "conflict", calendarId: "b", event: { ...event, title: "conflict" } }); await assert.rejects(h.bridge.reconcileStep(s, async () => {})); assert.equal(h.deletes(), 0); });
test("deleted source is not recreated from old journals", async () => { const h = harness(), s = h.step(); h.entries().splice(0); await assert.rejects(h.bridge.reconcileStep(s, async () => {})); assert.equal(h.creates(), 0); });
test("deleted confirmed target is not recreated on retry", async () => { const h = harness(), s = h.step(); s.stage = "target-confirmed"; await assert.rejects(h.bridge.reconcileStep(s, async () => {})); assert.equal(h.creates(), 0); });
test("lost update response is verified before retrying", async () => { const h = harness(), s = h.step(); s.toCalendarId = "a"; h.loseUpdate(); await assert.rejects(h.bridge.reconcileStep(s, async () => {})); await h.bridge.reconcileStep(s, async () => {}); assert.equal(h.updates(), 1); assert.equal(s.stage, "done"); });
test("manual future and cross-midnight edits produce UTC without changing UID", async () => { const h = harness(); const step = await h.bridge.prepareEvent({ title: "future", calendarId: "b", start: Date.parse("2026-12-01T23:00Z"), end: Date.parse("2026-12-02T01:00Z") }); assert.equal(step.after.date, "2026-12-01"); assert.equal(step.after.endDate, "2026-12-02"); assert.equal(step.fromCalendarId, ""); await h.bridge.reconcileStep(step, async () => {}); assert.equal(step.stage, "done"); });
test("duplicate UIDs in one calendar are reported rather than arbitrarily edited", () => { const h = harness(); h.entries().push({ id: "dup", calendarId: "a", event: clone(event) }); assert.throws(() => h.bridge.readByUid("a", "stable"), /重复/); });
test("deletion uses a fresh snapshot and respects provider permissions", async () => {
  const h = harness(), target = h.bridge.prepareDeletion(clone(h.entries()[0])); h.entries()[0].event.title = "external";
  await assert.rejects(h.bridge.deleteEvent(target), /外部修改/); assert.equal(h.deletes(), 0);
  const readOnly = { id: "readonly-event", calendarId: "readonly", event: clone(event) }; assert.throws(() => h.bridge.prepareDeletion(readOnly), /无法/);
});
test("delete retries after a lost response never create a replacement event", async () => {
  const h = harness(), target = h.bridge.prepareDeletion(clone(h.entries()[0])), original = h.api.deleteEvent;
  h.api.deleteEvent = async id => { await original(id); throw new Error("lost delete response"); };
  await assert.rejects(h.bridge.deleteEvent(target)); await h.bridge.deleteEvent(target); assert.equal(h.entries().length, 0); assert.equal(h.deletes(), 1); assert.equal(h.creates(), 0);
});
test("failed deletion preserves the event and can retry using the original UID", async () => {
  const h = harness(), target = h.bridge.prepareDeletion(clone(h.entries()[0])); h.deleteFails(); await assert.rejects(h.bridge.deleteEvent(target)); assert.equal(h.entries().length, 1);
  h.deleteFails(false); await h.bridge.deleteEvent(target); assert.equal(h.entries().length, 0);
});
test("DELETE 404 refreshes FCR but is never blindly reported as success", async () => {
  const h = harness(), target = h.bridge.prepareDeletion(clone(h.entries()[0])); let refreshes = 0;
  h.api.deleteEvent = async () => { throw new Error("CalDAV request failed (HTTP 404):"); }; h.api.revalidateRemoteCalendars = () => { refreshes++; };
  await assert.rejects(h.bridge.deleteEvent(target), /HTTP 404/); assert.equal(refreshes, 1); assert.equal(h.entries().length, 1);
});
test("CalDAV href and ETag refreshes do not block retrying the same unchanged event", async () => {
  const h = harness(), target = h.bridge.prepareDeletion(clone(h.entries()[0]));
  h.entries()[0].event.caldavHref = "new-resource.ics"; h.entries()[0].event.etag = "new-etag";
  await h.bridge.deleteEvent(target); assert.equal(h.entries().length, 0);
});
test("unavailable calendar cache cannot settle a deletion or trigger a duplicate create", async () => {
  const h = harness(), target = h.bridge.prepareDeletion(clone(h.entries()[0])); h.api.getAllEvents = () => [];
  await assert.rejects(h.bridge.deleteEvent(target), /尚未就绪/); await assert.rejects(h.bridge.ensureEvent("a", event), /尚未就绪/);
  assert.equal(h.deletes(), 0); assert.equal(h.creates(), 0);
});
test("day projection and UID lookup do not clone unrelated event payloads", () => {
  const h = harness();
  const unreadable = { ...event, uid: "outside-day", date: "2025-01-01", endDate: "2025-01-01", description: "" };
  Object.defineProperty(unreadable, "description", { get() { throw Error("unrelated payload must not be cloned"); }, enumerable: true });
  h.entries().push({ id: "outside-day", calendarId: "a", event: unreadable });
  h.api.getAllEvents = () => [{ id: "a", events: h.entries().map(e => ({ id: e.id, event: e.event })) }];
  assert.equal(h.bridge.find("a", "stable")?.id, "old"); assert.equal(h.bridge.timeline("2026-10-25").length, 1);
});

test("moving a CalDAV event strips source resource metadata and verifies the new target metadata", async () => {
  const h = harness(), s = h.step(), create = h.api.createEvent;
  Object.assign(h.entries()[0].event, { etag: "source-tag", caldavHref: "source.ics" });
  Object.assign(s.before, h.entries()[0].event); Object.assign(s.after, { etag: "source-tag", caldavHref: "source.ics" });
  h.api.createEvent = async (id, value) => {
    assert.equal(value.etag, undefined); assert.equal(value.caldavHref, undefined);
    return create(id, { ...value, etag: "target-tag", caldavHref: "target.ics" });
  };
  await h.bridge.reconcileStep(s, async () => {});
  assert.equal(s.stage, "done"); assert.equal(s.after.etag, "target-tag"); assert.equal(h.creates(), 1); assert.equal(h.deletes(), 1);
});

test("a pre-existing move target with only different metadata is reconciled without creating a duplicate", async () => {
  const h = harness(), s = h.step();
  Object.assign(s.after, { etag: "old", caldavHref: "source.ics" });
  h.entries().push({ id: "existing-target", calendarId: "b", event: { ...s.after, etag: "new", caldavHref: "target.ics" } });
  await h.bridge.reconcileStep(s, async () => {});
  assert.equal(h.creates(), 0); assert.equal(h.deletes(), 1); assert.equal(s.stage, "done");
});

test("metadata refreshes at a move checkpoint do not block safe source deletion", async () => {
  const h = harness(), s = h.step();
  await h.bridge.reconcileStep(s, async () => {
    if (s.stage === "target-confirmed") for (const e of h.entries()) e.event.etag = "refreshed";
  });
  assert.equal(h.deletes(), 1); assert.equal(s.stage, "done");
});

test("same-calendar edits use current metadata and verify content when the provider changes ETag", async () => {
  const h = harness(), s = h.step(), update = h.api.updateEvent; s.toCalendarId = "a";
  Object.assign(s.before, { etag: "stale", caldavHref: "stale.ics" }); Object.assign(s.after, { etag: "stale", caldavHref: "stale.ics" });
  Object.assign(h.entries()[0].event, { etag: "fresh", caldavHref: "fresh.ics" });
  h.api.updateEvent = (id, value) => {
    assert.equal(value.etag, "fresh"); assert.equal(value.caldavHref, "fresh.ics");
    return update(id, { ...value, etag: "written" });
  };
  await h.bridge.reconcileStep(s, async () => {});
  assert.equal(h.updates(), 1); assert.equal(s.after.etag, "written"); assert.equal(s.stage, "done");
});

test("FCR false update refreshes its rolled-back cache before retrying with a fresh ETag", async () => {
  const h = harness(), s = h.step(), update = h.api.updateEvent; s.toCalendarId = "a";
  Object.assign(h.entries()[0].event, { etag: "stale", caldavHref: "resource.ics" });
  Object.assign(s.before, h.entries()[0].event); Object.assign(s.after, { etag: "stale", caldavHref: "resource.ics" });
  let refreshes = 0, attempts = 0;
  h.api.revalidateRemoteCalendars = () => { refreshes++; h.entries()[0].event.etag = "fresh"; };
  h.api.updateEvent = async (id, value) => { attempts++; if (attempts === 1) return false; assert.equal(value.etag, "fresh"); return update(id, value); };
  await assert.rejects(h.bridge.reconcileStep(s, async () => {}), /已请求刷新/);
  assert.equal(refreshes, 1); assert.equal(s.stage, "prepared"); assert.equal(h.deletes(), 0);
  await h.bridge.reconcileStep(s, async () => {}); assert.equal(s.stage, "done"); assert.equal(attempts, 2);
});

test("a real external change found after refreshing a failed update stops retry instead of overwriting", async () => {
  const h = harness(), s = h.step(); s.toCalendarId = "a"; let attempts = 0;
  h.api.updateEvent = async () => { attempts++; return false; };
  h.api.revalidateRemoteCalendars = () => { h.entries()[0].event.title = "Edited elsewhere"; };
  await assert.rejects(h.bridge.reconcileStep(s, async () => {}), /已请求刷新/);
  await assert.rejects(h.bridge.reconcileStep(s, async () => {}), /外部修改/);
  assert.equal(attempts, 1); assert.equal(h.entries()[0].event.title, "Edited elsewhere");
});

test("an unconfirmed create refreshes and reconciles an existing UID without a second create", async () => {
  const h = harness(), create = h.api.createEvent; let refreshes = 0;
  h.api.createEvent = async (id, value) => { await create(id, value); return false; };
  h.api.revalidateRemoteCalendars = () => { refreshes++; };
  await assert.rejects(h.bridge.ensureEvent("b", event), /已请求刷新/);
  await h.bridge.ensureEvent("b", event); assert.equal(h.creates(), 1); assert.equal(refreshes, 1);
});

function caldavRoundTrip(value: CalendarEvent): CalendarEvent {
  const e = clone(value);
  for (const key of ["startTime", "endTime"] as const) if (e[key]?.endsWith(":00") && e[key]!.length === 8) e[key] = e[key]!.slice(0, 5);
  if (e.endDate === e.date) (e as any).endDate = null;
  if (e.isTask === false) delete e.isTask;
  return e;
}

test("CalDAV minute formatting and omitted defaults compare equally without mutating snapshots", () => {
  const original = clone(event), remote = caldavRoundTrip(event), snapshot = clone(remote);
  assert.equal(sameEventContent(event, remote), true); assert.equal(sameEventContent(remote, event), true);
  assert.equal(containsEvent(remote, event), true); assert.equal(containsEvent(event, remote), true);
  assert.deepEqual(event, original); assert.deepEqual(remote, snapshot);
});

test("normalizing defaults never hides actual seconds, dates, timezone, task flags or content changes", () => {
  const remote = caldavRoundTrip(event);
  for (const patch of [{ startTime: "01:00:01" }, { endTime: "02:01" }, { endDate: "2026-10-26" }, { date: "2026-10-26" },
    { timezone: "Asia/Shanghai" }, { isTask: true }, { allDay: true }, { title: "External title" }, { description: "External note" }]) {
    const changed = { ...remote, ...patch };
    assert.equal(sameEventContent(event, changed), false, JSON.stringify(patch));
  }
  assert.equal(containsEvent({ ...remote, startTime: "01:00" }, { ...event, startTime: "01:00:01" }), false);
  assert.equal(containsEvent({ ...remote, isTask: true }, event), false);
});

test("missing end dates do not erase midnight spans or alter all-day and recurring semantics", () => {
  const crossMidnight = { ...event, startTime: "23:40:00", endTime: "01:38:00", endDate: "2026-10-26" };
  const remote = caldavRoundTrip(crossMidnight);
  assert.equal(sameEventContent(crossMidnight, remote), true);
  assert.equal(sameEventContent(crossMidnight, { ...remote, endDate: undefined }), false);
  for (const patch of [{ allDay: true }, { type: "rrule" }]) {
    const unsupported = { ...event, ...patch };
    assert.equal(sameEventContent(unsupported, { ...unsupported, endDate: undefined }), false);
  }
});

test("an already moved normalized target settles the old prepared operation without cloud writes", async () => {
  const h = harness(), s = h.step();
  h.entries().splice(0, 1, { id: "existing-target", calendarId: "b", event: caldavRoundTrip(s.after) });
  const stages: string[] = [];
  await h.bridge.reconcileStep(s, async () => { stages.push(s.stage); });
  assert.equal(s.stage, "done"); assert.deepEqual(stages, ["target-confirmed", "done"]);
  assert.equal(h.creates(), 0); assert.equal(h.deletes(), 0); assert.equal(h.updates(), 0);
});

test("a move with normalized source and target completes without a duplicate target", async () => {
  const h = harness(), s = h.step(); h.entries()[0].event = caldavRoundTrip(s.before);
  h.entries().push({ id: "target", calendarId: "b", event: caldavRoundTrip(s.after) });
  await h.bridge.reconcileStep(s, async () => {});
  assert.equal(h.creates(), 0); assert.equal(h.deletes(), 1); assert.equal(s.stage, "done");
});

test("a pending midnight edit applies once when the refreshed source uses minute strings", async () => {
  const h = harness(), s = h.step(), update = h.api.updateEvent; s.toCalendarId = "a";
  s.before = { ...event, date: "2026-10-29", endDate: "2026-10-30", startTime: "23:40:00", endTime: "01:38:00", description: "1h58" };
  s.after = { ...s.before, endTime: "01:10:00", description: "1h30" };
  h.entries()[0].event = caldavRoundTrip(s.before);
  h.api.updateEvent = (id, value) => update(id, caldavRoundTrip(value));
  await h.bridge.reconcileStep(s, async () => {});
  assert.equal(s.stage, "done"); assert.equal(h.updates(), 1);
  assert.equal(h.entries()[0].event.endTime, "01:10"); assert.equal(h.entries()[0].event.description, "1h30");
});

test("a normalized source that already matches the desired edit is acknowledged without another PUT", async () => {
  const h = harness(), s = h.step(); s.toCalendarId = "a"; h.entries()[0].event = caldavRoundTrip(s.after);
  await h.bridge.reconcileStep(s, async () => {}); assert.equal(s.stage, "done"); assert.equal(h.updates(), 0);
});

test("real external changes still stop a pending edit after CalDAV normalization", async () => {
  for (const patch of [{ title: "External" }, { startTime: "01:00:01" }, { endTime: "02:05" }, { description: "Added elsewhere" }, { timezone: "Asia/Shanghai" }, { isTask: true }]) {
    const h = harness(), s = h.step(); s.toCalendarId = "a";
    h.entries()[0].event = { ...caldavRoundTrip(s.before), ...patch };
    await assert.rejects(h.bridge.reconcileStep(s, async () => {}), /外部修改/);
    assert.equal(h.updates(), 0); assert.equal(h.deletes(), 0);
  }
});

test("a normalized created event is verified and found by UID on retry", async () => {
  const h = harness(), create = h.api.createEvent;
  h.api.createEvent = (id, value) => create(id, caldavRoundTrip(value));
  await h.bridge.ensureEvent("b", event); await h.bridge.ensureEvent("b", event);
  assert.equal(h.creates(), 1); assert.equal(h.entries().filter(e => e.calendarId === "b").length, 1);
});
