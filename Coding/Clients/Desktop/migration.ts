import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import { blankDesktop, type DesktopData } from "./store";
import { validateJournal } from "../../Shared/timer";
import { calendarSources } from "../../Providers/Calendar/config";
import { reminderSettings } from "../../Providers/Reminders/provider";
import { componentTaskBindings, componentTaskSnapshots } from "../Obsidian/components";
import { ProtectedSecrets, protectDirectory } from "./runtime";
import type { Task } from "../../Shared/contracts";
export interface DesktopExport {
  version: 1; id: string; sourcePluginDir: string; exportedAt: string; stopped: true;
  data: DesktopData; hashes: Record<string, string>;
}
const hash = (raw: string | Buffer) => createHash("sha256").update(raw).digest("hex");
async function privateFiles(root: string, prefix = ""): Promise<string[]> {
  const out: string[] = [];
  for (const file of await fs.readdir(path.join(root, prefix), { withFileTypes: true })) {
    if (file.isSymbolicLink()) throw new Error("迁移文件不能包含符号链接。");
    const relative = path.join(prefix, file.name);
    if (file.isDirectory()) out.push(...await privateFiles(root, relative)); else if (file.isFile()) out.push(relative);
  } return out;
}
export async function exportDesktop(input: { pluginDir: string; settings: any; journal: DesktopData["journal"]; reminders: DesktopData["reminders"]; legacyTasks: Task[]; secret(key: string): Promise<string | null>; reminderRoot: string }) {
  if (input.journal.active) throw new Error("请先结束旧插件计时。");
  const id = randomUUID(), root = path.join(process.env.LOCALAPPDATA || "", "CalendarTaskTimer/DesktopExports", id);
  await protectDirectory(root);
  const data = blankDesktop(); data.journal = validateJournal(input.journal); data.reminders = input.reminders; data.legacyTasks = input.legacyTasks;
  data.settings = { ...data.settings, defaultCalendarId: input.settings.defaultCalendarId || "", calendarSources: calendarSources(input.settings.calendarSources), reminders: reminderSettings(input.settings.reminders), bindings: componentTaskBindings(input.settings.componentTaskBindings), snapshots: componentTaskSnapshots(input.settings.componentTaskSnapshots), categoryOrder: input.settings.categoryOrder || [], hiddenCategoryIds: input.settings.hiddenCategoryIds || [], migratedFrom: id };
  try { data.calendar = JSON.parse(await fs.readFile(path.join(input.pluginDir, "calendar-cache.json"), "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  // Credentials remain DPAPI-protected, and reminder cookies/wire identities stay under private ACLs.
  const secrets = new ProtectedSecrets(path.join(root, "secrets.dpapi"));
  for (const source of data.settings.calendarSources) if (source.secretKey) { const secret = await input.secret(source.secretKey); if (secret) await secrets.set(source.secretKey, secret); }
  const privateRoot = path.join(input.reminderRoot, "private");
  try { for (const file of await privateFiles(privateRoot)) if (file !== "rpc.lock") { const target = path.join(root, "reminder-private", file); await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(privateRoot, file), target); } }
  catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  await fs.writeFile(path.join(root, "legacy-settings.json"), JSON.stringify(input.settings), { mode: 0o600 });
  const hashes: Record<string, string> = {}; for (const file of await privateFiles(root)) hashes[file] = hash(await fs.readFile(path.join(root, file)));
  const exported: DesktopExport = { version: 1, id, sourcePluginDir: path.resolve(input.pluginDir), exportedAt: new Date().toISOString(), stopped: true, data, hashes };
  await fs.writeFile(path.join(root, "export.json"), JSON.stringify(exported), { mode: 0o600 });
  return { id, root };
}
export async function inspectExport(directory: string) {
  if (!path.isAbsolute(directory)) throw new Error("请输入交接目录的绝对路径。");
  const root = await fs.realpath(directory), raw = await fs.readFile(path.join(root, "export.json"), "utf8"), item = JSON.parse(raw) as DesktopExport;
  if (item.version !== 1 || item.stopped !== true || !/^[a-f0-9-]{36}$/i.test(item.id) || !item.data?.settings || !item.hashes || !path.isAbsolute(item.sourcePluginDir)) throw new Error("交接文件无效。");
  validateJournal(item.data.journal); if (item.data.journal.active) throw new Error("交接文件仍有活动计时。");
  calendarSources(item.data.settings.calendarSources);
  await privateFiles(root); // Reject linked subdirectories as well as linked leaf files.
  const source = JSON.parse(await fs.readFile(path.join(item.sourcePluginDir, "data.json"), "utf8"));
  if (source.desktopConnection !== true || source.desktopHandoffId !== item.id) throw new Error("旧插件尚未停止写入，或此快照已过期；请重新执行 OB 交接。");
  for (const [file, checksum] of Object.entries(item.hashes)) {
    const target = path.resolve(root, file);
    if (!target.startsWith(root + path.sep) || file.split(/[\\/]/).includes("..") || (await fs.lstat(target)).isSymbolicLink() || hash(await fs.readFile(target)) !== checksum) throw new Error("交接文件校验失败，停止导入。");
  }
  return { root, item, digest: hash(raw) };
}
export async function importExport(directory: string, expectedHash: string, current: DesktopData, targetRoot: string) {
  const { root, item, digest } = await inspectExport(directory);
  if (digest !== expectedHash) throw new Error("交接快照已变化，请重新预览。");
  if (current.settings.migratedFrom === item.id) return current;
  if (current.settings.migratedFrom || current.journal.active || current.journal.records.length || current.journal.operations.length || current.journal.deletions?.length || current.reminders.operations.length || Object.values(current.receipts).some(r=>!["shutdown","settings.save","calendar.configure","categories.save","ownership.activate"].includes(r.action||"")) || current.reminders.accountId && current.reminders.accountId!==item.data.reminders.accountId || current.settings.calendarSources.some(s=>!item.data.settings.calendarSources.some(old=>old.url===s.url&&old.username===s.username&&old.type===s.type))) throw new Error("桌面已有本地操作或不匹配的账户／连接，禁止覆盖导入。仅相同账户的只读缓存可由交接快照替换。");
  await protectDirectory(targetRoot);
  const backup = path.join(targetRoot, "Migration", item.id); await fs.mkdir(backup, { recursive: true });
  await fs.writeFile(path.join(backup, "before.json"), JSON.stringify(current), { flag: "wx", mode: 0o600 }).catch(e => { if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e; });
  const secrets = new ProtectedSecrets(path.join(root, "secrets.dpapi")), targetSecrets = new ProtectedSecrets(path.join(targetRoot, "secrets.dpapi"));
  for (const source of item.data.settings.calendarSources) if (source.secretKey) { const value = await secrets.get(source.secretKey); if (value) await targetSecrets.set(source.secretKey, value); }
  for (const file of Object.keys(item.hashes).filter(file => file.startsWith("reminder-private" + path.sep) || file.startsWith("reminder-private/"))) {
    const relative = file.slice("reminder-private".length + 1), target = path.join(targetRoot, "Reminders/private", relative);
    await fs.mkdir(path.dirname(target), { recursive: true }); await fs.copyFile(path.join(root, file), target);
  }
  await fs.copyFile(path.join(root, "export.json"), path.join(backup, "imported-export.json"));
  return { ...item.data, revision: current.revision, receipts: {}, settings: { ...item.data.settings, ownershipAcknowledged:true, metadataVerified: false, migratedFrom: item.id } };
}
