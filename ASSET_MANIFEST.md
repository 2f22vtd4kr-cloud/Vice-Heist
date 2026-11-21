# Vice Heist runtime asset manifest

All runtime assets are based on the user-supplied artwork and collision files; no replacement character/map art was generated.

| Asset | Dimensions | Purpose |
|---|---:|---|
| `map/take-1.webp` … `take-8.webp` | 2048×2048 each | Runtime map sectors, row-major 2×4 layout |
| `map/mask-1.png` … `mask-8.png` | 2048×2048 each | Binary collision masks; white solid, black walkable |
| `map/collision.png` | 8192×4096 | Stitched collision reference atlas |
| `characters/vice-creatures-atlas.png` | 1120×1120 | Runtime 7-color × 7-pose atlas, 160×160 frames (generated from the committed art ZIP at build/start) |
| `characters/vice-creatures-atlas.json` | — | Generated color, pose and frame-index contract |
| `ui/buttons/*.svg` | Scalable | Nine coordinated runtime button surfaces extracted from the art ZIP |
| `characters/balaclava-sheet.webp` | 2048×2048 | Legacy source retained; not used by runtime actors |

Lossless original map PNGs, the original supplied character sheet, and the supplied revision-2 mask archive are preserved in the top-level `assets-source/` directory. They are not copied into the public production bundle.

The supplied art ZIP is committed at the repository root. `npm run prepare:assets` extracts its seven-color × seven-pose atlas and nine SVG button surfaces before validation, build, or start. Atlas rows are idle, run A, run B, walk, ghost, seated and crouch; columns are teal, red, blue, purple, brown, charcoal and pink. The runtime uses the original colors, a restrained 3 FPS run cycle and the ghost pose for eliminated characters.
