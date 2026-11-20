import { defineConfig } from 'vite';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
const here=dirname(fileURLToPath(import.meta.url));
export default defineConfig({root:here,build:{outDir:resolve(here,'../dist/client'),emptyOutDir:true},server:{host:'0.0.0.0'}});
