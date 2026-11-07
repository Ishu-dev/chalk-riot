import { ARENA_R, T } from './config';
import { distToSeg, type Seg } from './geom';

export interface Pt {
  x: number;
  z: number;
}

const CELL = 0.5;
const HALF = 22; // grid covers -22..22 m on both axes
const N = (HALF * 2) / CELL; // cells per side
const SQRT2 = Math.SQRT2;

/**
 * Walkability grid over the court plus A* on top of it. Cells near a wall (by actor radius
 * plus a little margin) or outside the arena are blocked. Rebuilt lazily when walls change.
 */
export class Nav {
  private blocked = new Uint8Array(N * N);
  private g = new Float32Array(N * N);
  private from = new Int32Array(N * N);
  private closed = new Uint8Array(N * N);
  private dirty = true;

  markDirty(): void {
    this.dirty = true;
  }

  private rebuild(walls: { seg: Seg; fixed: boolean }[]): void {
    const b = this.blocked;
    b.fill(0);
    const edge = ARENA_R - T.actorR - 0.1;
    for (let j = 0; j < N; j++) {
      for (let i = 0; i < N; i++) {
        const { x, z } = center(i, j);
        if (Math.hypot(x, z) > edge) b[j * N + i] = 1;
      }
    }
    for (const w of walls) {
      const clear = T.actorR + (w.fixed ? 0.2 : T.wallHalfThick) + 0.15;
      const s = w.seg;
      const i0 = cellOf(Math.min(s.ax, s.bx) - clear);
      const i1 = cellOf(Math.max(s.ax, s.bx) + clear);
      const j0 = cellOf(Math.min(s.az, s.bz) - clear);
      const j1 = cellOf(Math.max(s.az, s.bz) + clear);
      for (let j = j0; j <= j1; j++) {
        for (let i = i0; i <= i1; i++) {
          const c = center(i, j);
          if (distToSeg(c.x, c.z, s) < clear) b[j * N + i] = 1;
        }
      }
    }
    this.dirty = false;
  }

  private ensure(walls: { seg: Seg; fixed: boolean }[]): void {
    if (this.dirty) this.rebuild(walls);
  }

  isFree(x: number, z: number): boolean {
    const i = cellOf(x);
    const j = cellOf(z);
    return this.blocked[j * N + i] === 0;
  }

  /** True if a straight walk from a to b stays on free cells. */
  walkable(ax: number, az: number, bx: number, bz: number, walls: { seg: Seg; fixed: boolean }[]): boolean {
    this.ensure(walls);
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / (CELL * 0.5)));
    // An actor pressed against a wall stands inside the blocked margin. Let it walk out of
    // that margin (up to 0.6 m) without the whole check failing, but never through a wall.
    let leaving = !this.isFree(ax, az);
    for (let k = 1; k <= n; k++) {
      const t = k / n;
      if (this.isFree(ax + (bx - ax) * t, az + (bz - az) * t)) leaving = false;
      else if (!leaving || d * t > 0.6) return false;
    }
    return true;
  }

  /** Shortest walkable route from start to goal as smoothed waypoints, or null if none. */
  path(sx: number, sz: number, gx: number, gz: number, walls: { seg: Seg; fixed: boolean }[]): Pt[] | null {
    this.ensure(walls);
    const start = this.nearestFree(cellOf(sx), cellOf(sz));
    const goal = this.nearestFree(cellOf(gx), cellOf(gz));
    if (start < 0 || goal < 0) return null;
    if (start === goal) return [{ x: gx, z: gz }];

    const { g, from, closed, blocked } = this;
    g.fill(Infinity);
    closed.fill(0);
    from.fill(-1);
    const heap = new MinHeap();
    const gi = goal % N;
    const gj = (goal / N) | 0;
    const h = (c: number) => {
      const dx = Math.abs((c % N) - gi);
      const dz = Math.abs(((c / N) | 0) - gj);
      return Math.max(dx, dz) + (SQRT2 - 1) * Math.min(dx, dz); // octile distance
    };
    g[start] = 0;
    heap.push(start, h(start));
    let expanded = 0;
    while (heap.size > 0 && expanded < 6000) {
      const c = heap.pop();
      if (closed[c]) continue;
      if (c === goal) break;
      closed[c] = 1;
      expanded++;
      const ci = c % N;
      const cj = (c / N) | 0;
      for (let dj = -1; dj <= 1; dj++) {
        for (let di = -1; di <= 1; di++) {
          if (di === 0 && dj === 0) continue;
          const ni = ci + di;
          const nj = cj + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const nc = nj * N + ni;
          if (blocked[nc] || closed[nc]) continue;
          // No cutting corners past a blocked cell.
          if (di !== 0 && dj !== 0 && (blocked[cj * N + ni] || blocked[nj * N + ci])) continue;
          const ng = g[c] + (di !== 0 && dj !== 0 ? SQRT2 : 1);
          if (ng < g[nc]) {
            g[nc] = ng;
            from[nc] = c;
            heap.push(nc, ng + h(nc));
          }
        }
      }
    }
    if (from[goal] < 0) return null;

    const cells: Pt[] = [];
    for (let c = goal; c !== start; c = from[c]) cells.push(center(c % N, (c / N) | 0));
    cells.reverse();
    cells[cells.length - 1] = { x: gx, z: gz };
    return this.smooth({ x: sx, z: sz }, cells, walls);
  }

  /** String pulling: drop waypoints the bot can already walk past in a straight line. */
  private smooth(start: Pt, pts: Pt[], walls: { seg: Seg; fixed: boolean }[]): Pt[] {
    const out: Pt[] = [];
    let anchor = start;
    let k = 0;
    while (k < pts.length) {
      let far = k;
      for (let m = pts.length - 1; m > k; m--) {
        if (this.walkable(anchor.x, anchor.z, pts[m].x, pts[m].z, walls)) {
          far = m;
          break;
        }
      }
      out.push(pts[far]);
      anchor = pts[far];
      k = far + 1;
    }
    return out;
  }

  /** The cell itself if free, else the closest free cell within a few metres. */
  private nearestFree(i: number, j: number): number {
    for (let r = 0; r <= 8; r++) {
      let best = -1;
      let bestD = Infinity;
      for (let dj = -r; dj <= r; dj++) {
        for (let di = -r; di <= r; di++) {
          if (Math.max(Math.abs(di), Math.abs(dj)) !== r) continue;
          const ni = i + di;
          const nj = j + dj;
          if (ni < 0 || nj < 0 || ni >= N || nj >= N) continue;
          const c = nj * N + ni;
          const d = di * di + dj * dj;
          if (!this.blocked[c] && d < bestD) {
            bestD = d;
            best = c;
          }
        }
      }
      if (best >= 0) return best;
    }
    return -1;
  }
}

function cellOf(v: number): number {
  return Math.max(0, Math.min(N - 1, Math.floor((v + HALF) / CELL)));
}

function center(i: number, j: number): Pt {
  return { x: -HALF + (i + 0.5) * CELL, z: -HALF + (j + 0.5) * CELL };
}

class MinHeap {
  private ids: number[] = [];
  private keys: number[] = [];
  get size(): number {
    return this.ids.length;
  }
  push(id: number, key: number): void {
    this.ids.push(id);
    this.keys.push(key);
    let i = this.ids.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (this.keys[p] <= this.keys[i]) break;
      this.swap(i, p);
      i = p;
    }
  }
  pop(): number {
    const top = this.ids[0];
    const lastId = this.ids.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.ids.length > 0) {
      this.ids[0] = lastId;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < this.ids.length && this.keys[l] < this.keys[m]) m = l;
        if (r < this.ids.length && this.keys[r] < this.keys[m]) m = r;
        if (m === i) break;
        this.swap(i, m);
        i = m;
      }
    }
    return top;
  }
  private swap(a: number, b: number): void {
    [this.ids[a], this.ids[b]] = [this.ids[b], this.ids[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}
