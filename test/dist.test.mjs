import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import test from 'node:test';

test('built site hides the admin and renders products without photos as before', () => {
  const built = spawnSync(process.execPath, ['build.mjs'], { encoding: 'utf8' });
  assert.equal(built.status, 0, built.stderr || built.stdout);

  const read = (path) => readFileSync(path, 'utf8');
  const produits = read('dist/produits.html');
  const admin = read('dist/admin.html');
  const index = read('dist/index.html');
  const robots = read('dist/robots.txt');
  const sitemap = read('dist/sitemap.xml');
  const headers = read('dist/_headers');
  const htaccess = read('dist/.htaccess');

  const placeholder = '<img decoding="async" src="assets/img/blank-11.svg" alt="" loading="lazy" draggable="false">';
  assert.equal(produits.split(placeholder).length - 1, 48);
  assert.equal(produits.includes('<img decoding="async" src="assets/img/produits/'), false);
  assert.match(produits, /Huit familles, un seul fournisseur\./);
  assert.doesNotMatch(produits, /admin\.html/);

  assert.match(admin, /<meta name="robots" content="noindex">/);
  assert.match(admin, /connect-src 'self' https:\/\/api\.github\.com/);
  assert.match(admin, /img-src 'self' data: blob:/);
  assert.match(admin, /assets\/js\/admin\.js\?v=/);
  assert.match(admin, /assets\/css\/admin\.css\?v=/);
  assert.doesNotMatch(admin, /<nav class="nav"/);
  assert.doesNotMatch(admin, /\{\{extra\}\}/);
  assert.doesNotMatch(index, /api\.github\.com/);
  assert.doesNotMatch(index, /admin\.html/);
  assert.doesNotMatch(index, /\{\{extra\}\}/);

  assert.match(robots, /Disallow: \/pr\/admin\.html/);
  assert.match(robots, /Disallow: \/pr\/404\.html/);
  assert.doesNotMatch(sitemap, /admin\.html/);
  assert.match(headers, /\/admin\.html\n {2}Content-Security-Policy:.*api\.github\.com/);
  assert.match(htaccess, /<Files "admin\.html">/);
  assert.match(read('dist/assets/js/admin.js'), /Câble rigide U-1000 R2V/);
  assert.match(read('dist/assets/js/admin.js'), /from '\.\/catalogue\.js\?v=/);
  assert.match(read('dist/assets/js/admin.js'), /https:\/\/slahmaid\.github\.io\/pr/);
});
