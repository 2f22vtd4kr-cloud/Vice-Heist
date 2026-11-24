# Vice Heist implementation status — 2026-11-24

This document supersedes the earlier same-day audit notes below. It reflects the current `main` branch after the latest merged implementation PRs. It does not claim physical-device or Replit/Telegram playtesting.

## Implemented and merged

### Audio and playlist
- The supplied master tracks are committed in the repository root:
  - `Bohren & der Club of Gore – Kleiner Finger.m4a`
  - `Rose Bianche.mp3`
- The server serves them at the playlist URLs `/audio/kleiner-finger.m4a` and `/audio/rose-bianche.mp3`, without exposing the repository root.
- Audio integration tests verify both payloads, MIME types and HTTP byte-range streaming.
- The Web Audio engine provides separate music/effects/ambience controls, persistent settings, a continuous menu/gameplay playlist, event cues for round start, kill, death, body discovery, task completion, meeting, sabotage and both victory outcomes.
- Environmental ambience and event cues are procedurally synthesized, not recorded field recordings.

### Loading, map and mobile UI
- The illustrated menu iframe now preloads while the splash is visible. Splash readiness waits for essential game assets, initial map sectors, scene readiness and menu readiness (or fallback completion); Start no longer waits for a late menu load.
- The progress bar includes the menu readiness stage and reaches 100% only after the splash readiness gate completes.
- The built-in accessible menu remains the fallback if the illustrated menu cannot load.
- The estate is represented by eight sector images in a 4×2 layout, aligned to the 8192×4096 world. Player, task and Mole vent markers use world coordinates.
- Nameplates follow interpolated actor positions. Mobile settings retain left/right joystick preference and separate effects/ambience volume controls.

### Movement, vision and round controls
- Server snapshots remain the authoritative position source; remote actors use buffered interpolation and local movement uses reconciliation acknowledgements and explicit stop epochs.
- The expensive Phaser visibility mask was replaced by the screen-sized canvas vision overlay while preserving collision-mask wall checks and ray sampling.
- Round-start elimination grace is enforced by the server.
- The test suite includes movement-stop, ghost movement, bot navigation and related server regressions. These are automated checks, not a physical 60-FPS measurement.

### Tasks and NPC evidence
- All eight task interfaces are present: vault combination, server wire matching, helipad keycard swipe, generator breaker sequence, boat refuelling hold, cocktail ingredient order, pool pressure control and garage scan.
- Task challenges are randomized per round. The server validates task-specific answer classes, proximity, task sessions and elapsed-time checks for swipe/fuel/scan tasks before completion.
- Crew NPCs investigate nearby unreported bodies and report only after reaching them with line of sight. Kill-witness suspicion requires line of sight.
- Crew bots receive distinct unclaimed tasks and use collision-aware navigation. Mole NPCs patrol and hunt; solo target selection has a dedicated regression.
- NPC meeting dialogue rotates speakers with per-NPC cooldowns, answers location questions using the bot's current sector, includes distinct fallback voices and role-aware Mole deflection. Crew NPCs also perform brief buddy check-ins when they naturally cross paths, then resume independent tasks.

### Vents, security and combat
- Mole-only vent traversal is implemented across eight sector anchors, with collision-safe anchor resolution, proximity checks and cooldown. Vent coordinates are hidden from Crew snapshots and shown to the Mole on the map/radar.
- The security monitor renders eight fixed top-down sector camera crops with current animated character sprite frames, facing direction, names and alive/dead state. Each sector has its own camera center independent of the player's camera. Lights sabotage suppresses sprite tracking and displays a signal-loss state until the sabotage expires.
- Mole weapons are assigned deterministically per round (crowbar, pistol or knife). Kill events carry weapon identity; the client renders distinct vector attack effects and matching sound cues.
- Eliminated characters now play a short collapse tween before entering ghost-float mode.

## Still outstanding

1. **Physical door lockdown:** the server has a placeholder `doors` sabotage state, but the game does not yet have authored, collision-aligned door gate positions or a selectable door-lockdown control. Do not describe doors as physically locked.
2. **Recorded ambience:** water/traffic/room/machinery beds and event cues are synthesized. Recorded or properly licensed field recordings have not been added; the current request for ambient beds and jazzy action cues is covered procedurally.
3. **Broader NPC schedules:** independent task selection, Mole patrol/hunt, evidence reactions, meeting dialogue and brief buddy check-ins are implemented; longer multi-step civilian routines and coordinated group patrol plans remain a possible enhancement.
4. **Physical playtesting:** iPhone Safari, Replit Preview and Telegram Mini App testing are intentionally left to the user.

## Verification and merge record

The latest implementation batches were merged after the repository's build and regression workflow passed:
- PR #44 — serve the uploaded playlist tracks.
- PR #45 — Mole vent network, map/radar markers, solo Mole hunt reliability.
- PR #46 — playlist streaming regression.
- PR #47 — NPC conversation diversity and context-aware replies.
- PR #48 — accurate vent/security settings copy.
- PR #50 — weapon-specific Mole attack effects and cues.
- PR #52 — preload the illustrated menu before splash readiness.
- PR #53 — connect lights sabotage to CCTV tracking loss.
- PR #54 — natural collapse animation before ghost mode.
- PR #56 — independent NPC buddy check-ins.
- PR #58 — rendered fixed top-down CCTV sector cameras.

PR #49, PR #51 and PR #57 were superseded and closed. Automated CI does not replace the user's requested real-device playtest.
