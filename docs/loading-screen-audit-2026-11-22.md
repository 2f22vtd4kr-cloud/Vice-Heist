# Vice Heist loading-screen repair — 2026-11-22

## Startup behavior

The game scene and visible splash artwork are startup-critical. The hidden menu iframe is optional and must never prevent the game from becoming ready.

- The menu iframe URL is assigned before insertion into the DOM so its one-shot load listener cannot consume the initial blank-document load.
- Menu preloading runs in the background with an 8-second diagnostic deadline. It checks only for the menu's initialized `#app.is-ready` and non-inert `#stage`; hidden-screen images and fonts do not block game readiness.
- The splash readiness promise waits only for splash artwork and the Phaser scene.
- Once both are ready, the splash displays 100%, enables manual entry, and schedules a guarded automatic transition after 1.5 seconds. A click and the timer share the same idempotent transition.
- If the iframe is unavailable, the built-in menu remains functional with call sign, Solo Heist, Create Private Room, and Join Room actions wired to the existing server actions.
- Extracted splash files are written under `client/public/splash/img/`, matching the URLs requested by the client.
- Vite is pinned to a compatible Vite 7 range for the standalone repository; generated asset bundles are ignored by Git.

## Verification

Run `npm run build` and `npm test`. Browser verification should cover normal iframe readiness, deliberately failed menu requests, phone viewport layout, automatic entry without input, and a Solo Heist launched from the fallback menu.
