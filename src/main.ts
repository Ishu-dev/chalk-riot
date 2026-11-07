import { Game } from './game';
import { Hud } from './hud';
import { World } from './world';

const world = new World();
const hud = new Hud();
const game = new Game(world, hud);
hud.title((hero) => game.start(hero));

let last = performance.now();
function frame(t: number): void {
  const dt = Math.min(0.05, (t - last) / 1000);
  last = t;
  game.update(dt);
  world.update(dt, game.dryR());
  requestAnimationFrame(frame);
}
requestAnimationFrame(frame);
