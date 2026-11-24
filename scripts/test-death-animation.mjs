import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
const source=readFileSync('client/src/main.ts','utf8');
assert.match(source,/private deathAnimating = new Set<string>\(\)/,'scene should track active death transitions');
assert.match(source,/wasAlive===true\)this\.playDeathAnimation\(local\.id,a\)/,'local death transition should play the collapse animation');
assert.match(source,/wasAlive===true\)this\.playDeathAnimation\(p\.id,a\)/,'remote death transition should play the collapse animation');
assert.match(source,/duration:280,[\s\S]*?ease:'Quad\.easeIn'/,'death transition should use a short fall-and-collapse tween');
assert.match(source,/this\.deathAnimating\.has\(id\)\)continue/,'remote interpolation should not override the death tween');
console.log('Death animation regression passed: local and remote deaths collapse before entering ghost float.');
