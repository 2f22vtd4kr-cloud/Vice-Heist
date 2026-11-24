# Vice Heist bug-fix audit — 2026-11-24

## Baseline verified on main
- Vision used a hand-written camera projection and was redrawn from scene update rather than Phaser's completed render. The canvas could therefore diverge from the estate camera transform.
- The local player was placed in the remote interpolation buffer and rendered 110ms behind. Input was only sent to the server, causing visible touch latency.
- Ghost joystick positioning depended on flex layout after hiding action buttons; HUD state did not enforce fixed geometry.
- Killer bots required distance <125 and line of sight unless distance <72, creating a narrow contact threshold.

## Fix 1 — camera-locked vision
**client/src/main.ts**
- Draw vision from Phaser POST_RENDER and unregister on shutdown.
- Transform ray endpoints through Phaser camera.matrix.transformPoint(), including the active camera transform.
- Reuse a single Vector2 for projected ray endpoints.
**Verification:** build/typecheck pending; visual Preview confirmation still required.

## Fix 2 — local movement
**client/src/main.ts**
- Local snapshots update only the server reconciliation target; local actor is removed from remote interpolation.
- Local movement predicts every frame using matching speed, analog magnitude and packed-mask collision sweep.
- No correction is applied during active input. Idle reconciliation uses elapsed-time exponential smoothing.
- Remote players retain 120ms interpolation.
**Verification:** existing movement regression covers full-speed, analog, stop, stale epoch, lease expiry and resume. Browser/device interaction remains pending.

## Fix 3 — ghost joystick
**client/src/main.ts; client/src/style.css**
- Enforce fixed 124x124 geometry and right alignment when eliminated; reset temporary inline styles when alive.
**Verification:** build pending; physical iPhone portrait/landscape validation required.

## Fix 4 — killer bot contact
**server/src/index.ts**
- Increase attack distance to 150; allow close-contact attack through a small mask/actor mismatch up to 108. Normal attacks remain line-of-sight constrained.
**Verification:** deterministic solo bot regression should confirm a human Crew target is eliminated; CI pending.