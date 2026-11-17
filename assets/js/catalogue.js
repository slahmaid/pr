// Catalogue edits shared by the admin page and the node tests.
// The file on GitHub stays `{ categories, products }` plus any extra keys.

export const ICONS = [
  ['i-cable', 'Câble'],
  ['i-outlet', 'Prise'],
  ['i-breaker', 'Disjoncteur'],
  ['i-board', 'Tableau'],
  ['i-bulb', 'Ampoule'],
  ['i-flood', 'Projecteur'],
  ['i-fan', 'Ventilation'],
  ['i-drop', 'Goutte'],
  ['i-network', 'Réseau'],
  ['i-tool', 'Outil'],
  ['i-shield', 'Protection'],
  ['i-sun', 'Solaire'],
  ['i-camera', 'Caméra'],
  ['i-battery', 'Batterie'],
  ['i-bolt', 'Éclair'],
];

const ICON_IDS = new Set(ICONS.map(([id]) => id));

export function imagePath(id) {
  return `assets/img/produits/${id}.webp`;
}

export function slugify(value) {
  const base = String(value ?? '')
    .trim()
    .toLowerCase()
    .replace(/œ/g, 'oe')
    .replace(/æ/g, 'ae')
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 48)
    .replace(/-+$/g, '');
  return base || 'article';
}

export function uniqueId(base, taken) {
  const root = base || 'article';
  if (!taken.has(root)) return root;
  let n = 2;
  while (taken.has(`${root}-${n}`)) n += 1;
  return `${root}-${n}`;
}

export function norm(value) {
  return String(value ?? '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
}

function clean(value) {
  return String(value ?? '').trim().replace(/\s+/g, ' ');
}

export function cloneDoc(doc) {
  return JSON.parse(JSON.stringify(doc));
}

export function serialize(doc) {
  const out = {};
  for (const key of Object.keys(doc)) {
    if (key !== 'categories' && key !== 'products') out[key] = doc[key];
  }
  out.categories = (doc.categories || []).map((c) => {
    const { id, label, icon, text, ...rest } = c;
    return { id, label, icon, text, ...rest };
  });
  out.products = (doc.products || []).map((p) => {
    const { id, cat, name, text, img, ...rest } = p;
    const row = { id, cat, name, text, ...rest };
    if (img) row.img = img;
    return row;
  });
  return `${JSON.stringify(out, null, 2)}\n`;
}

export function grouped(doc) {
  const groups = doc.categories.map((category) => ({
    category,
    products: doc.products.filter((p) => p.cat === category.id),
  }));
  const known = new Set(doc.categories.map((c) => c.id));
  const orphans = doc.products.filter((p) => !known.has(p.cat));
  if (orphans.length) {
    groups.push({
      category: { id: '', label: 'Sans famille', icon: 'i-bolt', text: '' },
      products: orphans,
    });
  }
  return groups;
}

function regroup(categories, products) {
  const out = [];
  const known = new Set(categories.map((c) => c.id));
  for (const c of categories) out.push(...products.filter((p) => p.cat === c.id));
  for (const p of products) if (!known.has(p.cat)) out.push(p);
  return out;
}

// `position` is the final index inside the target category (0-based).
export function placeProduct(doc, id, catId, position) {
  const current = doc.products.find((p) => p.id === id);
  if (!current || !doc.categories.some((c) => c.id === catId)) return doc;
  const others = doc.products.filter((p) => p.id !== id);
  const next = { ...current, cat: catId };
  const bucket = others.filter((p) => p.cat === catId);
  const index = Math.max(0, Math.min(Number(position) || 0, bucket.length));
  bucket.splice(index, 0, next);
  const products = [];
  for (const c of doc.categories) {
    products.push(...(c.id === catId ? bucket : others.filter((p) => p.cat === c.id)));
  }
  for (const p of others) {
    if (!doc.categories.some((c) => c.id === p.cat)) products.push(p);
  }
  return { ...doc, products };
}

export function upsertProduct(doc, product, position) {
  const exists = doc.products.some((p) => p.id === product.id);
  const products = exists
    ? doc.products.map((p) => (p.id === product.id ? { ...p, ...product, id: p.id } : p))
    : [...doc.products, product];
  return placeProduct({ ...doc, products }, product.id, product.cat, position);
}

export function deleteProduct(doc, id) {
  return { ...doc, products: doc.products.filter((p) => p.id !== id) };
}

export function moveCategory(doc, id, position) {
  const categories = doc.categories.slice();
  const from = categories.findIndex((c) => c.id === id);
  if (from < 0) return doc;
  const [item] = categories.splice(from, 1);
  const index = Math.max(0, Math.min(Number(position) || 0, categories.length));
  categories.splice(index, 0, item);
  return { ...doc, categories, products: regroup(categories, doc.products) };
}

export function deleteCategory(doc, id) {
  const n = doc.products.filter((p) => p.cat === id).length;
  if (n) {
    return {
      ok: false,
      error: `Cette famille contient ${n} article${n > 1 ? 's' : ''}. Déplacez-les ou supprimez-les d'abord.`,
    };
  }
  return { ok: true, doc: { ...doc, categories: doc.categories.filter((c) => c.id !== id) } };
}

export function validateProduct(input, doc, editingId) {
  const errors = {};
  const name = clean(input.name);
  const text = clean(input.text);
  const cat = input.cat || '';
  if (name.length < 2) errors.name = "Indiquez le nom de l'article (2 caractères minimum).";
  else if (name.length > 120) errors.name = 'Le nom ne peut pas dépasser 120 caractères.';
  if (!doc.categories.some((c) => c.id === cat)) errors.cat = 'Choisissez une famille.';
  if (text.length < 2) errors.text = 'Indiquez une description (2 caractères minimum).';
  else if (text.length > 800) errors.text = 'La description ne peut pas dépasser 800 caractères.';
  const room = doc.products.filter((p) => p.cat === cat && p.id !== editingId).length + 1;
  const position = Number(input.position);
  if (!Number.isInteger(position) || position < 1 || position > room) {
    errors.position = `Indiquez une position entre 1 et ${room}.`;
  }
  const ok = Object.keys(errors).length === 0;
  let id = editingId || '';
  if (ok && !editingId) id = uniqueId(slugify(name), new Set(doc.products.map((p) => p.id)));
  return {
    ok,
    errors,
    value: ok ? { id, cat, name, text, position: position - 1 } : null,
  };
}

export function validateCategory(input, doc, editingId) {
  const errors = {};
  const label = clean(input.label);
  const text = clean(input.text);
  const icon = input.icon || '';
  if (label.length < 2) errors.label = 'Indiquez le nom de la famille (2 caractères minimum).';
  else if (label.length > 60) errors.label = 'Le nom ne peut pas dépasser 60 caractères.';
  if (text.length < 2) errors.text = 'Décrivez la famille en une phrase.';
  else if (text.length > 220) errors.text = 'La description ne peut pas dépasser 220 caractères.';
  if (!ICON_IDS.has(icon)) errors.icon = 'Choisissez une icône.';
  const ok = Object.keys(errors).length === 0;
  let id = editingId || '';
  if (ok && !editingId) id = uniqueId(slugify(label), new Set(doc.categories.map((c) => c.id)));
  return {
    ok,
    errors,
    value: ok ? { id, label, icon, text } : null,
  };
}

export function planImages(baseline, draft, pending) {
  const ops = [];
  const deleted = new Set();
  const drop = (path) => {
    if (!path || deleted.has(path)) return;
    deleted.add(path);
    ops.push({ path, delete: true });
  };
  const draftIds = new Set(draft.products.map((p) => p.id));
  for (const p of baseline.products) {
    if (!draftIds.has(p.id)) drop(p.img);
  }
  for (const p of draft.products) {
    const flag = pending[p.id];
    const prev = baseline.products.find((item) => item.id === p.id);
    if (flag === 'blob') {
      if (prev?.img && prev.img !== p.img) drop(prev.img);
      if (p.img) ops.push({ path: p.img, upload: true, id: p.id });
    } else if (flag === 'remove') {
      drop(prev?.img);
    }
  }
  return ops;
}

export function isDirty(baseline, draft, pending) {
  if (pending && Object.keys(pending).length > 0) return true;
  return serialize(baseline) !== serialize(draft);
}

export const PAGE_SIZE = 20;

// The solar range lives on prumysl-solaire.html. This catalogue row stays
// with Éclairage extérieur and cannot be deleted or moved.
export const PROTECTED_PRODUCTS = {
  'projecteur-solaire': true,
};

export function isProtectedProduct(id) {
  return Object.prototype.hasOwnProperty.call(PROTECTED_PRODUCTS, id);
}

export function protectionError(baseline, draft) {
  const beforeList = baseline?.products || [];
  const afterList = draft?.products || [];
  for (const id of Object.keys(PROTECTED_PRODUCTS)) {
    const before = beforeList.find((p) => p.id === id);
    if (!before) continue;
    const after = afterList.find((p) => p.id === id);
    if (!after) return `« ${before.name} » fait partie de la gamme Prumysl et ne peut pas être supprimé.`;
    if (after.cat !== before.cat) return `« ${before.name} » reste dans sa famille.`;
  }
  return '';
}

export function familyPaths(id) {
  return { page: `produits-${id}.html`, data: `data/produits-${id}.json` };
}

export function frCount(n) {
  return new Intl.NumberFormat('fr-FR').format(Number(n) || 0);
}

// Same window as the public catalogue: 1 … 4 5 6 … 88
export function pageItems(current, total) {
  if (total <= 7) return Array.from({ length: total }, (_, i) => i + 1);
  const set = new Set([1, total, current - 1, current, current + 1]);
  if (current <= 3) [2, 3, 4].forEach((n) => set.add(n));
  if (current >= total - 2) [total - 3, total - 2, total - 1].forEach((n) => set.add(n));
  const nums = [...set].filter((n) => n >= 1 && n <= total).sort((a, b) => a - b);
  const out = [];
  for (const n of nums) {
    if (out.length && n - out[out.length - 1] > 1) out.push('…');
    out.push(n);
  }
  return out;
}

export function clampPage(page, total, pageSize = PAGE_SIZE) {
  const pages = Math.max(1, Math.ceil(Number(total) / pageSize) || 1);
  const n = Math.trunc(Number(page));
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(pages, n);
}

export function filterProducts(doc, { family = '', query = '' } = {}) {
  const needle = norm(String(query || '').trim());
  return (doc.products || []).filter((p) => {
    if (family && p.cat !== family) return false;
    if (!needle) return true;
    return norm(p.name).includes(needle);
  });
}

export function familyCounts(doc) {
  const counts = new Map((doc.categories || []).map((c) => [c.id, 0]));
  for (const p of doc.products || []) counts.set(p.cat, (counts.get(p.cat) || 0) + 1);
  return counts;
}

// GitHub's contents API omits or truncates files over 1 MB. The blob API does not.
export function contentsAreComplete(meta) {
  if (!meta || meta.truncated) return false;
  if (meta.encoding !== 'base64' || typeof meta.content !== 'string' || !meta.content) return false;
  const size = Number(meta.size);
  if (Number.isFinite(size) && size > 0) {
    const cleaned = meta.content.replace(/\s/g, '');
    const pad = cleaned.endsWith('==') ? 2 : cleaned.endsWith('=') ? 1 : 0;
    const bytes = Math.floor((cleaned.length * 3) / 4) - pad;
    if (bytes + 8 < size) return false;
  }
  return true;
}

export function commitMessage(baseline, draft, imageCount = 0) {
  const before = new Map(baseline.products.map((p) => [p.id, p]));
  const after = new Map(draft.products.map((p) => [p.id, p]));
  let added = 0;
  let removed = 0;
  let updated = 0;
  for (const [id, product] of after) {
    if (!before.has(id)) added += 1;
    else if (JSON.stringify(before.get(id)) !== JSON.stringify(product)) updated += 1;
  }
  for (const id of before.keys()) if (!after.has(id)) removed += 1;
  const parts = [];
  if (added) parts.push(added > 1 ? `${added} ajouts` : '1 ajout');
  if (updated) parts.push(updated > 1 ? `${updated} modifications` : '1 modification');
  if (removed) parts.push(removed > 1 ? `${removed} suppressions` : '1 suppression');
  const catsChanged = JSON.stringify(baseline.categories) !== JSON.stringify(draft.categories);
  if (catsChanged) parts.push('familles');
  if (imageCount) parts.push(imageCount > 1 ? `${imageCount} photos` : '1 photo');
  const orderChanged = baseline.products.map((p) => p.id).join('|') !== draft.products.map((p) => p.id).join('|')
    || baseline.categories.map((c) => c.id).join('|') !== draft.categories.map((c) => c.id).join('|');
  if (!parts.length && orderChanged) return 'catalogue: réorganisation des articles';
  if (!parts.length) return 'catalogue: mise à jour';
  return `catalogue: ${parts.join(', ')}`;
}
