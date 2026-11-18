// Local preview:  node dev-server.mjs
// Rebuilds dist/ first, then serves it with the same security headers as
// production (read from dist/_headers), so problems show up before going live.
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { existsSync, readFileSync } from 'node:fs';
import { extname, join, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { headersFor, parseHeaderBlocks } from './src/build/headers.mjs';

await import('./build.mjs');

const root = resolve(fileURLToPath(new URL('./dist/', import.meta.url)));
const port = Number(process.env.PORT) || 4173;

const types = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
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

// Headers from dist/_headers, including the admin-only Content-Security-Policy.
// HSTS and HTTPS upgrades are left out locally (plain http://localhost).
const headerBlocks = parseHeaderBlocks(readFileSync(join(root, '_headers'), 'utf8'));
function responseHeaders(pathname) {
  const headers = headersFor(pathname, headerBlocks);
  delete headers['Strict-Transport-Security'];
  if (headers['Content-Security-Policy']) {
    headers['Content-Security-Policy'] = headers['Content-Security-Policy'].replace(/;\s*upgrade-insecure-requests/g, '');
  }
  return headers;
}

createServer(async (req, res) => {
  let pathname = '/';
  try {
    pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
  } catch {
    res.writeHead(400).end('Bad request');
    return;
  }
  // GitHub Pages serves services.html at /services (no trailing slash) and
  // still serves the .html address. Mirror that so preview links match production.
  if (pathname.endsWith('/')) pathname += 'index.html';
  else if (!extname(pathname)) {
    const htmlPath = `${pathname}.html`;
    const candidate = resolve(join(root, htmlPath));
    if ((candidate === root || candidate.startsWith(root + sep)) && existsSync(candidate)) pathname = htmlPath;
  }
  const file = resolve(join(root, pathname));
  const headers = responseHeaders(pathname);
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
    res.writeHead(404, { ...responseHeaders('/404.html'), 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' });
    res.end(page);
  }
}).listen(port, () => {
  console.log(`Preview running at http://localhost:${port} (serving dist/)`);
});
