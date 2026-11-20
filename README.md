# Vice Heist

Mobile-first Telegram HTML5 social-deduction game set at Ocean Drive Estate.

## Run on Replit

1. Import this repository into Replit (Node.js 22 or newer).
2. Set `BOT_TOKEN` in Replit Secrets if Telegram identity verification is required.
3. Run the Replit project. The configured command validates assets, type-checks, builds the Vite client and server, then starts Express and Socket.IO on the same `PORT`.

For a standard terminal:

```sh
npm install
npm run build
npm start
```

Open the Replit webview. `/health` provides a server health check.

## Project layout

- `client/` — Vite + Phaser client, Telegram WebApp bootstrap, mobile touch controls and public runtime assets.
- `server/` — Express + Socket.IO server, server-authoritative game state, collision and multiplayer/solo rules.
- `shared/` — shared TypeScript game-state contracts.
- `assets-source/` — lossless original map art, original character sheet and original revision-2 collision-mask pack; these are preserved but not copied to the public bundle.
- `scripts/` — asset validation.
- `dist/` — generated build output (not committed).

## Game modes

- Solo: one human player with five AI residents.
- Multiplayer: private room codes, host-started rooms and reconnectable sessions.

## Runtime assets

Runtime WebP map sectors, binary collision masks, stitched collision reference atlas and optimized character sheet are stored in `client/public/assets/`. The eight map sectors are arranged row-major in a 2×4 grid. White collision pixels are solid; black pixels are walkable.

## Environment

- `PORT` — supplied by Replit; defaults to 3000.
- `BOT_TOKEN` — Telegram bot token, configured as a server-side secret.
- `REQUIRE_TELEGRAM_AUTH=true` — reject clients without valid Telegram initData. Leave unset for browser development/testing.

The Groq API key is entered by a player in-game and is not a server environment variable.

## Validation

`npm run validate:assets`, `npm run typecheck`, and `npm run build` are available. A successful build is not a substitute for solo/multiplayer browser playtesting on desktop and mobile.
