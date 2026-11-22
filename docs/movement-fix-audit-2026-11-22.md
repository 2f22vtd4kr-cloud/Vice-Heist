# Vice Heist movement and animation repair — 2026-11-22

## Root cause and design

The prior implementation sent movement packets every 50ms and advanced authoritative coordinates only when each packet arrived. Client prediction ran every rendered frame, but a fixed per-frame correction pulled the local sprite toward stale acknowledgements even while input was held. Both client and server also normalized every non-zero joystick vector to full speed.

The upstream reference clone uses Phaser Arcade Physics velocity on the local player every update and sends movement state to its server. Vice Heist adopts the responsive local-prediction principle without copying that clone's client-coordinate trust model.

## Implemented changes

- Movement packets now communicate directional intent. The server integrates held input on its existing 50ms simulation/snapshot tick and remains the sole owner of authoritative player coordinates.
- Client prediction continues every Phaser frame. Authoritative acknowledgements are not chased while input is held; after release, the client eases toward the server's acknowledged stop position using elapsed-time smoothing.
- Joystick magnitude is preserved from 0–1. Keyboard diagonals are normalized and remain capped at 370 world units/second.
- Both client prediction and server authority sweep movement in at-most-6-world-unit collision substeps, checking X and Y independently so corner sliding is retained and low-frame-rate/tick stalls cannot tunnel through thin collision boundaries.
- Releasing the stick sends an explicit zero vector, immediately clears server-held input, broadcasts the authoritative stopped position, and acknowledges that position.
- Disconnect, death, and non-playing phases clear held movement input.
- Remote snapshots remain at 20Hz with 100ms interpolation delay.
- Walk cycles remain at 5fps (200ms per pose); maximum movement speed remains 370 world units/second.
- Existing collision-mask interpretation, vision radius, camera transform, and canvas-based shadow projection are unchanged.

## Regression coverage

`scripts/test-movement-stop.mjs` now verifies:
- Held full-speed input advances the authoritative player by the expected distance over a timed interval.
- A 25% joystick vector moves at approximately 25% of full speed.
- Explicit release stops movement and the authoritative position remains stationary for 900ms, for both full and analog movement.

Run `npm run build`, `npm test`, and `git diff --check`. Interactive verification is still required for keyboard focus, mobile pointer release, 60fps visual pacing, corner sliding, narrow doorways, and two-client latency.
