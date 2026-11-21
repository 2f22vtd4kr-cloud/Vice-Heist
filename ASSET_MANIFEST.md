# Vice Heist runtime asset manifest

The six supplied PNG sheets at the repository root are the source of truth. atlas.json maps every named frame to its exact sheet coordinates. npm run prepare:assets slices these frames into individually cacheable transparent PNGs under client/public/assets/vice-heist/ before validation/build/start.

| Sheet | Source dimensions | Frames | Runtime use |
|---|---:|---:|---|
| 1 · HUD buttons and interaction icons | 2048×2048 | 16 | HUD action buttons, right-hand joystick, task/admin markers |
| 2 · Map props and sabotage overlays | 2048×2048 | 16 | Task glows, body outlines, map/status/settings visual assets |
| 3 · Character actions | 2048×2048 | 16 | Four-frame up/down movement, Mole lunge, ghost animation |
| 4 · Cutscenes | 2048×1536 | 4 × 1024×768 | Role reveal, elimination, meeting, victory |
| 5 · Menu/lobby/voting UI | 2048×2048 | 13 | Menu backdrop/logo/button plate, lobby, meeting and map panels |
| 6 · Task mini-games | 2048×2048 | 8 × 1024×512 | The eight estate task mini-game illustrations |

Frames are cropped using the supplied atlas coordinates, with a small inset on transparent cell edges to avoid divider artifacts. The documented green chroma key is removed only when an export has no existing alpha transparency. Sheet 4 remains full-bleed.

The Phaser client loads the sliced character frames and registers vh-walk-up, vh-walk-down, vh-kill-lunge, and vh-ghost-float. The mobile HUD uses the supplied image buttons and right-hand joystick art. Task completion opens the corresponding Sheet 6 illustration and a touch-friendly puzzle before asking the server to validate the nearby task.

Server-backed gameplay remains authoritative for movement, role checks, task proximity/completion, kills, body reports, meetings, votes and the currently implemented lights/doors sabotage. The art for vents, CCTV and additional sabotage types is included in the UI asset set, but those mechanics are not silently enabled by artwork alone.

The legacy balaclava sheet and original source map/mask files are retained. No replacement art is generated.
