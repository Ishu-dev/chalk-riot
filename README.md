# Chalk Riot

3v3 top-down arena brawler prototype. Chalk doodle heroes on wet asphalt, rain washing the court away. Vite + TypeScript + Three.js. Everything (characters, walls, ground, sound) is generated in code; there are no asset files.

    npm install
    npm run dev        # http://localhost:5173 (or the port Vite prints)
    npm run build      # typecheck + production build into dist/

## Controls
- WASD / arrows: move
- Mouse: aim. Left click (hold): shoot
- Hold right click, or hold Shift, and move the mouse: draw chalk cover (within the dashed reach circle)
- M: mute sound and music
- Title: 1 / 2 / 3 or click to pick a hero. R or click on the result screen for a rematch.

## Core mechanics
- Shooting: twin-stick aim with stored shots that recharge one at a time.
- Drawing cover: walls cost chalk by length (12 m max, refills 1.1 m/s). They block shots and movement, take damage, and wear down in the rain.
- Rain: from 0:15 the dry circle shrinks, reaching its smallest at 1:30. Outside it you take damage and drawn walls wash away fast.

## Heroes
| Hero | Role | HP | Shots | Notes |
|---|---|---|---|---|
| Scribble | all-rounder | 100 | 3 | medium range single shot |
| Smudge | tank | 140 | 3 | 5-pellet spray, short range |
| Stretch | sniper | 80 | 2 | long range, slow reload |

Both teams always field one of each hero. Your shots deal 1.8x damage and connect from 0.5 m (bots: 0.2 m); bot shots deal 0.7x damage to you. Set in `T` in `src/config.ts`. Bots on both sides chase the nearest enemy, strafe, keep to dry ground, and draw a short wall when hurt.

## Game feel
- Line boil: each figure cycles three hand-drawn redraws about 8 times a second; reflections in the wet asphalt.
- Hits: hit-stop, screen shake, squash on firing, chalk damage numbers, chalk stains the rain slowly washes off.
- Knockouts: "ERASED!" scrawl, a short bark from the winner, slow motion on the final knockout.
- Weather: lightning and rolling thunder, puddle ripples, footstep splashes; rain gets heavier, louder and stormier as the dry circle shrinks. The camera drifts with you.
- Music: procedural D minor loop (i - VI - iv - V) from 84 to 130 BPM. It starts as a pad, a soft kick and chalk scratches, then adds bass, claps, an arpeggio and 16th hats as the storm builds.

Bots path round cover with A* on a 0.5 m grid (`src/nav.ts`).

Tuning lives in `src/config.ts`. `window.__chalk` exposes the game for automated playtests.
