# Vice Heist feature implementation audit — 2026-11-24

## Scope in this branch

### Implemented in this branch
- Added `client/src/audio.ts` with a lazy-unlocked Web Audio engine, separate effects and ambience gain controls, event cues for round start, elimination, death, body discovery, task completion, meeting, sabotage and both victory outcomes.
- Added layered synthesized event cues (round start, kill, death, body discovery, task completion, meeting, sabotage and both victory outcomes), filtered noise transients for action/footstep texture, and distance-attenuated environmental sound beds for the lounge, suite, pool, garage, server room, generator bay, dock and terrace. These are procedural sounds, not recorded field recordings or the supplied music tracks.
- Footstep material selection now follows the eight named map sectors (carpet in the suite, wood in the lounge/dock, tile on the helipad/pool deck, metal in the garage/server/generator areas). This is sector-level approximation, not per-room polygon floor detection.
- Wired snapshot transitions and local movement to the sound engine.
- Replaced the inaccurate single map illustration with a 4×2 sector-aligned estate map using the eight actual map-sector images. Player and task markers use the same 8192×4096 world coordinates as the game.
- Added player nameplates above character sprites and keeps them aligned with interpolated actor positions.
- Added persisted left/right joystick setting and separate effects/ambience volume controls.
- Reworked settings panel sizing and scrolling for mobile.

### Existing functionality confirmed in current source
- Eight task-specific puzzle interfaces already exist: vault combination, server wire matching, helipad keycard swipe, generator breaker sequence, boat refuelling hold, cocktail ingredient order, pool pressure control and garage scan.
- Existing sprite atlas includes four-frame walk, kill-lunge and ghost animations.
- Existing bot fallback chat has keyword branches for task/location, suspicion/voting and body/death terms.
- Existing bot navigation assigns distinct unclaimed crew tasks and uses collision-aware movement.

## Not implemented by this branch; do not represent as complete
- The two supplied music files are not yet committed under `client/public/audio`. The repository connector available for this work cannot transfer the uploaded binary payloads into GitHub. The Web Audio effects/ambience engine is not a substitute for the supplied playlist. Add the exact uploaded files as `kleiner-finger.m4a` and `rose-bianche.mp3` (or convert both to browser-compatible MP3) before wiring a continuous playlist.
- The current ambience implementation is procedurally synthesized filtered noise and low-frequency machinery beds, not recorded water, boat, city traffic, fluorescent ballast, server fan or generator recordings. These need authored/cleared audio samples to achieve the requested realism.
- Security-camera live feeds, vent traversal and physical door-lock collision gates remain unimplemented. The settings panel now states this accurately instead of implying they are wired.
- Task minigames now submit task-specific answers to the server; the server checks the answer class and proximity before marking the task complete, and the client waits for the server acknowledgement. The puzzle patterns remain fixed rather than per-round randomized; client-side minigame timing claims (swipe/fuel/scan) are still submitted as result values and are not independently measured by the server.
- Boat refuelling target position has not been moved because the dock collision/art coordinates must be visually checked before changing it; the supplied map artwork is not currently available in the source-review interface at pixel inspection resolution.
- Mole bots now patrol the estate and only make a low-probability close-range hunt commitment, rather than immediately pursuing the human across the entire map. More expressive schedules, NPC-to-NPC social coordination, suspicion-driven deception, and richer context-aware fallback chat remain follow-up work.
- Kill animation assets exist and the current client plays the kill-lunge animation when a local Mole sees a victim transition to dead; weapon-specific attack animation selection still needs a gameplay pass.

## Verification
- This branch requires CI typecheck/build and existing server regressions before merge.
- No physical iPhone or Replit Preview validation has been performed.


## Follow-up implementation — 2026-11-24

- Added per-round randomized task challenge data and server-side answer validation for all eight tasks.
- Added proximity-checked task-start sessions; invalid, remote, dead-player and Mole task attempts are rejected.
- Added server-measured swipe duration and fuel-hold duration checks, plus elapsed-time validation for the garage scan.
- Existing fixed task patterns and client-asserted hold/scan values have been removed from the active task flow.
- Still outstanding: real recorded environmental ambience, weapon-specific attack animation selection, vent traversal, physical door collision gates, deeper NPC social schedules/deception, and physical iPhone/Replit/Telegram validation. The supplied music binaries still need to be added to the repository; this connector cannot write uploaded binary bytes to GitHub directly.


## NPC evidence follow-up — 2026-11-24

- Crew NPCs now investigate nearby unreported bodies, navigate toward the corpse, and call a meeting only after reaching it with clear line of sight.
- Kill-witness suspicion now requires actual line of sight as well as proximity, reducing false accusations through walls.
- Still outstanding: broader NPC social routines, coordinated buddy patrols and deception, weapon-specific attack art, vent traversal, physical door gates, recorded environmental ambience, the uploaded music binaries in the repo, and device/preview validation.
