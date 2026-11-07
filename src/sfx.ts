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

  /** Steady rain bed under everything. */
  private startRain(): void {
    const ctx = this.ctx!;
    const src = ctx.createBufferSource();
    src.buffer = this.noise;
    src.loop = true;
    const f = ctx.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = 2500;
    f.Q.value = 0.4;
    const g = ctx.createGain();
    g.gain.value = 0.07;
    src.connect(f).connect(g).connect(this.master);
    src.start();
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
}

export const sfx = new Sfx();
