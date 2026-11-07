import fs from "node:fs/promises";
import path from "node:path";
import { spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { createInterface } from "node:readline";
import { randomUUID } from "node:crypto";
import type { ReminderRpc } from "../../Providers/Reminders/provider";
/** Bundled runtime only: no downloads, pip, global Python, or shared plugin sessions. */
export class BundledReminders implements ReminderRpc {
  private child?: ChildProcessWithoutNullStreams; private starting?: Promise<void>; private closed = false;
  private idle?: ReturnType<typeof setTimeout>;
  private awaitingCode=false;
  private pending = new Map<string, { resolve(v: any): void; reject(e: Error): void }>();
  constructor(private resources: string, private root: string, private idleMs = 30000) {}
  private idleLater(child: ChildProcessWithoutNullStreams) {
    clearTimeout(this.idle);
    // The in-memory 2FA challenge must survive while the user retrieves a code.
    if (this.pending.size || this.closed || this.awaitingCode) return;
    this.idle=setTimeout(()=>{if(this.child===child&&!this.pending.size){this.child=undefined;child.stdin.end();}},this.idleMs);
    this.idle.unref();
  }
  private async start() {
    if (this.closed) throw new Error("提醒事项后台已关闭。");
    if (this.child) return;
    if (this.starting) return this.starting;
    this.starting = (async () => {
      const python = path.join(this.resources, "runtime/python/python.exe"), sdk = path.join(this.resources, "runtime/sdk");
      await fs.access(python).catch(() => { throw new Error("安装包缺少提醒事项运行时，请修复安装；不会在线安装依赖。"); });
      await fs.mkdir(this.root, { recursive: true });
      const child = spawn(python, ["-X", "utf8", "-u", path.join(this.resources, "helper.py"), this.root], { windowsHide: true, stdio: "pipe", env: { ...process.env, PYTHONUTF8: "1", CTT_REMINDERS_SDK: sdk } });
      this.child = child; child.stderr.resume();
      const lines = createInterface({ input: child.stdout });
      lines.on("line", line => { try { const r = JSON.parse(line), p = this.pending.get(r.id); if (!p) return; this.pending.delete(r.id); if(!r.error&&typeof r.result?.needsCode==="boolean")this.awaitingCode=r.result.needsCode; r.error ? p.reject(new Error(r.error)) : p.resolve(r.result); this.idleLater(child); } catch {} });
      const ended = () => { lines.close(); if (this.child !== child) return; this.child = undefined; this.awaitingCode=false;clearTimeout(this.idle); for (const p of this.pending.values()) p.reject(new Error("提醒事项后台断开，原操作已保留，请重试。")); this.pending.clear(); };
      child.once("error", ended); child.once("exit", ended);
    })();
    try { await this.starting; } finally { this.starting = undefined; }
  }
  async call(method: string, args: any = {}) {
    clearTimeout(this.idle);
    await this.start();
    clearTimeout(this.idle);
    return new Promise<any>((resolve, reject) => {
      const id = randomUUID(); this.pending.set(id, { resolve, reject });
      this.child!.stdin.write(JSON.stringify({ id, method, args: { zone: Intl.DateTimeFormat().resolvedOptions().timeZone, ...args } }) + "\n", error => { if (error) { this.pending.delete(id); reject(new Error("提醒事项后台未连接。")); } });
    });
  }
  stop() { this.closed = true; clearTimeout(this.idle); this.child?.stdin.end(); }
}

const powershell = path.join(process.env.SystemRoot || "C:/Windows", "System32/WindowsPowerShell/v1.0/powershell.exe");
export async function protectDirectory(root: string) {
  await fs.mkdir(root, { recursive: true });
  if (process.platform !== "win32") return;
  await new Promise<void>((resolve, reject) => {
    const child = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", '$sid=[System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value;& icacls.exe $env:CTT_PRIVATE_ROOT /inheritance:r /grant:r "*${sid}:(OI)(CI)F" "*S-1-5-18:(OI)(CI)F";exit $LASTEXITCODE'], { windowsHide: true, stdio: "ignore", env: { ...process.env, CTT_PRIVATE_ROOT: root } });
    child.once("error", reject); child.once("exit", code => code === 0 ? resolve() : reject(new Error("无法保护应用数据目录，停止启动。")));
  });
}
export class ProtectedSecrets {
  private values?: Record<string, string>;
  constructor(private file: string) {}
  reload(){this.values=undefined;}
  private crypt(value: string, decrypt: boolean) {
    if (process.platform !== "win32") throw new Error("凭据保护需要 Windows。");
    return new Promise<string>((resolve, reject) => {
      const script = '[void][Reflection.Assembly]::LoadWithPartialName("System.Security");$b=[Convert]::FromBase64String([Console]::In.ReadToEnd());$r=[Security.Cryptography.ProtectedData]::' + (decrypt ? "Unprotect" : "Protect") + '($b,$null,[Security.Cryptography.DataProtectionScope]::CurrentUser);[Console]::Out.Write([Convert]::ToBase64String($r))';
      const p = spawn(powershell, ["-NoProfile", "-NonInteractive", "-Command", script], { windowsHide: true, stdio: "pipe" });
      let output = ""; p.stdout.on("data", b => output += b); p.stderr.resume(); p.once("error", reject);
      p.once("exit", code => code === 0 ? resolve(output) : reject(new Error("Windows 凭据保护失败，未保存明文。"))); p.stdin.end(value);
    });
  }
  private async load() {
    if (this.values) return this.values;
    try { const raw = await fs.readFile(this.file, "utf8"); this.values = JSON.parse(Buffer.from(await this.crypt(raw, true), "base64").toString("utf8")); }
    catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; this.values = {}; }
    return this.values!;
  }
  async get(key: string) { return (await this.load())[key] || null; }
  async set(key: string, value: string) {
    const next = { ...await this.load(), [key]: value };
    const protectedValue = await this.crypt(Buffer.from(JSON.stringify(next)).toString("base64"), false);
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file + ".tmp", protectedValue, { mode: 0o600 }); await fs.rename(this.file + ".tmp", this.file); this.values = next;
  }
}
