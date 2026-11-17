// Builds the website into dist/ — the only folder to upload to your host.
//
//   node build.mjs
//
// src/pages/<name>.html     page content, starting with a JSON comment:
//                           <!-- { "title": "...", "description": "...", "nav": "produits", "preloader": "quick" } -->
// src/partials/*.html       shared pieces (header, menu, footer, sprite, ...)
// src/data/site.json        site address, name, phone (fill "url" before going live)
// src/data/produits.json    product catalogue rendered into produits.html
// src/data/partenaires.json partner and client lists rendered into partenaires.html
//
// dist/ is rebuilt from scratch on every run: never edit files inside it.
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { readImageSize } from './src/build/image-size.mjs';
import { productFigure } from './src/build/product-html.mjs';

const root = fileURLToPath(new URL('.', import.meta.url));
const src = join(root, 'src');
const dist = join(root, 'dist');
const read = (...p) => readFileSync(join(src, ...p), 'utf8');
const json = (...p) => JSON.parse(read(...p));
const partial = (name) => read('partials', `${name}.html`).trim();
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const norm = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
const shortHash = (s) => createHash('sha256').update(s).digest('hex').slice(0, 10);

const site = json('data', 'site.json');
const siteUrl = (site.url || '').replace(/\/+$/, '');
// Folder the site lives in: "/" on its own domain, "/pr/" on GitHub Pages.
// The 404 page uses it so its links work at any depth.
const basePath = siteUrl ? new URL(`${siteUrl}/`).pathname : '/';
// Public address of a built page. Files stay *.html so the old addresses keep
// working; GitHub Pages also serves them without the extension and without a
// trailing slash (/services, not /services/). Home is the site root.
const publicUrl = (name) => (siteUrl ? (name === 'index' ? `${siteUrl}/` : `${siteUrl}/${name}`) : '');
function cleanPageLinks(html) {
  return html.replace(/\shref="([^"]*)"/g, (full, href) => {
    if (/^[a-z][a-z0-9+.-]*:/i.test(href) || href.startsWith('#') || href.startsWith('//')) return full;
    const next = href
      .replace(/(^|\/)index\.html(?=$|[?#])/g, '$1./')
      .replace(/\.html(?=$|[?#])/g, '');
    return next === href ? full : full.replace(href, next);
  });
}
const catalogue = json('data', 'produits.json');
const partners = json('data', 'partenaires.json');

/* ------------------------------------------------------------ security */
// No third-party requests: fonts and three.js are served from this site, so no
// CDN or Google server sees visitors' IP addresses and a CDN compromise cannot
// inject code. three.js r160 is the exact jsDelivr file; the build refuses to
// run if its hash ever changes.
const THREE_URL = 'assets/vendor/three.module.min.js';
const THREE_SRI = 'sha256-PmkKx9GAsKrfCJG+o57sZD4p4tPnXJmxholRhmX2m6Y=';
{
  const actual = `sha256-${createHash('sha256').update(readFileSync(join(root, THREE_URL))).digest('base64')}`;
  if (actual !== THREE_SRI) throw new Error(`${THREE_URL}: empreinte inattendue (${actual})`);
}
const FONT_FILES = readdirSync(join(root, 'assets/fonts')).map((f) => `assets/fonts/${f}`);

// The only inline script (adds the "js" class before first paint) is allowed by its hash.
const bootScript = partial('head').match(/<script>([\s\S]*?)<\/script>/)[1];
const bootHash = createHash('sha256').update(bootScript).digest('base64');

function makeCsp({ connect = ["'self'"], img = ["'self'", 'data:'] } = {}) {
  const directives = {
    'default-src': ["'self'"],
    'script-src': ["'self'", `'sha256-${bootHash}'`],
    // 'unsafe-inline' only for style attributes (CSS variables set by the scripts).
    'style-src': ["'self'", "'unsafe-inline'"],
    'font-src': ["'self'"],
    'img-src': img,
    'connect-src': connect,
    'object-src': ["'none'"],
    // Google Maps embed on the contact page (loaded only after consent or a click).
    'frame-src': ['https://www.google.com'],
    'media-src': ["'self'"],
    'worker-src': ["'none'"],
    'manifest-src': ["'self'"],
    'base-uri': ["'self'"],
    // The contact form is handed to WhatsApp by script; nothing is posted anywhere.
    'form-action': ["'self'"],
  };
  return Object.entries(directives).map(([k, v]) => (v.length ? `${k} ${v.join(' ')}` : k)).join('; ');
}
const cspMeta = makeCsp();
const cspHeader = `${cspMeta}; frame-ancestors 'none'; upgrade-insecure-requests`;
// The admin page talks to GitHub from the browser. Other pages stay closed.
const adminCspMeta = makeCsp({
  connect: ["'self'", 'https://api.github.com'],
  img: ["'self'", 'data:', 'blob:'],
});
const adminCspHeader = `${adminCspMeta}; frame-ancestors 'none'; upgrade-insecure-requests`;

const securityHeaders = {
  'Strict-Transport-Security': 'max-age=31536000; includeSubDomains',
  'Content-Security-Policy': cspHeader,
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'strict-origin-when-cross-origin',
  'Permissions-Policy': 'accelerometer=(), camera=(), geolocation=(), gyroscope=(), magnetometer=(), microphone=(), payment=(), usb=(), interest-cohort=()',
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Resource-Policy': 'same-origin',
};

/* ------------------------------------------------------------ renderers */
const PAGE_SIZE = 20;
const familyPage = (id) => `produits-${id}.html`;
const familyDataPath = (id) => `data/produits-${id}.json`;
const catCount = (id) => catalogue.products.filter((p) => p.cat === id).length;
const formatCount = (n) => new Intl.NumberFormat('fr-FR').format(n);
const articleLabel = (n) => `${formatCount(n)} article${n > 1 ? 's' : ''}`;

function renderCategories() {
  return catalogue.categories.map((c, i) => {
    const n = catCount(c.id);
    return `
      <li class="tile" data-reveal="fade">
        <svg class="i tile__i"><use href="#${c.icon}"/></svg>
        <h3 class="display tile__t">${esc(c.label)}</h3>
        <p>${esc(c.text)}</p>
        <p class="tile__count eyebrow muted">${articleLabel(n)}</p>
        <a class="tile__a" href="${familyPage(c.id)}"><span class="sr-only">Voir ${esc(c.label)}</span></a>
        <span class="tile__n eyebrow">${String(i + 1).padStart(2, '0')}</span>
      </li>`;
  }).join('');
}

function renderFamilyFilters(activeId) {
  const chips = ['<a class="chip" href="produits.html">Toutes les familles</a>'];
  for (const c of catalogue.categories) {
    const current = c.id === activeId;
    const cls = current ? 'chip is-active' : 'chip';
    const aria = current ? ' aria-current="page"' : '';
    chips.push(`<a class="${cls}" href="${familyPage(c.id)}"${aria}>${esc(c.label)} <small>${catCount(c.id)}</small></a>`);
  }
  return chips.join('\n          ');
}

function splitTitle(label) {
  if (label.includes(' & ')) {
    const [a, b] = label.split(' & ');
    return [a, `& ${b}`];
  }
  const i = label.lastIndexOf(' ');
  if (i > 0) return [label.slice(0, i), label.slice(i + 1)];
  return [label, 'catalogue'];
}

function mediaFor(product) {
  if (!product.img) return { figure: productFigure(product) };
  const rel = String(product.img);
  if (!/^assets\/img\/[a-zA-Z0-9/._-]+$/.test(rel) || rel.includes('..')) {
    throw new Error(`Chemin d'image invalide pour « ${product.name} » (${product.id})`);
  }
  const abs = join(root, rel);
  if (!existsSync(abs)) throw new Error(`Image introuvable pour « ${product.name} » : ${rel}`);
  const dim = readImageSize(readFileSync(abs));
  if (!dim) throw new Error(`Dimensions illisibles : ${rel}`);
  return { figure: productFigure(product, dim), img: rel, width: dim.width, height: dim.height };
}

function renderProductCard(p, label) {
  return `
        <article class="pitem" id="p-${esc(p.id)}" data-item data-cat="${esc(p.cat)}" data-id="${esc(p.id)}" data-reveal="fade">
          ${mediaFor(p).figure}
          <div class="pitem__body">
            <span class="eyebrow muted">${esc(label)}</span>
            <h3 class="pitem__name">${esc(p.name)}</h3>
            <p class="muted">${esc(p.text)}</p>
            <button type="button" class="btn btn--sm pitem__add" data-add-quote data-id="${esc(p.id)}" data-name="${esc(p.name)}"><span data-add-label>Ajouter au devis</span> <svg class="i"><use href="#i-plus"/></svg></button>
          </div>
        </article>`;
}

const FAMILY_WORDS = [null, 'Une', 'Deux', 'Trois', 'Quatre', 'Cinq', 'Six', 'Sept', 'Huit', 'Neuf', 'Dix', 'Onze', 'Douze'];
function familiesHeading(count) {
  if (count <= 1) return 'Une famille, un seul fournisseur.';
  const word = FAMILY_WORDS[count];
  return `${word || count} familles, un seul fournisseur.`;
}

function renderProductCards(products, label) {
  return products.map((p) => renderProductCard(p, label)).join('');
}

function renderPartners(list, placeholder, emptyCount) {
  const valid = (list || []).filter((p) => p && p.name);
  if (!valid.length) {
    return Array.from({ length: emptyCount }, () => `
      <li class="logo-tile" data-reveal="fade" aria-label="${placeholder}"><span>${placeholder}</span></li>`).join('');
  }
  return valid.map((p) => p.logo
    ? `
      <li class="logo-tile" data-reveal="fade"><img src="${esc(p.logo)}" alt="${esc(p.name)}" loading="lazy"></li>`
    : `
      <li class="logo-tile logo-tile--name" data-reveal="fade"><span>${esc(p.name)}</span></li>`).join('');
}

function jsonLd() {
  const data = {
    '@context': 'https://schema.org',
    '@type': 'Electrician',
    name: site.name,
    description: site.description,
    telephone: site.telephone,
    areaServed: { '@type': 'Country', name: 'Maroc' },
    sameAs: [site.shop],
  };
  if (site.address) data.address = { '@type': 'PostalAddress', ...site.address };
  if (site.geo) data.geo = { '@type': 'GeoCoordinates', ...site.geo };
  if (site.map) data.hasMap = site.map;
  if (siteUrl) {
    data.url = `${siteUrl}/`;
    data.logo = `${siteUrl}/assets/img/logo-prumysl.svg`;
  }
  return `<script type="application/ld+json">${JSON.stringify(data)}</script>`;
}

const minifyCss = (css) => css
  .replace(/\/\*[\s\S]*?\*\//g, '')
  .replace(/\s+/g, ' ')
  .replace(/\s*([{};,>])\s*/g, '$1')
  .replace(/;}/g, '}')
  .trim();

/* ------------------------------------------------------------ build */
rmSync(dist, { recursive: true, force: true });
mkdirSync(dist, { recursive: true });
const out = (rel, content) => {
  const file = join(dist, rel);
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, content);
};

// Versioned CSS and JS: long browser caching, refreshed whenever the file changes.
const css = minifyCss(readFileSync(join(root, 'assets/css/style.css'), 'utf8'));
const appJs = readFileSync(join(root, 'assets/js/app.js'), 'utf8');
const towerJs = readFileSync(join(root, 'assets/js/tower.js'), 'utf8');
out('assets/css/style.css', css);
out('assets/js/app.js', appJs);
out('assets/js/tower.js', towerJs);
const adminCss = minifyCss(readFileSync(join(root, 'assets/css/admin.css'), 'utf8'));
const catalogueJs = readFileSync(join(root, 'assets/js/catalogue.js'), 'utf8');
const catalogueUiJs = readFileSync(join(root, 'assets/js/catalogue-ui.js'), 'utf8');
let adminJs = readFileSync(join(root, 'assets/js/admin.js'), 'utf8');
if (!adminJs.includes('const SEED = null;') || !adminJs.includes('__SITE_URL__') || !adminJs.includes('__CATALOGUE_URL__') || !adminJs.includes("from './catalogue.js'")) {
  throw new Error('admin.js: marqueurs de build introuvables');
}
const catalogueHash = shortHash(catalogueJs);
const catalogueRaw = read('data', 'produits.json');
const catalogueFile = catalogueRaw.endsWith('\n') ? catalogueRaw : `${catalogueRaw}\n`;
const catalogueDataHash = shortHash(catalogueFile);
// The admin fetches this file. Inlining ~6,800 products into admin.js made the page unusable.
adminJs = adminJs
  .replaceAll('__CATALOGUE_URL__', `data/produits.json?v=${catalogueDataHash}`)
  .replaceAll('__SITE_URL__', siteUrl)
  .replaceAll("from './catalogue.js'", `from './catalogue.js?v=${catalogueHash}'`);
if (adminJs.includes('const SEED = {') || adminJs.includes('__CATALOGUE_URL__')) {
  throw new Error('admin.js: le catalogue ne doit pas être intégré dans la page');
}
out('assets/css/admin.css', adminCss);
out('assets/js/catalogue.js', catalogueJs);
out('assets/js/catalogue-ui.js', catalogueUiJs);
out('assets/js/admin.js', adminJs);
const versions = {
  'assets/css/style.css': shortHash(css),
  'assets/js/app.js': shortHash(appJs),
  'assets/js/tower.js': shortHash(towerJs),
  'assets/css/admin.css': shortHash(adminCss),
  'assets/js/admin.js': shortHash(adminJs),
  'assets/js/catalogue.js': catalogueHash,
  'assets/js/catalogue-ui.js': shortHash(catalogueUiJs),
};

// Full source catalogue for the admin (mock mode and a same-origin fetch). Public pages use the family files.
out('data/produits.json', catalogueFile);
versions['data/produits.json'] = catalogueDataHash;

// Per-family product JSON + a compact search index, loaded on demand by the public pages.
for (const c of catalogue.categories) {
  const products = catalogue.products.filter((p) => p.cat === c.id).map((p) => {
    const rec = { id: p.id, name: p.name, text: p.text };
    const media = mediaFor(p);
    if (media.img) {
      rec.img = media.img;
      rec.width = media.width;
      rec.height = media.height;
    }
    return rec;
  });
  const json = JSON.stringify({ id: c.id, label: c.label, products });
  const rel = familyDataPath(c.id);
  out(rel, json);
  versions[rel] = shortHash(json);
}
const indexJson = JSON.stringify({
  c: Object.fromEntries(catalogue.categories.map((c) => [c.id, c.label])),
  p: catalogue.products.map((p) => [p.id, p.name, p.cat]),
});
out('data/produits-index.json', indexJson);
versions['data/produits-index.json'] = shortHash(indexJson);

const built = [];
// Files loaded from CSS or by script, not from a page attribute.
const assetRefs = new Set(['assets/img/logo-prumysl.svg', THREE_URL, ...FONT_FILES]);

function emitPage({ file, name, meta, body, note }) {
  const has3d = body.includes('data-tower');
  const pageUrl = publicUrl(name);
  const metaTags = [];
  if (meta.noindex) metaTags.push('<meta name="robots" content="noindex">');
  if (pageUrl && !meta.noindex) metaTags.push(`<link rel="canonical" href="${pageUrl}">`);
  metaTags.push(
    '<meta property="og:type" content="website">',
    '<meta property="og:locale" content="fr_MA">',
    `<meta property="og:site_name" content="${esc(site.name)}">`,
    `<meta property="og:title" content="${esc(meta.title)}">`,
    `<meta property="og:description" content="${esc(meta.description)}">`,
    '<meta name="twitter:card" content="summary">',
  );
  if (pageUrl) metaTags.push(`<meta property="og:url" content="${pageUrl}">`);

  const preload = has3d
    ? `<link rel="modulepreload" href="${THREE_URL}" integrity="${THREE_SRI}">`
    : '';

  const current = (html) => html.replace(new RegExp(`data-nav="${meta.nav}"`, 'g'), `data-nav="${meta.nav}" aria-current="page"`);
  let end = partial('end');
  if (!has3d) end = end.replace(/\s*<script src="assets\/js\/tower\.js" defer><\/script>/, '');
  if (meta.catalogue) {
    end = end.replace(
      '<script src="assets/js/app.js" defer></script>',
      '<script src="assets/js/app.js" defer></script>\n<script src="assets/js/catalogue-ui.js" defer></script>',
    );
  }

  const head = partial('head')
    .replace('{{base}}', meta.base ? `<base href="${basePath}">\n` : '')
    .replace('{{csp}}', meta.admin ? adminCspMeta : cspMeta)
    .replace('{{title}}', esc(meta.title))
    .replace('{{description}}', esc(meta.description))
    .replace('{{meta}}', metaTags.join('\n'))
    .replace('{{preload}}', preload)
    .replace('{{extra}}', meta.admin ? '<link rel="stylesheet" href="assets/css/admin.css">' : '')
    .replace('{{jsonld}}', name === 'index' ? jsonLd() : '');

  const shell = `<!-- ${note} -->`;
  let html = meta.bare
    ? `<!doctype html>
${shell}
<html lang="fr" class="no-js">
<head>
${head}
</head>
<body data-theme="light" data-page="${name}">
${partial('sprite')}
${body}
</body>
</html>
`
    : `<!doctype html>
${shell}
<html lang="fr" class="no-js">
<head>
${head}
</head>
<body data-theme="dark" data-page="${name}">

${partial('sprite')}

<a class="skip" href="#main">Aller au contenu</a>

${partial(meta.preloader === 'full' ? 'preloader-full' : 'preloader-quick')}

${current(partial('header'))}

${current(partial('menu'))}

<div class="progress" aria-hidden="true"><i data-progress></i></div>

${body}

${partial('footer')}

${end}
</body>
</html>
`;

  html = cleanPageLinks(html);
  html = html.replace(/<img (?![^>]*decoding=)/g, '<img decoding="async" ');
  for (const [asset, v] of Object.entries(versions)) html = html.split(`"${asset}"`).join(`"${asset}?v=${v}"`);
  for (const ref of html.matchAll(/(?:src|href)="(assets\/[^"?#]+)/g)) assetRefs.add(ref[1]);

  out(file, html);
  built.push({ file, name, meta });
  console.log(`built ${file}`);
}

const pages = readdirSync(join(src, 'pages')).filter((f) => f.endsWith('.html'));
for (const file of pages) {
  const name = file.replace(/\.html$/, '');
  const raw = read('pages', file);
  const m = raw.match(/^\s*<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
  if (!m) throw new Error(`${file}: missing the JSON comment at the top`);
  const meta = JSON.parse(m[1]);

  const body = raw.slice(m[0].length)
    .replace(/<!-- @cta -->/g, partial('cta'))
    .replace(/<!-- @circuit -->/g, partial('circuit'))
    .replace('<!-- @product-categories -->', renderCategories())
    .replace('<!-- @families-heading -->', familiesHeading(catalogue.categories.length))
    .replace('<!-- @partners-fabricants -->', renderPartners(partners.fabricants, 'Logo partenaire', 12))
    .replace('<!-- @partners-clients -->', renderPartners(partners.clients, 'Logo client', 8))
    .trim();

  emitPage({
    file,
    name,
    meta,
    body,
    note: `Généré par build.mjs à partir de src/pages/${file} : modifiez la source puis relancez « node build.mjs ».`,
  });
}

const familyTemplate = partial('produits-famille');
for (const c of catalogue.categories) {
  const items = catalogue.products.filter((p) => p.cat === c.id);
  const n = items.length;
  const [title1, title2] = splitTitle(c.label);
  const lead = `${esc(c.text)}. ${articleLabel(n)}, à ajouter à votre liste pour un devis&nbsp;: prix et disponibilités sur demande.`;
  const body = familyTemplate
    .replace(/<!-- @cta -->/g, partial('cta'))
    .replace(/<!-- @circuit -->/g, partial('circuit'))
    .replace(/<!-- @family-label -->/g, esc(c.label))
    .replace(/<!-- @family-label-attr -->/g, esc(c.label))
    .replace(/<!-- @family-id -->/g, esc(c.id))
    .replace(/<!-- @family-src -->/g, familyDataPath(c.id))
    .replace(/<!-- @family-title-1 -->/g, esc(title1))
    .replace(/<!-- @family-title-2 -->/g, esc(title2))
    .replace(/<!-- @family-lead -->/g, lead)
    .replace(/<!-- @family-count -->/g, articleLabel(n))
    .replace(/<!-- @family-filters -->/g, renderFamilyFilters(c.id))
    .replace(/<!-- @family-products -->/g, renderProductCards(items.slice(0, PAGE_SIZE), c.label))
    .trim();

  emitPage({
    file: familyPage(c.id),
    name: `produits-${c.id}`,
    meta: {
      title: `${c.label} | Catalogue Prumysl`,
      description: `${c.text} : ${articleLabel(n)}. Ajoutez des articles à votre liste et recevez un devis Prumysl.`,
      nav: 'produits',
      preloader: 'quick',
      catalogue: true,
    },
    body,
    note: 'Généré par build.mjs à partir du catalogue (src/data/produits.json).',
  });
}

// Only the files the pages actually use are published.
let copied = 0;
for (const ref of assetRefs) {
  if (versions[ref]) continue;
  const from = join(root, ref);
  if (!existsSync(from)) throw new Error(`Missing asset referenced by a page: ${ref}`);
  mkdirSync(dirname(join(dist, ref)), { recursive: true });
  copyFileSync(from, join(dist, ref));
  copied++;
}

/* ------------------------------------------------------------ crawlers */
const indexable = built.filter((p) => !p.meta.noindex);
// Private pages (admin, 404) are NOT listed here: robots.txt is public and would
// point attackers to them. They carry <meta name="robots" content="noindex">,
// which search engines can only read if they are allowed to fetch the page.
out('robots.txt', `User-agent: *\nAllow: /\n${siteUrl ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''}`);

// RFC 9116: how to report a security problem. Renewed on every deploy.
{
  const expires = new Date(Date.now() + 365 * 24 * 3600 * 1000).toISOString().replace(/\.\d{3}Z$/, 'Z');
  const lines = [
    `Contact: tel:${site.telephone}`,
    siteUrl ? `Contact: ${publicUrl('contact')}` : '',
    `Expires: ${expires}`,
    'Preferred-Languages: fr, en',
    siteUrl ? `Canonical: ${siteUrl}/.well-known/security.txt` : '',
  ].filter(Boolean);
  out('.well-known/security.txt', `${lines.join('\n')}\n`);
}
// GitHub Pages: publish files as they are (no Jekyll processing).
out('.nojekyll', '');
if (siteUrl) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = indexable.map((p) => `  <url><loc>${publicUrl(p.name)}</loc><lastmod>${today}</lastmod></url>`).join('\n');
  out('sitemap.xml', `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>\n`);
} else {
  console.warn('! Renseignez "url" dans src/data/site.json pour générer sitemap.xml et les liens canoniques.');
}

/* ------------------------------------------------------------ host configs */
// Netlify / Cloudflare Pages
out('_headers', `# Security and caching headers (Netlify, Cloudflare Pages). Generated by build.mjs.
/*
${Object.entries(securityHeaders).map(([k, v]) => `  ${k}: ${v}`).join('\n')}

/*.html
  Cache-Control: no-cache

/
  Cache-Control: no-cache

/assets/css/*
  Cache-Control: public, max-age=31536000, immutable

/assets/js/*
  Cache-Control: public, max-age=31536000, immutable

/assets/img/*
  Cache-Control: public, max-age=604800

/data/*
  Cache-Control: public, max-age=604800
  Content-Type: application/json; charset=utf-8

# Admin only: GitHub API and local image previews. Public pages keep connect-src 'self'.
/admin.html
  Content-Security-Policy: ${adminCspHeader}
  X-Robots-Tag: noindex
`);

// Apache (shared hosting / cPanel)
out('.htaccess', `# Prumysl — Apache configuration. Generated by build.mjs: edit build.mjs, not this file.
Options -Indexes
ErrorDocument 404 ${basePath}404.html
AddDefaultCharset utf-8
AddType image/svg+xml .svg
AddType font/woff2 .woff2
AddType application/json .json

<IfModule mod_rewrite.c>
  RewriteEngine On

  # Always HTTPS
  RewriteCond %{HTTPS} !=on
  RewriteCond %{HTTP:X-Forwarded-Proto} !https
  RewriteRule ^ https://%{HTTP_HOST}%{REQUEST_URI} [L,R=301]

  # Static site: only GET and HEAD requests are accepted
  RewriteCond %{REQUEST_METHOD} !^(GET|HEAD)$
  RewriteRule ^ - [R=405,L]

  # Hidden files and common attack probes (WordPress, .env, .git, admin tools)
  RewriteRule (^|/)\\.(?!well-known/) - [F,L]
  RewriteCond %{REQUEST_URI} (wp-admin|wp-login|wp-content|xmlrpc\\.php|phpmyadmin|\\.env|\\.git|\\.sql|\\.bak|cgi-bin) [NC]
  RewriteRule ^ - [F,L]
</IfModule>

<IfModule mod_headers.c>
${Object.entries(securityHeaders).map(([k, v]) => `  Header always set ${k} "${v}"`).join('\n')}
  Header always unset X-Powered-By
  Header unset X-Powered-By

  <FilesMatch "\\.(html|xml|txt)$">
    Header set Cache-Control "no-cache"
  </FilesMatch>
  <FilesMatch "\\.(css|js)$">
    Header set Cache-Control "public, max-age=31536000, immutable"
  </FilesMatch>
  <FilesMatch "\\.(svg|webp|jpg|jpeg|png|woff2|json)$">
    Header set Cache-Control "public, max-age=604800"
  </FilesMatch>

  # Catalogue admin: allow api.github.com. The public pages keep the stricter policy above.
  <Files "admin.html">
    Header always unset Content-Security-Policy
    Header always set Content-Security-Policy "${adminCspHeader}"
    Header always set X-Robots-Tag "noindex"
  </Files>
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/plain application/javascript text/javascript application/json application/xml image/svg+xml
</IfModule>
`);

console.log(`dist/ ready: ${built.length} pages, ${copied} images, ${catalogue.categories.length} family JSON files, CSS ${(css.length / 1024).toFixed(1)} KB`);
