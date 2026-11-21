import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const atlas = JSON.parse(fs.readFileSync(path.join(root, 'atlas.json'), 'utf8'));
const output = path.join(root, 'client/public/assets/vice-heist');
fs.mkdirSync(output, { recursive: true });

function keyGreenIfNeeded(png, key) {
  if (key === 'sheet4_cutscene_slides') return;
  let transparent = false;
  for (let i = 3; i < png.data.length; i += 4) {
    if (png.data[i] < 250) { transparent = true; break; }
  }
  if (transparent) return;
  // Some exports flatten transparency onto the documented #00ff00 chroma.
  // Convert only the unmistakable green key and its anti-aliased fringe.
  for (let i = 0; i < png.data.length; i += 4) {
    const r = png.data[i], g = png.data[i + 1], b = png.data[i + 2];
    const greenDominance = g - Math.max(r, b);
    if (g > 115 && greenDominance > 38 && g > r * 1.28 && g > b * 1.18) {
      const spill = Math.max(0, Math.min(1, (greenDominance - 24) / 90));
      png.data[i + 3] = Math.round(png.data[i + 3] * (1 - spill));
    }
  }
}

function cropFrame(source, frame, inset) {
  const x = frame.x + inset, y = frame.y + inset;
  const width = frame.w - inset * 2, height = frame.h - inset * 2;
  const target = new PNG({ width, height });
  for (let row = 0; row < height; row++) {
    const from = ((y + row) * source.width + x) * 4;
    const to = row * width * 4;
    source.data.copy(target.data, to, from, from + width * 4);
  }
  return target;
}

const manifest = { game: atlas.game, assets: {}, sheets: {} };
let count = 0;
for (const [sheetKey, sheet] of Object.entries(atlas.sheets)) {
  const filename = path.basename(sheet.file);
  const sourcePath = path.join(root, filename);
  if (!fs.existsSync(sourcePath)) throw new Error('Missing supplied art sheet: ' + filename);
  const source = PNG.sync.read(fs.readFileSync(sourcePath));
  if (source.width !== sheet.width || source.height !== sheet.height) {
    throw new Error(filename + ' dimensions do not match atlas.json.');
  }
  keyGreenIfNeeded(source, sheetKey);
  manifest.sheets[sheetKey] = { width: source.width, height: source.height, frames: Object.keys(sheet.frames) };
  for (const [id, frame] of Object.entries(sheet.frames)) {
    const inset = sheetKey === 'sheet4_cutscene_slides' || id === 'menu_bg_art' ? 0 : 5;
    const cropped = cropFrame(source, frame, inset);
    const destination = path.join(output, id + '.png');
    fs.writeFileSync(destination, PNG.sync.write(cropped));
    manifest.assets[id] = { file: id + '.png', sheet: sheetKey, width: cropped.width, height: cropped.height };
    count++;
  }
}
fs.writeFileSync(path.join(output, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log('Prepared ' + count + ' transparent/runtime art frames from all six supplied sheets.');
