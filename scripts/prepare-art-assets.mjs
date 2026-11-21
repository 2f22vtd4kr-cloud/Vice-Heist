import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

const root = process.cwd();
const archivePath = path.join(root, 'vice-heist-art-pack.zip');
if (!fs.existsSync(archivePath)) throw new Error('Missing vice-heist-art-pack.zip at repository root.');
const entries = unzipSync(fs.readFileSync(archivePath));
const required = [
  ['vice-heist-art-pack/characters/vice-creatures-atlas.png', 'client/public/assets/characters/vice-creatures-atlas.png'],
  ...['primary','secondary','danger','success','warning','disabled','icon','wide','square'].map(name => [
    `vice-heist-art-pack/ui/buttons/${name}.svg`, `client/public/assets/ui/buttons/${name}.svg`,
  ]),
];
for (const [source, destination] of required) {
  const data = entries[source];
  if (!data) throw new Error(`Art pack is missing ${source}`);
  const target = path.join(root, destination);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, data);
}
const metadata = {
  image: 'vice-creatures-atlas.png', frameWidth: 160, frameHeight: 160, columns: 7, rows: 7,
  colors: ['teal','red','blue','purple','brown','charcoal','pink'],
  poses: ['idle','run_a','run_b','walk','ghost','seated','crouch'],
  index: 'row * 7 + colorColumn',
  animations: { idle: 'row 0', run: 'rows 1–3', ghost: 'row 4', seated: 'row 5', crouch: 'row 6' },
};
fs.writeFileSync(path.join(root,'client/public/assets/characters/vice-creatures-atlas.json'), JSON.stringify(metadata,null,2)+'\n');
console.log('Prepared 10 runtime art assets from vice-heist-art-pack.zip (7×7 character atlas).');
