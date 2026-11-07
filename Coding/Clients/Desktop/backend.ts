import path from "node:path";
import fs from "node:fs/promises";
import { createInterface } from "node:readline";
import { DesktopStore } from "./store";
import { DesktopService } from "./service";
import { BundledReminders, ProtectedSecrets, protectDirectory } from "./runtime";
import { startServer } from "./server";
import { acquireWriterLease } from "./ownership";
const root = process.env.CTT_DESKTOP_DATA || path.join(process.env.LOCALAPPDATA || "", "CalendarTaskTimer", "Desktop");
const resources = path.resolve(process.argv[2] || path.dirname(process.argv[1]));
async function main() {
  if (!path.isAbsolute(root)) throw new Error("应用数据目录必须为绝对路径。");
  await protectDirectory(root);
  const lease=process.env.CTT_DESKTOP_OFFLINE==="1"?undefined:await acquireWriterLease();
  const lock = path.join(root, "backend.lock");
  try { await fs.writeFile(lock, String(process.pid), { flag: "wx" }); }
  catch (e) {
    if ((e as NodeJS.ErrnoException).code !== "EEXIST") throw e;
    const pid = Number(await fs.readFile(lock, "utf8"));
    let alive = false; try { process.kill(pid, 0); alive = true; } catch (error) { if ((error as NodeJS.ErrnoException).code !== "ESRCH") alive = true; }
    if (alive || !Number.isSafeInteger(pid) || pid <= 0) throw new Error("已有桌面后台运行或锁状态不确定，停止启动第二个写入者。");
    await fs.rm(lock); await fs.writeFile(lock, String(process.pid), { flag: "wx" });
  }
  const runtime = new BundledReminders(resources, path.join(root, "Reminders"));
  const service = new DesktopService(new DesktopStore(path.join(root, "state.json")), runtime, new ProtectedSecrets(path.join(root, "secrets.dpapi")));
  service.isolated=process.env.CTT_DESKTOP_OFFLINE==="1";
  try { await service.initialize(process.env.CTT_DESKTOP_OFFLINE !== "1"); } catch (e) { await fs.rm(lock, { force: true }); throw e; }
  const server = await startServer(service, path.join(root, "connection.json"));
  process.stdout.write(JSON.stringify({ event: "ready", ...server.discovery }) + "\n");
  const off = service.subscribe(() => process.stdout.write(JSON.stringify({ event: "state", data: service.snapshot() }) + "\n"));
  let stopping = false;
  const stop = async () => {
    if (stopping) return; stopping = true;
    try { await service.command({ version: 1, requestId: "shutdown-" + Date.now(), action: "shutdown" }); await service.close(); off(); await server.close(); await fs.rm(lock, { force: true }); await lease?.release();process.exit(0); }
    catch { process.stderr.write("退出保存失败；保留日志供恢复。\n"); process.exit(1); }
  };
  const input = createInterface({ input: process.stdin });
  input.on("line", line => { try { const message = JSON.parse(line); if (message.action === "shutdown") void stop(); if (message.action === "suspend" || message.action === "resume") void service.clockCheckpoint().catch(() => {}); if (message.action === "time-change") void service.systemClockChanged().catch(() => {}); } catch {} });
  input.on("close", () => { void stop(); }); process.on("SIGINT", () => { void stop(); }); process.on("SIGTERM", () => { void stop(); });
}
// A startup failure can happen after acquiring the named-pipe lease. Merely
// setting exitCode leaves that server alive, so the native host would wait
// forever for a ready event. No command has been accepted at this point.
void main().catch(error => { process.stderr.write((error instanceof Error ? error.message : "桌面后台启动失败") + "\n", () => process.exit(1)); });
