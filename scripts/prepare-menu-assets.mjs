import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { unzipSync } from 'fflate';

const outputRoot = resolve('client/public/menu');
const archive = unzipSync(new Uint8Array(readFileSync(resolve('vice-heist-menu.zip'))));
const required = ['index.html', 'css/menu.css', 'js/menu.js', 'img/estate.jpg',
  'img/crew-teal.png', 'img/crew-purple.png', 'img/crew-blue.png',
  'img/crew-red.png', 'img/crew-gold.png', 'img/crew-pink.png'];
for (const name of required) if (!archive[name]) throw new Error('Menu archive missing required asset: ' + name);
for (const [name, bytes] of Object.entries(archive)) {
  if (name.endsWith('/')) continue;
  const destination = resolve(outputRoot, name);
  if (!destination.startsWith(outputRoot + sep)) throw new Error('Unsafe menu archive path: ' + name);
  mkdirSync(dirname(destination), { recursive: true });
  writeFileSync(destination, bytes);
}
const read = (name) => readFileSync(resolve(outputRoot, name), 'utf8');
const write = (name, value) => writeFileSync(resolve(outputRoot, name), value);
let html = read('index.html');
const splashStart = html.indexOf('  <!-- ───────── Splash (plays first, then hands over to the menu) ───────── -->');
const splashEnd = html.indexOf('</div>\n<script src="js/menu.js"></script>', splashStart);
if (splashStart < 0 || splashEnd < 0) throw new Error('Could not isolate bundled splash screen.');
html = html.slice(0, splashStart) + '</div>\n<script src="js/menu.js"></script>' +
  html.slice(splashEnd + '</div>\n<script src="js/menu.js"></script>'.length);
const navAnchor = '      <nav class="nav" aria-label="Main">';
if (!html.includes(navAnchor)) throw new Error('Main navigation anchor not found.');
html = html.replace(navAnchor, '      <div class="menu-identity">\n' +
  '        <label for="callSign">Your call sign</label>\n' +
  '        <input id="callSign" maxlength="20" autocomplete="nickname" placeholder="Enter your name">\n' +
  '      </div>\n\n' + navAnchor);
html = html.replace('<b>Quick Play</b><i>Drop into an open public match.</i>',
  '<b>Solo Heist</b><i>Enter the estate with an AI crew.</i>');
html = html.replace('maxlength="4" placeholder="CODE" aria-label="Room code, 4 characters"',
  'maxlength="5" placeholder="ROOM CODE" aria-label="Room code, 5 characters"');
const customStart = html.indexOf('        <div class="rows">', html.indexOf('data-name="custom"'));
const customEnd = html.indexOf('        <button class="btn btn-cta"', customStart);
if (customStart < 0 || customEnd < 0) throw new Error('Custom-game settings block not found.');
const customRows = '        <div class="rows">\n' +
  '          <div class="row"><div class="row-label"><b>Location</b><i>Ocean Drive Estate</i></div><span class="fixed-pill">READY</span></div>\n' +
  '          <div class="row"><div class="row-label"><b>Lobby</b><i>Private room · invite by room code</i></div><span class="fixed-pill">PRIVATE</span></div>\n' +
  '          <div class="row row-fixed"><div class="row-label"><b>Crew limit</b><i>Up to 10 players · minimum 4 to start</i></div><span class="fixed-pill">10</span></div>\n' +
  '          <div class="row row-fixed"><div class="row-label"><b>The Mole</b><i>One hidden informant per heist</i></div><span class="fixed-pill">1</span></div>\n' +
  '        </div>\n';
html = html.slice(0, customStart) + customRows + html.slice(customEnd);
const downloadStart = html.indexOf('        <a class="btn btn-cta btn-cta-ghost" href="vice-heist-menu.zip"');
if (downloadStart >= 0) {
  const downloadEnd = html.indexOf('        </a>', downloadStart);
  if (downloadEnd < 0) throw new Error('Menu archive download link was not closed.');
  html = html.slice(0, downloadStart) + html.slice(downloadEnd + '        </a>'.length + 1);
}
write('index.html', html);
let js = read('js/menu.js');
const oldAct = '  const act = (action, payload = {}) => {\n' +
  '    const event = new CustomEvent(\'viceheist:menu-action\', { detail: { action, ...payload }, cancelable: true });\n' +
  '    const claimed = !window.dispatchEvent(event);\n' +
  '    if (!claimed) toast(\'The crew is assembling… lobbies open soon.\');\n' +
  '    return claimed;\n' +
  '  };';
const newAct = '  const act = (action, payload = {}) => {\n' +
  '    const detail = { action, ...payload };\n' +
  '    if (window.parent !== window) {\n' +
  '      window.parent.postMessage({ type: \'viceheist:menu-action\', detail }, location.origin);\n' +
  '      return true;\n' +
  '    }\n' +
  '    const event = new CustomEvent(\'viceheist:menu-action\', { detail, cancelable: true });\n' +
  '    const claimed = !window.dispatchEvent(event);\n' +
  '    if (!claimed) toast(\'The crew is assembling… lobbies open soon.\');\n' +
  '    return claimed;\n' +
  '  };';
if (!js.includes(oldAct)) throw new Error('Menu action bridge anchor not found.');
js = js.replace(oldAct, newAct);
js = js.replace('if (codeInput.value.length !== 4) {', 'if (codeInput.value.length !== 5) {');
js = js.replace('toast(\'Room codes are 4 characters.\');', 'toast(\'Room codes are 5 characters.\');');
js = js.replace('slice(0, 4);', 'slice(0, 5);');
const customAnchor = '  /* ───────── custom game ───────── */';
if (!js.includes(customAnchor)) throw new Error('Call-sign insertion anchor not found.');
js = js.replace(customAnchor, '  const callSign = $(\'#callSign\');\n' +
  '  if (callSign) {\n' +
  '    callSign.value = localStorage.getItem(\'vh-name\') || \'\';\n' +
  '    callSign.addEventListener(\'change\', () => {\n' +
  '      const name = callSign.value.trim().slice(0, 20) || \'Player\';\n' +
  '      localStorage.setItem(\'vh-name\', name);\n' +
  '      callSign.value = name;\n' +
  '    });\n' +
  '  }\n\n' + customAnchor);
const settingsAnchor = '    window.dispatchEvent(new CustomEvent(\'viceheist:settings-changed\', { detail: { ...settings } }));';
if (!js.includes(settingsAnchor)) throw new Error('Settings event anchor not found.');
js = js.replace(settingsAnchor, settingsAnchor + '\n' +
  '    if (window.parent !== window) window.parent.postMessage({ type: \'viceheist:settings-changed\', detail: { ...settings } }, location.origin);');
const bootStart = js.indexOf('  /* ───────── splash → menu ───────── */');
const bootEnd = js.lastIndexOf('\n})();');
if (bootStart < 0 || bootEnd < bootStart) throw new Error('Bundled splash boot block not found.');
js = js.slice(0, bootStart) + '  /* The game-owned splash has completed before this embedded menu is loaded. */\n' +
  '  applySettings();\n  app.classList.add(\'is-ready\');\n  $(\'#stage\').inert = false;\n  show(\'main\');\n' + js.slice(bootEnd);
write('js/menu.js', js);
let css = read('css/menu.css');
css += '\n/* Embedded game menu: identity field above the primary navigation. */\n' +
  '.menu-identity { width: min(72rem, 86%); margin: 1.2rem auto 0; display: grid; gap: .8rem; }\n' +
  '.menu-identity label { color: var(--muted); font-size: 2.3rem; letter-spacing: .22em; text-transform: uppercase; }\n' +
  '.menu-identity input { width: 100%; min-height: 7.2rem; padding: 1.5rem 2.2rem; border: .25rem solid rgba(255,241,220,.2); border-radius: 1.5rem; color: var(--cream); background: rgba(13,6,20,.62); font: 500 3.2rem var(--ui); outline: none; user-select: text; -webkit-user-select: text; }\n' +
  '.menu-identity input:focus { border-color: var(--teal); box-shadow: 0 0 0 .4rem rgba(79,240,220,.14); }\n' +
  '@media (min-aspect-ratio: 1/1) { .menu-identity { grid-area: identity; width: min(100%, 70rem); margin: 0; } .screen-main { grid-template-areas: "brand crew" "identity crew" "nav crew"; grid-template-rows: auto auto 1fr; } }\n';
write('css/menu.css', css);
console.log('Prepared supplied menu assets and embedded-game bridge.');
