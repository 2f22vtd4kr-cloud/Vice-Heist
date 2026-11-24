import Phaser from 'phaser';
import { io, type Socket } from 'socket.io-client';
import type { Snapshot, PublicPlayer, Task } from '../../shared/types';
import './style.css';
import { EstateAudio } from './audio';
import { VICE_HEIST_WALK_UP, VICE_HEIST_WALK_DOWN, VICE_HEIST_KILL, VICE_HEIST_GHOST } from './viceHeistAssetIds';

declare global {
  interface Window {
    Telegram?: { WebApp?: { initData?: string; ready: () => void; expand: () => void; HapticFeedback?: { impactOccurred: (style: string) => void } } };
  }
}
const tg = window.Telegram?.WebApp;
tg?.ready(); tg?.expand();
const socket: Socket = io({ transports: ['websocket', 'polling'], reconnection: true, timeout: 10_000 });
const overlay = document.querySelector<HTMLDivElement>('#overlay')!;
const app = document.querySelector<HTMLDivElement>('#app')!;
let latest: Snapshot | null = null;
let myId = sessionStorage.getItem('vh-player-id') || '';
let resumeKey = sessionStorage.getItem('vh-session-key') || '';
let currentPhase = 'MENU';
let currentMeetingEnds = 0;
let roomCode = sessionStorage.getItem('vh-room-code') || '';
let groqKey = '';
let muted = false;
const gameAudio = new EstateAudio();
let leftHanded = localStorage.getItem('vh-left-handed') === 'true';
let lastFootstep = 0;
let joystick = { x: 0, y: 0 };
let me = { x: 3000, y: 2070 };
let serverMe = { x: 3000, y: 2070 };
let initializedPlayerId = ''; // First authoritative snapshot initializes a new local player.
let chatLines: string[] = [];
let roleShown = false;
let sceneRef: Estate | undefined;
let audio: AudioContext | undefined;
let splashDismissed = false;
let splashReady = false;
let splashStarting = false;
let pendingSnapshot: Snapshot | null = null;
let pendingResumeNotice = '';
let phaserLoadProgress = 0;
let splashAssetProgress = 0;
let mapLoadProgress = 0;
let phaserAssetsLoaded = false;
let phaserSceneReady = false;
let phaserLoadError = '';
let menuFrame: HTMLIFrameElement | null = null;
let menuFrameReady = false;
let menuPreloadPromise: Promise<void> | null = null;

const haptic = () => { try { tg?.HapticFeedback?.impactOccurred('light'); } catch { /* optional Telegram feature */ } };
const CREATURE_COLOR_COLUMNS: Record<string, number> = { '#58c99b':0, '#6dd4d0':0, '#f45b5b':1, '#54b7f2':2, '#a98af5':3, '#f0bd4b':4, '#e78b4e':4, '#b6cf5b':4, '#e4e7ec':5, '#f18dc3':6 };
function creatureColumn(color: string): number { return CREATURE_COLOR_COLUMNS[color.toLowerCase()] ?? 5; }
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
function show(html: string) { overlay.innerHTML = html; }
const artUrl = (id: string) => `/assets/vice-heist/${id}.png`;
function setButtonArt(id:string,asset:string){const image=document.querySelector<HTMLImageElement>(`#${id} .action-art`);if(image)image.src=artUrl(asset);}

const splashCrew = [
  { id: 'purple', sprite: 'purple', kind: 'idle', x: 22, feetY: 66.5, h: 8.6, delay: -0.4 },
  { id: 'red', sprite: 'red', kind: 'idle', x: 32, feetY: 69.5, h: 9.8, delay: -1.1 },
  { id: 'teal', sprite: 'teal', kind: 'idle', x: 45, feetY: 72, h: 11.4, delay: 0 },
  { id: 'blue', sprite: 'blue', kind: 'idle', x: 62, feetY: 67.5, h: 9.2, flip: true, delay: -0.7 },
  { id: 'pink', sprite: 'pink', kind: 'idle', x: 78, feetY: 68, h: 8.6, flip: true, delay: -1.6 },
  { id: 'grey', sprite: 'grey-sneak', kind: 'sneak', x: 47, feetY: 40.6, h: 4.6, delay: 0 },
  { id: 'ghost', sprite: 'ghost', kind: 'ghost', x: 56, feetY: 51, h: 6.6, delay: 0 },
] as const;
const splashTips = ['Casing the estate…', 'Bribing the valet…', 'Looping the security cameras…', 'Cracking the vault…', 'Fuelling the getaway boat…', 'Checking who’s wearing a wire…'];

function updateSplashProgress() {
  // The bar tracks only work required to enter a playable world. The optional
  // illustrated menu is deliberately excluded so it cannot stall startup.
  const progress = Math.min(99, Math.floor((phaserLoadProgress * .68 + splashAssetProgress * .12 + mapLoadProgress * .15 + (phaserSceneReady ? .05 : 0)) * 100));
  const fill = document.querySelector<HTMLElement>('#vh-splash-fill');
  const pct = document.querySelector<HTMLElement>('#vh-splash-pct');
  const tip = document.querySelector<HTMLElement>('#vh-splash-tip');
  if (fill) fill.style.width = progress + '%';
  if (pct) pct.textContent = progress + '%';
  if (tip) tip.textContent = phaserLoadProgress < 1 ? 'Loading essential game assets…' :
    splashAssetProgress < 1 ? 'Preparing the crew…' :
    mapLoadProgress < 1 ? 'Loading nearby estate sectors…' :
    !phaserSceneReady ? 'Finalising the game world…' : 'All systems ready.';
}

function preloadMenuFrame(): Promise<void> {
  return new Promise((resolve, reject) => {
    const frame = document.createElement('iframe');
    frame.id = 'vh-menu-frame';
    frame.className = 'vh-preloaded-menu';
    frame.title = 'Vice Heist main menu';
    frame.setAttribute('aria-hidden', 'true');
    frame.tabIndex = -1;
    frame.loading = 'eager';
    menuFrame = frame;
    let settled = false;
    // The illustrated menu is an optional post-readiness enhancement. Its
    // load never competes with essential Phaser assets or blocks splash readiness.
    const deadline = Date.now() + 20_000;
    let diagnosticTimer = 0;
    const finish = (error?: Error) => {
      if (settled) return;
      settled = true;
      window.clearTimeout(diagnosticTimer);
      if (error) { menuFrameReady = false; reject(error); }
      else { menuFrameReady = true; resolve(); }
    };
    const inspect = () => {
      if (settled) return;
      try {
        const doc = frame.contentDocument;
        const menuRoot = doc?.querySelector<HTMLElement>('#app');
        const stage = doc?.querySelector<HTMLElement>('#stage');
        if (doc && menuRoot?.classList.contains('is-ready') && stage && !stage.inert) {
          finish();
          return;
        }
      } catch { /* A not-yet-committed iframe document is still loading. */ }
      if (Date.now() >= deadline) {
        finish(new Error('Main menu is unavailable; using the built-in menu.'));
        return;
      }
      diagnosticTimer = window.setTimeout(inspect, 50);
    };
    frame.addEventListener('error', () => finish(new Error('Main menu is unavailable; using the built-in menu.')), { once: true });
    frame.addEventListener('load', inspect, { once: true });
    // Set src before insertion so the one-shot load listener cannot consume
    // the initial about:blank document instead of the menu document.
    frame.src = '/menu/index.html';
    app.insertBefore(frame, overlay);
    diagnosticTimer = window.setTimeout(inspect, 50);
  });
}

async function showSplash() {
  const crew = splashCrew.map(c =>
    '<div class="vh-crew vh-crew-' + c.kind + '" style="left:' + c.x + '%;bottom:' + (100-c.feetY) + '%;height:' + c.h + '%;z-index:' + Math.round(c.feetY*10) + ';animation-delay:' + (Math.abs(c.delay)*.25) + 's">' +
    '<img src="/splash/img/crew/' + c.sprite + '.png" alt="" draggable="false" style="transform:' + ('flip' in c && c.flip ? 'scaleX(-1)' : 'none') + ';animation-delay:' + c.delay + 's"></div>'
  ).join('');
  show([
    '<main class="vh-viewport"><button id="vh-splash" class="vh-phone vh-phase-loading" type="button" aria-label="Vice Heist is loading" disabled>',
    '<div class="vh-stage"><img class="vh-backdrop" src="/splash/img/estate.jpg" alt="Ocean Drive Estate at sunset, with a waterfront villa, rooftop helipad, garage, neon lounge, pool and getaway boat" fetchpriority="high" draggable="false">',
    '<div class="vh-pool-glow" aria-hidden="true"></div>',
    '<span class="vh-beacon" style="left:27.2%;top:23%;animation-delay:0s"></span><span class="vh-beacon" style="left:52.6%;top:24.6%;animation-delay:.35s"></span><span class="vh-beacon" style="left:2.6%;top:26.3%;animation-delay:.7s"></span><span class="vh-beacon" style="left:29.2%;top:28.5%;animation-delay:1.05s"></span>',
    crew, '</div><div class="vh-shade" aria-hidden="true"></div><div class="vh-scanlines" aria-hidden="true"></div>',
    '<header class="vh-logo"><span class="vh-logo-kicker">A crew of thieves. One rat.</span><h1><span class="vh-logo-vice">Vice</span><span class="vh-logo-heist">HEIST</span></h1><span class="vh-logo-place"><i></i>Ocean Drive Estate<i></i></span></header>',
    '<footer class="vh-footer"><div id="vh-splash-panel" class="vh-loading" role="status"><div id="vh-splash-tip" class="vh-tip">Loading the estate…</div><div class="vh-bar"><div id="vh-splash-fill" class="vh-bar-fill" style="width:0%"></div></div><div id="vh-splash-pct" class="vh-pct">0%</div></div><p class="vh-tagline">Trust no one. Take everything.</p><p class="vh-version">Ocean Drive · Miami</p></footer>',
    '<div class="vh-flash" aria-hidden="true"></div></button></main>'
  ].join(''));

  const button = document.querySelector<HTMLButtonElement>('#vh-splash');
  if (!button) return;
  let autoStartTimer: number | undefined;
  const enterMenu = () => {
    if (!splashReady || splashDismissed || splashStarting || phaserLoadError) return;
    if (autoStartTimer !== undefined) {
      window.clearTimeout(autoStartTimer);
      autoStartTimer = undefined;
    }
    splashStarting = true;
    button.classList.remove('vh-phase-ready');
    button.classList.add('vh-phase-entering');
    const panel = document.querySelector<HTMLElement>('#vh-splash-panel');
    if (panel) panel.innerHTML = '<strong class="vh-entering-title">You’re in.</strong><span class="vh-entering-copy">The crew is assembling…</span>';
    window.setTimeout(async () => {
      // The splash is already ready. If the user enters immediately, allow
      // the optional illustrated menu a chance to finish without blocking
      // game startup itself; the bounded preload falls back cleanly on error.
      if (menuPreloadPromise && !menuFrameReady) {
        const panel = document.querySelector<HTMLElement>('#vh-splash-panel');
        if (panel) panel.innerHTML = '<strong class="vh-entering-title">Preparing the main menu…</strong>';
        await menuPreloadPromise;
      }
      splashDismissed = true;
      const next = pendingSnapshot;
      pendingSnapshot = null;
      if (next) {
        menuFrame?.classList.remove('vh-menu-frame');
        menuFrame?.classList.add('vh-preloaded-menu');
        overlay.innerHTML = '';
        renderState(next);
      } else {
        menu();
        if (pendingResumeNotice) { toast(pendingResumeNotice); pendingResumeNotice = ''; }
      }
    }, 420);
  };
  button.addEventListener('click', enterMenu);

  updateSplashProgress();
  const paths = ['/splash/img/estate.jpg'].concat(splashCrew.map(c => '/splash/img/crew/' + c.sprite + '.png'));
  let loaded = 0;
  const splashImages = Promise.all(paths.map(src => new Promise<void>((resolve, reject) => {
    const image = new Image();
    let settled = false;
    const done = () => {
      if (settled) return;
      settled = true;
      loaded++;
      splashAssetProgress = loaded / paths.length;
      updateSplashProgress();
      resolve();
    };
    image.onload = done;
    image.onerror = () => reject(new Error('Splash artwork failed to load: ' + src));
    image.src = src;
    if (image.complete && image.naturalWidth > 0) queueMicrotask(done);
  })));

  const gameReady = new Promise<void>((resolve, reject) => {
    if (phaserSceneReady) { resolve(); return; }
    if (phaserLoadError) { reject(new Error(phaserLoadError)); return; }
    const ready = () => { cleanup(); resolve(); };
    const failed = (event: Event) => {
      cleanup();
      const detail = (event as CustomEvent<string>).detail;
      reject(new Error(detail || phaserLoadError || 'The game world failed to initialise.'));
    };
    const cleanup = () => {
      window.removeEventListener('vh:game-ready', ready);
      window.removeEventListener('vh:game-error', failed);
      window.clearTimeout(timeout);
    };
    const timeout = window.setTimeout(() => {
      const message = phaserAssetsLoaded
        ? 'Scene setup stalled after essential assets loaded (initial map sectors, collision data, or visibility canvas).'
        : `Asset loading stalled at ${Math.floor(phaserLoadProgress * 100)}% of essential Phaser resources.`;
      console.error('[Vice Heist startup] Timeout:', message);
      cleanup();
      reject(new Error(message));
    }, 45_000);
    window.addEventListener('vh:game-ready', ready, { once: true });
    window.addEventListener('vh:game-error', failed, { once: true });
  });

  try {
    await Promise.all([splashImages, gameReady]);
    if (phaserLoadError) throw new Error(phaserLoadError);
    splashReady = true;
    updateSplashProgress();
    // Begin the illustrated menu only after the essential scene and splash
    // art are ready. This work is intentionally not part of the startup gate.
    menuPreloadPromise = preloadMenuFrame().catch(error => {
      menuFrameReady = false;
      console.warn('[Vice Heist] Illustrated menu preload unavailable; using the accessible fallback:', error);
    });
    const fill = document.querySelector<HTMLElement>('#vh-splash-fill');
    const pct = document.querySelector<HTMLElement>('#vh-splash-pct');
    const tip = document.querySelector<HTMLElement>('#vh-splash-tip');
    if (fill) fill.style.width = '100%';
    if (pct) pct.textContent = '100%';
    if (tip) tip.textContent = 'All systems ready.';
    button.disabled = false;
    button.classList.remove('vh-phase-loading');
    button.classList.add('vh-phase-ready');
    button.setAttribute('aria-label', 'Tap to start Vice Heist');
    const panel = document.querySelector<HTMLElement>('#vh-splash-panel');
    if (panel) panel.innerHTML = '<span class="vh-tap"><span>Tap to start</span></span>';
    autoStartTimer = window.setTimeout(enterMenu, 1_500);
  } catch (error) {
    phaserLoadError = error instanceof Error ? error.message : String(error);
    const fill = document.querySelector<HTMLElement>('#vh-splash-fill');
    const pct = document.querySelector<HTMLElement>('#vh-splash-pct');
    const tip = document.querySelector<HTMLElement>('#vh-splash-tip');
    if (pct) pct.textContent = 'ERR';
    if (tip) tip.textContent = 'Loading failed. Refresh to retry.';
    const panel = document.querySelector<HTMLElement>('#vh-splash-panel');
    if (panel) panel.innerHTML = '<strong class="vh-entering-title">Unable to load the game.</strong><span class="vh-entering-copy">' + escapeHtml(phaserLoadError) + ' · Refresh to retry.</span>';
    console.error('[Vice Heist] Startup preload failed:', error);
  }
}

function tone(frequency = 440, duration = 0.08) {
  gameAudio.unlock();
  if (muted) return;
  try { audio ??= new AudioContext(); if (audio.state === 'suspended') void audio.resume(); const osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.value=frequency;gain.gain.setValueAtTime(0.045,audio.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,audio.currentTime+duration);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+duration); } catch { /* audio is an enhancement */ }
}
function playerName() {
  const name = (localStorage.getItem('vh-name') || 'Player').trim().slice(0,20) || 'Player';
  groqKey = ''; return name;
}
function sendAiKey() { if (groqKey) socket.emit('ai:key', groqKey); }
function rememberSession(r:{code:string;playerId:string;sessionKey:string}){roomCode=r.code;myId=r.playerId;resumeKey=r.sessionKey;sessionStorage.setItem('vh-room-code',roomCode);sessionStorage.setItem('vh-player-id',myId);sessionStorage.setItem('vh-session-key',resumeKey);}
function clearSession(){roomCode='';myId='';resumeKey='';sessionStorage.removeItem('vh-room-code');sessionStorage.removeItem('vh-player-id');sessionStorage.removeItem('vh-session-key');socket.emit('leave');}
function resumeSession(){if(!roomCode||!resumeKey)return;socket.emit('resume',{code:roomCode,sessionKey:resumeKey},(r:{ok:boolean;code:string;playerId:string;sessionKey:string;error?:string})=>{if(r.ok){rememberSession(r);sendAiKey();}else{clearSession();const notice=r.error||'Previous session expired.';if(splashDismissed){menu();toast(notice);}else pendingResumeNotice=notice;}});}
function focusGameCanvas() {
  const canvas = document.querySelector<HTMLCanvasElement>('#game canvas');
  if (!canvas) return;
  canvas.tabIndex = 0;
  canvas.setAttribute('aria-label', 'Vice Heist game');
  canvas.focus({ preventScroll: true });
}
function hideMenuFrame() {
  if (!menuFrame) return;
  const wasVisible = menuFrame.classList.contains('vh-menu-frame');
  menuFrame.classList.remove('vh-menu-frame');
  menuFrame.classList.add('vh-preloaded-menu');
  menuFrame.setAttribute('aria-hidden', 'true');
  menuFrame.tabIndex = -1;
  if (wasVisible) focusGameCanvas();
}
function menu() {
  currentPhase='MENU'; currentMeetingEnds=0;
  overlay.innerHTML='';
  if (!menuFrameReady || !menuFrame) {
    show('<section class="menu"><div class="brand">VICE <span>HEIST</span></div><p class="eyebrow">OCEAN DRIVE · MIAMI</p><h1>The crew is <em>waiting.</em></h1><p class="sub">Choose how you want to enter the estate.</p><label for="vh-call-sign">CALL SIGN</label><input id="vh-call-sign" maxlength="20" autocomplete="nickname" placeholder="Your name" value="' + escapeHtml(localStorage.getItem('vh-name') || '') + '"><button id="vh-solo" class="primary">SOLO HEIST</button><button id="vh-create" class="secondary">CREATE PRIVATE ROOM</button><div class="join"><input id="vh-room-code" maxlength="5" autocomplete="off" placeholder="ROOM CODE"><button id="vh-join" type="button">JOIN ROOM</button></div><p class="foot">Trust no one. Take everything.</p></section>');
    const nameInput=document.querySelector<HTMLInputElement>('#vh-call-sign');
    nameInput?.addEventListener('input',()=>{try{localStorage.setItem('vh-name',(nameInput.value||'').trim().slice(0,20));}catch{/* optional persistence */}});
    document.querySelector('#vh-solo')?.addEventListener('click',()=>handleMenuAction({action:'quick-play'}));
    document.querySelector('#vh-create')?.addEventListener('click',()=>handleMenuAction({action:'create-lobby'}));
    document.querySelector('#vh-join')?.addEventListener('click',()=>handleMenuAction({action:'join-lobby',code:document.querySelector<HTMLInputElement>('#vh-room-code')?.value||''}));
    return;
  }
  menuFrame.classList.remove('vh-preloaded-menu');
  menuFrame.classList.add('vh-menu-frame');
  menuFrame.removeAttribute('aria-hidden');
  menuFrame.tabIndex=0;
  menuFrame.focus();
}
function handleMenuAction(detail: {action?:string;code?:string}) {
  const name=playerName();
  const done=(r:{ok:boolean;code:string;playerId:string;sessionKey:string;error?:string})=>{
    if(r.ok){rememberSession(r);sendAiKey();}
    else toast(r.error||'Unable to start that game.');
  };
  haptic(); tone(520);
  if(detail.action==='quick-play') socket.emit('solo',{name,initData:tg?.initData},done);
  else if(detail.action==='create-lobby') socket.emit('create',{name,initData:tg?.initData},done);
  else if(detail.action==='join-lobby') {
    const code=String(detail.code||'').toUpperCase().trim();
    if(code.length!==5){toast('Room codes are 5 characters.');return;}
    socket.emit('join',{code,name,initData:tg?.initData},done);
  }
}
window.addEventListener('message',(event:MessageEvent)=>{
  const frame=document.querySelector<HTMLIFrameElement>('#vh-menu-frame');
  if(event.origin!==location.origin||event.source!==frame?.contentWindow||!event.data)return;
  if(event.data.type==='viceheist:menu-action') handleMenuAction(event.data.detail||{});
  else if(event.data.type==='viceheist:settings-changed') {
    try { localStorage.setItem('vh-menu-settings',JSON.stringify(event.data.detail||{})); } catch { /* storage may be disabled */ }
    window.dispatchEvent(new CustomEvent('viceheist:settings-changed',{detail:event.data.detail||{}}));
  }
});
function lobby(s: Snapshot) {
  currentPhase='LOBBY';
  show(`<div class="lobby art-lobby"><div class="lobby-art-head"><img src="${artUrl('logo_vice_heist')}" alt="Vice Heist"><div class="topline">ROOM <span>${escapeHtml(s.code)}</span></div></div><img class="lobby-code-art" src="${artUrl('panel_lobby_code')}" alt="Room code panel"><img class="lobby-swatches-art" src="${artUrl('swatches_player_colors')}" alt="Player color swatches"><h2>Assemble your crew.</h2><div id="players" class="players"></div><p class="muted" id="lobby-hint"></p><button id="start" class="primary">START HEIST</button><button id="copy" class="secondary">COPY ROOM CODE</button><button id="back" class="textbtn">LEAVE ROOM</button></div>`);
  document.querySelector('#start')!.addEventListener('click',()=>{socket.emit('start');tone(620);});
  document.querySelector('#copy')!.addEventListener('click',()=>{void navigator.clipboard?.writeText(s.code);const b=document.querySelector('#copy');if(b)b.textContent='COPIED';});
  document.querySelector('#back')!.addEventListener('click',()=>{clearSession();socket.disconnect();location.reload();});
  updateLobby(s);
}
function updateLobby(s: Snapshot) {
  const list=document.querySelector('#players');if(list)list.innerHTML=s.players.map(p=>`<div class="playerrow"><i style="background:${escapeHtml(p.color)}"></i>${escapeHtml(p.name)} ${p.bot?'<small>AI</small>':''}</div>`).join('');
  const hint=document.querySelector('#lobby-hint');if(hint)hint.textContent=`${s.players.length}/10 players · host starts at 4 · share code ${s.code}`;
  const start=document.querySelector<HTMLButtonElement>('#start');if(start){start.disabled=!s.isHost||s.players.length<4;start.textContent=!s.isHost?'WAITING FOR HOST':s.players.length<4?'NEED 4 PLAYERS':'START HEIST';}
}
function hud() {
  currentPhase='PLAYING';
  show(`<div class="hud"><div class="hudtop"><b>VICE HEIST</b><span>OCEAN DRIVE ESTATE</span><div class="hud-tools"><button id="map-toggle" aria-label="Open estate map"><img src="${artUrl('btn_map_toggle')}" alt=""></button><button id="settings-toggle" aria-label="Open settings"><img src="${artUrl('btn_settings')}" alt=""></button><button id="chat-toggle" aria-label="Open meeting chat"><img src="${artUrl('btn_chat_toggle')}" alt=""></button><button id="sound" aria-label="Toggle sound">♫</button></div></div><div class="objective" id="objective"><span class="objective-label">Complete the estate jobs. Find the Mole.</span><div class="objective-meter" aria-hidden="true"><i id="objective-fill"></i></div></div><div class="radar" id="radar" aria-label="Estate radar"></div><div class="controls"><div class="actions"><button id="use" aria-label="Use"><img class="action-art" src="${artUrl('btn_use_dim')}" alt=""><span>USE</span></button><button id="report" aria-label="Report"><img class="action-art" src="${artUrl('btn_report_dim')}" alt=""><span>REPORT</span></button><button id="emergency" aria-label="Emergency meeting"><img class="action-art" src="${artUrl('btn_emergency_call')}" alt=""><span>EMERGENCY</span></button><button id="kill" class="danger" aria-label="Eliminate"><img class="action-art" src="${artUrl('btn_kill_dim')}" alt=""><span>ELIMINATE</span></button><button id="sabotage" class="danger" aria-label="Sabotage"><img class="action-art" src="${artUrl('btn_sabotage_active')}" alt=""><span>LIGHTS</span></button></div><div id="stick" class="stick" aria-label="Movement joystick"><div id="knob" class="knob"></div></div></div><div class="toast" id="toast"></div><div class="meet" id="meet"></div></div>`);
  wireControls(); updateHud(latest);
  document.querySelector('.controls')?.classList.toggle('left-handed',leftHanded);
}
function wireControls() {
  const stick=document.querySelector<HTMLElement>('#stick')!,knob=document.querySelector<HTMLElement>('#knob')!;
  let activePointerId:number|null=null;
  const move=(e:PointerEvent)=>{
    if(activePointerId!==e.pointerId)return;
    const r=stick.getBoundingClientRect(),knobRect=knob.getBoundingClientRect();
    const border=parseFloat(getComputedStyle(stick).borderLeftWidth)||0;
    const max=Math.max(1,(Math.min(r.width,r.height)-Math.max(knobRect.width,knobRect.height))/2-border);
    let dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2;
    const distance=Math.hypot(dx,dy);
    if(distance>max){dx=dx/distance*max;dy=dy/distance*max;}
    joystick={x:dx/max,y:dy/max};
    knob.style.transform=`translate(${dx}px,${dy}px)`;
  };
  stick.addEventListener('pointerdown',e=>{
    if(activePointerId!==null)return;
    e.preventDefault();activePointerId=e.pointerId;
    try{stick.setPointerCapture(e.pointerId);}catch{/* window-level release handlers remain as fallback */}
    move(e);
  });
  stick.addEventListener('pointermove',move);
  const stop=(e?:PointerEvent)=>{
    if(activePointerId===null||(e&&e.pointerId!==activePointerId))return;
    e?.preventDefault();
    const pointerId=activePointerId;activePointerId=null;
    joystick={x:0,y:0};knob.style.transform='translate(0,0)';
    if(stick.hasPointerCapture(pointerId)){try{stick.releasePointerCapture(pointerId);}catch{/* already released */}}
    sceneRef?.stopMovement(true);
  };
  stick.addEventListener('pointerup',stop);stick.addEventListener('pointercancel',stop);
  stick.addEventListener('lostpointercapture',stop);
  window.addEventListener('pointerup',stop,true);window.addEventListener('pointercancel',stop,true);
  window.addEventListener('blur',()=>{activePointerId=null;joystick={x:0,y:0};knob.style.transform='translate(0,0)';sceneRef?.stopMovement(true);});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){activePointerId=null;joystick={x:0,y:0};knob.style.transform='translate(0,0)';sceneRef?.stopMovement(true);}});
  document.querySelector('#use')!.addEventListener('click',()=>{const t=nearestTask();if(t)openTask(t);else toast('Move closer to an unfinished task.');haptic();});
  document.querySelector('#report')!.addEventListener('click',()=>{const b=nearestBody();if(b){socket.emit('report',b.id);tone(300);}else toast('No body nearby to report.');haptic();});
  document.querySelector('#emergency')!.addEventListener('click',()=>{socket.emit('emergency');tone(300);haptic();});
  document.querySelector('#kill')!.addEventListener('click',()=>{const p=nearestTarget();if(p){socket.emit('kill',p.id);tone(160);}else toast('No target in elimination range.');haptic();});
  document.querySelector('#sabotage')!.addEventListener('click',()=>{socket.emit('sabotage','lights');tone(220);haptic();});
  document.querySelector('#sound')!.addEventListener('click',()=>{muted=!muted;gameAudio.setMuted(muted);document.querySelector('#sound')!.textContent=muted?'×':'♫';if(!muted)tone(520);});
  document.querySelector('#map-toggle')!.addEventListener('click',()=>openMapOverlay());
  document.querySelector('#settings-toggle')!.addEventListener('click',()=>openSettingsOverlay());
  document.querySelector('#chat-toggle')!.addEventListener('click',()=>{const chat=document.querySelector('#chatlines');if(chat)chat.scrollIntoView({block:'center'});else toast('Chat opens during a meeting.');});
}
function openMapOverlay(){
  const m=document.querySelector<HTMLDivElement>('#meet');if(!m||!latest)return;
  const tasks=latest.tasks.map(t=>`<div class="map-task ${t.done?'done':''}"><img src="${artUrl('icon_task_marker')}" alt=""><span>${escapeHtml(t.label)}</span><b>${t.done?'DONE':'OPEN'}</b></div>`).join('');
  const players=latest.players.map(p=>`<i class="blueprint-player ${p.id===myId?'self':''} ${p.alive?'':'down'}" title="${escapeHtml(p.name)}" style="left:${p.x/8192*100}%;top:${p.y/4096*100}%"></i>`).join('');
  const tasksOnMap=latest.tasks.map(t=>`<i class="blueprint-task ${t.done?'done':''}" title="${escapeHtml(t.label)}" style="left:${t.x/8192*100}%;top:${t.y/4096*100}%"></i>`).join('');
  const sectors=['Helipad / security','VIP lounge','Master suite / vault','Pool / terrace','Garage','Server room','Generator bay','Speedboat dock'];
  const tiles=sectors.map((label,i)=>`<div class="blueprint-sector"><img src="/assets/map/take-${i+1}.webp" alt=""><span>${label}</span></div>`).join('');
  m.innerHTML=`<section class="meetingbox art-panel map-panel" role="dialog" aria-modal="true" aria-label="Estate map"><header class="map-panel-head"><div><p class="eyebrow">OCEAN DRIVE ESTATE · 4 × 2 SECTORS</p><h3>Estate blueprint</h3></div><button class="panel-close" id="map-close" aria-label="Close map">×</button></header><div class="estate-blueprint"><div class="blueprint-grid">${tiles}</div><div class="blueprint-markers">${tasksOnMap}${players}</div></div><div class="blueprint-legend"><span><i class="blueprint-player self"></i> You / crew</span><span><i class="blueprint-task"></i> Objective</span></div>${latest.sabotage&&latest.sabotage.endsAt>Date.now()?`<div class="sabotage-status"><img src="${artUrl(latest.sabotage.kind==='doors'?'sabotage_pin_doors':'sabotage_pin_lights')}" alt=""><b>${escapeHtml(latest.sabotage.kind.toUpperCase())} SABOTAGE</b></div>`:''}<h4 class="map-section-title">ESTATE OBJECTIVES</h4><div class="map-task-list">${tasks}</div></section>`;
  m.querySelector('#map-close')?.addEventListener('click',()=>m.innerHTML='');
}
function openSettingsOverlay(){
  const m=document.querySelector<HTMLDivElement>('#meet');if(!m)return;
  m.innerHTML=`<div class="meetingbox art-panel settings-panel"><button class="panel-close" id="settings-close">×</button><p class="eyebrow">FIELD SETTINGS</p><h3>Game settings</h3><div class="settings-row"><img src="${artUrl('btn_settings')}" alt=""><span>Sound</span><button id="settings-sound">${muted?'OFF':'ON'}</button></div><label class="vh-audio-setting">Effects volume <input id="vh-sfx-volume" type="range" min="0" max="100" value="80"></label><label class="vh-audio-setting">Ambience volume <input id="vh-ambience-volume" type="range" min="0" max="100" value="32"></label><div class="settings-row"><img src="${artUrl('joystick_base')}" alt=""><span>Movement control</span><button id="vh-handedness">${leftHanded?'Left-hand joystick':'Right-hand joystick'}</button></div><div class="settings-row"><img src="${artUrl('overlay_cctv_monitor')}" alt=""><span>Security cameras</span><small>Camera network is not yet connected to live server state.</small></div><div class="settings-row"><img src="${artUrl('vent_closed')}" alt=""><span>Vent network</span><small>Vent artwork is present; traversal and collision routing are not yet implemented.</small></div><div class="settings-row"><img src="${artUrl('door_vertical_shut')}" alt=""><span>Door lockdown</span><small>Door sabotage visuals exist; physical door gates are not yet implemented.</small></div><button class="primary" id="settings-done">DONE</button></div>`;
  m.querySelector('#settings-close')?.addEventListener('click',()=>m.innerHTML='');
  m.querySelector('#settings-done')?.addEventListener('click',()=>m.innerHTML='');
  m.querySelector('#settings-sound')?.addEventListener('click',()=>{muted=!muted;gameAudio.setMuted(muted);const b=m.querySelector('#settings-sound');if(b)b.textContent=muted?'OFF':'ON';});
  m.querySelector<HTMLInputElement>('#vh-sfx-volume')?.addEventListener('input',e=>gameAudio.setEffectsVolume(Number((e.target as HTMLInputElement).value)/100));
  m.querySelector<HTMLInputElement>('#vh-ambience-volume')?.addEventListener('input',e=>gameAudio.setAmbienceVolume(Number((e.target as HTMLInputElement).value)/100));
  m.querySelector('#vh-handedness')?.addEventListener('click',()=>{leftHanded=!leftHanded;localStorage.setItem('vh-left-handed',String(leftHanded));document.querySelector('.controls')?.classList.toggle('left-handed',leftHanded);const b=m.querySelector('#vh-handedness');if(b)b.textContent=leftHanded?'Left-hand joystick':'Right-hand joystick';});
}
function nearestTask(): Task | undefined { return latest?.tasks.filter(t=>!t.done).map(t=>({...t,d:Math.hypot(t.x-me.x,t.y-me.y)})).filter(t=>t.d<150).sort((a,b)=>a.d-b.d)[0]; }
function nearestBody(): PublicPlayer | undefined { return latest?.players.filter(p=>!p.alive&&!p.reported).map(p=>({...p,d:Math.hypot(p.corpseX-me.x,p.corpseY-me.y)})).filter(p=>p.d<180).sort((a,b)=>a.d-b.d)[0]; }
function nearestTarget(): PublicPlayer | undefined { return latest?.players.filter(p=>p.alive&&p.id!==myId).map(p=>({...p,d:Math.hypot(p.x-me.x,p.y-me.y)})).filter(p=>p.d<125).sort((a,b)=>a.d-b.d)[0]; }
function openTask(task: Task) {
  const m=document.querySelector<HTMLDivElement>('#meet');if(!m)return;
  const art:Record<string,string>={vault:'task_vault_dial',server:'task_wires_server',helipad:'task_keycard_swipe',generator:'task_generator_breakers',dock:'task_boat_fuel',bar:'task_cocktail_mix',pool:'task_pool_valves',garage:'task_garage_scan'};
  const image=art[task.id]||'task_garage_scan';
  let interval=0,timeout=0,holdStarted=0,progress=0;
  const cleanup=()=>{if(interval)window.clearInterval(interval);if(timeout)window.clearTimeout(timeout);};
  const finish=(answer:string|number)=>{cleanup();socket.emit('use',{taskId:task.id,answer});m.innerHTML='';tone(760);haptic();};
  const status=(value:string)=>{const el=m.querySelector<HTMLElement>('#task-status');if(el)el.textContent=value;};
  let puzzle='';
  if(task.id==='vault')puzzle='<p>Enter the four-number combination in order: <b>2 · 7 · 4 · 1</b></p><div class="puzzle-pad">'+Array.from({length:10},(_,n)=>'<button data-digit="'+n+'">'+n+'</button>').join('')+'</div><p id="vault-entry">— — — —</p>';
  else if(task.id==='server')puzzle='<p>Reconnect each matching server lead. Select a terminal on the left, then its matching terminal on the right.</p><div class="wire-grid"><div>'+['red','blue','gold','teal'].map(c=>'<button data-wire-left="'+c+'" style="--wire:'+c+'">●</button>').join('')+'</div><div>'+['teal','gold','red','blue'].map(c=>'<button data-wire-right="'+c+'" style="--wire:'+c+'">●</button>').join('')+'</div></div><p id="wire-count">0 / 4 connected</p>';
  else if(task.id==='helipad')puzzle='<p>Swipe the VIP keycard across the reader at a steady speed.</p><div class="keycard-reader"><button id="swipe-card">⇢  SWIPE CARD</button></div>';
  else if(task.id==='generator')puzzle='<p>Set the four breakers to match the safe power pattern.</p><div class="breaker-row">'+[0,1,2,3].map(n=>'<button data-breaker="'+n+'" aria-pressed="false">OFF</button>').join('')+'</div>';
  else if(task.id==='dock')puzzle='<p>Hold the pump to fill the tank. Release when the gauge reaches 100%.</p><div class="fuel-meter"><i id="fuel-fill"></i></div><button id="fuel-hold">HOLD TO FUEL</button>';
  else if(task.id==='bar')puzzle='<p>Mix the VIP order in the correct sequence: lime → ice → rum.</p><div class="ingredient-row">'+['lime','ice','rum'].map(x=>'<button data-ingredient="'+x+'">'+x.toUpperCase()+'</button>').join('')+'</div><p id="mix-count">0 / 3</p>';
  else if(task.id==='pool')puzzle='<p>Balance filtration pressure in the green zone (68–76).</p><input id="pool-pressure" type="range" min="0" max="100" value="35"><p id="pool-value">35</p><button id="pool-lock">LOCK PRESSURE</button>';
  else puzzle='<p>Run the diagnostic scan, then verify the vehicle report.</p><div class="scan-meter"><i id="scan-fill"></i></div><p id="scan-status">Scanner initializing…</p><button id="scan-verify" disabled>VERIFY SCAN</button>';
  m.innerHTML='<div class="meetingbox taskbox art-task"><button id="task-close" class="panel-close" aria-label="Close task">×</button><p class="eyebrow">OCEAN DRIVE ESTATE · TASK '+(task.zone+1)+'</p><h3>'+escapeHtml(task.label)+'</h3><img class="task-art" src="'+artUrl(image)+'" alt=""><div class="puzzle-content">'+puzzle+'</div><p id="task-status" role="status">Complete the operation to secure this objective.</p><button id="cancel-task" class="textbtn">CANCEL</button></div>';
  const close=()=>{cleanup();m.innerHTML='';};
  m.querySelector('#task-close')?.addEventListener('click',close);
  m.querySelector('#cancel-task')?.addEventListener('click',close);
  if(task.id==='vault'){
    let entered='';m.querySelectorAll<HTMLButtonElement>('[data-digit]').forEach(b=>b.addEventListener('click',()=>{if(entered.length>=4)return;entered+=b.dataset.digit;const out=m.querySelector('#vault-entry');if(out)out.textContent=entered.padEnd(4,'—').split('').join(' ');if(entered.length===4){if(entered==='2741')finish('2741');else{entered='';status('Incorrect combination. Try again.');const out=m.querySelector('#vault-entry');if(out)out.textContent='— — — —';}}}));
  }else if(task.id==='server'){
    const matched=new Set<string>();let selected='';m.querySelectorAll<HTMLButtonElement>('[data-wire-left]').forEach(b=>b.addEventListener('click',()=>{if(matched.has(b.dataset.wireLeft!))return;selected=b.dataset.wireLeft!;m.querySelectorAll('[data-wire-left]').forEach(x=>x.classList.remove('selected'));b.classList.add('selected');status('Now select the matching terminal on the right.');}));m.querySelectorAll<HTMLButtonElement>('[data-wire-right]').forEach(b=>b.addEventListener('click',()=>{const color=b.dataset.wireRight!;if(!selected)return;if(color===selected){matched.add(color);b.disabled=true;const left=m.querySelector<HTMLButtonElement>('[data-wire-left="'+color+'"]');if(left)left.disabled=true;b.classList.add('connected');const out=m.querySelector('#wire-count');if(out)out.textContent=matched.size+' / 4 connected';selected='';if(matched.size===4)finish([...matched].sort().join(','));}else{selected='';status('Wrong wire. Select a new pair.');m.querySelectorAll('[data-wire-left]').forEach(x=>x.classList.remove('selected'));}}));
  }else if(task.id==='helipad'){
    const card=m.querySelector<HTMLButtonElement>('#swipe-card')!;let down:{x:number;time:number}|null=null;
    card.addEventListener('pointerdown',e=>{down={x:e.clientX,time:performance.now()};card.setPointerCapture(e.pointerId);});
    card.addEventListener('pointerup',e=>{if(!down)return;const dx=e.clientX-down.x,dt=performance.now()-down.time;down=null;if(dx>90&&dt>=250&&dt<=1200)finish(dt);else status(dx<=90?'Swipe farther across the reader.':dt<250?'Too fast — try a steadier swipe.':'Too slow — try again.');});
  }else if(task.id==='generator'){
    const target=[true,false,true,true],state=[false,false,false,false];const paint=()=>{m.querySelectorAll<HTMLButtonElement>('[data-breaker]').forEach((b,i)=>{b.textContent=state[i]?'ON':'OFF';b.setAttribute('aria-pressed',String(state[i]));b.classList.toggle('on',state[i]);});};
    m.querySelectorAll<HTMLButtonElement>('[data-breaker]').forEach(b=>b.addEventListener('click',()=>{const i=Number(b.dataset.breaker);state[i]=!state[i];paint();if(state.every((v,i)=>v===target[i]))finish(state.map(v=>v?'1':'0').join(''));}));
  }else if(task.id==='dock'){
    const button=m.querySelector<HTMLButtonElement>('#fuel-hold')!,fill=m.querySelector<HTMLElement>('#fuel-fill')!;
    button.addEventListener('pointerdown',e=>{button.setPointerCapture(e.pointerId);holdStarted=performance.now();interval=window.setInterval(()=>{progress=Math.min(100,(performance.now()-holdStarted)/20);fill.style.width=progress+'%';if(progress>=100){cleanup();status('Fuel tank full.');finish(Math.round(progress*20));}},40);});
    const release=()=>{if(!interval)return;cleanup();if(progress<100)status('Keep holding until the gauge reaches 100%.');};button.addEventListener('pointerup',release);button.addEventListener('pointercancel',release);
  }else if(task.id==='bar'){
    const sequence=['lime','ice','rum'];let step=0;m.querySelectorAll<HTMLButtonElement>('[data-ingredient]').forEach(b=>b.addEventListener('click',()=>{if(b.dataset.ingredient===sequence[step]){b.disabled=true;step++;const out=m.querySelector('#mix-count');if(out)out.textContent=step+' / 3';if(step===3)finish(sequence.join(','));}else{step=0;m.querySelectorAll<HTMLButtonElement>('[data-ingredient]').forEach(x=>{x.disabled=false;});const out=m.querySelector('#mix-count');if(out)out.textContent='0 / 3';status('Wrong ingredient. Start the recipe again.');}}));
  }else if(task.id==='pool'){
    const slider=m.querySelector<HTMLInputElement>('#pool-pressure')!,value=m.querySelector('#pool-value')!;slider.addEventListener('input',()=>{value.textContent=slider.value;});m.querySelector('#pool-lock')?.addEventListener('click',()=>{const n=Number(slider.value);if(n>=68&&n<=76)finish(n);else status('Pressure is outside the green zone. Adjust and retry.');});
  }else{
    const fill=m.querySelector<HTMLElement>('#scan-fill')!,label=m.querySelector('#scan-status')!,verify=m.querySelector<HTMLButtonElement>('#scan-verify')!;
    timeout=window.setTimeout(()=>{fill.style.width='100%';label.textContent='Diagnostic complete.';verify.disabled=false;},1600);
    verify.addEventListener('click',()=>finish(1600));
  }
}
function toast(message: string) { const el=document.querySelector('#toast');if(el)el.textContent=message; }
function showEliminationCutscene(){
  const m=document.querySelector<HTMLDivElement>('#meet');if(!m)return;
  m.innerHTML='<div class="scene-screen elimination-cutscene"><img src="'+artUrl('slide_kill_cutscene')+'" alt=""><h2>YOU WERE ELIMINATED</h2><p>You can still observe the heist.</p><button id="cutscene-close" class="primary">CONTINUE</button></div>';
  m.querySelector('#cutscene-close')?.addEventListener('click',()=>m.innerHTML='');
}
function renderMeeting(s: Snapshot) {
  const m=document.querySelector<HTMLDivElement>('#meet');if(!m||!s.meeting)return;currentMeetingEnds=s.meeting.endsAt;
  const votes=s.players.map(p=>`<button data-vote="${escapeHtml(p.id)}" class="vote-card" ${p.alive?'':'disabled'}><img src="${artUrl(p.alive?'vote_card_alive':'vote_card_dead')}" alt=""><span>${escapeHtml(p.name)}${p.alive?'':' · OUT'}</span></button>`).join('');
  m.innerHTML=`<div class="meetingbox art-meeting"><img class="meeting-frame-art" src="${artUrl('tablet_meeting_frame')}" alt=""><img class="meeting-table-art" src="${artUrl('meeting_table_prop')}" alt=""><img class="meeting-slide-art" src="${artUrl('slide_report_meeting')}" alt=""><p class="eyebrow">EMERGENCY PROTOCOL</p><h3>${escapeHtml(s.meeting.reason)}</h3><p id="meeting-timer">Discuss and vote · ${Math.max(0,Math.ceil((s.meeting.endsAt-Date.now())/1000))}s</p><div class="votelist">${votes}<button data-vote="skip" class="vote-skip"><img src="${artUrl('btn_vote_confirm_skip')}" alt=""><span>SKIP</span></button></div><div id="chatlines" class="chatlines">${chatLines.slice(-6).map(escapeHtml).join('<br>')}</div><form id="chatform"><input id="chatinput" maxlength="180" placeholder="Message the crew"><button>SEND</button></form></div>`;
  m.querySelectorAll('[data-vote]').forEach(b=>b.addEventListener('click',()=>{socket.emit('vote',(b as HTMLElement).dataset.vote);tone(450);}));
  m.querySelector('#chatform')?.addEventListener('submit',e=>{e.preventDefault();const input=m.querySelector<HTMLInputElement>('#chatinput');if(input?.value.trim()){socket.emit('chat',input.value.trim());input.value='';}});
}
function updateHud(s: Snapshot | null) {
  if(!s||currentPhase!=='PLAYING')return;
  const done=s.tasks.filter(t=>t.done).length;const objective=document.querySelector('#objective');const local=s.players.find(p=>p.id===myId);
  const actions=document.querySelector<HTMLElement>('.actions');if(actions)actions.style.display=local?.alive?'grid':'none';
  const controls=document.querySelector<HTMLElement>('.controls');
  const stick=document.querySelector<HTMLElement>('#stick');
  const ghostMode=!!local&&!local.alive;
  controls?.classList.toggle('ghost-controls',ghostMode);
  if(controls)controls.style.justifyContent=ghostMode?'flex-end':'space-between';
  if(stick&&ghostMode){
    Object.assign(stick.style,{width:'124px',height:'124px',minWidth:'124px',minHeight:'124px',maxWidth:'124px',maxHeight:'124px',flex:'0 0 124px',aspectRatio:'1 / 1',borderRadius:'50%',marginLeft:'auto'});
  }else if(stick){
    for(const property of ['width','height','min-width','min-height','max-width','max-height','flex','aspect-ratio','border-radius','margin-left'])stick.style.removeProperty(property);
  }
  if(objective){const label=objective.querySelector<HTMLElement>('.objective-label');if(label)label.textContent=local?.alive?`${done}/${s.taskTotal} estate jobs secured · ${s.selfRole==='MOLE'?'You are the Mole':'Find the Mole'}`:'YOU ARE DOWN · SPECTATING';const fill=objective.querySelector<HTMLElement>('#objective-fill');if(fill)fill.style.width=`${s.taskTotal?Math.round(done/s.taskTotal*100):0}%`;}
  const radar=document.querySelector<HTMLDivElement>('#radar');if(radar){
    const tasks=s.tasks.map(t=>'<i class="radar-task '+(t.done?'done':'')+'" style="left:'+(t.x/8192*100)+'%;top:'+(t.y/4096*100)+'%"></i>').join('');
    const players=s.players.map(p=>'<i class="radar-player '+(p.id===myId?'self ':'')+(p.alive?'':'down')+'" style="left:'+(p.x/8192*100)+'%;top:'+(p.y/4096*100)+'%;--marker:'+escapeHtml(p.color)+'"></i>').join('');
    radar.innerHTML=tasks+players;
  }
  setButtonArt('use',local?.alive&&s.selfRole!=='MOLE'&&!!nearestTask()?'btn_use_active':'btn_use_dim');
  setButtonArt('report',local?.alive&&!!nearestBody()?'btn_report_active':'btn_report_dim');
  const kill=document.querySelector<HTMLButtonElement>('#kill'),sab=document.querySelector<HTMLButtonElement>('#sabotage');
  if(kill){kill.style.display=s.selfRole==='MOLE'?'block':'none';const left=Math.max(0,Math.ceil((s.selfCooldownUntil-Date.now())/1000));const ready=!!local?.alive&&left<=0&&!!nearestTarget();kill.disabled=!ready;setButtonArt('kill',ready?'btn_kill_active':'btn_kill_dim');kill.querySelector('span')!.textContent=left>0?`ELIM ${left}s`:'ELIMINATE';}
  if(sab){sab.style.display=s.selfRole==='MOLE'?'block':'none';const left=Math.max(0,Math.ceil(((s.sabotage?.endsAt||0)-Date.now())/1000));sab.disabled=!local?.alive||left>0;sab.querySelector('span')!.textContent=left>0?`LIGHTS ${left}s`:'LIGHTS';}
  const report=document.querySelector<HTMLButtonElement>('#report');if(report)report.disabled=!local?.alive||!nearestBody();
  const emergency=document.querySelector<HTMLButtonElement>('#emergency');if(emergency){const left=Math.max(0,Math.ceil((s.emergencyCooldownUntil-Date.now())/1000));emergency.disabled=!local?.alive||s.selfEmergencyUsed||left>0;emergency.querySelector('span')!.textContent=s.selfEmergencyUsed?'USED':left>0?`CALL ${left}s`:'EMERGENCY';}
  const use=document.querySelector<HTMLButtonElement>('#use');if(use)use.disabled=!local?.alive||s.selfRole==='MOLE'||!nearestTask();
}
function renderState(s: Snapshot) {
  hideMenuFrame();
  const previousSnapshot=latest;
  if(previousSnapshot){
    const beforeLocal=previousSnapshot.players.find(p=>p.id===myId),afterLocal=s.players.find(p=>p.id===myId);
    if(previousSnapshot.phase!=='PLAYING'&&s.phase==='PLAYING')gameAudio.play('roundStart');
    if(beforeLocal?.alive&&!afterLocal?.alive)gameAudio.play('death');
    if(s.selfRole==='MOLE'&&previousSnapshot.players.some(p=>p.id!==myId&&p.alive)&&s.players.some(p=>{const old=previousSnapshot.players.find(q=>q.id===p.id);return p.id!==myId&&old?.alive&&!p.alive;}))gameAudio.play('kill');
    if(s.players.some(p=>{const old=previousSnapshot.players.find(q=>q.id===p.id);return old&&!old.reported&&p.reported;}))gameAudio.play('bodyFound');
    if(s.tasks.some(t=>{const old=previousSnapshot.tasks.find(q=>q.id===t.id);return old&&!old.done&&t.done;}))gameAudio.play('task');
    if(previousSnapshot.phase!=='MEETING'&&s.phase==='MEETING')gameAudio.play('meeting');
    if(previousSnapshot.phase!=='GAME_OVER'&&s.phase==='GAME_OVER')gameAudio.play(s.winner==='CREW'?'crewWin':'moleWin');
    if((!previousSnapshot.sabotage||previousSnapshot.sabotage.endsAt<=Date.now())&&s.sabotage&&s.sabotage.endsAt>Date.now())gameAudio.play('sabotage');
  }
  const prev=currentPhase;latest=s;const local=s.players.find(p=>p.id===myId);
  if(local){
    // Treat the first snapshot for each player ID as initialization, not a correction.
    // Set both positions before syncState creates/follows the local sprite.
    if(initializedPlayerId!==local.id){
      initializedPlayerId=local.id;
      me.x=serverMe.x=local.x;
      me.y=serverMe.y=local.y;
      sceneRef?.resetLocalSamples();
    }
    // Server snapshots are the sole position authority. The renderer buffers
    // these samples instead of integrating a second, competing local position.
  }
  sceneRef?.syncState(s);
  if(s.phase==='LOBBY'){if(currentPhase!=='LOBBY')lobby(s);else updateLobby(s);}
  else if(s.phase==='PLAYING'){
    if(currentPhase!=='PLAYING'){hud();if(!roleShown){roleShown=true;const role=s.selfRole==='MOLE'?'MOLE':'CREW';const m=document.querySelector<HTMLDivElement>('#meet');if(m)m.innerHTML=`<div class="scene-screen role-reveal"><p class="eyebrow">YOUR SECRET ROLE</p><h2>${role}</h2><p>${role==='MOLE'?'Eliminate the crew and sabotage the estate.':'Complete the estate jobs and identify the Mole.'}</p><button id="role-ok" class="primary">UNDERSTOOD</button></div>`;document.querySelector('#role-ok')?.addEventListener('click',()=>{const x=document.querySelector('#meet');if(x)x.innerHTML='';});tone(650,0.16);}}
    currentPhase='PLAYING';updateHud(s);
  } else if(s.phase==='MEETING'){
    if(currentPhase!=='PLAYING'&&currentPhase!=='MEETING')hud();
    if(currentPhase!=='MEETING'||currentMeetingEnds!==s.meeting?.endsAt){renderMeeting(s);tone(260,0.25);}currentPhase='MEETING';
    const timer=document.querySelector('#meeting-timer');if(timer&&s.meeting)timer.textContent=`Discuss and vote · ${Math.max(0,Math.ceil((s.meeting.endsAt-Date.now())/1000))}s`;
  } else if(s.phase==='GAME_OVER'){
    if(currentPhase!=='GAME_OVER'){currentPhase='GAME_OVER';show(`<div class="scene-screen gameover art-victory"><img src="${artUrl('slide_ejection_victory')}" alt=""><p class="eyebrow">OCEAN DRIVE ESTATE</p><h2>${s.winner==='CREW'?'CREW ESCAPED':'MOLES TOOK THE ESTATE'}</h2><p>The heist is over.</p><button id="again" class="primary">RETURN TO MAIN MENU</button></div>`);document.querySelector('#again')!.addEventListener('click',()=>{clearSession();socket.disconnect();location.reload();});tone(s.winner==='CREW'?740:130,0.4);}
  }
}

class Estate extends Phaser.Scene {
  private actors = new Map<string, Phaser.GameObjects.Sprite>();
  private nameLabels = new Map<string, Phaser.GameObjects.Text>();
  private remoteSamples = new Map<string,{x:number;y:number;time:number}[]>();
  private keys!: any;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private ready = false; private lastEmit = 0; private moving = false;
  // Movement epoch changes on press/release, never for every 50ms packet.
  private moveSequence = 0;
  private movementRequestSequence = 0;
  private lastAppliedMovementAck = 0;
  private taskDots!: Phaser.GameObjects.Graphics; private debugGraphics!: Phaser.GameObjects.Graphics;
  private taskGlows = new Map<string, Phaser.GameObjects.Image>();
  private corpseArt = new Map<string, Phaser.GameObjects.Image>();
  private previousAlive = new Map<string, boolean>();
  private masks: Uint8Array[] = []; private visionCanvas?: HTMLCanvasElement; private visionContext?: CanvasRenderingContext2D; private lastVision = 0;
  private mapTiles = new Map<number, Phaser.GameObjects.Image>();
  private mapDesired = new Set<number>();
  private mapLoading = new Set<number>();
  private mapLoadInFlight = false;
  private readonly visionPoint = new Phaser.Math.Vector2();
  private readonly visionPostRender = (_renderer: unknown, time: number) => this.drawVision(time);
  private initialMapTiles = new Set<number>();
  private lastMapStreamAt = 0;
  constructor(){super('Estate');}
  preload(){
    console.info('[Vice Heist startup] Essential Phaser preload started.');
    performance.mark('vh-essential-preload-start');
    // Avoid saturating iPhone Safari with too many simultaneous image decodes.
    (this.load as any).maxParallelDownloads = 6;
    this.load.on('progress',(value:number)=>{
      if(phaserAssetsLoaded)mapLoadProgress=Phaser.Math.Clamp(value,0,1);
      else phaserLoadProgress=Phaser.Math.Clamp(value,0,1);
      updateSplashProgress();
    });
    this.load.on('loaderror',(file:any)=>{
      phaserLoadError='Failed to load game asset: '+file.key+' ('+file.src+')';
      console.error('[Vice Heist startup] Asset load error:',{key:file.key,url:file.src,afterEssentialPreload:phaserAssetsLoaded});
      window.dispatchEvent(new CustomEvent('vh:game-error',{detail:phaserLoadError}));
    });
    this.load.once('complete',()=>{
      phaserAssetsLoaded=true;phaserLoadProgress=1;mapLoadProgress=0;
      performance.mark('vh-essential-preload-complete');
      console.info('[Vice Heist startup] Essential assets loaded; preparing initial map sectors.');
      updateSplashProgress();
    });
    // Eight masks are CPU-side packed bytes, never GPU image textures.
    for(let i=1;i<=8;i++)this.load.binary(`mask${i}`,`/assets/map/mask-${i}.bin`);
    // Only animation frames and the two in-world props are required by Phaser.
    // All 55 UI/cutscene/task illustrations are loaded by ordinary HTML <img>
    // elements when their screens are shown, not during the initial preload.
    const essentialArt=[...VICE_HEIST_WALK_UP,...VICE_HEIST_WALK_DOWN,...VICE_HEIST_KILL,...VICE_HEIST_GHOST,'task_console_glow','corpse_chalk_outline'];
    for(const id of essentialArt)this.load.image(id,`/assets/vice-heist/${id}.png`);
  }
  create(){
    try {
    console.info('[Vice Heist startup] Phaser scene setup started.');
    performance.mark('vh-scene-setup-start');
    this.cameras.main.setBounds(0,0,8192,4096);this.applyCameraZoom();this.cameras.main.roundPixels=true;
    // A resumed session may already have supplied its snapshot during splash.
    // Load the correct nearby sectors first instead of briefly showing spawn-area
    // tiles while the camera catches up to the returning player.
    const startupSnapshot=latest||pendingSnapshot;
    const startupLocal=startupSnapshot?.players.find(p=>p.id===myId);
    if(startupLocal){me.x=serverMe.x=startupLocal.x;me.y=serverMe.y=startupLocal.y;}
    this.cameras.main.centerOn(me.x,me.y);
    const register=(key:string,frames:readonly string[],frameRate:number,repeat=-1)=>this.anims.create({key,frames:frames.map(frame=>({key:frame})),frameRate,repeat});
    // Four-frame walk cycles at 5fps hold each pose for 200ms.
    register('vh-walk-up',VICE_HEIST_WALK_UP,5);register('vh-walk-down',VICE_HEIST_WALK_DOWN,5);register('vh-kill-lunge',VICE_HEIST_KILL,12,0);register('vh-ghost-float',VICE_HEIST_GHOST,5);
    this.taskDots=this.add.graphics().setDepth(4);this.debugGraphics=this.add.graphics().setDepth(30);
    this.keys=this.input.keyboard!.addKeys('W,A,S,D,C');this.cursors=this.input.keyboard!.createCursorKeys();
    this.loadMasks();this.ready=true;this.setupVision();this.scale.on('resize',()=>{this.applyCameraZoom();this.resizeVisionCanvas();});
    this.game.canvas.addEventListener('webglcontextlost',()=>console.error('[Vice Heist startup] WebGL context lost during gameplay/startup.'));
    sceneRef=this;
    if(startupSnapshot)this.syncState(startupSnapshot);
    this.streamMapTiles(true);
    } catch(error) {
      phaserLoadError=error instanceof Error?error.message:String(error);
      console.error('[Vice Heist startup] Scene setup failed:',error);
      window.dispatchEvent(new CustomEvent('vh:game-error',{detail:phaserLoadError}));throw error;
    }
  }
  stopMovement(force=false){
    if(!this.moving&&!force)return;
    this.moving=false;
    const epoch=++this.moveSequence;
    const request=++this.movementRequestSequence;
    socket.emit('move',{x:0,y:0,epoch,requestId:request},(ack?:{ok?:boolean;x?:number;y?:number})=>{
      if(epoch!==this.moveSequence||this.moving||request<this.lastAppliedMovementAck||!ack?.ok||!Number.isFinite(ack.x)||!Number.isFinite(ack.y))return;
      this.lastAppliedMovementAck=request;
      serverMe.x=ack.x!;serverMe.y=ack.y!;
    });
  }
  resetLocalSamples(){this.remoteSamples.delete(myId);}
  private applyCameraZoom(){
    const width=this.scale.width||innerWidth,height=this.scale.height||innerHeight;
    const fit=Math.min(width/760,height/1180);
    this.cameras.main.setZoom(Phaser.Math.Clamp(fit,0.42,1.15));
  }
  private loadMasks(){
    for(let i=1;i<=8;i++){
      const packed=this.cache.binary.get(`mask${i}`) as ArrayBuffer | Uint8Array | undefined;
      const bits=packed instanceof ArrayBuffer?new Uint8Array(packed):packed instanceof Uint8Array?packed:undefined;
      if(!bits||bits.byteLength!==524288)throw new Error(`Packed collision mask ${i} must be 524,288 bytes.`);
      this.masks.push(bits);
      this.cache.binary.remove(`mask${i}`);
    }
    console.info('[Vice Heist startup] Loaded eight packed collision masks (4 MiB CPU memory; no mask GPU textures).');
  }
  private finishSceneReady(){
    if(phaserSceneReady)return;
    const missing=[...this.initialMapTiles].filter(index=>!this.mapTiles.has(index));
    if(missing.length){
      const message='Initial estate map sector load failed: '+missing.map(index=>index+1).join(', ');
      phaserLoadError=message;console.error('[Vice Heist startup]',message);
      window.dispatchEvent(new CustomEvent('vh:game-error',{detail:message}));return;
    }
    phaserSceneReady=true;mapLoadProgress=1;
    performance.mark('vh-game-ready');
    console.info('[Vice Heist startup] Scene ready; initial sectors:',[...this.initialMapTiles].map(index=>index+1));
    updateSplashProgress();window.dispatchEvent(new CustomEvent('vh:game-ready'));
  }
  private pumpMapTiles(){
    if(this.mapLoadInFlight)return;
    const pending=[...this.mapDesired].filter(index=>!this.mapTiles.has(index)&&!this.mapLoading.has(index));
    if(!pending.length){this.finishSceneReady();return;}
    this.mapLoadInFlight=true;mapLoadProgress=0;updateSplashProgress();
    for(const index of pending){this.mapLoading.add(index);this.load.image(`map${index+1}`,`/assets/map/take-${index+1}.webp`);}
    this.load.once('complete',()=>{
      this.mapLoadInFlight=false;
      for(const index of pending){
        this.mapLoading.delete(index);
        const key=`map${index+1}`;
        if(this.textures.exists(key)){
          const col=index%4,row=Math.floor(index/4);
          // Add an 8px duplicated-edge gutter around each sector. The visible
          // 2048px source remains exactly 2048 world units; only the gutter
          // overlaps neighbouring sectors. Scaling the source itself caused
          // collision-mask and artwork outlines to drift apart.
          const paddedKey=key+'-gutter';
          if(!this.textures.exists(paddedKey)){
            const source=this.textures.get(key).getSourceImage() as CanvasImageSource;
            const canvas=document.createElement('canvas');canvas.width=2064;canvas.height=2064;
            const ctx=canvas.getContext('2d');
            if(!ctx)throw new Error('Unable to prepare map sector edge gutter.');
            ctx.drawImage(source,0,0,2048,2048,8,8,2048,2048);
            ctx.drawImage(source,0,0,2048,1,8,0,2048,8);
            ctx.drawImage(source,0,2047,2048,1,8,2056,2048,8);
            ctx.drawImage(source,0,0,1,2048,0,8,8,2048);
            ctx.drawImage(source,2047,0,1,2048,2056,8,8,2048);
            ctx.drawImage(source,0,0,1,1,0,0,8,8);
            ctx.drawImage(source,2047,0,1,1,2056,0,8,8);
            ctx.drawImage(source,0,2047,1,1,0,2056,8,8);
            ctx.drawImage(source,2047,2047,1,1,2056,2056,8,8);
            this.textures.addCanvas(paddedKey,canvas);
          }
          const tile=this.add.image(col*2048+1024,row*2048+1024,paddedKey).setDepth(0).setDisplaySize(2064,2064);
          this.mapTiles.set(index,tile);
        }else{
          console.error('[Vice Heist map streaming] Sector texture unavailable:',key);
        }
      }
      mapLoadProgress=1;updateSplashProgress();
      this.finishSceneReady();
      this.pumpMapTiles();
    });
    this.load.start();
  }
  private streamMapTiles(initial=false){
    const camera=this.cameras.main;
    const centerX=this.actors.get(myId)?.x??me.x,centerY=this.actors.get(myId)?.y??me.y;
    const worldWidth=(this.scale.width||innerWidth)/Math.max(.01,camera.zoom);
    const worldHeight=(this.scale.height||innerHeight)/Math.max(.01,camera.zoom);
    const margin=420;
    const left=Phaser.Math.Clamp(centerX-worldWidth/2-margin,0,8191);
    const right=Phaser.Math.Clamp(centerX+worldWidth/2+margin,0,8191);
    const top=Phaser.Math.Clamp(centerY-worldHeight/2-margin,0,4095);
    const bottom=Phaser.Math.Clamp(centerY+worldHeight/2+margin,0,4095);
    const minCol=Math.floor(left/2048),maxCol=Math.floor(right/2048);
    const minRow=Math.floor(top/2048),maxRow=Math.floor(bottom/2048);
    const desired=new Set<number>();
    for(let row=minRow;row<=maxRow;row++)for(let col=minCol;col<=maxCol;col++)desired.add(row*4+col);
    if(initial)this.initialMapTiles=new Set(desired);
    this.mapDesired=desired;
    for(const [index,tile] of this.mapTiles){
      if(!desired.has(index)){
        tile.destroy();this.mapTiles.delete(index);
        this.textures.remove(`map${index+1}-gutter`);this.textures.remove(`map${index+1}`);
      }
    }
    this.pumpMapTiles();
  }
  private solid(x:number,y:number):boolean{
    if(x<0||y<0||x>=8192||y>=4096)return true;if(this.masks.length!==8)return true;
    const col=Math.floor(x/2048),row=Math.floor(y/2048),tile=this.masks[row*4+col];const p=(Math.floor(y)%2048)*2048+(Math.floor(x)%2048);return (tile[p>>3]&(1<<(p&7)))!==0;
  }
  private blocked(x:number,y:number,r=18):boolean{const d=r*.7071;return [[x-r,y],[x+r,y],[x,y-r],[x,y+r],[x-d,y-d],[x+d,y-d],[x-d,y+d],[x+d,y+d]].some(([a,b])=>this.solid(a,b));}
  private moveWithCollision(x:number,y:number,dx:number,dy:number){
    const steps=Math.max(1,Math.ceil(Math.max(Math.abs(dx),Math.abs(dy))/6));
    const stepX=dx/steps,stepY=dy/steps;
    for(let i=0;i<steps;i++){
      const nextX=x+stepX,nextY=y+stepY;
      if(!this.blocked(nextX,y))x=nextX;
      if(!this.blocked(x,nextY))y=nextY;
    }
    return {x,y};
  }
  syncState(s:Snapshot){
    const local=s.players.find(p=>p.id===myId);
    if(local){
      const wasAlive=this.previousAlive.get(local.id);
      if(wasAlive===true&&!local.alive)showEliminationCutscene();
      this.previousAlive.set(local.id,local.alive);
      // Local snapshots are reconciliation targets, not delayed render samples.
      serverMe.x=local.x;serverMe.y=local.y;
      let a=this.actors.get(local.id);
      if(!a){
        a=this.add.sprite(local.x,local.y,'walk_down_1').setOrigin(.5,.92).setDepth(10).setScale(.24).setTint(Phaser.Display.Color.HexStringToColor(local.color).color);
        this.actors.set(local.id,a);
        this.nameLabels.set(local.id,this.add.text(local.x,local.y-48,local.name,{fontFamily:'Inter, sans-serif',fontSize:'16px',fontStyle:'700',color:'#fff',stroke:'#11121a',strokeThickness:4}).setOrigin(.5,1).setDepth(31));
        this.cameras.main.startFollow(a,true,.30,.30);
      }
      a.setAlpha(local.alive?1:.92).setTint(Phaser.Display.Color.HexStringToColor(local.color).color);
      if(!local.alive&&a.anims.currentAnim?.key!=='vh-ghost-float')a.play('vh-ghost-float',true);
    }
    for(const p of s.players){const wasAlive=this.previousAlive.get(p.id);if(p.id!==myId&&wasAlive===true&&!p.alive&&s.selfRole==='MOLE'&&local?.alive){const killer=this.actors.get(myId);if(killer)killer.play('vh-kill-lunge',true);}this.previousAlive.set(p.id,p.alive);if(p.id===myId)continue;let a=this.actors.get(p.id);if(!a){const created=this.add.sprite(p.x,p.y,'walk_down_1').setOrigin(.5,.92).setDepth(10).setScale(.24).setTint(Phaser.Display.Color.HexStringToColor(p.color).color);a=created;this.actors.set(p.id,created);this.nameLabels.set(p.id,this.add.text(p.x,p.y-48,p.name,{fontFamily:'Inter, sans-serif',fontSize:'16px',fontStyle:'700',color:'#fff',stroke:'#11121a',strokeThickness:4}).setOrigin(.5,1).setDepth(31));}if(a){
      const previous=this.remoteSamples.get(p.id)||[];const now=performance.now();const moving=!!previous.length&&Math.hypot(previous[previous.length-1].x-p.x,previous[previous.length-1].y-p.y)>1.5;
      previous.push({x:p.x,y:p.y,time:now});if(previous.length>8)previous.shift();this.remoteSamples.set(p.id,previous);if(previous.length>1&&moving){const dx=p.x-previous[previous.length-2].x,dy=p.y-previous[previous.length-2].y;if(Math.abs(dx)>Math.abs(dy))a.setFlipX(dx<0);}
      a.setAlpha(p.alive?1:.92);a.setTint(Phaser.Display.Color.HexStringToColor(p.color).color);if(!p.alive){if(a.anims.currentAnim?.key!=='vh-ghost-float')a.play('vh-ghost-float',true);}else if(moving){const dx=p.x-previous[previous.length-2].x,dy=p.y-previous[previous.length-2].y;const walkKey=Math.abs(dy)>Math.abs(dx)?(dy<0?'vh-walk-up':'vh-walk-down'):'vh-walk-down';a.setFlipX(Math.abs(dx)>Math.abs(dy)&&dx<0);if(a.anims.currentAnim?.key!==walkKey)a.play(walkKey,true);}}
    }
    for(const [id,a] of this.actors){const label=this.nameLabels.get(id);if(label){label.setText(s.players.find(p=>p.id===id)?.name||'');label.setPosition(a.x,a.y-48);}}
    for(const [id,a] of this.actors)if(!s.players.some(p=>p.id===id)){a.destroy();this.actors.delete(id);this.nameLabels.get(id)?.destroy();this.nameLabels.delete(id);this.remoteSamples.delete(id);}
  }
  private setupVision(){
    const canvas=document.createElement('canvas');canvas.className='vision-layer';canvas.setAttribute('aria-hidden','true');
    const overlay=document.querySelector('#overlay');
    if(overlay?.parentNode)overlay.parentNode.insertBefore(canvas,overlay);else document.body.appendChild(canvas);
    this.visionCanvas=canvas;
    const context=canvas.getContext('2d',{alpha:true});
    if(!context)throw new Error('2D visibility overlay is unavailable.');
    this.visionContext=context;
    this.resizeVisionCanvas();
    // Draw after Phaser has finalized this frame's camera follow/zoom matrix.
    this.game.events.on(Phaser.Core.Events.POST_RENDER,this.visionPostRender);
  }
  private resizeVisionCanvas(){
    const canvas=this.visionCanvas;if(!canvas)return;
    const rect=this.game.canvas.getBoundingClientRect(),dpr=Math.min(2,Math.max(1,window.devicePixelRatio||1));
    canvas.style.left=rect.left+'px';canvas.style.top=rect.top+'px';
    canvas.style.width=rect.width+'px';canvas.style.height=rect.height+'px';
    const width=Math.max(1,Math.round(rect.width*dpr)),height=Math.max(1,Math.round(rect.height*dpr));
    if(canvas.width!==width||canvas.height!==height){canvas.width=width;canvas.height=height;}
    this.visionContext?.setTransform(dpr,0,0,dpr,0,0);
  }
  private drawVision(time:number){
    const canvas=this.visionCanvas,ctx=this.visionContext;if(!canvas||!ctx)return;
    // Keep visibility work below the main 60fps render budget.
    if(time-this.lastVision<33)return;this.lastVision=time;
    const width=canvas.clientWidth,height=canvas.clientHeight;
    ctx.clearRect(0,0,width,height);
    if(!latest||latest.phase!=='PLAYING'||this.keys?.C?.isDown)return;
    const mePlayer=latest.players.find(p=>p.id===myId);if(!mePlayer)return;
    const actor=this.actors.get(myId),originX=actor?.x??mePlayer.x,originY=actor?.y??mePlayer.y;
    const radius=!mePlayer.alive?430:latest.selfRole==='MOLE'?900:(latest.sabotage&&latest.sabotage.endsAt>Date.now()?310:690);
    const camera=this.cameras.main;
    // Project with the exact transform Phaser used to render this frame.
    const cameraMatrix=(camera as unknown as {matrix:{transformPoint(x:number,y:number,point:Phaser.Math.Vector2):Phaser.Math.Vector2}}).matrix;
    ctx.save();ctx.globalCompositeOperation='source-over';ctx.fillStyle='rgba(5,7,13,.72)';ctx.fillRect(0,0,width,height);
    ctx.globalCompositeOperation='destination-out';ctx.beginPath();
    const rayCount=512,rayStep=3;
    for(let i=0;i<rayCount;i++){
      const angle=i*Math.PI*2/rayCount,dx=Math.cos(angle),dy=Math.sin(angle);
      let clear=radius,blockedAt=radius;
      for(let distance=rayStep;distance<=radius;distance+=rayStep){
        if(this.solid(originX+dx*distance,originY+dy*distance)){blockedAt=distance;clear=distance-rayStep;break;}
      }
      if(blockedAt<radius){let low=clear,high=blockedAt;for(let refine=0;refine<5;refine++){const mid=(low+high)*.5;if(this.solid(originX+dx*mid,originY+dy*mid))high=mid;else low=mid;}clear=low;}
      const projected=cameraMatrix.transformPoint(
        originX+dx*clear-camera.scrollX,
        originY+dy*clear-camera.scrollY,
        this.visionPoint,
      );
      const rayX=projected.x,rayY=projected.y;
      if(i===0)ctx.moveTo(rayX,rayY);else ctx.lineTo(rayX,rayY);
    }
    ctx.closePath();ctx.fill();ctx.restore();
  }
  update(time:number,delta:number){
    if(!this.ready)return;
    if(time-this.lastMapStreamAt>=200){this.lastMapStreamAt=time;this.streamMapTiles();}
    const now=performance.now();
    // Remote actors use buffered snapshots. Never delay the local actor.
    for(const [id,samples] of this.remoteSamples){
      if(id===myId)continue;
      const actor=this.actors.get(id);if(!actor||!samples.length)continue;
      const renderAt=now-120;
      while(samples.length>2&&samples[1].time<renderAt-250)samples.shift();
      let x=samples[samples.length-1].x,y=samples[samples.length-1].y;
      if(samples.length>=2){
        let left=samples[0],right=samples[1],bracketed=false;
        if(renderAt<=samples[0].time){left=samples[0];right=samples[1];bracketed=true;}
        else for(let i=1;i<samples.length;i++){if(samples[i].time>=renderAt){left=samples[i-1];right=samples[i];bracketed=true;break;}}
        if(bracketed){const span=Math.max(1,right.time-left.time),t=Phaser.Math.Clamp((renderAt-left.time)/span,0,1);x=Phaser.Math.Linear(left.x,right.x,t);y=Phaser.Math.Linear(left.y,right.y,t);}
      }
      actor.setPosition(x,y);
      this.nameLabels.get(id)?.setPosition(x,y-48);
      const last=samples[samples.length-1],prev=samples[samples.length-2],moving=!!prev&&Math.hypot(last.x-prev.x,last.y-prev.y)>2&&now-last.time<450;
      const player=latest?.players.find(p=>p.id===id);
      if(moving){const dx=last.x-prev.x,dy=last.y-prev.y;actor.setFlipX(Math.abs(dx)>Math.abs(dy)&&dx<0);if(player?.alive){const key=Math.abs(dy)>Math.abs(dx)?(dy<0?'vh-walk-up':'vh-walk-down'):'vh-walk-down';if(actor.anims.currentAnim?.key!==key||!actor.anims.isPlaying)actor.play(key,true);}}
      else if(player?.alive&&actor.anims.isPlaying){actor.stop();actor.setTexture('walk_down_1');}
    }
    if(!latest||latest.phase!=='PLAYING'){this.stopMovement();return;}
    gameAudio.updateWorld(me.x,me.y);
    const local=latest.players.find(p=>p.id===myId);if(!local){joystick={x:0,y:0};this.stopMovement();return;}
    if(document.querySelector('#meet')?.childElementCount){joystick={x:0,y:0};this.stopMovement();return;}
    const k=this.keys;let x=joystick.x,y=joystick.y;
    if(k.W.isDown||this.cursors.up.isDown)y=-1;if(k.S.isDown||this.cursors.down.isDown)y=1;if(k.A.isDown||this.cursors.left.isDown)x=-1;if(k.D.isDown||this.cursors.right.isDown)x=1;
    let magnitude=Math.hypot(x,y);
    if(magnitude<.08){x=0;y=0;magnitude=0;}
    else if(magnitude>1){x/=magnitude;y/=magnitude;magnitude=1;}
    const actor=this.actors.get(myId);
    if(magnitude>0){
      gameAudio.updateWorld(me.x,me.y);
      const surface: 'carpet'|'wood'|'tile'|'metal' = me.y>2500&&me.x<2048?'metal':me.y>2500&&me.x<4096?'metal':me.x>2048&&me.x<4096&&me.y<2048?'wood':me.x>4096&&me.y<2048?'tile':'tile';
      gameAudio.step(time,surface);
      if(!this.moving){this.moving=true;this.moveSequence++;}
      // Same speed, analog scaling and collision sweep as server authority.
      const dt=Phaser.Math.Clamp(delta,0,60)/1000,speed=local.alive?370:250;
      const travel=speed*dt*Math.min(1,magnitude);
      const predicted=this.moveWithCollision(me.x,me.y,x/magnitude*travel,y/magnitude*travel);
      me.x=predicted.x;me.y=predicted.y;
      if(actor)actor.setPosition(me.x,me.y);
      if(local.alive&&actor){
        const walkKey=Math.abs(y)>Math.abs(x)?(y<0?'vh-walk-up':'vh-walk-down'):'vh-walk-down';
        actor.setFlipX(Math.abs(x)>Math.abs(y)&&x<0);
        if(actor.anims.currentAnim?.key!==walkKey||!actor.anims.isPlaying)actor.play(walkKey,true);
      }
      if(time-this.lastEmit>=50){
        const epoch=this.moveSequence,request=++this.movementRequestSequence;
        socket.emit('move',{x,y,epoch,requestId:request},(ack?:{ok?:boolean;x?:number;y?:number})=>{
          if(epoch!==this.moveSequence||!this.moving||request<=this.lastAppliedMovementAck||!ack?.ok||!Number.isFinite(ack.x)||!Number.isFinite(ack.y))return;
          this.lastAppliedMovementAck=request;serverMe.x=ack.x!;serverMe.y=ack.y!;
        });
        this.lastEmit=time;
      }
    }else{
      if(this.moving)this.stopMovement();
      // Only reconcile while idle, with elapsed-time smoothing.
      const correction=1-Math.exp(-Math.max(0,delta)/80);
      me.x+=(serverMe.x-me.x)*correction;me.y+=(serverMe.y-me.y)*correction;
      if(actor){actor.setPosition(me.x,me.y);if(local.alive){if(actor.anims.isPlaying)actor.stop();actor.setTexture('walk_down_1');}}
    }
    this.taskDots.clear();const openTasks=new Set<string>();for(const t of latest.tasks)if(!t.done){openTasks.add(t.id);let glow=this.taskGlows.get(t.id);if(!glow){glow=this.add.image(t.x,t.y,'task_console_glow').setScale(.2).setAlpha(.5).setDepth(3);this.taskGlows.set(t.id,glow);}else glow.setPosition(t.x,t.y);}
    for(const [id,glow] of this.taskGlows)if(!openTasks.has(id)){glow.destroy();this.taskGlows.delete(id);}
    const unreported=new Set<string>();for(const p of latest.players)if(!p.alive&&!p.reported){unreported.add(p.id);let corpse=this.corpseArt.get(p.id);if(!corpse){corpse=this.add.image(p.corpseX,p.corpseY,'corpse_chalk_outline').setScale(.19).setAlpha(.9).setDepth(9);this.corpseArt.set(p.id,corpse);}else corpse.setPosition(p.corpseX,p.corpseY).setDepth(9);}
    for(const [id,corpse] of this.corpseArt)if(!unreported.has(id)){corpse.destroy();this.corpseArt.delete(id);}
    this.debugGraphics.clear();if(k.C.isDown){const v=this.cameras.main.worldView;this.debugGraphics.fillStyle(0xffffff,.35);for(let yy=Math.floor(v.y/16)*16;yy<v.y+v.height;yy+=16)for(let xx=Math.floor(v.x/16)*16;xx<v.x+v.width;xx+=16)if(this.solid(xx+8,yy+8))this.debugGraphics.fillRect(xx,yy,16,16);}
  }
  shutdown(){this.stopMovement();this.nameLabels.forEach(label=>label.destroy());this.nameLabels.clear();this.game.events.off(Phaser.Core.Events.POST_RENDER,this.visionPostRender);this.visionCanvas?.remove();this.visionCanvas=undefined;this.visionContext=undefined;for(const [index,tile] of this.mapTiles){tile.destroy();this.textures.remove(`map${index+1}`);}this.mapTiles.clear();sceneRef=undefined;}
}

socket.on('connect',()=>{if(roomCode&&resumeKey)resumeSession();});
socket.on('state',(s:Snapshot)=>{if(!splashDismissed){pendingSnapshot=s;return;}renderState(s);});
socket.on('notice',(message:string)=>{toast(message);tone(340);});
socket.on('chat',(message:{name:string;text:string})=>{chatLines.push(`${message.name}: ${message.text}`);chatLines=chatLines.slice(-12);const el=document.querySelector('#chatlines');if(el)el.innerHTML=chatLines.slice(-6).map(escapeHtml).join('<br>');});
window.addEventListener('blur',()=>{joystick={x:0,y:0};sceneRef?.stopMovement(true);});
document.addEventListener('visibilitychange',()=>{if(document.hidden){joystick={x:0,y:0};sceneRef?.stopMovement(true);}});
socket.on('disconnect',()=>{joystick={x:0,y:0};sceneRef?.stopMovement(true);serverMe.x=me.x;serverMe.y=me.y;toast('Connection lost. Reconnecting…');});
socket.on('connect_error',()=>toast('Unable to connect to the game server.'));
new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#15141b',scale:{mode:Phaser.Scale.RESIZE,width:'100%',height:'100%'},render:{antialias:true,pixelArt:false,roundPixels:true},scene:[Estate],physics:{default:'arcade'}});
void showSplash();
