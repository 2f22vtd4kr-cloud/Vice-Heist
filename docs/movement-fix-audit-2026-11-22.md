# Vice Heist movement and animation repair audit — 2026-11-22

## Scope
Repair the client movement path and network presentation without changing authoritative movement speed (370 world units/second), collision-mask semantics, player roles, or server ownership of player coordinates. Preserve the existing camera/vision shadow projection fix.

## Confirmed causes
- The movement packet sequence was incremented for every 50ms packet, while all acknowledgements except the newest sequence were discarded. At ordinary RTTs above the send interval, most acknowledgements were stale and the client relied on coarse snapshots to reconcile.
- Remote player snapshots were emitted every 100ms (10Hz).
- Vision performed 960 rays at 2-world-unit increments with eight boundary refinements up to 30 times/second on the main thread.
- Joystick travel was fixed at 43px despite responsive base/knob dimensions; release depended on the stick retaining pointer capture.
- Keyboard focus was not restored from the menu iframe to the Phaser canvas.
- Walk cycles were registered at 8fps.

## Changes
- Movement sequence is now a movement epoch, changed only when a held movement begins or ends. Every packet also has a monotonically increasing request ID. Only newer acknowledgements from the active epoch update the reconciliation point; release invalidates all outstanding movement acknowledgements.
- Remote snapshots now publish at 20Hz using the existing 50ms server timer; interpolation delay is 100ms.
- A zero-vector release immediately broadcasts the authoritative stopped position.
- Vision is reduced to 512 rays, 4-unit spacing, five boundary refinements, and a 20fps redraw cap. Vision radius, collision masks, collision rules, and the corrected camera transform are unchanged.
- Joystick travel is calculated from actual rendered base, knob, and border dimensions. The active pointer is tracked; pointer-up/cancel are handled on the stick and window, with lost-capture fallback.
- The visible menu-to-game transition returns keyboard focus to the Phaser canvas without stealing focus during routine state updates.
- Walk cycles run at 5fps (200ms per frame), holding each of the four poses longer. Authoritative speed remains 370 world units/second.
- Server regression waits for the authoritative start snapshot, proves ten rightward inputs advance at least 60 world units, then verifies release holds within 2 units for 900ms.

## Verification
Run `npm run build`, `npm test`, and `git diff --check`.
The server-level regression does not replace interactive verification of keyboard focus, mobile touch release, 60fps visual pacing, corner sliding, narrow doorways, and two-client latency.

## Files
- `client/src/main.ts`
- `server/src/index.ts`
- `scripts/test-movement-stop.mjs`
- `docs/movement-fix-audit-2026-11-22.md`
