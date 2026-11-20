# Required supplied art assets

The source archive contains these assets. They must be committed to this repository before deployment:

- map/take-1.webp through map/take-8.webp (2048 × 2048 each)
- map/mask-1.png through map/mask-8.png (2048 × 2048 binary masks)
- map/collision.png (stitched 8192 × 4096 binary collision mask)
- characters/balaclava-sheet.webp (2048 × 2048 RGBA 4 × 4 sprite sheet, 512px frames)

All eight individual masks were pixel-compared against the corresponding quadrants of collision.png; all eight match exactly. Collision.png is binary black/white with dimensions 8192 × 4096. The player sprite sheet is 2048 × 2048 RGBA with 16 complete, non-clipped frames.

The GitHub connector used for this session supports text-file writes but cannot transfer local binary files. The assets are available in the supplied source ZIP and must be uploaded to these exact paths before the game can launch.
