import {
  ICONS,
  PAGE_SIZE,
  clampPage,
  cloneDoc,
  commitMessage,
  contentsAreComplete,
  deleteCategory,
  deleteProduct,
  familyCounts,
  familyPaths,
  filterProducts,
  frCount,
  imagePath,
  isDirty,
  isProtectedProduct,
  moveCategory,
  pageItems,
  planImages,
  protectionError,
  serialize,
  slugify,
  uniqueId,
  upsertProduct,
  validateCategory,
  validateProduct,
} from './catalogue.js';

const SITE = {
  owner: 'slahmaid',
  repo: 'pr',
  branch: 'main',
  dataPath: 'src/data/produits.json',
  siteUrl: '__SITE_URL__',
  workflow: 'Deploy to GitHub Pages',
};

const CATALOGUE_URL = '__CATALOGUE_URL__';
// Left null on purpose: build.mjs must not inline the catalogue into this file.
const SEED = null;
if (SEED) throw new Error('Le catalogue ne doit pas être intégré dans cette page.');
const TOKEN_KEY = 'prumysl.admin.token';
const MOCK_KEY = 'prumysl.admin.mockToken';

const params = new URLSearchParams(location.search);
const mockMode = params.has('mock') ? (params.get('mock') || '1') : '';

const root = document.querySelector('#admin');
let token = '';
let baseline = null;
let draft = null;
let knownSha = '';
let busy = false;
const pending = new Map();
const remoteUrls = new Map();
let dragId = '';
let editorSession = null;
const listState = { page: 1 };

const ui = {};

function fieldValue(form, name) {
  const node = form.elements.namedItem(name);
  return node ? node.value : '';
}

function esc(value) {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function flags() {
  const out = {};
  for (const [id, item] of pending) {
    if (item.remove) out[id] = 'remove';
    else if (item.blob) out[id] = 'blob';
  }
  return out;
}

function dirty() {
  return baseline && draft ? isDirty(baseline, draft, flags()) : false;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function bytesToBase64(bytes) {
  let bin = '';
  const size = 0x8000;
  for (let i = 0; i < bytes.length; i += size) bin += String.fromCharCode(...bytes.subarray(i, i + size));
  return btoa(bin);
}

function utf8ToBase64(text) {
  return bytesToBase64(new TextEncoder().encode(text));
}

function decodeBase64(value) {
  const bin = atob(String(value).replace(/\s/g, ''));
  const bytes = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
  return bytes;
}

async function blobToBase64(blob) {
  return bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
}

function githubMessage(status, data) {
  const api = data && typeof data.message === 'string' ? data.message : '';
  if (status === 401) return 'Jeton refusé. Déconnectez-vous, puis collez un nouveau jeton.';
  if (status === 403) {
    return `Accès refusé. Le jeton doit autoriser Contents en lecture et écriture sur ${SITE.owner}/${SITE.repo}.${api ? ` (${api})` : ''}`;
  }
  if (status === 404) return `Introuvable. Vérifiez que le jeton a accès au dépôt ${SITE.owner}/${SITE.repo}.`;
  return `GitHub a renvoyé une erreur${api ? ` (${api})` : '.'}`;
}

function createMock(scenario, seed) {
  const state = {
    fileSha: 'mocksha0001',
    reads: 0,
    blobs: new Map(),
    images: new Map(),
    doc: cloneDoc(seed),
    tree: null,
    commit: null,
    runs: new Map(),
    n: 0,
    scenario,
  };
  const fail = (status, code, message) => {
    const err = new Error(message || 'erreur');
    err.status = status;
    err.code = code;
    throw err;
  };
  const apply = () => {
    const json = state.tree.find((entry) => entry.path === SITE.dataPath);
    state.doc = JSON.parse(new TextDecoder().decode(decodeBase64(state.blobs.get(json.sha))));
    for (const entry of state.tree) {
      if (!entry.path.endsWith('.webp')) continue;
      if (entry.sha == null) state.images.delete(entry.path);
      else state.images.set(entry.path, state.blobs.get(entry.sha));
    }
    state.fileSha = json.sha;
    state.commitSha = state.commit.sha;
    state.runs.set(state.commit.sha, { step: 0, url: 'https://github.com/slahmaid/pr/actions/runs/1' });
  };
  return async function mockRequest(method, path, body) {
    if (token.includes('refuse')) fail(401, 'auth', 'Jeton refusé.');
    if (method === 'GET' && path === `/repos/${SITE.owner}/${SITE.repo}`) return { full_name: `${SITE.owner}/${SITE.repo}` };
    if (method === 'GET' && path.startsWith(`/repos/${SITE.owner}/${SITE.repo}/contents/`)) {
      const filePath = decodeURIComponent(path.split('/contents/')[1].split('?')[0]);
      if (filePath === SITE.dataPath) {
        state.reads += 1;
        if (state.scenario === 'conflict' && state.reads === 2) {
          state.fileSha = 'mocksha0002';
          state.doc.products[0] = { ...state.doc.products[0], name: `${state.doc.products[0].name} (serveur)` };
        }
        return { sha: state.fileSha, encoding: 'base64', content: utf8ToBase64(serialize(state.doc)) };
      }
      if (!state.images.has(filePath)) fail(404, 'github', 'introuvable');
      return { sha: 'img', encoding: 'base64', content: state.images.get(filePath) };
    }
    if (method === 'GET' && path === `/repos/${SITE.owner}/${SITE.repo}/git/ref/heads/${SITE.branch}`) {
      return { object: { sha: state.commitSha || 'commit-base' } };
    }
    if (method === 'GET' && path.startsWith(`/repos/${SITE.owner}/${SITE.repo}/git/commits/`)) {
      return { sha: state.commitSha || 'commit-base', tree: { sha: 'tree-base' } };
    }
    if (method === 'POST' && path.endsWith('/git/blobs')) {
      const sha = `blob${state.n += 1}`;
      state.blobs.set(sha, body.content);
      return { sha };
    }
    if (method === 'POST' && path.endsWith('/git/trees')) {
      state.tree = body.tree;
      return { sha: 'tree-next' };
    }
    if (method === 'POST' && path.endsWith('/git/commits')) {
      state.commit = { sha: `commit${state.n += 1}`, message: body.message };
      return { sha: state.commit.sha };
    }
    if (method === 'PATCH' && path.endsWith(`/git/refs/heads/${SITE.branch}`)) {
      if (state.scenario === 'race') {
        state.scenario = 'race-used';
        fail(422, 'conflict', 'not a fast forward');
      }
      if (!state.commit || body.sha !== state.commit.sha) fail(422, 'conflict', 'not a fast forward');
      apply();
      return { object: { sha: body.sha } };
    }
    if (method === 'GET' && path.includes('/actions/runs')) {
      const sha = new URL(`https://api.github.com${path}`).searchParams.get('head_sha');
      const run = state.runs.get(sha);
      if (!run) return { workflow_runs: [] };
      run.step += 1;
      const status = run.step < 2 ? 'queued' : run.step < 3 ? 'in_progress' : 'completed';
      return {
        workflow_runs: [{
          name: SITE.workflow,
          path: '.github/workflows/pages.yml',
          status,
          conclusion: status === 'completed' ? 'success' : null,
          html_url: run.url,
          head_sha: sha,
        }],
      };
    }
    fail(404, 'github', `Requête simulée inconnue : ${method} ${path}`);
  };
}

let mockRequest = null;
let mockReady = null;

async function prepareMock() {
  if (!mockMode || mockRequest) return;
  if (!mockReady) {
    mockReady = (async () => {
      let response;
      try {
        response = await fetch(CATALOGUE_URL, { cache: 'no-store', headers: { Accept: 'application/json' } });
      } catch {
        throw new Error('Catalogue local impossible à lire. Relancez node build.mjs.');
      }
      if (!response.ok) throw new Error('Catalogue local introuvable. Relancez node build.mjs.');
      const doc = await response.json();
      if (!doc || !Array.isArray(doc.categories) || !Array.isArray(doc.products)) {
        throw new Error('Le catalogue local est incomplet.');
      }
      mockRequest = createMock(mockMode, doc);
    })();
  }
  await mockReady;
}

function oversizedCatalogue(err) {
  return err?.status === 403 && /1\s*MB|too large|too_large|Blob/i.test(String(err.message || ''));
}

async function readBlob(sha) {
  const blob = await gh('GET', `/repos/${SITE.owner}/${SITE.repo}/git/blobs/${sha}`);
  return { sha, encoding: blob.encoding || 'base64', content: blob.content, size: blob.size };
}

async function fetchCatalogueFile() {
  const contentsPath = `/repos/${SITE.owner}/${SITE.repo}/contents/${SITE.dataPath}?ref=${SITE.branch}`;
  try {
    const meta = await gh('GET', contentsPath);
    if (contentsAreComplete(meta)) return meta;
    if (meta?.sha) return readBlob(meta.sha);
  } catch (err) {
    if (!oversizedCatalogue(err)) throw err;
  }
  const ref = await gh('GET', `/repos/${SITE.owner}/${SITE.repo}/git/ref/heads/${SITE.branch}`);
  const commit = await gh('GET', `/repos/${SITE.owner}/${SITE.repo}/git/commits/${ref.object.sha}`);
  const tree = await gh('GET', `/repos/${SITE.owner}/${SITE.repo}/git/trees/${commit.tree.sha}?recursive=1`);
  const entry = (tree.tree || []).find((item) => item.path === SITE.dataPath);
  if (!entry?.sha) throw new Error('produits.json est introuvable sur main.');
  return readBlob(entry.sha);
}

async function gh(method, path, body) {
  if (mockMode) {
    await prepareMock();
    return mockRequest(method, path, body);
  }
  let response;
  try {
    response = await fetch(`https://api.github.com${path}`, {
      method,
      cache: 'no-store',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `Bearer ${token}`,
        'X-GitHub-Api-Version': '2022-11-28',
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch {
    const err = new Error('Connexion à GitHub impossible. Vérifiez le réseau, puis réessayez.');
    err.code = 'network';
    throw err;
  }
  const text = await response.text();
  let data = null;
  if (text) {
    try { data = JSON.parse(text); } catch { data = { message: text.slice(0, 180) }; }
  }
  if (!response.ok) {
    const err = new Error(githubMessage(response.status, data));
    err.status = response.status;
    const refUpdate = method === 'PATCH' && path.includes('/git/refs/');
    if (response.status === 409 || (response.status === 422 && refUpdate)) err.code = 'conflict';
    else if (response.status === 401) err.code = 'auth';
    else err.code = 'github';
    throw err;
  }
  return data;
}

function parseDoc(file) {
  let doc;
  try {
    const text = file.encoding === 'utf-8' || file.encoding === 'utf8'
      ? String(file.content)
      : new TextDecoder().decode(decodeBase64(file.content));
    doc = JSON.parse(text);
  } catch {
    throw new Error('Le fichier produits.json n’est pas un JSON valide.');
  }
  if (!doc || !Array.isArray(doc.categories) || !Array.isArray(doc.products)) {
    throw new Error('Le catalogue ne contient pas de familles et d’articles.');
  }
  return doc;
}

function setStatus(kind, text) {
  if (!ui.status) return;
  ui.status.hidden = !text;
  ui.status.dataset.kind = kind || 'info';
  ui.status.querySelector('[data-status-text]').textContent = text || '';
  if (text) {
    ui.status.querySelector('[data-status-links]').replaceChildren();
    ui.status.scrollIntoView({ block: 'nearest' });
  }
}

function addStatusLink(href, label) {
  const box = ui.status?.querySelector('[data-status-links]');
  if (!box || !href) return;
  const a = document.createElement('a');
  a.href = href;
  a.textContent = label;
  a.target = '_blank';
  a.rel = 'noopener noreferrer';
  box.append(a);
}

function safeGithubUrl(value) {
  try {
    const url = new URL(value);
    if (url.protocol === 'https:' && (url.hostname === 'github.com' || url.hostname === 'www.github.com')) return url.href;
  } catch { /* ignore unsafe urls */ }
  return '';
}

function markDirty() {
  const changed = dirty();
  if (ui.publish) ui.publish.disabled = busy || !changed;
  if (ui.dirty) ui.dirty.hidden = !changed;
}

function setBusy(value) {
  busy = value;
  markDirty();
}

function revokePending(id) {
  const item = pending.get(id);
  if (item?.url) URL.revokeObjectURL(item.url);
  pending.delete(id);
}

function clearAllPending() {
  for (const id of [...pending.keys()]) revokePending(id);
  for (const url of remoteUrls.values()) URL.revokeObjectURL(url);
  remoteUrls.clear();
}

function rememberToken(value) {
  token = value;
  if (mockMode) sessionStorage.setItem(MOCK_KEY, value);
  else localStorage.setItem(TOKEN_KEY, value);
}

function forgetToken() {
  token = '';
  if (mockMode) sessionStorage.removeItem(MOCK_KEY);
  else localStorage.removeItem(TOKEN_KEY);
}

function savedToken() {
  return mockMode ? sessionStorage.getItem(MOCK_KEY) || '' : localStorage.getItem(TOKEN_KEY) || '';
}

async function loadCatalogue() {
  const file = await fetchCatalogueFile();
  const doc = parseDoc(file);
  clearAllPending();
  baseline = doc;
  draft = cloneDoc(doc);
  knownSha = file.sha;
}

async function reloadFromServer(file) {
  const data = file || await fetchCatalogueFile();
  const doc = parseDoc(data);
  clearAllPending();
  baseline = doc;
  draft = cloneDoc(doc);
  knownSha = data.sha;
  renderList();
  renderFamilies();
  markDirty();
}

function canvasToWebp(canvas, quality) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) reject(new Error('Impossible de préparer l’image.'));
      else if (blob.type !== 'image/webp') reject(new Error('Ce navigateur ne sait pas enregistrer une image WebP. Utilisez Chrome, Firefox ou Safari à jour.'));
      else resolve(blob);
    }, 'image/webp', quality);
  });
}

async function compressImage(file) {
  if (!file || !/^image\/(jpeg|png|webp|gif)$/.test(file.type)) {
    throw new Error('Utilisez une image JPEG, PNG, WebP ou GIF.');
  }
  if (file.size > 15 * 1024 * 1024) throw new Error('Image trop lourde (15 Mo maximum).');
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1200 / Math.max(bitmap.width, bitmap.height));
    const width = Math.max(1, Math.round(bitmap.width * scale));
    const height = Math.max(1, Math.round(bitmap.height * scale));
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    canvas.getContext('2d').drawImage(bitmap, 0, 0, width, height);
    let quality = 0.82;
    let blob = await canvasToWebp(canvas, quality);
    while (blob.size > 450000 && quality > 0.5) {
      quality = Math.round((quality - 0.08) * 100) / 100;
      blob = await canvasToWebp(canvas, quality);
    }
    if (blob.size > 900000) throw new Error('L’image reste trop lourde après compression. Choisissez une autre photo.');
    return { blob, width, height };
  } finally {
    bitmap.close?.();
  }
}

function formatBytes(size) {
  if (size < 1024) return `${size} o`;
  return `${Math.max(1, Math.round(size / 1024))} Ko`;
}

async function watchDeploy(sha) {
  const live = SITE.siteUrl ? `${SITE.siteUrl.replace(/\/+$/, '')}/produits` : 'produits';
  const started = Date.now();
  const limit = mockMode ? 6000 : 180000;
  const wait = mockMode ? 200 : 4000;
  while (Date.now() - started < limit) {
    let data;
    try {
      data = await gh('GET', `/repos/${SITE.owner}/${SITE.repo}/actions/runs?head_sha=${encodeURIComponent(sha)}&per_page=5`);
    } catch (err) {
      if (err.status === 401 || err.status === 403) {
        setStatus('info', 'Le catalogue est publié sur main. Pour suivre le déploiement, ajoutez la permission Actions : lecture seule au jeton.');
      } else {
        setStatus('info', 'Le catalogue est publié. Le statut du déploiement est indisponible pour le moment.');
      }
      addStatusLink(live, 'Voir le catalogue');
      return;
    }
    const runs = data.workflow_runs || [];
    const run = runs.find((item) => item.name === SITE.workflow || String(item.path || '').endsWith('pages.yml')) || runs[0];
    if (!run) {
      setStatus('info', 'Publication enregistrée. En attente du déploiement…');
    } else if (run.status !== 'completed') {
      setStatus('info', run.status === 'queued' ? 'Déploiement en file d’attente.' : 'Déploiement en cours.');
      addStatusLink(safeGithubUrl(run.html_url), 'Voir le déploiement');
    } else if (run.conclusion === 'success') {
      setStatus('ok', 'Le catalogue est en ligne.');
      addStatusLink(live, 'Voir le catalogue en ligne');
      addStatusLink(safeGithubUrl(run.html_url), 'Voir le déploiement');
      return;
    } else {
      setStatus('err', 'Le déploiement a échoué. Ouvrez GitHub Actions pour lire le journal.');
      addStatusLink(safeGithubUrl(run.html_url), 'Voir le déploiement');
      return;
    }
    await sleep(wait);
  }
  setStatus('info', 'Le déploiement prend plus de temps que prévu. Consultez l’onglet Actions du dépôt.');
  addStatusLink(live, 'Voir le catalogue');
}

async function publish() {
  if (busy || !dirty()) {
    if (!dirty()) setStatus('info', 'Aucune modification à publier.');
    return;
  }
  const blocked = protectionError(baseline, draft);
  if (blocked) {
    setStatus('err', blocked);
    return;
  }
  setBusy(true);
  setStatus('info', 'Publication en cours…');
  try {
    const pendingFlags = flags();
    const ops = planImages(baseline, draft, pendingFlags);
    const jsonText = serialize(draft);
    const [ref, file] = await Promise.all([
      gh('GET', `/repos/${SITE.owner}/${SITE.repo}/git/ref/heads/${SITE.branch}`),
      fetchCatalogueFile(),
    ]);
    if (file.sha !== knownSha) {
      await reloadFromServer(file);
      const err = new Error('conflit');
      err.code = 'conflict';
      throw err;
    }
    const parent = ref.object.sha;
    const current = await gh('GET', `/repos/${SITE.owner}/${SITE.repo}/git/commits/${parent}`);
    const uploads = [];
    for (const op of ops) {
      if (!op.upload) continue;
      const item = pending.get(op.id);
      if (!item?.blob) throw new Error('Une photo est manquante. Rouvrez la fiche et ajoutez-la de nouveau.');
      uploads.push({ path: op.path, content: await blobToBase64(item.blob) });
    }
    const jsonBlob = await gh('POST', `/repos/${SITE.owner}/${SITE.repo}/git/blobs`, {
      content: utf8ToBase64(jsonText),
      encoding: 'base64',
    });
    const uploadPaths = new Set(uploads.map((item) => item.path));
    const tree = [{ path: SITE.dataPath, mode: '100644', type: 'blob', sha: jsonBlob.sha }];
    for (const op of ops) {
      if (op.delete && !uploadPaths.has(op.path)) tree.push({ path: op.path, mode: '100644', type: 'blob', sha: null });
    }
    for (const item of uploads) {
      const blob = await gh('POST', `/repos/${SITE.owner}/${SITE.repo}/git/blobs`, { content: item.content, encoding: 'base64' });
      tree.push({ path: item.path, mode: '100644', type: 'blob', sha: blob.sha });
    }
    const treeRes = await gh('POST', `/repos/${SITE.owner}/${SITE.repo}/git/trees`, {
      base_tree: current.tree.sha,
      tree,
    });
    const created = await gh('POST', `/repos/${SITE.owner}/${SITE.repo}/git/commits`, {
      message: commitMessage(baseline, draft, ops.length),
      tree: treeRes.sha,
      parents: [parent],
    });
    try {
      await gh('PATCH', `/repos/${SITE.owner}/${SITE.repo}/git/refs/heads/${SITE.branch}`, { sha: created.sha });
    } catch (err) {
      if (err.code === 'conflict' || err.status === 409 || err.status === 422) {
        await reloadFromServer();
        err.code = 'conflict';
        throw err;
      }
      throw err;
    }
    knownSha = jsonBlob.sha;
    baseline = cloneDoc(draft);
    clearAllPending();
    renderList();
    renderFamilies();
    markDirty();
    setStatus('ok', 'Catalogue publié. Mise en ligne en cours…');
    await watchDeploy(created.sha);
  } catch (err) {
    if (err.code === 'conflict') {
      setStatus('err', 'Une modification plus récente existe déjà sur GitHub. Le catalogue a été rechargé : recommencez votre changement.');
    } else {
      setStatus('err', err.message || 'La publication a échoué.');
    }
    if (err.code === 'auth') {
      forgetToken();
    }
  } finally {
    setBusy(false);
  }
}

function positionOf(id) {
  const product = draft.products.find((p) => p.id === id);
  if (!product) return 1;
  return draft.products.filter((p) => p.cat === product.cat).findIndex((p) => p.id === id) + 1;
}

function listQuery() {
  return ui.search ? ui.search.value : '';
}

function listFamily() {
  return ui.family ? ui.family.value : '';
}

function visibleProducts() {
  return filterProducts(draft, { family: listFamily(), query: listQuery() });
}

function revealProduct(id) {
  const index = visibleProducts().findIndex((p) => p.id === id);
  if (index >= 0) listState.page = Math.floor(index / PAGE_SIZE) + 1;
}

function renderFamilySelect() {
  if (!ui.family) return;
  const counts = familyCounts(draft);
  const signature = `${draft.products.length}|${draft.categories.map((c) => `${c.id}:${c.label}:${counts.get(c.id) || 0}`).join('|')}`;
  const current = listFamily();
  if (ui.family.dataset.sig !== signature) {
    const options = [`<option value="">Toutes les familles (${frCount(draft.products.length)})</option>`];
    for (const category of draft.categories) {
      options.push(`<option value="${esc(category.id)}">${esc(category.label)} (${frCount(counts.get(category.id) || 0)})</option>`);
    }
    ui.family.innerHTML = options.join('');
    ui.family.dataset.sig = signature;
  }
  const known = !current || draft.categories.some((c) => c.id === current);
  ui.family.value = known ? current : '';
}

function renderPager(total) {
  if (!ui.pager) return;
  if (!total) {
    ui.pager.hidden = true;
    ui.pager.replaceChildren();
    return;
  }
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  listState.page = clampPage(listState.page, total, PAGE_SIZE);
  const page = listState.page;
  const statusText = `Page ${frCount(page)} sur ${frCount(pages)} · ${frCount(total)} produit${total > 1 ? 's' : ''}`;
  const navBtn = (kind, text) => {
    const disabled = (kind === 'first' || kind === 'prev') ? page <= 1 : page >= pages;
    const target = kind === 'first' ? 1 : kind === 'last' ? pages : kind === 'prev' ? page - 1 : page + 1;
    const symbol = kind === 'first' ? '<span aria-hidden="true">«</span>'
      : kind === 'last' ? '<span aria-hidden="true">»</span>'
      : kind === 'prev'
        ? '<svg class="i" aria-hidden="true"><use href="#i-arrow-left"/></svg>'
        : '<svg class="i" aria-hidden="true"><use href="#i-arrow"/></svg>';
    const aria = disabled ? ' aria-disabled="true" disabled' : '';
    return `<button type="button" class="pager__btn" data-page="${target}" aria-label="${esc(text)}"${aria}>${symbol}<span class="pager__label">${esc(text)}</span></button>`;
  };
  const numbers = pages === 1 ? '' : pageItems(page, pages).map((item) => {
    if (item === '…') return '<span class="pager__gap" aria-hidden="true">…</span>';
    const current = item === page ? ' aria-current="page"' : '';
    return `<button type="button" class="pager__num" data-page="${item}" aria-label="Page ${item}"${current}>${frCount(item)}</button>`;
  }).join('');
  const nav = pages === 1 ? '' : `<div class="pager__nav">
      ${navBtn('first', 'Première page')}
      ${navBtn('prev', 'Page précédente')}
      ${numbers}
      ${navBtn('next', 'Page suivante')}
      ${navBtn('last', 'Dernière page')}
    </div>`;
  ui.pager.innerHTML = `<p class="pager__status eyebrow muted" data-pager-status aria-live="polite">${statusText}</p>${nav}`;
  ui.pager.hidden = false;
}

function renderList() {
  renderFamilySelect();
  const query = listQuery().trim();
  const items = visibleProducts();
  listState.page = clampPage(listState.page, items.length, PAGE_SIZE);
  const start = (listState.page - 1) * PAGE_SIZE;
  const slice = items.slice(start, start + PAGE_SIZE);
  const indexInFamily = new Map();
  const countInFamily = new Map();
  for (const product of draft.products) {
    const at = countInFamily.get(product.cat) || 0;
    indexInFamily.set(product.id, at);
    countInFamily.set(product.cat, at + 1);
  }
  const shownInFamily = new Map();
  for (const product of items) shownInFamily.set(product.cat, (shownInFamily.get(product.cat) || 0) + 1);

  ui.list.replaceChildren();
  let section = null;
  let rows = null;
  let lastCat = null;
  const reorderLocked = Boolean(query);
  for (const product of slice) {
    if (product.cat !== lastCat) {
      lastCat = product.cat;
      const category = draft.categories.find((c) => c.id === product.cat) || { id: '', label: 'Sans famille', icon: 'i-bolt' };
      section = document.createElement('section');
      section.className = 'admin-group';
      if (category.id) section.dataset.dropCat = category.id;
      const title = document.createElement('h2');
      title.className = 'display';
      title.innerHTML = `<svg class="i" aria-hidden="true"><use href="#${esc(category.icon || 'i-bolt')}"/></svg>${esc(category.label)}<small>${frCount(shownInFamily.get(product.cat) || 0)}</small>`;
      section.append(title);
      rows = document.createElement('div');
      rows.className = 'admin-rows';
      section.append(rows);
      ui.list.append(section);
    }
    const familyIndex = indexInFamily.get(product.id) || 0;
    const familyTotal = countInFamily.get(product.cat) || 0;
    const locked = isProtectedProduct(product.id);
    const row = document.createElement('article');
    row.className = 'admin-row';
    row.dataset.id = product.id;
    row.innerHTML = `
        <div class="admin-handle" ${reorderLocked ? '' : 'draggable="true"'} data-drag title="${reorderLocked ? 'Effacez la recherche pour réordonner' : "Glisser pour changer l'ordre"}" aria-hidden="true">⋮⋮</div>
        <div class="admin-thumb" data-thumb-for="${esc(product.id)}"></div>
        <div>
          <h3 class="admin-row__name"></h3>
          <p class="admin-row__text"></p>
        </div>
        <div class="admin-row__actions">
          <button type="button" class="admin-iconbtn" data-act="up" aria-label="Monter ${esc(product.name)}" ${reorderLocked || familyIndex === 0 ? 'disabled' : ''}>↑</button>
          <button type="button" class="admin-iconbtn" data-act="down" aria-label="Descendre ${esc(product.name)}" ${reorderLocked || familyIndex >= familyTotal - 1 ? 'disabled' : ''}>↓</button>
          <button type="button" class="admin-textbtn" data-act="edit">Modifier</button>
          <button type="button" class="admin-textbtn admin-textbtn--danger" data-act="delete" ${locked ? 'disabled' : ''}>Supprimer</button>
        </div>`;
    const name = row.querySelector('.admin-row__name');
    name.textContent = product.name;
    if (locked) {
      const badge = document.createElement('span');
      badge.className = 'admin-lock';
      badge.textContent = 'Protégé';
      name.append(badge);
    }
    row.querySelector('.admin-row__text').textContent = product.text;
    rows.append(row);
  }
  if (!slice.length) {
    const empty = document.createElement('p');
    empty.className = 'admin-empty muted';
    empty.textContent = query || listFamily() ? 'Aucun article ne correspond.' : 'Aucun article pour le moment.';
    ui.list.append(empty);
  }
  if (ui.count) {
    const total = draft.products.length;
    ui.count.textContent = query || listFamily()
      ? `${frCount(items.length)} affiché${items.length > 1 ? 's' : ''} / ${frCount(total)}`
      : `${frCount(total)} article${total > 1 ? 's' : ''}`;
  }
  renderPager(items.length);
  hydrateThumbs();
}

function thumbUrl(id) {
  const item = pending.get(id);
  if (item?.url) return item.url;
  if (item?.remove) return '';
  return remoteUrls.get(id) || '';
}

function hydrateThumbs() {
  for (const box of ui.list.querySelectorAll('[data-thumb-for]')) {
    const product = draft.products.find((p) => p.id === box.dataset.thumbFor);
    if (!product) continue;
    const url = thumbUrl(product.id);
    box.replaceChildren();
    if (url) {
      const img = document.createElement('img');
      img.alt = '';
      img.src = url;
      box.append(img);
    }
    if (!url && product.img && !pending.get(product.id)?.remove && !remoteUrls.has(product.id)) {
      loadRemoteThumb(product);
    }
  }
}

async function loadRemoteThumb(product) {
  try {
    const file = await gh('GET', `/repos/${SITE.owner}/${SITE.repo}/contents/${product.img.split('/').map(encodeURIComponent).join('/')}?ref=${SITE.branch}`);
    const url = URL.createObjectURL(new Blob([decodeBase64(file.content)], { type: 'image/webp' }));
    remoteUrls.set(product.id, url);
    const box = thumbBox(product.id);
    if (!box || pending.get(product.id)?.url || pending.get(product.id)?.remove) return;
    const img = document.createElement('img');
    img.alt = '';
    img.src = url;
    box.replaceChildren(img);
  } catch (err) {
    if (err.status !== 404) console.error(err);
  }
}

function renderFamilies() {
  ui.families.replaceChildren();
  draft.categories.forEach((category, index) => {
    const row = document.createElement('article');
    row.className = 'admin-catrow';
    row.dataset.catId = category.id;
    row.innerHTML = `
      <svg class="i" aria-hidden="true"><use href="#${esc(category.icon || 'i-bolt')}"/></svg>
      <div>
        <h3 class="admin-row__name"></h3>
        <p class="muted"></p>
        <p class="admin-id"></p>
      </div>
      <div class="admin-row__actions">
        <button type="button" class="admin-iconbtn" data-act="cat-up" aria-label="Monter ${esc(category.label)}" ${index === 0 ? 'disabled' : ''}>↑</button>
        <button type="button" class="admin-iconbtn" data-act="cat-down" aria-label="Descendre ${esc(category.label)}" ${index === draft.categories.length - 1 ? 'disabled' : ''}>↓</button>
        <button type="button" class="admin-textbtn" data-act="cat-edit">Modifier</button>
        <button type="button" class="admin-textbtn admin-textbtn--danger" data-act="cat-delete">Supprimer</button>
      </div>`;
    const paths = familyPaths(category.id);
    const n = draft.products.filter((p) => p.cat === category.id).length;
    row.querySelector('h3').textContent = category.label;
    row.querySelector('p.muted').textContent = category.text;
    row.querySelector('.admin-id').textContent = `${frCount(n)} article${n > 1 ? 's' : ''} · ${paths.page} · ${paths.data}`;
    ui.families.append(row);
  });
}

function moveProductBy(id, delta) {
  if (listQuery().trim()) return;
  const product = draft.products.find((p) => p.id === id);
  if (!product) return;
  const index = draft.products.filter((p) => p.cat === product.cat).findIndex((p) => p.id === id);
  const next = index + delta;
  const count = draft.products.filter((p) => p.cat === product.cat).length;
  if (next < 0 || next >= count) return;
  draft = upsertProduct(draft, product, next);
  revealProduct(id);
  renderList();
  markDirty();
  rowById(id)?.querySelector(`[data-act="${delta < 0 ? 'up' : 'down'}"]`)?.focus();
}

function rowById(id) {
  return [...ui.list.querySelectorAll('[data-id]')].find((node) => node.dataset.id === id);
}

function thumbBox(id) {
  return [...ui.list.querySelectorAll('[data-thumb-for]')].find((node) => node.dataset.thumbFor === id);
}

async function confirmBox(message, okLabel) {
  ui.confirmText.textContent = message;
  ui.confirmOk.textContent = okLabel;
  ui.confirm.showModal();
  return new Promise((resolve) => {
    ui.confirm.addEventListener('close', () => resolve(ui.confirm.returnValue === 'ok'), { once: true });
  });
}

function showEditor(title, body) {
  ui.editor.replaceChildren();
  const form = document.createElement('form');
  form.noValidate = true;
  form.dataset.editorForm = '1';
  form.innerHTML = `<h2 class="display">${esc(title)}</h2>${body}<div class="admin-actions"><button type="submit" class="btn btn--sm btn--solid">Enregistrer</button><button type="button" class="btn btn--sm" data-close>Annuler</button></div>`;
  ui.editor.append(form);
  if (!ui.editor.open) ui.editor.showModal();
  form.querySelector('input, textarea, select')?.focus();
}

function fieldError(name, message) {
  const node = ui.editor.querySelector(`[data-err="${name}"]`);
  const input = ui.editor.querySelector(`[name="${name}"]`);
  if (node) node.textContent = message || '';
  if (input) input.setAttribute('aria-invalid', message ? 'true' : 'false');
}

function iconPicker(selected) {
  return `<div class="admin-icons" role="group" aria-label="Icône">${ICONS.map(([id, label]) => `
    <button type="button" data-icon="${esc(id)}" aria-pressed="${id === selected ? 'true' : 'false'}" aria-label="${esc(label)}">
      <svg class="i" aria-hidden="true"><use href="#${esc(id)}"/></svg>
    </button>`).join('')}</div><p class="admin-err" data-err="icon"></p>`;
}

function openProduct(id) {
  const existing = id ? draft.products.find((p) => p.id === id) : null;
  const cat = existing?.cat || draft.categories[0]?.id || '';
  const position = existing ? positionOf(existing.id) : draft.products.filter((p) => p.cat === cat).length + 1;
  const shot = pending.get(id);
  editorSession = {
    kind: 'product',
    id: existing?.id || '',
    imageChoice: shot?.blob ? 'file' : shot?.remove ? 'clear' : existing?.img ? 'keep' : 'clear',
    blob: shot?.blob || null,
    width: shot?.width || 0,
    height: shot?.height || 0,
    url: shot?.url || (!shot?.remove && existing ? remoteUrls.get(existing.id) || '' : ''),
  };
  const locked = Boolean(existing && isProtectedProduct(existing.id));
  const options = draft.categories.map((c) => `<option value="${esc(c.id)}" ${c.id === cat ? 'selected' : ''}>${esc(c.label)}</option>`).join('');
  showEditor(existing ? 'Modifier l’article' : 'Nouvel article', `
    ${existing ? `<p class="admin-id">Identifiant fixe : ${esc(existing.id)}. Il ne change pas, pour ne pas casser les devis déjà enregistrés sur les téléphones des visiteurs.</p>` : '<p class="admin-id">L’identifiant est créé à partir du nom, et reste unique.</p>'}
    ${locked ? '<p class="admin-id">Article protégé : il reste dans sa famille et ne peut pas être supprimé. La gamme Prumysl Solaire, elle, reste sur sa page dédiée.</p>' : ''}
    <label class="admin-field"><span>Nom</span><input name="name" maxlength="120" value="${esc(existing?.name || '')}" autocomplete="off"><p class="admin-err" data-err="name"></p></label>
    <label class="admin-field"><span>Famille</span><select name="cat" ${locked ? 'disabled' : ''}>${options}</select><p class="admin-err" data-err="cat"></p></label>
    <label class="admin-field"><span>Description</span><textarea name="text" maxlength="800">${esc(existing?.text || '')}</textarea><p class="admin-err" data-err="text"></p></label>
    <label class="admin-field"><span>Position dans la famille</span><input name="position" type="number" min="1" step="1" value="${position}"><p class="admin-err" data-err="position"></p></label>
    <div class="admin-field">
      <span>Photo (facultative)</span>
      <input class="admin-file" data-file type="file" accept="image/jpeg,image/png,image/webp,image/gif">
      <button type="button" class="admin-textbtn" data-pick>Choisir une photo</button>
      <div class="admin-preview" data-preview hidden></div>
      <p class="muted" data-image-meta></p>
      <p class="admin-err" data-err="image"></p>
      <div class="admin-actions">
        <button type="button" class="admin-textbtn" data-clear-image>Retirer la photo</button>
        ${mockMode ? '<button type="button" class="admin-textbtn" data-demo-image>Utiliser une image de test</button>' : ''}
      </div>
    </div>`);
  refreshPreview();
}

function refreshPreview() {
  const box = ui.editor.querySelector('[data-preview]');
  const meta = ui.editor.querySelector('[data-image-meta]');
  if (!box || !editorSession) return;
  box.replaceChildren();
  if (editorSession.imageChoice !== 'clear' && editorSession.url) {
    const img = document.createElement('img');
    img.alt = 'Aperçu de la photo';
    img.src = editorSession.url;
    box.hidden = false;
    box.append(img);
    meta.textContent = editorSession.width ? `${editorSession.width} × ${editorSession.height} px · WebP · ${formatBytes(editorSession.blob?.size || 0)}` : 'Photo actuelle';
  } else {
    box.hidden = true;
    meta.textContent = editorSession.imageChoice === 'clear' ? 'Aucune photo.' : '';
  }
}

async function useImageFile(file) {
  fieldError('image', '');
  const meta = ui.editor.querySelector('[data-image-meta]');
  if (meta) meta.textContent = 'Compression de l’image…';
  try {
    const result = await compressImage(file);
    if (editorSession.url && editorSession.url !== remoteUrls.get(editorSession.id) && editorSession.url !== pending.get(editorSession.id)?.url) {
      URL.revokeObjectURL(editorSession.url);
    }
    editorSession.blob = result.blob;
    editorSession.width = result.width;
    editorSession.height = result.height;
    editorSession.url = URL.createObjectURL(result.blob);
    editorSession.imageChoice = 'file';
    refreshPreview();
  } catch (err) {
    if (meta) meta.textContent = '';
    fieldError('image', err.message || 'Image impossible à lire.');
  }
}

async function demoFile() {
  const canvas = document.createElement('canvas');
  canvas.width = 1600;
  canvas.height = 1000;
  const ctx = canvas.getContext('2d');
  const tokens = getComputedStyle(document.documentElement);
  const ink = tokens.getPropertyValue('--ink').trim() || '#1a2160';
  const accent = tokens.getPropertyValue('--accent').trim() || '#22b573';
  const paper = tokens.getPropertyValue('--paper').trim() || '#f4f5fb';
  ctx.fillStyle = ink;
  ctx.fillRect(0, 0, 1600, 1000);
  ctx.fillStyle = accent;
  ctx.fillRect(120, 160, 1360, 680);
  ctx.fillStyle = paper;
  ctx.font = '600 72px sans-serif';
  ctx.fillText('PRUMYSL', 180, 520);
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/png'));
  return new File([blob], 'demo.png', { type: 'image/png' });
}

function saveProduct(form) {
  const locked = editorSession.id && isProtectedProduct(editorSession.id)
    ? draft.products.find((p) => p.id === editorSession.id)
    : null;
  const input = {
    name: fieldValue(form, 'name'),
    cat: locked?.cat || fieldValue(form, 'cat'),
    text: fieldValue(form, 'text'),
    position: Number(fieldValue(form, 'position')),
  };
  const result = validateProduct(input, draft, editorSession.id || undefined);
  for (const key of ['name', 'cat', 'text', 'position', 'image']) fieldError(key, result.errors[key] || '');
  if (!result.ok) return;
  const kept = protectionError(baseline, {
    ...draft,
    products: draft.products.map((p) => (p.id === result.value.id ? { ...p, cat: result.value.cat } : p)),
  });
  if (kept) {
    fieldError('cat', kept);
    return;
  }
  if (editorSession.imageChoice === 'file' && !editorSession.blob) {
    fieldError('image', 'La photo n’est pas prête. Choisissez-la de nouveau.');
    return;
  }
  const value = result.value;
  const previous = editorSession.id ? draft.products.find((p) => p.id === editorSession.id) : null;
  const product = {
    ...(previous || {}),
    id: value.id,
    cat: value.cat,
    name: value.name,
    text: value.text,
  };
  const baselineImg = baseline.products.find((p) => p.id === value.id)?.img || '';
  if (editorSession.imageChoice === 'file') {
    product.img = imagePath(value.id);
    const previousUrl = pending.get(value.id)?.url;
    if (previousUrl && previousUrl !== editorSession.url) URL.revokeObjectURL(previousUrl);
    pending.set(value.id, {
      blob: editorSession.blob,
      width: editorSession.width,
      height: editorSession.height,
      url: editorSession.url,
    });
    editorSession.url = '';
  } else if (editorSession.imageChoice === 'clear') {
    delete product.img;
    if (baselineImg) {
      const old = pending.get(value.id);
      if (old?.url) URL.revokeObjectURL(old.url);
      pending.set(value.id, { remove: true });
    } else {
      revokePending(value.id);
    }
  } else if (previous?.img) {
    product.img = previous.img;
  } else {
    delete product.img;
  }
  draft = upsertProduct(draft, product, value.position);
  ui.editor.close();
  revealProduct(value.id);
  renderList();
  markDirty();
  setStatus('info', previous ? 'Article mis à jour dans la liste. Publiez pour le mettre en ligne.' : 'Article ajouté à la liste. Publiez pour le mettre en ligne.');
  rowById(value.id)?.scrollIntoView({ block: 'nearest' });
}

function familyPreview(base) {
  const id = uniqueId(base, new Set(draft.categories.map((c) => c.id)));
  const paths = familyPaths(id);
  return `Page : ${paths.page} · données : ${paths.data}`;
}

function openCategory(id) {
  const existing = id ? draft.categories.find((c) => c.id === id) : null;
  editorSession = { kind: 'category', id: existing?.id || '', icon: existing?.icon || 'i-bolt' };
  const paths = existing ? familyPaths(existing.id) : null;
  showEditor(existing ? 'Modifier la famille' : 'Nouvelle famille', `
    ${existing ? `<p class="admin-id">Identifiant fixe : ${esc(existing.id)}. Les articles restent rattachés. Page : ${esc(paths.page)}. Données : ${esc(paths.data)}.</p>` : `<p class="admin-id">L’identifiant est créé à partir du nom et ne changera plus. <span data-slug-preview>${esc(familyPreview(slugify('')))}</span></p>`}
    <label class="admin-field"><span>Nom</span><input name="label" maxlength="60" value="${esc(existing?.label || '')}" autocomplete="off"><p class="admin-err" data-err="label"></p></label>
    <label class="admin-field"><span>Description</span><textarea name="text" maxlength="220">${esc(existing?.text || '')}</textarea><p class="admin-err" data-err="text"></p></label>
    <div class="admin-field"><span>Icône</span>${iconPicker(editorSession.icon)}</div>`);
}

function saveCategory(form) {
  const result = validateCategory({
    label: fieldValue(form, 'label'),
    text: fieldValue(form, 'text'),
    icon: editorSession.icon,
  }, draft, editorSession.id || undefined);
  for (const key of ['label', 'text', 'icon']) fieldError(key, result.errors[key] || '');
  if (!result.ok) return;
  const value = result.value;
  if (editorSession.id) {
    draft = {
      ...draft,
      categories: draft.categories.map((c) => (c.id === editorSession.id ? { ...c, label: value.label, text: value.text, icon: value.icon } : c)),
    };
  } else {
    draft = { ...draft, categories: [...draft.categories, value] };
  }
  ui.editor.close();
  renderFamilies();
  renderList();
  markDirty();
  setStatus('info', 'Famille enregistrée dans la liste. Publiez pour la mettre en ligne.');
}

function renderLogin(message) {
  root.innerHTML = `
    <section class="admin-login" data-theme="dark">
      <a class="logo" href="./" aria-label="Prumysl — accueil"><svg class="logo__svg" viewBox="0 0 265 80" aria-hidden="true"><use href="#logo"/></svg></a>
      <div class="admin-card" data-theme="light">
        <p class="eyebrow">Administration</p>
        <h1 class="display">Catalogue</h1>
        <p class="lead">Publiez les articles sur le site, depuis ce navigateur. Rien n’est envoyé tant que le jeton n’est pas reconnu.</p>
        <h2 class="h3">Créer le jeton GitHub</h2>
        <ol class="admin-steps">
          <li>Ouvrez <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener noreferrer">les jetons fins GitHub</a>. Nom : « Prumysl catalogue ». Expiration : 90 jours.</li>
          <li>Repository access : Only select repositories, puis <strong>slahmaid/pr</strong> uniquement.</li>
          <li>Permissions du dépôt : <strong>Contents : Read and write</strong>. Pour suivre la mise en ligne : <strong>Actions : Read-only</strong>.</li>
          <li>Generate token, copiez la valeur (elle commence par github_pat_) et collez-la ci-dessous.</li>
        </ol>
        <form data-login novalidate>
          <label class="admin-field"><span>Jeton d’accès</span>
            <span class="admin-token">
              <input name="token" type="password" autocomplete="off" spellcheck="false" autocapitalize="off" placeholder="github_pat_…">
              <button type="button" class="admin-textbtn" data-reveal>Afficher</button>
            </span>
            <p class="admin-err" data-login-err></p>
          </label>
          <div class="admin-actions"><button class="btn btn--solid" type="submit">Se connecter</button></div>
        </form>
        <p class="admin-note">Le jeton reste dans ce navigateur seulement. Déconnexion l’efface. Ne le partagez pas : il permet de modifier le dépôt. Cette page n’est pas dans le menu du site, enregistrez-la.</p>
        ${mockMode ? '<p class="admin-mock">Mode démonstration : rien n’est envoyé à GitHub.</p>' : ''}
      </div>
    </section>`;
  const form = root.querySelector('[data-login]');
  const err = root.querySelector('[data-login-err]');
  if (message) err.textContent = message;
  root.querySelector('[data-reveal]').addEventListener('click', () => {
    const input = form.elements.namedItem('token');
    const show = input.type === 'password';
    input.type = show ? 'text' : 'password';
    root.querySelector('[data-reveal]').textContent = show ? 'Masquer' : 'Afficher';
  });
  form.addEventListener('submit', async (event) => {
    event.preventDefault();
    const value = fieldValue(form, 'token').trim();
    if (!value) {
      err.textContent = 'Collez le jeton GitHub.';
      return;
    }
    if (!/^(github_pat_|ghp_)/.test(value)) {
      err.textContent = 'Le jeton doit commencer par github_pat_ ou ghp_.';
      return;
    }
    err.textContent = '';
    form.querySelector('button[type="submit"]').disabled = true;
    token = value;
    try {
      await gh('GET', `/repos/${SITE.owner}/${SITE.repo}`);
      await loadCatalogue();
      rememberToken(value);
      renderApp();
    } catch (error) {
      token = '';
      err.textContent = error.message || 'Connexion impossible.';
      form.querySelector('button[type="submit"]').disabled = false;
    }
  });
}

function renderApp() {
  root.innerHTML = `
    <div class="admin-app">
      <header class="admin-bar" data-theme="dark">
        <div class="admin-bar__brand">
          <a class="logo" href="./" aria-label="Prumysl — accueil"><svg class="logo__svg" viewBox="0 0 265 80" aria-hidden="true"><use href="#logo"/></svg></a>
          <p class="eyebrow">Administration du catalogue</p>
        </div>
        <p class="admin-dirty" data-dirty hidden>Modifications non publiées</p>
        <div class="admin-bar__actions">
          <a class="btn btn--sm" href="produits">Voir le catalogue</a>
          <button type="button" class="btn btn--sm btn--solid" data-publish>Publier</button>
          <button type="button" class="admin-textbtn" data-logout>Déconnexion</button>
        </div>
      </header>
      <main class="admin-main" data-theme="light">
        ${mockMode ? '<p class="admin-mock">Mode démonstration : rien n’est envoyé à GitHub. Les boutons suivent le même parcours qu’une vraie publication.</p>' : ''}
        <div class="admin-head">
          <div>
            <p class="eyebrow">Prumysl</p>
            <h1 class="display">Catalogue</h1>
          </div>
          <p class="lead admin-lead">Les changements restent dans ce navigateur jusqu’à Publier. Une seule publication envoie l’article et sa photo ensemble.</p>
        </div>
        <div class="admin-status" data-status hidden role="status">
          <p data-status-text></p>
          <div class="admin-status__links" data-status-links></div>
        </div>
        <div class="admin-tabs" role="tablist">
          <button type="button" class="chip is-active" data-tab="products" role="tab" aria-selected="true">Articles</button>
          <button type="button" class="chip" data-tab="families" role="tab" aria-selected="false">Familles</button>
        </div>
        <section data-panel="products">
          <div class="admin-toolbar">
            <label class="admin-filter">
              <span class="sr-only">Famille</span>
              <select data-family></select>
            </label>
            <label class="search">
              <svg class="i" aria-hidden="true"><use href="#i-search"/></svg>
              <span class="sr-only">Rechercher un article par nom</span>
              <input type="search" data-search placeholder="Rechercher par nom…" autocomplete="off">
            </label>
            <p class="admin-count" data-count></p>
            <button type="button" class="btn btn--sm btn--solid" data-add>Nouvel article</button>
          </div>
          <div data-list></div>
          <nav class="pager" data-pager aria-label="Pagination du catalogue" hidden></nav>
        </section>
        <section data-panel="families" hidden>
          <div class="admin-toolbar">
            <p class="lead admin-lead">Renommer une famille garde son identifiant. L’ordre des familles est aussi l’ordre des articles publiés.</p>
            <button type="button" class="btn btn--sm btn--solid" data-add-cat>Nouvelle famille</button>
          </div>
          <div data-families></div>
        </section>
      </main>
    </div>
    <dialog class="admin-dialog" data-editor></dialog>
    <dialog class="admin-dialog" data-confirm>
      <form method="dialog" class="admin-confirm">
        <p data-confirm-text></p>
        <div class="admin-actions">
          <button type="submit" class="btn btn--sm btn--solid" value="ok" data-confirm-ok>Supprimer</button>
          <button type="submit" class="btn btn--sm" value="cancel">Annuler</button>
        </div>
      </form>
    </dialog>`;
  ui.status = root.querySelector('[data-status]');
  ui.publish = root.querySelector('[data-publish]');
  ui.dirty = root.querySelector('[data-dirty]');
  ui.search = root.querySelector('[data-search]');
  ui.family = root.querySelector('[data-family]');
  ui.pager = root.querySelector('[data-pager]');
  ui.count = root.querySelector('[data-count]');
  ui.list = root.querySelector('[data-list]');
  ui.families = root.querySelector('[data-families]');
  ui.editor = root.querySelector('[data-editor]');
  ui.confirm = root.querySelector('[data-confirm]');
  ui.confirmText = root.querySelector('[data-confirm-text]');
  ui.confirmOk = root.querySelector('[data-confirm-ok]');

  root.querySelectorAll('[data-tab]').forEach((tab) => {
    tab.addEventListener('click', () => {
      root.querySelectorAll('[data-tab]').forEach((item) => {
        const on = item === tab;
        item.classList.toggle('is-active', on);
        item.setAttribute('aria-selected', on ? 'true' : 'false');
      });
      root.querySelector('[data-panel="products"]').hidden = tab.dataset.tab !== 'products';
      root.querySelector('[data-panel="families"]').hidden = tab.dataset.tab !== 'families';
    });
  });
  ui.search.addEventListener('input', () => {
    listState.page = 1;
    renderList();
  });
  ui.family.addEventListener('change', () => {
    listState.page = 1;
    renderList();
  });
  ui.pager.addEventListener('click', (event) => {
    const button = event.target.closest('[data-page]');
    if (!button || button.disabled || button.getAttribute('aria-disabled') === 'true') return;
    const page = Number(button.dataset.page);
    if (!Number.isInteger(page) || page < 1 || page === listState.page) return;
    listState.page = page;
    renderList();
    ui.list.scrollIntoView({ block: 'start' });
  });
  root.querySelector('[data-add]').addEventListener('click', () => openProduct(''));
  root.querySelector('[data-add-cat]').addEventListener('click', () => openCategory(''));
  ui.publish.addEventListener('click', publish);
  root.querySelector('[data-logout]').addEventListener('click', async () => {
    if (dirty() && !await confirmBox('Des modifications ne sont pas publiées. Se déconnecter quand même ?', 'Se déconnecter')) return;
    clearAllPending();
    forgetToken();
    baseline = null;
    draft = null;
    renderLogin();
  });
  ui.list.addEventListener('click', onListClick);
  ui.families.addEventListener('click', onFamilyClick);
  ui.list.addEventListener('dragstart', onDragStart);
  ui.list.addEventListener('dragend', onDragEnd);
  ui.list.addEventListener('dragover', onDragOver);
  ui.list.addEventListener('drop', onDrop);
  ui.editor.addEventListener('click', onEditorClick);
  ui.editor.addEventListener('change', onEditorChange);
  ui.editor.addEventListener('input', (event) => {
    if (event.target.name) fieldError(event.target.name, '');
    if (editorSession?.kind === 'category' && !editorSession.id && event.target.name === 'label') {
      const preview = ui.editor.querySelector('[data-slug-preview]');
      if (!preview) return;
      preview.textContent = familyPreview(slugify(event.target.value));
    }
  });
  ui.editor.addEventListener('submit', (event) => {
    event.preventDefault();
    if (!editorSession) return;
    if (editorSession.kind === 'product') saveProduct(event.target);
    else saveCategory(event.target);
  });
  ui.editor.addEventListener('close', () => {
    if (editorSession?.kind === 'product' && editorSession.imageChoice === 'file' && editorSession.url) {
      const kept = pending.get(editorSession.id)?.url;
      if (editorSession.url !== kept) URL.revokeObjectURL(editorSession.url);
    }
    editorSession = null;
  });
  renderList();
  renderFamilies();
  markDirty();
}

async function onListClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button || busy) return;
  const id = button.closest('[data-id]')?.dataset.id;
  if (!id) return;
  if (button.dataset.act === 'up') moveProductBy(id, -1);
  if (button.dataset.act === 'down') moveProductBy(id, 1);
  if (button.dataset.act === 'edit') openProduct(id);
  if (button.dataset.act === 'delete') {
    const product = draft.products.find((p) => p.id === id);
    const blocked = protectionError(baseline, deleteProduct(draft, id));
    if (blocked) {
      setStatus('err', blocked);
      return;
    }
    if (!await confirmBox(`Supprimer « ${product?.name || id} » du catalogue ?`, 'Supprimer')) return;
    draft = deleteProduct(draft, id);
    const baselineImg = baseline.products.find((p) => p.id === id)?.img;
    if (baselineImg) {
      const old = pending.get(id);
      if (old?.url) URL.revokeObjectURL(old.url);
      pending.set(id, { remove: true });
    } else {
      revokePending(id);
    }
    renderList();
    markDirty();
    setStatus('info', 'Article retiré de la liste. Publiez pour le retirer du site.');
  }
}

async function onFamilyClick(event) {
  const button = event.target.closest('[data-act]');
  if (!button || busy) return;
  const id = button.closest('[data-cat-id]')?.dataset.catId;
  if (!id) return;
  const index = draft.categories.findIndex((c) => c.id === id);
  if (button.dataset.act === 'cat-up' && index > 0) {
    draft = moveCategory(draft, id, index - 1);
    renderFamilies();
    renderList();
    markDirty();
  }
  if (button.dataset.act === 'cat-down' && index >= 0 && index < draft.categories.length - 1) {
    draft = moveCategory(draft, id, index + 1);
    renderFamilies();
    renderList();
    markDirty();
  }
  if (button.dataset.act === 'cat-edit') openCategory(id);
  if (button.dataset.act === 'cat-delete') {
    const result = deleteCategory(draft, id);
    if (!result.ok) {
      setStatus('err', result.error);
      return;
    }
    const category = draft.categories.find((c) => c.id === id);
    if (!await confirmBox(`Supprimer la famille « ${category?.label || id} » ?`, 'Supprimer')) return;
    draft = result.doc;
    renderFamilies();
    renderList();
    markDirty();
    setStatus('info', 'Famille retirée de la liste. Publiez pour la retirer du site.');
  }
}

function clearDropStyles() {
  ui.list?.querySelectorAll('.is-dragging, .is-drop-before, .is-drop-after, .is-drop-cat').forEach((node) => {
    node.classList.remove('is-dragging', 'is-drop-before', 'is-drop-after', 'is-drop-cat');
  });
}

function onDragStart(event) {
  if (busy || (ui.search && ui.search.value.trim())) {
    event.preventDefault();
    return;
  }
  const handle = event.target.closest('[data-drag]');
  if (!handle || !handle.draggable) {
    event.preventDefault();
    return;
  }
  const row = handle.closest('[data-id]');
  dragId = row?.dataset.id || '';
  if (!dragId) return;
  event.dataTransfer.effectAllowed = 'move';
  event.dataTransfer.setData('text/plain', dragId);
  row.classList.add('is-dragging');
}

function onDragEnd() {
  dragId = '';
  clearDropStyles();
}

function onDragOver(event) {
  if (!dragId) return;
  const row = event.target.closest('[data-id]');
  const group = event.target.closest('[data-drop-cat]');
  ui.list.querySelectorAll('.is-drop-before, .is-drop-after, .is-drop-cat').forEach((node) => {
    node.classList.remove('is-drop-before', 'is-drop-after', 'is-drop-cat');
  });
  if (row && row.dataset.id !== dragId) {
    event.preventDefault();
    const box = row.getBoundingClientRect();
    const before = event.clientY < box.top + box.height / 2;
    row.classList.add(before ? 'is-drop-before' : 'is-drop-after');
    row.dataset.dropBefore = before ? '1' : '0';
  } else if (group) {
    event.preventDefault();
    group.classList.add('is-drop-cat');
  }
}

function onDrop(event) {
  if (!dragId) return;
  event.preventDefault();
  const id = dragId;
  const row = event.target.closest('[data-id]');
  const group = event.target.closest('[data-drop-cat]');
  const nextCat = row && row.dataset.id !== id
    ? draft.products.find((p) => p.id === row.dataset.id)?.cat
    : group?.dataset.dropCat;
  const blocked = nextCat ? protectionError(baseline, {
    ...draft,
    products: draft.products.map((p) => (p.id === id ? { ...p, cat: nextCat } : p)),
  }) : '';
  if (blocked) {
    dragId = '';
    clearDropStyles();
    setStatus('err', blocked);
    return;
  }
  if (row && row.dataset.id !== id) {
    const target = draft.products.find((p) => p.id === row.dataset.id);
    const siblings = draft.products.filter((p) => p.cat === target.cat && p.id !== id);
    let index = siblings.findIndex((p) => p.id === target.id);
    if (row.dataset.dropBefore !== '1') index += 1;
    if (index < 0) index = siblings.length;
    const product = draft.products.find((p) => p.id === id);
    draft = upsertProduct(draft, { ...product, cat: target.cat }, index);
  } else if (group?.dataset.dropCat) {
    const cat = group.dataset.dropCat;
    const product = draft.products.find((p) => p.id === id);
    const index = draft.products.filter((p) => p.cat === cat && p.id !== id).length;
    draft = upsertProduct(draft, { ...product, cat }, index);
  }
  dragId = '';
  clearDropStyles();
  revealProduct(id);
  renderList();
  markDirty();
}

function onEditorClick(event) {
  if (event.target === ui.editor) {
    ui.editor.close();
    return;
  }
  if (event.target.closest('[data-close]')) {
    ui.editor.close();
    return;
  }
  if (event.target.closest('[data-pick]')) {
    ui.editor.querySelector('[data-file]')?.click();
  }
  const icon = event.target.closest('[data-icon]');
  if (icon && editorSession?.kind === 'category') {
    editorSession.icon = icon.dataset.icon;
    ui.editor.querySelectorAll('[data-icon]').forEach((button) => {
      button.setAttribute('aria-pressed', button === icon ? 'true' : 'false');
    });
  }
  if (event.target.closest('[data-clear-image]') && editorSession?.kind === 'product') {
    if (editorSession.url && editorSession.imageChoice === 'file') URL.revokeObjectURL(editorSession.url);
    editorSession.url = '';
    editorSession.blob = null;
    editorSession.imageChoice = 'clear';
    refreshPreview();
  }
  if (event.target.closest('[data-demo-image]') && editorSession?.kind === 'product') {
    demoFile().then(useImageFile).catch((err) => fieldError('image', err.message));
  }
}

function onEditorChange(event) {
  if (event.target.matches('[data-file]') && event.target.files?.[0]) {
    useImageFile(event.target.files[0]);
    event.target.value = '';
  }
  if (event.target.matches('[name="cat"]') && editorSession?.kind === 'product') {
    const input = ui.editor.querySelector('[name="position"]');
    const room = draft.products.filter((p) => p.cat === event.target.value && p.id !== editorSession.id).length + 1;
    input.max = String(room);
    if (Number(input.value) > room) input.value = String(room);
  }
}

window.addEventListener('beforeunload', (event) => {
  if (!dirty()) return;
  event.preventDefault();
  event.returnValue = '';
});

async function boot() {
  if (mockMode) {
    try {
      await prepareMock();
    } catch (err) {
      renderLogin(err.message || 'Le catalogue de démonstration est introuvable.');
      return;
    }
  }
  const existing = savedToken();
  if (!existing) {
    renderLogin();
    return;
  }
  token = existing;
  try {
    await gh('GET', `/repos/${SITE.owner}/${SITE.repo}`);
    await loadCatalogue();
    renderApp();
  } catch (err) {
    forgetToken();
    renderLogin(err.message || 'Le jeton enregistré n’est plus valable.');
  }
}

boot();
