import test from "node:test";
import assert from "node:assert/strict";
import { FcrBridge, type FcrApi } from "../Providers/Fcr/bridge";

function connection(saved: string | null = null) {
  let token = saved, requests = 0, refreshes = 0, opens = 0;
  let accepted = saved, approved: string | null = "new-grant";
  let scoped: FcrApi = {
    getCalendarSources: () => [], getProviderCapabilities: () => ({}), getAllEvents: () => [], getEvents: () => [],
    createEvent: async () => true, updateEvent: async () => true, deleteEvent: async () => {},
    revalidateRemoteCalendars: () => { refreshes++; }, openCalendar: async () => { opens++; }
  };
  const api = {
    withToken: (value: string) => value === accepted ? scoped : null,
    requestAccess: async (id: string, _reason: string, scopes: string[]) => {
      assert.equal(id, "calendar-task-timer"); assert.deepEqual(scopes, ["events:read", "events:write", "providers:read", "providers:write", "ui:open-calendar"]);
      requests++; accepted = approved; return approved;
    }
  };
  const host = { plugins: { getPlugin: () => ({ api }) } };
  const bridge = new FcrBridge(host, () => token, async value => { token = value; });
  return { bridge, api, host, requests: () => requests, refreshes: () => refreshes, opens: () => opens, token: () => token,
    revoke() { accepted = null; }, cancel() { approved = null; }, scoped(value: FcrApi) { scoped = value; }, getScoped: () => scoped };
}

test("silent startup without a token never opens authorization", async () => {
  const h = connection(); await assert.rejects(h.bridge.connect(), /尚未获得 FCR 授权/);
  assert.equal(h.requests(), 0); assert.equal(h.bridge.connected, false);
});
test("explicit connection obtains and saves the scoped grant", async () => {
  const h = connection(); await h.bridge.connect(true); assert.equal(h.requests(), 1); assert.equal(h.token(), "new-grant"); assert.equal(h.bridge.connected, true);
  await h.bridge.connect(true); assert.equal(h.requests(), 1);
});
test("revoked authorization is replaced on the next explicit connection", async () => {
  const h = connection("old"); await h.bridge.connect(); h.revoke();
  await h.bridge.connect(true); assert.equal(h.requests(), 1); assert.equal(h.bridge.connected, true);
});
test("missing read scope resets connected state and allows reauthorization", async () => {
  const h = connection("old"), working = h.getScoped(); await h.bridge.connect();
  h.scoped({ ...working, getAllEvents: () => { throw new Error("Missing required scope: events:read"); } });
  await assert.rejects(h.bridge.connect(), /重新授权/); assert.equal(h.bridge.connected, false);
  h.api.requestAccess = async () => { h.scoped(working); return "old"; };
  await h.bridge.connect(true); assert.equal(h.bridge.connected, true);
});
test("canceling authorization does not refresh, open a calendar, or claim a connection", async () => {
  const h = connection(); h.cancel(); await assert.rejects(h.bridge.connect(true), /未完成 FCR 授权/);
  assert.equal(h.bridge.connected, false); assert.equal(h.refreshes(), 0); assert.equal(h.opens(), 0); assert.equal(h.token(), null);
});
test("token persistence failure never publishes an unpersisted connection", async () => {
  const h = connection(), bridge = new FcrBridge(h.host, () => null, async () => { throw new Error("secret storage failed"); });
  await assert.rejects(bridge.connect(true), /secret storage failed/); assert.equal(bridge.connected, false);
});
test("overlapping startup and toolbar requests share one authorization prompt", async () => {
  const h = connection(); let release!: (value: string | null) => void;
  const token = new Promise<string | null>(resolve => { release = resolve; });
  const bridge = new FcrBridge(h.host, () => token, async () => {});
  const startup = assert.rejects(bridge.connect(), /尚未获得/);
  const first = bridge.connect(true), second = bridge.connect(true); release(null);
  await Promise.all([startup, first, second]); assert.equal(h.requests(), 1); assert.equal(bridge.connected, true);
});
