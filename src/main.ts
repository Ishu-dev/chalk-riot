import { Game } from './game';
import { Hud } from './hud';
import { World } from './world';
import { sfx } from './sfx';

const world = new World();
const hud = new Hud();
const game = new Game(world, hud);
hud.title((hero) => game.start(hero));
(window as unknown as { __sfx: typeof sfx }).__sfx = sfx; // test hook, like window.__chalk

let last = performance.now();
function frame(t: number): void {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  game.update(dt);
  world.update(dt, game.dryR(), game.rainLevel());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
