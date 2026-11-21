import fs from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';

const root = process.cwd();
const asset = (...parts) => path.join(root, 'client/public/assets', ...parts);
const source = (...parts) => path.join(root, 'assets-source', ...parts);
const required = [
  ...Array.from({length:8},(_,i)=>asset('map',`take-${i+1}.webp`)),
  ...Array.from({length:8},(_,i)=>asset('map',`mask-${i+1}.png`)),
  asset('map','collision.png'),
  asset('characters','balaclava-sheet.webp'),
  asset('characters','vice-creatures-atlas.png'),
  asset('characters','vice-creatures-atlas.json'),
  ...['primary','secondary','danger','success','warning','disabled','icon','wide','square'].map(name=>asset('ui','buttons',`${name}.svg`)),
  source('characters','balaclava-creature-sheet-original.png'),
  source('mask-r2','manifest.json'),
  source('mask-r2','masks','stitched-mask.png'),
  ...Array.from({length:8},(_,i)=>source('mask-r2','masks',`take-${i+1}-mask.png`)),
  ...['take-1-helipad-security-command.png','take-2-vip-lounge-cocktail-bar.png','take-3-master-suite-safe-vault.png','take-4-infinity-pool-sun-deck.png','take-5-underground-garage-heist-vault.png','take-6-server-surveillance-room.png','take-7-generator-power-bay.png','take-8-speedboat-getaway-dock.png'].map(name=>source('map',name)),
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
const atlas=PNG.sync.read(fs.readFileSync(asset('characters','vice-creatures-atlas.png')));
if(atlas.width!==1120||atlas.height!==1120)throw new Error('Creature atlas must be 1120×1120 (7×7 frames at 160px).');
for(let row=0;row<7;row++)for(let col=0;col<7;col++){let visible=0;for(let y=row*160;y<(row+1)*160;y++)for(let x=col*160;x<(col+1)*160;x++)if(atlas.data[(y*atlas.width+x)*4+3]>32)visible++;if(visible<500)throw new Error(`Creature atlas frame ${row},${col} is empty or incorrectly cropped.`);}
console.log('Creature atlas validation passed: 49 transparent character frames.');
console.log('Asset validation passed: 8 map tiles, 8 binary collision masks, 49 character frames and 9 button surfaces are present.');
