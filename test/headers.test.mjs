import assert from 'node:assert/strict';
import test from 'node:test';
import { headersFor, parseHeaderBlocks } from '../src/build/headers.mjs';

const sample = `# comment
/*
  Content-Security-Policy: connect-src 'self'
  X-Frame-Options: DENY

/*.html
  Cache-Control: no-cache

/admin.html
  Content-Security-Policy: connect-src 'self' https://api.github.com
  X-Robots-Tag: noindex
`;

test('admin headers override the global policy only on that page', () => {
  const blocks = parseHeaderBlocks(sample);
  const home = headersFor('/index.html', blocks);
  const admin = headersFor('/admin.html', blocks);
  assert.equal(home['Content-Security-Policy'], "connect-src 'self'");
  assert.equal(home['X-Frame-Options'], 'DENY');
  assert.equal(home['Cache-Control'], 'no-cache');
  assert.equal(admin['Content-Security-Policy'], "connect-src 'self' https://api.github.com");
  assert.equal(admin['X-Robots-Tag'], 'noindex');
  assert.equal(admin['X-Frame-Options'], 'DENY');
  assert.equal(headersFor('/assets/css/style.css', blocks)['Cache-Control'], undefined);
});
