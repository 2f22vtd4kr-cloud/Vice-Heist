# Required supplied art assets

Place the supplied files here before running the game:

- `map/take-1.webp` through `map/take-8.webp` (2048 × 2048 each)
- `map/mask-1.png` through `map/mask-8.png` (2048 × 2048 binary masks)
- `map/collision.png` (stitched 8192 × 4096 binary collision mask)
- `characters/balaclava-sheet.webp` (2048 × 2048 RGBA 4 × 4 sprite sheet, 512px frames)

The source archive assembled during this implementation contains these converted assets. The GitHub connector used for this session supports text-file writes but not uploading local binary files; therefore the asset payload is not yet present in this repository branch. Do not treat the game as launch-ready until these exact assets are added and runtime-checked.
