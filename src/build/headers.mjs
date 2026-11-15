// Minimal Netlify/Cloudflare `_headers` reader. Later matching blocks override
// earlier ones, which is how a single admin page can relax connect-src.
export function parseHeaderBlocks(text) {
  const blocks = [];
  let current = null;
  for (const line of String(text).split(/\r?\n/)) {
    if (!line.trim() || line.trim().startsWith('#')) continue;
    if (!/^\s/.test(line)) {
      current = { pattern: line.trim(), headers: {} };
      blocks.push(current);
      continue;
    }
    if (!current) continue;
    const i = line.indexOf(':');
    if (i < 1) continue;
    current.headers[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return blocks;
}

function matchPath(pattern, pathname) {
  const body = pattern.split('*').map((part) => part.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('.*');
  return new RegExp(`^${body}$`).test(pathname);
}

export function headersFor(pathname, blocks) {
  const headers = {};
  for (const block of blocks) {
    if (matchPath(block.pattern, pathname)) Object.assign(headers, block.headers);
  }
  return headers;
}
