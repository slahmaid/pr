import assert from 'node:assert/strict';
import test from 'node:test';
import { readFileSync } from 'node:fs';
import {
  PAGE_SIZE,
  clampPage,
  commitMessage,
  contentsAreComplete,
  deleteCategory,
  deleteProduct,
  familyCounts,
  familyPaths,
  filterProducts,
  imagePath,
  isDirty,
  isProtectedProduct,
  moveCategory,
  pageItems,
  placeProduct,
  planImages,
  protectionError,
  serialize,
  slugify,
  uniqueId,
  upsertProduct,
  validateCategory,
  validateProduct,
} from '../assets/js/catalogue.js';

const doc = {
  _note: 'garder',
  categories: [
    { id: 'cables', label: 'Câbles', icon: 'i-cable', text: 'Câbles et gaines' },
    { id: 'eclairage', label: 'Éclairage', icon: 'i-bulb', text: 'Luminaires' },
  ],
  products: [
    { id: 'cable-r2v', cat: 'cables', name: 'Câble R2V', text: 'Câble d’énergie.' },
    { id: 'gaine', cat: 'cables', name: 'Gaine ICTA', text: 'Conduit annelé.' },
    { id: 'dalle', cat: 'eclairage', name: 'Dalle LED', text: 'Pour bureaux.' },
  ],
};

test('slug stays ascii and unique', () => {
  assert.equal(slugify('Câble rigide U-1000 R2V'), 'cable-rigide-u-1000-r2v');
  assert.equal(slugify('Interrupteur va-et-vient'), 'interrupteur-va-et-vient');
  assert.equal(slugify('Cœur & âme'), 'coeur-ame');
  assert.equal(uniqueId('dalle', new Set(['dalle', 'dalle-2'])), 'dalle-3');
  assert.equal(imagePath('cable-r2v'), 'assets/img/produits/cable-r2v.webp');
});

test('place product inside and across categories', () => {
  const down = placeProduct(doc, 'cable-r2v', 'cables', 1);
  assert.deepEqual(down.products.map((p) => p.id), ['gaine', 'cable-r2v', 'dalle']);
  const up = placeProduct(doc, 'gaine', 'cables', 0);
  assert.deepEqual(up.products.map((p) => p.id), ['gaine', 'cable-r2v', 'dalle']);
  const moved = placeProduct(doc, 'gaine', 'eclairage', 0);
  assert.equal(moved.products.find((p) => p.id === 'gaine').cat, 'eclairage');
  assert.deepEqual(moved.products.map((p) => p.id), ['cable-r2v', 'gaine', 'dalle']);
});

test('new product is inserted at the requested position', () => {
  const next = upsertProduct(doc, {
    id: 'fil',
    cat: 'cables',
    name: 'Fil H07V-U',
    text: 'Conducteur rigide.',
  }, 1);
  assert.deepEqual(next.products.filter((p) => p.cat === 'cables').map((p) => p.id), ['cable-r2v', 'fil', 'gaine']);
});

test('category reorder keeps ids and regroups products', () => {
  const next = moveCategory(doc, 'eclairage', 0);
  assert.deepEqual(next.categories.map((c) => c.id), ['eclairage', 'cables']);
  assert.equal(next.categories.find((c) => c.id === 'eclairage').label, 'Éclairage');
  assert.deepEqual(next.products.map((p) => p.id), ['dalle', 'cable-r2v', 'gaine']);
});

test('a family with articles cannot be deleted', () => {
  const blocked = deleteCategory(doc, 'cables');
  assert.equal(blocked.ok, false);
  assert.match(blocked.error, /2 articles/);
  const emptied = deleteCategory({ ...doc, products: doc.products.filter((p) => p.cat !== 'eclairage') }, 'eclairage');
  assert.equal(emptied.ok, true);
  assert.equal(emptied.doc.categories.some((c) => c.id === 'eclairage'), false);
});

test('validation rejects empty fields and accepts a slug id', () => {
  const bad = validateProduct({ name: ' ', cat: 'nope', text: '', position: 0 }, doc);
  assert.equal(bad.ok, false);
  assert.ok(bad.errors.name && bad.errors.cat && bad.errors.text && bad.errors.position);
  const good = validateProduct({ name: '  Fil   H07V-U ', cat: 'cables', text: 'Rigide.', position: 3 }, doc);
  assert.equal(good.ok, true);
  assert.equal(good.value.id, 'fil-h07v-u');
  assert.equal(good.value.position, 2);
  assert.equal(good.value.name, 'Fil H07V-U');
  const renamed = validateCategory({ label: 'Câbles & conduits', text: 'Autre phrase.', icon: 'i-cable' }, doc, 'cables');
  assert.equal(renamed.ok, true);
  assert.equal(renamed.value.id, 'cables');
});

test('image plan batches the photo with the catalogue and deletes orphans', () => {
  const draft = {
    ...doc,
    products: [
      { ...doc.products[0], img: 'assets/img/produits/cable-r2v.webp' },
      doc.products[2],
    ],
  };
  const baseline = {
    ...doc,
    products: [
      { ...doc.products[0], img: 'assets/img/produits/cable-r2v.webp' },
      { ...doc.products[1], img: 'assets/img/produits/gaine.webp' },
      doc.products[2],
    ],
  };
  const ops = planImages(baseline, draft, { 'cable-r2v': 'blob' });
  assert.deepEqual(ops, [
    { path: 'assets/img/produits/gaine.webp', delete: true },
    { path: 'assets/img/produits/cable-r2v.webp', upload: true, id: 'cable-r2v' },
  ]);
});

test('serialize keeps the note, omits empty images, and detects order changes', () => {
  const text = serialize(doc);
  const parsed = JSON.parse(text);
  assert.equal(parsed._note, 'garder');
  assert.equal('img' in parsed.products[0], false);
  const reordered = placeProduct(doc, 'cable-r2v', 'cables', 1);
  assert.equal(isDirty(doc, reordered, {}), true);
  assert.equal(isDirty(doc, doc, {}), false);
  assert.equal(isDirty(doc, doc, { dalle: 'blob' }), true);
  assert.match(commitMessage(doc, reordered, 0), /réorganisation/);
  const withPhoto = upsertProduct(doc, { ...doc.products[2], img: imagePath('dalle') }, 0);
  assert.match(commitMessage(doc, withPhoto, 1), /photo/);
});

test('pages of 20 use the same numbered window as the public catalogue', () => {
  assert.equal(PAGE_SIZE, 20);
  assert.deepEqual(pageItems(1, 1), [1]);
  assert.deepEqual(pageItems(1, 5), [1, 2, 3, 4, 5]);
  assert.deepEqual(pageItems(1, 20), [1, 2, 3, 4, '…', 20]);
  assert.deepEqual(pageItems(10, 20), [1, '…', 9, 10, 11, '…', 20]);
  assert.deepEqual(pageItems(19, 20), [1, '…', 17, 18, 19, 20]);
  assert.equal(clampPage(0, 100), 1);
  assert.equal(clampPage(9, 40), 2);
  assert.equal(clampPage(4, 0), 1);
});

test('family filter and name search share one list', () => {
  const cables = filterProducts(doc, { family: 'cables' });
  assert.deepEqual(cables.map((p) => p.id), ['cable-r2v', 'gaine']);
  const found = filterProducts(doc, { family: 'eclairage', query: 'dalle' });
  assert.deepEqual(found.map((p) => p.id), ['dalle']);
  assert.equal(filterProducts(doc, { query: 'câble' }).length, 1);
  assert.equal(filterProducts(doc, { family: 'eclairage', query: 'câble' }).length, 0);
  assert.equal(familyCounts(doc).get('cables'), 2);
  assert.deepEqual(familyPaths('transformateurs'), {
    page: 'produits-transformateurs.html',
    data: 'data/produits-transformateurs.json',
  });
});

test('the Prumysl solar catalogue row cannot be removed or moved', () => {
  const solar = {
    categories: doc.categories,
    products: [...doc.products, { id: 'projecteur-solaire', cat: 'eclairage', name: 'Projecteur solaire', text: 'Gamme dédiée.' }],
  };
  assert.equal(isProtectedProduct('projecteur-solaire'), true);
  assert.equal(isProtectedProduct('bouton-poussoir-prumysl'), false);
  assert.match(protectionError(solar, deleteProduct(solar, 'projecteur-solaire')), /ne peut pas être supprimé/);
  const moved = placeProduct(solar, 'projecteur-solaire', 'cables', 0);
  assert.match(protectionError(solar, moved), /reste dans sa famille/);
  const renamed = upsertProduct(solar, { ...solar.products.at(-1), name: 'Projecteur solaire LED' }, 0);
  assert.equal(protectionError(solar, renamed), '');
});

test('a contents response over 1 MB is not treated as the whole catalogue', () => {
  assert.equal(contentsAreComplete({ sha: 'abc', encoding: 'base64', content: 'YQ==', size: 12 }), false);
  assert.equal(contentsAreComplete({ sha: 'abc', encoding: 'base64', content: '', size: 10 }), false);
  assert.equal(contentsAreComplete({ sha: 'abc', encoding: 'base64', content: 'YQ==', truncated: true }), false);
  assert.equal(contentsAreComplete({ sha: 'abc', encoding: 'base64', content: 'YQ==' }), true);
});

test('the shipped catalogue has nine families and pages of twenty', () => {
  const live = JSON.parse(readFileSync(new URL('../src/data/produits.json', import.meta.url), 'utf8'));
  assert.equal(live.categories.length, 9);
  assert.equal(live.categories.some((c) => c.id === 'transformateurs' && c.label === 'Transformateurs & alimentation'), true);
  assert.ok(live.products.length > 6000);
  const solar = live.products.find((p) => p.id === 'projecteur-solaire');
  assert.equal(solar.cat, 'eclairage-ext');
  assert.equal(solar.name, 'Projecteur solaire');
  for (const category of live.categories) {
    const items = filterProducts(live, { family: category.id });
    assert.equal(items.length, familyCounts(live).get(category.id));
    assert.equal(items.slice(0, PAGE_SIZE).length, Math.min(PAGE_SIZE, items.length));
    assert.ok(items.length > PAGE_SIZE, category.id);
  }
  const byName = filterProducts(live, { family: 'eclairage-ext', query: 'projecteur solaire' });
  assert.equal(byName.some((p) => p.id === 'projecteur-solaire'), true);
});
