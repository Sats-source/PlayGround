import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

window.__forgeBoot = true;

/* ---------------------------------- dom ---------------------------------- */
const $ = (id) => document.getElementById(id);
const logEl = $('log');
const btnForge = $('btnForge');

function log(msg, cls = '') {
  const line = document.createElement('div');
  if (cls) line.className = cls;
  const t = new Date().toLocaleTimeString();
  line.textContent = `[${t}] ${msg}`;
  logEl.appendChild(line);
  logEl.scrollTop = logEl.scrollHeight;
}

/* --------------------------------- state --------------------------------- */
const state = {
  srcCanvas: null,      // full-res source image canvas
  srcAspect: 4 / 3,
  mesh: null,
  depthMs: null,
  aiEngine: null,       // cached depth estimator
  aiLoading: null,      // in-flight promise
  aiFailed: false,
  booted: false,
};

/* ------------------------------- three setup ------------------------------ */
const canvas = $('gl');
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x0b0e14);
scene.fog = new THREE.Fog(0x0b0e14, 14, 30);

const camera = new THREE.PerspectiveCamera(40, 1, 0.1, 100);
camera.position.set(0.8, 0.6, 7.2);

const controls = new OrbitControls(camera, canvas);
controls.target.set(0, 0, 0.2);
controls.enableDamping = true;
controls.dampingFactor = 0.06;
controls.minDistance = 2.2;
controls.maxDistance = 18;
controls.autoRotate = true;
controls.autoRotateSpeed = 1.4;

const pmrem = new THREE.PMREMGenerator(renderer);
scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;

const hemi = new THREE.HemisphereLight(0xdfeaff, 0x1a1410, 0.5);
scene.add(hemi);

const key = new THREE.DirectionalLight(0xffffff, 2.4);
key.position.set(4, 6, 5);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
key.shadow.camera.left = -5; key.shadow.camera.right = 5;
key.shadow.camera.top = 5; key.shadow.camera.bottom = -5;
key.shadow.camera.far = 25;
key.shadow.bias = -0.0004;
key.shadow.normalBias = 0.02;
scene.add(key);

const rim = new THREE.DirectionalLight(0x88aaff, 1.6);
rim.position.set(-5, 3, -4);
scene.add(rim);

const fill = new THREE.DirectionalLight(0xfff1dd, 0.55);
fill.position.set(-2, -1, 6);
scene.add(fill);

const ground = new THREE.Mesh(
  new THREE.CircleGeometry(24, 48),
  new THREE.ShadowMaterial({ opacity: 0.38 })
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = -2.6;
ground.receiveShadow = true;
scene.add(ground);

const grid = new THREE.GridHelper(30, 30, 0x2a3a5f, 0x16203a);
grid.position.y = -2.59;
grid.material.transparent = true;
grid.material.opacity = 0.35;
scene.add(grid);

const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(1280, 720), 0.0, 0.55, 0.85);
composer.addPass(bloom);
composer.addPass(new OutputPass());

function resize() {
  const box = $('viewport').getBoundingClientRect();
  const w = Math.max(2, Math.floor(box.width));
  const h = Math.max(2, Math.floor(box.height));
  renderer.setSize(w, h, false);
  composer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
new ResizeObserver(resize).observe($('viewport'));
window.addEventListener('resize', resize);
resize();

/* ------------------------------ image intake ------------------------------ */
function setSource(canvasEl, label) {
  state.srcCanvas = canvasEl;
  state.srcAspect = canvasEl.width / canvasEl.height;
  drawCover($('srcPreview'), canvasEl);
  log(`source image set (${canvasEl.width}×${canvasEl.height}) — ${label}`, 'ok');
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { log('not an image file, skipped', 'warn'); return; }
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = () => {
    const c = document.createElement('canvas');
    const maxSide = 1024;
    const s = Math.min(1, maxSide / Math.max(img.width, img.height));
    c.width = Math.round(img.width * s); c.height = Math.round(img.height * s);
    c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
    URL.revokeObjectURL(url);
    setSource(c, file.name);
  };
  img.onerror = () => log('could not decode that image', 'err');
  img.src = url;
}

const dz = $('dropzone'), fi = $('fileInput');
dz.addEventListener('click', () => fi.click());
dz.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') fi.click(); });
fi.addEventListener('change', () => loadFile(fi.files[0]));
['dragover', 'dragenter'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
['dragleave', 'drop'].forEach((ev) => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
dz.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
window.addEventListener('paste', (e) => {
  const item = [...(e.clipboardData?.items || [])].find((i) => i.type.startsWith('image/'));
  if (item) { loadFile(item.getAsFile()); log('pasted image from clipboard', 'ok'); }
});

/* --------------------------- procedural samples --------------------------- */
function makeSample(kind) {
  const W = 640, H = 480;
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const rnd = ((seed) => () => (seed = (seed * 16807) % 2147483647) / 2147483647)(kind.length * 7919 + 13);

  if (kind === 'peak') {
    const sky = x.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#0e1a3a'); sky.addColorStop(0.55, '#c96f3b'); sky.addColorStop(0.62, '#f7c873');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    x.fillStyle = '#ffe9b8';
    x.beginPath(); x.arc(W * 0.68, H * 0.42, 34, 0, 7); x.fill();
    x.fillStyle = '#f7c873';
    x.beginPath(); x.arc(W * 0.68, H * 0.42, 44, 0, 7); x.globalAlpha = 0.35; x.fill(); x.globalAlpha = 1;
    const ridge = (base, amp, col) => {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
      for (let i = 0; i <= W; i += 8) x.lineTo(i, base - Math.abs(Math.sin(i * 0.013 + base)) * amp - rnd() * 22);
      x.lineTo(W, H); x.closePath(); x.fill();
    };
    ridge(H * 0.52, 130, '#3a3f66');
    x.fillStyle = 'rgba(255,255,255,0.85)';
    for (let i = 0; i < W; i += 8) {
      const y = H * 0.52 - Math.abs(Math.sin(i * 0.013 + H * 0.52)) * 130 - 11;
      if (y < H * 0.34) { x.fillRect(i, y - 6, 8, 12); }
    }
    ridge(H * 0.72, 90, '#23263f');
    ridge(H * 0.9, 60, '#141a2e');
  } else if (kind === 'orb') {
    x.fillStyle = '#070a12'; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 160; i++) {
      x.fillStyle = `rgba(255,255,255,${0.15 + rnd() * 0.6})`;
      x.fillRect(rnd() * W, rnd() * H, 1.6, 1.6);
    }
    x.fillStyle = 'rgba(0,0,0,0.55)';
    x.beginPath(); x.ellipse(W * 0.5, H * 0.82, 150, 26, 0, 0, 7); x.fill();
    const cx = W * 0.5, cy = H * 0.55, r = 128;
    const g = x.createRadialGradient(cx - 44, cy - 52, 10, cx, cy, r);
    g.addColorStop(0, '#eaf6ff'); g.addColorStop(0.35, '#7cc7f5');
    g.addColorStop(0.7, '#2a5cb0'); g.addColorStop(1, '#0b1c44');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, r, 0, 7); x.fill();
    x.fillStyle = 'rgba(255,255,255,0.9)';
    x.beginPath(); x.ellipse(cx - 46, cy - 58, 30, 18, -0.6, 0, 7); x.fill();
    const g2 = x.createRadialGradient(W * 0.78, H * 0.66, 4, W * 0.78, H * 0.66, 52);
    g2.addColorStop(0, '#ffd9a8'); g2.addColorStop(1, '#7a3c12');
    x.fillStyle = g2;
    x.beginPath(); x.arc(W * 0.78, H * 0.68, 50, 0, 7); x.fill();
  } else {
    x.fillStyle = '#0c0a10'; x.fillRect(0, 0, W, H);
    const cx = W / 2, cy = H * 0.56;
    for (let p = 0; p < 12; p++) {
      const a = (p / 12) * Math.PI * 2;
      const g = x.createLinearGradient(cx, cy, cx + Math.cos(a) * 190, cy + Math.sin(a) * 190);
      g.addColorStop(0, '#a4124e'); g.addColorStop(1, '#ff8fc0');
      x.fillStyle = g;
      x.beginPath();
      x.ellipse(cx + Math.cos(a) * 108, cy + Math.sin(a) * 108, 92, 44, a, 0, 7);
      x.fill();
    }
    const g = x.createRadialGradient(cx - 12, cy - 14, 4, cx, cy, 60);
    g.addColorStop(0, '#fff3b0'); g.addColorStop(0.5, '#f5a623'); g.addColorStop(1, '#7a3c12');
    x.fillStyle = g;
    x.beginPath(); x.arc(cx, cy, 58, 0, 7); x.fill();
    x.fillStyle = '#1d3a24';
    x.beginPath(); x.ellipse(cx, H * 0.94, 200, 40, 0, 0, 7); x.fill();
  }
  return c;
}

document.querySelectorAll('.sample-btn').forEach((b) =>
  b.addEventListener('click', () => setSource(makeSample(b.dataset.sample), `sample:${b.dataset.sample}`))
);

/* ------------------------------ depth maps -------------------------------- */
function drawCover(dst, src) {
  const x = dst.getContext('2d');
  const s = Math.max(dst.width / src.width, dst.height / src.height);
  const w = src.width * s, h = src.height * s;
  x.fillStyle = '#000'; x.fillRect(0, 0, dst.width, dst.height);
  x.drawImage(src, (dst.width - w) / 2, (dst.height - h) / 2, w, h);
}

function boxBlur(src, W, H, radius, passes) {
  let a = src, b = new Float32Array(src.length);
  for (let p = 0; p < passes; p++) {
    for (let y = 0; y < H; y++) {
      let acc = 0, n = 0;
      for (let k = -radius; k <= radius; k++) { const i = y * W + Math.min(W - 1, Math.max(0, k)); acc += a[i]; n++; }
      for (let xx = 0; xx < W; xx++) {
        b[y * W + xx] = acc / n;
        const add = Math.min(W - 1, xx + radius + 1), sub = Math.max(0, xx - radius);
        if (add !== sub) { acc += a[y * W + add] - a[y * W + sub]; }
      }
    }
    a = b; b = (p === passes - 1 && false) ? b : new Float32Array(a.length);
    // vertical
    const c = new Float32Array(a.length);
    for (let xx = 0; xx < W; xx++) {
      let acc = 0, n = 0;
      for (let k = -radius; k <= radius; k++) { const yy = Math.min(H - 1, Math.max(0, k)); acc += a[yy * W + xx]; n++; }
      for (let y = 0; y < H; y++) {
        c[y * W + xx] = acc / n;
        const add = Math.min(H - 1, y + radius + 1), sub = Math.max(0, y - radius);
        if (add !== sub) { acc += a[add * W + xx] - a[sub * W + xx]; }
      }
    }
    a = c; b = new Float32Array(a.length);
  }
  return a;
}

function normalize01(d) {
  let mn = Infinity, mx = -Infinity;
  for (const v of d) { if (v < mn) mn = v; if (v > mx) mx = v; }
  const span = Math.max(1e-6, mx - mn);
  return d.map((v) => (v - mn) / span);
}

/** Built-in fallback: shape-from-shading heuristic. Always available offline. */
function heuristicDepth(srcCanvas, W, H) {
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  const x = tmp.getContext('2d', { willReadFrequently: true });
  const s = Math.max(W / srcCanvas.width, H / srcCanvas.height);
  const w = srcCanvas.width * s, h = srcCanvas.height * s;
  x.fillStyle = '#000'; x.fillRect(0, 0, W, H);
  x.drawImage(srcCanvas, (W - w) / 2, (H - h) / 2, w, h);
  const px = x.getImageData(0, 0, W, H).data;
  const luma = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    luma[i] = (0.2126 * px[i * 4] + 0.7152 * px[i * 4 + 1] + 0.0722 * px[i * 4 + 2]) / 255;
  }
  const r = Math.max(2, Math.round(Math.max(W, H) / 28));
  const base = boxBlur(luma, W, H, r, 2);
  const fine = boxBlur(luma, W, H, 1, 1);
  const out = new Float32Array(W * H);
  for (let i = 0; i < W * H; i++) {
    const detail = THREE.MathUtils.clamp(0.5 + (fine[i] - base[i]) * 2.0, 0, 1);
    out[i] = 0.62 * base[i] + 0.38 * detail;
  }
  return normalize01(out);
}

async function loadAIEngine(onProgress) {
  if (state.aiEngine) return state.aiEngine;
  if (state.aiLoading) return state.aiLoading;
  state.aiLoading = (async () => {
    log('loading on-device depth AI (one-time download, then cached)…');
    const lib = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.5.2/+esm');
    lib.env.allowLocalModels = false;
    if (navigator.deviceMemory && navigator.deviceMemory < 4) lib.env.useBrowserCache = true;
    const ids = ['onnx-community/depth-anything-v2-small', 'Xenova/depth-anything-small'];
    let lastErr = null;
    for (const id of ids) {
      try {
        log(`trying ${id} …`);
        const est = await lib.pipeline('depth-estimation', id, {
          progress_callback: (p) => {
            if (p.status === 'progress' && p.total) onProgress(p.loaded / p.total, `${p.file || 'model'} ${Math.round((p.loaded / p.total) * 100)}%`);
            else if (p.status === 'done') onProgress(1, p.file || 'done');
          },
        });
        state.aiEngine = est;
        $('aiStatus').textContent = 'AI depth: ready & cached locally ✅';
        $('aiStatus').classList.add('ready');
        log(`depth AI ready (${id})`, 'ok');
        return est;
      } catch (e) { lastErr = e; log(`${id} failed: ${e.message}`, 'warn'); }
    }
    throw lastErr || new Error('no depth model available');
  })();
  try { return await state.aiLoading; }
  finally { if (!state.aiEngine) state.aiLoading = null; }
}

async function estimateDepth(srcCanvas, W, H, onProgress) {
  const t0 = performance.now();
  try {
    const est = await loadAIEngine(onProgress);
    const out = await est(srcCanvas, { top_k: 0 });
    const t = out.predicted_depth;
    const dH = t.dims[t.dims.length - 2], dW = t.dims[t.dims.length - 1];
    let raw = Float32Array.from(t.data);
    raw = normalize01(raw);
    // resample to W,H (cover)
    const s = Math.max(W / dW, H / dH);
    const out2 = new Float32Array(W * H);
    for (let y = 0; y < H; y++) {
      for (let xx = 0; xx < W; xx++) {
        const sx = Math.min(dW - 1, Math.max(0, Math.round(xx / s + (dW - W / s) / 2)));
        const sy = Math.min(dH - 1, Math.max(0, Math.round(y / s + (dH - H / s) / 2)));
        out2[y * W + xx] = raw[sy * dW + sx];
      }
    }
    state.depthMs = performance.now() - t0;
    $('statMs').textContent = `depth AI: ${(state.depthMs / 1000).toFixed(1)}s`;
    log(`AI depth done in ${(state.depthMs / 1000).toFixed(1)}s`, 'ok');
    return { map: out2, mode: 'ai' };
  } catch (e) {
    log(`AI depth unavailable (${e.message}) — using built-in fallback`, 'warn');
    if (!state.aiFailed) {
      state.aiFailed = true;
      $('aiStatus').textContent = 'AI depth: offline — using built-in depth fallback';
    }
    const t1 = performance.now();
    const map = heuristicDepth(srcCanvas, W, H);
    state.depthMs = performance.now() - t1;
    $('statMs').textContent = `depth fallback: ${Math.round(state.depthMs)}ms`;
    return { map, mode: 'fallback' };
  }
}

function paintDepthPreview(map, W, H) {
  const c = $('depthPreview');
  const x = c.getContext('2d');
  const img = x.createImageData(W, H);
  for (let i = 0; i < W * H; i++) {
    const v = Math.round(map[i] * 255);
    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
  }
  const tmp = document.createElement('canvas');
  tmp.width = W; tmp.height = H;
  tmp.getContext('2d').putImageData(img, 0, 0);
  drawCover(c, tmp);
}

/* ------------------------------- mesh forge ------------------------------- */
function smoothstep(a, b, v) {
  const t = THREE.MathUtils.clamp((v - a) / (b - a), 0, 1);
  return t * t * (3 - 2 * t);
}

function buildSolidGeometry(depth, W, H, planeW, planeH, strength, thickness) {
  // front grid verts
  const cols = W + 1, rows = H + 1;
  const pos = [], uv = [], col = [], idx = [];
  const blur = boxBlur(depth, W, H, 1, 1);
  for (let j = 0; j < rows; j++) {
    for (let i = 0; i < cols; i++) {
      const ci = Math.min(W - 1, i), cj = Math.min(H - 1, j);
      const d = depth[cj * W + ci];
      const cav = THREE.MathUtils.clamp((blur[cj * W + ci] - d) * 2.2, 0, 1);
      const shade = 1 - 0.42 * cav;
      pos.push((i / W - 0.5) * planeW, (0.5 - j / H) * planeH, d * strength);
      uv.push(i / W, 1 - j / H);
      col.push(shade, shade, shade);
    }
  }
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const a = j * cols + i, b2 = a + 1, c2 = a + cols, d2 = c2 + 1;
      idx.push(a, c2, b2, b2, c2, d2);
    }
  }
  const frontCount = pos.length / 3;

  // rim skirt: connect border loop to back plate edge (shares front verts → beveled look)
  const loop = [];
  for (let i = 0; i <= W; i++) loop.push(i);                       // top row j=0
  for (let j = 1; j <= H; j++) loop.push(j * cols + W);            // right col
  for (let i = W - 1; i >= 0; i--) loop.push(H * cols + i);        // bottom row
  for (let j = H - 1; j >= 1; j--) loop.push(j * cols);            // left col
  const backOf = new Map();
  const backZ = -thickness;
  for (const f of loop) {
    const bx = pos[f * 3], by = pos[f * 3 + 1];
    const bi = pos.length / 3;
    pos.push(bx, by, backZ);
    uv.push(uv[f * 2], uv[f * 2 + 1]);
    col.push(0.55, 0.55, 0.55);
    backOf.set(f, bi);
  }
  for (let k = 0; k < loop.length; k++) {
    const f0 = loop[k], f1 = loop[(k + 1) % loop.length];
    const b0 = backOf.get(f0), b1 = backOf.get(f1);
    idx.push(f0, b0, f1, f1, b0, b1);
  }
  // back plate: single quad fan over loop's 4 corners
  const ctr = pos.length / 3;
  pos.push(0, 0, backZ); uv.push(0.5, 0.5); col.push(0.5, 0.5, 0.5);
  const cTop = backOf.get(loop[0]);
  const cRight = backOf.get(loop[W + H]);
  const cBot = backOf.get(loop[W + H + W]);
  const cLeft = backOf.get(loop[W + H + W + H]);
  idx.push(ctr, cRight, cTop, ctr, cBot, cRight, ctr, cLeft, cBot, ctr, cTop, cLeft);

  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setAttribute('color', new THREE.Float32BufferAttribute(col, 3));
  g.setIndex(idx);
  g.computeVertexNormals();
  return g;
}

function normalMapFromDepth(depth, W, H, strength) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d');
  const img = x.createImageData(W, H);
  const h = (i, j) => depth[Math.min(H - 1, Math.max(0, j)) * W + Math.min(W - 1, Math.max(0, i))];
  for (let j = 0; j < H; j++) {
    for (let i = 0; i < W; i++) {
      const dx = (h(i + 1, j) - h(i - 1, j)) * strength;
      const dy = (h(i, j + 1) - h(i, j - 1)) * strength;
      const inv = 1 / Math.hypot(dx, dy, 1);
      img.data[(j * W + i) * 4] = (-dx * inv * 0.5 + 0.5) * 255;
      img.data[(j * W + i) * 4 + 1] = (dy * inv * 0.5 + 0.5) * 255;
      img.data[(j * W + i) * 4 + 2] = (inv * 0.5 + 0.5) * 255;
      img.data[(j * W + i) * 4 + 3] = 255;
    }
  }
  x.putImageData(img, 0, 0);
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.ClampToEdgeWrapping;
  return t;
}

function roughnessMapFromPhoto(srcCanvas, W, H, base) {
  const c = document.createElement('canvas');
  c.width = W; c.height = H;
  const x = c.getContext('2d', { willReadFrequently: true });
  const s = Math.max(W / srcCanvas.width, H / srcCanvas.height);
  const w = srcCanvas.width * s, h = srcCanvas.height * s;
  x.drawImage(srcCanvas, (W - w) / 2, (H - h) / 2, w, h);
  const img = x.getImageData(0, 0, W, H);
  for (let i = 0; i < W * H; i++) {
    const l = (0.2126 * img.data[i * 4] + 0.7152 * img.data[i * 4 + 1] + 0.0722 * img.data[i * 4 + 2]) / 255;
    const v = THREE.MathUtils.clamp(base + (0.5 - l) * 0.45, 0.05, 1) * 255;
    img.data[i * 4] = img.data[i * 4 + 1] = img.data[i * 4 + 2] = v;
  }
  x.putImageData(img, 0, 0);
  return new THREE.CanvasTexture(c);
}

/* --------------------------- material & lighting -------------------------- */
function applyMaterialPreset(mat, maps, presetName) {
  const metal = parseFloat($('optMetal').value);
  const rough = parseFloat($('optRough').value);
  mat.map = maps.photo;
  mat.vertexColors = true;
  mat.metalness = metal;
  mat.roughness = rough;
  mat.roughnessMap = maps.rough;
  mat.normalMap = maps.normal;
  mat.clearcoat = 0; mat.clearcoatRoughness = 0.3;
  mat.sheen = 0;
  mat.color.set(0xffffff);
  mat.envMapIntensity = 1.0;

  if (presetName === 'statue') { mat.clearcoat = 0.9; mat.clearcoatRoughness = 0.28; mat.envMapIntensity = 1.15; }
  else if (presetName === 'clay') {
    mat.map = null; mat.roughnessMap = null; mat.color.set(0xb9b0a4);
    mat.roughness = 0.82; mat.metalness = 0;
  } else if (presetName === 'metal') {
    mat.map = null; mat.roughnessMap = null; mat.color.set(0xd7dde8);
    mat.metalness = 0.95; mat.roughness = 0.32; mat.envMapIntensity = 1.5;
  } else if (presetName === 'skin') {
    mat.clearcoat = 0.35; mat.clearcoatRoughness = 0.5;
    mat.sheen = 0.6; mat.sheenColor.set(0xff9d9d); mat.sheenRoughness = 0.6;
    mat.envMapIntensity = 0.8;
  } else if (presetName === 'photo') { mat.clearcoat = 0.15; mat.clearcoatRoughness = 0.4; }
  mat.normalScale.set(parseFloat($('optNormal').value), parseFloat($('optNormal').value));
  mat.needsUpdate = true;
}

function applyLighting(name) {
  const bg = {
    studio: 0x0d1119, sunset: 0x1c0f16, night: 0x04060d, dramatic: 0x030304,
  }[name];
  scene.background.set(bg);
  scene.fog.color.set(bg);
  bloom.strength = 0;
  if (name === 'studio') {
    key.color.set(0xffffff); key.intensity = 2.4; key.position.set(4, 6, 5);
    rim.color.set(0x88aaff); rim.intensity = 1.6;
    fill.color.set(0xfff1dd); fill.intensity = 0.55;
    hemi.intensity = 0.5;
    renderer.toneMappingExposure = 1.05;
  } else if (name === 'sunset') {
    key.color.set(0xffb36b); key.intensity = 3.0; key.position.set(-5, 2.2, 4);
    rim.color.set(0xff5fa2); rim.intensity = 2.0;
    fill.color.set(0x4a5cff); fill.intensity = 0.4;
    hemi.intensity = 0.35;
    renderer.toneMappingExposure = 1.1;
    bloom.strength = $('optBloom').checked ? 0.35 : 0;
  } else if (name === 'night') {
    key.color.set(0x6f8dff); key.intensity = 0.9; key.position.set(2, 5, 3);
    rim.color.set(0x35f0ff); rim.intensity = 2.6;
    fill.color.set(0xff3fd4); fill.intensity = 0.5;
    hemi.intensity = 0.18;
    renderer.toneMappingExposure = 1.15;
    bloom.strength = $('optBloom').checked ? 0.55 : 0;
  } else {
    key.color.set(0xffffff); key.intensity = 1.4; key.position.set(5, 1.5, 2);
    rim.color.set(0xffffff); rim.intensity = 3.2; rim.position.set(-1, 4, -6);
    fill.color.set(0x223355); fill.intensity = 0.25;
    hemi.intensity = 0.12;
    renderer.toneMappingExposure = 1.0;
    bloom.strength = $('optBloom').checked ? 0.3 : 0;
  }
  if ($('optBloom').checked && bloom.strength === 0 && (name === 'studio')) bloom.strength = 0.25;
}

/* --------------------------------- forge ---------------------------------- */
function setProgress(frac, label) {
  $('progressWrap').classList.remove('hidden');
  $('progressBar').style.width = `${Math.round(frac * 100)}%`;
  if (label) log(label);
  if (frac >= 1) setTimeout(() => $('progressWrap').classList.add('hidden'), 600);
}

async function forge() {
  if (!state.srcCanvas) { log('drop an image or pick a sample first', 'warn'); return; }
  btnForge.disabled = true;
  try {
    const res = parseInt($('optResolution').value, 10);
    const aspect = state.srcAspect;
    const W = res;
    const H = Math.min(512, Math.max(32, Math.round(res * (1 / aspect) || res)));
    log(`forging ${W}×${H} grid…`);

    setProgress(0.05, 'estimating depth…');
    const { map: raw, mode } = await estimateDepth(state.srcCanvas, W, H, (f, name) =>
      setProgress(0.05 + f * 0.5, `depth AI: ${name}`));
    setProgress(0.6, `depth ready (${mode === 'ai' ? 'on-device AI' : 'built-in fallback'})`);

    await new Promise((r) => setTimeout(r, 10)); // let UI breathe

    // smoothing + background push + normalize
    const smoothN = parseInt($('optSmooth').value, 10);
    let depth = smoothN > 0 ? boxBlur(raw, W, H, 1, smoothN) : raw.slice();
    depth = normalize01(depth);
    const bg = parseFloat($('optBg').value);
    for (let i = 0; i < depth.length; i++) {
      const d = depth[i];
      depth[i] = d * (1 - bg * (1 - smoothstep(0, 0.35, d)));
    }
    paintDepthPreview(normalize01(depth), W, H);

    // geometry
    setProgress(0.72, 'sculpting high-poly mesh…');
    await new Promise((r) => setTimeout(r, 10));
    const strength = parseFloat($('optDepth').value);
    const thick = parseFloat($('optThick').value);
    const planeW = 4, planeH = Math.min(7, 4 / aspect);
    const geo = buildSolidGeometry(depth, W, H, planeW, planeH, strength, thick);
    const tris = Math.round(geo.index.count / 3);

    // textures
    const photo = new THREE.CanvasTexture(state.srcCanvas);
    photo.colorSpace = THREE.SRGBColorSpace;
    photo.anisotropy = renderer.capabilities.getMaxAnisotropy();
    const normal = normalMapFromDepth(depth, W, H, parseFloat($('optNormal').value) * 2.2);
    const rough = roughnessMapFromPhoto(state.srcCanvas, W, H, parseFloat($('optRough').value));
    const mat = new THREE.MeshPhysicalMaterial({ side: THREE.FrontSide });
    applyMaterialPreset(mat, { photo, normal, rough }, $('optMaterial').value);
    mat.wireframe = $('optWire').checked;

    const mesh = new THREE.Mesh(geo, mat);
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.position.y = 0.1;

    if (state.mesh) {
      scene.remove(state.mesh);
      state.mesh.geometry.dispose();
      state.mesh.material.dispose();
    }
    scene.add(state.mesh = mesh);
    ground.position.y = -planeH / 2 - thick - 0.35;
    grid.position.y = ground.position.y + 0.01;

    applyLighting($('optLight').value);
    $('emptyState').classList.add('hidden');
    $('statTris').textContent = `${(tris / 1000).toFixed(0)}k tris`;
    setProgress(1, `forged ✅ ${(tris / 1000).toFixed(0)}k triangles, solid & watertight-ish, PBR maps baked`);
    log(`mesh: ${W}×${H} grid → ${tris.toLocaleString()} triangles`, 'ok');
  } catch (e) {
    log(`forge failed: ${e.message}`, 'err');
    console.error(e);
  } finally {
    btnForge.disabled = false;
  }
}

/* --------------------------------- export --------------------------------- */
function download(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 4000);
}

function renderNow() {
  controls.update();
  composer.render();
}

$('btnGLB').addEventListener('click', () => {
  if (!state.mesh) return log('forge a model first', 'warn');
  log('exporting GLB…');
  new GLTFExporter().parse(state.mesh, (res) => {
    download(new Blob([res], { type: 'model/gltf-binary' }), 'forge3d-model.glb');
    log('GLB downloaded ✅ free & unlimited, no watermark', 'ok');
  }, (e) => log(`GLB failed: ${e.message}`, 'err'), { binary: true });
});

$('btnSTL').addEventListener('click', () => {
  if (!state.mesh) return log('forge a model first', 'warn');
  const data = new STLExporter().parse(state.mesh, { binary: true });
  download(new Blob([data], { type: 'model/stl' }), 'forge3d-model.stl');
  log('STL downloaded ✅ ready for slicing / 3D printing', 'ok');
});

$('btnPNG').addEventListener('click', () => {
  if (!state.mesh) return log('forge a model first', 'warn');
  renderNow();
  canvas.toBlob((b) => {
    download(b, 'forge3d-shot.png');
    log('PNG snapshot downloaded ✅', 'ok');
  });
});

/* ------------------------------ live controls ----------------------------- */
const bind = (id, vid, fmt, fn) => {
  $(id).addEventListener('input', (e) => {
    $(vid).textContent = fmt(parseFloat(e.target.value));
    fn && fn();
  });
};
bind('optDepth', 'vDepth', (v) => v.toFixed(2));
bind('optSmooth', 'vSmooth', (v) => `${v}`);
bind('optBg', 'vBg', (v) => v.toFixed(2));
bind('optThick', 'vThick', (v) => v.toFixed(2));
bind('optNormal', 'vNormal', (v) => v.toFixed(1), () => {
  if (state.mesh) state.mesh.material.normalScale.set(parseFloat($('optNormal').value), parseFloat($('optNormal').value));
});
bind('optMetal', 'vMetal', (v) => v.toFixed(2), () => { if (state.mesh) state.mesh.material.metalness = parseFloat($('optMetal').value); });
bind('optRough', 'vRough', (v) => v.toFixed(2), () => { if (state.mesh) state.mesh.material.roughness = parseFloat($('optRough').value); });

$('optMaterial').addEventListener('change', () => {
  if (!state.mesh) return;
  const m = state.mesh.material;
  const photo = new THREE.CanvasTexture(state.srcCanvas);
  photo.colorSpace = THREE.SRGBColorSpace;
  photo.anisotropy = renderer.capabilities.getMaxAnisotropy();
  applyMaterialPreset(m, {
    photo,
    normal: m.normalMap,
    rough: m.roughnessMap,
  }, $('optMaterial').value);
  log(`material → ${$('optMaterial').value}`, 'ok');
});
$('optLight').addEventListener('change', () => { applyLighting($('optLight').value); });
$('optBloom').addEventListener('change', () => { applyLighting($('optLight').value); });
$('optSpin').addEventListener('change', (e) => { controls.autoRotate = e.target.checked; });
$('optWire').addEventListener('change', (e) => { if (state.mesh) state.mesh.material.wireframe = e.target.checked; });
$('optResolution').addEventListener('change', () => log('resolution applies to the next forge', ''));
btnForge.addEventListener('click', forge);
$('btnHelp').addEventListener('click', () => $('helpOverlay').classList.remove('hidden'));
$('btnCloseHelp').addEventListener('click', () => $('helpOverlay').classList.add('hidden'));
$('helpOverlay').addEventListener('click', (e) => { if (e.target.id === 'helpOverlay') e.target.classList.add('hidden'); });

/* --------------------------------- main loop ------------------------------ */
let last = performance.now(), fps = 60;
function loop(now) {
  requestAnimationFrame(loop);
  const dt = Math.min(0.1, (now - last) / 1000);
  last = now;
  fps = fps * 0.95 + (1 / Math.max(dt, 1e-4)) * 0.05;
  controls.update();
  composer.render();
  if ((now | 0) % 15 === 0) $('statFps').textContent = `${Math.round(fps)} fps`;
}
requestAnimationFrame(loop);

/* ---------------------------------- boot ---------------------------------- */
log('Forge3D ready — WebGL renderer live, all processing stays in this browser.', 'ok');
log('tip: pick a sample on the left, then hit “Forge 3D model”.', '');
setSource(makeSample('peak'), 'sample:peak (default)');
state.booted = true;
