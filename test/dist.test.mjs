import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { gzipSync } from 'node:zlib';
import test from 'node:test';

const MAX_HTML = 150 * 1024;
const PAGE_SIZE = 20;
const FAMILY_WORDS = [null, 'Une', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf', 'Dix', 'Onze', 'Douze'];

test('built site hides the admin and keeps the public catalogue light', () => {
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
  const catalogue = JSON.parse(read('src/data/produits.json'));
  const searchIndex = JSON.parse(read('dist/data/produits-index.json'));

  assert.equal(produits.includes('class="pitem"'), false, 'overview must not inline the full catalogue');
  assert.equal(produits.includes('<img decoding="async" src="assets/img/produits/'), false);
  const familyCount = catalogue.categories.length;
  const heading = familyCount <= 1
    ? 'Une famille, un seul fournisseur.'
    : `${FAMILY_WORDS[familyCount] || familyCount} familles, un seul fournisseur.`;
  assert.match(produits, new RegExp(heading.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  assert.match(produits, /Prumysl Solaire/);
  assert.match(produits, /prumysl-solaire\.html/);
  assert.match(produits, /data-catalogue-search/);
  assert.match(produits, /data\/produits-index\.json\?v=/);
  assert.match(produits, /assets\/js\/catalogue-ui\.js\?v=/);
  assert.doesNotMatch(produits, /admin\.html/);
  assert.ok(statSync('dist/produits.html').size < MAX_HTML);

  for (const cat of catalogue.categories) {
    const file = `produits-${cat.id}.html`;
    const dataFile = `data/produits-${cat.id}.json`;
    const html = read(`dist/${file}`);
    const data = JSON.parse(read(`dist/${dataFile}`));
    const expected = catalogue.products.filter((p) => p.cat === cat.id);
    const first = Math.min(PAGE_SIZE, expected.length);

    assert.ok(statSync(`dist/${file}`).size < MAX_HTML, `${file} is too large`);
    assert.equal(html.split('class="pitem"').length - 1, first);
    assert.match(html, /assets\/js\/catalogue-ui\.js\?v=/);
    assert.match(html, new RegExp(`data/produits-${cat.id}\\.json\\?v=`));
    assert.match(sitemap, new RegExp(file.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    assert.equal(data.id, cat.id);
    assert.equal(data.products.length, expected.length);
    assert.deepEqual(data.products.map((p) => p.id), expected.map((p) => p.id));
    assert.match(html, /data-add-quote/);
    assert.match(html, /data-quote-drawer/);
    assert.match(html, /data-catalogue-pager/);
    assert.match(html, /aria-label="Pagination du catalogue"/);
    assert.doesNotMatch(html, /Charger plus/);
    assert.doesNotMatch(html, /data-load-more/);
  }

  // Homepage still reaches at least the original families; leftover #cat- hashes should be gone.
  assert.match(index, /produits-cables\.html/);
  assert.doesNotMatch(index, /produits\.html#cat-/);
  assert.doesNotMatch(index, /admin\.html/);
  assert.doesNotMatch(index, /api\.github\.com/);
  assert.doesNotMatch(index, /\{\{extra\}\}/);

  const ext = read('dist/produits-eclairage-ext.html');
  assert.match(ext, /Projecteur solaire/);
  assert.match(ext, /id="p-projecteur-solaire"/);

  assert.equal(searchIndex.p.length, catalogue.products.length);
  assert.ok(gzipSync(readFileSync('dist/data/produits-index.json')).length < 200 * 1024);

  assert.match(admin, /<meta name="robots" content="noindex">/);
  assert.match(admin, /connect-src 'self' https:\/\/api\.github\.com/);
  assert.match(admin, /img-src 'self' data: blob:/);
  assert.match(admin, /assets\/js\/admin\.js\?v=/);
  assert.match(admin, /assets\/css\/admin\.css\?v=/);
  assert.doesNotMatch(admin, /<nav class="nav"/);
  assert.doesNotMatch(admin, /\{\{extra\}\}/);
  assert.ok(statSync('dist/admin.html').size < 80 * 1024, 'admin.html must stay a shell');

  const adminJs = read('dist/assets/js/admin.js');
  assert.ok(adminJs.length < 120 * 1024, `admin.js inlined the catalogue (${adminJs.length} bytes)`);
  assert.match(adminJs, /const SEED = null;/);
  assert.doesNotMatch(adminJs, /const SEED = \{/);
  assert.match(adminJs, /data\/produits\.json\?v=/);
  assert.doesNotMatch(adminJs, /__CATALOGUE_URL__/);
  assert.match(adminJs, /Pagination du catalogue/);
  const published = JSON.parse(read('dist/data/produits.json'));
  assert.equal(published.categories.length, catalogue.categories.length);
  assert.equal(published.products.length, catalogue.products.length);
  assert.equal(published.products.find((p) => p.id === 'projecteur-solaire').cat, 'eclairage-ext');

  assert.match(robots, /Disallow: \/pr\/admin\.html/);
  assert.match(robots, /Disallow: \/pr\/404\.html/);
  assert.doesNotMatch(sitemap, /admin\.html/);
  assert.match(headers, /\/admin\.html\n {2}Content-Security-Policy:.*api\.github\.com/);
  assert.match(headers, /\/data\/\*/);
  assert.match(htaccess, /<Files "admin\.html">/);
  assert.match(htaccess, /AddType application\/json \.json/);
  assert.match(read('dist/assets/js/admin.js'), /from '\.\/catalogue\.js\?v=/);
  assert.match(read('dist/assets/js/admin.js'), /https:\/\/slahmaid\.github\.io\/pr/);
});
