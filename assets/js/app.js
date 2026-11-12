/*
 * Site interactions: preloader, inertial smooth scroll, scroll reveals,
 * parallax, pinned horizontal gallery, sliders, carousel, map, modals, menu,
 * magnetic buttons, image preview on hover, form, cookie notice.
 * No build step and no dependencies; three.js (3D only) loads from a CDN.
 */
(function () {
  'use strict';

  // Minified build (670 KB instead of 1.27 MB); pages with 3D preload it with an integrity hash.
  const THREE_URL = 'https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.min.js';

  const root = document.documentElement;
  const $ = (s, c) => (c || document).querySelector(s);
  const $$ = (s, c) => Array.from((c || document).querySelectorAll(s));
  const clamp = (v, a, b) => Math.min(b, Math.max(a, v));
  const lerp = (a, b, t) => a + (b - a) * t;
  const pad = (n) => String(n).padStart(2, '0');
  const wait = (ms) => new Promise((r) => setTimeout(r, ms));
  const escapeHtml = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const reduce = matchMedia('(prefers-reduced-motion: reduce)').matches;
  const desktop = matchMedia('(min-width: 900px)');
  const finePointer = matchMedia('(hover: hover) and (pointer: fine)').matches;

  const state = { y: window.scrollY, sy: window.scrollY, vel: 0, vh: window.innerHeight, vw: window.innerWidth, docH: 1 };
  let needsMeasure = true;

  /* ------------------------------------------------------------------ 3D */
  const towers = [];
  const towersReady = (async () => {
    const canvases = $$('[data-tower]');
    if (!canvases.length || !window.SiteTower) return;
    try {
      const THREE = await import(THREE_URL);
      canvases.forEach((canvas) => {
        try {
          towers.push({
            api: window.SiteTower.create(THREE, canvas, { variant: canvas.dataset.tower, reduce }),
            box: canvas.closest('.about__grid') || canvas.parentElement,
            hero: !!canvas.closest('.hero'),
            top: 0,
            h: 1,
            played: false,
          });
        } catch (err) {
          canvas.parentElement.classList.add('no-webgl');
        }
      });
      needsMeasure = true;
    } catch (err) {
      root.classList.add('no-webgl');
    }
  })();

  /* ----------------------------------------------------------- preloader */
  function runPreloader() {
    const out = $('[data-preloader-count]');
    const bar = $('[data-preloader-bar]');
    const fill = $('[data-preloader-fill]');
    const loads = [
      document.fonts ? document.fonts.ready : Promise.resolve(),
      new Promise((r) => (document.readyState === 'complete' ? r() : window.addEventListener('load', r, { once: true }))),
      towersReady,
    ].map((p) => Promise.race([p, wait(6000)]));
    let done = 0;
    loads.forEach((p) => p.then(() => { done++; }));

    // The full counter plays once per visit; afterwards the home page opens
    // with the same quick panel reveal as the other pages.
    let seen = false;
    if (out) {
      try {
        seen = sessionStorage.getItem('pl-seen') === '1';
        sessionStorage.setItem('pl-seen', '1');
      } catch (err) { /* storage unavailable */ }
      if (seen) root.classList.add('pl-quick');
    }

    return new Promise((resolve) => {
      if (!out || reduce || seen) {
        Promise.all(loads).then(resolve);
        return;
      }
      const t0 = performance.now();
      let shown = 0;
      // Safety net: never leave visitors stuck behind the loader.
      setTimeout(resolve, 9000);
      const tick = (now) => {
        const real = done / loads.length;
        // Never faster than ~2s in total, so the sequence is always readable.
        const target = Math.min((now - t0) / 2000, Math.max(real, Math.min(0.25, (now - t0) / 4000)));
        shown = Math.min(target, shown + Math.max(0.004, (target - shown) * 0.07));
        out.textContent = Math.round(shown * 100);
        if (bar) bar.style.transform = 'scaleX(' + shown.toFixed(3) + ')';
        if (fill) fill.style.clipPath = 'inset(0 ' + (100 - shown * 100).toFixed(1) + '% 0 0)';
        if (shown >= 0.999) resolve();
        else requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    });
  }

  /* ------------------------------------------------------ text splitting */
  // data-split          -> words, revealed line by line
  // data-split="chars"  -> single characters, revealed one after another
  const splits = $$('[data-split]');
  splits.forEach((el) => {
    // Split on ordinary spaces only, so non-breaking spaces (French « », :, ?)
    // keep their neighbours on the same line.
    const words = el.textContent.trim().split(/[ \t\r\n]+/);
    if (el.dataset.split === 'chars') {
      let c = 0;
      el.innerHTML = words
        .map((word) => Array.from(word).map((ch) => '<span class="w" style="--c:' + c++ + '"><span class="wi">' + escapeHtml(ch) + '</span></span>').join(''))
        .join(' ');
    } else {
      el.innerHTML = words.map((w) => '<span class="w"><span class="wi">' + escapeHtml(w) + '</span></span>').join(' ');
    }
  });
  function indexLines() {
    splits.forEach((el) => {
      let top = null;
      let line = -1;
      $$('.w', el).forEach((w) => {
        if (w.offsetTop !== top) {
          top = w.offsetTop;
          line++;
        }
        w.style.setProperty('--l', line);
      });
    });
  }

  $$('[data-stagger]').forEach((group) => {
    Array.from(group.children).forEach((child, i) => child.style.setProperty('--delay', i * 90 + 'ms'));
  });
  $$('.map .pin').forEach((pin, i) => pin.style.setProperty('--i', i));

  // Buttons: duplicate the label so it can roll on hover.
  $$('.btn').forEach((btn) => {
    const node = Array.from(btn.childNodes).find((n) => n.nodeType === 3 && n.textContent.trim());
    if (!node) return;
    const text = escapeHtml(node.textContent.trim());
    const label = document.createElement('span');
    label.className = 'btn__label';
    label.innerHTML = '<span>' + text + '</span><span aria-hidden="true">' + text + '</span>';
    btn.replaceChild(label, node);
  });

  /* ------------------------------------------------------------ counters */
  function runCount(el) {
    const to = parseFloat(el.dataset.count);
    const decimals = Number(el.dataset.decimals || 0);
    // French number format: 48 000, 3,6
    const format = (v) => v.toLocaleString('fr-FR', { minimumFractionDigits: decimals, maximumFractionDigits: decimals });
    if (reduce) {
      el.textContent = format(to);
      return;
    }
    const t0 = performance.now();
    const duration = 1900;
    const step = (now) => {
      const p = clamp((now - t0) / duration, 0, 1);
      const eased = p === 1 ? 1 : 1 - Math.pow(2, -10 * p);
      el.textContent = format(to * eased);
      if (p < 1) requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  /* ------------------------------------------------------------- reveals */
  function observeReveals() {
    const io = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        const el = entry.target;
        el.classList.add('is-in');
        if (el.dataset.count !== undefined) runCount(el);
        io.unobserve(el);
      });
    }, { rootMargin: '0px 0px -10% 0px', threshold: 0.08 });
    $$('[data-reveal], [data-split], [data-count]').forEach((el) => {
      if (el.dataset.manual === undefined) io.observe(el);
    });

    const inview = new IntersectionObserver((entries) => {
      entries.forEach((entry) => entry.target.classList.toggle('is-inview', entry.isIntersecting));
    }, { threshold: 0.3 });
    $$('[data-slider]').forEach((el) => inview.observe(el));
  }

  /* ------------------------------------------------- measured elements */
  const parallax = $$('[data-parallax]').map((el) => ({
    el,
    box: el.closest('.media'),
    speed: parseFloat(el.dataset.parallax) || 0.1,
    top: 0,
    h: 0,
    max: 0,
    cur: 0,
  }));
  const fits = $$('[data-fit]');
  const scrubs = $$('[data-scrub]').map((el) => ({ el, top: 0, pe: -1 }));
  const sections = $$('[data-section]').map((el) => ({ el, id: el.id, theme: el.dataset.theme || 'dark', top: 0, bottom: 0 }));
  const hscrolls = $$('[data-hscroll]').map((el) => ({ el, track: $('[data-hscroll-track]', el), bar: $('[data-hscroll-bar]', el), top: 0, travel: 0, skew: 0 }));
  const marquees = $$('[data-marquee]').map((el) => {
    const inner = el.firstElementChild;
    inner.innerHTML += inner.innerHTML;
    return { inner, dir: Number(el.dataset.marquee) || 1, x: 0, w: 0 };
  });
  const hero = $('.hero');
  const footer = $('[data-footer]');
  const footerMark = footer ? $('[data-manual]', footer) : null;
  let heroH = 1;
  let heroP = -1;
  let footerH = 0;
  let footerShown = false;

  // Side navigation: one tick per numbered section.
  const ticks = (() => {
    const items = sections.filter((s) => s.id && $('.shead__t', s.el));
    if (!items.length) return null;
    const nav = document.createElement('nav');
    nav.className = 'ticks';
    nav.setAttribute('aria-label', 'Sections');
    nav.dataset.theme = 'dark';
    nav.innerHTML = items.map((s) => '<a href="#' + s.id + '"><span>' + escapeHtml($('.shead__t', s.el).textContent) + '</span><i></i></a>').join('');
    document.body.appendChild(nav);
    return { el: nav, links: $$('a', nav).map((a, i) => ({ a, id: items[i].id })), theme: 'dark' };
  })();

  function measure() {
    needsMeasure = false;
    state.vh = window.innerHeight;
    state.vw = document.documentElement.clientWidth;
    const sy = window.scrollY;

    // Scale "fit" text (the footer wordmark) to span its container exactly,
    // whatever the brand name is.
    fits.forEach((el) => {
      const words = $$('.w', el);
      if (!words.length) return;
      el.style.fontSize = '100px';
      const width = words[words.length - 1].getBoundingClientRect().right - words[0].getBoundingClientRect().left;
      if (width > 0) el.style.fontSize = Math.floor(((100 * el.clientWidth) / width) * 0.995) + 'px';
    });

    // The pinned gallery changes the page height, so size it first.
    hscrolls.forEach((h) => {
      if (desktop.matches && !reduce) {
        const last = h.track.lastElementChild;
        const gutter = parseFloat(getComputedStyle(h.track).paddingLeft) || 0;
        h.travel = Math.max(0, last.offsetLeft + last.offsetWidth + gutter - state.vw);
        h.el.style.setProperty('--travel', h.travel + 'px');
      } else {
        h.travel = 0;
        h.el.style.removeProperty('--travel');
        h.track.style.transform = '';
      }
    });
    hscrolls.forEach((h) => { h.top = h.el.getBoundingClientRect().top + sy; });

    parallax.forEach((p) => {
      const r = (p.box || p.el).getBoundingClientRect();
      p.top = r.top + sy - (p.box ? 0 : p.cur);
      p.h = r.height;
      p.max = p.box ? r.height * 0.12 : 0;
    });
    scrubs.forEach((s) => { s.top = s.el.getBoundingClientRect().top + sy; });
    sections.forEach((s) => {
      // A pinned (sticky) section reports where it is stuck, not where it
      // starts, so measure its wrapper instead.
      const parent = s.el.parentElement;
      const pinned = parent.classList.contains('stack') && parent.firstElementChild === s.el;
      s.top = (pinned ? parent : s.el).getBoundingClientRect().top + sy;
      s.bottom = s.top + s.el.offsetHeight;
    });
    towers.forEach((t) => {
      const r = t.box.getBoundingClientRect();
      t.top = r.top + sy;
      t.h = r.height || 1;
    });
    marquees.forEach((m) => { m.w = m.inner.scrollWidth / 2; });
    if (hero) heroH = hero.offsetHeight || 1;
    if (footer) footerH = footer.offsetHeight;
    state.docH = Math.max(1, document.documentElement.scrollHeight - state.vh);
    indexLines();
  }

  /* ------------------------------------------------------- smooth scroll */
  // Wheel input is eased towards its target; touch, keyboard and scrollbar
  // scrolling stay native.
  const smooth = { on: false, active: false, target: 0, cur: 0, lastSet: 0 };
  function initSmoothScroll() {
    if (reduce || !finePointer) return;
    smooth.on = true;
    window.addEventListener('wheel', (e) => {
      if (e.ctrlKey || e.defaultPrevented) return;
      if (root.classList.contains('is-locked')) return;
      if (Math.abs(e.deltaX) > Math.abs(e.deltaY)) return;
      e.preventDefault();
      const delta = e.deltaMode === 1 ? e.deltaY * 40 : e.deltaMode === 2 ? e.deltaY * state.vh : e.deltaY;
      if (!smooth.active) {
        smooth.cur = smooth.target = smooth.lastSet = window.scrollY;
        smooth.active = true;
      }
      smooth.target = clamp(smooth.target + delta, 0, state.docH);
    }, { passive: false });
  }
  function scrollToY(y) {
    const top = clamp(y, 0, state.docH);
    if (smooth.on) {
      smooth.cur = smooth.lastSet = window.scrollY;
      smooth.target = top;
      smooth.active = true;
    } else {
      window.scrollTo({ top, behavior: reduce ? 'auto' : 'smooth' });
    }
  }

  /* ------------------------------------------------------- header + menu */
  const header = $('[data-header]');
  const progressBar = $('[data-progress]');
  // Scroll-spy only applies to in-page links; page links keep aria-current="page" from the build.
  const navLinks = $$('.nav a[href^="#"]').map((a) => ({ a, id: a.getAttribute('href').slice(1) }));
  let lastY = state.y;
  let headerTheme = '';
  let currentId = null;
  let menuOpen = false;

  function setMenu(open) {
    menuOpen = open;
    root.classList.toggle('menu-open', open);
    root.classList.toggle('is-locked', open);
    const toggle = $('[data-menu-toggle]');
    if (toggle) toggle.setAttribute('aria-expanded', String(open));
    if (open && header) {
      header.classList.remove('is-hidden');
      header.dataset.theme = headerTheme = 'dark';
    }
  }
  const menuToggle = $('[data-menu-toggle]');
  if (menuToggle) menuToggle.addEventListener('click', () => setMenu(!menuOpen));
  desktop.addEventListener('change', () => { needsMeasure = true; });

  // In-page links: close the menu and glide to the target.
  document.addEventListener('click', (e) => {
    const link = e.target.closest ? e.target.closest('a[href^="#"]') : null;
    if (!link) return;
    const hash = link.getAttribute('href');
    if (hash.length < 2) {
      e.preventDefault(); // placeholder links
      return;
    }
    const target = document.getElementById(hash.slice(1));
    if (!target) return;
    e.preventDefault();
    if (menuOpen) setMenu(false);
    scrollToY(hash === '#top' ? 0 : target.getBoundingClientRect().top + window.scrollY);
  });

  /* ---------------------------------------------------------- main loop */
  const preview = { el: null, x: 0, y: 0, cx: 0, cy: 0 };

  function frame() {
    if (needsMeasure) measure();

    if (smooth.active) {
      if (Math.abs(window.scrollY - smooth.lastSet) > 4) {
        // The page was moved some other way (keyboard, scrollbar): let go.
        smooth.active = false;
      } else {
        smooth.target = clamp(smooth.target, 0, state.docH);
        smooth.cur = lerp(smooth.cur, smooth.target, 0.105);
        if (Math.abs(smooth.target - smooth.cur) < 0.4) {
          smooth.cur = smooth.target;
          smooth.active = false;
        }
        window.scrollTo({ top: smooth.cur, behavior: 'instant' });
        smooth.lastSet = window.scrollY;
      }
    }

    state.y = window.scrollY;
    const prev = state.sy;
    // With eased wheel scrolling the page position is already smooth; on
    // touch devices smooth the value used by scroll-driven effects instead.
    state.sy = reduce || smooth.on ? state.y : lerp(state.sy, state.y, 0.11);
    if (Math.abs(state.y - state.sy) < 0.05) state.sy = state.y;
    state.vel = state.sy - prev;
    const mid = state.sy + state.vh / 2;

    if (!reduce) {
      for (let i = 0; i < parallax.length; i++) {
        const p = parallax[i];
        if (p.top > state.sy + state.vh * 1.5 || p.top + p.h < state.sy - state.vh * 0.5) continue;
        let d = (mid - (p.top + p.h / 2)) * p.speed;
        if (p.max) d = clamp(d, -p.max, p.max);
        p.cur = d;
        p.el.style.transform = 'translate3d(0,' + d.toFixed(2) + 'px,0)';
      }
    }

    // Elements with data-scrub get --pe: 0 when they enter the viewport,
    // 1 when they have nearly reached the top. CSS does the rest.
    for (let i = 0; i < scrubs.length; i++) {
      const s = scrubs[i];
      const pe = reduce ? 1 : clamp((state.sy + state.vh - s.top) / (state.vh * 0.9), 0, 1);
      if (Math.abs(pe - s.pe) > 0.0015) {
        s.pe = pe;
        s.el.style.setProperty('--pe', pe.toFixed(3));
      }
    }

    for (let i = 0; i < hscrolls.length; i++) {
      const h = hscrolls[i];
      if (!h.travel) continue;
      const p = clamp((state.sy - h.top) / h.travel, 0, 1);
      const moving = p > 0 && p < 1;
      h.skew = lerp(h.skew, moving ? clamp(-state.vel * 0.07, -5, 5) : 0, 0.12);
      h.track.style.transform = 'translate3d(' + (-p * h.travel).toFixed(2) + 'px,0,0) skewX(' + h.skew.toFixed(2) + 'deg)';
      if (h.bar) h.bar.style.transform = 'scaleX(' + p.toFixed(4) + ')';
    }

    if (!reduce) {
      for (let i = 0; i < marquees.length; i++) {
        const m = marquees[i];
        if (!m.w) continue;
        m.x -= (0.7 + Math.min(40, Math.abs(state.vel)) * 0.5) * m.dir;
        if (m.x <= -m.w) m.x += m.w;
        if (m.x > 0) m.x -= m.w;
        m.inner.style.transform = 'translate3d(' + m.x.toFixed(2) + 'px,0,0)';
      }
    }

    // Hero: fades and lifts as the next section slides over it.
    if (hero) {
      const hp = clamp(state.sy / heroH, 0, 1);
      if (Math.abs(hp - heroP) > 0.002) {
        heroP = hp;
        hero.style.setProperty('--hp', hp.toFixed(3));
      }
    }

    for (let i = 0; i < towers.length; i++) {
      const t = towers[i];
      if (t.hero) {
        t.api.setActive(state.sy < heroH * 1.02);
        t.api.setProgress(state.sy / heroH);
      } else {
        const p = (state.sy + state.vh - t.top) / (state.vh + t.h);
        t.api.setProgress(p);
        if (!t.played && p > 0.1 && root.classList.contains('is-ready')) {
          t.played = true;
          t.api.play();
        }
      }
    }

    if (footerMark && !footerShown && root.classList.contains('is-ready') && state.y >= state.docH - Math.max(60, footerH * 0.55)) {
      footerShown = true;
      footerMark.classList.add('is-in');
    }

    if (header && !menuOpen) {
      const dy = state.y - lastY;
      if (Math.abs(dy) > 6) {
        header.classList.toggle('is-hidden', dy > 0 && state.y > 240);
        lastY = state.y;
      }
      header.classList.toggle('is-scrolled', state.y > 40);

      const probe = state.y + 38;
      const focus = state.y + state.vh * 0.45;
      let theme = headerTheme || 'dark';
      let sideTheme = ticks ? ticks.theme : 'dark';
      let id = '';
      for (let i = 0; i < sections.length; i++) {
        const s = sections[i];
        if (probe >= s.top && probe < s.bottom) theme = s.theme;
        if (focus >= s.top && focus < s.bottom) {
          id = s.id;
          sideTheme = s.theme;
        }
      }
      if (theme !== headerTheme) header.dataset.theme = headerTheme = theme;
      if (ticks && sideTheme !== ticks.theme) ticks.el.dataset.theme = ticks.theme = sideTheme;
      if (id !== currentId) {
        currentId = id;
        navLinks.forEach((n) => n.a.setAttribute('aria-current', String(n.id === id)));
        if (ticks) ticks.links.forEach((n) => n.a.setAttribute('aria-current', String(n.id === id)));
      }
    }
    if (progressBar) progressBar.style.transform = 'scaleX(' + clamp(state.y / state.docH, 0, 1).toFixed(4) + ')';

    if (preview.el) {
      const dx = preview.x - preview.cx;
      preview.cx = lerp(preview.cx, preview.x, 0.12);
      preview.cy = lerp(preview.cy, preview.y, 0.12);
      preview.el.style.transform = 'translate3d(' + preview.cx.toFixed(1) + 'px,' + preview.cy.toFixed(1) + 'px,0) rotate(' + clamp(dx * 0.04, -8, 8).toFixed(2) + 'deg)';
    }

    requestAnimationFrame(frame);
  }

  window.addEventListener('resize', () => { needsMeasure = true; });
  window.addEventListener('load', () => { needsMeasure = true; });
  if (document.fonts) document.fonts.ready.then(() => { needsMeasure = true; });
  if ('ResizeObserver' in window) new ResizeObserver(() => { needsMeasure = true; }).observe(document.body);

  /* --------------------------------------------------- lobby wipe slider */
  $$('[data-slider]').forEach((el) => {
    const slides = $$('.slider__slide', el);
    const caps = $$('.slider__cap', el);
    const cur = $('[data-slider-cur]', el);
    const bar = $('.slider__bar i', el);
    const stage = $('.slider__stage', el);
    let index = 0;
    let busy = false;

    const restartBar = () => {
      if (!bar) return;
      bar.style.animation = 'none';
      void bar.offsetWidth;
      bar.style.animation = '';
    };
    const go = (next, dir) => {
      if (busy || next === index) return;
      busy = true;
      slides.forEach((s) => s.classList.remove('is-prev'));
      slides[index].classList.add('is-prev');
      slides[index].classList.remove('is-active');
      el.dataset.dir = dir;
      void slides[next].offsetWidth;
      slides[next].classList.add('is-active');
      if (caps[index]) caps[index].classList.remove('is-active');
      if (caps[next]) caps[next].classList.add('is-active');
      index = next;
      if (cur) cur.textContent = pad(index + 1);
      restartBar();
      setTimeout(() => { busy = false; }, 950);
    };
    const step = (dir) => go((index + dir + slides.length) % slides.length, dir);

    const prevBtn = $('[data-slider-prev]', el);
    const nextBtn = $('[data-slider-next]', el);
    if (prevBtn) prevBtn.addEventListener('click', () => step(-1));
    if (nextBtn) nextBtn.addEventListener('click', () => step(1));
    if (bar) bar.addEventListener('animationend', () => { if (!reduce) step(1); });
    el.addEventListener('keydown', (e) => {
      if (e.key === 'ArrowRight') step(1);
      else if (e.key === 'ArrowLeft') step(-1);
    });

    // Swipe / drag on the image
    if (stage) {
      let startX = null;
      stage.addEventListener('pointerdown', (e) => { startX = e.clientX; });
      window.addEventListener('pointerup', (e) => {
        if (startX === null) return;
        const dx = e.clientX - startX;
        startX = null;
        if (Math.abs(dx) > 45) step(dx < 0 ? 1 : -1);
      });
      window.addEventListener('pointercancel', () => { startX = null; });
    }
  });

  /* -------------------------------------------------- offices hover list */
  $$('[data-hoverlist]').forEach((el) => {
    const items = $$('[data-hover-item]', el);
    const figs = $$('[data-hover-media]', el);
    let index = 0;
    const set = (next) => {
      if (next === index || !figs[next]) return;
      figs.forEach((f) => f.classList.remove('is-prev'));
      figs[index].classList.add('is-prev');
      figs[index].classList.remove('is-active');
      void figs[next].offsetWidth;
      figs[next].classList.add('is-active');
      items[index].classList.remove('is-active');
      items[next].classList.add('is-active');
      index = next;
      needsMeasure = true;
    };
    items.forEach((item, i) => {
      if (finePointer) item.addEventListener('pointerenter', () => set(i));
      item.addEventListener('focusin', () => set(i));
      item.addEventListener('click', () => set(i));
    });
  });

  /* ------------------------------------------------------- drag carousel */
  $$('[data-carousel]').forEach((el) => {
    const track = $('[data-carousel-track]', el);
    const prevBtn = $('[data-carousel-prev]', el);
    const nextBtn = $('[data-carousel-next]', el);
    const cur = $('[data-carousel-cur]', el);
    const count = track.children.length;
    const stepSize = () => {
      const first = track.children[0];
      const gap = parseFloat(getComputedStyle(track).columnGap) || 0;
      return first.getBoundingClientRect().width + gap;
    };
    const update = () => {
      const max = track.scrollWidth - track.clientWidth;
      const atEnd = track.scrollLeft >= max - 4;
      const i = atEnd ? count - 1 : clamp(Math.round(track.scrollLeft / stepSize()), 0, count - 1);
      if (cur) cur.textContent = pad(i + 1);
      if (prevBtn) prevBtn.disabled = track.scrollLeft <= 4;
      if (nextBtn) nextBtn.disabled = atEnd;
    };
    if (prevBtn) prevBtn.addEventListener('click', () => track.scrollBy({ left: -stepSize(), behavior: reduce ? 'auto' : 'smooth' }));
    if (nextBtn) nextBtn.addEventListener('click', () => track.scrollBy({ left: stepSize(), behavior: reduce ? 'auto' : 'smooth' }));
    track.addEventListener('scroll', update, { passive: true });
    update();

    let down = false;
    let moved = false;
    let startX = 0;
    let startLeft = 0;
    track.addEventListener('pointerdown', (e) => {
      if (e.pointerType !== 'mouse' || e.button !== 0) return;
      down = true;
      moved = false;
      startX = e.clientX;
      startLeft = track.scrollLeft;
    });
    window.addEventListener('pointermove', (e) => {
      if (!down) return;
      const dx = e.clientX - startX;
      if (!moved && Math.abs(dx) > 5) {
        moved = true;
        track.classList.add('is-drag');
      }
      if (moved) track.scrollLeft = startLeft - dx;
    });
    window.addEventListener('pointerup', () => {
      if (!down) return;
      down = false;
      if (!moved) return;
      const target = Math.round(track.scrollLeft / stepSize()) * stepSize();
      track.scrollTo({ left: target, behavior: reduce ? 'auto' : 'smooth' });
      setTimeout(() => track.classList.remove('is-drag'), 450);
    });
  });

  /* ----------------------------------------------------------------- map */
  $$('[data-map]').forEach((map) => {
    const stage = $('.map__stage', map);
    const tip = $('[data-map-tip]', map);
    const pins = $$('.pin', map);
    const chips = $$('[data-map-filter]', map);

    function hide() {
      tip.classList.remove('is-on');
      pins.forEach((p) => p.classList.remove('is-on'));
    }
    const show = (pin) => {
      const r = pin.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      tip.firstElementChild.textContent = pin.dataset.title;
      tip.lastElementChild.textContent = pin.dataset.meta;
      const half = tip.offsetWidth / 2;
      const x = clamp(r.left + r.width / 2 - s.left, half + 8, s.width - half - 8);
      tip.style.left = x + 'px';
      tip.style.top = Math.max(r.top + r.height / 2 - s.top, 70) + 'px';
      tip.classList.add('is-on');
      pins.forEach((p) => p.classList.toggle('is-on', p === pin));
    };

    chips.forEach((chip) => chip.addEventListener('click', () => {
      const cat = chip.dataset.mapFilter;
      chips.forEach((c) => c.classList.toggle('is-active', c === chip));
      pins.forEach((p) => p.classList.toggle('is-off', cat !== 'all' && p.dataset.cat !== cat));
      hide();
    }));
    pins.forEach((pin) => {
      pin.addEventListener('pointerenter', () => show(pin));
      pin.addEventListener('pointerleave', hide);
      pin.addEventListener('focus', () => show(pin));
      pin.addEventListener('blur', hide);
      pin.addEventListener('click', () => show(pin));
      pin.addEventListener('keydown', (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          show(pin);
        }
      });
    });
  });

  /* -------------------------------------------------------------- modals */
  let lastFocus = null;
  function openModal(id) {
    const modal = document.getElementById(id);
    if (!modal) return;
    lastFocus = document.activeElement;
    modal.classList.add('is-open');
    modal.setAttribute('aria-hidden', 'false');
    root.classList.add('is-locked');
    const close = $('.modal__close', modal);
    if (close) setTimeout(() => close.focus(), 60);
  }
  function closeModal(modal) {
    if (!modal) return;
    modal.classList.remove('is-open');
    modal.setAttribute('aria-hidden', 'true');
    if (!menuOpen) root.classList.remove('is-locked');
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }
  document.addEventListener('click', (e) => {
    const opener = e.target.closest('[data-modal-open]');
    if (opener) {
      e.preventDefault();
      openModal(opener.dataset.modalOpen);
      return;
    }
    const closer = e.target.closest('[data-modal-close]');
    if (closer) closeModal(closer.closest('.modal'));
  });
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Escape') return;
    const open = $('.modal.is-open');
    if (open) closeModal(open);
    else if (menuOpen) setMenu(false);
  });

  /* ---------------------------------------------------------- quote list */
  // Catalogue items the visitor wants a price for. Kept on this device only
  // (localStorage), sent by WhatsApp or copied into the contact form.
  const QKEY = 'prumysl-devis';
  const WA_URL = 'https://wa.me/212723496854';
  const loadQuote = () => {
    try {
      const v = JSON.parse(localStorage.getItem(QKEY) || '[]');
      return Array.isArray(v) ? v.filter((i) => i && i.id && i.name && i.qty > 0) : [];
    } catch (err) {
      return [];
    }
  };
  const quote = { items: loadQuote() };
  const qDrawer = $('[data-quote-drawer]');
  const qList = $('[data-quote-list]');
  const qEmpty = $('[data-quote-empty]');
  const qFab = $('[data-quote-open]');
  const qWa = $('[data-quote-wa]');
  const quoteText = () => 'Articles souhaités :\n' + quote.items.map((i) => '- ' + i.qty + ' × ' + i.name).join('\n');

  function renderQuote() {
    const total = quote.items.reduce((n, i) => n + i.qty, 0);
    $$('[data-quote-count]').forEach((el) => { el.textContent = total; });
    if (qFab) qFab.hidden = total === 0;
    if (qEmpty) qEmpty.hidden = total > 0;
    if (qList) {
      qList.innerHTML = quote.items.map((i) => (
        '<li class="qitem" data-qid="' + escapeHtml(i.id) + '">' +
          '<span class="qitem__name">' + escapeHtml(i.name) + '</span>' +
          '<span class="qty"><button type="button" class="qty__b" data-q-dec aria-label="Retirer une unité"><svg class="i"><use href="#i-minus"/></svg></button>' +
          '<b aria-label="Quantité">' + i.qty + '</b>' +
          '<button type="button" class="qty__b" data-q-inc aria-label="Ajouter une unité"><svg class="i"><use href="#i-plus"/></svg></button></span>' +
          '<button type="button" class="qitem__rm" data-q-rm aria-label="Supprimer ' + escapeHtml(i.name) + '"><svg class="i"><use href="#i-trash"/></svg></button>' +
        '</li>'
      )).join('');
    }
    if (qWa) qWa.href = WA_URL + '?text=' + encodeURIComponent('Bonjour Prumysl, je souhaite un devis.\n\n' + quoteText());
    $$('[data-quote-wa], [data-quote-form], [data-quote-clear]').forEach((el) => el.classList.toggle('is-disabled', total === 0));
    $$('[data-add-quote]').forEach((btn) => {
      const inList = quote.items.some((i) => i.id === btn.dataset.id);
      btn.classList.toggle('is-added', inList);
      const label = $('[data-add-label]', btn);
      if (label) label.textContent = inList ? 'Dans le devis' : 'Ajouter au devis';
    });
  }
  function saveQuote() {
    try { localStorage.setItem(QKEY, JSON.stringify(quote.items)); } catch (err) { /* storage unavailable */ }
    renderQuote();
  }
  function setQuoteOpen(open) {
    if (!qDrawer) return;
    qDrawer.classList.toggle('is-open', open);
    qDrawer.setAttribute('aria-hidden', String(!open));
    root.classList.toggle('is-locked', open || menuOpen);
    if (open) {
      const close = $('.round[data-quote-close]', qDrawer);
      if (close) setTimeout(() => close.focus(), 60);
    } else if (qFab && !qFab.hidden) {
      qFab.focus();
    }
  }
  document.addEventListener('click', (e) => {
    const add = e.target.closest('[data-add-quote]');
    if (add) {
      const item = quote.items.find((i) => i.id === add.dataset.id);
      if (item) item.qty += 1;
      else quote.items.push({ id: add.dataset.id, name: add.dataset.name, qty: 1 });
      saveQuote();
      if (qFab) {
        qFab.classList.remove('is-pulse');
        void qFab.offsetWidth;
        qFab.classList.add('is-pulse');
      }
      return;
    }
    if (e.target.closest('[data-quote-open]')) { setQuoteOpen(true); return; }
    if (e.target.closest('[data-quote-close]')) { setQuoteOpen(false); return; }
    if (e.target.closest('[data-quote-form]')) { setQuoteOpen(false); return; }
    if (e.target.closest('[data-quote-clear]')) { quote.items = []; saveQuote(); return; }
    const row = e.target.closest('[data-qid]');
    if (!row) return;
    const item = quote.items.find((i) => i.id === row.dataset.qid);
    if (!item) return;
    if (e.target.closest('[data-q-inc]')) item.qty += 1;
    else if (e.target.closest('[data-q-dec]')) item.qty -= 1;
    else if (e.target.closest('[data-q-rm]')) item.qty = 0;
    else return;
    quote.items = quote.items.filter((i) => i.qty > 0);
    saveQuote();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && qDrawer && qDrawer.classList.contains('is-open')) setQuoteOpen(false);
  });
  window.addEventListener('storage', (e) => {
    if (e.key !== QKEY) return;
    quote.items = loadQuote();
    renderQuote();
  });
  renderQuote();

  /* ------------------------------------------------- catalogue filtering */
  // [data-filterable] blocks: chips [data-filter], optional search [data-search],
  // items [data-item data-cat data-text], optional [data-count-out] and [data-empty].
  const normText = (s) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '');
  const filterables = $$('[data-filterable]').map((box) => {
    const chips = $$('[data-filter]', box);
    const search = $('[data-search]', box);
    const items = $$('[data-item]', box);
    const out = $('[data-count-out]', box);
    const empty = $('[data-empty]', box);
    const state = { cat: 'all', q: '' };
    const apply = () => {
      let n = 0;
      items.forEach((it) => {
        const ok = (state.cat === 'all' || it.dataset.cat === state.cat) &&
          (!state.q || normText(it.dataset.text || it.textContent).includes(state.q));
        if (ok && it.hidden) {
          it.hidden = false;
          it.classList.remove('is-shown');
          void it.offsetWidth;
          it.classList.add('is-shown');
        } else if (!ok) {
          it.hidden = true;
        }
        if (ok) n++;
      });
      if (out) out.textContent = n + (n > 1 ? ' articles' : ' article');
      if (empty) empty.hidden = n > 0;
      chips.forEach((c) => {
        const on = c.dataset.filter === state.cat;
        c.classList.toggle('is-active', on);
        c.setAttribute('aria-pressed', String(on));
      });
      needsMeasure = true;
    };
    chips.forEach((c) => c.addEventListener('click', () => { state.cat = c.dataset.filter; apply(); }));
    if (search) search.addEventListener('input', () => { state.q = normText(search.value.trim()); apply(); });
    apply();
    return {
      box,
      setCat(cat) {
        if (!chips.some((c) => c.dataset.filter === cat)) return false;
        state.cat = cat;
        apply();
        return true;
      },
    };
  });
  const jumpToCat = (cat) => {
    const f = filterables.find((x) => x.setCat(cat));
    if (f) scrollToY(f.box.getBoundingClientRect().top + window.scrollY - 20);
  };
  document.addEventListener('click', (e) => {
    const jump = e.target.closest('[data-filter-jump]');
    if (!jump) return;
    e.preventDefault();
    jumpToCat(jump.dataset.filterJump);
  });
  // produits.html#cat-ventilation opens the catalogue on that family.
  const hashCat = (location.hash.match(/^#cat-([\w-]+)$/) || [])[1];
  if (hashCat) filterables.forEach((f) => f.setCat(hashCat));

  /* ---------------------------------------------------------------- form */
  $$('[data-form]').forEach((form) => {
    const setError = (input, message) => {
      const wrap = input.closest('.field, .check');
      if (!wrap) return;
      wrap.classList.toggle('is-error', !!message);
      const out = $('.field__err', wrap);
      if (out) out.textContent = message || '';
      input.setAttribute('aria-invalid', String(!!message));
    };
    const phone = form.elements.phone;
    if (phone) phone.addEventListener('input', () => { phone.value = phone.value.replace(/[^\d+\s()-]/g, ''); });
    $$('input, textarea', form).forEach((input) => input.addEventListener('input', () => setError(input, '')));

    // Pre-fill from the quote list and from links like contact.html?besoin=Éclairage
    const message = form.elements.message;
    const need = form.elements.need;
    if (message && !message.value && quote.items.length) {
      message.value = quoteText();
      if (need) need.value = 'Fourniture de matériel';
    }
    const besoin = new URLSearchParams(location.search).get('besoin');
    if (need && besoin && Array.from(need.options).some((o) => o.value === besoin)) need.value = besoin;

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      // Spam robots fill the hidden "website" field: pretend success, send nothing.
      const trap = form.elements.website;
      if (trap && trap.value) {
        form.classList.add('is-sent');
        return;
      }
      const name = form.elements.name;
      const city = form.elements.city;
      const email = form.elements.email;
      const consent = form.elements.consent;
      let ok = true;
      if (name.value.trim().length < 2) { setError(name, 'Veuillez indiquer votre nom.'); ok = false; }
      if (phone.value.replace(/\D/g, '').length < 9) { setError(phone, 'Veuillez saisir un numéro de téléphone valide.'); ok = false; }
      if (city && city.value.trim().length < 2) { setError(city, 'Veuillez indiquer votre ville.'); ok = false; }
      if (email && email.value && !/^\S+@\S+\.\S+$/.test(email.value)) { setError(email, 'Veuillez vérifier l’adresse e-mail.'); ok = false; }
      if (!consent.checked) { setError(consent, 'Obligatoire'); ok = false; }
      if (!ok) {
        const first = $('.is-error input, .is-error textarea', form);
        if (first) first.focus();
        return;
      }
      // TODO: send the data to your backend or form service here, e.g.
      // fetch('/api/lead', { method: 'POST', body: new FormData(form) })
      form.classList.add('is-sent');
    });
  });

  /* ----------------------------------------------------------- map embed */
  // Google Maps sets its own cookies: it loads by itself only after the
  // visitor accepted cookies, otherwise when they click "Afficher la carte".
  const mapEmbeds = $$('[data-mapembed]');
  const cookiesAccepted = () => {
    try { return localStorage.getItem('cookie-choice') === 'accepted'; } catch (err) { return false; }
  };
  function loadMapEmbed(box) {
    if (box.classList.contains('is-loaded')) return;
    const frame = document.createElement('iframe');
    frame.src = box.dataset.src;
    frame.title = box.dataset.title || 'Carte';
    frame.loading = 'lazy';
    frame.referrerPolicy = 'no-referrer-when-downgrade';
    frame.allowFullscreen = true;
    box.appendChild(frame);
    box.classList.add('is-loaded');
  }
  mapEmbeds.forEach((box) => {
    const btn = $('[data-mapembed-load]', box);
    if (btn) btn.addEventListener('click', () => loadMapEmbed(box));
    if (!cookiesAccepted()) return;
    const io = new IntersectionObserver((entries) => {
      if (!entries[0].isIntersecting) return;
      io.disconnect();
      loadMapEmbed(box);
    }, { rootMargin: '300px 0px' });
    io.observe(box);
  });

  /* ------------------------------------------------------- cookie notice */
  function initCookie() {
    const box = $('[data-cookie]');
    if (!box) return;
    let choice = null;
    try { choice = localStorage.getItem('cookie-choice'); } catch (err) { /* storage unavailable */ }
    if (choice) return;
    box.hidden = false;
    setTimeout(() => box.classList.add('is-on'), 2600);
    $$('[data-cookie-set]', box).forEach((btn) => btn.addEventListener('click', () => {
      try { localStorage.setItem('cookie-choice', btn.dataset.cookieSet); } catch (err) { /* storage unavailable */ }
      if (btn.dataset.cookieSet === 'accepted') mapEmbeds.forEach(loadMapEmbed);
      box.classList.remove('is-on');
      setTimeout(() => { box.hidden = true; }, 900);
    }));
  }

  /* ------------------------------------------------------ pointer extras */
  // Buttons lean towards the pointer.
  function initMagnetic() {
    if (!finePointer || reduce) return;
    $$('.btn, .round, .burger').forEach((el) => {
      const strength = el.classList.contains('btn') ? 0.22 : 0.35;
      let raf = 0;
      let x = 0;
      let y = 0;
      let tx = 0;
      let ty = 0;
      let over = false;
      const loop = () => {
        x = lerp(x, tx, 0.16);
        y = lerp(y, ty, 0.16);
        if (!over && Math.abs(x) < 0.05 && Math.abs(y) < 0.05) {
          el.style.translate = '';
          raf = 0;
          return;
        }
        el.style.translate = x.toFixed(2) + 'px ' + y.toFixed(2) + 'px';
        raf = requestAnimationFrame(loop);
      };
      el.addEventListener('pointermove', (e) => {
        const r = el.getBoundingClientRect();
        tx = (e.clientX - (r.left + r.width / 2)) * strength;
        ty = (e.clientY - (r.top + r.height / 2)) * strength;
        over = true;
        if (!raf) raf = requestAnimationFrame(loop);
      });
      el.addEventListener('pointerleave', () => {
        tx = ty = 0;
        over = false;
      });
    });
  }

  // Team rows: an image follows the pointer while a row is hovered.
  function initRowPreview() {
    if (!finePointer || reduce) return;
    const rows = $$('.row[data-preview]');
    if (!rows.length) return;
    const box = document.createElement('div');
    box.className = 'rowprev';
    box.setAttribute('aria-hidden', 'true');
    box.innerHTML = '<div class="rowprev__in"><img alt=""></div>';
    document.body.appendChild(box);
    const img = $('img', box);
    preview.el = box;
    rows.forEach((row) => {
      new Image().src = row.dataset.preview; // warm the cache
      row.addEventListener('pointerenter', (e) => {
        img.src = row.dataset.preview;
        if (!box.classList.contains('is-on')) {
          preview.cx = preview.x = e.clientX;
          preview.cy = preview.y = e.clientY;
        }
        box.classList.add('is-on');
      });
      row.addEventListener('pointermove', (e) => {
        preview.x = e.clientX;
        preview.y = e.clientY;
      });
      row.addEventListener('pointerleave', () => box.classList.remove('is-on'));
    });
  }

  /* ------------------------------------------------------ page transitions */
  // Links to other pages: panels close over the page, then the next page
  // opens with the same panels lifting away.
  function initPageTransitions() {
    if (reduce) return;
    const veil = document.createElement('div');
    veil.className = 'veil';
    veil.setAttribute('aria-hidden', 'true');
    veil.innerHTML = [0, 1, 2, 3, 4].map((i) => '<i style="--i:' + i + '"></i>').join('');
    document.body.appendChild(veil);
    const isHome = (p) => /\/(index\.html)?$/.test(p);

    document.addEventListener('click', (e) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
      const a = e.target.closest ? e.target.closest('a[href]') : null;
      if (!a || (a.target && a.target !== '_self') || a.hasAttribute('download')) return;
      const url = new URL(a.href, location.href);
      if (url.origin !== location.origin || !/(\.html|\/)$/.test(url.pathname)) return;
      const samePage = url.pathname === location.pathname || (isHome(url.pathname) && isHome(location.pathname));
      if (samePage && url.search === location.search) {
        if (url.hash) return; // in-page anchor: the browser or the smooth-scroll handler deals with it
        e.preventDefault();
        if (menuOpen) setMenu(false);
        scrollToY(0);
        return;
      }
      e.preventDefault();
      root.classList.add('is-leaving');
      setTimeout(() => { location.href = url.href; }, 760);
    });
    // Coming back with the browser's back button restores the page as it was.
    window.addEventListener('pageshow', (e) => {
      if (e.persisted) root.classList.remove('is-leaving');
    });
  }

  /* ---------------------------------------------------------------- boot */
  const year = $('[data-year]');
  if (year) year.textContent = new Date().getFullYear();

  if ('scrollRestoration' in history) history.scrollRestoration = 'manual';
  initSmoothScroll();
  initPageTransitions();
  requestAnimationFrame(frame);

  runPreloader().then(() => {
    root.classList.add('is-loaded');
    setTimeout(() => {
      root.classList.add('is-ready');
      towers.forEach((t) => {
        if (t.hero) {
          t.played = true;
          t.api.play();
        }
      });
      observeReveals();
      initCookie();
      initMagnetic();
      initRowPreview();
      if (hashCat) jumpToCat(hashCat);
    }, reduce ? 0 : 650);
  });
})();
