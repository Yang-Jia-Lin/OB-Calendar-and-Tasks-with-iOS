import fs from "node:fs/promises";
import path from "node:path";
import { AsyncLocalStorage } from "node:async_hooks";
import { randomUUID } from "node:crypto";
import { blankJournal, validateJournal } from "../../Shared/timer";
import { blankReminders, reminderSettings, type ReminderData } from "../../Providers/Reminders/provider";
import type { CalendarCache } from "../../Providers/Calendar/engine";
import { clone, type Journal, type Task } from "../../Shared/contracts";
import type { CommandResult, DesktopSettings } from "./protocol";
export interface UndoEntry { id: string; task: Task; before: string | null; after: string | null; undone?: boolean }
export interface DesktopData {
  version: 1; revision: number; journal: Journal; reminders: ReminderData; calendar?: CalendarCache;
  settings: DesktopSettings; undo: UndoEntry[];
  legacyTasks?: Task[];
  receipts: Record<string, { fingerprint: string; result: CommandResult; action?:string }>;
}
export const blankDesktop = (): DesktopData => ({ version: 1, revision: 0, journal: blankJournal(), reminders: blankReminders(),
  settings: { deviceId: randomUUID(), defaultCalendarId: "", calendarSources: [], reminders: reminderSettings(null), bindings: {}, snapshots: {}, metadataVerified: false,ownershipAcknowledged:false }, undo: [], receipts: {} });
type Partition = "journal" | "reminders" | "settings" | "undo";
interface ReceiptContext { id: string; fingerprint: string; partition: Partition; action:string; result: (data: DesktopData) => CommandResult }
/** Receipts are committed in the SAME fsync/rename as the actual mutation. */
export class DesktopStore {
  data = blankDesktop(); private tail: Promise<unknown> = Promise.resolve();
  private backupFromMemory = false;
  private context = new AsyncLocalStorage<ReceiptContext>();
  constructor(readonly file: string) {}
  private parse(raw: string): DesktopData {
    const d = JSON.parse(raw) as DesktopData;
    if (d.version !== 1 || !Number.isInteger(d.revision) || !d.settings?.deviceId || !Array.isArray(d.undo) || !d.receipts || !d.reminders?.operations) throw new Error("桌面数据格式无效。");
    d.journal = validateJournal(d.journal); return d;
  }
  async load() {
    try { this.data = this.parse(await fs.readFile(this.file, "utf8")); }
    catch (e) {
      if ((e as NodeJS.ErrnoException).code === "ENOENT") {
        try { this.data = this.parse(await fs.readFile(this.file + ".previous", "utf8")); this.backupFromMemory = true; } catch (prior) { if ((prior as NodeJS.ErrnoException).code !== "ENOENT") throw prior; }
      } else {
        const prior = this.parse(await fs.readFile(this.file + ".previous", "utf8"));
        await fs.copyFile(this.file, this.file + ".damaged-" + Date.now()); this.data = prior; this.backupFromMemory = true;
      }
    }
    return this.data;
  }
  withReceipt<T>(context: ReceiptContext, fn: () => Promise<T>): Promise<T> { return this.context.run(context, fn); }
  update(patch: Partial<DesktopData>, partition?: Partition) { return this.change(() => patch, partition); }
  change(fn: (current: DesktopData) => Partial<DesktopData>, partition?: Partition): Promise<void> {
    const context = this.context.getStore();
    const next = this.tail.then(async () => {
      const data = { ...this.data, ...clone(fn(this.data)), revision: this.data.revision + 1 };
      if (context && context.partition === partition && !data.receipts[context.id]) data.receipts = { ...data.receipts, [context.id]: { fingerprint: context.fingerprint, action:context.action, result: context.result(data) } };
      this.parse(JSON.stringify(data));
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      const write = async (file: string, raw: string) => { const h = await fs.open(file, "w", 0o600); try { await h.writeFile(raw); await h.sync(); } finally { await h.close(); } };
      await write(this.file + ".tmp", JSON.stringify(data));
      // The old file is already fsynced. A hard link preserves that durable inode
      // without rewriting and fsyncing the whole history a second time per click.
      await fs.rm(this.file + ".previous.tmp", { force: true });
      let linked = false;
      if (!this.backupFromMemory) { try { await fs.link(this.file, this.file + ".previous.tmp"); linked = true; } catch (error) { if (!["ENOENT", "EPERM", "EACCES", "ENOTSUP", "EXDEV"].includes((error as NodeJS.ErrnoException).code || "")) throw error; } }
      if (!linked) await write(this.file + ".previous.tmp", JSON.stringify(this.data));
      await fs.rename(this.file + ".previous.tmp", this.file + ".previous");
      await fs.rename(this.file + ".tmp", this.file); this.data = data; this.backupFromMemory = false;
    });
    this.tail = next.catch(() => {}); return next;
  }
  settled() { return this.tail; }
}
