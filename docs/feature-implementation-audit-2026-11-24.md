# Vice Heist feature implementation audit — 2026-11-24

## Scope in this branch

### Implemented in this branch
- Added `client/src/audio.ts` with a lazy-unlocked Web Audio engine, separate effects and ambience gain controls, event cues for round start, elimination, death, body discovery, task completion, meeting, sabotage and both victory outcomes.
- Added material-specific footstep cues (carpet, wood, tile, metal) and zone-dependent ambient tones with distance attenuation for the lounge, suite, pool, garage, server room, generator bay, dock and terrace.
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
- The current ambience implementation is synthesized tonal ambience, not recorded water, boat, city traffic, fluorescent ballast, server fan or generator recordings. These need authored/cleared audio samples to achieve the requested realism.
- Security-camera live feeds, vent traversal and physical door-lock collision gates remain unimplemented. The settings panel now states this accurately instead of implying they are wired.
- Task completion is still accepted by the existing server `use` event based on proximity; puzzle answers are not independently validated server-side.
- Boat refuelling target position has not been moved because the dock collision/art coordinates must be visually checked before changing it.
- More expressive bot schedules, social group behavior, suspicion-driven casual movement, and context-aware fallback chat beyond the existing keyword branches remain follow-up work.
- Kill animation assets exist and the current client plays the kill-lunge animation when a local Mole sees a victim transition to dead; weapon-specific attack animation selection still needs a gameplay pass.

## Verification
- This branch requires CI typecheck/build and existing server regressions before merge.
- No physical iPhone or Replit Preview validation has been performed.
