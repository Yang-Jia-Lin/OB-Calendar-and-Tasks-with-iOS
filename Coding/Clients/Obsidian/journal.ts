import fs from "node:fs/promises";
import path from "node:path";
import { blankJournal, validateJournal } from "../../Shared/timer";
import { type Journal } from "../../Shared/contracts";
import type { CategoryPreferences } from "./categories";
import type { TaskSort } from "./taskOrder";
type WriterSlot = { owner: symbol; tail: Promise<void> };
const writerKey = Symbol.for("calendar-task-timer.journal-writers.v1");
const writers: Map<string, WriterSlot> = (globalThis as any)[writerKey] ||= new Map();
export class JournalStore {
  private lastGood = "";
  private readonly owner = Symbol(); private readonly slot: WriterSlot;
  constructor(readonly file: string) {
    const key = path.resolve(file).toLowerCase(); this.slot = writers.get(key) || { owner: this.owner, tail: Promise.resolve() };
    this.slot.owner = this.owner; writers.set(key, this.slot);
  }
  async load(): Promise<Journal> {
    await this.slot.tail;
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    try { const raw = await fs.readFile(this.file, "utf8"); const s = validateJournal(JSON.parse(raw)); this.lastGood = raw; return s; }
    catch (e) {
      const missing = (e as NodeJS.ErrnoException).code === "ENOENT";
      try {
        const previous = await fs.readFile(this.file + ".previous", "utf8"), s = validateJournal(JSON.parse(previous));
        if (!missing) await fs.copyFile(this.file, `${this.file}.damaged-${Date.now()}`);
        this.lastGood = previous; return s;
      } catch { if (missing) { if (await fs.stat(this.file + ".previous").catch(() => null)) throw new Error("日志备份损坏，停止加载以保护数据。"); return blankJournal(); }
        throw new Error("计时日志损坏，未覆盖原文件。请保留 sessions 文件夹检查。"); }
    }
  }
  save(state: Journal) {
    const snapshot = JSON.parse(JSON.stringify(state)) as Journal;
    const next = this.slot.tail.then(() => { if (this.slot.owner !== this.owner) throw new Error("旧插件实例已停止写入日志。"); return this.write(snapshot); });
    this.slot.tail = next.catch(() => {}); return next;
  }
  private async write(state: Journal) {
    validateJournal(state); const raw = JSON.stringify(state, null, 2), temp = this.file + ".tmp";
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    const write = async (file: string, data: string) => { const handle = await fs.open(file, "w", 0o600); try { await handle.writeFile(data, "utf8"); await handle.sync(); } finally { await handle.close(); } };
    await write(temp, raw);
    if (this.lastGood) { await write(this.file + ".previous.tmp", this.lastGood); await fs.rename(this.file + ".previous.tmp", this.file + ".previous"); }
    await fs.rename(temp, this.file); this.lastGood = raw;
  }
}
export interface Settings extends CategoryPreferences { defaultCalendarId: string; tasksPath: string; importedLegacy: boolean; fontSize?: number; fontWeight?: number; taskSort?: TaskSort }
export function prepareLegacyImport(legacySettings: Record<string, unknown>, raw: unknown, current: Journal, legacyEnabled: boolean) {
  if (legacyEnabled) throw new Error("请先停止旧版计时，并在第三方插件中禁用“简洁待办计时”。");
  if (current.active || current.records.length || current.operations.length || current.deletions?.length) throw new Error("新版已有记录，不能覆盖导入。请保留当前日志。");
  const journal = validateJournal(raw);
  if (journal.active) throw new Error("旧版仍有未结束会话，请回旧版结束后再导入。");
  const settings = {
    defaultCalendarId: typeof legacySettings.targetCalendarId === "string" ? legacySettings.targetCalendarId : "",
    tasksPath: typeof legacySettings.tasksPath === "string" ? legacySettings.tasksPath : "待办计时/待办.md", importedLegacy: true
  } satisfies Settings;
  journal.legacyImport = { defaultCalendarId: settings.defaultCalendarId, tasksPath: settings.tasksPath };
  return { journal, settings };
}
