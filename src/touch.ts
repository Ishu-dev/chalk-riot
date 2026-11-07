/**
 * Touch controls for phones and tablets, twin-stick style:
 * - left part of the screen: a floating stick that moves you
 * - right part: drag to aim (fires while dragged), quick tap to shoot the nearest enemy
 * - the chalk button toggles draw mode; then drag on the court to draw cover
 * Turns itself on at the first touch, so mouse and keyboard play is unchanged.
 */
export class Touch {
  active = false;
  move = { x: 0, z: 0 };
  aiming = false;
  aim = 0;
  fire = false;
  tapShot = false;
  drawMode = false;
  drawing = false;
  drawX = 0;
  drawY = 0;

  private moveId: number | null = null;
  private aimId: number | null = null;
  private drawId: number | null = null;
  private moveOrigin = { x: 0, y: 0 };
  private aimOrigin = { x: 0, y: 0, t: 0 };
  private els: Record<'mBase' | 'mKnob' | 'aBase' | 'aKnob' | 'btn' | 'rotate', HTMLElement>;

  constructor() {
    const mk = (cls: string, html = '') => {
      const el = document.createElement('div');
      el.className = cls;
      el.innerHTML = html;
      document.body.appendChild(el);
      return el;
    };
    this.els = {
      mBase: mk('stick base'),
      mKnob: mk('stick knob'),
      aBase: mk('stick base aim'),
      aKnob: mk('stick knob aim'),
      btn: mk('chalk-btn', '&#9998;<small>draw</small>'),
      rotate: mk('rotate-hint', 'Turn your phone sideways for a bigger court'),
    };
    const opts = { passive: false } as AddEventListenerOptions;
    window.addEventListener('pointerdown', (e) => this.down(e), opts);
    window.addEventListener('pointermove', (e) => this.moved(e), opts);
    window.addEventListener('pointerup', (e) => this.up(e), opts);
    window.addEventListener('pointercancel', (e) => this.up(e), opts);
    window.addEventListener('resize', () => this.layout());
  }

  private enable(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('touch');
    // The title was rendered before we knew this was a touch screen.
    document.querySelectorAll('.overlay p').forEach((p) => {
      if (p.textContent === 'click a hero or press 1, 2, 3') p.textContent = 'tap a hero';
    });
    this.layout();
  }

  /** Sticks and the draw button only make sense during a match. */
  setPlaying(on: boolean): void {
    document.body.classList.toggle('playing', on);
    if (!on) {
      this.drawMode = false;
      this.els.btn.classList.remove('on');
    }
  }

  private layout(): void {
    this.els.rotate.style.display = this.active && window.innerHeight > window.innerWidth ? 'block' : 'none';
  }

  private radius(): number {
    return Math.max(42, Math.min(70, Math.min(window.innerWidth, window.innerHeight) * 0.13));
  }

  private show(base: HTMLElement, knob: HTMLElement, x: number, y: number): void {
    const r = this.radius();
    base.style.cssText = `display:block;left:${x - r}px;top:${y - r}px;width:${r * 2}px;height:${r * 2}px`;
    knob.style.cssText = `display:block;left:${x - r * 0.45}px;top:${y - r * 0.45}px;width:${r * 0.9}px;height:${r * 0.9}px`;
  }

  private knobTo(knob: HTMLElement, ox: number, oy: number, dx: number, dy: number): { nx: number; ny: number; d: number } {
    const r = this.radius();
    const d = Math.hypot(dx, dy);
    const k = d > r ? r / d : 1;
    knob.style.left = `${ox + dx * k - r * 0.45}px`;
    knob.style.top = `${oy + dy * k - r * 0.45}px`;
    return { nx: (dx * k) / r, ny: (dy * k) / r, d };
  }

  private down(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    this.enable();
    const target = e.target as HTMLElement;
    if (target.closest('.overlay')) return; // title and result screens use normal taps
    e.preventDefault();
    if (target.closest('.chalk-btn')) {
      this.drawMode = !this.drawMode;
      this.els.btn.classList.toggle('on', this.drawMode);
      return;
    }
    // In draw mode the stick shrinks to the bottom-left corner so you can draw near your hero.
    const stickZone = e.clientX < window.innerWidth * 0.45 && (!this.drawMode || e.clientY > window.innerHeight * 0.62);
    if (stickZone) {
      if (this.moveId !== null) return;
      this.moveId = e.pointerId;
      this.moveOrigin = { x: e.clientX, y: e.clientY };
      this.show(this.els.mBase, this.els.mKnob, e.clientX, e.clientY);
    } else if (this.drawMode) {
      if (this.drawId !== null) return;
      this.drawId = e.pointerId;
      this.drawing = true;
      this.drawX = e.clientX;
      this.drawY = e.clientY;
    } else {
      if (this.aimId !== null) return;
      this.aimId = e.pointerId;
      this.aimOrigin = { x: e.clientX, y: e.clientY, t: performance.now() };
      this.show(this.els.aBase, this.els.aKnob, e.clientX, e.clientY);
    }
  }

  private moved(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.moveId) {
      e.preventDefault();
      const o = this.moveOrigin;
      const { nx, ny } = this.knobTo(this.els.mKnob, o.x, o.y, e.clientX - o.x, e.clientY - o.y);
      // Screen right is world +x and screen down is world +z with this camera.
      this.move = { x: nx, z: ny };
    } else if (e.pointerId === this.aimId) {
      e.preventDefault();
      const o = this.aimOrigin;
      const dx = e.clientX - o.x;
      const dy = e.clientY - o.y;
      const { d } = this.knobTo(this.els.aKnob, o.x, o.y, dx, dy);
      if (d > 16) {
        this.aiming = true;
        this.fire = true;
        this.aim = Math.atan2(dy, dx);
      }
    } else if (e.pointerId === this.drawId) {
      e.preventDefault();
      this.drawX = e.clientX;
      this.drawY = e.clientY;
    }
  }

  private up(e: PointerEvent): void {
    if (e.pointerType !== 'touch') return;
    if (e.pointerId === this.moveId) {
      this.moveId = null;
      this.move = { x: 0, z: 0 };
      this.els.mBase.style.display = this.els.mKnob.style.display = 'none';
    } else if (e.pointerId === this.aimId) {
      // A quick tap that never turned into a drag: shoot the nearest enemy.
      if (!this.aiming && performance.now() - this.aimOrigin.t < 300) this.tapShot = true;
      this.aimId = null;
      this.aiming = this.fire = false;
      this.els.aBase.style.display = this.els.aKnob.style.display = 'none';
    } else if (e.pointerId === this.drawId) {
      this.drawId = null;
      this.drawing = false;
    }
  }

  /** Drop any held input, e.g. when a match ends. */
  release(): void {
    this.moveId = this.aimId = this.drawId = null;
    this.move = { x: 0, z: 0 };
    this.aiming = this.fire = this.drawing = this.tapShot = false;
    for (const k of ['mBase', 'mKnob', 'aBase', 'aKnob'] as const) this.els[k].style.display = 'none';
  }
}
