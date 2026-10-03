// Every sound is synthesised with Web Audio: no files to download. Coins are a few
// inharmonic partials with a fast decay (that's what makes metal sound like metal);
// the cup is a lower ceramic tap; jingles use a pentatonic scale.

const STORAGE_KEY = "zeni.sound";
const MAX_HITS_PER_BATCH = 3;

type Wave = OscillatorType;

class Sound {
  private ctx: AudioContext | null = null;
  private out: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  enabled = readSetting();

  /** Browsers only allow audio after a user gesture; call this from one. */
  unlock(): void {
    if (!this.ctx) {
      const Ctx = window.AudioContext ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      if (!Ctx) return;
      this.ctx = new Ctx();
      this.out = this.ctx.createGain();
      this.out.gain.value = 0.6;
      this.out.connect(this.ctx.destination);
      this.noise = this.makeNoise();
    }
    if (this.ctx.state === "suspended") void this.ctx.resume();
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(STORAGE_KEY, on ? "on" : "off");
    } catch {
      // Storage can be unavailable (private mode); the setting just won't persist.
    }
  }

  private ready(): AudioContext | null {
    return this.enabled && this.ctx && this.ctx.state === "running" ? this.ctx : null;
  }

  // --- Building blocks ------------------------------------------------------

  private makeNoise(): AudioBuffer {
    const ctx = this.ctx!;
    const buf = ctx.createBuffer(1, ctx.sampleRate * 0.5, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  /** A single decaying partial. */
  private tone(freq: number, gain: number, decay: number, at = 0, wave: Wave = "sine", attack = 0.002): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = wave;
    osc.frequency.value = freq;
    g.gain.setValueAtTime(0, t);
    g.gain.linearRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    osc.connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + attack + decay + 0.05);
  }

  /** A burst of filtered noise: clicks, swishes, scrapes. */
  private hiss(gain: number, duration: number, from: number, to: number, at = 0, q = 1): void {
    const ctx = this.ctx!;
    const t = ctx.currentTime + at;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const filter = ctx.createBiquadFilter();
    filter.type = "bandpass";
    filter.Q.value = q;
    filter.frequency.setValueAtTime(from, t);
    filter.frequency.exponentialRampToValueAtTime(to, t + duration);
    const g = ctx.createGain();
    g.gain.setValueAtTime(gain, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + duration);
    src.connect(filter).connect(g).connect(this.out!);
    src.start(t);
    src.stop(t + duration + 0.05);
  }

  /** Metallic strike: inharmonic partials plus a click. */
  private metal(base: number, gain: number, at = 0): void {
    for (const [ratio, amp, decay] of [
      [1, 1, 0.16],
      [1.47, 0.6, 0.11],
      [2.09, 0.45, 0.08],
      [2.56, 0.3, 0.06],
    ]) {
      this.tone(base * ratio, gain * amp, decay, at, "sine");
    }
    this.hiss(gain * 0.8, 0.02, 6000, 3000, at, 0.7);
  }

  // --- Game sounds ----------------------------------------------------------

  /** Coin on coin. `impulse` is the hit strength from the physics, in units/s. */
  clack(impulse: number): void {
    if (!this.ready()) return;
    const gain = Math.min(0.5, 0.06 + impulse / 2500);
    this.metal(2300 * (0.92 + Math.random() * 0.16), gain);
  }

  /** Coin against a tea cup. */
  tap(impulse: number): void {
    if (!this.ready()) return;
    const gain = Math.min(0.45, 0.05 + impulse / 3000);
    this.tone(1650 * (0.95 + Math.random() * 0.1), gain, 0.22);
    this.tone(3420, gain * 0.35, 0.12);
    this.tone(190, gain * 0.6, 0.06, 0, "triangle");
  }

  /** The finger flick that sends a coin off. */
  flick(power: number): void {
    if (!this.ready()) return;
    this.hiss(0.08 + power * 0.25, 0.09, 900, 3200, 0, 1.2);
    this.tone(320, 0.08 + power * 0.1, 0.04, 0, "triangle");
  }

  /** A coin kept: a bright two-note chime. */
  keep(): void {
    if (!this.ready()) return;
    this.tone(1046.5, 0.18, 0.5, 0, "sine", 0.005);
    this.tone(1568, 0.14, 0.6, 0.09, "sine", 0.005);
  }

  /** A coin going over the edge: a drop, then it lands and rattles on the floor. */
  fall(): void {
    const ctx = this.ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.type = "sine";
    osc.frequency.setValueAtTime(520, t);
    osc.frequency.exponentialRampToValueAtTime(140, t + 0.28);
    g.gain.setValueAtTime(0.12, t);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 0.3);
    osc.connect(g).connect(this.out!);
    osc.start(t);
    osc.stop(t + 0.35);
    // Lands and rattles: quieter, faster bounces.
    [0.34, 0.47, 0.55, 0.6].forEach((at, i) => this.metal(1700 - i * 60, 0.16 / (i + 1), at));
  }

  win(): void {
    if (!this.ready()) return;
    [523.25, 587.33, 659.25, 783.99, 1046.5].forEach((f, i) => this.tone(f, 0.16, 0.5, i * 0.11, "triangle", 0.01));
  }

  lose(): void {
    if (!this.ready()) return;
    [392, 349.23, 293.66].forEach((f, i) => this.tone(f, 0.14, 0.6, i * 0.18, "triangle", 0.01));
  }

  /** Physics events from one stretch of playback. Caps hits so a big break doesn't distort. */
  events(events: { type: string; impulse?: number }[]): void {
    let hits = 0;
    for (const e of events) {
      if (e.type === "hit" && hits++ < MAX_HITS_PER_BATCH) this.clack(e.impulse!);
      else if (e.type === "cup") this.tap(e.impulse!);
      else if (e.type === "fall") this.fall();
    }
  }
}

function readSetting(): boolean {
  try {
    return localStorage.getItem(STORAGE_KEY) !== "off";
  } catch {
    return true;
  }
}

export const sound = new Sound();
