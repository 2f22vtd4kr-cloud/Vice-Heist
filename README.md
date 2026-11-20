# Vice Heist

A mobile-first Telegram HTML5 social-deduction game set at **Ocean Drive Estate**. The project uses Phaser 3, TypeScript, Vite, Express and Socket.IO. The browser client and multiplayer server share one Replit port.

## Run on Replit

1. Upload this ZIP into a new Replit Node.js project (or import the extracted folder).
2. Use Node.js 22 or newer.
3. Replit installs dependencies from `package.json`.
4. Click **Run**. The `.replit` command builds the client and server, validates the supplied art/collision assets, then starts Express + Socket.IO on `process.env.PORT || 3000`.
5. For Telegram identity validation, add `BOT_TOKEN` as a Replit Secret. Set `REQUIRE_TELEGRAM_AUTH=true` when you want to reject browser/guest sessions unless a valid Telegram `initData` payload is supplied. Leave it false for ordinary browser testing.

No Replit Agent changes are required to get the project started. The game can be tested in a normal browser; Telegram WebApp APIs are used when available and safely ignored otherwise.

## Local run

```bash
npm install
npm run build
npm start
```

The server exposes `/health` for a basic process check. The production build is served by the same Express process as Socket.IO.

## Included game systems

- Solo match against five AI residents, plus private multiplayer rooms with five-character join codes (host start unlocks at four human players; ten-player room cap).
- Server-owned roles, movement limits, pixel-mask collision, task completion, eliminations, sabotage, body reports, emergency meetings, chat, voting and win checks.
- Resumable player sessions for short mobile/network interruptions, with a 30-second reconnect grace period.
- Client prediction with server reconciliation, remote-player interpolation, keyboard controls and mobile virtual joystick.
- 8 stitched 2048×2048 Ocean Drive Estate sectors, matching binary collision masks, wall-blocked vision rays, and collision debug overlay (`C`).
- Supplied 4×4 balaclava creature sprite sheet with idle, run and downed animation rows; player color tinting.
- Optional per-session Groq API key for AI meeting dialogue. The key is sent to the game server over the Socket.IO connection, held in memory only, never written to disk or included in public player state. Without a key, deterministic dialogue fallback is used.
- Synthesized UI/footstep feedback tones, Telegram haptics when available, and safe-area-aware touch controls.

## Assets

Runtime assets are under `client/public/assets/`:

- `map/take-1.webp` … `take-8.webp`: optimized runtime estate sectors.
- `map/mask-1.png` … `mask-8.png`: exact 2048×2048 binary masks; pure white is solid, pure black is walkable.
- `map/collision.png`: stitched 8192×4096 collision atlas retained for inspection/reference.
- `characters/balaclava-sheet.webp`: runtime 2048×2048 4×4 sprite sheet, 512×512 frames.
- `assets-source/`: lossless original map PNGs, the uploaded character-sheet PNG, and revision-2 masks/manifest. These originals are kept outside the public web bundle.

The runtime server converts each sector mask into a compact one-bit representation instead of retaining the full 8192×4096 RGBA atlas in memory. The client also removes decoded mask textures after building its compact collision lookup tables.

## Environment

Copy `.env.example` to `.env` for local testing. Never commit real bot tokens or API keys.

- `PORT`: provided by Replit; defaults to `3000` locally.
- `BOT_TOKEN`: Telegram bot token used only for server-side `initData` verification.
- `REQUIRE_TELEGRAM_AUTH`: optional `true`/`false`, default `false` for browser testing.

Players may optionally enter their own Groq API key on the main menu. It is not a project-level secret and is not shared between players.

## Checks and release limitations

```bash
npm run validate:assets
npm run typecheck
npm run build
```

The asset validator checks all eight binary masks and required runtime/original art files. The build/typecheck commands are the release gate. This package has had static source checks and asset geometry checks; a full dependency install, production build and real-browser playtest were not possible in the current execution environment. The first Replit run performs the dependency-backed build and asset validation. Please treat that as the first runtime verification, not as proof of public-launch readiness.

The included AI is a lightweight game NPC system, not a full human-equivalent social agent. Groq improves its conversational responses when a player supplies a key; the deterministic fallback remains available offline. Task interactions currently use a secure proximity-checked completion action rather than eight bespoke puzzle minigames. The current sabotage action is Lights Out; a visual door-lockdown effect is not yet included.
