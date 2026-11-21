# Vice Heist build and verification status

Updated 2026-11-21.

- The supplied ZIP remains the single source of truth for the new character atlas and nine button SVGs. Build and start extract the 7×7 (49-frame) atlas and buttons automatically with the lightweight `fflate` dependency.
- Player actors use the seven supplied color variants directly, at a consistent 0.78 world scale. Run animation cycles through the supplied run A, run B and walk frames at 3 FPS; eliminated players use the ghost pose.
- Vision is based on collision-mask contours, with local contour sampling and angular rays rather than a fixed fan alone.
- Mobile controls retain the left-side joystick and right-side action controls; responsive menu layout is covered by the client styles.
- Verified locally: `npm run build`, `npm test`, strict client/server TypeScript checks, 49-frame alpha validation and all nine button SVG asset checks.
- Bot navigation regression: all surviving bots moved at least 100 world units and completed tasks during the test window; no unattended stationary bots were observed.
- GitHub Actions for the existing vision/scale PR previously passed its build-and-test job. The art integration must run through CI after this PR head is updated.
- Not yet verified: real Replit deployment, Telegram initData authentication, multi-device mobile multiplayer, and final visual acceptance of vision contours on actual devices. Do not treat a local sandbox as production deployment.
