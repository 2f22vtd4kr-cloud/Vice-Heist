# Vice Heist engineering guardrails

- Preserve the supplied Ocean Drive Estate tiles, binary collision masks and balaclava sprite sheet.
- Server owns roles, task completion, kill validation, votes, sabotage timers and win checks.
- Never send another player's role to a client.
- Keep Express and Socket.IO on the same `PORT`.
- Run `npm ci`, `npm run typecheck`, and `npm run build` before release.
- Verify solo mode, two-client multiplayer, touch, keyboard, collision boundaries, task completion, Mole actions, meetings, voting, mobile layout and Telegram auth.
- A passing build is not a substitute for real browser playtesting.
