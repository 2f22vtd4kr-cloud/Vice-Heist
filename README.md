# Vice Heist

A mobile-first Telegram HTML5 social-deduction game set at Ocean Drive Estate.

## Run on Replit

1. Import this repository into Replit.
2. Use Node.js 22.
3. Allow Replit to install the dependencies from `package.json`.
4. Set `BOT_TOKEN` in Replit Secrets when launching through Telegram. Never place the token in client code.
5. Run `npm run build && npm start`. Express and Socket.IO share `process.env.PORT || 3000`.

For local browser development, run `npm install` and `npm run dev`.

## Project layout

- `client/`: Vite, Phaser 3, touch controls, Telegram WebApp bootstrap and game assets.
- `server/`: Express, Socket.IO, server-owned roles, tasks, meetings, votes, sabotage, eliminations and win checks.
- `shared/`: shared game state types.
- Single-player: solo match with five AI residents.
- Multiplayer: private room codes and host-started matches.

## Required art assets

The source ZIP contains the 8 map tiles, 8 binary masks, stitched collision mask and 4×4 character sheet. They must be committed under `client/public/assets/` at the paths listed in `client/public/assets/ASSETS_REQUIRED.md` before this repository is launchable.

## Release verification

Run `npm run typecheck` and `npm run build`. Then verify solo mode, two-client multiplayer, keyboard and touch controls, collision at all sector boundaries, tasks, Mole actions, body reports, emergency meetings, voting, vision occlusion, reconnect behaviour and Telegram authentication in real browsers. A successful build is not a substitute for gameplay testing.
