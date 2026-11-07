import * as THREE from 'three';
import { smearTexture, textTexture } from './chalk';
import { sfx } from './sfx';
import type { World } from './world';

interface Float {
  sprite: THREE.Sprite;
  vy: number;
  life: number;
  max: number;
  pop: number; // starting scale multiplier, eases to 1
  w: number;
  h: number;
}

interface Fade {
  obj: THREE.Mesh;
  life: number;
  max: number;
  grow: number;
  base: number;
}

// Shared geometry: ripples and stains spawn constantly, and a new geometry per spawn
// would leak GPU buffers. Marked shared so match cleanup does not dispose them.
const PLANE = new THREE.PlaneGeometry(1, 1);
const RING = new THREE.RingGeometry(0.85, 1, 24);
PLANE.userData.shared = RING.userData.shared = true;

const CAM_POS = new THREE.Vector3(0, 38, 21);
const CAM_LOOK = new THREE.Vector3(0, 0, 0.6);

/**
 * Game feel: hit-stop, slow motion, camera shake and drift, floating chalk words,
 * ground stains the rain washes away, puddle ripples and lightning.
 */
export class Fx {
  private shakeAmt = 0;
  private stopT = 0;
  private slowT = 0;
  private slowScale = 1;
  private floats: Float[] = [];
  private stains: Fade[] = [];
  private ripples: Fade[] = [];
  private drift = new THREE.Vector3();
  private flashEl: HTMLDivElement;
  private flashA = 0;
  private flashColor = '255,255,255';
  private nextBolt = 9;
  private boltQueue: number[] = [];
  private clock = 0;

  constructor(
    private world: World,
    private group: THREE.Group,
  ) {
    this.flashEl = document.createElement('div');
    this.flashEl.style.cssText = 'position:fixed;inset:0;pointer-events:none;opacity:0;';
    document.body.appendChild(this.flashEl);
  }

  reset(): void {
    this.floats = [];
    this.stains = [];
    this.ripples = [];
    this.stopT = this.slowT = this.shakeAmt = 0;
    this.nextBolt = 8 + Math.random() * 6;
  }

  /** Multiplier for simulation time this frame: near zero during hit-stop, low during slow motion. */
  timeScale(): number {
    if (this.stopT > 0) return 0.04;
    if (this.slowT > 0) return this.slowScale;
    return 1;
  }

  shake(amount: number): void {
    this.shakeAmt = Math.max(this.shakeAmt, amount);
  }

  hitstop(ms: number): void {
    this.stopT = Math.max(this.stopT, ms / 1000);
  }

  slowmo(seconds: number, scale: number): void {
    this.slowT = seconds;
    this.slowScale = scale;
  }

  /** Full-screen tint that fades out: white for lightning, coral when you get hit. */
  flash(alpha: number, rgb = '255,255,255'): void {
    if (alpha >= this.flashA || rgb !== this.flashColor) {
      this.flashA = alpha;
      this.flashColor = rgb;
    }
  }

  /** Chalk word that pops in and drifts up. */
  word(x: number, z: number, text: string, color: number, height = 0.8, life = 0.9): void {
    const { tex, aspect } = textTexture(text);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, color, transparent: true, depthTest: false }));
    sprite.renderOrder = 10;
    sprite.position.set(x + (Math.random() - 0.5) * 0.6, 3.4, z);
    this.group.add(sprite);
    this.floats.push({ sprite, vy: 1.6, life, max: life, pop: 1.8, w: height * aspect, h: height });
  }

  /** Chalk dust stain on the asphalt. Fades as the rain washes it away. */
  stain(x: number, z: number, color: number, size: number): void {
    const m = new THREE.Mesh(PLANE, new THREE.MeshBasicMaterial({ map: smearTexture(), color, transparent: true, opacity: 0.55, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.random() * Math.PI;
    m.position.set(x + (Math.random() - 0.5) * 0.5, 0.021, z + (Math.random() - 0.5) * 0.5);
    m.scale.setScalar(size);
    this.group.add(m);
    const life = 14 + Math.random() * 8;
    this.stains.push({ obj: m, life, max: life, grow: 0, base: size });
    if (this.stains.length > 140) this.drop(this.stains.shift()!.obj);
  }

  private ripple(x: number, z: number): void {
    const m = new THREE.Mesh(RING, new THREE.MeshBasicMaterial({ color: 0xb8cfe0, transparent: true, opacity: 0.35, depthWrite: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(x, 0.025, z);
    this.group.add(m);
    this.ripples.push({ obj: m, life: 0.6, max: 0.6, grow: 0.9, base: 0.05 });
  }

  private drop(m: THREE.Mesh): void {
    this.group.remove(m);
    (m.material as THREE.Material).dispose();
  }

  /**
   * Called every frame with real (unscaled) dt.
   * focus: the player, for camera drift. rain: 0 (light) to 1 (downpour).
   */
  update(dt: number, focus: { x: number; z: number; aim: number } | null, rain: number): void {
    this.clock += dt;
    this.stopT = Math.max(0, this.stopT - dt);
    this.slowT = Math.max(0, this.slowT - dt);

    // Camera: drift a little towards the player and where they aim, plus decaying shake.
    const goal = new THREE.Vector3();
    if (focus) goal.set(focus.x * 0.18 + Math.cos(focus.aim) * 0.8, 0, focus.z * 0.14 + Math.sin(focus.aim) * 0.6);
    this.drift.lerp(goal, 1 - Math.exp(-dt * 3));
    const s = this.shakeAmt;
    const shake = new THREE.Vector3((Math.random() - 0.5) * s, (Math.random() - 0.5) * s * 0.5, (Math.random() - 0.5) * s);
    this.shakeAmt = Math.max(0, s - dt * 3.2);
    const cam = this.world.camera;
    const z = this.world.zoom;
    cam.position.copy(CAM_LOOK).addScaledVector(CAM_POS.clone().sub(CAM_LOOK), z).add(this.drift).add(shake);
    cam.lookAt(CAM_LOOK.clone().add(this.drift));

    this.floats = this.floats.filter((f) => {
      f.life -= dt;
      if (f.life <= 0) {
        this.group.remove(f.sprite);
        f.sprite.material.dispose();
        return false;
      }
      const k = 1 + (f.pop - 1) * Math.max(0, 1 - (f.max - f.life) / 0.12);
      f.sprite.scale.set(f.w * k, f.h * k, 1);
      f.sprite.position.y += f.vy * dt;
      f.vy *= 1 - dt * 2;
      f.sprite.material.opacity = Math.min(1, (f.life / f.max) * 2.5);
      return true;
    });
    this.stains = this.stains.filter((st) => {
      st.life -= dt * (0.6 + rain);
      if (st.life <= 0) {
        this.drop(st.obj);
        return false;
      }
      (st.obj.material as THREE.MeshBasicMaterial).opacity = 0.55 * Math.min(1, st.life / (st.max * 0.6));
      return true;
    });
    this.ripples = this.ripples.filter((r) => {
      r.life -= dt;
      if (r.life <= 0) {
        this.drop(r.obj);
        return false;
      }
      const t = 1 - r.life / r.max;
      r.obj.scale.setScalar(r.base + t * r.grow);
      (r.obj.material as THREE.MeshBasicMaterial).opacity = 0.35 * (1 - t);
      return true;
    });
    const spawn = dt * (4 + rain * 14);
    for (let n = spawn; n > 0; n--) if (Math.random() < n) this.ripple((Math.random() - 0.5) * 38, (Math.random() - 0.5) * 30);

    // Lightning: a double flicker, then thunder a beat later. More often as the rain gets worse.
    this.nextBolt -= dt;
    if (this.nextBolt <= 0) {
      this.boltQueue.push(this.clock, this.clock + 0.11);
      sfx.thunder(0.35 + Math.random() * 0.9, 0.6 + rain * 0.4);
      this.nextBolt = (14 + Math.random() * 12) * (1 - rain * 0.5);
    }
    while (this.boltQueue.length && this.boltQueue[0] <= this.clock) {
      this.boltQueue.shift();
      this.flash(0.55);
      this.world.lightning(1);
    }

    this.flashA = Math.max(0, this.flashA - dt * 3.5);
    this.flashEl.style.background = `rgb(${this.flashColor})`;
    this.flashEl.style.opacity = String(this.flashA);
  }
}

