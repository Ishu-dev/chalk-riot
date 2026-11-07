import * as THREE from 'three';
import { ARENA_R, HEROES, PLAYER_COLOR, T, TEAM_COLOR, dryRadius, type HeroId } from './config';
import { dustTexture, heroFrames, smearTexture, wallTexture } from './chalk';
import { Fx } from './fx';
import { crosses, distToSeg, pushOut, type Seg } from './geom';
import type { Hud } from './hud';
import { sfx } from './sfx';
import { FIXED_COVER, type World } from './world';
import { Nav, type Pt } from './nav';

type Team = 0 | 1;

interface Wall {
  seg: Seg;
  hp: number;
  fixed: boolean;
  mesh?: THREE.Mesh;
}

interface Bot {
  strafeSign: number;
  strafeT: number;
  react: number;
  wallReadyAt: number;
  path: Pt[] | null; // waypoints round cover when the target is out of sight
  repathAt: number;
  checkAt: number; // stuck watchdog
  lastX: number;
  lastZ: number;
  unstickUntil: number;
  unstickAng: number;
  routing: boolean; // following a path (target out of sight) vs fighting in the open
  seenFor: number; // seconds of continuous sight / no sight, for hysteresis
  lostFor: number;
  target: Actor | null;
}

interface Actor {
  hero: HeroId;
  team: Team;
  isPlayer: boolean;
  color: number;
  x: number;
  z: number;
  vx: number;
  vz: number;
  hp: number;
  ammo: number;
  reloadT: number;
  lastShot: number;
  chalk: number;
  alive: boolean;
  aim: number;
  flashUntil: number;
  bot: Bot;
  sprite: THREE.Sprite;
  shadow: THREE.Mesh;
  hpBg: THREE.Sprite;
  hpFill: THREE.Sprite;
  refl: THREE.Sprite; // upside-down copy: the figure reflected in the wet asphalt
  frames: THREE.Texture[]; // line-boil redraws
  boilOff: number;
  squashT: number;
  stepT: number;
  pendingDmg: number; // hits within a few frames merge into one damage number
  pendingAt: number;
  pendingColor: number;
}

interface Bullet {
  x: number;
  z: number;
  dx: number;
  dz: number;
  speed: number;
  left: number;
  damage: number;
  hitR: number;
  team: Team;
  owner: Actor;
  sprite: THREE.Sprite;
}

interface Puff {
  sprite: THREE.Sprite;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  max: number;
}

const FIXED_HALF_THICK = 0.2;
const MINT_BARKS = ['nice!', 'clean wipe', 'chalk it up', 'back to the board'];
const CORAL_BARKS = ['smudged ya', 'eraser time', 'too slow', 'scribbled out'];
const SPRITE = 3; // chalk figure height in metres
const rand = (a: number, b: number) => a + Math.random() * (b - a);

export class Game {
  actors: Actor[] = [];
  bullets: Bullet[] = [];
  walls: Wall[] = [];
  puffs: Puff[] = [];
  time = 0;
  running = false;
  over = false;
  kos = 0;
  player: Actor | null = null;
  private hero: HeroId = 'scribble';
  private nav = new Nav();
  private fx: Fx;
  private endIn: number | null = null; // real seconds of slow motion left before the result screen

  private dyn = new THREE.Group(); // everything a match creates; cleared on restart
  private keys = new Set<string>();
  private mouse = new THREE.Vector3();
  private shootHeld = false;
  private drawHeld = false;
  private lastDraw: { x: number; z: number } | null = null;
  private aimLine: THREE.Line;
  private marker: THREE.Mesh;
  private reach: THREE.LineLoop; // shows how far you can draw, while drawing

  constructor(
    private world: World,
    private hud: Hud,
  ) {
    world.scene.add(this.dyn);
    this.fx = new Fx(world, this.dyn);
    this.aimLine = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints([new THREE.Vector3(), new THREE.Vector3()]),
      new THREE.LineDashedMaterial({ color: 0xf6f3ea, dashSize: 0.35, gapSize: 0.25, transparent: true, opacity: 0.55 }),
    );
    this.marker = new THREE.Mesh(
      new THREE.RingGeometry(0.75, 0.92, 32),
      new THREE.MeshBasicMaterial({ color: 0xf6f3ea, transparent: true, opacity: 0.8 }),
    );
    this.marker.rotation.x = -Math.PI / 2;
    const ring = Array.from({ length: 64 }, (_, i) => new THREE.Vector3(Math.cos((i / 64) * Math.PI * 2) * T.drawRange, 0, Math.sin((i / 64) * Math.PI * 2) * T.drawRange));
    this.reach = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints(ring), new THREE.LineDashedMaterial({ color: 0x9fd8ff, dashSize: 0.4, gapSize: 0.3, transparent: true, opacity: 0.45 }));
    this.reach.computeLineDistances();
    this.reach.visible = false;
    world.scene.add(this.aimLine, this.marker, this.reach);
    this.aimLine.visible = this.marker.visible = false;
    this.bindInput();
    (window as unknown as { __chalk: Game }).__chalk = this;
  }

  // ---------- input ----------

  private bindInput(): void {
    const el = this.world.renderer.domElement;
    window.addEventListener('keydown', (e) => {
      this.keys.add(e.code);
      if (e.code === 'KeyM') sfx.toggleMute();
    });
    window.addEventListener('keyup', (e) => this.keys.delete(e.code));
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.shootHeld = this.drawHeld = false;
    });
    window.addEventListener('pointermove', (e) => this.world.groundPoint(e.clientX, e.clientY, this.mouse));
    el.addEventListener('pointerdown', (e) => {
      this.world.groundPoint(e.clientX, e.clientY, this.mouse);
      if (e.button === 0) this.shootHeld = true;
      if (e.button === 2) this.drawHeld = true;
    });
    window.addEventListener('pointerup', (e) => {
      if (e.button === 0) this.shootHeld = false;
      if (e.button === 2) this.drawHeld = false;
    });
    el.addEventListener('contextmenu', (e) => e.preventDefault());
  }

  private key(...codes: string[]): boolean {
    return codes.some((c) => this.keys.has(c));
  }

  // ---------- match setup ----------

  start(hero: HeroId): void {
    this.hero = hero;
    // Free last match's GPU resources; shared geometry (fx ripples, stains) stays.
    this.dyn.traverse((o) => {
      const m = o as THREE.Mesh;
      if (m.geometry && !m.geometry.userData.shared) m.geometry.dispose();
      const mat = m.material as THREE.MeshBasicMaterial | undefined;
      if (mat && 'dispose' in mat) {
        if (mat.map?.userData.owned) mat.map.dispose();
        mat.dispose();
      }
    });
    this.dyn.clear();
    this.actors = [];
    this.bullets = [];
    this.puffs = [];
    this.walls = FIXED_COVER.map((seg) => ({ seg, hp: Infinity, fixed: true }));
    this.nav.markDirty();
    this.time = 0;
    this.kos = 0;
    this.over = false;
    this.running = true;
    this.lastDraw = null;
    this.endIn = null;
    this.fx.reset();

    // Both teams field one of each hero, so neither side starts with a better line-up.
    const ids = Object.keys(HEROES) as HeroId[];
    const others = ids.filter((h) => h !== hero).sort(() => Math.random() - 0.5);
    const mineIds = [others[0], hero, others[1]];
    const enemies = [...ids].sort(() => Math.random() - 0.5);
    const lanes = [-5, 0, 5];
    lanes.forEach((z, i) => {
      const mine = this.spawn(mineIds[i], 0, -15, z, i === 1);
      if (i === 1) this.player = mine;
      this.spawn(enemies[i], 1, 15, -z, false);
    });
    this.aimLine.visible = this.marker.visible = true;
  }

  private spawn(hero: HeroId, team: Team, x: number, z: number, isPlayer: boolean): Actor {
    const def = HEROES[hero];
    const color = isPlayer ? PLAYER_COLOR : TEAM_COLOR[team];
    const frames = heroFrames(hero);
    const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: frames[0], color, transparent: true, alphaTest: 0.03 }));
    sprite.center.set(0.5, 0);
    sprite.scale.set(SPRITE, SPRITE, 1);
    const refl = new THREE.Sprite(new THREE.SpriteMaterial({ map: frames[0], color, transparent: true, opacity: 0.22, depthWrite: false, alphaTest: 0.03 }));
    refl.center.set(0.5, 0);
    const shadow = new THREE.Mesh(new THREE.CircleGeometry(0.7, 20), new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.35 }));
    shadow.rotation.x = -Math.PI / 2;
    const hpBg = new THREE.Sprite(new THREE.SpriteMaterial({ color: 0x000000, transparent: true, opacity: 0.5 }));
    const hpFill = new THREE.Sprite(new THREE.SpriteMaterial({ color }));
    for (const s of [hpBg, hpFill]) {
      s.center.set(0, 0.5);
      s.scale.set(1.4, 0.14, 1);
    }
    this.dyn.add(refl, shadow, sprite, hpBg, hpFill);
    const a: Actor = {
      hero,
      team,
      isPlayer,
      color,
      x,
      z,
      vx: 0,
      vz: 0,
      hp: def.hp,
      ammo: def.ammo,
      reloadT: 0,
      lastShot: -1e9,
      chalk: T.chalkMax,
      alive: true,
      aim: team === 0 ? 0 : Math.PI,
      flashUntil: 0,
      bot: {
        strafeSign: Math.random() < 0.5 ? -1 : 1,
        strafeT: rand(1, 2.5),
        react: rand(0.3, 0.8),
        wallReadyAt: rand(2000, 5000),
        path: null,
        repathAt: 0,
        checkAt: 600,
        lastX: x,
        lastZ: z,
        unstickUntil: 0,
        unstickAng: 0,
        routing: false,
        seenFor: 0,
        lostFor: 0,
        target: null,
      },
      sprite,
      shadow,
      hpBg,
      hpFill,
      refl,
      frames,
      boilOff: Math.random() * 3,
      squashT: 0,
      stepT: 0,
      pendingDmg: 0,
      pendingAt: 0,
      pendingColor: 0xffffff,
    };
    this.actors.push(a);
    return a;
  }

  dryR(): number {
    return this.running || this.over ? dryRadius(this.time) : T.dryMax;
  }

  /** 0 at the start, 1 once the dry circle is at its smallest. Drives rain, sound and lightning. */
  rainLevel(): number {
    return (T.dryMax - this.dryR()) / (T.dryMax - T.dryMin);
  }

  // ---------- frame ----------

  update(realDt: number): void {
    const p0 = this.player;
    const rain = this.rainLevel();
    this.fx.update(realDt, p0 && p0.alive && this.running ? { x: p0.x, z: p0.z, aim: p0.aim } : null, rain);
    sfx.setRain(rain);
    if (!this.running) {
      this.updatePuffs(realDt);
      return;
    }
    const dt = realDt * this.fx.timeScale();
    this.time += dt;
    const now = this.time * 1000;
    const dryR = dryRadius(this.time);
    const p = this.player!;

    if (p.alive) this.controlPlayer(p, now);
    for (const a of this.actors) if (a.alive && !a.isPlayer) this.think(a, dt, now, dryR);

    for (const a of this.actors) {
      if (!a.alive) continue;
      const def = HEROES[a.hero];
      if (a.ammo < def.ammo) {
        a.reloadT += dt * 1000;
        if (a.reloadT >= def.reloadMs) {
          a.ammo++;
          a.reloadT -= def.reloadMs;
        }
      } else a.reloadT = 0;
      a.chalk = Math.min(T.chalkMax, a.chalk + T.chalkRegen * dt);
      a.x += a.vx * dt;
      a.z += a.vz * dt;
      a.squashT = Math.max(0, a.squashT - dt);
      a.stepT -= dt;
      if (a.stepT <= 0 && Math.hypot(a.vx, a.vz) > 1) {
        a.stepT = 0.26;
        this.burst(a.x, 0.05, a.z, 0xb8cfe0, 1); // splash of a footstep in the wet
      }
      if (Math.hypot(a.x, a.z) > dryR) {
        a.hp -= T.washDps * dt;
        if (a.hp <= 0) this.knockOut(a, null);
      }
    }
    this.collide();
    this.updateBullets(dt, now);
    this.updateWalls(dt, dryR);
    this.updatePuffs(dt);
    this.syncVisuals(now);

    const mint = this.actors.filter((a) => a.alive && a.team === 0).length;
    const coral = this.actors.filter((a) => a.alive && a.team === 1).length;
    let msg = '';
    if (!p.alive) msg = 'You washed out. Your team fights on.';
    else if (Math.hypot(p.x, p.z) > dryR) msg = 'Get back on dry ground!';
    else if (this.time < T.rainStart) msg = `The rain closes in at ${T.rainStart - Math.floor(this.time)} s`;
    this.hud.update({ mint, coral, seconds: this.time, hpFrac: p.hp / HEROES[p.hero].hp, chalkFrac: p.chalk / T.chalkMax, ammo: p.ammo, ammoMax: HEROES[p.hero].ammo, hero: p.hero, msg });
    if (mint === 0 || coral === 0) {
      // Last knockout: play it out in slow motion before the result screen.
      if (this.endIn === null) {
        this.endIn = 1.5;
        this.fx.slowmo(1.5, 0.25);
      }
      this.endIn -= realDt;
      if (this.endIn <= 0) this.endMatch(coral === 0);
    }
  }

  private controlPlayer(p: Actor, now: number): void {
    let mx = (this.key('KeyD', 'ArrowRight') ? 1 : 0) - (this.key('KeyA', 'ArrowLeft') ? 1 : 0);
    let mz = (this.key('KeyS', 'ArrowDown') ? 1 : 0) - (this.key('KeyW', 'ArrowUp') ? 1 : 0);
    const l = Math.hypot(mx, mz);
    if (l > 0) {
      mx /= l;
      mz /= l;
    }
    const speed = HEROES[p.hero].speed;
    p.vx = mx * speed;
    p.vz = mz * speed;
    p.aim = Math.atan2(this.mouse.z - p.z, this.mouse.x - p.x);
    if (this.shootHeld) this.tryShoot(p, p.aim, now);

    const drawing = this.drawHeld || this.key('ShiftLeft', 'ShiftRight');
    if (drawing) this.drawStep(p);
    else this.lastDraw = null;
    this.reach.visible = drawing;
    this.reach.position.set(p.x, 0.05, p.z);
  }

  /** Lay chalk wall along the cursor path, within reach of the player, while chalk lasts. */
  private drawStep(p: Actor): void {
    let tx = this.mouse.x;
    let tz = this.mouse.z;
    const d = Math.hypot(tx - p.x, tz - p.z);
    if (d > T.drawRange) {
      tx = p.x + ((tx - p.x) / d) * T.drawRange;
      tz = p.z + ((tz - p.z) / d) * T.drawRange;
    }
    if (!this.lastDraw) {
      this.lastDraw = { x: tx, z: tz };
      return;
    }
    const len = Math.hypot(tx - this.lastDraw.x, tz - this.lastDraw.z);
    if (len < T.drawStep || p.chalk < len) return;
    this.addWall({ ax: this.lastDraw.x, az: this.lastDraw.z, bx: tx, bz: tz }, p.color);
    p.chalk -= len;
    this.lastDraw = { x: tx, z: tz };
    sfx.scratch();
  }

  private addWall(seg: Seg, color: number): void {
    const len = Math.hypot(seg.bx - seg.ax, seg.bz - seg.az);
    const tex = wallTexture().clone();
    tex.repeat.set(Math.max(0.5, len / 1.5), 1);
    tex.needsUpdate = true;
    tex.userData.owned = true; // a per-wall clone, safe to dispose with the wall
    const mesh = new THREE.Mesh(
      new THREE.BoxGeometry(len + 0.15, 1.0, T.wallHalfThick * 2),
      // Unlit, like the chalk figures, so drawn cover reads clearly on dark asphalt.
      new THREE.MeshBasicMaterial({ map: tex, color, transparent: true, side: THREE.DoubleSide, depthWrite: false }),
    );
    mesh.position.set((seg.ax + seg.bx) / 2, 0.5, (seg.az + seg.bz) / 2);
    mesh.rotation.y = -Math.atan2(seg.bz - seg.az, seg.bx - seg.ax);
    this.dyn.add(mesh);
    this.walls.push({ seg, hp: T.wallHp, fixed: false, mesh });
    this.nav.markDirty();
  }

  private clearShot(ax: number, az: number, bx: number, bz: number): boolean {
    return !this.walls.some((w) => crosses(ax, az, bx, bz, w.seg));
  }

  // ---------- bots ----------

  private think(a: Actor, dt: number, now: number, dryR: number): void {
    const def = HEROES[a.hero];
    // Keep the current target unless someone else is clearly closer; flipping between two
    // near-equal targets made bots dither on the spot.
    let target: Actor | null = null;
    let best = Infinity;
    for (const o of this.actors) {
      if (!o.alive || o.team === a.team) continue;
      const dd = Math.hypot(o.x - a.x, o.z - a.z);
      if (dd < best) {
        best = dd;
        target = o;
      }
    }
    const cur = a.bot.target;
    if (cur && cur.alive && target && cur !== target && Math.hypot(cur.x - a.x, cur.z - a.z) < best * 1.25) target = cur;
    a.bot.target = target;
    if (!target) {
      a.vx = a.vz = 0;
      return;
    }
    const d = Math.hypot(target.x - a.x, target.z - a.z);
    const ux = (target.x - a.x) / d;
    const uz = (target.z - a.z) / d;
    const los = this.clearShot(a.x, a.z, target.x, target.z);
    const want = def.range * 0.75;

    let mx = 0;
    let mz = 0;
    const bot = a.bot;
    // Hysteresis: sight lines graze wall ends, so LOS flickers. Only change mode once the
    // new state has held for a moment, otherwise the bot alternates path/strafe every frame.
    if (los) {
      bot.seenFor += dt;
      bot.lostFor = 0;
    } else {
      bot.lostFor += dt;
      bot.seenFor = 0;
    }
    if (!bot.routing && bot.lostFor > 0.35) bot.routing = true;
    else if (bot.routing && bot.seenFor > 0.3) bot.routing = false;
    if (bot.routing) {
      // Out of sight: follow an A* route round the cover instead of pushing into it.
      if (!bot.path || now >= bot.repathAt) {
        bot.path = this.nav.path(a.x, a.z, target.x, target.z, this.walls);
        bot.repathAt = now + rand(400, 700);
      }
      const wp = this.nextWaypoint(a);
      mx = wp ? wp.x - a.x : ux;
      mz = wp ? wp.z - a.z : uz;
      const l = Math.hypot(mx, mz) || 1;
      mx /= l;
      mz /= l;
    } else {
      bot.path = null;
      if (d > want) {
        mx += ux;
        mz += uz;
      } else if (d < want * 0.55) {
        mx -= ux;
        mz -= uz;
      }
      bot.strafeT -= dt;
      if (bot.strafeT <= 0) {
        bot.strafeSign = Math.random() < 0.5 ? -1 : 1;
        bot.strafeT = rand(1.2, 3);
      }
      mx += -uz * bot.strafeSign * 0.8;
      mz += ux * bot.strafeSign * 0.8;
    }
    const rc = Math.hypot(a.x, a.z);
    if (rc > dryR - 2.5 && rc > 0) {
      mx -= (a.x / rc) * 2.5;
      mz -= (a.z / rc) * 2.5;
    }

    // Stuck watchdog: barely moved in 0.6 s while trying to? Repath and shuffle sideways briefly.
    if (now >= bot.checkAt) {
      if (Math.hypot(a.x - bot.lastX, a.z - bot.lastZ) < 0.5 && Math.hypot(mx, mz) > 0.1) {
        bot.unstickUntil = now + 450;
        bot.unstickAng = Math.atan2(mz, mx) + (Math.random() < 0.5 ? 1 : -1) * rand(1.2, 2.2);
        bot.path = null;
        bot.repathAt = 0;
      }
      bot.lastX = a.x;
      bot.lastZ = a.z;
      bot.checkAt = now + 600;
    }
    if (now < bot.unstickUntil) {
      mx = Math.cos(bot.unstickAng);
      mz = Math.sin(bot.unstickAng);
    }

    const ml = Math.hypot(mx, mz);
    if (ml > 0.01) {
      [mx, mz] = this.freeDirection(a, mx / ml, mz / ml);
      a.vx = mx * def.speed * 0.9;
      a.vz = mz * def.speed * 0.9;
    } else a.vx = a.vz = 0;
    a.aim = Math.atan2(uz, ux);

    if (los && d <= def.range * 0.95) {
      a.bot.react -= dt;
      if (a.bot.react <= 0) {
        this.tryShoot(a, a.aim + rand(-T.botAimError, T.botAimError), now);
        a.bot.react = rand(0.25, 0.6);
      }
    } else a.bot.react = Math.max(a.bot.react, 0.3);

    // Hurt and under fire: throw up a short wall between itself and the target.
    if (los && a.hp < def.hp * 0.55 && a.chalk >= 3 && now >= a.bot.wallReadyAt && d < def.range * 1.3) {
      const cx = a.x + ux * 1.6;
      const cz = a.z + uz * 1.6;
      this.addWall({ ax: cx - uz * 1.5, az: cz + ux * 1.5, bx: cx + uz * 1.5, bz: cz - ux * 1.5 }, a.color);
      a.chalk -= 3;
      a.bot.wallReadyAt = now + T.botWallCdMs;
      if (this.player && Math.hypot(this.player.x - a.x, this.player.z - a.z) < 10) sfx.scratch();
    }
  }

  private nextWaypoint(a: Actor): Pt | null {
    const path = a.bot.path;
    if (!path) return null;
    while (path.length > 1 && Math.hypot(path[0].x - a.x, path[0].z - a.z) < 0.5) path.shift();
    return path[0] ?? null;
  }

  /** If the way ahead is blocked, turn by the smallest angle (up to 120 degrees) that is clear. */
  private freeDirection(a: Actor, dx: number, dz: number): [number, number] {
    const probe = 1.1;
    if (this.nav.walkable(a.x, a.z, a.x + dx * probe, a.z + dz * probe, this.walls)) return [dx, dz];
    const base = Math.atan2(dz, dx);
    for (const off of [0.5, 1, 1.5, 2.1]) {
      for (const s of [1, -1]) {
        const ang = base + off * s;
        const cx = Math.cos(ang);
        const cz = Math.sin(ang);
        if (this.nav.walkable(a.x, a.z, a.x + cx * probe, a.z + cz * probe, this.walls)) return [cx, cz];
      }
    }
    return [dx, dz];
  }

  // ---------- combat ----------

  private tryShoot(a: Actor, angle: number, now: number): void {
    if (a.ammo < 1 || now - a.lastShot < T.minShotGapMs) return;
    const def = HEROES[a.hero];
    a.ammo--;
    a.lastShot = now;
    a.squashT = 0.12;
    if (a.isPlayer) this.fx.shake(0.1);
    for (let i = 0; i < def.pellets; i++) {
      const off = def.pellets > 1 ? -def.spread / 2 + (def.spread * i) / (def.pellets - 1) + rand(-0.04, 0.04) : 0;
      const ang = angle + off;
      const dx = Math.cos(ang);
      const dz = Math.sin(ang);
      const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTexture(), color: a.color, transparent: true, depthWrite: false }));
      const size = (a.hero === 'smudge' ? 0.45 : a.hero === 'stretch' ? 0.5 : 0.6) * (a.isPlayer ? 1.5 : 1);
      sprite.scale.set(size, size, 1);
      this.dyn.add(sprite);
      this.bullets.push({ x: a.x + dx * 0.7, z: a.z + dz * 0.7, dx, dz, speed: def.bulletSpeed, left: def.range, damage: def.damage * (a.isPlayer ? T.playerDamageMult : 1), hitR: a.isPlayer ? T.playerHitR : T.bulletR, team: a.team, owner: a, sprite });
    }
    const p = this.player;
    sfx.shoot(a.hero, a.isPlayer || (!!p && Math.hypot(p.x - a.x, p.z - a.z) < 9));
  }

  private updateBullets(dt: number, now: number): void {
    const keep: Bullet[] = [];
    for (const b of this.bullets) {
      const step = b.speed * dt;
      const nx = b.x + b.dx * step;
      const nz = b.z + b.dz * step;
      let dead = false;
      for (const w of this.walls) {
        const ht = w.fixed ? FIXED_HALF_THICK : T.wallHalfThick;
        if (crosses(b.x, b.z, nx, nz, w.seg) || distToSeg(nx, nz, w.seg) < ht + T.bulletR) {
          if (!w.fixed) w.hp -= b.damage;
          this.burst(nx, 0.6, nz, b.owner.color, 4);
          sfx.wallHit();
          dead = true;
          break;
        }
      }
      if (!dead) {
        const seg = { ax: b.x, az: b.z, bx: nx, bz: nz };
        for (const a of this.actors) {
          if (!a.alive || a.team === b.team) continue;
          if (distToSeg(a.x, a.z, seg) < T.actorR + b.hitR) {
            this.damage(a, b.damage, b.owner, now);
            dead = true;
            break;
          }
        }
      }
      b.x = nx;
      b.z = nz;
      b.left -= step;
      if (b.left <= 0 || Math.hypot(nx, nz) > ARENA_R + 1.5) {
        if (b.left <= 0) this.burst(nx, 0.6, nz, b.owner.color, 2);
        dead = true;
      }
      if (dead) {
        this.dyn.remove(b.sprite);
        b.sprite.material.dispose();
      }
      else {
        b.sprite.position.set(nx, 0.9, nz);
        keep.push(b);
      }
    }
    this.bullets = keep;
  }

  private damage(a: Actor, dmg: number, from: Actor, now: number): void {
    const dealt = a.isPlayer && !from.isPlayer ? dmg * T.botVsPlayerMult : dmg;
    a.hp -= dealt;
    a.flashUntil = now + 90;
    this.burst(a.x, 1, a.z, from.color, 5);
    this.fx.stain(a.x, a.z, from.color, 0.9);
    sfx.hit(a.isPlayer);
    if (from.isPlayer) {
      this.fx.hitstop(45);
      this.fx.shake(0.16);
    }
    if (a.isPlayer) {
      this.fx.hitstop(60);
      this.fx.shake(0.45);
      this.fx.flash(0.2, '255,138,115');
    }
    if (from.isPlayer || a.isPlayer) {
      a.pendingDmg += dealt;
      a.pendingAt = now;
      a.pendingColor = a.isPlayer ? 0xff8a73 : 0xfff3b0;
    }
    if (a.hp <= 0) this.knockOut(a, from);
  }

  private knockOut(a: Actor, from: Actor | null): void {
    if (!a.alive) return;
    a.alive = false;
    a.vx = a.vz = 0;
    if (from?.isPlayer) this.kos++;
    this.dyn.remove(a.sprite, a.shadow, a.hpBg, a.hpFill, a.refl);
    // Removed from the scene here, so restart cleanup will not see them: free them now.
    a.shadow.geometry.dispose();
    for (const o of [a.sprite, a.shadow, a.hpBg, a.hpFill, a.refl]) (o.material as THREE.Material).dispose();
    this.fx.shake(0.5);
    this.fx.hitstop(90);
    this.fx.word(a.x, a.z, from ? 'ERASED!' : 'WASHED OUT', from ? from.color : 0x9fd8ff, 1.1, 1.3);
    this.fx.stain(a.x, a.z, a.color, 2.4);
    if (from && from.alive && Math.random() < 0.7) {
      const lines = from.team === 0 ? MINT_BARKS : CORAL_BARKS;
      this.fx.word(from.x, from.z, lines[Math.floor(Math.random() * lines.length)], from.color, 0.55, 1.6);
    }
    const smear = new THREE.Mesh(new THREE.PlaneGeometry(2.6, 2.6), new THREE.MeshBasicMaterial({ map: smearTexture(), color: a.color, transparent: true, depthWrite: false }));
    smear.rotation.x = -Math.PI / 2;
    smear.rotation.z = Math.random() * Math.PI;
    smear.position.set(a.x, 0.02, a.z);
    this.dyn.add(smear);
    this.burst(a.x, 1, a.z, a.color, 18);
    sfx.ko(a.team === 0);
  }

  // ---------- world upkeep ----------

  private collide(): void {
    const live = this.actors.filter((a) => a.alive);
    for (const a of live) {
      for (const w of this.walls) {
        const out = pushOut(a.x, a.z, T.actorR, w.seg, w.fixed ? FIXED_HALF_THICK : T.wallHalfThick);
        if (out) {
          a.x = out.x;
          a.z = out.z;
        }
      }
      const r = Math.hypot(a.x, a.z);
      const max = ARENA_R - T.actorR;
      if (r > max) {
        a.x *= max / r;
        a.z *= max / r;
      }
    }
    for (let i = 0; i < live.length; i++) {
      for (let j = i + 1; j < live.length; j++) {
        const a = live[i];
        const b = live[j];
        const dx = b.x - a.x;
        const dz = b.z - a.z;
        const d = Math.hypot(dx, dz);
        const min = T.actorR * 2;
        if (d >= min || d === 0) continue;
        const push = (min - d) / 2;
        a.x -= (dx / d) * push;
        a.z -= (dz / d) * push;
        b.x += (dx / d) * push;
        b.z += (dz / d) * push;
      }
    }
  }

  /** Drawn walls wear down in the rain, and wash away fast outside the dry circle. */
  private updateWalls(dt: number, dryR: number): void {
    this.walls = this.walls.filter((w) => {
      if (w.fixed) return true;
      const mx = (w.seg.ax + w.seg.bx) / 2;
      const mz = (w.seg.az + w.seg.bz) / 2;
      w.hp -= (Math.hypot(mx, mz) > dryR ? T.washedWallDecay : T.wallDecay) * dt;
      const m = w.mesh!;
      if (w.hp <= 0) {
        this.dyn.remove(m);
        m.geometry.dispose();
        const wm = m.material as THREE.MeshBasicMaterial;
        wm.map?.dispose(); // per-wall texture clone
        wm.dispose();
        this.nav.markDirty();
        this.burst(mx, 0.5, mz, (m.material as THREE.MeshBasicMaterial).color.getHex(), 6);
        return false;
      }
      (m.material as THREE.MeshBasicMaterial).opacity = 0.35 + 0.65 * Math.min(1, w.hp / T.wallHp);
      return true;
    });
  }

  private burst(x: number, y: number, z: number, color: number, n: number): void {
    for (let i = 0; i < n; i++) {
      const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: dustTexture(), color, transparent: true, depthWrite: false }));
      const size = rand(0.15, 0.4);
      s.scale.set(size, size, 1);
      s.position.set(x, y, z);
      this.dyn.add(s);
      const max = rand(0.25, 0.55);
      this.puffs.push({ sprite: s, vx: rand(-3, 3), vy: rand(0.5, 3), vz: rand(-3, 3), life: max, max });
    }
  }

  private updatePuffs(dt: number): void {
    this.puffs = this.puffs.filter((p) => {
      p.life -= dt;
      if (p.life <= 0) {
        this.dyn.remove(p.sprite);
        p.sprite.material.dispose();
        return false;
      }
      p.vy -= 6 * dt;
      p.sprite.position.x += p.vx * dt;
      p.sprite.position.y = Math.max(0.05, p.sprite.position.y + p.vy * dt);
      p.sprite.position.z += p.vz * dt;
      p.sprite.material.opacity = p.life / p.max;
      return true;
    });
  }

  private syncVisuals(now: number): void {
    // Figures are camera-facing sprites, so their top edge is "camera up" from the feet,
    // not world up. Hang the HP bars along the same direction so they clear the head.
    const up = new THREE.Vector3(0, 1, 0).applyQuaternion(this.world.camera.quaternion).multiplyScalar(SPRITE + 0.3);
    for (const a of this.actors) {
      if (!a.alive) continue;
      const moving = Math.hypot(a.vx, a.vz) > 0.1;
      const bob = moving ? Math.abs(Math.sin(now / 90)) * 0.18 : 0;
      // Line boil: swap between redraws about 8 times a second, each figure out of step.
      const frame = a.frames[Math.floor(now / 125 + a.boilOff) % a.frames.length];
      a.sprite.material.map = frame;
      a.refl.material.map = frame;
      // Squash on firing, a little stretch on each step.
      const sq = a.squashT / 0.12;
      const sx = SPRITE * (1 + 0.16 * sq + (moving ? 0.03 * Math.sin(now / 45) : 0));
      const sy = SPRITE * (1 - 0.14 * sq + (moving ? 0.05 * Math.abs(Math.sin(now / 90)) : 0));
      const flip = Math.cos(a.aim) < 0 ? -1 : 1;
      a.sprite.position.set(a.x, bob, a.z);
      a.sprite.scale.set(sx * flip, sy, 1);
      a.refl.position.set(a.x, 0.012, a.z);
      a.refl.scale.set(sx * flip, -sy * 0.8, 1);
      a.sprite.material.color.setHex(now < a.flashUntil ? 0xffffff : a.color);
      if (a.pendingDmg > 0 && now - a.pendingAt > 70) {
        this.fx.word(a.x, a.z, String(Math.round(a.pendingDmg)), a.pendingColor, 1.0, 0.8);
        a.pendingDmg = 0;
      }
      a.shadow.position.set(a.x, 0.015, a.z);
      a.hpBg.position.set(a.x - 0.7 + up.x, up.y, a.z + up.z);
      a.hpFill.position.set(a.x - 0.7 + up.x, up.y, a.z + up.z);
      a.hpFill.scale.x = 1.4 * Math.min(1, Math.max(0, a.hp / HEROES[a.hero].hp));
    }
    const p = this.player;
    if (p && p.alive) {
      const r = HEROES[p.hero].range;
      const pos = this.aimLine.geometry.attributes.position as THREE.BufferAttribute;
      pos.setXYZ(0, p.x + Math.cos(p.aim) * 0.8, 0.06, p.z + Math.sin(p.aim) * 0.8);
      pos.setXYZ(1, p.x + Math.cos(p.aim) * r, 0.06, p.z + Math.sin(p.aim) * r);
      pos.needsUpdate = true;
      this.aimLine.computeLineDistances();
      this.marker.position.set(p.x, 0.03, p.z);
    } else this.aimLine.visible = this.marker.visible = this.reach.visible = false;
  }

  private endMatch(won: boolean): void {
    if (this.over) return;
    this.over = true;
    this.running = false;
    this.shootHeld = this.drawHeld = false;
    this.aimLine.visible = this.marker.visible = this.reach.visible = false;
    sfx.end(won);
    this.hud.result(won, this.time, this.kos, () => this.hud.title((h) => this.start(h)));
  }
}
