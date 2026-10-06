// input.js — keyboard, 4-direction swipe, on-screen buttons, pause/mute.
// Emits semantic actions via callback. Buffers jump/slide/turn so a swipe
// issued mid-air registers on landing (buffer window ~0.25s).
export class Input {
  constructor(callbacks) {
    this.cb = callbacks; // {onAction(name), onPause(), onMute(), onAny()}
    this.buffer = [];    // [{name, t}]
    this.bufferWindow = 0.28;
    this.touchStart = null;
    this._bind();
    if ('ontouchstart' in window) document.body.classList.add('touch');
  }
  _bind() {
    window.addEventListener('keydown', (e) => {
      if (e.repeat) return;
      const k = e.key.toLowerCase();
      this.cb.onAny && this.cb.onAny(k);
      if (k === 'arrowleft' || k === 'a') this.press('left');
      else if (k === 'arrowright' || k === 'd') this.press('right');
      else if (k === 'arrowup' || k === 'w' || k === ' ') { e.preventDefault(); this.press('jump'); }
      else if (k === 'arrowdown' || k === 's') this.press('slide');
      else if (k === 'p' || k === 'escape') this.cb.onPause && this.cb.onPause();
      else if (k === 'm') this.cb.onMute && this.cb.onMute();
      else if (k === 'enter') this.cb.onConfirm && this.cb.onConfirm();
    });
    const c = document.getElementById('game-canvas');
    c.addEventListener('touchstart', (e) => {
      const t = e.changedTouches[0];
      this.touchStart = { x: t.clientX, y: t.clientY, t: performance.now() };
    }, { passive: true });
    c.addEventListener('touchend', (e) => {
      if (!this.touchStart) return;
      const t = e.changedTouches[0];
      const dx = t.clientX - this.touchStart.x, dy = t.clientY - this.touchStart.y;
      const adx = Math.abs(dx), ady = Math.abs(dy);
      this.cb.onAny && this.cb.onAny('swipe');
      if (Math.max(adx, ady) < 24) { this.press('jump'); } // tap = jump
      else if (adx > ady) this.press(dx > 0 ? 'right' : 'left');
      else this.press(dy < 0 ? 'jump' : 'slide');
      this.touchStart = null;
    }, { passive: true });
    const btn = (id, name) => {
      const el = document.getElementById(id);
      if (el) el.addEventListener('touchstart', (e) => { e.preventDefault(); this.press(name); }, { passive: false });
      if (el) el.addEventListener('mousedown', (e) => { e.preventDefault(); this.press(name); });
    };
    btn('t-left', 'left'); btn('t-right', 'right');
    btn('t-jump', 'jump'); btn('t-slide', 'slide');
  }
  press(name) {
    // turn inputs are consumed immediately by game; jump/slide can buffer
    this.cb.onAction && this.cb.onAction(name);
    if (name === 'jump' || name === 'slide') {
      this.buffer.push({ name, t: performance.now() / 1000 });
    }
  }
  // game calls this when it becomes able to act (e.g. on landing)
  consumeBuffered(now) {
    const out = [];
    this.buffer = this.buffer.filter((b) => {
      if (now - b.t <= this.bufferWindow) { out.push(b.name); return false; }
      return false; // drop stale
    });
    return out;
  }
  clearBuffer() { this.buffer = []; }
}
