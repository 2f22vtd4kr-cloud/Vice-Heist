# Vice Heist

Mobile-first Telegram HTML5 social deduction game set at Ocean Drive Estate.

## Run on Replit
Use Node.js 20+, run `npm install`, then `npm run build` and `npm start`. The Express app and Socket.IO share `process.env.PORT || 3000`. Set `BOT_TOKEN` in Replit Secrets to enable Telegram Mini App initData verification. Never put the token in client code.

## Project layout
- `client/`: Vite, Phaser 3, touch controls, Telegram WebApp bootstrap and supplied game art.
- `server/`: Express, Socket.IO, server-owned roles, tasks, meetings, votes, sabotage, kills and win conditions.
- `shared/`: shared game state types.
- Single-player: solo mode with five AI residents.
- Multiplayer: private room codes and host-started sessions.

## Art and collision assets
The project expects the supplied 8 map takes, eight binary collision masks, stitched 8192x4096 collision image, and 4x4 balaclava sprite sheet at:
`client/public/assets/map/` and `client/public/assets/characters/`.

## Validation
Run `npm run build` and `npm run typecheck`, then verify solo mode, two-client multiplayer, keyboard and mobile controls, collision boundaries, task completion, Mole actions, meetings, voting and Telegram authentication. A successful build is not a substitute for real mobile/browser playtesting.
