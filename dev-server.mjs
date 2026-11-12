// Local preview:  node dev-server.mjs
// Rebuilds dist/ first, then serves it with the same security headers as
// production (read from dist/_headers), so problems show up before going live.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

await import('./build.mjs');

const root = resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const port = Number(process.env.PORT) || 4173;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.xml': 'application/xml; charset=utf-8',
  '.txt': 'text/plain; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.woff2': 'font/woff2',
};

// Global headers from the "/*" block of _headers. HSTS and HTTPS upgrades are
// left out locally because the preview runs on plain http://localhost.
const headers = {};
let inGlobal = false;
for (const line of readFileSync(join(root, '_headers'), 'utf8').split(/\r?\n/)) {
  if (!line.trim() || line.trim().startsWith('#')) continue;
  if (!/^\s/.test(line)) { inGlobal = line.trim() === '/*'; continue; }
  if (!inGlobal) continue;
  const i = line.indexOf(':');
  headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
}
delete headers['Strict-Transport-Security'];
if (headers['Content-Security-Policy']) {
  headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/, '');
}

createServer(async (req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  if (pathname.endsWith('/')) pathname += 'index.html';
  const file = resolve(join(root, pathname));
  if (file !== root && !file.startsWith(root + sep)) {
    res.writeHead(403, headers).end('Forbidden');
    return;
  }
  try {
    const data = await readFile(file);
    res.writeHead(200, { ...headers, 'Content-Type': types[extname(file).toLowerCase()] || 'application/octet-stream', 'Cache-Control': 'no-store' });
    res.end(data);
  } catch {
    const page = await readFile(join(root, '404.html')).catch(() => 'Not found');
    res.writeHead(404, { ...headers, 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
  }
}).listen(port, () => {
  console.log(`Preview running at http://localhost:${port} (serving dist/)`);
});
