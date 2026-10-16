import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { STLExporter } from 'three/addons/exporters/STLExporter.js';
import { GLTFExporter } from 'three/addons/exporters/GLTFExporter.js';
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js';

const $ = (id) => document.getElementById(id);
const status = (m) => { $('status').textContent = m; };

const S = {
  mode: 'relief',
  detail: 180, depth: 22, smooth: 2, contrast: 1.15, bright: 0,
  invert: false, cutout: true, cut: 0.08,
  surface: 'photo', tint: '#e8e4da', metal: 0.08, rough: 0.62,
  wire: false, flat: false, base: 6, sizeMm: 120,
  spin: true, grid: true, pedestal: true, light: 'studio', bg: 'charcoal',
};

let renderer, scene, camera, controls, protoGroup, pedestal, gridHelper, ground;
let keyLight, fillLight, rimLight, amb;
let srcCanvas = document.createElement('canvas'); // full-res source
let srcW = 512, srcH = 512, srcLabel = 'demo-art.png';
let heightMap = null, hw = 0, hh = 0;
let rebuildTimer = null;
let spinning = true;

const BG = {
  charcoal: [0x0d0f13, 0x151a28],
  paper: [0xf2f0ea, 0xd8d5cc],
  blue: [0x0b1e3a, 0x0b1e3a],
  green: [0x0e2a1a, 0x0e2a1a],
};

init();
makeDemo('peaks');
bindUI();

function init() {
  const vp = $('viewport');
  renderer = new THREE.WebGLRenderer({ antialias: true, preserveDrawingBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  vp.appendChild(renderer.domElement);

  scene = new THREE.Scene();
  scene.background = new THREE.Color(BG.charcoal[0]);
  scene.fog = new THREE.Fog(BG.charcoal[0], 14, 30);

  camera = new THREE.PerspectiveCamera(42, 1, 0.1, 100);
  camera.position.set(4.8, 3.1, 6.8);

  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.06;
  controls.maxDistance = 20;
  controls.target.set(0, 0.4, 0);

  amb = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(amb);
  keyLight = new THREE.DirectionalLight(0xffffff, 2.2);
  keyLight.position.set(5, 8, 4);
  keyLight.castShadow = true;
  keyLight.shadow.mapSize.set(2048, 2048);
  keyLight.shadow.camera.left = -6; keyLight.shadow.camera.right = 6;
  keyLight.shadow.camera.top = 6; keyLight.shadow.camera.bottom = -6;
  scene.add(keyLight);
  fillLight = new THREE.DirectionalLight(0x88aaff, 0.7);
  fillLight.position.set(-6, 3, 2);
  scene.add(fillLight);
  rimLight = new THREE.DirectionalLight(0xa78bfa, 1.1);
  rimLight.position.set(-2, 4, -6);
  scene.add(rimLight);

  ground = new THREE.Mesh(
    new THREE.CircleGeometry(9, 64),
    new THREE.MeshStandardMaterial({ color: 0x11141d, roughness: 0.95, metalness: 0 })
  );
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -2.02;
  ground.receiveShadow = true;
  scene.add(ground);

  gridHelper = new THREE.GridHelper(18, 36, 0x3b4670, 0x232a44);
  gridHelper.position.y = -2.0;
  scene.add(gridHelper);

  pedestal = new THREE.Mesh(
    new THREE.CylinderGeometry(3.1, 3.35, 0.42, 72),
    new THREE.MeshStandardMaterial({ color: 0x1c2233, roughness: 0.5, metalness: 0.35 })
  );
  pedestal.position.y = -1.8;
  pedestal.receiveShadow = true;
  pedestal.castShadow = true;
  scene.add(pedestal);

  protoGroup = new THREE.Group();
  protoGroup.rotation.y = -0.45;
  scene.add(protoGroup);

  applyLightPreset();
  applyBg();
  resize();
  addEventListener('resize', resize);
  requestAnimationFrame(tick);
}

function resize() {
  const vp = $('viewport');
  const w = Math.max(320, vp.clientWidth), h = Math.max(420, vp.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}

let lastT = 0;
function tick(t) {
  requestAnimationFrame(tick);
  const dt = Math.min(0.05, (t - lastT) / 1000 || 0.016);
  lastT = t;
  if (S.spin) protoGroup.rotation.y += dt * 0.45;
  controls.update();
  renderer.render(scene, camera);
}

// ---------- image sources ----------
function canvasOf(w, h) { const c = document.createElement('canvas'); c.width = w; c.height = h; return c; }

function drawDemo(kind) {
  const W = 512, H = 512;
  const c = canvasOf(W, H), x = c.getContext('2d');
  if (kind === 'peaks') {
    const sky = x.createLinearGradient(0, 0, 0, H);
    sky.addColorStop(0, '#1b2a6b'); sky.addColorStop(0.45, '#7c5cff'); sky.addColorStop(0.62, '#ff9a5c'); sky.addColorStop(1, '#1a1030');
    x.fillStyle = sky; x.fillRect(0, 0, W, H);
    x.fillStyle = '#fff3c4'; x.beginPath(); x.arc(256, 300, 62, 0, 7); x.fill();
    x.fillStyle = 'rgba(255,240,200,.35)'; x.beginPath(); x.arc(256, 300, 95, 0, 7); x.fill();
    const ridge = (base, amp, col, dark) => {
      x.fillStyle = col; x.beginPath(); x.moveTo(0, H);
      x.lineTo(0, base);
      for (let i = 0; i <= 8; i++) x.lineTo((i / 8) * W, base - Math.abs(Math.sin(i * 2.3 + base)) * amp - (i % 3) * 22);
      x.lineTo(W, H); x.closePath(); x.fill();
      x.fillStyle = dark; x.beginPath(); x.moveTo(0, H);
      x.lineTo(0, base + 40);
      for (let i = 0; i <= 8; i++) x.lineTo((i / 8) * W, base + 40 - Math.abs(Math.sin(i * 2.3 + base)) * amp * 0.4);
      x.lineTo(W, H); x.closePath(); x.fill();
    };
    ridge(360, 130, '#3b2d6e', 'rgba(10,8,30,.55)');
    ridge(430, 90, '#241b4d', 'rgba(5,4,18,.6)');
    x.fillStyle = 'rgba(255,255,255,.9)';
    [[150, 285], [300, 235], [390, 300], [210, 250]].forEach(([px, py]) => {
      x.beginPath(); x.moveTo(px, py - 16); x.lineTo(px + 22, py + 10); x.lineTo(px - 22, py + 10); x.closePath(); x.fill();
    });
  } else if (kind === 'logo') {
    x.fillStyle = '#0b0e1a'; x.fillRect(0, 0, W, H);
    const g = x.createRadialGradient(256, 236, 20, 256, 236, 220);
    g.addColorStop(0, '#67e8f9'); g.addColorStop(0.55, '#818cf8'); g.addColorStop(1, '#0b0e1a');
    x.fillStyle = g; x.beginPath(); x.arc(256, 236, 190, 0, 7); x.fill();
    x.fillStyle = '#0b0e1a'; x.beginPath(); x.arc(256, 236, 128, 0, 7); x.fill();
    x.fillStyle = '#fff'; x.font = '900 150px system-ui'; x.textAlign = 'center'; x.textBaseline = 'middle';
    x.fillText('◈', 256, 248);
    x.fillStyle = '#e6e9f5'; x.font = '800 44px system-ui'; x.fillText('PROTO', 256, 440);
  } else if (kind === 'portrait') {
    const g = x.createLinearGradient(0, 0, W, H);
    g.addColorStop(0, '#05060f'); g.addColorStop(1, '#2b2350');
    x.fillStyle = g; x.fillRect(0, 0, W, H);
    for (let i = 0; i < 220; i++) { x.fillStyle = `rgba(255,255,255,${Math.random() * 0.8})`; x.fillRect(Math.random() * W, Math.random() * H, 2, 2); }
    x.fillStyle = '#f4ede0'; x.beginPath(); x.arc(330, 150, 70, 0, 7); x.fill();
    x.fillStyle = '#e8d9bd'; x.beginPath(); x.arc(310, 165, 70, 0, 7); x.fill();
    x.fillStyle = '#caa06a'; x.beginPath(); x.ellipse(256, 330, 95, 115, 0, 0, 7); x.fill();
    x.fillStyle = '#8a5a33'; x.beginPath(); x.ellipse(256, 250, 105, 45, 0, Math.PI, 0); x.fill();
    x.fillStyle = '#1c1410'; x.beginPath(); x.arc(225, 320, 9, 0, 7); x.fill(); x.beginPath(); x.arc(290, 320, 9, 0, 7); x.fill();
    x.strokeStyle = '#5c3a22'; x.lineWidth = 6; x.beginPath(); x.arc(257, 365, 30, 0.3, Math.PI - 0.3); x.stroke();
  } else { // circuit
    x.fillStyle = '#07130d'; x.fillRect(0, 0, W, H);
    x.strokeStyle = '#34d399'; x.lineWidth = 5;
    for (let i = 0; i < 14; i++) {
      const y = 30 + i * 36;
      x.beginPath(); x.moveTo(0, y); x.lineTo(120 + (i * 53) % 280, y); x.lineTo(160 + (i * 53) % 280, y + 18); x.lineTo(W, y + 18); x.stroke();
    }
    x.fillStyle = '#a7f3d0';
    for (let i = 0; i < 40; i++) { x.beginPath(); x.arc(Math.random() * W, Math.random() * H, 6 + Math.random() * 8, 0, 7); x.fill(); }
    x.fillStyle = '#022c22'; x.fillRect(150, 170, 212, 172);
    x.strokeStyle = '#6ee7b7'; x.lineWidth = 6; x.strokeRect(150, 170, 212, 172);
    x.fillStyle = '#6ee7b7'; x.font = '800 40px monospace'; x.textAlign = 'center'; x.fillText('P-3D', 256, 262);
  }
  // subtle grain for relief richness
  const id = x.getImageData(0, 0, W, H), d = id.data;
  for (let i = 0; i < d.length; i += 4) { const n = (Math.random() - 0.5) * 10; d[i] += n; d[i + 1] += n; d[i + 2] += n; }
  x.putImageData(id, 0, 0);
  return c;
}

function setSource(canvas, label) {
  // downscale long side to 512 for speed, keep aspect
  const maxSide = 512;
  const sc = Math.min(1, maxSide / Math.max(canvas.width, canvas.height));
  const W = Math.max(64, Math.round(canvas.width * sc)), H = Math.max(64, Math.round(canvas.height * sc));
  srcCanvas = canvasOf(W, H);
  srcCanvas.getContext('2d').drawImage(canvas, 0, 0, W, H);
  srcW = W; srcH = H; srcLabel = label;
  $('srcPreview').src = srcCanvas.toDataURL('image/png');
  $('srcName').textContent = `${label} · ${W}×${H}`;
  scheduleRebuild();
}

function makeDemo(kind) {
  setSource(drawDemo(kind), `demo-${kind}.png`);
  status(`Demo loaded · ${S.mode} prototype building…`);
}

function loadFile(file) {
  if (!file || !file.type.startsWith('image/')) { status('That file is not an image.'); return; }
  const img = new Image();
  img.onload = () => {
    const c = canvasOf(img.naturalWidth, img.naturalHeight);
    c.getContext('2d').drawImage(img, 0, 0);
    URL.revokeObjectURL(img.src);
    setSource(c, file.name);
  };
  img.onerror = () => status('Could not read that image.');
  img.src = URL.createObjectURL(file);
}

async function loadURL(url) {
  try {
    status('Fetching image…');
    const res = await fetch(url, { mode: 'cors' });
    const blob = await res.blob();
    loadFile(new File([blob], 'web-image.png', { type: blob.type || 'image/png' }));
  } catch { status('URL blocked by CORS — download it and drag in instead.'); }
}

// ---------- height field ----------
function computeHeights(detail) {
  const sctx = srcCanvas.getContext('2d');
  const sd = sctx.getImageData(0, 0, srcW, srcH).data;
  const aspect = srcH / srcW;
  const gw = detail, gh = Math.max(8, Math.round(detail * aspect));
  const h = new Float32Array(gw * gh);
  const bw = srcW / gw, bh = srcH / gh;
  for (let gy = 0; gy < gh; gy++) {
    for (let gx = 0; gx < gw; gx++) {
      const x0 = Math.floor(gx * bw), x1 = Math.max(x0 + 1, Math.floor((gx + 1) * bw));
      const y0 = Math.floor(gy * bh), y1 = Math.max(y0 + 1, Math.floor((gy + 1) * bh));
      let sum = 0, n = 0;
      for (let y = y0; y < y1 && y < srcH; y += 1) for (let x = x0; x < x1 && x < srcW; x += 1) {
        const i = (y * srcW + x) * 4;
        sum += (0.2126 * sd[i] + 0.7152 * sd[i + 1] + 0.0722 * sd[i + 2]) / 255;
        n++;
      }
      let v = n ? sum / n : 0;
      v = (v - 0.5) * S.contrast + 0.5 + S.bright;
      v = Math.min(1, Math.max(0, v));
      if (S.invert) v = 1 - v;
      h[gy * gw + gx] = v;
    }
  }
  for (let p = 0; p < S.smooth; p++) {
    const c = Float32Array.from(h);
    for (let y = 0; y < gh; y++) for (let x = 0; x < gw; x++) {
      let s = 0, k = 0;
      for (let oy = -1; oy <= 1; oy++) for (let ox = -1; ox <= 1; ox++) {
        const xx = x + ox, yy = y + oy;
        if (xx < 0 || yy < 0 || xx >= gw || yy >= gh) continue;
        s += c[yy * gw + xx]; k++;
      }
      h[y * gw + x] = s / k;
    }
  }
  hw = gw; hh = gh; heightMap = h;
  return { gw, gh };
}

function heatColor(t, out) {
  // blue -> cyan -> yellow -> red
  const r = Math.min(1, Math.max(0, 1.6 * t - 0.15 + 0.6 * Math.max(0, t - 0.6)));
  const g = Math.min(1, Math.max(0, 1.4 - Math.abs(t - 0.45) * 2.4));
  const b = Math.min(1, Math.max(0, 1.1 - t * 1.7));
  out[0] = r; out[1] = g; out[2] = b;
}

// ---------- builders ----------
function clearProto() {
  protoGroup.traverse((o) => { if (o.geometry) o.geometry.dispose(); });
  protoGroup.clear();
}

function stdMat(extra = {}) {
  return new THREE.MeshStandardMaterial({
    color: new THREE.Color(S.tint), metalness: S.metal, roughness: S.rough,
    wireframe: S.wire, flatShading: S.flat, ...extra,
  });
}

function finishMesh(mesh, photoTexture) {
  mesh.castShadow = true; mesh.receiveShadow = true;
  if (S.surface === 'photo' && photoTexture) { mesh.material.map = photoTexture; mesh.material.color.set('#ffffff'); mesh.material.needsUpdate = true; }
  if (S.surface === 'neon') { mesh.material.emissive = new THREE.Color(0x22d3ee); mesh.material.emissiveIntensity = 0.25; }
  return mesh;
}

function buildRelief() {
  const { gw, gh } = computeHeights(S.detail);
  const W = 4.4, H = W * (gh / gw);
  const geo = new THREE.PlaneGeometry(W, H, gw - 1, gh - 1);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const tmp = [0, 0, 0];
  const depthAmp = S.depth / 22 * 1.15;
  const tex = new THREE.CanvasTexture(srcCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  for (let i = 0; i < pos.count; i++) {
    const ix = i % gw, iy = Math.floor(i / gw);
    const v = heightMap[(gh - 1 - iy) * gw + ix]; // flip Y to match texture
    const cut = S.cutout && v < S.cut;
    const z = cut ? 0 : v * depthAmp;
    pos.setZ(i, z);
    if (S.surface === 'heat' || S.surface === 'neon') { heatColor(v, tmp); colors[i * 3] = tmp[0]; colors[i * 3 + 1] = tmp[1]; colors[i * 3 + 2] = tmp[2]; }
    else { colors[i * 3] = colors[i * 3 + 1] = colors[i * 3 + 2] = 1; }
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  const mat = stdMat({ vertexColors: S.surface === 'heat' || S.surface === 'neon', side: THREE.DoubleSide });
  const mesh = finishMesh(new THREE.Mesh(geo, mat), S.surface === 'photo' ? tex : null);
  mesh.position.y = 0.35;
  const g = new THREE.Group();
  g.add(mesh);
  if (S.base > 0.5) {
    const bt = S.base / 20 * 0.9;
    const back = new THREE.Mesh(new THREE.BoxGeometry(W + 0.18, H + 0.18, bt), stdMat({ color: new THREE.Color(S.tint).multiplyScalar(0.55) }));
    back.position.set(0, 0.35, -bt / 2 - 0.01);
    back.castShadow = back.receiveShadow = true;
    g.add(back);
  }
  // normalize so turntable fits pedestal
  g.position.y = 0.15;
  return { group: g, tris: geo.index.count / 3 };
}

function sampleColor(u, v) {
  const x = Math.min(srcW - 1, Math.max(0, Math.round(u * (srcW - 1))));
  const y = Math.min(srcH - 1, Math.max(0, Math.round(v * (srcH - 1))));
  const d = srcCanvas.getContext('2d').getImageData(x, y, 1, 1).data;
  return [d[0] / 255, d[1] / 255, d[2] / 255];
}

function buildVoxels() {
  const V = Math.max(16, Math.min(80, Math.round(S.detail * 0.36)));
  computeHeights(V);
  const W = 4.4, cell = W / V, H = cell * hh;
  const geo = new THREE.BoxGeometry(1, 1, 1);
  const mat = stdMat({ roughness: 0.55 });
  const items = [];
  const tmp = [0, 0, 0];
  for (let y = 0; y < hh; y++) for (let x = 0; x < V; x++) {
    const v = heightMap[(hh - 1 - y) * V + x];
    if (S.cutout && v < S.cut) continue;
    items.push([x, y, v]);
  }
  const inst = new THREE.InstancedMesh(geo, mat, Math.max(1, items.length));
  const m = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), pv = new THREE.Vector3();
  const col = new THREE.Color();
  const depthAmp = S.depth / 22 * 1.6;
  items.forEach(([x, y, v], i) => {
    const sz = 0.06 + v * depthAmp;
    pv.set((x - V / 2 + 0.5) * cell, (y - hh / 2 + 0.5) * cell + 0.35, sz / 2 - 0.2);
    sc.set(cell * 0.92, cell * 0.92, sz);
    m.compose(pv, q, sc);
    inst.setMatrixAt(i, m);
    if (S.surface === 'photo') { const [r, g2, b] = sampleColor(x / (V - 1), 1 - y / (hh - 1)); col.setRGB(r, g2, b); }
    else if (S.surface === 'clay') col.set(S.tint);
    else { heatColor(v, tmp); col.setRGB(tmp[0], tmp[1], tmp[2]); }
    inst.setColorAt(i, col);
  });
  inst.castShadow = inst.receiveShadow = true;
  const g = new THREE.Group(); g.add(inst);
  return { group: g, tris: items.length * 12 };
}

function buildPoints() {
  const D = Math.min(220, S.detail);
  computeHeights(D);
  const W = 4.6, H = W * (hh / hw);
  const n = hw * hh;
  const p = new Float32Array(n * 3), c = new Float32Array(n * 3);
  const depthAmp = S.depth / 22 * 1.5;
  const tmp = [0, 0, 0];
  let k = 0;
  for (let y = 0; y < hh; y++) for (let x = 0; x < hw; x++) {
    const v = heightMap[(hh - 1 - y) * hw + x];
    if (S.cutout && v < S.cut) continue;
    p[k * 3] = (x / (hw - 1) - 0.5) * W;
    p[k * 3 + 1] = (y / (hh - 1) - 0.5) * H + 0.35;
    p[k * 3 + 2] = v * depthAmp - 0.2;
    if (S.surface === 'photo') { const [r, g2, b] = sampleColor(x / (hw - 1), 1 - y / (hh - 1)); c[k * 3] = r; c[k * 3 + 1] = g2; c[k * 3 + 2] = b; }
    else if (S.surface === 'clay') { const col = new THREE.Color(S.tint); c[k * 3] = col.r; c[k * 3 + 1] = col.g; c[k * 3 + 2] = col.b; }
    else { heatColor(v, tmp); c[k * 3] = tmp[0]; c[k * 3 + 1] = tmp[1]; c[k * 3 + 2] = tmp[2]; }
    k++;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(p.slice(0, k * 3), 3));
  geo.setAttribute('color', new THREE.BufferAttribute(c.slice(0, k * 3), 3));
  const mat = new THREE.PointsMaterial({ size: 0.045, vertexColors: true, sizeAttenuation: true, transparent: true, opacity: 0.95 });
  const pts = new THREE.Points(geo, mat);
  const g = new THREE.Group(); g.add(pts);
  return { group: g, tris: 0 };
}

function buildCard() {
  computeHeights(Math.min(160, S.detail));
  const W = 4.4, H = W * (hh / hw);
  const thick = 0.35 + S.depth / 60 * 0.9;
  const tex = new THREE.CanvasTexture(srcCanvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const g = new THREE.Group();
  const body = new THREE.Mesh(new RoundedBoxGeometry(W + 0.3, H + 0.3, thick, 4, 0.12), stdMat({}));
  body.castShadow = body.receiveShadow = true;
  g.add(body);
  const face = new THREE.Mesh(new THREE.PlaneGeometry(W, H), stdMat({ map: S.surface === 'photo' ? tex : null, roughness: 0.4 }));
  if (S.surface !== 'photo') face.material.color.set(S.surface === 'clay' ? new THREE.Color(S.tint) : new THREE.Color(0x182134));
  face.position.z = thick / 2 + 0.005;
  g.add(face);
  // embossed mini-relief floating just above card
  const emb = new THREE.PlaneGeometry(W * 0.96, H * 0.96, hw - 1, hh - 1);
  const pp = emb.attributes.position;
  for (let i = 0; i < pp.count; i++) {
    const ix = i % hw, iy = Math.floor(i / hw);
    pp.setZ(i, heightMap[(hh - 1 - iy) * hw + ix] * 0.28);
  }
  emb.computeVertexNormals();
  const embMesh = new THREE.Mesh(emb, new THREE.MeshStandardMaterial({ transparent: true, opacity: 0.32, color: 0xffffff, roughness: 0.3, metalness: 0.1, depthWrite: false }));
  embMesh.position.z = thick / 2 + 0.02;
  g.add(embMesh);
  g.position.y = 0.35;
  return { group: g, tris: Math.round(W * H * 40) };
}

function rebuild() {
  const t0 = performance.now();
  try {
    clearProto();
    let r;
    if (S.mode === 'relief') r = buildRelief();
    else if (S.mode === 'voxels') r = buildVoxels();
    else if (S.mode === 'points') r = buildPoints();
    else r = buildCard();
    protoGroup.add(r.group);
    const dt = Math.round(performance.now() - t0);
    $('stTris').textContent = r.tris >= 1000 ? (r.tris / 1000).toFixed(1) + 'k' : String(Math.round(r.tris));
    $('stTime').textContent = dt + 'ms';
    const depthMm = Math.round(S.depth * 0.9 + S.base * 0.6);
    const hMm = Math.round(S.sizeMm * (srcH / srcW));
    $('stSize').textContent = `${S.sizeMm}×${hMm}×${depthMm}`;
    status(`Built ${S.mode} · ${$('stTris').textContent} tris · ${dt}ms · free & unlimited`);
  } catch (e) {
    console.error(e);
    status('Build failed: ' + e.message);
  }
}

function scheduleRebuild() {
  clearTimeout(rebuildTimer);
  rebuildTimer = setTimeout(rebuild, 60);
}

// ---------- stage ----------
function applyLightPreset() {
  const p = S.light;
  if (p === 'studio') { keyLight.color.set(0xffffff); keyLight.intensity = 2.2; fillLight.color.set(0x88aaff); fillLight.intensity = 0.7; rimLight.color.set(0xa78bfa); rimLight.intensity = 1.1; amb.intensity = 0.55; }
  if (p === 'sunset') { keyLight.color.set(0xffb36b); keyLight.intensity = 2.6; fillLight.color.set(0x4a5aff); fillLight.intensity = 0.5; rimLight.color.set(0xff5c8a); rimLight.intensity = 1.6; amb.intensity = 0.4; }
  if (p === 'night') { keyLight.color.set(0x67e8f9); keyLight.intensity = 1.4; fillLight.color.set(0x1e3a8a); fillLight.intensity = 0.9; rimLight.color.set(0xf0f); rimLight.intensity = 2.0; amb.intensity = 0.3; }
  if (p === 'claylight') { keyLight.color.set(0xffffff); keyLight.intensity = 2.8; fillLight.color.set(0xffffff); fillLight.intensity = 1.0; rimLight.color.set(0xffffff); rimLight.intensity = 0.8; amb.intensity = 0.7; }
}

function applyBg() {
  const [c] = [BG[S.bg][0]];
  scene.background = new THREE.Color(c);
  scene.fog.color.set(c);
  const darkText = S.bg === 'paper';
  ground.material.color.set(darkText ? 0xe3ded2 : 0x11141d);
  document.body.style.setProperty('--bg', S.bg === 'paper' ? '#e9e6dd' : '#0d0f13');
}

// ---------- export ----------
function download(url, name) { const a = document.createElement('a'); a.href = url; a.download = name; a.click(); setTimeout(() => URL.revokeObjectURL(url), 4000); }

function exportPNG() {
  renderer.render(scene, camera);
  download(renderer.domElement.toDataURL('image/png'), 'proto3d-render.png');
  status('PNG render saved.');
}

function exportSTL() {
  try {
    const ex = new STLExporter();
    const data = ex.parse(protoGroup, { binary: true });
    const blob = new Blob([data], { type: 'model/stl' });
    download(URL.createObjectURL(blob), 'proto3d-model.stl');
    status('STL saved — ready for slicing / 3D printing.');
  } catch (e) { status('STL export failed in this mode — try Relief.'); }
}

function exportGLB() {
  try {
    const ex = new GLTFExporter();
    ex.parse(protoGroup, (res) => {
      const blob = new Blob([res], { type: 'model/gltf-binary' });
      download(URL.createObjectURL(blob), 'proto3d-model.glb');
      status('GLB saved — Blender / AR / web ready.');
    }, (e) => status('GLB failed: ' + e), { binary: true });
  } catch (e) { status('GLB export failed.'); }
}

let recording = false;
function recordTurntable() {
  if (recording) return;
  const stream = renderer.domElement.captureStream(60);
  const rec = new MediaRecorder(stream, { mimeType: 'video/webm' });
  const chunks = [];
  rec.ondataavailable = (e) => chunks.push(e.data);
  rec.onstop = () => {
    download(URL.createObjectURL(new Blob(chunks, { type: 'video/webm' })), 'proto3d-360.webm');
    status('360° video saved.');
    recording = false;
    $('btnVideo').textContent = '🎥 360°';
  };
  recording = true;
  const wasSpin = S.spin; S.spin = true; $('inSpin').checked = true;
  $('btnVideo').textContent = '⏺ Recording…';
  status('Recording 6s turntable…');
  rec.start();
  setTimeout(() => { rec.stop(); S.spin = wasSpin; $('inSpin').checked = wasSpin; }, 6000);
}

// ---------- UI ----------
function bindUI() {
  const dz = $('dropZone'), fi = $('fileInput');
  dz.onclick = () => fi.click();
  fi.onchange = (e) => loadFile(e.target.files[0]);
  ['dragover', 'dragenter'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.add('over'); }));
  ['dragleave', 'drop'].forEach(ev => dz.addEventListener(ev, (e) => { e.preventDefault(); dz.classList.remove('over'); }));
  dz.addEventListener('drop', (e) => loadFile(e.dataTransfer.files[0]));
  addEventListener('paste', (e) => {
    const f = [...(e.clipboardData?.files || [])].find(f => f.type.startsWith('image/'));
    if (f) loadFile(f);
  });

  $('btnDemo').onclick = () => makeDemo(['peaks', 'logo', 'portrait', 'circuit'][Math.floor(Math.random() * 4)]);
  document.querySelectorAll('.sample').forEach(b => b.onclick = () => makeDemo(b.dataset.sample));
  $('btnUrl').onclick = () => { const u = $('urlInput').value.trim(); if (u) loadURL(u); };
  $('btnCam').onclick = async () => {
    try {
      const v = $('camVideo');
      const st = await navigator.mediaDevices.getUserMedia({ video: true });
      v.srcObject = st; await v.play();
      const c = canvasOf(v.videoWidth || 640, v.videoHeight || 480);
      c.getContext('2d').drawImage(v, 0, 0);
      st.getTracks().forEach(t => t.stop());
      setSource(c, 'webcam.png');
    } catch { status('Webcam blocked by browser.'); }
  };

  document.querySelectorAll('.mode').forEach(b => b.onclick = () => {
    document.querySelectorAll('.mode').forEach(x => x.classList.remove('active'));
    b.classList.add('active'); S.mode = b.dataset.mode; scheduleRebuild();
  });

  const num = (id, key, fmt, after) => {
    $(id).oninput = (e) => { S[key] = parseFloat(e.target.value); $(id.replace('in', 'v')).textContent = fmt ? fmt(S[key]) : S[key]; if (after) after(); else scheduleRebuild(); };
  };
  num('inDetail', 'detail'); num('inDepth', 'depth'); num('inSmooth', 'smooth');
  num('inContrast', 'contrast', (v) => v.toFixed(2)); num('inBright', 'bright', (v) => v.toFixed(2));
  num('inCut', 'cut', (v) => v.toFixed(2)); num('inBase', 'base'); num('inSize', 'sizeMm');

  $('inInvert').onchange = (e) => { S.invert = e.target.checked; scheduleRebuild(); };
  $('inCutout').onchange = (e) => { S.cutout = e.target.checked; scheduleRebuild(); };
  $('inSurface').onchange = (e) => { S.surface = e.target.value; scheduleRebuild(); };
  $('inTint').oninput = (e) => { S.tint = e.target.value; scheduleRebuild(); };
  $('inMetal').oninput = (e) => { S.metal = parseFloat(e.target.value); scheduleRebuild(); };
  $('inRough').oninput = (e) => { S.rough = parseFloat(e.target.value); scheduleRebuild(); };
  $('inWire').onchange = (e) => { S.wire = e.target.checked; scheduleRebuild(); };
  $('inFlat').onchange = (e) => { S.flat = e.target.checked; scheduleRebuild(); };

  $('inSpin').onchange = (e) => S.spin = e.target.checked;
  $('inGrid').onchange = (e) => { S.grid = e.target.checked; gridHelper.visible = S.grid; };
  $('inPed').onchange = (e) => { S.pedestal = e.target.checked; pedestal.visible = S.pedestal; };
  $('inLight').onchange = (e) => { S.light = e.target.value; applyLightPreset(); };
  $('inBg').onchange = (e) => { S.bg = e.target.value; applyBg(); };

  $('btnFront').onclick = () => { protoGroup.rotation.y = 0; camera.position.set(0, 0.6, 8.8); controls.target.set(0, 0.4, 0); };
  $('btnTop').onclick = () => { protoGroup.rotation.y = 0; camera.position.set(0, 8.2, 0.6); controls.target.set(0, 0, 0); };
  $('btnSide').onclick = () => { protoGroup.rotation.y = -0.45; camera.position.set(4.8, 3.1, 6.8); controls.target.set(0, 0.4, 0); };

  $('btnSnapshot').onclick = exportPNG;
  $('btnSTL').onclick = exportSTL;
  $('btnGLB').onclick = exportGLB;
  $('btnVideo').onclick = recordTurntable;
}
