// Procedural sound effects, same approach as Misprint: synthesized WebAudio, no files.
import type { HeroId } from './config';

class Sfx {
  private ctx: AudioContext | null = null;
  private master!: GainNode;
  private noise!: AudioBuffer;
  private last: Record<string, number> = {};
  muted = false;

  constructor() {
    const unlock = () => this.unlock();
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', unlock);
  }

  private unlock(): void {
    if (!this.ctx) {
      const ctx = new AudioContext();
      const comp = ctx.createDynamicsCompressor();
      comp.threshold.value = -14;
      comp.ratio.value = 6;
      comp.connect(ctx.destination);
      this.master = ctx.createGain();
      this.master.gain.value = this.muted ? 0 : 0.5;
      this.master.connect(comp);
      this.noise = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
      const d = this.noise.getChannelData(0);
      for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
      this.ctx = ctx;
      this.startRain();
    }
    if (this.ctx.state === 'suspended') void this.ctx.resume();
  }

  toggleMute(): void {
    this.muted = !this.muted;
    if (this.ctx) this.master.gain.setTargetAtTime(this.muted ? 0 : 0.5, this.ctx.currentTime, 0.02);
  }

  /** Returns the context if sound can play and `key` was not played in the last `gap` seconds. */
  private ready(key: string, gap: number): AudioContext | null {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running' || this.muted) return null;
    if (ctx.currentTime - (this.last[key] ?? -1) < gap) return null;
    this.last[key] = ctx.currentTime;
    return ctx;
  }

  private env(ctx: AudioContext, peak: number, attack: number, decay: number, t = ctx.currentTime): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.master);
    return g;
  }

  private tone(ctx: AudioContext, type: OscillatorType, f0: number, f1: number, dur: number, out: AudioNode, t = ctx.currentTime): void {
    const o = ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    o.connect(out);
    o.start(t);
    o.stop(t + dur + 0.02);
  }

  private hiss(ctx: AudioContext, type: BiquadFilterType, f0: number, f1: number, dur: number, out: AudioNode, q = 1.2, t = ctx.currentTime): void {
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = type;
    f.Q.value = q;
    f.frequency.setValueAtTime(f0, t);
    f.frequency.exponentialRampToValueAtTime(f1, t + dur);
    src.connect(f).connect(out);
    src.start(t, Math.random());
    src.stop(t + dur + 0.02);
  }

  private rainBus: GainNode | null = null;

  /** 0 drizzle to 1 downpour: louder rain as the dry circle shrinks. */
  setRain(k: number): void {
    if (this.rainBus && this.ctx) this.rainBus.gain.setTargetAtTime(0.7 + k * 0.9, this.ctx.currentTime, 0.5);
  }

  /** Thunder: a crack, then a long rolling rumble, arriving `delay` s after the flash. */
  thunder(delay: number, vol: number): void {
    const ctx = this.ready('thunder', 2);
    if (!ctx) return;
    const t = ctx.currentTime + delay;
    this.hiss(ctx, 'lowpass', 2500, 300, 0.25, this.env(ctx, 0.35 * vol, 0.005, 0.3, t), 1, t);
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(0.7 * vol, t + 0.15);
    g.gain.setTargetAtTime(0.25 * vol, t + 0.3, 0.4);
    g.gain.exponentialRampToValueAtTime(0.0001, t + 3.2);
    g.connect(this.master);
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    const f = ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(260, t);
    f.frequency.exponentialRampToValueAtTime(70, t + 3);
    src.connect(f).connect(g);
    src.start(t);
    src.stop(t + 3.3);
  }

  /**
   * Rain in three layers, so it reads as rain rather than hiss:
   * a soft low rumble (brown noise, not white), random droplet plinks on top,
   * and a slow swell so the downpour breathes instead of sitting flat.
   */
  private startRain(): void {
    const ctx = this.ctx!;
    const bus = ctx.createGain();
    bus.gain.value = 0.7;
    bus.connect(this.master);
    this.rainBus = bus;

    // 1. Rumble: brown noise is noise integrated over time, so its energy sits low and soft.
    const brown = ctx.createBuffer(1, ctx.sampleRate * 4, ctx.sampleRate);
    const d = brown.getChannelData(0);
    let last = 0;
    for (let i = 0; i < d.length; i++) {
      last = (last + 0.02 * (Math.random() * 2 - 1)) / 1.02;
      d[i] = last * 3.5;
    }
    const bed = ctx.createBufferSource();
    bed.buffer = brown;
    bed.loop = true;
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = 900;
    const bedGain = ctx.createGain();
    bedGain.gain.value = 0.16;
    bed.connect(lp).connect(bedGain).connect(bus);
    bed.start();

    // 2. Patter: a very quiet, gently filtered wash for the fine spray between drops.
    const spray = ctx.createBufferSource();
    spray.buffer = this.noise;
    spray.loop = true;
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 5000;
    bp.Q.value = 0.7;
    const sprayGain = ctx.createGain();
    sprayGain.gain.value = 0.012;
    spray.connect(bp).connect(sprayGain).connect(bus);
    spray.start();

    // 3. Swell: a slow LFO on the whole bed, about one breath every 9 seconds.
    const lfo = ctx.createOscillator();
    lfo.frequency.value = 0.11;
    const depth = ctx.createGain();
    depth.gain.value = 0.05;
    lfo.connect(depth).connect(bedGain.gain);
    lfo.start();

    // Droplets: schedule a handful of short plinks just ahead of time.
    let next = ctx.currentTime;
    window.setInterval(() => {
      if (ctx.state !== 'running') return;
      if (next < ctx.currentTime) next = ctx.currentTime;
      while (next < ctx.currentTime + 0.15) {
        this.drop(ctx, bus, next);
        next += 0.02 + Math.random() * 0.08; // uneven spacing, a few dozen drops a second
      }
    }, 50);
  }

  /** One drop: a tiny rising sine chirp (the "plink" of water hitting water) or a dry tick on asphalt. */
  private drop(ctx: AudioContext, out: AudioNode, t: number): void {
    if (this.muted) return;
    const g = ctx.createGain();
    const peak = 0.01 + Math.random() * Math.random() * 0.05;
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.002);
    if (Math.random() < 0.55) {
      const f = 1200 + Math.random() * 2800;
      const o = ctx.createOscillator();
      o.type = 'sine';
      o.frequency.setValueAtTime(f, t);
      o.frequency.exponentialRampToValueAtTime(f * 1.6, t + 0.025);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.035);
      o.connect(g).connect(out);
      o.start(t);
      o.stop(t + 0.04);
    } else {
      const src = ctx.createBufferSource();
      src.buffer = this.noise;
      const f = ctx.createBiquadFilter();
      f.type = 'bandpass';
      f.frequency.value = 2500 + Math.random() * 4000;
      f.Q.value = 8;
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.012);
      src.connect(f).connect(g).connect(out);
      src.start(t, Math.random());
      src.stop(t + 0.015);
    }
  }

  shoot(hero: HeroId, near: boolean): void {
    const ctx = this.ready(`shoot-${near}`, 0.04);
    if (!ctx) return;
    const v = near ? 1 : 0.35;
    if (hero === 'smudge') {
      this.hiss(ctx, 'lowpass', 3000, 400, 0.16, this.env(ctx, 0.5 * v, 0.003, 0.16));
      this.tone(ctx, 'sine', 160, 60, 0.12, this.env(ctx, 0.4 * v, 0.003, 0.12));
    } else if (hero === 'stretch') {
      this.hiss(ctx, 'highpass', 4000, 1500, 0.09, this.env(ctx, 0.4 * v, 0.002, 0.1));
      this.tone(ctx, 'square', 900, 180, 0.18, this.env(ctx, 0.18 * v, 0.002, 0.18));
    } else {
      this.hiss(ctx, 'bandpass', 2200, 700, 0.08, this.env(ctx, 0.35 * v, 0.002, 0.08));
      this.tone(ctx, 'triangle', 420, 160, 0.09, this.env(ctx, 0.3 * v, 0.002, 0.09));
    }
  }

  /** Chalk crumble when a shot lands on someone. */
  hit(onPlayer: boolean): void {
    const ctx = this.ready(`hit-${onPlayer}`, 0.05);
    if (!ctx) return;
    this.hiss(ctx, 'bandpass', 1400, 500, 0.12, this.env(ctx, onPlayer ? 0.55 : 0.3, 0.002, 0.12), 2);
    if (onPlayer) this.tone(ctx, 'sawtooth', 220, 90, 0.16, this.env(ctx, 0.2, 0.002, 0.16));
  }

  wallHit(): void {
    const ctx = this.ready('wall', 0.05);
    if (!ctx) return;
    this.hiss(ctx, 'bandpass', 900, 300, 0.07, this.env(ctx, 0.25, 0.002, 0.07), 3);
  }

  /** Chalk scraping on asphalt while drawing cover. */
  scratch(): void {
    const ctx = this.ready('scratch', 0.06);
    if (!ctx) return;
    this.hiss(ctx, 'bandpass', 3500 + Math.random() * 1500, 2500, 0.07, this.env(ctx, 0.18, 0.005, 0.07), 6);
  }

  ko(ally: boolean): void {
    const ctx = this.ready('ko', 0.1);
    if (!ctx) return;
    const t = ctx.currentTime;
    this.tone(ctx, 'triangle', ally ? 500 : 700, ally ? 120 : 220, 0.45, this.env(ctx, 0.35, 0.005, 0.45, t), t);
    this.hiss(ctx, 'lowpass', 2500, 200, 0.4, this.env(ctx, 0.3, 0.01, 0.4, t), 1, t);
  }

  end(won: boolean): void {
    const ctx = this.ready('end', 1);
    if (!ctx) return;
    const notes = won ? [392, 494, 587, 784] : [392, 330, 262, 196];
    notes.forEach((f, i) => {
      const t = ctx.currentTime + i * 0.14;
      this.tone(ctx, 'triangle', f, f, 0.22, this.env(ctx, 0.3, 0.01, 0.25, t), t);
    });
  }

  // ---------- music ----------
  // A step sequencer like Misprint's, but moodier: D minor, i - VI - iv - V, and it builds
  // with the storm. At 0 it is a pad, a soft kick and chalk scratches; by 1 it is driving.

  private musicBus: GainNode | null = null;
  private seqTimer: number | null = null;
  private nextTime = 0;
  private step = 0;
  private storm = 0;

  /** 0 at kick-off, 1 once the dry circle is at its smallest. */
  setStorm(k: number): void {
    this.storm = Math.max(0, Math.min(1, k));
  }

  startMusic(): void {
    this.stopMusic();
    this.step = 0;
    this.nextTime = 0;
    const ctx = this.ctx;
    if (ctx && this.musicBus) {
      this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
      this.musicBus.gain.setTargetAtTime(0.3, ctx.currentTime, 0.3);
    }
    this.seqTimer = window.setInterval(() => this.schedule(), 25);
  }

  stopMusic(): void {
    if (this.seqTimer !== null) window.clearInterval(this.seqTimer);
    this.seqTimer = null;
    const ctx = this.ctx;
    if (ctx && this.musicBus) {
      this.musicBus.gain.cancelScheduledValues(ctx.currentTime);
      this.musicBus.gain.setTargetAtTime(0, ctx.currentTime, 0.15);
    }
  }

  private schedule(): void {
    const ctx = this.ctx;
    if (!ctx || ctx.state !== 'running') return;
    if (!this.musicBus) {
      // Created lazily: the context only exists after the first click or key press.
      this.musicBus = ctx.createGain();
      this.musicBus.gain.value = 0.3;
      this.musicBus.connect(this.master);
    }
    // First tick or a backgrounded tab: resync instead of bursting to catch up.
    if (this.nextTime < ctx.currentTime - 0.2) this.nextTime = ctx.currentTime + 0.06;
    while (this.nextTime < ctx.currentTime + 0.12) {
      if (!this.muted) this.playStep(this.step, this.nextTime);
      const bpm = 84 + this.storm * 46; // 84 to 130 BPM
      this.nextTime += 60 / bpm / 4;
      this.step = (this.step + 1) % 64;
    }
  }

  private out(ctx: AudioContext, peak: number, attack: number, decay: number, t: number): GainNode {
    const g = ctx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + decay);
    g.connect(this.musicBus!);
    return g;
  }

  private playStep(step: number, t: number): void {
    const ctx = this.ctx!;
    const k = this.storm;
    const s16 = step % 16;
    const bar = (step / 16) | 0;
    const root = [0, -4, 5, 7][bar]; // Dm, Bb, Gm, A, in semitones from D
    const D2 = 73.42;
    const hz = (semi: number) => D2 * Math.pow(2, semi / 12);
    const barLen = (60 / (84 + k * 46)) * 4;

    // Pad: a minor triad (major on the A bar, for the pull back home), detuned saws, slow swell.
    if (s16 === 0) {
      const third = bar === 3 ? 4 : 3;
      const f = ctx.createBiquadFilter();
      f.type = 'lowpass';
      f.frequency.value = 500 + k * 1400;
      f.connect(this.out(ctx, 0.09, barLen * 0.35, barLen * 0.75, t));
      for (const semi of [12, 12 + third, 19]) {
        for (const det of [-6, 6]) {
          const o = ctx.createOscillator();
          o.type = 'sawtooth';
          o.frequency.value = hz(root + semi);
          o.detune.value = det;
          o.connect(f);
          o.start(t);
          o.stop(t + barLen * 1.15);
        }
      }
    }
    // Kick: every beat, plus a pickup once it gets busy.
    if (s16 % 4 === 0 || (k > 0.55 && s16 === 14)) {
      this.tone(ctx, 'sine', 120, 40, 0.22, this.out(ctx, 0.7 + k * 0.2, 0.003, 0.24, t), t);
    }
    // Chalk scratch: the signature, a dry bandpassed scrape on the off-beats.
    if (s16 % 4 === 2 || (k > 0.35 && s16 % 2 === 1 && Math.random() < 0.5)) {
      this.hiss(ctx, 'bandpass', 4200 + Math.random() * 1500, 2600, 0.05, this.out(ctx, 0.12, 0.004, 0.05, t), 7, t);
    }
    // Clap/snare on 2 and 4 from a quarter of the way in.
    if (k > 0.25 && (s16 === 4 || s16 === 12)) {
      this.hiss(ctx, 'bandpass', 1600, 800, 0.14, this.out(ctx, 0.32, 0.002, 0.14, t), 1, t);
      this.tone(ctx, 'triangle', 200, 140, 0.07, this.out(ctx, 0.15, 0.002, 0.07, t), t);
    }
    // Bass from 15% in: root pulses, octave hop, walking up into the next chord.
    if (k > 0.15) {
      const line = [0, null, 0, null, 0, 12, null, 0, null, 0, null, 7, null, 0, 3, 5][s16];
      if (line !== null) {
        const f = ctx.createBiquadFilter();
        f.type = 'lowpass';
        f.frequency.value = 350 + k * 900;
        f.Q.value = 4;
        f.connect(this.out(ctx, 0.26, 0.004, 0.16, t));
        const fq = hz(root + line);
        this.tone(ctx, 'square', fq, fq, 0.16, f, t);
      }
    }
    // Arp at half storm: minor pentatonic run, an octave up.
    if (k > 0.5 && s16 % 2 === 0) {
      const run = [12, 15, 17, 19, 22, 19, 17, 15];
      const fq = hz(root + 12 + run[(s16 / 2) % 8]);
      this.tone(ctx, 'triangle', fq, fq, 0.12, this.out(ctx, 0.08, 0.004, 0.12, t), t);
    }
    // Downpour: 16th hats and a tom fill into each new bar.
    if (k > 0.75) {
      this.hiss(ctx, 'highpass', 8000, 7000, 0.025, this.out(ctx, s16 % 4 === 2 ? 0.12 : 0.05, 0.001, 0.03, t), 1, t);
      if (s16 >= 13) this.tone(ctx, 'sine', 180 - (s16 - 13) * 30, 70, 0.14, this.out(ctx, 0.3, 0.003, 0.15, t), t);
    }
  }
}

export const sfx = new Sfx();
