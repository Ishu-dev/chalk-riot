export interface Seg {
  ax: number;
  az: number;
  bx: number;
  bz: number;
}

/** Closest point on segment s to (px, pz). */
export function closest(px: number, pz: number, s: Seg): { x: number; z: number } {
  const dx = s.bx - s.ax;
  const dz = s.bz - s.az;
  const l2 = dx * dx + dz * dz;
  const t = l2 === 0 ? 0 : Math.max(0, Math.min(1, ((px - s.ax) * dx + (pz - s.az) * dz) / l2));
  return { x: s.ax + dx * t, z: s.az + dz * t };
}

export function distToSeg(px: number, pz: number, s: Seg): number {
  const c = closest(px, pz, s);
  return Math.hypot(px - c.x, pz - c.z);
}

/** True if segment p1-p2 crosses segment q1-q2. */
export function crosses(p1x: number, p1z: number, p2x: number, p2z: number, s: Seg): boolean {
  const d = (ax: number, az: number, bx: number, bz: number, cx: number, cz: number) => (bx - ax) * (cz - az) - (bz - az) * (cx - ax);
  const d1 = d(s.ax, s.az, s.bx, s.bz, p1x, p1z);
  const d2 = d(s.ax, s.az, s.bx, s.bz, p2x, p2z);
  const d3 = d(p1x, p1z, p2x, p2z, s.ax, s.az);
  const d4 = d(p1x, p1z, p2x, p2z, s.bx, s.bz);
  return d1 * d2 < 0 && d3 * d4 < 0;
}

/** Push a circle out of a thick segment. Returns the corrected centre, or null if not touching. */
export function pushOut(px: number, pz: number, r: number, s: Seg, halfThick: number): { x: number; z: number } | null {
  const c = closest(px, pz, s);
  const dx = px - c.x;
  const dz = pz - c.z;
  const d = Math.hypot(dx, dz);
  const min = r + halfThick;
  if (d >= min) return null;
  if (d < 1e-6) {
    // Dead centre on the line: push along the segment normal.
    const nx = -(s.bz - s.az);
    const nz = s.bx - s.ax;
    const nl = Math.hypot(nx, nz) || 1;
    return { x: c.x + (nx / nl) * min, z: c.z + (nz / nl) * min };
  }
  return { x: c.x + (dx / d) * min, z: c.z + (dz / d) * min };
}
