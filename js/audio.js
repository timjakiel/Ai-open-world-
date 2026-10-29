'use strict';
// Tiny synthesized sound kit. Starts on the first user gesture.

const Sound = {
  ctx: null, master: null, muted: false, noiseBuf: null, rain: null, wind: null,

  init() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    try {
      const AC = window.AudioContext || window.webkitAudioContext;
      this.ctx = new AC();
    } catch (e) { return; }
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.55;
    this.master.connect(this.ctx.destination);
    const len = this.ctx.sampleRate * 2;
    this.noiseBuf = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noiseBuf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
    this.rain = this.loopNoise('lowpass', 1400);
    this.wind = this.loopNoise('bandpass', 380);
  },

  loopNoise(type, freq) {
    const src = this.ctx.createBufferSource();
    src.buffer = this.noiseBuf; src.loop = true;
    const f = this.ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq;
    const g = this.ctx.createGain(); g.gain.value = 0;
    src.connect(f); f.connect(g); g.connect(this.master); src.start();
    return g;
  },

  setAmbient(rain, wind) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.rain.gain.setTargetAtTime(rain * 0.22, t, 0.5);
    this.wind.gain.setTargetAtTime(wind * 0.16, t, 0.8);
  },

  toggle() {
    this.muted = !this.muted;
    if (this.master) this.master.gain.value = this.muted ? 0 : 0.55;
    return this.muted;
  },

  tone(type, f0, f1, dur, vol, delay) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + (delay || 0);
    const o = this.ctx.createOscillator(), g = this.ctx.createGain();
    o.type = type; o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(Math.max(1, f1), t + dur);
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g); g.connect(this.master); o.start(t); o.stop(t + dur + 0.02);
  },

  noise(dur, vol, type, freq, delay) {
    if (!this.ctx || this.muted) return;
    const t = this.ctx.currentTime + (delay || 0);
    const s = this.ctx.createBufferSource(); s.buffer = this.noiseBuf;
    const f = this.ctx.createBiquadFilter(); f.type = type || 'lowpass'; f.frequency.value = freq || 1000;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(this.master);
    s.start(t, Math.random() * 1.5); s.stop(t + dur + 0.02);
  },

  play(name) {
    switch (name) {
      case 'swing': this.noise(0.12, 0.18, 'highpass', 2500); break;
      case 'chop': this.tone('square', 140, 70, 0.08, 0.12); this.noise(0.09, 0.3, 'bandpass', 900); break;
      case 'mine': this.tone('triangle', 1300, 900, 0.09, 0.15); this.noise(0.06, 0.25, 'highpass', 3000); break;
      case 'leaf': this.noise(0.14, 0.2, 'bandpass', 2200); break;
      case 'hit': this.noise(0.1, 0.35, 'lowpass', 700); this.tone('sine', 180, 60, 0.12, 0.25); break;
      case 'hurt': this.tone('sawtooth', 240, 70, 0.22, 0.2); this.noise(0.12, 0.25, 'lowpass', 500); break;
      case 'pickup': this.tone('sine', 700, 1100, 0.08, 0.12); break;
      case 'craft': this.tone('triangle', 520, 520, 0.09, 0.15); this.tone('triangle', 780, 780, 0.14, 0.15, 0.09); break;
      case 'eat': this.noise(0.05, 0.25, 'bandpass', 1200); this.noise(0.05, 0.25, 'bandpass', 1000, 0.1); this.noise(0.05, 0.2, 'bandpass', 1100, 0.2); break;
      case 'drink': this.tone('sine', 400, 260, 0.1, 0.15); this.tone('sine', 420, 280, 0.1, 0.15, 0.14); break;
      case 'shoot': this.tone('triangle', 300, 900, 0.1, 0.15); this.noise(0.08, 0.15, 'highpass', 4000); break;
      case 'place': this.noise(0.12, 0.35, 'lowpass', 400); this.tone('sine', 120, 80, 0.1, 0.2); break;
      case 'die': this.tone('sine', 300, 40, 0.5, 0.2); break;
      case 'howl': this.tone('sine', 330, 560, 0.7, 0.07); this.tone('sine', 560, 380, 0.9, 0.07, 0.7); break;
      case 'roar': this.tone('sawtooth', 90, 40, 1.0, 0.3); this.noise(0.9, 0.3, 'lowpass', 300); break;
      case 'shrine': [392, 494, 587, 784].forEach((f, i) => this.tone('sine', f, f, 0.6, 0.12, i * 0.15)); break;
      case 'thunder': this.noise(1.8, 0.6, 'lowpass', 160); this.noise(0.3, 0.3, 'lowpass', 900); break;
      case 'crackle': this.noise(0.03, 0.08, 'highpass', 2000); break;
      case 'win': [523, 659, 784, 1047, 1319].forEach((f, i) => this.tone('triangle', f, f, 0.8, 0.13, i * 0.18)); break;
      case 'night': this.tone('sine', 220, 165, 1.4, 0.12); this.tone('sine', 330, 247, 1.4, 0.08, 0.2); break;
      case 'day': [330, 392, 494].forEach((f, i) => this.tone('sine', f, f, 0.5, 0.08, i * 0.12)); break;
    }
  },
};
