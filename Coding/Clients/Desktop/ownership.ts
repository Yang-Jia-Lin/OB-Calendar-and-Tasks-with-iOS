import { createServer } from "node:net";
import { createHash } from "node:crypto";
import { homedir, tmpdir } from "node:os";
import path from "node:path";
/** OS-owned local lease, shared with full OB 0.7.0. It exposes no control API or user data. */
export async function acquireWriterLease(scope=homedir().toLowerCase()) {
  const key=createHash("sha256").update(scope).digest("hex").slice(0,24);
  const address=process.platform==="win32"?`\\\\.\\pipe\\calendar-task-timer-writer-${key}`:path.join(tmpdir(),`ctt-writer-${key}.sock`);
  const server=createServer(socket=>{socket.on("error",()=>{});socket.destroy();});
  await new Promise<void>((resolve,reject)=>{server.once("error",error=>reject(new Error((error as NodeJS.ErrnoException).code==="EADDRINUSE"?"本机已有计时／同步宿主。请先退出桌面应用，再加载旧插件完成交接；不要同时运行两个写入者。":"无法建立本机宿主互斥，请核对本机权限后重试。")));server.listen(address,()=>resolve());});
  let released=false;
  return {release:async()=>{if(released)return;released=true;await new Promise<void>(resolve=>server.close(()=>resolve()));}};
}
