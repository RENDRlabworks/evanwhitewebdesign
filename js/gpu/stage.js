/**
 * GPU stage for the work plates.
 *
 * One fixed canvas sits behind the page. Each [data-plate] element is a frame
 * in the layout; this module draws its image into that frame on the GPU,
 * tracking the element's position every frame, so layout stays in plain HTML
 * and CSS and the GPU only adds the reveal, bend, drift and loupe.
 *
 * Order of preference: WebGPU, then WebGL2, then the static <img> already in
 * the page (we simply never hide it).
 *
 * Budget rules:
 * - device pixel ratio capped at 2 (1.5 on low-power devices), and lowered
 *   further if frames run long;
 * - lite shaders and a coarser mesh on small or low-power devices;
 * - no frames while the tab is hidden, none while no plate is on screen,
 *   and the loop parks itself once nothing is moving.
 */
import { createWebGPU } from './webgpu.js';
import { createWebGL2 } from './webgl2.js';

const REVEAL_MS = 900;
const SETTLE_MS = 900;
const BASE_ZOOM = 1.07;
const PARALLAX = 0.028;

const clamp = (v, a, b) => Math.min(b, Math.max(a, v));

function isLowPower() {
  const small = window.matchMedia('(max-width: 767px)').matches;
  const cores = navigator.hardwareConcurrency || 8;
  const memory = navigator.deviceMemory || 8;
  return small || cores <= 4 || memory <= 4;
}

/** Pick the srcset candidate closest to (but not below) the pixels we need. */
function pickSource(img, neededPx) {
  const set = (img.getAttribute('srcset') || '')
    .split(',')
    .map((s) => s.trim().split(/\s+/))
    .filter((p) => p[0])
    .map(([url, w]) => ({ url, w: parseInt(w, 10) || 0 }))
    .sort((a, b) => a.w - b.w);
  if (!set.length) return img.currentSrc || img.src;
  return (set.find((c) => c.w >= neededPx) || set[set.length - 1]).url;
}

/** Load an image and build a mip chain by repeated halving (high quality downscale). */
async function loadLevels(url) {
  const img = new Image();
  img.decoding = 'async';
  img.src = url;
  await img.decode();
  const levels = [];
  let w = img.naturalWidth;
  let h = img.naturalHeight;
  let prev = img;
  for (;;) {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const g = c.getContext('2d');
    g.imageSmoothingQuality = 'high';
    g.drawImage(prev, 0, 0, w, h);
    levels.push(c);
    if (w <= 1 && h <= 1) break;
    prev = c;
    w = Math.max(1, w >> 1);
    h = Math.max(1, h >> 1);
  }
  return levels;
}

export async function start(canvas) {
  const root = document.documentElement;
  const lite = isLowPower();
  let dprCap = lite ? 1.5 : 2;
  let dpr = Math.min(window.devicePixelRatio || 1, dprCap);

  let lost = false;
  const onLost = () => {
    lost = true;
    root.classList.remove('gpu-on');
  };

  // 1. Backend.
  let gpu = null;
  try { gpu = await createWebGPU(canvas, { lite, onLost }); } catch { gpu = null; }
  if (!gpu) gpu = createWebGL2(canvas, { lite, onLost });
  if (!gpu) throw new Error('No WebGPU or WebGL2');

  // 2. Textures, shared by URL (the hero and the first project use the same shot).
  const els = [...document.querySelectorAll('[data-plate]')];
  const stage = document.querySelector('[data-hero-stage]');
  const cache = new Map();
  const getTexture = (url) => {
    if (!cache.has(url)) cache.set(url, loadLevels(url).then((levels) => gpu.createTexture(levels)));
    return cache.get(url);
  };

  const planes = await Promise.all(els.map(async (el) => {
    const img = el.querySelector('img');
    // The hero plate can grow to the full stage width, so size for that.
    const maxCss = el.hasAttribute('data-hero-plate') ? stage.clientWidth : el.offsetWidth;
    const texture = await getTexture(pickSource(img, maxCss * dpr));
    return {
      el,
      plane: gpu.createPlane(texture),
      data: new Float32Array(16),
      aspect: img.naturalWidth && img.naturalHeight ? img.naturalWidth / img.naturalHeight : (+img.width / +img.height),
      revealAt: -1,
      reveal: 0,
      settleAt: -1,
      settle: 1,
      visible: false,
      ptr: { x: 0.5, y: 0.5, s: 0, target: 0 },
    };
  }));

  // 3. Plates already on or above the screen are showing their <img>.
  //    Take them over at full reveal with zero drift, then ease drift in.
  const now0 = performance.now();
  for (const p of planes) {
    const r = p.el.getBoundingClientRect();
    p.visible = r.bottom > 0 && r.top < window.innerHeight;
    if (r.top < window.innerHeight) {
      p.reveal = 1;
      p.revealAt = 0;
      p.settle = 0;
      p.settleAt = now0;
    }
  }

  // Reveal the rest when they arrive.
  const io = new IntersectionObserver((entries) => {
    for (const e of entries) {
      const p = planes.find((q) => q.el === e.target);
      if (!p) continue;
      p.visible = e.isIntersecting;
      if (e.isIntersecting && e.intersectionRatio > 0.12 && p.revealAt < 0) p.revealAt = performance.now();
    }
    wake();
  }, { threshold: [0, 0.12, 0.3] });
  planes.forEach((p) => io.observe(p.el));

  // 4. Input.
  let pointerX = -1;
  let pointerY = -1;
  let pointerFine = false;
  window.addEventListener('pointermove', (e) => {
    pointerFine = e.pointerType === 'mouse';
    pointerX = e.clientX;
    pointerY = e.clientY;
    if (pointerFine) wake();
  }, { passive: true });
  document.addEventListener('pointerleave', () => { pointerX = -1; wake(); });
  window.addEventListener('scroll', () => wake(), { passive: true });
  window.addEventListener('resize', () => wake());
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) park();
    else { lastScroll = window.scrollY; wake(); }
  });

  // 5. Loop.
  let raf = 0;
  let lastScroll = window.scrollY;
  let velocity = 0;
  let idleFrames = 0;
  let lastTime = performance.now();
  let slowFrames = 0;
  let sampleFrames = 0;
  let drewEmpty = false;

  function wake() {
    if (!raf && !lost && !document.hidden) {
      lastTime = performance.now();
      raf = requestAnimationFrame(frame);
    }
  }
  function park() {
    if (raf) cancelAnimationFrame(raf);
    raf = 0;
  }

  function sizeCanvas() {
    const w = Math.round(canvas.clientWidth * dpr);
    const h = Math.round(canvas.clientHeight * dpr);
    if (canvas.width !== w || canvas.height !== h) gpu.resize(w, h);
  }

  function frame(now) {
    raf = 0;
    if (lost) return;

    // Adaptive resolution: if frames keep running long, drop pixel ratio a step.
    const dt = now - lastTime;
    lastTime = now;
    if (dt < 100) {
      sampleFrames++;
      if (dt > 22) slowFrames++;
      if (sampleFrames >= 60) {
        if (slowFrames > 20 && dpr > 1) {
          dprCap = Math.max(1, dpr - 0.25);
          dpr = dprCap;
        }
        sampleFrames = 0;
        slowFrames = 0;
      }
    }

    sizeCanvas();
    const vw = canvas.clientWidth;
    const vh = canvas.clientHeight;

    // Smoothed scroll velocity drives the bend.
    const y = window.scrollY;
    velocity += (y - lastScroll - velocity) * 0.2;
    lastScroll = y;
    if (Math.abs(velocity) < 0.01) velocity = 0;
    const bend = clamp(velocity * 1.4, -64, 64) * (lite ? 0.7 : 1);

    let animating = velocity !== 0;
    const items = [];

    for (const p of planes) {
      if (!p.visible) continue;
      const r = p.el.getBoundingClientRect();
      if (r.bottom < -64 || r.top > vh + 64 || r.width < 1) continue;

      // Reveal and settle progress.
      if (p.revealAt > 0 && p.reveal < 1) {
        p.reveal = clamp((now - p.revealAt) / REVEAL_MS, 0, 1);
        animating = true;
      }
      if (p.settleAt > 0 && p.settle < 1) {
        const t = clamp((now - p.settleAt) / SETTLE_MS, 0, 1);
        p.settle = 1 - Math.pow(1 - t, 3);
        animating = true;
      }

      // Pointer loupe (mouse only; touch never depends on it).
      const inside = pointerFine && pointerX >= r.left && pointerX <= r.right && pointerY >= r.top && pointerY <= r.bottom;
      p.ptr.target = inside && !lite ? 1 : 0;
      if (inside) {
        const dx = ((pointerX - r.left) / r.width - p.ptr.x) * 0.25;
        const dy = ((pointerY - r.top) / r.height - p.ptr.y) * 0.25;
        p.ptr.x += dx;
        p.ptr.y += dy;
        if (Math.abs(dx) + Math.abs(dy) > 0.0005) animating = true;
      }
      const ds = (p.ptr.target - p.ptr.s) * 0.12;
      p.ptr.s += ds;
      if (Math.abs(ds) > 0.001) animating = true;

      // Cover fit, parallax drift from the plate's position in the viewport.
      const planeAspect = r.width / r.height;
      const cx = planeAspect > p.aspect ? 1 : planeAspect / p.aspect;
      const cy = planeAspect > p.aspect ? p.aspect / planeAspect : 1;
      const centre = (r.top + r.height / 2 - vh / 2) / (vh / 2 + r.height / 2);
      const isHero = p.el.hasAttribute('data-hero-plate');
      const zoom = isHero ? 1 : 1 + (BASE_ZOOM - 1) * p.settle;
      const drift = isHero ? 0 : clamp(centre, -1, 1) * PARALLAX * p.settle;

      const d = p.data;
      d[0] = r.left; d[1] = r.top; d[2] = r.width; d[3] = r.height;
      d[4] = vw; d[5] = vh; d[6] = bend; d[7] = p.revealAt < 0 ? 0 : p.reveal;
      d[8] = p.ptr.x; d[9] = p.ptr.y; d[10] = p.ptr.s; d[11] = 0;
      d[12] = cx; d[13] = cy; d[14] = zoom; d[15] = drift;
      items.push(p);
    }

    // Nothing on screen: clear once and stop doing work until something changes.
    if (!items.length) {
      if (!drewEmpty) { gpu.render([]); drewEmpty = true; }
      return;
    }
    drewEmpty = false;
    gpu.render(items);

    idleFrames = animating ? 0 : idleFrames + 1;
    if (idleFrames < 6) raf = requestAnimationFrame(frame);
  }

  // 6. First frame, then hand over from the <img> elements in the same frame.
  await new Promise((resolve) => requestAnimationFrame((t) => { frame(t); resolve(); }));
  if (lost) return gpu.kind;
  root.classList.add('gpu-on');
  root.dataset.gpu = gpu.kind;
  wake();
  return gpu.kind;
}
