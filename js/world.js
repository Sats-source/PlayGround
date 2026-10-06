// world.js — palette, canvas textures, lights/sky, palace chunk builders,
// gameplay population (obstacles/coins/power-ups), instanced pools, particles.
//
// PERF MODEL: per chunk, every STATIC same-material part (beams, tiers,
// statues, trees, slabs, beads, even obstacle bodies) is merged into ONE mesh
// per material via StaticBatcher (baked at spawn). Per-chunk draws ≈ 22-30:
// ~10 baked mats + floor + 2 jali + 1 merged rays + ~5 banners + water/glows.
// 5 live chunks ≈ 130-150 + player(~18) + sky/particles(~10) + instanced(4).
// Chunks are built in LOCAL space (entry at origin, path extends toward -Z,
// lanes at x = -laneW, 0, +laneW) then placed/rotated into the world.
import * as THREE from 'three';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';

// ---------- tiny instanced-pool helper ----------
class IPool {
  constructor(mesh, cap) { this.mesh = mesh; this.cap = cap; this.next = 0; this.allocs = new Map(); }
  alloc(chunk, mats4) {
    const start = this.next;
    for (let i = 0; i < mats4.length; i++) {
      if (this.next >= this.cap) this.next = 0; // wrap: oldest were culled first
      this.mesh.setMatrixAt(this.next, mats4[i]);
      this.next++;
    }
    this.mesh.instanceMatrix.needsUpdate = true;
    if (!this.allocs.has(chunk)) this.allocs.set(chunk, []);
    this.allocs.get(chunk).push({ start, n: mats4.length });
  }
  free(chunk) {
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    const list = this.allocs.get(chunk);
    if (!list) return;
    for (const { start, n } of list)
      for (let i = 0; i < n; i++) this.mesh.setMatrixAt((start + i) % this.cap, zero);
    this.mesh.instanceMatrix.needsUpdate = true;
    this.allocs.delete(chunk);
  }
}

const V3 = (x, y, z) => new THREE.Vector3(x, y, z);
const _e = new THREE.Euler();
function M4(px, py, pz, ry = 0, sx = 1, sy = 1, sz = 1, rx = 0, rz = 0) {
  _e.set(rx, ry, rz);
  return new THREE.Matrix4().compose(V3(px, py, pz),
    new THREE.Quaternion().setFromEuler(_e), V3(sx, sy, sz));
}
function mat4(px, py, pz, ry = 0, sc = 1) {
  return new THREE.Matrix4().compose(V3(px, py, pz),
    new THREE.Quaternion().setFromAxisAngle(V3(0, 1, 0), ry), V3(sc, sc, sc));
}

export class World {
  constructor(scene, cfg) {
    this.scene = scene; this.cfg = cfg;
    this.chunks = []; this.cursor = V3(0, 0, 0); this.yaw = 0;
    this.chunkSeq = 0; this.diyas = [];
    this.time = 0;
  }

  // ================= TEXTURES =================
  _canvas(w, h, fn) {
    const c = document.createElement('canvas'); c.width = w; c.height = h;
    fn(c.getContext('2d'), w, h);
    const t = new THREE.CanvasTexture(c);
    t.wrapS = t.wrapT = THREE.RepeatWrapping; t.colorSpace = THREE.SRGBColorSpace;
    return t;
  }
  _makeTextures() {
    this.texSand = this._canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#c99a62'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 2600; i++) {
        g.fillStyle = `rgba(${120 + Math.random() * 80 | 0},${80 + Math.random() * 50 | 0},${40 + Math.random() * 30 | 0},${Math.random() * 0.16})`;
        g.fillRect(Math.random() * w, Math.random() * h, 2 + Math.random() * 5, 1 + Math.random() * 3);
      }
      g.strokeStyle = 'rgba(90,55,25,0.35)';
      for (let y = 0; y < h; y += 42) { g.beginPath(); g.moveTo(0, y); g.lineTo(w, y); g.stroke(); }
    });
    this.texGranite = this._canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#3d3a4a'; g.fillRect(0, 0, w, h);
      for (let i = 0; i < 3200; i++) {
        g.fillStyle = Math.random() < .5 ? 'rgba(0,0,0,0.25)' : 'rgba(200,190,220,0.10)';
        g.fillRect(Math.random() * w, Math.random() * h, 2, 2);
      }
    });
    this.texFloor = this._canvas(256, 256, (g, w, h) => {
      g.fillStyle = '#211d2b'; g.fillRect(0, 0, w, h);
      g.strokeStyle = 'rgba(190,150,90,0.30)'; g.lineWidth = 2;
      for (let i = 0; i <= 4; i++) { g.strokeRect(i * 64 + 2, 2, 60, h - 4); }
      for (let i = 0; i < 1500; i++) {
        g.fillStyle = `rgba(220,190,140,${Math.random() * 0.06})`;
        g.fillRect(Math.random() * w, Math.random() * h, 3, 2);
      }
    });
    this.texJali = this._canvas(128, 128, (g, w, h) => {
      g.fillStyle = '#2a1c22'; g.fillRect(0, 0, w, h);
      g.fillStyle = '#ffb46a';
      for (let y = 8; y < h; y += 24) for (let x = 8; x < w; x += 24) {
        g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
      }
      g.fillStyle = '#2a1c22';
      for (let y = 8; y < h; y += 24) for (let x = 8; x < w; x += 24) {
        g.beginPath(); g.arc(x, y, 3, 0, 7); g.fill();
      }
    });
    this.texBanner = this._canvas(64, 128, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, w, 0);
      gr.addColorStop(0, '#8a1f14'); gr.addColorStop(.5, '#c73e1d'); gr.addColorStop(1, '#8a1f14');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      g.fillStyle = '#e8b64c';
      for (let y = 10; y < h; y += 26) g.fillRect(6, y, w - 12, 4);
      g.beginPath(); g.arc(w / 2, 26, 10, 0, 7); g.fill();
    });
    this.texGlow = this._canvas(64, 64, (g, w, h) => {
      const gr = g.createRadialGradient(32, 32, 2, 32, 32, 30);
      gr.addColorStop(0, 'rgba(255,220,150,1)'); gr.addColorStop(.4, 'rgba(255,160,60,0.5)'); gr.addColorStop(1, 'rgba(255,140,40,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
    });
    this.texRay = this._canvas(64, 256, (g, w, h) => {
      const gr = g.createLinearGradient(0, 0, 0, h);
      gr.addColorStop(0, 'rgba(255,200,120,0.55)'); gr.addColorStop(1, 'rgba(255,200,120,0)');
      g.fillStyle = gr; g.fillRect(0, 0, w, h);
      const side = g.createLinearGradient(0, 0, w, 0);
      side.addColorStop(0, 'rgba(0,0,0,1)'); side.addColorStop(.3, 'rgba(0,0,0,0)');
      side.addColorStop(.7, 'rgba(0,0,0,0)'); side.addColorStop(1, 'rgba(0,0,0,1)');
      g.globalCompositeOperation = 'destination-out'; g.fillStyle = side; g.fillRect(0, 0, w, h);
    });
    this.texPetal = this._canvas(32, 32, (g) => {
      g.fillStyle = '#ff7a4d'; g.beginPath(); g.ellipse(16, 16, 10, 6, 0.6, 0, 7); g.fill();
      g.fillStyle = '#ffb27a'; g.beginPath(); g.ellipse(14, 14, 5, 3, 0.6, 0, 7); g.fill();
    });
  }

  // ================= MATERIALS + SHARED GEOS =================
  _makeMaterials() {
    const C = this.cfg;
    const std = (o) => new THREE.MeshStandardMaterial(o);
    this.M = {
      sand: std({ map: this.texSand, color: 0xd8ab72, roughness: 0.93 }),
      sandDark: std({ map: this.texSand, color: 0x9a6f42, roughness: 0.95 }),
      granite: std({ map: this.texGranite, color: 0x8f8aa0, roughness: 0.85 }),
      floor: std({ map: this.texFloor, color: 0xc4b8d4, roughness: 0.38, metalness: 0.4 }),
      oxide: std({ color: C.oxideRed, roughness: 0.9 }),
      gold: std({ color: C.gold, roughness: 0.3, metalness: 0.85, emissive: 0x6b4a00, emissiveIntensity: 0.35 }),
      wood: std({ color: 0x4a2c17, roughness: 0.9 }),
      leaf: std({ color: 0x2e7d4f, roughness: 0.9 }),
      leafDark: std({ color: 0x1d5233, roughness: 0.95 }),
      trunk: std({ color: 0x5a4128, roughness: 1 }),
      cloth: std({ map: this.texBanner, roughness: 0.85, side: THREE.DoubleSide }),
      marigold: std({ color: 0xff8a1f, roughness: 0.8, emissive: 0x662200, emissiveIntensity: 0.4 }),
      jali: std({ map: this.texJali, color: 0xffc98a, emissive: 0xff9a3c, emissiveMap: this.texJali, emissiveIntensity: 0.9, roughness: 0.8 }),
      water: new THREE.MeshStandardMaterial({ color: 0x1a2a4a, roughness: 0.08, metalness: 0.7, transparent: true, opacity: 0.92 }),
      obsWood: std({ color: 0x6b4423, roughness: 0.9 }),
      obsStone: std({ map: this.texGranite, color: 0x9a93ad, roughness: 0.9 }),
      bellMetal: std({ color: 0xb08d3e, roughness: 0.35, metalness: 0.9, emissive: 0x442200, emissiveIntensity: 0.3 }),
      ray: new THREE.MeshBasicMaterial({ map: this.texRay, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, fog: false }),
      glow: new THREE.MeshBasicMaterial({ map: this.texGlow, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false, fog: false }),
      warn: new THREE.MeshBasicMaterial({ color: 0xffd27a }),
    };
    // unit geos for the static batcher (scaled per part via matrix)
    this.G = {
      box: new THREE.BoxGeometry(1, 1, 1),
      cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 10),
      taper: new THREE.CylinderGeometry(0.32, 0.5, 1, 9),
      sph: new THREE.SphereGeometry(0.5, 10, 8),
      cone: new THREE.ConeGeometry(0.5, 1, 8),
      torus: new THREE.TorusGeometry(0.5, 0.09, 6, 14),
      rib: new THREE.TorusGeometry(5.2, 0.28, 6, 14, Math.PI), // bridge arch (own proportions)
      plane: new THREE.PlaneGeometry(1, 1),
    };
    // merged column geometry (base+shaft+capital+rings) for the instanced pool
    const parts = [];
    const put = (geo, x, y, z, ry = 0, sx = 1, sy = 1, sz = 1) => {
      geo.applyMatrix4(M4(x, y, z, ry, sx, sy, sz)); parts.push(geo);
    };
    put(new THREE.BoxGeometry(1.35, 0.5, 1.35), 0, 0.25, 0);
    put(new THREE.CylinderGeometry(0.34, 0.42, 4.4, 10), 0, 2.9, 0);
    put(new THREE.CylinderGeometry(0.3, 0.62, 0.35, 10), 0, 5.0, 0);
    put(new THREE.CylinderGeometry(0.62, 0.34, 0.55, 10), 0, 5.35, 0);
    put(new THREE.BoxGeometry(1.05, 0.3, 1.05), 0, 5.75, 0);
    put(new THREE.TorusGeometry(0.42, 0.07, 6, 12).rotateX(Math.PI / 2), 0, 1.6, 0);
    put(new THREE.TorusGeometry(0.42, 0.07, 6, 12).rotateX(Math.PI / 2), 0, 4.2, 0);
    this.geoColumn = mergeGeometries(parts, false);
    this.geoPost = new THREE.BoxGeometry(0.28, 1.05, 0.28);
    this.geoBowl = new THREE.CylinderGeometry(0.16, 0.1, 0.12, 8);
    this.geoCoin = new THREE.CylinderGeometry(0.42, 0.42, 0.1, 14);
    this.geoCoin.rotateX(Math.PI / 2);
  }
  // StaticBatcher: B(chunk,'box',mat, x,y,z, {ry,sx,sy,sz,...}) then bake(chunk)
  B(chunk, geoKey, mat, x, y, z, o = {}) {
    const b = chunk.batch;
    if (!b.has(mat)) b.set(mat, []);
    const g = this.G[geoKey].clone();
    g.applyMatrix4(M4(x, y, z, o.ry || 0, o.sx ?? 1, o.sy ?? 1, o.sz ?? 1, o.rx || 0, o.rz || 0));
    b.get(mat).push(g);
  }
  bake(chunk) {
    for (const [mat, geos] of chunk.batch) {
      if (!geos.length) continue;
      const merged = mergeGeometries(geos, false);
      const m = new THREE.Mesh(merged, mat);
      const transparent = mat.transparent;
      m.castShadow = !transparent; m.receiveShadow = !transparent;
      chunk.group.add(m);
      for (const g of geos) g.dispose();
    }
    chunk.batch.clear();
  }

  // ================= LIGHTS + SKY =================
  _makeLights() {
    const C = this.cfg, S = this.scene;
    S.fog = new THREE.FogExp2(C.fogColor, C.fogDensity);
    this.sun = new THREE.DirectionalLight(C.sunColor, C.sunIntensity);
    this.sun.position.set(-28, 22, 12);
    this.sun.castShadow = true;
    this.sun.shadow.mapSize.set(C.shadowMap, C.shadowMap);
    const r = C.shadowRange;
    Object.assign(this.sun.shadow.camera, { left: -r, right: r, top: r, bottom: -r, near: 1, far: 120 });
    this.sun.shadow.bias = -0.002;
    S.add(this.sun, this.sun.target);
    S.add(new THREE.HemisphereLight(C.hemiSky, C.hemiGround, C.hemiIntensity));
    S.add(new THREE.AmbientLight(0xff9a50, 0.35)); // golden bounce off stone
    this.lampLights = [];
    for (let i = 0; i < 4; i++) {
      const L = new THREE.PointLight(C.lampColor, C.lampIntensity, C.lampDist, 1.8);
      S.add(L); this.lampLights.push(L);
    }
  }
  _makeSky() {
    const S = this.scene;
    const skyMat = new THREE.ShaderMaterial({
      side: THREE.BackSide, depthWrite: false, fog: false,
      uniforms: { sunDir: { value: V3(-0.55, 0.18, 0.25).normalize() } },
      vertexShader: `varying vec3 vD; void main(){ vD=normalize(position);
        gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.0);}`,
      fragmentShader: `varying vec3 vD; uniform vec3 sunDir;
        void main(){
          float h = clamp(vD.y, -0.1, 1.0);
          vec3 horizon = vec3(1.0, 0.45, 0.18);
          vec3 mid     = vec3(0.45, 0.22, 0.42);
          vec3 zenith  = vec3(0.10, 0.10, 0.26);
          vec3 col = mix(horizon, mid, smoothstep(0.0, 0.28, h));
          col = mix(col, zenith, smoothstep(0.25, 0.85, h));
          float s = max(dot(normalize(vD), sunDir), 0.0);
          col += vec3(1.0, 0.55, 0.25) * pow(s, 24.0) * 1.2;
          col += vec3(1.0, 0.62, 0.30) * pow(s, 5.0) * 0.35;
          float band = smoothstep(0.12, 0.2, h) * (1.0 - smoothstep(0.28, 0.5, h));
          float cl = sin(atan(vD.z, vD.x) * 7.0 + 1.0) * sin(atan(vD.z, vD.x) * 13.0);
          col = mix(col, vec3(0.23, 0.16, 0.30), band * (0.35 + 0.25 * cl));
          gl_FragColor = vec4(col, 1.0);
        }`,
    });
    this.skyDome = new THREE.Mesh(new THREE.SphereGeometry(760, 24, 16), skyMat);
    S.add(this.skyDome);
    // distant silhouette temples: ONE merged mesh (1 draw), ring follows player
    const geos = [];
    for (let i = 0; i < 14; i++) {
      const a = (i / 14) * Math.PI * 2;
      const cx = Math.cos(a) * 620, cz = Math.sin(a) * 620;
      let y = -8, w = 26 + ((i * 37) % 20);
      const tiers = 3 + (i % 3);
      for (let k = 0; k < tiers; k++) {
        geos.push(new THREE.BoxGeometry(w, 12, w).applyMatrix4(M4(cx, y + 6, cz, -a)));
        y += 12; w *= 0.78;
      }
      geos.push(new THREE.ConeGeometry(3, 14, 6).applyMatrix4(M4(cx, y + 7, cz)));
    }
    this.farTemples = new THREE.Group();
    this.farTemples.add(new THREE.Mesh(mergeGeometries(geos, false),
      new THREE.MeshBasicMaterial({ color: 0x2c1c3e, fog: false })));
    for (const g of geos) g.dispose();
    S.add(this.farTemples);
    const moon = new THREE.Mesh(new THREE.CircleGeometry(22, 24),
      new THREE.MeshBasicMaterial({ color: 0xf5e8d0, fog: false, transparent: true, opacity: 0.9 }));
    moon.position.set(300, 330, -560); moon.lookAt(0, 0, 0); S.add(moon);
  }

  init() {
    this._makeTextures(); this._makeMaterials(); this._makeLights(); this._makeSky();
    const S = this.scene;
    const mk = (geo, mat, cap, shadow = false) => {
      const m = new THREE.InstancedMesh(geo, mat, cap);
      m.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
      m.frustumCulled = false; m.castShadow = shadow;
      const zero = new THREE.Matrix4().makeScale(0, 0, 0);
      for (let i = 0; i < cap; i++) m.setMatrixAt(i, zero);
      S.add(m); return m;
    };
    this.poolCol = new IPool(mk(this.geoColumn, this.M.sand, 240, true), 240);
    this.poolPost = new IPool(mk(this.geoPost, this.M.sandDark, 420), 420);
    this.poolBowl = new IPool(mk(this.geoBowl, this.M.oxide, 130), 130);
    this.coinMesh = mk(this.geoCoin,
      new THREE.MeshStandardMaterial({ color: 0xffc861, metalness: 0.9, roughness: 0.25, emissive: 0x7a4a00, emissiveIntensity: 0.6 }), 420);
    this.poolCoin = new IPool(this.coinMesh, 420);
    this._makeFlames();
    this._makeParticles();
  }

  // ---------- flames: single Points cloud ----------
  _makeFlames() {
    const N = 130;
    this.flamePos = new Float32Array(N * 3);
    this.flameSeed = new Float32Array(N);
    for (let i = 0; i < N; i++) { this.flamePos[i * 3 + 1] = -100; this.flameSeed[i] = Math.random() * 10; }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.flamePos, 3));
    this.flameMat = new THREE.PointsMaterial({
      map: this.texGlow, size: 0.85, transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, color: 0xffb050, sizeAttenuation: true,
    });
    this.flames = new THREE.Points(g, this.flameMat);
    this.flames.frustumCulled = false;
    this.scene.add(this.flames);
    this.flameFree = [...Array(N).keys()];
    this.flameOfChunk = new Map();
  }
  _allocFlames(chunk, worldPts) {
    const idx = [];
    for (const p of worldPts) {
      if (!this.flameFree.length) break;
      const i = this.flameFree.pop();
      this.flamePos[i * 3] = p.x; this.flamePos[i * 3 + 1] = p.y; this.flamePos[i * 3 + 2] = p.z;
      idx.push(i);
    }
    this.flameOfChunk.set(chunk, idx);
    this.flames.geometry.attributes.position.needsUpdate = true;
  }
  _freeFlames(chunk) {
    const idx = this.flameOfChunk.get(chunk) || [];
    for (const i of idx) { this.flamePos[i * 3 + 1] = -100; this.flameFree.push(i); }
    this.flameOfChunk.delete(chunk);
    this.flames.geometry.attributes.position.needsUpdate = true;
  }

  // ================= PARTICLES (pooled Points) =================
  _makePoints(n, map, size, color, opacity, additive = true) {
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) pos[i * 3 + 1] = -100;
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({
      map, size, transparent: true, opacity, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      color, sizeAttenuation: true,
    });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false; this.scene.add(p);
    return { pts: p, pos, n, head: 0 };
  }
  _makeParticles() {
    const C = this.cfg;
    this.dust = this._makePoints(C.dustCount, this.texGlow, 0.32, 0xffd9a0, 0.5);
    this.dustVel = new Float32Array(C.dustCount * 3);
    for (let i = 0; i < C.dustCount; i++) {
      this.dust.pos[i * 3] = (Math.random() - .5) * 60;
      this.dust.pos[i * 3 + 1] = Math.random() * 7;
      this.dust.pos[i * 3 + 2] = (Math.random() - .5) * 60;
      this.dustVel[i * 3] = 0.2 + Math.random() * 0.4;
      this.dustVel[i * 3 + 1] = 0.05 + Math.random() * 0.15;
      this.dustVel[i * 3 + 2] = 0.1 * (Math.random() - .5);
    }
    this.spark = this._makePoints(C.sparkCount, this.texGlow, 0.5, 0xffd27a, 0.95);
    this.sparkLife = new Float32Array(C.sparkCount);
    this.sparkVel = new Float32Array(C.sparkCount * 3);
    this.puff = this._makePoints(C.puffCount, this.texGlow, 1.1, 0xcbb59a, 0.4, false);
    this.puffLife = new Float32Array(C.puffCount);
    this.puffVel = new Float32Array(C.puffCount * 3);
    this.flies = this._makePoints(60, this.texGlow, 0.3, 0xaaff88, 0.9);
    this.flySeed = new Float32Array(60); for (let i = 0; i < 60; i++) this.flySeed[i] = Math.random() * 10;
    this.petals = this._makePoints(90, this.texPetal, 0.35, 0xffffff, 0.95, false);
    this.petalVel = new Float32Array(90 * 3);
    for (let i = 0; i < 90; i++) {
      this.petals.pos[i * 3] = (Math.random() - .5) * 70;
      this.petals.pos[i * 3 + 1] = Math.random() * 8;
      this.petals.pos[i * 3 + 2] = (Math.random() - .5) * 70;
      this.petalVel[i * 3] = 1 + Math.random() * 2;
    }
    this.rain = this._makePoints(900, null, 0.12, 0x9ab8dd, 0.5, false);
    this.rain.pts.visible = !!C.rain;
    for (let i = 0; i < 900; i++) {
      this.rain.pos[i * 3] = (Math.random() - .5) * 50;
      this.rain.pos[i * 3 + 1] = Math.random() * 15;
      this.rain.pos[i * 3 + 2] = (Math.random() - .5) * 50;
    }
    if (C.rain) { this.M.floor.roughness = 0.12; this.M.floor.metalness = 0.75; this.M.floor.color.set(0x8f86a8); }
  }
  burst(p, vel, life, n) {
    for (let k = 0; k < n; k++) {
      const i = this.spark.head; this.spark.head = (this.spark.head + 1) % this.spark.n;
      this.spark.pos[i * 3] = p.x; this.spark.pos[i * 3 + 1] = p.y; this.spark.pos[i * 3 + 2] = p.z;
      const a = Math.random() * Math.PI * 2, up = 2 + Math.random() * 4;
      this.sparkVel[i * 3] = Math.cos(a) * vel; this.sparkVel[i * 3 + 1] = up; this.sparkVel[i * 3 + 2] = Math.sin(a) * vel;
      this.sparkLife[i] = life * (0.6 + Math.random() * 0.4);
    }
  }
  puffAt(p, n = 6, spread = 1.6) {
    for (let k = 0; k < n; k++) {
      const i = this.puff.head; this.puff.head = (this.puff.head + 1) % this.puff.n;
      this.puff.pos[i * 3] = p.x + (Math.random() - .5); this.puff.pos[i * 3 + 1] = p.y + 0.15; this.puff.pos[i * 3 + 2] = p.z + (Math.random() - .5);
      this.puffVel[i * 3] = (Math.random() - .5) * spread; this.puffVel[i * 3 + 1] = 0.8 + Math.random(); this.puffVel[i * 3 + 2] = (Math.random() - .5) * spread;
      this.puffLife[i] = 0.7 + Math.random() * 0.4;
    }
  }

  // ================= ARCHITECTURE (all static -> batcher) =================
  _floor(chunk, w, len, y = 0) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, 0.6, len + 1), this.M.floor);
    m.position.set(0, y - 0.3, -len / 2); m.receiveShadow = true; chunk.group.add(m);
    for (const x of [-1.15, 1.15])
      this.B(chunk, 'box', this.M.gold, x, y + 0.015, -len / 2, { sy: 0.02, sx: 0.12, sz: len });
  }
  _colonnade(chunk, len, xOff, diyaPts, step = 6) {
    const M = this.M;
    const mats = [];
    for (let d = 3; d < len - 1; d += step)
      for (const s of [-1, 1]) mats.push(mat4(s * xOff, 0, -d));
    chunk._colMats = (chunk._colMats || []).concat(mats);
    for (let d = 6; d < len; d += 12) {
      this.B(chunk, 'box', M.sandDark, 0, 6.1, -d, { sx: xOff * 2 + 2.2, sy: 0.7, sz: 1.1 });
      if (Math.random() < 0.7) { // keep the run-line clear: banners hang off-centre
        const bx = (1.6 + Math.random() * 1.8) * (Math.random() < 0.5 ? -1 : 1);
        this._banner(chunk, bx, 5.7, -d);
      }
    }
    for (const s of [-1, 1]) {
      // jali screen wall (kept separate: emissive glow source)
      const wall = new THREE.Mesh(new THREE.BoxGeometry(0.3, 3.2, len), M.jali);
      wall.position.set(s * (xOff + 1.15), 2.2, -len / 2); chunk.group.add(wall);
      this.B(chunk, 'box', M.sandDark, s * (xOff + 1.15), 4.0, -len / 2, { sx: 0.6, sy: 0.35, sz: len });
      for (let d = 5; d < len; d += 11) // god-ray shafts -> merged into 1 draw
        this.B(chunk, 'plane', M.ray, s * (xOff - 1.2), 3.0, -d, { ry: s * 0.85, rx: 0.25, rz: s * 0.35, sx: 2.6, sy: 9 });
      for (let d = 4; d < len; d += 9) diyaPts.push(V3(s * (xOff + 1.15), 4.35, -d));
    }
  }
  _railing(chunk, len, xOff) {
    const mats = [];
    for (let d = 1; d < len; d += 2.2) for (const s of [-1, 1]) mats.push(mat4(s * xOff, 0.55, -d));
    chunk._postMats = (chunk._postMats || []).concat(mats);
    for (const s of [-1, 1])
      this.B(chunk, 'box', this.M.sandDark, s * xOff, 1.12, -len / 2, { sx: 0.16, sy: 0.12, sz: len });
  }
  _banner(chunk, x, y, z) {
    const b = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 2.6, 1, 4), this.M.cloth);
    b.position.set(x, y - 1.3, z); chunk.group.add(b);
    chunk.banners.push({ m: b, phase: Math.random() * 9 });
    this.B(chunk, 'sph', this.M.gold, x, y + 0.05, z, { sx: 0.18, sy: 0.18, sz: 0.18 });
  }
  _marigold(chunk, x, y, z) {
    const grp = new THREE.Group(); // garland sways as one
    grp.position.set(x, y, z); chunk.group.add(grp);
    chunk._garlands.push({ x, y, z, phase: Math.random() * 9, grp });
    for (let i = 0; i <= 10; i++) { // baked into chunk's marigold mesh, animated via group? no—
      const t = i / 10;
      this.B(chunk, 'sph', this.M.marigold, x + (t - .5) * 3.4, y + Math.sin(t * Math.PI) * -0.5, z, { sx: 0.18, sy: 0.18, sz: 0.18 });
    }
  }
  _gopuram(chunk, x, z, s = 1, ry = 0) { // tiered gateway tower; parts rotated into place
    const M = this.M;
    const cs = Math.cos(ry), sn = Math.sin(ry);
    const L = (lx, y, lz) => [x + lx * cs + lz * sn, y, z - lx * sn + lz * cs];
    let y = 0, w = 5.2 * s;
    for (let i = 0; i < 4; i++) {
      const h = 1.7 * s, mat = i % 2 ? M.oxide : M.sand;
      let [wx, wy, wz] = L(0, y + h / 2, 0);
      this.B(chunk, 'box', mat, wx, wy, wz, { ry, sx: w, sy: h, sz: w * 0.7 });
      for (let k = -2; k <= 2; k++) {
        const [bx, by, bz] = L(k * w * 0.18, y + h * 0.55, w * 0.36);
        this.B(chunk, 'sph', M.gold, bx, by, bz, { sx: 0.32 * s, sy: 0.32 * s, sz: 0.32 * s });
      }
      y += h; w *= 0.8;
    }
    let [fx, fy, fz] = L(0, y + 0.8 * s, 0);
    this.B(chunk, 'cone', M.gold, fx, fy, fz, { ry, sx: s, sy: 1.6 * s, sz: s });
    for (const sd of [-1, 1]) { // yali guardians
      let [yx, yy, yz] = L(sd * 3.4 * s, 0.8 * s, 0.6);
      this.B(chunk, 'box', M.granite, yx, yy, yz, { ry, sx: 0.8 * s, sy: 1.6 * s, sz: 0.8 * s });
      [yx, yy, yz] = L(sd * 3.4 * s, 1.9 * s, 0.6);
      this.B(chunk, 'sph', M.granite, yx, yy, yz, { sx: 0.84 * s, sy: 0.84 * s, sz: 0.84 * s });
    }
  }
  _vimana(chunk, x, z, s = 1) {
    const M = this.M;
    this.B(chunk, 'box', M.granite, x, 1.2 * s, z, { sx: 4 * s, sy: 2.4 * s, sz: 4 * s });
    let y = 2.4 * s, w = 3.6 * s;
    for (let i = 0; i < 3; i++) {
      this.B(chunk, 'box', M.sand, x, y + 0.45 * s, z, { sx: w, sy: 0.9 * s, sz: w });
      y += 0.9 * s; w *= 0.82;
    }
    this.B(chunk, 'sph', M.gold, x, y + 0.5 * s, z, { sx: 0.8 * s, sy: 0.8 * s, sz: 0.8 * s });
    const glow = new THREE.Mesh(new THREE.PlaneGeometry(2.4, 2.4), M.glow);
    glow.position.set(x, y + 0.5 * s, z + 0.2); chunk.group.add(glow);
  }
  _tree(chunk, x, z, s = 1) {
    const M = this.M;
    this.B(chunk, 'cyl', M.trunk, x, 1.7 * s, z, { sx: 1.1 * s, sy: 3.4 * s, sz: 1.1 * s });
    for (let i = 0; i < 3; i++) {
      const a = i * 2.1 + x;
      this.B(chunk, 'taper', M.trunk, x + Math.cos(a) * 0.7 * s, 1.2 * s, z + Math.sin(a) * 0.7 * s,
        { rz: Math.cos(a) * 0.35, rx: -Math.sin(a) * 0.35, sx: 0.3 * s, sy: 2.6 * s, sz: 0.3 * s });
    }
    const n = 4;
    for (let i = 0; i < n; i++) {
      const r = (1.2 + ((i * 53) % 10) / 12) * s;
      this.B(chunk, 'sph', i % 2 ? M.leaf : M.leafDark,
        x + Math.sin(i * 2.4 + x) * 1.2 * s, (3.6 + (i % 3) * 0.7) * s, z + Math.cos(i * 1.9 + z) * 1.2 * s,
        { sx: r * 2, sy: r * 1.6, sz: r * 2 });
    }
  }
  _palm(chunk, x, z, s = 1) {
    const M = this.M;
    this.B(chunk, 'taper', M.trunk, x, 2.75 * s, z, { sx: 0.55 * s, sy: 5.5 * s, sz: 0.55 * s });
    for (let i = 0; i < 6; i++) {
      const a = (i / 6) * Math.PI * 2;
      this.B(chunk, 'cone', M.leaf, x + Math.cos(a) * 1.1 * s, 5.5 * s, z + Math.sin(a) * 1.1 * s,
        { rx: Math.sin(a) * 1.2, rz: -Math.cos(a) * 1.2, sx: 0.7 * s, sy: 2.6 * s, sz: 0.7 * s });
    }
  }
  _statue(chunk, x, z) { // dvarapala guardian
    const M = this.M;
    this.B(chunk, 'box', M.granite, x, 0.3, z, { sx: 1.7, sy: 0.6, sz: 1.7 });
    this.B(chunk, 'cyl', M.sandDark, x, 1.55, z, { sx: 1.1, sy: 1.9, sz: 1.1 });
    this.B(chunk, 'sph', M.sandDark, x, 2.8, z, { sx: 0.8, sy: 0.8, sz: 0.8 });
    this.B(chunk, 'torus', M.gold, x, 2.8, z - 0.15, { sx: 1.1, sy: 1.1, sz: 1.1 });
  }

  // ================= OBSTACLES (bodies baked; animated bits separate) =================
  _laneX(lane) { return lane * this.cfg.laneWidth; }
  _mkLow(chunk, lane, z) { // fallen column -> JUMP
    const x = this._laneX(lane), M = this.M;
    this.B(chunk, 'cyl', M.obsStone, x, 0.45, z, { rz: Math.PI / 2, sx: 0.84, sy: 2.0, sz: 0.84 });
    this.B(chunk, 'box', M.obsStone, x + 1.1, 0.28, z + 0.2, { ry: 0.5, sx: 0.5, sy: 0.5, sz: 0.5 });
    this.B(chunk, 'box', M.sandDark, x - 1.0, 0.2, z - 0.15, { sx: 0.6, sy: 0.35, sz: 0.5 });
    this.B(chunk, 'sph', M.warn, x, 1.05, z, { sx: 0.18, sy: 0.18, sz: 0.18 });
    return { type: 'low', lane, z };
  }
  _mkBeam(chunk, lane, z, wide = false) { // low lintel + hanging cloth -> SLIDE
    const g = chunk.group, w = wide ? 7.4 : 2.1, x = wide ? 0 : this._laneX(lane);
    this.B(chunk, 'box', this.M.wood, x, 1.75, z, { sx: w, sy: 0.55, sz: 0.8 });
    const n = wide ? 3 : 1;
    for (let i = 0; i < n; i++) {
      const c = new THREE.Mesh(new THREE.PlaneGeometry(0.85, 0.85), this.M.cloth);
      c.position.set(x + (wide ? (i - 1) * 2.3 : 0), 1.1, z); g.add(c);
    }
    return { type: 'beam', lane: wide ? 10 : lane, z, wide };
  }
  _mkBlock(chunk, lane, z, statue = false) { // crate / plinth -> CHANGE LANES
    const x = this._laneX(lane), M = this.M;
    if (statue) {
      this.B(chunk, 'box', M.granite, x, 0.55, z, { sx: 1.7, sy: 1.1, sz: 1.2 });
      this.B(chunk, 'box', M.obsStone, x, 1.75, z, { sx: 1.1, sy: 1.3, sz: 0.9 });
    } else {
      this.B(chunk, 'box', M.obsWood, x, 0.75, z, { sx: 1.7, sy: 1.5, sz: 1.1 });
      this.B(chunk, 'box', M.gold, x, 1.0, z, { sx: 1.78, sy: 0.18, sz: 1.18 });
    }
    return { type: 'block', lane, z };
  }
  _mkBell(chunk, lane, z) { // swinging temple bell -> TIMED
    const x = this._laneX(lane), M = this.M;
    for (const s of [-1, 1]) this.B(chunk, 'box', M.wood, x + s * 1.0, 1.7, z, { sx: 0.25, sy: 3.4, sz: 0.25 });
    this.B(chunk, 'box', M.wood, x, 3.4, z, { sx: 2.3, sy: 0.3, sz: 0.3 });
    const swing = new THREE.Group(); swing.position.set(x, 3.3, z); chunk.group.add(swing);
    const bell = new THREE.Mesh(new THREE.ConeGeometry(0.5, 1.0, 10, 1, true), M.bellMetal);
    bell.position.y = -0.9; bell.castShadow = true; swing.add(bell);
    const clap = new THREE.Mesh(new THREE.SphereGeometry(0.12, 8, 6), M.warn);
    clap.position.y = -1.45; swing.add(clap);
    return { type: 'bell', lane, z, swing, phase: Math.random() * 9 };
  }
  _mkDisc(chunk, lane, z) { // rolling stone disc -> TIMED, rolls at the player
    const disc = new THREE.Mesh(new THREE.CylinderGeometry(1.0, 1.0, 0.5, 14), this.M.obsStone);
    disc.rotation.z = Math.PI / 2;
    const band = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.09, 6, 18), this.M.gold);
    band.rotation.y = Math.PI / 2; disc.add(band);
    disc.castShadow = true;
    disc.position.set(this._laneX(lane), 1.0, z);
    chunk.group.add(disc);
    return { type: 'disc', lane, z, mesh: disc, spin: 0 };
  }
  _mkGap(chunk, z, len = 5) { // broken floor over dark water -> JUMP (all lanes)
    const g = chunk.group;
    const hole = new THREE.Mesh(new THREE.PlaneGeometry(8.6, len),
      new THREE.MeshBasicMaterial({ color: 0x060a18 }));
    hole.rotation.x = -Math.PI / 2; hole.position.set(0, 0.02, z - len / 2); g.add(hole);
    const water = new THREE.Mesh(new THREE.PlaneGeometry(8.6, len), this.M.water);
    water.rotation.x = -Math.PI / 2; water.position.set(0, -1.1, z - len / 2); g.add(water);
    for (let i = 0; i < 8; i++) { // jagged edge slabs -> baked
      const jx = -4 + i * 1.15 + ((i * 37) % 10) / 22 - 0.2;
      this.B(chunk, 'box', this.M.sandDark, jx, 0.1, z + ((i * 53) % 10) / 18 - 0.3, { ry: i * 0.7, sx: 0.9, sy: 0.5, sz: 0.7 });
      this.B(chunk, 'box', this.M.sandDark, jx, 0.1, z - len + ((i * 29) % 10) / 18 - 0.3, { ry: i * 1.1, sx: 0.9, sy: 0.5, sz: 0.7 });
    }
    return { type: 'gap', lane: 10, z: z - len / 2, gapLen: len };
  }

  // ================= CHUNK BUILDERS =================
  _newChunk(type, len) {
    return {
      id: this.chunkSeq++, type, len,
      group: new THREE.Group(), batch: new Map(),
      banners: [], _garlands: [], obstacles: [], coins: [], powerups: [],
      turn: null, _colMats: null, _postMats: null, _diyaLocal: null, startD: 0,
    };
  }
  _finishChunk(chunk) {
    this.bake(chunk); // merge all batched statics -> ~1 mesh per material
    this.scene.add(chunk.group);
    chunk.group.updateMatrixWorld(true);
    const Mw = chunk.group.matrixWorld;
    for (const o of chunk.obstacles)
      o.world = V3(o.lane <= 3 ? this._laneX(o.lane) : 0, 0, o.z).applyMatrix4(Mw);
    for (const c of chunk.coins) c.world = V3(this._laneX(c.lane), c.y, c.z).applyMatrix4(Mw);
    for (const p of chunk.powerups) p.world = V3(this._laneX(p.lane), 1.4, p.z).applyMatrix4(Mw);
    this._commitInstances(chunk);
  }

  buildColonnade(len = 60) {
    const ch = this._newChunk('colonnade', len), diyas = [];
    this._floor(ch, 11, len);
    this._colonnade(ch, len, 5.0, diyas);
    this._tree(ch, -8.5, -len * 0.3, 1.2); this._palm(ch, 8.6, -len * 0.7, 1.1);
    this._marigold(ch, 0, 5.4, -8);
    if (Math.random() < 0.6) this._vimana(ch, 11, -len * 0.5, 1.1);
    else this._gopuram(ch, -12, -len * 0.55, 0.9, Math.PI / 2);
    ch._diyaLocal = diyas;
    return ch;
  }
  buildCourtyard(len = 50) {
    const ch = this._newChunk('courtyard', len), diyas = [];
    this._floor(ch, 17, len);
    this._railing(ch, len, 7.6);
    this._colonnade(ch, 12, 8.2, diyas);
    this._vimana(ch, -11.5, -len * 0.35, 1.2); this._vimana(ch, 11.5, -len * 0.65, 0.9);
    this._tree(ch, -10.5, -len * 0.7, 1.4); this._tree(ch, 10.6, -len * 0.25, 1.1);
    this._statue(ch, -6.2, -len * 0.5); this._statue(ch, 6.2, -len * 0.5);
    this._marigold(ch, -3, 4.2, -6); this._marigold(ch, 3, 4.2, -len + 6);
    for (const s of [-1, 1]) for (let d = 5; d < len; d += 10) diyas.push(V3(s * 7.6, 1.5, -d));
    ch._diyaLocal = diyas;
    return ch;
  }
  buildBridge(len = 52) {
    const ch = this._newChunk('bridge', len), diyas = [];
    this._floor(ch, 10, len);
    for (const s of [-1, 1]) {
      const water = new THREE.Mesh(new THREE.PlaneGeometry(9, len), this.M.water);
      water.rotation.x = -Math.PI / 2; water.position.set(s * 9.6, -1.6, -len / 2); ch.group.add(water);
      for (let i = 0; i < 4; i++) // pushkarni steps
        this.B(ch, 'box', this.M.sandDark, s * (5.6 + i * 1.05), -0.3 - i * 0.42, -len / 2, { sx: 9, sy: 0.4, sz: 0.9 });
      this.B(ch, 'box', this.M.sandDark, s * 5.3, 0.4, -len / 2, { sx: 0.5, sy: 1.4, sz: len });
    }
    this._railing(ch, len, 4.6);
    for (let d = 5; d < len; d += 10) {
      for (const s of [-1, 1]) {
        this.B(ch, 'box', this.M.granite, s * 4.9, 0.9, -d, { sx: 0.5, sy: 0.35, sz: 0.9 }); // makara spouts
        diyas.push(V3(s * 4.9, 1.35, -d));
      }
      if (Math.random() < 0.8)
        this._banner(ch, (Math.random() < 0.5 ? -1 : 1) * (2.4 + Math.random()), 6.1, -d);
      this.B(ch, 'rib', this.M.sandDark, 0, 0.4, -d, {}); // arch rib overhead
    }
    this._palm(ch, -7.5, -6, 1.0); this._palm(ch, 7.5, -len + 6, 1.0);
    ch._diyaLocal = diyas;
    ch.isBridge = true;
    return ch;
  }
  buildStairs(len = 44) {
    const ch = this._newChunk('stairs', len), diyas = [];
    for (let d = 0; d < len; d += 2) { // shallow dip down then up (gameplay stays flat)
      const dip = Math.sin((d / len) * Math.PI) * -0.55;
      this.B(ch, 'box', (d / 2) % 2 ? this.M.sand : this.M.sandDark, 0, dip - 0.25, -d - 1, { sx: 11, sy: 0.5, sz: 2.05 });
    }
    this._colonnade(ch, len, 5.0, diyas, 7);
    this._gopuram(ch, 0, -len - 6, 1.25, 0); // looming gate frames the exit
    ch._diyaLocal = diyas;
    ch.isStairs = true;
    return ch;
  }
  buildTurn(side) { // side: -1 exits left, +1 exits right
    const L = 20, M = this.M;
    const ch = this._newChunk('turn', L), diyas = [];
    this._floor(ch, 11, L - 6);
    this.B(ch, 'box', M.sand, side * -1.5, 3.5, -L + 3, { sx: 12, sy: 7, sz: 1.2 }); // dead-end wall
    this.B(ch, 'box', M.oxide, side * -1.5, 4.6, -L + 3.7, { sx: 12, sy: 0.8, sz: 0.3 }); // carved band
    const gateX = side * 7.5;
    for (const dz of [-2.2, 2.2]) {
      this.B(ch, 'box', M.sand, gateX, 4, -L + 8 + dz, { sx: 1.4, sy: 8, sz: 1.4 });
      this.B(ch, 'cone', M.gold, gateX, 8.7, -L + 8 + dz, { sx: 2.2, sy: 1.4, sz: 2.2 });
    }
    this.B(ch, 'box', M.sandDark, gateX, 7.6, -L + 8, { sx: 1.4, sy: 1.0, sz: 5.8 });
    const glowGate = new THREE.Mesh(new THREE.PlaneGeometry(4.4, 6.4), M.glow);
    glowGate.position.set(gateX, 3.2, -L + 8);
    glowGate.rotation.y = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    ch.group.add(glowGate); ch.gateGlow = glowGate;
    ch.arrows = [];
    for (let i = 0; i < 3; i++) {
      const chv = new THREE.Mesh(new THREE.PlaneGeometry(1.6, 1.6),
        new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0.9 }));
      chv.rotation.x = -Math.PI / 2; chv.rotation.z = side > 0 ? -Math.PI / 2 : Math.PI / 2;
      chv.position.set(side * (1.5 + i * 1.6), 0.03, -L + 8);
      ch.group.add(chv); ch.arrows.push(chv);
    }
    this._colonnade(ch, 10, 5.0, diyas);
    for (const s of [-1, 1]) diyas.push(V3(s * 3, 5.2, -L + 4));
    this._marigold(ch, 0, 5.6, -6);
    ch._diyaLocal = diyas;
    ch.turn = { side, triggerD: L - 13, endD: L - 8 };
    ch.exitYaw = side > 0 ? -Math.PI / 2 : Math.PI / 2;
    return ch;
  }

  // ================= GAMEPLAY POPULATION =================
  populate(ch, diff, dist) {
    if (ch.type === 'turn') { this._coinLine(ch, 0, 6, -4, -10); return; }
    const C = this.cfg;
    const gap = THREE.MathUtils.lerp(C.rowGapEasy, C.rowGapHard, diff);
    const rows = Math.max(1, Math.floor((ch.len - 14) / gap));
    const intro = dist < 150 ? ['low'] : dist < 420 ? ['low', 'beam', 'block'] : ['low', 'beam', 'block', 'bell', 'disc', 'gap'];
    let d = 12 + Math.random() * 4, lastWasGap = false;
    for (let r = 0; r < rows && d < ch.len - 6; r++) {
      const kind = intro[Math.floor(Math.random() * intro.length)];
      const lanes = [-1, 0, 1].sort(() => Math.random() - .5);
      if (kind === 'low') {
        const n = diff > 0.45 && Math.random() < 0.5 ? 2 : 1;
        for (let i = 0; i < n; i++) ch.obstacles.push(this._mkLow(ch, lanes[i], -d));
        this._coinArc(ch, lanes[0], -d);
        if (n === 2) this._coinLine(ch, lanes[2], 5, -d - 4, -d + 4);
      } else if (kind === 'beam') {
        if (Math.random() < 0.35) { ch.obstacles.push(this._mkBeam(ch, 0, -d, true)); this._coinLine(ch, lanes[0], 4, -d - 3, -d + 3, 0.6); }
        else { ch.obstacles.push(this._mkBeam(ch, lanes[0], -d)); this._coinLine(ch, lanes[1], 5, -d - 4, -d + 4, 0.6); }
      } else if (kind === 'block') {
        const n = diff > 0.6 && Math.random() < 0.4 ? 2 : 1;
        for (let i = 0; i < n; i++) ch.obstacles.push(this._mkBlock(ch, lanes[i], -d, Math.random() < 0.4));
        this._coinLine(ch, lanes[2], 5, -d - 4, -d + 4);
      } else if (kind === 'bell') {
        ch.obstacles.push(this._mkBell(ch, lanes[0], -d));
        this._coinLine(ch, lanes[1], 4, -d - 3, -d + 3);
      } else if (kind === 'disc') {
        ch.obstacles.push(this._mkDisc(ch, lanes[0], -d));
        this._coinLine(ch, lanes[1], 4, -d - 3, -d + 3);
      } else if (kind === 'gap') {
        if (!lastWasGap) { ch.obstacles.push(this._mkGap(ch, -d + 2.5, 5)); this._coinArc(ch, 0, -d); }
        else this._coinLine(ch, lanes[0], 5, -d - 4, -d + 4);
        lastWasGap = !lastWasGap && kind === 'gap';
      }
      const minGap = Math.max(gap * (0.8 + Math.random() * 0.5), (C.startSpeed + diff * 8) * C.reactionGap);
      d += minGap;
    }
    if (Math.random() < 0.7) this._coinLine(ch, [-1, 0, 1][Math.floor(Math.random() * 3)], 6, -ch.len + 4, -ch.len + 14);
  }
  _coinLine(ch, lane, n, z0, z1, y = 1.0) {
    for (let i = 0; i < n; i++) {
      const t = n === 1 ? 0.5 : i / (n - 1);
      ch.coins.push({ lane, z: THREE.MathUtils.lerp(z0, z1, t), y, taken: false, phase: Math.random() * 9 });
    }
  }
  _coinArc(ch, lane, zMid) {
    for (let i = 0; i < 5; i++) {
      const t = i / 4, dz = (t - 0.5) * 7;
      ch.coins.push({ lane, z: zMid + dz, y: 1.0 + Math.sin(t * Math.PI) * 1.6, taken: false, phase: Math.random() * 9 });
    }
  }
  spawnPowerup(ch, kind) {
    const lane = [-1, 0, 1][Math.floor(Math.random() * 3)];
    const grp = new THREE.Group();
    let core;
    if (kind === 'magnet') core = new THREE.Mesh(new THREE.TorusGeometry(0.45, 0.16, 8, 16),
      new THREE.MeshStandardMaterial({ color: 0xff4444, emissive: 0xaa0000, emissiveIntensity: 0.8, roughness: 0.4 }));
    else if (kind === 'shield') core = new THREE.Mesh(new THREE.SphereGeometry(0.45, 12, 10),
      new THREE.MeshStandardMaterial({ color: 0xffc861, emissive: 0xaa6600, emissiveIntensity: 0.9, roughness: 0.3 }));
    else core = new THREE.Mesh(new THREE.OctahedronGeometry(0.5),
      new THREE.MeshStandardMaterial({ color: 0xb46aff, emissive: 0x5500aa, emissiveIntensity: 0.9, roughness: 0.3 }));
    grp.add(core);
    grp.add(new THREE.Mesh(new THREE.PlaneGeometry(1.8, 1.8), this.M.glow));
    grp.position.set(this._laneX(lane), 1.4, -ch.len / 2);
    ch.group.add(grp);
    ch.powerups.push({ kind, lane, z: -ch.len / 2, mesh: grp, core, taken: false });
  }

  // ================= SPAWNER =================
  reset() {
    for (const ch of this.chunks) this.destroyChunk(ch);
    this.chunks = []; this.diyas = [];
    this.cursor.set(0, 0, 0); this.yaw = 0; this.chunkSeq = 0;
    this.lastTurn = 0;
  }
  _place(chunk) {
    chunk.group.position.copy(this.cursor);
    chunk.group.rotation.y = this.yaw;
    chunk.yaw = this.yaw;
    chunk.entry = this.cursor.clone();
    const fwd = V3(0, 0, -1).applyAxisAngle(V3(0, 1, 0), this.yaw);
    if (chunk.type === 'turn') {
      const center = this.cursor.clone().addScaledVector(fwd, chunk.turn.endD);
      const newYaw = this.yaw + chunk.exitYaw;
      const newFwd = V3(0, 0, -1).applyAxisAngle(V3(0, 1, 0), newYaw);
      this.cursor = center.clone().addScaledVector(newFwd, 5);
      this.yaw = newYaw;
    } else {
      this.cursor = this.cursor.clone().addScaledVector(fwd, chunk.len);
    }
    chunk.fwd = fwd;
    chunk.travel = chunk.type === 'turn' ? chunk.turn.endD + 5 : chunk.len;
  }
  nextChunk(dist, diff) {
    let ch;
    const sinceTurn = dist - this.lastTurn;
    if ((sinceTurn > 180 && Math.random() < 0.32 && dist > 120)) {
      ch = this.buildTurn(Math.random() < 0.5 ? -1 : 1);
      this.lastTurn = dist + 20;
    } else {
      const r = Math.random();
      if (dist < 60) ch = this.buildColonnade(60); // safe opening
      else if (r < 0.34) ch = this.buildColonnade(58 + Math.random() * 14);
      else if (r < 0.58) ch = this.buildCourtyard(48 + Math.random() * 10);
      else if (r < 0.78) ch = this.buildBridge(50 + Math.random() * 8);
      else ch = this.buildStairs(42 + Math.random() * 8);
      if (dist >= 60) this.populate(ch, diff, dist);
    }
    ch.startD = dist;
    this._place(ch);
    this._finishChunk(ch);
    this.chunks.push(ch);
    return ch;
  }
  _commitInstances(chunk) {
    chunk.group.updateMatrixWorld(true);
    const Mw = chunk.group.matrixWorld;
    if (chunk._colMats) this.poolCol.alloc(chunk, chunk._colMats.map(m => m.clone().premultiply(Mw)));
    if (chunk._postMats) this.poolPost.alloc(chunk, chunk._postMats.map(m => m.clone().premultiply(Mw)));
    if (chunk._diyaLocal) {
      this.poolBowl.alloc(chunk, chunk._diyaLocal.map(p =>
        new THREE.Matrix4().makeTranslation(p.x, p.y, p.z).premultiply(Mw)));
      const worldPts = chunk._diyaLocal.map(p => p.clone().applyMatrix4(Mw).add(V3(0, 0.28, 0)));
      this._allocFlames(chunk, worldPts);
      for (const p of worldPts) this.diyas.push({ pos: p, phase: Math.random() * 9, chunk });
    }
  }
  destroyChunk(ch) {
    this.scene.remove(ch.group);
    this.poolCol.free(ch); this.poolPost.free(ch); this.poolBowl.free(ch);
    this._freeFlames(ch);
    this.diyas = this.diyas.filter(d => d.chunk !== ch);
  }
  cull(behindD) {
    while (this.chunks.length > 2) {
      const ch = this.chunks[0];
      if (ch.startD + (ch.travel ?? ch.len) < behindD - this.cfg.cullBehind) {
        this.destroyChunk(ch); this.chunks.shift();
      } else break;
    }
  }

  // ================= PER-FRAME =================
  update(dt, playerPos, speed, diff) {
    this.time += dt;
    const t = this.time;
    this.flameMat.opacity = 0.85 + Math.sin(t * 13) * 0.1;
    const sorted = this.diyas
      .map(d => ({ d, dist: (d.pos.x - playerPos.x) ** 2 + (d.pos.z - playerPos.z) ** 2 }))
      .filter(o => o.dist < 3600).sort((a, b) => a.dist - b.dist);
    for (let i = 0; i < this.lampLights.length; i++) {
      const L = this.lampLights[i];
      if (sorted[i]) {
        L.position.copy(sorted[i].d.pos).add(V3(0, 0.4, 0));
        L.intensity = this.cfg.lampIntensity * (0.85 + 0.15 * Math.sin(t * 11 + sorted[i].d.phase) * Math.sin(t * 23 + sorted[i].d.phase * 2));
      } else L.intensity = 0;
    }
    this.sun.position.set(playerPos.x - 28, 22, playerPos.z + 12);
    this.sun.target.position.copy(playerPos); this.sun.target.updateMatrixWorld();
    this.skyDome.position.copy(playerPos);
    this.farTemples.position.set(playerPos.x, 0, playerPos.z);
    for (const ch of this.chunks) {
      for (const b of ch.banners) {
        b.m.rotation.x = Math.sin(t * 1.6 + b.phase) * 0.14;
        b.m.rotation.y = Math.sin(t * 0.9 + b.phase) * 0.2;
      }
      if (ch.gateGlow) ch.gateGlow.scale.setScalar(1 + Math.sin(t * 4) * 0.06);
      if (ch.arrows) for (const a of ch.arrows) a.material.opacity = 0.6 + Math.sin(t * 6) * 0.3;
      for (const o of ch.obstacles) {
        if (o.swing) o.swing.rotation.x = Math.sin(t * 2.6 + o.phase) * 0.75;
        if (o.mesh && o.type === 'disc') { o.spin += dt * 4; o.mesh.rotation.x = o.spin; }
      }
      for (const p of ch.powerups)
        if (!p.taken) { p.core.rotation.y += dt * 2.4; p.mesh.position.y = 1.4 + Math.sin(t * 3 + p.z) * 0.18; }
    }
    this._updateParticles(dt, playerPos, speed);
    this._updateCoins();
  }
  _updateCoins() {
    let i = 0;
    const cap = this.poolCoin.cap, mesh = this.coinMesh;
    const P = new THREE.Vector3(), Q = new THREE.Quaternion(), S1 = new THREE.Vector3(1, 1, 1), AX = V3(0, 1, 0);
    for (const ch of this.chunks) {
      for (const c of ch.coins) {
        if (i >= cap) return;
        if (c.taken) { mesh.setMatrixAt(i++, new THREE.Matrix4().makeScale(0, 0, 0)); continue; }
        P.copy(c.world); P.y += Math.sin(this.time * 2.5 + c.phase) * 0.12;
        Q.setFromAxisAngle(AX, this.time * 2.2 + c.phase);
        mesh.setMatrixAt(i++, new THREE.Matrix4().compose(P, Q, S1));
      }
    }
    const zero = new THREE.Matrix4().makeScale(0, 0, 0);
    for (let k = i; k < cap; k++) mesh.setMatrixAt(k, zero);
    mesh.instanceMatrix.needsUpdate = true;
  }
  _updateParticles(dt, playerPos, speed) {
    const D = this.dust;
    for (let i = 0; i < D.n; i++) {
      D.pos[i * 3] += (this.dustVel[i * 3] + speed * 0.12) * dt * -0.4 + Math.sin(this.time + i) * dt * 0.2;
      D.pos[i * 3 + 1] += this.dustVel[i * 3 + 1] * dt;
      D.pos[i * 3 + 2] += this.dustVel[i * 3 + 2] * dt;
      if (D.pos[i * 3 + 1] > 8) D.pos[i * 3 + 1] = 0.3;
      const dx = D.pos[i * 3] - playerPos.x, dz = D.pos[i * 3 + 2] - playerPos.z;
      if (dx * dx + dz * dz > 2025) {
        D.pos[i * 3] = playerPos.x + (Math.random() - .5) * 60;
        D.pos[i * 3 + 1] = Math.random() * 7;
        D.pos[i * 3 + 2] = playerPos.z - 10 - Math.random() * 40;
      }
    }
    D.pts.geometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < this.spark.n; i++) {
      if (this.sparkLife[i] <= 0) continue;
      this.sparkLife[i] -= dt;
      this.sparkVel[i * 3 + 1] -= 9 * dt;
      this.spark.pos[i * 3] += this.sparkVel[i * 3] * dt;
      this.spark.pos[i * 3 + 1] += this.sparkVel[i * 3 + 1] * dt;
      this.spark.pos[i * 3 + 2] += this.sparkVel[i * 3 + 2] * dt;
      if (this.sparkLife[i] <= 0) this.spark.pos[i * 3 + 1] = -100;
    }
    this.spark.pts.geometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < this.puff.n; i++) {
      if (this.puffLife[i] <= 0) continue;
      this.puffLife[i] -= dt;
      this.puff.pos[i * 3] += this.puffVel[i * 3] * dt;
      this.puff.pos[i * 3 + 1] += this.puffVel[i * 3 + 1] * dt;
      this.puff.pos[i * 3 + 2] += this.puffVel[i * 3 + 2] * dt;
      if (this.puffLife[i] <= 0) this.puff.pos[i * 3 + 1] = -100;
    }
    this.puff.pts.geometry.attributes.position.needsUpdate = true;
    for (let i = 0; i < 60; i++) {
      const s = this.flySeed[i];
      this.flies.pos[i * 3] = playerPos.x + Math.sin(this.time * 0.5 + s * 3) * 12;
      this.flies.pos[i * 3 + 1] = 1 + Math.sin(this.time * 0.9 + s * 5) * 0.8;
      this.flies.pos[i * 3 + 2] = playerPos.z - 8 + Math.cos(this.time * 0.4 + s * 2) * 14;
    }
    this.flies.pts.geometry.attributes.position.needsUpdate = true;
    this.flies.pts.material.opacity = 0.5 + Math.sin(this.time * 2) * 0.3;
    for (let i = 0; i < 90; i++) {
      this.petals.pos[i * 3] += this.petalVel[i * 3] * dt;
      this.petals.pos[i * 3 + 1] += Math.sin(this.time * 2 + i) * dt * 0.6 - dt * 0.25;
      this.petals.pos[i * 3 + 2] += Math.cos(this.time * 1.4 + i * 0.7) * dt;
      if (this.petals.pos[i * 3] - playerPos.x > 35) {
        this.petals.pos[i * 3] = playerPos.x - 30;
        this.petals.pos[i * 3 + 1] = 3 + Math.random() * 5;
        this.petals.pos[i * 3 + 2] = playerPos.z + (Math.random() - .5) * 60;
      }
      if (this.petals.pos[i * 3 + 1] < 0) this.petals.pos[i * 3 + 1] = 6;
    }
    this.petals.pts.geometry.attributes.position.needsUpdate = true;
    if (this.rain.pts.visible) {
      for (let i = 0; i < 900; i++) {
        this.rain.pos[i * 3 + 1] -= 22 * dt;
        this.rain.pos[i * 3] += 2 * dt;
        if (this.rain.pos[i * 3 + 1] < 0) {
          this.rain.pos[i * 3] = playerPos.x + (Math.random() - .5) * 50;
          this.rain.pos[i * 3 + 1] = 12 + Math.random() * 4;
          this.rain.pos[i * 3 + 2] = playerPos.z + (Math.random() - .5) * 50;
        }
      }
      this.rain.pts.geometry.attributes.position.needsUpdate = true;
    }
  }
}
