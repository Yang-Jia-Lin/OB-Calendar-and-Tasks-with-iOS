import http from 'node:http';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
const root = path.resolve(import.meta.dirname, '../../Results/Preview');
const server = http.createServer(async (req, res) => {
  const pathname = new URL(req.url, 'http://localhost').pathname;
  const files = { '/': 'index.html', '/index.html': 'index.html', '/app.js': 'app.js', '/styles.css': 'styles.css' };
  if (!files[pathname]) { res.writeHead(404); res.end(); return; }
  try { const data = await readFile(path.join(root, files[pathname])); res.setHeader('Content-Type', pathname.endsWith('.js') ? 'text/javascript; charset=utf-8' : pathname.endsWith('.css') ? 'text/css; charset=utf-8' : 'text/html; charset=utf-8'); res.end(data); }
  catch { res.writeHead(503); res.end('Run npm run build first.'); }
});
const port = Number(process.env.CTT_PREVIEW_PORT || 4173); server.listen(port, '127.0.0.1', () => console.log(`Preview: http://127.0.0.1:${port}`));
