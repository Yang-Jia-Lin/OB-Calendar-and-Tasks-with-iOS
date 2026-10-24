"use strict";
const http = require("node:http");
const fs = require("node:fs");
const path = require("node:path");
const root = path.resolve(__dirname, "..");
const types = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8" };
const server = http.createServer((req, res) => {
  if (req.method !== "GET") { res.writeHead(405); res.end(); return; }
  let pathname;
  try { pathname = decodeURIComponent(new URL(req.url, "http://localhost").pathname); } catch { res.writeHead(400); res.end(); return; }
  const allowed = ["/", "/Preview/index.html", "/Preview/mock-obsidian.js", "/dist/simple-task-timer/main.js", "/styles.css"];
  if (!allowed.includes(pathname)) { res.writeHead(404); res.end(); return; }
  const target = pathname === "/dist/simple-task-timer/main.js"
    ? path.resolve(root, "../../../Results/Reference/simple-task-timer/main.js")
    : path.join(root, pathname === "/" ? "Preview/index.html" : pathname.slice(1));
  fs.readFile(target, (error, data) => {
    if (error) { res.writeHead(404); res.end(); return; }
    res.writeHead(200, { "content-type": types[path.extname(target)] || "application/octet-stream", "cache-control": "no-store" });
    res.end(data);
  });
});
server.listen(Number(process.env.STT_PREVIEW_PORT || 0), "127.0.0.1", () => console.log(`http://127.0.0.1:${server.address().port}/`));
