# Chalk Riot

3v3 top-down arena brawler prototype. Chalk doodle heroes on wet asphalt, rain washing the court away. Vite + TypeScript + Three.js. Everything (characters, walls, ground, sound) is generated in code; there are no asset files.

    npm install
    npm run dev        # http://localhost:5173 (or the port Vite prints)
    npm run build      # typecheck + production build into dist/

## Controls
- WASD / arrows: move
- Mouse: aim. Left click (hold): shoot
- Hold right click, or hold Shift, and move the mouse: draw chalk cover (within the dashed reach circle)
- M: mute
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

Both teams always field one of each hero. Bots on both sides chase the nearest enemy, strafe, keep to dry ground, and draw a short wall when hurt.

Tuning lives in `src/config.ts`. `window.__chalk` exposes the game for automated playtests.
