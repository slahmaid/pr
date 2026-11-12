/*
 * 3D "twisting tower" used in the hero (solid: floor plates, glazing, lit
 * windows, drifting dust, a pool of light at the base) and in the About
 * section (line drawing). Three.js is passed in by app.js, so this file has
 * no imports of its own.
 *
 *   const tower = SiteTower.create(THREE, canvas, { variant: 'solid' | 'wire' });
 *   tower.play();            // run the assemble-in animation
 *   tower.setProgress(0..1); // link to scroll
 *   tower.setActive(false);  // pause rendering (e.g. while covered)
 */
(function () {
  'use strict';

  const clamp01 = (v) => Math.min(1, Math.max(0, v));
  const seeded = (seed) => {
    let s = seed >>> 0;
    return () => ((s = (Math.imul(s, 1664525) + 1013904223) >>> 0) / 4294967296);
  };

  // A tiny studio of glowing panels, baked into an environment map so the
  // metal and glass have something to reflect. No image files needed.
  function makeEnvironment(THREE, renderer) {
    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b1224);
    const panel = (hex, power, w, h, x, y, z) => {
      const material = new THREE.MeshBasicMaterial({ color: new THREE.Color(hex).multiplyScalar(power), side: THREE.DoubleSide });
      const mesh = new THREE.Mesh(new THREE.PlaneGeometry(w, h), material);
      mesh.position.set(x, y, z);
      mesh.lookAt(0, 0, 0);
      scene.add(mesh);
    };
    // Prumysl palette: white key light, brand blues, a touch of brand red.
    panel(0xffffff, 10, 6, 14, 9, 3, 5);
    panel(0x6d78ff, 7, 14, 5, -10, 2, -2);
    panel(0xff6b76, 6, 3, 10, -5, -2, 8);
    panel(0xffffff, 6, 16, 4, 0, 11, 0);
    panel(0x2a35b8, 4, 22, 8, 0, -9, -6);
    panel(0xdfe4ff, 5, 4, 12, 2, 1, -11);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const texture = pmrem.fromScene(scene, 0.035).texture;
    pmrem.dispose();
    scene.traverse((o) => {
      if (o.isMesh) {
        o.geometry.dispose();
        o.material.dispose();
      }
    });
    return texture;
  }

  // Soft radial texture for the pool of light under the tower.
  function makeGlowTexture(THREE) {
    const c = document.createElement('canvas');
    c.width = c.height = 256;
    const g = c.getContext('2d');
    const grad = g.createRadialGradient(128, 128, 0, 128, 128, 128);
    grad.addColorStop(0, 'rgba(140, 150, 255, 0.6)');
    grad.addColorStop(0.3, 'rgba(230, 57, 70, 0.18)');
    grad.addColorStop(1, 'rgba(0, 0, 0, 0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 256, 256);
    const texture = new THREE.CanvasTexture(c);
    texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function create(THREE, canvas, options) {
    const opts = options || {};
    const wire = opts.variant === 'wire';
    const calm = !!opts.reduce;
    const host = canvas.parentElement;
    const rand = seeded(20270);

    const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'high-performance' });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setClearColor(0x000000, 0);
    if (!wire) {
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 0.92;
    }

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(30, 1, 0.1, 100);
    const rig = new THREE.Group();
    const tower = new THREE.Group();
    rig.add(tower);
    scene.add(rig);

    const COUNT = wire ? 30 : 38;
    const HEIGHT = 6.4;
    const pitch = HEIGHT / COUNT;
    const box = new THREE.BoxGeometry(1, 1, 1);
    const edges = new THREE.EdgesGeometry(box);

    let plateA = null;
    let plateB = null;
    let glass = null;
    let warmWin = null;
    let coolWin = null;
    let warmLight = null;
    let dust = null;
    let glow = null;

    if (!wire) {
      scene.environment = makeEnvironment(THREE, renderer);
      // Prumysl blue plates, silver plates, dark glass; lit strips glow like
      // charged cells (mostly electric white-blue, a few brand red).
      plateA = new THREE.MeshPhysicalMaterial({ color: 0x202895, metalness: 0.55, roughness: 0.22, clearcoat: 1, clearcoatRoughness: 0.1, envMapIntensity: 1.6 });
      plateB = new THREE.MeshStandardMaterial({ color: 0xd2d7f2, metalness: 0.9, roughness: 0.16, envMapIntensity: 1.5 });
      glass = new THREE.MeshPhysicalMaterial({ color: 0x080b2e, metalness: 0.9, roughness: 0.05, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 2.3 });
      warmWin = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xc9d2ff).multiplyScalar(2.4) });
      coolWin = new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff4a57).multiplyScalar(1.9) });

      const key = new THREE.DirectionalLight(0xffffff, 3.2);
      key.position.set(6, 8, 7);
      const fill = new THREE.DirectionalLight(0x5c68f0, 2.6);
      fill.position.set(-8, 2, -4);
      warmLight = new THREE.PointLight(0x7f8aff, 80, 30);
      warmLight.position.set(-3.5, -1.5, 5);
      scene.add(key, fill, warmLight, new THREE.AmbientLight(0x262c7a, 0.9));

      // Pool of light at the base
      glow = new THREE.Mesh(
        new THREE.PlaneGeometry(13, 13),
        new THREE.MeshBasicMaterial({ map: makeGlowTexture(THREE), transparent: true, opacity: 0, depthWrite: false, blending: THREE.AdditiveBlending, toneMapped: false })
      );
      glow.rotation.x = -Math.PI / 2;
      glow.position.y = -HEIGHT / 2 - 0.08;
      rig.add(glow);

      // Drifting dust for depth
      const N = 340;
      const positions = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        const angle = rand() * Math.PI * 2;
        const radius = 1.9 + rand() * 6;
        positions[i * 3] = Math.cos(angle) * radius;
        positions[i * 3 + 1] = (rand() - 0.5) * 10;
        positions[i * 3 + 2] = Math.sin(angle) * radius;
      }
      const dustGeo = new THREE.BufferGeometry();
      dustGeo.setAttribute('position', new THREE.BufferAttribute(positions, 3));
      dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0xb8c0ff, size: 0.04, transparent: true, opacity: 0, depthWrite: false, sizeAttenuation: true }));
      rig.add(dust);
    }

    const lineMat = new THREE.LineBasicMaterial({ color: wire ? 0x202895 : 0xdfe4ff, transparent: true, opacity: wire ? 0.72 : 0.28 });
    const accentMat = new THREE.LineBasicMaterial({ color: 0xe63946 });
    const faceMat = wire ? new THREE.MeshBasicMaterial({ color: 0x202895, transparent: true, opacity: 0.045, depthWrite: false }) : null;

    const slabs = [];
    for (let i = 0; i < COUNT; i++) {
      const t = i / (COUNT - 1);
      // Rectangular plates (not square) so the twist reads clearly.
      const width = 2.5 * (0.7 + 0.3 * Math.sin(t * Math.PI * 0.92 + 0.3)) * (i % 2 ? 0.94 : 1);
      const depth = width * 0.62;
      const thickness = pitch * (wire ? 0.5 : 0.44);
      const gap = pitch - thickness;
      const group = new THREE.Group();

      const body = new THREE.Mesh(box, wire ? faceMat : i % 3 === 0 ? plateB : plateA);
      body.scale.set(width, thickness, depth);
      group.add(body);

      const outline = new THREE.LineSegments(edges, wire && i % 6 === 0 ? accentMat : lineMat);
      outline.scale.set(width * 1.002, thickness * 1.02, depth * 1.002);
      group.add(outline);

      if (!wire) {
        // Recessed glazing between this plate and the next one up
        const bandY = thickness / 2 + gap / 2;
        const bw = width * 0.9;
        const bd = depth * 0.9;
        const band = new THREE.Mesh(box, glass);
        band.scale.set(bw, gap, bd);
        band.position.y = bandY;
        group.add(band);

        // A few lit windows on some floors
        const lit = rand() < 0.72 ? 1 + Math.floor(rand() * 3) : 0;
        for (let k = 0; k < lit; k++) {
          const win = new THREE.Mesh(box, rand() < 0.78 ? warmWin : coolWin);
          const alongX = rand() < 0.6;
          const side = rand() < 0.5 ? -1 : 1;
          const span = alongX ? bw : bd;
          const len = span * (0.08 + rand() * 0.2);
          const offset = (rand() - 0.5) * (span - len);
          if (alongX) {
            win.scale.set(len, gap * 0.7, 0.02);
            win.position.set(offset, bandY, side * (bd / 2 + 0.008));
          } else {
            win.scale.set(0.02, gap * 0.7, len);
            win.position.set(side * (bw / 2 + 0.008), bandY, offset);
          }
          group.add(win);
        }
      }

      tower.add(group);
      slabs.push({ group, t, y: (t - 0.5) * HEIGHT });
    }

    let progress = 0;
    let intro = 0;
    let introTarget = 0;
    let pointerX = 0;
    let pointerY = 0;
    let targetX = 0;
    let targetY = 0;
    let offsetX = 0;
    let offsetY = 0;
    let baseZ = 14;
    let visible = true;
    let active = true;
    let last = performance.now();
    let time = 0;

    function layout(w, h) {
      const aspect = w / h;
      const wide = aspect > 1.15;
      camera.aspect = aspect;
      // Wide screens: tower sits to the right of the headline.
      // Tall screens (phones): tower is smaller and sits above the headline.
      baseZ = wire ? 14.5 : wide ? 14.5 : 21;
      offsetX = !wire && wide ? Math.min(3.4, aspect * 1.75) : 0;
      offsetY = wire ? 0 : wide ? -0.15 : 1.3;
      camera.position.set(0, 0, baseZ);
      camera.updateProjectionMatrix();
    }

    function resize() {
      const w = host.clientWidth;
      const h = host.clientHeight;
      if (!w || !h) return;
      renderer.setSize(w, h, false);
      layout(w, h);
    }

    function frame(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      if (!visible || !active) return;
      time += dt * (calm ? 0.25 : 1);

      intro += (introTarget - intro) * (1 - Math.exp(-dt * 1.9));
      pointerX += (targetX - pointerX) * (1 - Math.exp(-dt * 3));
      pointerY += (targetY - pointerY) * (1 - Math.exp(-dt * 3));

      const twist = 1.7 + progress * 2.6;
      for (let i = 0; i < slabs.length; i++) {
        const s = slabs[i];
        const k = clamp01(intro * 1.7 - s.t * 0.7);
        const e = 1 - Math.pow(1 - k, 3);
        s.group.rotation.y = time * 0.12 + (s.t - 0.5) * twist + Math.sin(time * 0.5 + s.t * 5) * 0.16 * (1 + progress) + (1 - e) * 2.4;
        s.group.position.y = s.y - (1 - e) * 1.4;
        s.group.scale.setScalar(Math.max(0.0001, e));
      }

      const settled = clamp01(intro * 1.4 - 0.4);
      if (glow) glow.material.opacity = settled * (0.9 + Math.sin(time * 0.8) * 0.1);
      if (dust) {
        dust.material.opacity = settled * 0.55;
        dust.rotation.y = time * 0.025;
        dust.position.y = Math.sin(time * 0.18) * 0.35;
      }
      if (warmLight) {
        // The warm light slowly circles the tower so highlights keep moving.
        const a = time * 0.35;
        warmLight.position.set(Math.cos(a) * 5.2, -1.2 + Math.sin(time * 0.27) * 2.2, Math.sin(a) * 5.2 + 1.5);
      }

      rig.position.x = offsetX;
      rig.position.y = offsetY + (wire ? 0 : progress * 1.1);
      rig.rotation.x = (wire ? 0.34 : 0.26) + pointerY * 0.1 - progress * (wire ? 0.3 : 0.22);
      rig.rotation.y = pointerX * 0.3 + (wire ? progress * 1.6 : 0);
      camera.position.z = baseZ - progress * (wire ? 0 : 2.2);

      renderer.render(scene, camera);
    }

    const onPointer = (e) => {
      targetX = (e.clientX / window.innerWidth) * 2 - 1;
      targetY = (e.clientY / window.innerHeight) * 2 - 1;
    };
    window.addEventListener('pointermove', onPointer, { passive: true });

    const io = new IntersectionObserver((entries) => { visible = entries[0].isIntersecting; }, { rootMargin: '15% 0px' });
    io.observe(canvas);
    const ro = new ResizeObserver(resize);
    ro.observe(host);
    resize();
    renderer.setAnimationLoop(frame);

    return {
      canvas,
      play() { introTarget = 1; },
      setProgress(p) { progress = clamp01(p); },
      setActive(on) { active = !!on; },
      dispose() {
        renderer.setAnimationLoop(null);
        window.removeEventListener('pointermove', onPointer);
        io.disconnect();
        ro.disconnect();
        renderer.dispose();
      },
    };
  }

  window.SiteTower = { create };
})();
