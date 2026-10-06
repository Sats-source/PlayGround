// audio.js — all sound is synthesized with Web Audio. No audio files.
// Call ensure() from a user gesture; ambient bed = tanpura-ish drone +
// filtered noise wind + slow temple-drum pulse + rare bell.
export class AudioSys {
  constructor() {
    this.ctx = null; this.master = null; this.muted = false;
    this.ambOn = false; this.stepIdx = 0;
  }
  ensure() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    this.startAmbient();
  }
  toggleMute() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.8;
    return this.muted;
  }
  _env(node, t0, a, peak, d) {
    node.gain.setValueAtTime(0.0001, t0);
    node.gain.exponentialRampToValueAtTime(peak, t0 + a);
    node.gain.exponentialRampToValueAtTime(0.0001, t0 + a + d);
  }
  _osc(type, freq, t0, dur, peak = 0.25, slideTo = null) {
    if (!this.ctx || this.muted) return;
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(freq, t0);
    if (slideTo) o.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    this._env(g, t0, 0.008, peak, dur);
    o.connect(g); g.connect(this.master);
    o.start(t0); o.stop(t0 + dur + 0.1);
  }
  _noise(t0, dur, peak = 0.2, filterFreq = 1200, type = 'bandpass') {
    if (!this.ctx || this.muted) return;
    const len = Math.max(1, Math.floor(this.ctx.sampleRate * dur));
    const buf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    const src = this.ctx.createBufferSource(); src.buffer = buf;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = filterFreq;
    const g = this.ctx.createGain();
    this._env(g, t0, 0.01, peak, dur);
    src.connect(f); f.connect(g); g.connect(this.master);
    src.start(t0); src.stop(t0 + dur + 0.1);
  }
  now() { return this.ctx ? this.ctx.currentTime : 0; }
  coin() { // small bronze bell: two detuned partials
    if (!this.ctx) return; const t = this.now();
    this._osc('triangle', 1568, t, 0.35, 0.16);
    this._osc('sine', 2093, t + 0.02, 0.4, 0.12);
    this._osc('sine', 2637, t + 0.04, 0.3, 0.06);
  }
  power() { if (!this.ctx) return; const t = this.now();
    this._osc('sine', 523, t, 0.4, 0.2, 1046); this._osc('sine', 784, t + 0.1, 0.5, 0.18, 1568); }
  jump() { this._noise(this.now(), 0.22, 0.12, 900, 'highpass'); }
  slide() { this._noise(this.now(), 0.4, 0.16, 500, 'lowpass'); }
  step(speed) { // stone footstep, pitch varies with speed
    if (!this.ctx) return;
    this.stepIdx++;
    const f = 140 + Math.random() * 60 + speed * 3;
    this._noise(this.now(), 0.07, 0.10, f, 'lowpass');
  }
  crash() { if (!this.ctx) return; const t = this.now();
    this._noise(t, 0.5, 0.4, 160, 'lowpass'); this._osc('sine', 120, t, 0.5, 0.35, 38); }
  turn() { this._noise(this.now(), 0.18, 0.1, 1600, 'bandpass'); }
  click() { if (!this.ctx) return; this._osc('square', 660, this.now(), 0.06, 0.06); }
  startAmbient() {
    if (!this.ctx || this.ambOn) return; this.ambOn = true;
    const c = this.ctx;
    // tanpura-ish drone: root+fifth+octave saws through lowpass, slow tremolo
    const droneG = c.createGain(); droneG.gain.value = 0.045; droneG.connect(this.master);
    const lp = c.createBiquadFilter(); lp.type = 'lowpass'; lp.frequency.value = 420; lp.connect(droneG);
    [110, 164.8, 220, 277.2].forEach((f) => {
      const o = c.createOscillator(); o.type = 'sawtooth'; o.frequency.value = f * (1 + (Math.random() - .5) * 0.002);
      const g = c.createGain(); g.gain.value = 0.25; o.connect(g); g.connect(lp); o.start();
    });
    const lfo = c.createOscillator(); lfo.frequency.value = 0.13;
    const lg = c.createGain(); lg.gain.value = 0.02; lfo.connect(lg); lg.connect(droneG.gain); lfo.start();
    // wind: looped noise through wandering bandpass
    const nlen = c.sampleRate * 3; const nb = c.createBuffer(1, nlen, c.sampleRate);
    const nd = nb.getChannelData(0); let v = 0;
    for (let i = 0; i < nlen; i++) { v = v * 0.97 + (Math.random() * 2 - 1) * 0.03; nd[i] = v * 8; }
    const ns = c.createBufferSource(); ns.buffer = nb; ns.loop = true;
    const nf = c.createBiquadFilter(); nf.type = 'bandpass'; nf.frequency.value = 500; nf.Q.value = 0.6;
    const ng = c.createGain(); ng.gain.value = c ? 0.10 : 0;
    ns.connect(nf); nf.connect(ng); ng.connect(this.master); ns.start();
    const wlfo = c.createOscillator(); wlfo.frequency.value = 0.07;
    const wg = c.createGain(); wg.gain.value = 260; wlfo.connect(wg); wg.connect(nf.frequency); wlfo.start();
    // distant temple drums: low thump pattern
    const drum = () => {
      if (!this.muted) { const t = this.now(); this._osc('sine', 72, t, 0.5, 0.10, 40); }
      setTimeout(drum, 1400 + Math.random() * 2200);
    };
    setTimeout(drum, 1200);
    // rare distant bell
    const bell = () => {
      if (!this.muted && this.ctx) { const t = this.now(); this._osc('sine', 880, t, 2.2, 0.02); this._osc('sine', 1320, t, 1.8, 0.012); }
      setTimeout(bell, 9000 + Math.random() * 14000);
    };
    setTimeout(bell, 6000);
  }
}
