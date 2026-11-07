export const ARENA_R = 19; // players are kept inside this circle
export const FENCE_R = 20.5; // octagon fence drawn just outside it

export const TEAM_COLOR = [0x7fe3c4, 0xff8a73] as const; // mint (yours), coral (theirs)
export const PLAYER_COLOR = 0xf6f3ea;

export type HeroId = 'scribble' | 'smudge' | 'stretch';

export interface HeroDef {
  name: string;
  blurb: string;
  hp: number;
  speed: number;
  ammo: number; // shots stored
  reloadMs: number; // time to regain one shot
  pellets: number;
  spread: number; // total cone in radians
  bulletSpeed: number;
  range: number;
  damage: number; // per pellet
}

export const HEROES: Record<HeroId, HeroDef> = {
  scribble: { name: 'Scribble', blurb: 'All-rounder. Steady chalk shots.', hp: 100, speed: 6, ammo: 3, reloadMs: 1100, pellets: 1, spread: 0, bulletSpeed: 33, range: 13, damage: 12 },
  smudge: { name: 'Smudge', blurb: 'Tank. Short-range dust spray.', hp: 140, speed: 5.3, ammo: 3, reloadMs: 1300, pellets: 5, spread: 0.55, bulletSpeed: 27, range: 7.5, damage: 5 },
  stretch: { name: 'Stretch', blurb: 'Sniper. Long, slow, hits hard.', hp: 80, speed: 5.6, ammo: 2, reloadMs: 1700, pellets: 1, spread: 0, bulletSpeed: 48, range: 21, damage: 21 },
};

export const T = {
  actorR: 0.6,
  bulletR: 0.2, // bot shots, and every shot against walls
  playerHitR: 0.5, // your shots connect from further out, so near misses still land
  playerDamageMult: 1.8, // your shots hit harder than the same hero's bot shots
  botVsPlayerMult: 0.7, // bot shots hurt you less than they hurt each other
  minShotGapMs: 280,
  chalkMax: 12, // metres of wall you can hold
  chalkRegen: 1.1, // metres per second
  drawRange: 7, // you can only draw this far from yourself
  drawStep: 0.7, // one wall piece per this many metres of cursor travel
  wallHp: 45,
  wallHalfThick: 0.14,
  wallDecay: 0.6, // hp/s from ordinary rain
  washedWallDecay: 25, // hp/s outside the dry circle
  washDps: 9, // damage per second to anyone standing outside the dry circle
  rainStart: 15, // seconds before the dry circle starts shrinking
  rainFull: 90, // seconds at which it reaches its smallest size
  dryMax: 21,
  dryMin: 5.5,
  botWallCdMs: 6000,
  botAimError: 0.16, // radians either side
};

export const dryRadius = (t: number): number => {
  if (t < T.rainStart) return T.dryMax;
  const k = Math.min(1, (t - T.rainStart) / (T.rainFull - T.rainStart));
  return T.dryMax + (T.dryMin - T.dryMax) * k;
};
