# Vice Heist build and verification status

Updated 2026-11-21.

- All six supplied art sheets are wired through atlas.json; the build slices every named frame (73 assets) into client/public/assets/vice-heist/.
- npm run prepare:assets no longer depends on the absent vice-heist-art-pack.zip; the six checked-in sheets are the source of truth.
- Sheet 3 supplies four-frame up/down movement, Mole lunge and ghost animations. The previous runtime reference to the absent vice-creatures-atlas.png has been removed.
- Sheet 1 supplies HUD action art and the right-hand mobile joystick; the action buttons are on the left.
- Sheet 2 supplies task glows, corpse outlines, radar markers and map/status icons. Vent/CCTV/extended sabotage visuals are labelled as not active where the server does not yet implement those mechanics.
- Sheet 4 is used for role reveal, elimination, meeting and victory panels.
- Sheet 5 is used for menu/lobby/map/meeting UI art.
- Sheet 6 is used by eight touch-friendly task puzzles. The server still performs the authoritative proximity, role, phase and completion checks.
- Verified on the merged main commit: GitHub Actions asset validation, TypeScript checks, production build and all server regression tests passed.
- Not yet verified: real Replit deployment, iPhone Safari visual layout, touch interactions on physical devices, and full end-to-end playtesting. Do not treat CI success as a substitute for those checks.
