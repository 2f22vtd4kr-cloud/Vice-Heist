import fs from 'node:fs';
import path from 'node:path';
import { unzipSync } from 'fflate';

const root = process.cwd();
const archivePath = path.join(root, 'vice-heist-splash.zip');
if (!fs.existsSync(archivePath)) {
  throw new Error('Missing vice-heist-splash.zip at repository root.');
}

const archive = unzipSync(fs.readFileSync(archivePath));
const allowed = [
  'vice-heist-splash/public/img/estate.jpg',
  ...['teal', 'red', 'purple', 'pink', 'grey-sneak', 'ghost', 'blue']
    .map((name) => `vice-heist-splash/public/img/crew/${name}.png`),
];

for (const source of allowed) {
  const bytes = archive[source];
  if (!bytes || bytes.length === 0) {
    throw new Error(`Splash package is missing required artwork: ${source}`);
  }

  const relative = source.replace('vice-heist-splash/public/img/', '');
  const destination = path.join(root, 'client/public/splash/img', relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  fs.writeFileSync(destination, Buffer.from(bytes));
}

console.log(`Prepared ${allowed.length} splash images from vice-heist-splash.zip.`);
