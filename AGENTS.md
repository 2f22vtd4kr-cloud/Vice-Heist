# Vice Heist engineering guardrails

- Preserve the supplied Ocean Drive Estate artwork, binary collision masks and balaclava sprite sheet. Do not generate replacement art.
- Server owns roles, movement validation, task completion, kill validation, votes, sabotage timers and win checks.
- Never send another player's role or a player's Groq key to any client.
- Keep Express and Socket.IO on the same `PORT`.
- Run `npm run validate:assets`, `npm run typecheck`, and `npm run build` before release.
- Verify solo mode, two-client multiplayer, touch, keyboard, collision at all sector boundaries, task completion, Mole actions, meetings, voting, vision occlusion, reconnect behaviour and Telegram authentication in real browsers.
- A passing build is not a substitute for real browser playtesting.
