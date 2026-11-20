# Lossless source assets

These are the exact original user-supplied assets preserved in the delivery archive. They are kept outside `client/public` so Vite does not copy large source PNGs into the production web bundle.

- `map/`: all eight original 2048×2048 PNG estate sectors.
- `characters/balaclava-creature-sheet-original.png`: supplied 2048×2048 4×4 balaclava sprite sheet.
- `mask-r2/`: revision-2 binary masks under `masks/` and their original manifest (relative paths preserved).

Runtime-optimized WebP tiles, runtime collision masks and the stitched collision atlas are under `client/public/assets/`.
