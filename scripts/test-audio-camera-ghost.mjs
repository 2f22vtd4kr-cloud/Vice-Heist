import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const audio=readFileSync('client/src/audio.ts','utf8');
const client=readFileSync('client/src/main.ts','utf8');
const server=readFileSync('server/src/index.ts','utf8');

assert.match(server,/const humanBonus=candidate\.bot\?0:-115/,'Mole target scoring must consider NPC Crew as valid targets');
assert.match(server,/const pool=crew\.slice\(0,Math\.min\(3,crew\.length\)\)/,'Mole target selection must consider multiple Crew candidates');
assert.match(server,/otherMoleFocus/,'Mole NPCs should distribute pressure instead of dogpiling one Crew target');
assert.doesNotMatch(server,/const humanTarget=crew\.find\(entry=>!entry\.candidate\.bot\)/,'Mole NPC must not use a human-only hunt target');
assert.match(client,/if\(local\.alive\)gameAudio\.step\(time,surface\)/,'dead/ghost movement must not emit footsteps');
assert.match(client,/latest\?\.players\.find\(player=>player\.id===id\)\?\.y\?\?actor\.y-9/,'death collapse must restore the ghost sprite to its authoritative Y anchor');
assert.match(client,/if\(actor&&Math\.abs\(x\)>Math\.abs\(y\)\)actor\.setFlipX\(x<0\)/,'local ghost sprite must mirror when moving left');
assert.match(client,/ctx\.drawImage\(image,centerX-viewWidth\/2,centerY-viewHeight\/2,viewWidth,viewHeight/,'CCTV must crop in native 2048px map coordinates');
assert.match(client,/function atCctvConsole/,'CCTV access must be tied to the server-room console');
assert.match(client,/cameraUse\.style\.display=atCctvConsole\(local\)\?'grid':'none'/,'CCTV control must only appear at its console');
assert.doesNotMatch(client,/#camera-toggle/,'there must be no always-available top HUD camera shortcut');
assert.match(client,/cameraConsoleMarker/,'estate blueprint must show the CCTV console location');
assert.match(audio,/this\.ambienceVolume\*attenuation\*\.48/,'ambient zone mix must be audible beyond the nearest-only zone');
assert.doesNotMatch(client,/autoStartTimer\s*=\s*window\.setTimeout\(enterMenu/,'splash must wait for a real tap so Safari can unlock background audio');
assert.match(audio,/\.16\+\.84\*Math\.pow/,'spatial music must retain a quiet audible estate-wide bed');
assert.match(audio,/Short layered impacts replace the synthetic pitched/,'footsteps must use layered impacts rather than pitched slaps');
console.log('Audio, CCTV, ghost and NPC targeting regression assertions passed.');
