import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const mapDir = path.join(root, 'client/public/assets/map');
const PIXELS = 2048 * 2048;
const BYTES = PIXELS >> 3;

for (let index = 1; index <= 8; index++) {
  const sourcePath = path.join(mapDir, `mask-${index}.png`);
  const outputPath = path.join(mapDir, `mask-${index}.bin`);
  if (!fs.existsSync(sourcePath)) throw new Error(`Missing collision mask: ${sourcePath}`);
  const png = PNG.sync.read(fs.readFileSync(sourcePath));
  if (png.width !== 2048 || png.height !== 2048) {
    throw new Error(`Collision mask ${index} must be 2048 × 2048.`);
  }
  const packed = Buffer.alloc(BYTES);
  for (let pixel = 0, offset = 0; pixel < PIXELS; pixel++, offset += 4) {
    const r = png.data[offset], g = png.data[offset + 1], b = png.data[offset + 2];
    if ((r !== 0 && r !== 255) || g !== r || b !== r) {
      throw new Error(`Collision mask ${index} contains non-binary or non-grayscale pixels at ${pixel}.`);
    }
    // Preserve the existing collision convention: white pixels are solid.
    if (r > 200) packed[pixel >> 3] |= 1 << (pixel & 7);
  }
  fs.writeFileSync(outputPath, packed);
  console.log(`Packed collision mask ${index}: ${packed.byteLength.toLocaleString()} bytes.`);
}
