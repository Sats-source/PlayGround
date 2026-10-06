// player.js — stylized intruder: silhouette-readable, desaturated garments so
// he reads against the warm palace. Procedural run-cycle / jump / slide /
// stumble + squash-and-stretch + orbiting shield diya.
import * as THREE from 'three';

export class Player {
  constructor() {
    this.group = new THREE.Group();
    this.inner = new THREE.Group(); // squash & stretch applied here
    this.group.add(this.inner);
    this.runPhase = 0; this.stumbleT = 0; this.slideBlend = 0; this.airBlend = 0;
    this._build();
  }
  _mat(c, r = 0.85) { return new THREE.MeshStandardMaterial({ color: c, roughness: r, metalness: 0.05 }); }
  _limb(w, h, mat) {
    const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, w), mat);
    m.castShadow = true;
    return m;
  }
  _build() {
    const skin = this._mat(0x8a5a3b);
    const cloth = this._mat(0x4a3b52);      // desaturated aubergine dhoti
    const sash = this._mat(0xb0341f, 0.7);  // vermilion sash (accent)
    const dark = this._mat(0x241d2a);
    // pelvis / torso
    this.pelvis = new THREE.Group(); this.pelvis.position.y = 1.02; this.inner.add(this.pelvis);
    this.torso = this._limb(0.42, 0.55, cloth); this.torso.position.y = 0.42; this.pelvis.add(this.torso);
    this.sash = this._limb(0.45, 0.12, sash); this.sash.position.y = 0.18; this.pelvis.add(this.sash);
    // scarf trailing behind (animated flutter)
    this.scarf = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.06, 0.9), sash);
    this.scarf.position.set(0, 0.62, 0.5); this.scarf.castShadow = true; this.pelvis.add(this.scarf);
    // head
    this.headG = new THREE.Group(); this.headG.position.y = 0.88; this.pelvis.add(this.headG);
    const head = new THREE.Mesh(new THREE.SphereGeometry(0.17, 12, 10), skin);
    head.castShadow = true; this.headG.add(head);
    const wrap = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.19, 0.12, 10), dark);
    wrap.position.y = 0.1; this.headG.add(wrap);
    const jewel = new THREE.Mesh(new THREE.SphereGeometry(0.035, 8, 6),
      new THREE.MeshStandardMaterial({ color: 0xff2a2a, emissive: 0xaa0000, emissiveIntensity: 1.2 }));
    jewel.position.set(0, 0.02, -0.16); this.headG.add(jewel); // faces -Z = run dir
    // arms: pivot at shoulder
    const mkArm = (side) => {
      const sh = new THREE.Group(); sh.position.set(0.28 * side, 0.62, 0); this.pelvis.add(sh);
      const up = this._limb(0.13, 0.36, skin); up.position.y = -0.18; sh.add(up);
      const el = new THREE.Group(); el.position.y = -0.36; sh.add(el);
      const fo = this._limb(0.11, 0.32, skin); fo.position.y = -0.15; el.add(fo);
      return { sh, el };
    };
    this.armL = mkArm(-1); this.armR = mkArm(1);
    // legs: pivot at hip
    const mkLeg = (side) => {
      const hip = new THREE.Group(); hip.position.set(0.14 * side, 0.05, 0); this.pelvis.add(hip);
      const th = this._limb(0.16, 0.42, dark); th.position.y = -0.21; hip.add(th);
      const kn = new THREE.Group(); kn.position.y = -0.44; hip.add(kn);
      const sh2 = this._limb(0.13, 0.4, skin); sh2.position.y = -0.2; kn.add(sh2);
      const ft = this._limb(0.13, 0.09, sash); ft.position.set(0, -0.42, -0.08); kn.add(ft);
      return { hip, kn };
    };
    this.legL = mkLeg(-1); this.legR = mkLeg(1);
    // blob shadow (cheap, always on even where dir-light shadow is out of range)
    const blobTex = (() => {
      const c = document.createElement('canvas'); c.width = c.height = 64;
      const g = c.getContext('2d');
      const gr = g.createRadialGradient(32, 32, 4, 32, 32, 30);
      gr.addColorStop(0, 'rgba(0,0,0,0.55)'); gr.addColorStop(1, 'rgba(0,0,0,0)');
      g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
      return new THREE.CanvasTexture(c);
    })();
    this.blob = new THREE.Mesh(new THREE.PlaneGeometry(1.4, 1.4),
      new THREE.MeshBasicMaterial({ map: blobTex, transparent: true, depthWrite: false }));
    this.blob.rotation.x = -Math.PI / 2;
    this.group.add(this.blob);
    // shield aura: golden shell + orbiting diya flame
    this.aura = new THREE.Mesh(new THREE.SphereGeometry(1.15, 18, 14),
      new THREE.MeshBasicMaterial({ color: 0xffc861, transparent: true, opacity: 0.0, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide }));
    this.aura.position.y = 1.1; this.group.add(this.aura);
    this.orbitDiya = new THREE.Mesh(new THREE.SphereGeometry(0.09, 10, 8),
      new THREE.MeshBasicMaterial({ color: 0xffd27a }));
    this.orbitDiya.visible = false; this.group.add(this.orbitDiya);
    this.orbitGlow = new THREE.PointLight(0xff9a3c, 0, 9);
    this.group.add(this.orbitGlow);
  }
  setShield(on) {
    this.aura.material.opacity = on ? 0.22 : 0;
    this.orbitDiya.visible = on;
    this.orbitGlow.intensity = on ? 6 : 0;
  }
  stumble() { this.stumbleT = 0.55; }
  update(dt, speed, grounded, sliding, shield, time) {
    // stride frequency scales with speed
    this.runPhase += dt * (7 + speed * 0.55);
    const p = this.runPhase, s = Math.sin(p), c = Math.cos(p);
    this.slideBlend += ((sliding ? 1 : 0) - this.slideBlend) * Math.min(1, dt * 12);
    this.airBlend += ((grounded ? 0 : 1) - this.airBlend) * Math.min(1, dt * 8);
    if (this.stumbleT > 0) this.stumbleT -= dt;
    const stb = this.stumbleT > 0 ? Math.sin(this.stumbleT * 20) * this.stumbleT : 0;
    const sb = this.slideBlend, ab = this.airBlend;
    if (sb < 0.5 && ab < 0.5) {
      // run cycle
      this.legL.hip.rotation.x = s * 0.95; this.legR.hip.rotation.x = -s * 0.95;
      this.legL.kn.rotation.x = Math.max(0, -c) * 1.3 + 0.15; this.legR.kn.rotation.x = Math.max(0, c) * 1.3 + 0.15;
      this.armL.sh.rotation.x = -s * 0.85; this.armR.sh.rotation.x = s * 0.85;
      this.armL.el.rotation.x = -0.5 - Math.max(0, c) * 0.5; this.armR.el.rotation.x = -0.5 - Math.max(0, -c) * 0.5;
      this.pelvis.position.y = 1.02 + Math.abs(c) * 0.07;
      this.pelvis.rotation.x = 0.12; this.inner.scale.set(1, 1, 1);
    } else if (ab >= 0.5) {
      // jump: knees tucked, arms up, stretch
      const k = ab;
      this.legL.hip.rotation.x = -0.9 * k + s * 0.1; this.legR.hip.rotation.x = -0.4 * k - s * 0.1;
      this.legL.kn.rotation.x = 1.4 * k; this.legR.kn.rotation.x = 0.9 * k;
      this.armL.sh.rotation.x = -2.2 * k; this.armR.sh.rotation.x = -2.2 * k;
      this.inner.scale.set(1 - 0.06 * k, 1 + 0.10 * k, 1 - 0.06 * k);
    }
    if (sb >= 0.02) {
      // slide: low lean-back, legs forward
      this.pelvis.position.y = 1.02 - sb * 0.55;
      this.pelvis.rotation.x = -0.5 * sb;
      this.legL.hip.rotation.x = -1.3 * sb; this.legR.hip.rotation.x = -1.1 * sb;
      this.legL.kn.rotation.x = 0.2; this.legR.kn.rotation.x = 0.2;
      this.inner.scale.set(1 + 0.08 * sb, 1 - 0.35 * sb, 1 + 0.15 * sb);
    } else if (ab < 0.5) {
      this.pelvis.rotation.x = 0.12 + stb * 0.8;
    }
    // scarf flutter
    this.scarf.rotation.x = 0.25 + Math.sin(time * 9) * 0.12 + speed * 0.012;
    this.scarf.position.y = 0.62 + Math.sin(time * 11) * 0.02;
    // shield orbit
    if (shield) {
      const a = time * 4;
      this.orbitDiya.position.set(Math.cos(a) * 1.1, 1.1 + Math.sin(time * 3) * 0.25, Math.sin(a) * 1.1);
      this.aura.material.opacity = 0.18 + Math.sin(time * 5) * 0.06;
    }
    // blob follows ground
    this.blob.position.y = 0.03 - this.group.position.y + this._groundY;
  }
  _groundY = 0;
  setGroundY(y) { this._groundY = y; }
}
