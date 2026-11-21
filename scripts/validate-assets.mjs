import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const asset = (...parts) => path.join(root, 'client/public/assets', ...parts);
const source = (...parts) => path.join(root, 'assets-source', ...parts);
const atlas = JSON.parse(fs.readFileSync(path.join(root, 'atlas.json'), 'utf8'));
const required = [
  ...Array.from({length:8},(_,i)=>asset('map',`take-${i+1}.webp`)),
  ...Array.from({length:8},(_,i)=>asset('map',`mask-${i+1}.png`)),
  asset('map','collision.png'),
  asset('characters','balaclava-sheet.webp'),
  ...['balaclava-creature-sheet-original.png'].map(name=>source('characters',name)),
  source('mask-r2','manifest.json'),
  source('mask-r2','masks','stitched-mask.png'),
  ...Array.from({length:8},(_,i)=>source('mask-r2','masks',`take-${i+1}-mask.png`)),
  ...['take-1-helipad-security-command.png','take-2-vip-lounge-cocktail-bar.png','take-3-master-suite-safe-vault.png','take-4-infinity-pool-sun-deck.png','take-5-underground-garage-heist-vault.png','take-6-server-surveillance-room.png','take-7-generator-power-bay.png','take-8-speedboat-getaway-dock.png'].map(name=>source('map',name)),
  path.join(root,'client/public/assets/vice-heist/manifest.json'),
];
for (const file of required) {
  if (!fs.existsSync(file) || fs.statSync(file).size < 100) throw new Error(`Missing or empty game asset: ${path.relative(root,file)}`);
}
for (let i=1;i<=8;i++) {
  const file=asset('map',`mask-${i}.png`), png=PNG.sync.read(fs.readFileSync(file));
  if(png.width!==2048||png.height!==2048)throw new Error(`Mask ${i} must be 2048×2048.`);
  for(let p=0,j=0;p<2048*2048;p++,j+=4){
    const v=png.data[j];
    if((v!==0&&v!==255)||png.data[j+1]!==v||png.data[j+2]!==v)throw new Error(`Mask ${i} contains non-binary or non-grayscale pixels.`);
  }
}
if(fs.statSync(asset('map','collision.png')).size<1000)throw new Error('Stitched collision atlas is missing or unexpectedly small.');
let frameCount=0;
for(const [sheetKey,sheet] of Object.entries(atlas.sheets)){
  const sourcePath=path.join(root,path.basename(sheet.file));
  const sourcePng=PNG.sync.read(fs.readFileSync(sourcePath));
  if(sourcePng.width!==sheet.width||sourcePng.height!==sheet.height)throw new Error(`${sheetKey} source dimensions mismatch.`);
  for(const [id,frame] of Object.entries(sheet.frames)){
    const file=asset('vice-heist',`${id}.png`);
    if(!fs.existsSync(file)||fs.statSync(file).size<100)throw new Error(`Missing sliced art frame: ${id}`);
    const png=PNG.sync.read(fs.readFileSync(file));
    if(png.width>frame.w||png.height>frame.h||png.width<frame.w-12||png.height<frame.h-12)throw new Error(`Incorrect frame dimensions: ${id}`);
    frameCount++;
  }
}
const manifest=JSON.parse(fs.readFileSync(asset('vice-heist','manifest.json'),'utf8'));
if(Object.keys(manifest.assets||{}).length!==frameCount)throw new Error('Runtime art manifest does not cover every sliced frame.');
console.log(`Asset validation passed: 8 map sectors, 8 binary masks and ${frameCount} named frames from all six supplied art sheets.`);
