// Public catalogue: family pages paginate their JSON; the overview
// lazily fetches a compact search index.
const PAGE_SIZE = 20;
const SEARCH_LIMIT = 20;
const PLACEHOLDER = '<figure class="media ar-11"><div class="media__in"><img decoding="async" src="assets/img/blank-11.svg" alt="" loading="lazy" draggable="false"></div></figure>';

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => Array.from(root.querySelectorAll(sel));
const esc = (s) => String(s)
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');
const norm = (s) => String(s || '').toLowerCase().normalize('NFD').replace(/\p{M}/gu, '');
const frCount = (n) => new Intl.NumberFormat('fr-FR').format(n);
const articleLabel = (n) => `${frCount(n)} article${n > 1 ? 's' : ''}`;

function figure(p) {
  if (!p.img) return PLACEHOLDER;
  const w = Number(p.width);
  const h = Number(p.height);
  const size = Number.isInteger(w) && Number.isInteger(h) && w > 0 && h > 0
    ? ` width="${w}" height="${h}"`
    : '';
  return `<figure class="media ar-11"><div class="media__in"><img decoding="async" src="${esc(p.img)}" alt="${esc(p.name)}"${size} loading="lazy"></div></figure>`;
}

function productCard(p, label, { reveal = false } = {}) {
  const revealAttr = reveal ? ' data-reveal="fade"' : '';
  const shown = reveal ? '' : ' is-shown';
  return `<article class="pitem${shown}" id="p-${esc(p.id)}" data-item data-cat="${esc(p.cat || '')}" data-id="${esc(p.id)}"${revealAttr}>
          ${figure(p)}
          <div class="pitem__body">
            <span class="eyebrow muted">${esc(label || '')}</span>
            <h3 class="pitem__name">${esc(p.name)}</h3>
            <p class="muted">${esc(p.text || '')}</p>
            <button type="button" class="btn btn--sm pitem__add" data-add-quote data-id="${esc(p.id)}" data-name="${esc(p.name)}"><span data-add-label>Ajouter au devis</span> <svg class="i"><use href="#i-plus"/></svg></button>
          </div>
        </article>`;
}

function syncQuote() {
  document.dispatchEvent(new Event('catalogue:rendered'));
}

function loadJson(url) {
  return fetch(url, { credentials: 'same-origin', headers: { Accept: 'application/json' } }).then((r) => {
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return r.json();
  });
}

function debounce(fn, ms) {
  let t;
  return (...args) => {
    clearTimeout(t);
    t = setTimeout(() => fn(...args), ms);
  };
}

// Page numbers with ellipsis: 1 … 4 5 6 … 88
function pageItems(current, total) {
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

function readPageParam() {
  const n = Number(new URLSearchParams(location.search).get('page'));
  return Number.isInteger(n) && n > 0 ? n : 1;
}

function productHashId() {
  return (location.hash.match(/^#p-([\w-]+)$/) || [])[1] || '';
}

/* ------------------------------------------------------- family pages */
function initFamily(root) {
  const src = root.dataset.catalogueSrc;
  const label = root.dataset.catalogueLabel || '';
  const grid = $('[data-catalogue-grid]', root);
  const out = $('[data-count-out]', root);
  const empty = $('[data-empty]', root);
  const pager = $('[data-catalogue-pager]', root);
  const status = $('[data-catalogue-status]', root);
  const search = $('[data-family-search]', root);
  if (!src || !grid) return;

  let products = [];
  let filtered = [];
  let page = 1;
  let query = '';
  let rawQuery = '';
  let loading = false;

  const pageCount = () => Math.max(1, Math.ceil(filtered.length / PAGE_SIZE) || 1);
  const clamp = (n) => Math.min(pageCount(), Math.max(1, n));

  const setStatus = (msg, isError = false) => {
    if (!status) return;
    status.hidden = !msg;
    status.textContent = msg || '';
    status.classList.toggle('is-error', !!isError);
  };

  const hrefFor = (n, hash) => {
    const url = new URL(location.href);
    if (n <= 1) url.searchParams.delete('page');
    else url.searchParams.set('page', String(n));
    if (rawQuery) url.searchParams.set('q', rawQuery);
    else url.searchParams.delete('q');
    url.hash = hash ? `#p-${hash}` : '';
    return `${url.pathname}${url.search}${url.hash}`;
  };

  const writeUrl = (opts = {}) => {
    const url = hrefFor(page, opts.hash || '');
    const method = opts.push ? 'pushState' : 'replaceState';
    history[method]({ page, q: rawQuery }, '', url);
  };

  const navBtn = (kind, text, rel) => {
    const disabled = (kind === 'first' || kind === 'prev') ? page <= 1 : page >= pageCount();
    const target = kind === 'first' ? 1 : kind === 'last' ? pageCount() : kind === 'prev' ? page - 1 : page + 1;
    const aria = disabled ? ' aria-disabled="true" tabindex="-1"' : '';
    const relAttr = rel ? ` rel="${rel}"` : '';
    const symbol = kind === 'first' ? '<span aria-hidden="true">«</span>'
      : kind === 'last' ? '<span aria-hidden="true">»</span>'
      : kind === 'prev'
        ? '<svg class="i" aria-hidden="true"><use href="#i-arrow-left"/></svg>'
        : '<svg class="i" aria-hidden="true"><use href="#i-arrow"/></svg>';
    return `<a class="pager__btn" href="${esc(hrefFor(target))}" data-page="${target}" aria-label="${esc(text)}"${relAttr}${aria}>${symbol}<span class="pager__label">${esc(text)}</span></a>`;
  };

  const renderPager = () => {
    if (!pager) return;
    const total = filtered.length;
    if (loading || total === 0) {
      pager.hidden = true;
      pager.innerHTML = '';
      return;
    }
    const pages = pageCount();
    const statusText = `Page ${frCount(page)} sur ${frCount(pages)} · ${frCount(total)} produit${total > 1 ? 's' : ''}`;
    const numbers = pages === 1 ? '' : pageItems(page, pages).map((item) => {
      if (item === '…') return '<span class="pager__gap" aria-hidden="true">…</span>';
      const current = item === page ? ' aria-current="page"' : '';
      return `<a class="pager__num" href="${esc(hrefFor(item))}" data-page="${item}" aria-label="Page ${item}"${current}>${frCount(item)}</a>`;
    }).join('');
    const nav = pages === 1 ? '' : `<div class="pager__nav">
      ${navBtn('first', 'Première page', 'first')}
      ${navBtn('prev', 'Page précédente', 'prev')}
      ${numbers}
      ${navBtn('next', 'Page suivante', 'next')}
      ${navBtn('last', 'Dernière page', 'last')}
    </div>`;
    pager.innerHTML = `<p class="pager__status eyebrow muted" data-pager-status aria-live="polite">${statusText}</p>${nav}`;
    pager.hidden = false;
  };

  const updateChrome = () => {
    const total = filtered.length;
    if (out) {
      out.textContent = query
        ? `${articleLabel(total)} trouvé${total > 1 ? 's' : ''}`
        : articleLabel(total);
    }
    if (empty) empty.hidden = total > 0 || loading;
    renderPager();
  };

  const renderPage = () => {
    page = clamp(page);
    const start = (page - 1) * PAGE_SIZE;
    const slice = filtered.slice(start, start + PAGE_SIZE);
    grid.innerHTML = slice.map((p) => productCard(p, label)).join('');
    syncQuote();
    updateChrome();
  };

  const goTo = (next, { push = false, scroll = false, hash = '', replace = false } = {}) => {
    page = clamp(next);
    renderPage();
    writeUrl({ push, hash, replace: !push });
    if (scroll) {
      const y = grid.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
    if (hash) highlight(hash);
  };

  const highlight = (id) => {
    const el = document.getElementById(`p-${id}`);
    if (!el) return;
    el.classList.add('is-target');
    el.setAttribute('tabindex', '-1');
    el.scrollIntoView({ block: 'center' });
    try { el.focus({ preventScroll: true }); } catch (err) { /* old browsers */ }
  };

  const applyFilter = () => {
    filtered = query ? products.filter((p) => p._n.includes(query)) : products;
  };

  const revealFromUrl = ({ push = false, scroll = false } = {}) => {
    applyFilter();
    const hash = productHashId();
    if (hash) {
      const idx = filtered.findIndex((p) => p.id === hash);
      if (idx >= 0) {
        page = Math.floor(idx / PAGE_SIZE) + 1;
        renderPage();
        writeUrl({ push, hash });
        highlight(hash);
        return;
      }
    }
    page = clamp(readPageParam());
    renderPage();
    if (scroll) {
      const y = grid.getBoundingClientRect().top + window.scrollY - 24;
      window.scrollTo({ top: Math.max(0, y), behavior: 'smooth' });
    }
  };

  if (pager) {
    pager.addEventListener('click', (e) => {
      const a = e.target.closest('a[data-page]');
      if (!a || pager.contains(a) === false) return;
      e.preventDefault();
      if (a.getAttribute('aria-disabled') === 'true') return;
      goTo(Number(a.dataset.page), { push: true, scroll: true });
    });
  }

  window.addEventListener('popstate', () => {
    rawQuery = new URLSearchParams(location.search).get('q') || '';
    query = norm(rawQuery);
    if (search && search.value !== rawQuery) search.value = rawQuery;
    revealFromUrl({ scroll: true });
  });

  if (search) {
    rawQuery = new URLSearchParams(location.search).get('q') || '';
    if (rawQuery) search.value = rawQuery;
    query = norm(rawQuery);
    search.addEventListener('input', debounce(() => {
      rawQuery = search.value.trim();
      query = norm(rawQuery);
      if (!products.length) return;
      applyFilter();
      goTo(1, { push: false, scroll: false });
    }, 150));
  }

  setStatus('Chargement du catalogue…');
  loading = true;
  const already = $$('[data-item]', grid).length;
  const requested = readPageParam();
  loadJson(src).then((data) => {
    products = (data.products || []).map((p) => {
      p.cat = p.cat || data.id;
      p._n = norm(`${p.name} ${p.text || ''}`);
      return p;
    });
    filtered = products;
    loading = false;
    setStatus('');
    applyFilter();
    const hash = productHashId();
    const canKeepSsr = !query && !hash && requested <= 1 && already > 0;
    if (canKeepSsr) {
      page = 1;
      updateChrome();
    } else {
      revealFromUrl();
    }
  }).catch(() => {
    loading = false;
    setStatus('Impossible de charger le catalogue. Vérifiez votre connexion et réessayez.', true);
    updateChrome();
  });
}

/* ------------------------------------------------------- global search */
function initSearch(root) {
  const src = root.dataset.catalogueIndex;
  const input = $('[data-global-search]', root);
  const list = $('[data-search-results]', root);
  const out = $('[data-count-out]', root);
  const empty = $('[data-empty]', root);
  const status = $('[data-catalogue-status]', root);
  if (!src || !input || !list) return;

  let index = null;
  let loading = null;
  let query = '';

  const setStatus = (msg, isError = false) => {
    if (!status) return;
    status.hidden = !msg;
    status.textContent = msg || '';
    status.classList.toggle('is-error', !!isError);
  };

  const ensureIndex = () => {
    if (index) return Promise.resolve(index);
    if (loading) return loading;
    setStatus('Chargement de l’index de recherche…');
    loading = loadJson(src).then((data) => {
      const labels = data.c || {};
      index = (data.p || []).map(([id, name, cat]) => ({
        id,
        name,
        cat,
        label: labels[cat] || cat,
        href: `produits-${cat}#p-${id}`,
        _n: norm(name),
      }));
      setStatus('');
      return index;
    }).catch((err) => {
      loading = null;
      setStatus('Impossible de charger la recherche. Réessayez.', true);
      throw err;
    });
    return loading;
  };

  const match = (q) => {
    const starts = [];
    const mid = [];
    for (const it of index) {
      const i = it._n.indexOf(q);
      if (i === 0) starts.push(it);
      else if (i > 0) mid.push(it);
      if (starts.length >= SEARCH_LIMIT) break;
    }
    return starts.concat(mid).slice(0, SEARCH_LIMIT);
  };

  const render = (items, q) => {
    if (!q) {
      list.innerHTML = '';
      list.hidden = true;
      if (out) out.textContent = index ? `${articleLabel(index.length)} dans le catalogue` : '';
      if (empty) empty.hidden = true;
      return;
    }
    list.hidden = false;
    if (!items.length) {
      list.innerHTML = '';
      if (out) out.textContent = '0 article';
      if (empty) empty.hidden = false;
      return;
    }
    if (empty) empty.hidden = true;
    if (out) out.textContent = items.length < SEARCH_LIMIT
      ? articleLabel(items.length)
      : `${frCount(items.length)} premiers résultats`;
    list.innerHTML = items.map((it) => (
      `<li class="sresult">
        <div>
          <span class="eyebrow muted">${esc(it.label)}</span>
          <p class="sresult__name display"><a href="${esc(it.href)}">${esc(it.name)}</a></p>
        </div>
        <button type="button" class="btn btn--sm pitem__add" data-add-quote data-id="${esc(it.id)}" data-name="${esc(it.name)}"><span data-add-label>Ajouter au devis</span> <svg class="i"><use href="#i-plus"/></svg></button>
      </li>`
    )).join('');
    syncQuote();
  };

  const run = () => {
    query = norm(input.value.trim());
    if (!index) return;
    render(query ? match(query) : [], query);
  };

  const onNeedIndex = () => {
    ensureIndex().then(run).catch(() => {});
  };

  input.addEventListener('focus', onNeedIndex, { once: false });
  input.addEventListener('input', debounce(() => {
    if (!index) onNeedIndex();
    else run();
  }, 150));
}

/* -------------------------------------------- legacy #cat- family links */
function redirectLegacyHash() {
  if (document.body.dataset.page !== 'produits') return;
  const cat = (location.hash.match(/^#cat-([\w-]+)$/) || [])[1];
  if (!cat) return;
  const dest = `produits-${cat}`;
  if (document.querySelector(`a[href^="${dest}"]`)) location.replace(dest);
}

redirectLegacyHash();
$$('[data-catalogue-family]').forEach(initFamily);
$$('[data-catalogue-search]').forEach(initSearch);
