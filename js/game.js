// game.js — state machine (menu/playing/paused/dying/over), difficulty,
// collisions, coins/power-ups, chase camera, HUD, main loop.
import * as THREE from 'three';
import { World } from './world.js';
import { Player } from './player.js';
import { Input } from './input.js';
import { AudioSys } from './audio.js';

const $ = (id) => document.getElementById(id);
const clamp = THREE.MathUtils.clamp, lerp = THREE.MathUtils.lerp;

export class Game {
  constructor(canvas, cfg) {
    this.cfg = cfg; this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.setSize(innerWidth, innerHeight);
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping; // cheap "grading"
    this.renderer.toneMappingExposure = 1.12;
    this.scene = new THREE.Scene();
    this.camera = new THREE.PerspectiveCamera(cfg.baseFov, innerWidth / innerHeight, 0.1, 900);
    this.world = new World(this.scene, cfg);
    this.player = new Player();
    this.audio = new AudioSys();
    this.input = new Input({
      onAction: (n) => this.action(n),
      onPause: () => this.togglePause(),
      onMute: () => this.toggleMute(),
      onConfirm: () => this.confirm(),
      onAny: () => this.audio.ensure(),
    });
    this.state = 'menu';
    this.best = this._loadBest();
    this._fpsAcc = 0; this._fpsN = 0; this._fpsT = 0; this.degraded = false;
  }

  init() {
    this.world.init();
    this.scene.add(this.player.group);
    this._buildRun();          // showcase palace behind the menu
    this._bindUI();
    this._orbitA = 0;
    addEventListener('resize', () => {
      this.camera.aspect = innerWidth / innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(innerWidth, innerHeight);
    });
    $('best-line').textContent = this.best.score > 0
      ? `BEST ${this.best.score} · ${this.best.dist}m · ${this.best.coins}◉` : 'NO LEGENDS YET — RUN.';
    this.clock = new THREE.Clock();
    this.renderer.setAnimationLoop(() => this.frame());
  }

  // ================= RUN SETUP =================
  _buildRun() {
    this.world.reset();
    this.dist = 0; this.speed = this.cfg.startSpeed;
    this.pos = new THREE.Vector3(0, 0, -2); // on the entry floor, not the void
    this.yaw = 0; this.laneIdx = 0; this.laneX = 0; this.laneV = 0;
    this._lastLaneOff = 0; this.mercyT = 0; this._wantSlide = 0;
    this.py = 0; this.vy = 0; this.grounded = true; this.coyote = 0;
    this.sliding = 0; this.coins = 0; this.score = 0;
    this.magnetT = 0; this.multT = 0; this.shield = false; this.shieldT = 0;
    this.powerClock = 14; this.pendingPower = null;
    this.dieT = 0; this.hitStop = 0; this.shake = 0; this.kick = 0;
    this.stepT = 0;     this.turnInfo = null; this.bufferedTurn = null;
    this.deathReason = '';
    this.prevChest = null;
    this.player.setShield(false);
    this.player.group.position.copy(this.pos);
    // seed chunks: safe opener + road ahead
    let d = 0;
    for (let i = 0; i < this.cfg.chunkAhead; i++) d = this._pushChunk(d);
    this.world.cull(this.dist);
  }
  _diff() { return 1 - Math.exp(-this.dist / this.cfg.speedRampDist); }
  _pushChunk(d) {
    const diff = 1 - Math.exp(-d / this.cfg.speedRampDist);
    const ch = this.world.nextChunk(d, diff);
    if (this.pendingPower && ch.type !== 'turn') {
      this.world.spawnPowerup(ch, this.pendingPower);
      const p = ch.powerups[ch.powerups.length - 1];
      p.world = new THREE.Vector3(p.lane * this.cfg.laneWidth, 1.4, p.z).applyMatrix4(ch.group.matrixWorld);
      this.pendingPower = null;
    }
    return d + (ch.travel ?? ch.len);
  }

  // ================= INPUT =================
  action(n) {
    if (this.state === 'menu' || this.state === 'over') {
      if (n === 'jump' || n === 'slide') { /* ignore */ }
      return;
    }
    if (this.state === 'paused') return;
    if (this.state !== 'playing') return;
    this.audio.ensure();
    if (n === 'left' || n === 'right') this._steer(n);
    else if (n === 'jump') this._jump();
    else if (n === 'slide') this._slide();
  }
  _steer(dir) {
    const d = dir === 'left' ? -1 : 1;
    // turning takes precedence inside a turn trigger
    if (this.turnInfo) { this._doTurn(d); return; }
    const nl = clamp(this.laneIdx + d, -1, 1);
    if (nl !== this.laneIdx) { this.laneIdx = nl; this.audio.turn(); this.world.puffAt(this.pos, 2, 0.8); }
    else this.bufferedTurn = { d, t: performance.now() / 1000 }; // maybe a turn is imminent
  }
  _jump() {
    if (!this.grounded && this.coyote <= 0) return; // stays in input buffer for landing
    if (this.sliding > 0) return;
    this.vy = this.cfg.jumpVel; this.grounded = false; this.coyote = 0;
    this.audio.jump();
    this.input.clearBuffer();
    this.player.inner.scale.set(0.92, 1.12, 0.92); // stretch pop
  }
  _slide() {
    if (!this.grounded) { this.vy = Math.min(this.vy, -19); this._wantSlide = 0.5; return; } // slam
    if (this.sliding > 0) { this.sliding = this.cfg.slideTime; return; }
    this.sliding = this.cfg.slideTime; this.audio.slide();
    this.input.clearBuffer();
    this.world.puffAt(this.pos, 7, 2.2);
  }
  confirm() {
    if (this.state === 'menu') this.start();
    else if (this.state === 'over') this.start();
  }

  // ================= FLOW =================
  start() {
    this.audio.ensure(); this.audio.click();
    this._buildRun();
    this.state = 'playing';
    document.body.className = 'playing';
    $('screen-start').classList.add('hidden');
    $('screen-over').classList.add('hidden');
    $('screen-pause').classList.add('hidden');
    this.input.clearBuffer();
  }
  togglePause() {
    if (this.state === 'playing') {
      this.state = 'paused'; document.body.classList.remove('playing');
      $('screen-pause').classList.remove('hidden');
    } else if (this.state === 'paused') this.resume();
  }
  resume() {
    if (this.state !== 'paused') return;
    this.state = 'playing'; document.body.className = 'playing';
    $('screen-pause').classList.add('hidden');
    this.clock.getDelta();
  }
  quitToMenu() {
    this.state = 'menu'; document.body.className = '';
    $('screen-pause').classList.add('hidden');
    $('screen-start').classList.remove('hidden');
    this._buildRun();
  }
  toggleMute() {
    this.audio.ensure();
    const m = this.audio.toggleMute();
    $('mute-btn').textContent = m ? '🔇' : '🔔';
  }
  die(reason, fall = false) {
    if (this.state !== 'playing') return;
    if (this.shield) { // consume shield instead
      this.shield = false; this.player.setShield(false);
      this.player.stumble(); this.audio.crash();
      this.shake = 0.35; this.hitStop = 0.1;
      $('p-shield').classList.remove('on');
      this.world.burst(this.pos.clone().add(new THREE.Vector3(0, 1.2, 0)), 3, 0.6, 24);
      // brief mercy: clear nearest block so player isn't instantly re-hit
      this.mercyT = 1.2;
      return;
    }
    this.state = 'dying'; this.dieT = 0; this.deathReason = reason; this.fell = fall;
    this.audio.crash();
    this.hitStop = 0.14; this.shake = this.cfg.shakeOnDeath;
    document.body.classList.add('dying');
    $('damage-flash').style.opacity = 1;
    setTimeout(() => $('damage-flash').style.opacity = 0, 450);
    this.world.puffAt(this.pos, 16, 4);
  }
  _gameOver() {
    this.state = 'over';
    document.body.classList.remove('playing', 'dying');
    const sc = Math.floor(this.score);
    const isBest = sc > (this.best.score || 0);
    if (isBest) { this.best = { score: sc, dist: Math.floor(this.dist), coins: this.coins }; this._saveBest(); }
    $('o-score').textContent = sc; $('o-dist').textContent = Math.floor(this.dist) + 'm';
    $('o-coins').textContent = this.coins; $('o-best').textContent = this.best.score;
    $('death-reason').textContent = this.deathReason;
    $('newbest').style.display = isBest ? 'block' : 'none';
    $('screen-over').classList.remove('hidden');
    $('best-line').textContent = `BEST ${this.best.score} · ${this.best.dist}m · ${this.best.coins}◉`;
  }
  _loadBest() { try { return JSON.parse(localStorage.getItem('palaceRunnerBest')) || { score: 0, dist: 0, coins: 0 }; } catch { return { score: 0, dist: 0, coins: 0 }; } }
  _saveBest() { try { localStorage.setItem('palaceRunnerBest', JSON.stringify(this.best)); } catch { } }
  _bindUI() {
    $('btn-start').onclick = () => this.start();
    $('btn-again').onclick = () => this.start();
    $('btn-resume').onclick = () => this.resume();
    $('btn-quit').onclick = () => this.quitToMenu();
    $('pause-btn').onclick = () => this.togglePause();
    $('mute-btn').onclick = () => this.toggleMute();
    this.canvas.addEventListener('mousedown', () => {
      if (this.state === 'over') this.start();
      else if (this.state === 'menu') { /* let them press Run */ }
    });
    // keyboard restart on game-over
    addEventListener('keydown', (e) => {
      if (this.state === 'over' && (e.key === ' ' || e.key === 'Enter')) this.start();
    });
  }

  // ================= TURNS =================
  _curChunk() {
    for (const ch of this.world.chunks) {
      const trav = ch.travel ?? ch.len;
      if (this.dist >= ch.startD - 1 && this.dist <= ch.startD + trav + 6) return ch;
    }
    return this.world.chunks[this.world.chunks.length - 1];
  }
  _doTurn(d) {
    const ti = this.turnInfo;
    if (!ti || d !== ti.side) { // wrong way: wall graze
      if (ti && d !== ti.side) { this.die(d < 0 ? 'You veered left into the dead-end wall.' : 'You veered right into the dead-end wall.'); }
      return;
    }
    this.yaw = ti.exitYaw;
    // snap to gate centre, reset lane, re-sync path distance to geometry
    this.pos.copy(ti.center).addScaledVector(ti.newFwd, 1.5);
    this.dist = ti.chunk.startD + ti.chunk.turn.endD + 1.5;
    this.laneIdx = 0; this.laneX = 0; this.laneV = 0; this._lastLaneOff = 0;
    this.turnInfo = null; this.bufferedTurn = null;
    $('turn-prompt').style.display = 'none';
    this.audio.turn();
    this.world.burst(this.pos.clone().add(new THREE.Vector3(0, 1, 0)), 2, 0.5, 14);
  }

  // ================= COLLISIONS =================
  _fwd() { return new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw); }
  _right() { return new THREE.Vector3(1, 0, 0).applyAxisAngle(new THREE.Vector3(0, 1, 0), this.yaw); }
  _seg(p, a, b) { // distance from point to segment (swept pickups: no tunneling at low fps)
    const abx = b.x - a.x, aby = b.y - a.y, abz = b.z - a.z;
    const l2 = abx * abx + aby * aby + abz * abz || 1;
    const t = clamp(((p.x - a.x) * abx + (p.y - a.y) * aby + (p.z - a.z) * abz) / l2, 0, 1);
    const dx = p.x - (a.x + abx * t), dy = p.y - (a.y + aby * t), dz = p.z - (a.z + abz * t);
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }
  _collide() {
    const fwd = this._fwd(), right = this._right();
    const hz = 1.0 + this.speed * this._dt * 0.5; // hazard depth grows with per-frame travel
    const chest = this.pos.clone(); chest.y += 1.0;
    const prev = this.prevChest || chest;
    const vulnerable = this.mercyT <= 0; // mercy skips hazards, never pickups
    for (const ch of this.world.chunks) {
      if (Math.abs(ch.startD + ch.len / 2 - this.dist) > 40) continue;
      if (vulnerable) this._collideObstacles(ch, fwd, right, hz);
      // coins (swept: segment test prevents tunneling at low fps)
      for (const c of ch.coins) {
        if (c.taken) continue;
        const dd = c.world.distanceTo(chest);
        const R = this.magnetT > 0 ? this.cfg.magnetRadius : this.cfg.coinRadius;
        if (this.magnetT > 0 && dd < R) c.world.lerp(chest, Math.min(1, this._dt * 12));
        if (Math.min(dd, this._seg(c.world, prev, chest)) < this.cfg.coinRadius + 0.25) {
          c.taken = true; this.coins++;
          this.score += 25 * (this.multT > 0 ? 2 : 1);
          this.audio.coin();
          this.world.burst(c.world, 2.2, 0.5, 8);
        }
      }
      // power-ups
      for (const p of ch.powerups) {
        if (p.taken) continue;
        if (Math.min(p.world.distanceTo(chest), this._seg(p.world, prev, chest)) < 2.0) {
          p.taken = true; p.mesh.visible = false;
          this.audio.power();
          this.world.burst(p.world, 3, 0.7, 20);
          if (p.kind === 'magnet') this.magnetT = this.cfg.magnetTime;
          if (p.kind === 'shield') { this.shield = true; this.shieldT = this.cfg.shieldTime; this.player.setShield(true); }
          if (p.kind === 'mult') this.multT = this.cfg.multTime;
        }
      }
    }
    this.prevChest = chest;
  }
  _collideObstacles(ch, fwd, right, hz) {
    for (const o of ch.obstacles) {
      const rel = o.world.clone().sub(this.pos);
      const fz = rel.dot(fwd), lx = rel.dot(right);
      if (o.type === 'disc') { // update roller then test as block (jumpable)
        o.z += this.speed * 0.45 * this._dt;
        o.mesh.position.z = o.z;
        o.world.set(o.lane * this.cfg.laneWidth, 0, o.z).applyMatrix4(ch.group.matrixWorld);
        const r2 = o.world.clone().sub(this.pos);
        const fz2 = r2.dot(fwd), lx2 = r2.dot(right);
        if (Math.abs(fz2) < 1.1 && Math.abs(lx2) < 1.25 && this.py < 1.55) { this.die('Crushed by a rolling stone disc.'); return; }
        continue;
      }
      if (o.type === 'gap') {
        const dc = ch.startD + (-o.z); // centre path-distance of gap
        if (Math.abs(this.dist - dc) < o.gapLen / 2 - 0.35 && this.grounded && this.py < 0.15) {
          this.die('The tank swallowed you — jump the broken span.', true); return;
        }
        continue;
      }
      if (Math.abs(fz) > hz) continue;
      if (o.type === 'low') {
        if (Math.abs(lx) < 1.25 && this.py < 0.8) { this.die('Tripped on a fallen column — jump it.'); return; }
      } else if (o.type === 'beam') {
        const hitLane = o.wide ? true : Math.abs(lx) < 1.3;
        if (hitLane && this.sliding <= 0) { this.die('Clotheslined by a lintel — slide under.'); return; }
      } else if (o.type === 'block') {
        if (Math.abs(lx) < 1.3 && this.py < 1.9) { this.die('Slammed into a statue plinth — switch lanes.'); return; }
      } else if (o.type === 'bell') {
        const danger = Math.abs(Math.sin(this.world.time * 2.6 + o.phase)) < 0.6;
        if (Math.abs(lx) < 1.35 && danger && this.sliding <= 0 && this.py < 1.7) { this.die('The temple bell caught you mid-swing — time it or slide.'); return; }
      }
    }
  }

  // ================= FRAME =================
  frame() {
    const rawDt = Math.min(this.clock.getDelta(), 0.05);
    // fps guard: degrade gracefully on weak GPUs
    this._fpsAcc += rawDt; this._fpsN++; this._fpsT += rawDt;
    if (this._fpsT > 4 && !this.degraded) {
      const avg = this._fpsN / this._fpsAcc;
      $('fps-warn').textContent = `${avg.toFixed(0)} fps · ${this.renderer.info.render.calls} draws`;
      if (avg < 27) {
        this.degraded = true;
        this.renderer.setPixelRatio(1);
        this.renderer.shadowMap.enabled = false;
        this.cfg.fogDensity = 0.011;
        this.scene.fog.density = 0.011;
      }
      this._fpsAcc = 0; this._fpsN = 0; this._fpsT = 0;
    }
    if (this.state === 'paused') { this.renderer.render(this.scene, this.camera); return; }
    // hit-stop freeze
    let dt = rawDt;
    if (this.hitStop > 0) { this.hitStop -= rawDt; dt = 0; }
    this._dt = dt;
    if (this.state === 'menu') this._menuCam(rawDt);
    else if (this.state === 'playing' || this.state === 'dying') this._play(dt, rawDt);
    this.renderer.render(this.scene, this.camera);
  }

  _menuCam(dt) {
    this._orbitA += dt * 0.1;
    const cx = this.pos.x + Math.sin(this._orbitA) * 30;
    const cz = this.pos.z - 24 + Math.cos(this._orbitA) * 30;
    this.camera.position.set(cx, 11.5 + Math.sin(this._orbitA * 0.7) * 1.5, cz);
    this.camera.lookAt(this.pos.x, 2.2, this.pos.z - 26);
    if (Math.abs(this.camera.fov - 58) > 0.1) { this.camera.fov = 58; this.camera.updateProjectionMatrix(); }
    this.world.update(dt, this.pos, 4, 0);
    this.player.update(dt, 0, true, false, false, this.world.time);
    this.player.group.position.set(this.pos.x, 0, this.pos.z);
  }

  _play(dt, rawDt) {
    const C = this.cfg;
    if (this.state === 'playing') {
      // --- difficulty: smooth exp ramp, capped ---
      const diff = this._diff();
      this.speed = lerp(C.startSpeed, C.maxSpeed, diff);
      this.score += this.speed * dt * 10 * (this.multT > 0 ? 2 : 1);
      // --- power-up timers + scheduler (every 30–45s, never stacked on clusters) ---
      if (this.magnetT > 0) this.magnetT -= dt;
      if (this.multT > 0) this.multT -= dt;
      if (this.shield) { this.shieldT -= dt; if (this.shieldT <= 0) { this.shield = false; this.player.setShield(false); } }
      if (this.mercyT > 0) this.mercyT -= dt;
      this.powerClock -= dt;
      if (this.powerClock <= 0) {
        this.pendingPower = ['magnet', 'shield', 'mult'][Math.floor(Math.random() * 3)];
        this.powerClock = C.powerupEveryMin + Math.random() * (C.powerupEveryMax - C.powerupEveryMin);
      }
      // --- advance along heading ---
      const fwd = this._fwd(), right = this._right();
      this.dist += this.speed * dt;
      this.pos.addScaledVector(fwd, this.speed * dt);
      // --- lane spring (slight overshoot, not a snap) ---
      const target = this.laneIdx * C.laneWidth;
      const k = 90, damp = 13; // underdamped -> overshoot
      this.laneV += ((target - this.laneX) * k - this.laneV * damp) * dt;
      this.laneX += this.laneV * dt;
      this.pos.addScaledVector(right, 0); // lane applied below via offset
      const lanePos = this.pos.clone().addScaledVector(right, this.laneX - (this._lastLaneOff || 0));
      this._lastLaneOff = this.laneX;
      this.pos.copy(lanePos);
      // --- vertical ---
      if (!this.grounded) {
        this.vy += C.gravity * dt;
        this.py += this.vy * dt;
        if (this.py <= 0) { // landing
          this.py = 0; this.grounded = true; this.coyote = C.coyoteTime;
          this.audio.step(this.speed);
          this.world.puffAt(this.pos, 6, 1.6);
          this.kick = C.kickOnLand;
          for (const b of this.input.consumeBuffered(performance.now() / 1000)) {
            if (b === 'jump') this._jump();
            else if (b === 'slide') { if (this._wantSlide) { this.sliding = C.slideTime; this._wantSlide = 0; } else this._slide(); }
          }
          if (this._wantSlide) { this.sliding = C.slideTime; this._wantSlide = 0; }
        }
      } else this.coyote -= dt;
      if (this.sliding > 0) { this.sliding -= dt; if (Math.random() < 0.35) this.world.puffAt(this.pos, 1, 1.0); }
      // --- chunk streaming ---
      const last = this.world.chunks[this.world.chunks.length - 1];
      let tailD = last.startD + (last.travel ?? last.len);
      while (tailD < this.dist + 220) tailD = this._pushChunk(tailD);
      this.world.cull(this.dist);
      // --- turns ---
      this._updateTurn();
      // --- collisions / pickups ---
      this._collide();
      if (this.state !== 'playing') { this._updateHud(); return; } // died inside _collide
      // --- footsteps ---
      this.stepT -= dt;
      if (this.grounded && this.stepT <= 0) { this.audio.step(this.speed); this.stepT = lerp(0.42, 0.22, this._diff()); }
      this._updateHud();
    } else { // dying: fall + settle
      this.dieT += rawDt;
      if (this.fell) { this.py -= 22 * rawDt; this.player.group.position.y = this.py; }
      if (this.dieT > 1.25) { this._gameOver(); return; }
    }
    // --- shared visual updates ---
    const diff = this._diff();
    this.world.update(dt, this.pos, this.speed, diff);
    const sliding = this.sliding > 0;
    this.player.update(dt, this.speed, this.grounded, sliding, this.shield, this.world.time);
    this.player.group.position.set(this.pos.x, this.py, this.pos.z);
    this.player.group.rotation.y = this.yaw;
    this._camera(rawDt);
    // speed-lines + fov sell velocity
    const heat = (this.speed - C.startSpeed) / (C.maxSpeed - C.startSpeed);
    $('speedlines').style.opacity = this.state === 'playing' ? (heat * 0.85).toFixed(2) : 0;
    const wantFov = C.baseFov + heat * C.maxFovBoost;
    if (Math.abs(this.camera.fov - wantFov) > 0.05) {
      this.camera.fov += (wantFov - this.camera.fov) * Math.min(1, rawDt * 3);
      this.camera.updateProjectionMatrix();
    }
  }

  _updateTurn() {
    // look ahead: prompt early so high-speed turns stay fair
    let cand = null, candLocal = 0;
    for (const ch of this.world.chunks) {
      if (!ch.turn) continue;
      const local = this.dist - ch.startD;
      if (local >= ch.turn.triggerD - 17 && local < ch.turn.endD + 1.5) { cand = ch; candLocal = local; break; }
    }
    if (cand) {
      if (!this.turnInfo || this.turnInfo.chunk !== cand) {
        const side = cand.turn.side;
        const center = cand.entry.clone().addScaledVector(cand.fwd, cand.turn.endD);
        const exitYaw = cand.yaw + cand.exitYaw;
        const newFwd = new THREE.Vector3(0, 0, -1).applyAxisAngle(new THREE.Vector3(0, 1, 0), exitYaw);
        this.turnInfo = { side, center, exitYaw, newFwd, chunk: cand };
        $('turn-prompt').textContent = side < 0 ? '⬅ TURN!' : 'TURN! ➡';
        $('turn-prompt').style.display = 'block';
        if (this.bufferedTurn && performance.now() / 1000 - this.bufferedTurn.t < 0.35) {
          const d = this.bufferedTurn.d; this.bufferedTurn = null;
          this._doTurn(d); return;
        }
      }
    } else if (this.turnInfo) { // overshot the window without turning = wall
      const ti = this.turnInfo;
      const local = this.dist - ti.chunk.startD;
      this.turnInfo = null;
      $('turn-prompt').style.display = 'none';
      if (local >= ti.chunk.turn.endD + 1.0) this.die('You missed the burning gate and met the wall.');
    } else $('turn-prompt').style.display = 'none';
    if (this.bufferedTurn && performance.now() / 1000 - this.bufferedTurn.t > 0.4) this.bufferedTurn = null;
  }

  _camera(rawDt) {
    const C = this.cfg;
    const fwd = this._fwd(), right = this._right();
    // shake decay
    if (this.shake > 0) this.shake = Math.max(0, this.shake - rawDt * 1.6);
    if (this.kick > 0) this.kick = Math.max(0, this.kick - rawDt * 2.2);
    const t = this.world.time;
    const lag = clamp(this.laneX * 0.28, -0.8, 0.8); // touch of lag on lane changes
    const want = this.pos.clone()
      .addScaledVector(fwd, -C.camDist)
      .addScaledVector(right, -lag * 0.4)
      .add(new THREE.Vector3((Math.random() - .5) * this.shake * 0.7, C.camHeight + this.kick * 1.4 + (Math.random() - .5) * this.shake * 0.5, (Math.random() - .5) * this.shake * 0.7));
    want.y += Math.sin(t * 1.7) * 0.06 + Math.sin(t * 4.3) * 0.03; // handheld noise
    const sm = this.state === 'dying' ? 8 : 5.5;
    this.camera.position.lerp(want, Math.min(1, rawDt * sm));
    const look = this.pos.clone().addScaledVector(fwd, C.camLookAhead).add(new THREE.Vector3(0, 1.35, 0));
    if (!this._look) this._look = look.clone();
    this._look.lerp(look, Math.min(1, rawDt * 7));
    this.camera.lookAt(this._look);
  }

  _updateHud() {
    $('h-score').textContent = Math.floor(this.score);
    $('h-dist').textContent = Math.floor(this.dist) + 'm';
    $('h-coins').textContent = this.coins;
    const set = (id, on, label) => {
      const el = $(id);
      el.classList.toggle('on', on);
      if (on && label) el.querySelector('span').textContent = label;
    };
    set('p-magnet', this.magnetT > 0, Math.ceil(this.magnetT) + 's');
    set('p-shield', this.shield, '');
    set('p-mult', this.multT > 0, Math.ceil(this.multT) + 's');
  }
}
