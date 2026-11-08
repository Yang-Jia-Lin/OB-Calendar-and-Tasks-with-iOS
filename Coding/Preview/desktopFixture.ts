import path from "node:path";
import fs from "node:fs/promises";
import { DesktopStore } from "../Clients/Desktop/store";
import { DesktopService } from "../Clients/Desktop/service";
import type { Task } from "../Shared/contracts";
export {eventForSegment} from "../Shared/time";
export {withReminderMetadata} from "../Shared/scheduling";
export async function desktopFixture() {
  const root = await fs.mkdtemp(path.resolve("../Agents/Tests/desktop-ui-")), store = new DesktopStore(path.join(root, "state.json"));
  const source = { id: "cal", name: "科研工时", type: "caldav" as const, url: "https://example.test/cal/", username: "sample", secretKey: "key" };
  const tasks: Task[] = ["阅读论文", "整理实验记录", "准备组会"].map((title, i) => ({ id: `Reminder/sample-${i}`, title, due: "2026-12-31", completed: false, kind: "reminder", path: "icloud:sample", listId: "list", calendarId: "cal", revision: "r1", description: "保留手写备注" }));
  await store.update({ settings: { ...store.data.settings, ownershipAcknowledged:true, metadataVerified: true, calendarSources: [source], defaultCalendarId: "cal", reminders: { enabled: true, accountId: "sample", defaultListId: "list", calendarMap: { list: "cal" } } }, reminders: { ...store.data.reminders, accountId: "sample", items: tasks, lists: [{ id: "list", name: "科研" }] }, calendar: { version: 1, sources: { cal: { authority: JSON.stringify([source.type, source.url, source.username]), resources: [], syncedAt: 1 } } } });
  const service = new DesktopService(store, { async call() { throw new Error("offline fixture"); } }, { async get() { return "fixture"; }, async set() {} }, async () => { throw new Error("offline fixture"); }); await service.initialize(false);
  return { service, store, async dispose() { await service.close(); await fs.rm(root, { recursive: true, force: true }); } };
}
