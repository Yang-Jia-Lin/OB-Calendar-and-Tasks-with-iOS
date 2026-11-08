import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomBytes, timingSafeEqual } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { DesktopService } from "./service";
import type { DesktopCommand } from "./protocol";
export interface Discovery { version: 1; port: number; token: string; pid: number }
async function body(request: IncomingMessage) {
  const parts: Buffer[] = []; let length = 0;
  for await (const chunk of request) { length += chunk.length; if (length > 2 * 1024 * 1024) throw new Error("本机请求过大。"); parts.push(chunk); }
  return parts.length ? JSON.parse(Buffer.concat(parts).toString("utf8")) : {};
}
export async function startServer(service: DesktopService, discoveryFile: string) {
  const token = randomBytes(32).toString("hex"), streams = new Set<ServerResponse>();
  const send = (response: ServerResponse, status: number, data: unknown) => { response.writeHead(status, { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store", "X-Content-Type-Options": "nosniff" }); response.end(JSON.stringify(data)); };
  let port = 0;
  const server = createServer((request, response) => { void (async () => {
    const auth = request.headers.authorization || "", expected = "Bearer " + token;
    // Node-only OB transport has no browser Origin; ordinary web pages cannot control the timer.
    if (request.headers.origin || request.headers.host !== "127.0.0.1:" + port || auth.length !== expected.length || !timingSafeEqual(Buffer.from(auth), Buffer.from(expected))) { send(response, 403, { error: "本机连接验证失败。" }); return; }
    const url = new URL(request.url || "/", "http://127.0.0.1");
    if (request.method === "GET") {
      if (url.pathname === "/v1/state") { send(response, 200, service.snapshot()); return; }
      if (url.pathname === "/v1/record") { send(response,200,service.record(url.searchParams.get("id")||""));return; }
      if (url.pathname === "/v1/day") { send(response, 200, service.day(url.searchParams.get("date") || "")); return; }
      if (url.pathname === "/v1/history") { send(response, 200, service.history(url.searchParams.get("from") || "", url.searchParams.get("to") || "", Number(url.searchParams.get("offset") || 0))); return; }
      if (url.pathname === "/v1/events") {
        response.writeHead(200, { "Content-Type": "text/event-stream", "Cache-Control": "no-store", Connection: "keep-alive" });
        streams.add(response); response.write("event: state\ndata: " + JSON.stringify(service.snapshot()) + "\n\n");
        request.on("close", () => streams.delete(response)); return;
      }
    }
    if (request.method === "POST") {
      const input = await body(request); let result: unknown;
      switch (url.pathname) {
        case "/v1/command": result = await service.command(input as DesktopCommand); break;
        case "/v1/refresh": await service.refresh(); result = { ok: true }; break;
        case "/v1/auth": result = await service.authenticate(input); break;
        case "/v1/calendar": result = await service.addCalendar(input); break;
        case "/v1/retry": await service.retry(input.key); result = { ok: true }; break;
        case "/v1/metadata-probe": result = await service.metadataProbe(input.check === true); break;
        case "/v1/migration-preview": result = await service.migrationPreview(input.directory); break;
        case "/v1/migration-import": result = await service.migrationImport(input.directory, input.digest); break;
        default: send(response, 404, { error: "未知接口。" }); return;
      }
      send(response, 200, result); return;
    }
    send(response, 404, { error: "未知接口。" });
  })().catch(error => { if (!response.headersSent) send(response, 400, { error: error instanceof Error ? error.message : "本机操作失败。" }); else response.end(); }); });
  server.requestTimeout = 65000; server.headersTimeout = 10000;
  await new Promise<void>((resolve, reject) => { server.once("error", reject); server.listen(0, "127.0.0.1", () => { server.off("error", reject); resolve(); }); });
  port = (server.address() as { port: number }).port;
  const discovery: Discovery = { version: 1, port, token, pid: process.pid };
  await fs.mkdir(path.dirname(discoveryFile), { recursive: true });
  await fs.writeFile(discoveryFile + ".tmp", JSON.stringify(discovery), { mode: 0o600 }); await fs.rename(discoveryFile + ".tmp", discoveryFile);
  const unsubscribe = service.subscribe(() => { const data = "event: state\ndata: " + JSON.stringify(service.snapshot()) + "\n\n"; for (const stream of streams) { if (stream.writableLength > 4 * 1024 * 1024) { streams.delete(stream); stream.destroy(); } else stream.write(data); } });
  const keepalive = setInterval(() => { for (const stream of streams) stream.write(": heartbeat\n\n"); }, 30000); keepalive.unref();
  return { discovery, close: async () => {
    clearInterval(keepalive); unsubscribe(); for (const stream of streams) stream.end();
    await new Promise<void>(resolve => server.close(() => resolve()));
    try { const old = JSON.parse(await fs.readFile(discoveryFile, "utf8")); if (old.token === token) await fs.rm(discoveryFile); } catch {}
  } };
}
