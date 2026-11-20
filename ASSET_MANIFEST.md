# Vice Heist runtime asset manifest

All runtime assets are based on the user-supplied artwork and collision files; no replacement character/map art was generated.

| Asset | Dimensions | Purpose |
|---|---:|---|
| `map/take-1.webp` … `take-8.webp` | 2048×2048 each | Runtime map sectors, row-major 2×4 layout |
| `map/mask-1.png` … `mask-8.png` | 2048×2048 each | Binary collision masks; white solid, black walkable |
| `map/collision.png` | 8192×4096 | Stitched collision reference atlas |
| `characters/balaclava-sheet.webp` | 2048×2048 | Runtime 4×4 sheet, 512×512 frames |

Lossless original map PNGs, the original supplied character sheet, and the supplied revision-2 mask archive are preserved in the top-level `assets-source/` directory. They are not copied into the public production bundle.

The 16 sprite frames are arranged in the supplied 4×4 grid. The client uses frames 0–3 for idle, 4–7 for running, and 12–15 for the downed state. Frames 8–11 remain available for interaction animations.
