import * as THREE from 'three';
import type { HeroId } from './config';

// Procedural chalk art. Everything is drawn in white on canvas and tinted per team at runtime.

type Pt = [number, number];

function canvas(w: number, h: number): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  return [c, c.getContext('2d')!];
}

/** A chalk line: several jittered passes plus dust specks, so edges look dry and broken. */
function chalkLine(g: CanvasRenderingContext2D, pts: Pt[], closed: boolean, width = 4, passes = 3): void {
  for (let p = 0; p < passes; p++) {
    g.beginPath();
    g.lineWidth = width * (0.6 + Math.random() * 0.6);
    g.strokeStyle = `rgba(255,255,255,${0.45 + Math.random() * 0.4})`;
    const j = () => (Math.random() - 0.5) * width * 0.8;
    pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x + j(), y + j()) : g.lineTo(x + j(), y + j())));
    if (closed) g.closePath();
    g.stroke();
  }
  g.fillStyle = 'rgba(255,255,255,0.5)';
  for (const [x, y] of pts) {
    for (let k = 0; k < 3; k++) g.fillRect(x + (Math.random() - 0.5) * width * 3, y + (Math.random() - 0.5) * width * 3, 1.5, 1.5);
  }
}

const ellipse = (cx: number, cy: number, rx: number, ry: number, n = 28, a0 = 0, a1 = Math.PI * 2): Pt[] =>
  Array.from({ length: n + 1 }, (_, i) => {
    const a = a0 + ((a1 - a0) * i) / n;
    return [cx + Math.cos(a) * rx, cy + Math.sin(a) * ry] as Pt;
  });

/** Faint chalk fill so the body is not see-through. */
function haze(g: CanvasRenderingContext2D, pts: Pt[]): void {
  g.beginPath();
  pts.forEach(([x, y], i) => (i === 0 ? g.moveTo(x, y) : g.lineTo(x, y)));
  g.closePath();
  g.fillStyle = 'rgba(255,255,255,0.16)';
  g.fill();
}

function heroCanvas(id: HeroId): HTMLCanvasElement {
  const [c, g] = canvas(128, 128);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  if (id === 'scribble') {
    // Round one-eyed doodle with a crown.
    const body = ellipse(64, 74, 34, 36);
    haze(g, body);
    chalkLine(g, body, true);
    chalkLine(g, ellipse(64, 66, 14, 14), true, 3);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.arc(66, 67, 5, 0, Math.PI * 2);
    g.fill();
    chalkLine(g, [[42, 40], [46, 20], [56, 34], [64, 16], [72, 34], [82, 20], [86, 40]], false, 3);
    chalkLine(g, [[50, 109], [46, 122]], false, 4, 2);
    chalkLine(g, [[78, 109], [82, 122]], false, 4, 2);
  } else if (id === 'smudge') {
    // Boxy robot with a visor and an antenna.
    const body: Pt[] = [[30, 40], [98, 40], [100, 108], [28, 108]];
    haze(g, body);
    chalkLine(g, body, true, 5);
    chalkLine(g, [[40, 54], [88, 54], [88, 74], [40, 74]], true, 3);
    g.fillStyle = 'rgba(255,255,255,0.85)';
    g.fillRect(48, 60, 8, 8);
    g.fillRect(72, 60, 8, 8);
    chalkLine(g, [[64, 40], [64, 22]], false, 3, 2);
    chalkLine(g, ellipse(64, 18, 5, 5, 12), true, 3, 2);
    chalkLine(g, [[44, 86], [84, 86]], false, 3, 2);
    chalkLine(g, [[40, 108], [40, 124]], false, 5, 2);
    chalkLine(g, [[88, 108], [88, 124]], false, 5, 2);
  } else {
    // Long-eared bunny with a toothy grin.
    const body = ellipse(64, 86, 28, 32);
    haze(g, body);
    chalkLine(g, body, true);
    chalkLine(g, ellipse(50, 34, 8, 26), true, 3);
    chalkLine(g, ellipse(78, 34, 8, 26), true, 3);
    g.fillStyle = 'rgba(255,255,255,0.9)';
    g.beginPath();
    g.arc(54, 78, 4, 0, Math.PI * 2);
    g.arc(74, 78, 4, 0, Math.PI * 2);
    g.fill();
    chalkLine(g, [[50, 96], [56, 102], [62, 96], [68, 102], [74, 96], [78, 100]], false, 2.5, 2);
  }
  return c;
}

const cache = new Map<string, THREE.Texture>();
function tex(key: string, make: () => HTMLCanvasElement, repeat = false): THREE.Texture {
  let t = cache.get(key);
  if (!t) {
    t = new THREE.CanvasTexture(make());
    t.colorSpace = THREE.SRGBColorSpace;
    if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
    cache.set(key, t);
  }
  return t;
}

export const heroTexture = (id: HeroId) => tex(`hero-${id}`, () => heroCanvas(id));

export const dustTexture = () =>
  tex('dust', () => {
    const [c, g] = canvas(32, 32);
    const grad = g.createRadialGradient(16, 16, 1, 16, 16, 15);
    grad.addColorStop(0, 'rgba(255,255,255,1)');
    grad.addColorStop(0.5, 'rgba(255,255,255,0.6)');
    grad.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = grad;
    g.fillRect(0, 0, 32, 32);
    return c;
  });

/** Hatched chalk strip for drawn walls. */
export const wallTexture = () =>
  tex('wall', () => {
    const [c, g] = canvas(128, 64);
    g.fillStyle = 'rgba(255,255,255,0.22)';
    g.fillRect(0, 0, 128, 64);
    g.lineCap = 'round';
    chalkLine(g, [[2, 4], [126, 4]], false, 4);
    chalkLine(g, [[2, 60], [126, 60]], false, 4);
    for (let x = -40; x < 128; x += 12) chalkLine(g, [[x, 60], [x + 40, 4]], false, 2, 1);
    return c;
  }, true);

/** Concrete slab with scribbles, for the fence and fixed cover. */
export const slabTexture = () =>
  tex('slab', () => {
    const [c, g] = canvas(256, 64);
    g.fillStyle = '#4d5157';
    g.fillRect(0, 0, 256, 64);
    for (let i = 0; i < 900; i++) {
      g.fillStyle = `rgba(${Math.random() < 0.5 ? '0,0,0' : '255,255,255'},${Math.random() * 0.12})`;
      g.fillRect(Math.random() * 256, Math.random() * 64, 2, 2);
    }
    g.lineCap = 'round';
    for (let x = 0; x < 256; x += 9) chalkLine(g, [[x, 58], [x + 2, 8]], false, 1.6, 1);
    chalkLine(g, [[0, 6], [256, 6]], false, 3, 2);
    return c;
  }, true);

/** Wet asphalt: dark grain, a few cracks, and painted court lines. */
export const groundTexture = () =>
  tex('ground', () => {
    const [c, g] = canvas(1024, 1024);
    g.fillStyle = '#25282c';
    g.fillRect(0, 0, 1024, 1024);
    for (let i = 0; i < 60000; i++) {
      const v = Math.random();
      g.fillStyle = v < 0.5 ? `rgba(0,0,0,${Math.random() * 0.35})` : `rgba(190,200,210,${Math.random() * 0.12})`;
      g.fillRect(Math.random() * 1024, Math.random() * 1024, 1 + Math.random() * 2, 1 + Math.random() * 2);
    }
    g.strokeStyle = 'rgba(0,0,0,0.5)';
    for (let k = 0; k < 14; k++) {
      g.lineWidth = 1 + Math.random() * 1.5;
      g.beginPath();
      let x = Math.random() * 1024;
      let y = Math.random() * 1024;
      g.moveTo(x, y);
      for (let s = 0; s < 8; s++) {
        x += (Math.random() - 0.5) * 70;
        y += (Math.random() - 0.5) * 70;
        g.lineTo(x, y);
      }
      g.stroke();
    }
    return c;
  });

/** Irregular chalk smear left where someone was knocked out. */
export const smearTexture = () =>
  tex('smear', () => {
    const [c, g] = canvas(64, 64);
    for (let i = 0; i < 120; i++) {
      const a = Math.random() * Math.PI * 2;
      const r = Math.random() * 26;
      g.fillStyle = `rgba(255,255,255,${Math.random() * 0.25})`;
      g.beginPath();
      g.arc(32 + Math.cos(a) * r, 32 + Math.sin(a) * r * 0.7, 2 + Math.random() * 4, 0, Math.PI * 2);
      g.fill();
    }
    return c;
  });
