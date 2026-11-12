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
const catalogue = json('data', 'produits.json');
const partners = json('data', 'partenaires.json');

/* ------------------------------------------------------------ security */
// three.js is loaded from jsDelivr with Subresource Integrity (hash published by jsDelivr).
const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';
const THREE_SRI = 'sha256-PmkKx9GAsKrfCJG+o57sZD4p4tPnXJmxholRhmX2m6Y=';

// The only inline script (adds the "js" class before first paint) is allowed by its hash.
const bootScript = partial('head').match(/<script>([\s\S]*?)<\/script>/)[1];
const bootHash = createHash('sha256').update(bootScript).digest('base64');

const cspDirectives = {
  'default-src': ["'self'"],
  'script-src': ["'self'", `'sha256-${bootHash}'`, 'https://cdn.jsdelivr.net'],
  'style-src': ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
  'font-src': ["'self'", 'https://fonts.gstatic.com'],
  'img-src': ["'self'", 'data:'],
  'connect-src': ["'self'"],
  'object-src': ["'none'"],
  // Google Maps embed on the contact page.
  'frame-src': ['https://www.google.com', 'https://maps.google.com'],
  'worker-src': ["'none'"],
  'manifest-src': ["'self'"],
  'base-uri': ["'self'"],
  // Add your form service here when you connect the forms (e.g. https://formspree.io).
  'form-action': ["'self'"],
};
const cspMeta = Object.entries(cspDirectives).map(([k, v]) => `${k} ${v.join(' ')}`).join('; ');
const cspHeader = `${cspMeta}; frame-ancestors 'none'; upgrade-insecure-requests`;

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
function renderFilters() {
  const count = (id) => catalogue.products.filter((p) => p.cat === id).length;
  const chips = [`<button type="button" class="chip is-active" data-filter="all">Tout <small>${catalogue.products.length}</small></button>`];
  for (const c of catalogue.categories) {
    chips.push(`<button type="button" class="chip" data-filter="${c.id}">${esc(c.label)} <small>${count(c.id)}</small></button>`);
  }
  return chips.join('\n          ');
}

function renderCategories() {
  return catalogue.categories.map((c, i) => `
      <li class="tile" data-reveal="fade">
        <svg class="i tile__i"><use href="#${c.icon}"/></svg>
        <h3 class="display tile__t">${esc(c.label)}</h3>
        <p>${esc(c.text)}</p>
        <button type="button" class="tile__a" data-filter-jump="${c.id}"><span class="sr-only">Voir ${esc(c.label)}</span></button>
        <span class="tile__n eyebrow">${String(i + 1).padStart(2, '0')}</span>
      </li>`).join('');
}

function renderProducts() {
  const label = Object.fromEntries(catalogue.categories.map((c) => [c.id, c.label]));
  return catalogue.products.map((p) => `
        <article class="pitem" data-item data-cat="${p.cat}" data-text="${esc(norm(`${p.name} ${p.text} ${label[p.cat]}`))}" data-reveal="fade">
          <figure class="media ar-11"><div class="media__in"><img src="assets/img/blank-11.svg" alt="" loading="lazy" draggable="false"></div></figure>
          <div class="pitem__body">
            <span class="eyebrow muted">${esc(label[p.cat])}</span>
            <h3 class="pitem__name">${esc(p.name)}</h3>
            <p class="muted">${esc(p.text)}</p>
            <button type="button" class="btn btn--sm pitem__add" data-add-quote data-id="${esc(p.id)}" data-name="${esc(p.name)}"><span data-add-label>Ajouter au devis</span> <svg class="i"><use href="#i-plus"/></svg></button>
          </div>
        </article>`).join('');
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
const versions = {
  'assets/css/style.css': shortHash(css),
  'assets/js/app.js': shortHash(appJs),
  'assets/js/tower.js': shortHash(towerJs),
};

const pages = readdirSync(join(src, 'pages')).filter((f) => f.endsWith('.html'));
const built = [];
const assetRefs = new Set(['assets/img/logo-prumysl.svg']);

for (const file of pages) {
  const name = file.replace(/\.html$/, '');
  const raw = read('pages', file);
  const m = raw.match(/^\s*<!--\s*(\{[\s\S]*?\})\s*-->\s*/);
  if (!m) throw new Error(`${file}: missing the JSON comment at the top`);
  const meta = JSON.parse(m[1]);

  let body = raw.slice(m[0].length)
    .replace(/<!-- @cta -->/g, partial('cta'))
    .replace(/<!-- @circuit -->/g, partial('circuit'))
    .replace('<!-- @product-filters -->', renderFilters())
    .replace('<!-- @product-categories -->', renderCategories())
    .replace('<!-- @products -->', renderProducts())
    .replace('<!-- @partners-fabricants -->', renderPartners(partners.fabricants, 'Logo partenaire', 12))
    .replace('<!-- @partners-clients -->', renderPartners(partners.clients, 'Logo client', 8))
    .trim();

  const has3d = body.includes('data-tower');
  const pageUrl = siteUrl ? `${siteUrl}/${name === 'index' ? '' : file}` : '';
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
    ? `<link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin>\n<link rel="modulepreload" href="${THREE_URL}" integrity="${THREE_SRI}" crossorigin="anonymous">`
    : '';

  const current = (html) => html.replace(new RegExp(`data-nav="${meta.nav}"`, 'g'), `data-nav="${meta.nav}" aria-current="page"`);
  let end = partial('end');
  if (!has3d) end = end.replace(/\s*<script src="assets\/js\/tower\.js" defer><\/script>/, '');

  const head = partial('head')
    .replace('{{base}}', meta.base ? `<base href="${basePath}">\n` : '')
    .replace('{{csp}}', cspMeta)
    .replace('{{title}}', esc(meta.title))
    .replace('{{description}}', esc(meta.description))
    .replace('{{meta}}', metaTags.join('\n'))
    .replace('{{preload}}', preload)
    .replace('{{jsonld}}', name === 'index' ? jsonLd() : '');

  let html = `<!doctype html>
<!-- Généré par build.mjs à partir de src/pages/${file} : modifiez la source puis relancez « node build.mjs ». -->
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

  // Images decode off the main thread; CSS/JS get their version stamp.
  html = html.replace(/<img (?![^>]*decoding=)/g, '<img decoding="async" ');
  for (const [asset, v] of Object.entries(versions)) html = html.split(`"${asset}"`).join(`"${asset}?v=${v}"`);
  for (const ref of html.matchAll(/(?:src|href)="(assets\/[^"?#]+)/g)) assetRefs.add(ref[1]);

  out(file, html);
  built.push({ file, name, meta });
  console.log(`built ${file}`);
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
out('robots.txt', `User-agent: *\nAllow: /\nDisallow: ${basePath}404.html\n${siteUrl ? `\nSitemap: ${siteUrl}/sitemap.xml\n` : ''}`);
// GitHub Pages: publish files as they are (no Jekyll processing).
out('.nojekyll', '');
if (siteUrl) {
  const today = new Date().toISOString().slice(0, 10);
  const urls = indexable.map((p) => `  <url><loc>${siteUrl}/${p.name === 'index' ? '' : p.file}</loc><lastmod>${today}</lastmod></url>`).join('\n');
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
`);

// Apache (shared hosting / cPanel)
out('.htaccess', `# Prumysl — Apache configuration. Generated by build.mjs: edit build.mjs, not this file.
Options -Indexes
ErrorDocument 404 ${basePath}404.html
AddDefaultCharset utf-8
AddType image/svg+xml .svg
AddType font/woff2 .woff2

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
  <FilesMatch "\\.(svg|webp|jpg|jpeg|png|woff2)$">
    Header set Cache-Control "public, max-age=604800"
  </FilesMatch>
</IfModule>

<IfModule mod_deflate.c>
  AddOutputFilterByType DEFLATE text/html text/css text/plain application/javascript text/javascript application/json application/xml image/svg+xml
</IfModule>
`);

console.log(`dist/ ready: ${built.length} pages, ${copied} images, CSS ${(css.length / 1024).toFixed(1)} KB`);
