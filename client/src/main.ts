import Phaser from 'phaser';
import { io, type Socket } from 'socket.io-client';
import type { Snapshot, PublicPlayer, Task } from '../../shared/types';
import './style.css';

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
let lastFootstep = 0;
let joystick = { x: 0, y: 0 };
let me = { x: 3000, y: 2070 };
let chatLines: string[] = [];
let roleShown = false;
let sceneRef: Estate | undefined;
let audio: AudioContext | undefined;

const haptic = () => { try { tg?.HapticFeedback?.impactOccurred('light'); } catch { /* optional Telegram feature */ } };
const escapeHtml = (value: unknown) => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' }[c]!));
function show(html: string) { overlay.innerHTML = html; }
function tone(frequency = 440, duration = 0.08) {
  if (muted) return;
  try { audio ??= new AudioContext(); if (audio.state === 'suspended') void audio.resume(); const osc=audio.createOscillator(),gain=audio.createGain();osc.frequency.value=frequency;gain.gain.setValueAtTime(0.045,audio.currentTime);gain.gain.exponentialRampToValueAtTime(0.001,audio.currentTime+duration);osc.connect(gain);gain.connect(audio.destination);osc.start();osc.stop(audio.currentTime+duration); } catch { /* audio is an enhancement */ }
}
function playerName() {
  const name = (document.querySelector<HTMLInputElement>('#alias')?.value || 'Player').trim().slice(0,20) || 'Player';
  localStorage.setItem('vh-name', name); groqKey = document.querySelector<HTMLInputElement>('#groq-key')?.value.trim() || ''; return name;
}
function sendAiKey() { if (groqKey) socket.emit('ai:key', groqKey); }
function rememberSession(r:{code:string;playerId:string;sessionKey:string}){roomCode=r.code;myId=r.playerId;resumeKey=r.sessionKey;sessionStorage.setItem('vh-room-code',roomCode);sessionStorage.setItem('vh-player-id',myId);sessionStorage.setItem('vh-session-key',resumeKey);}
function clearSession(){roomCode='';myId='';resumeKey='';sessionStorage.removeItem('vh-room-code');sessionStorage.removeItem('vh-player-id');sessionStorage.removeItem('vh-session-key');socket.emit('leave');}
function resumeSession(){if(!roomCode||!resumeKey)return;socket.emit('resume',{code:roomCode,sessionKey:resumeKey},(r:{ok:boolean;code:string;playerId:string;sessionKey:string;error?:string})=>{if(r.ok){rememberSession(r);sendAiKey();}else{clearSession();menu();toast(r.error||'Previous session expired.');}});}
function menu() {
  currentPhase='MENU'; currentMeetingEnds=0;
  show(`<main class="menu"><header class="menu-head"><div class="brand">VICE <span>HEIST</span></div><span class="menu-location">Ocean Drive · Miami</span></header><p class="eyebrow">Private estate · Security briefing</p><h1>Get in.<br>Get out.<br><em>Trust no one.</em></h1><p class="sub">A crew, a hidden Mole, and one estate full of unfinished business. Work together. Watch everyone.</p><section class="menu-form"><label for="alias">Call sign</label><input id="alias" maxlength="20" placeholder="Your name" value="${escapeHtml(localStorage.getItem('vh-name') || '')}"><label class="keylabel" for="groq-key">AI dialogue key <span>Optional</span></label><input id="groq-key" type="password" autocomplete="off" placeholder="Groq API key"><small class="key-note">Used for optional in-game dialogue only</small></section><div class="menu-actions"><button class="primary" id="solo">Play solo <span>↗</span></button><button class="secondary" id="create">Create private room</button></div><div class="join"><input id="code" maxlength="5" placeholder="Room code" aria-label="Room code"><button id="join">Join room</button></div><p class="foot">Multiplayer · Solo vs AI · Telegram mini app</p></main>`);
  document.querySelector('#solo')!.addEventListener('click',()=>{haptic();tone(520);socket.emit('solo',{name:playerName(),initData:tg?.initData},(r:{ok:boolean;code:string;playerId:string;sessionKey:string;error?:string})=>{if(r.ok){rememberSession(r);sendAiKey();}else alert(r.error||'Unable to start solo game.');});});
  document.querySelector('#create')!.addEventListener('click',()=>{haptic();tone(520);socket.emit('create',{name:playerName(),initData:tg?.initData},(r:{ok:boolean;code:string;playerId:string;sessionKey:string;error?:string})=>{if(r.ok){rememberSession(r);sendAiKey();}else alert(r.error||'Unable to create room.');});});
  document.querySelector('#join')!.addEventListener('click',()=>{haptic();const code=document.querySelector<HTMLInputElement>('#code')!.value.toUpperCase().trim();socket.emit('join',{code,name:playerName(),initData:tg?.initData},(r:{ok:boolean;code:string;playerId:string;sessionKey:string;error?:string})=>{if(r.ok){rememberSession(r);sendAiKey();}else alert(r.error||'Unable to join room.');});});
}
function lobby(s: Snapshot) {
  currentPhase='LOBBY';
  show(`<div class="lobby"><div class="topline">VICE HEIST <span>ROOM ${escapeHtml(s.code)}</span></div><h2>Assemble your crew.</h2><div id="players" class="players"></div><p class="muted" id="lobby-hint"></p><button id="start" class="primary">START HEIST</button><button id="copy" class="secondary">COPY ROOM CODE</button><button id="back" class="textbtn">LEAVE ROOM</button></div>`);
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
  show(`<div class="hud"><div class="hudtop"><b>VICE HEIST</b><span>OCEAN DRIVE ESTATE</span><button id="sound" aria-label="Toggle sound">♫</button></div><div class="objective" id="objective">Complete the estate jobs. Find the Mole.</div><div class="controls"><div id="stick" class="stick" aria-label="Movement joystick"><div id="knob" class="knob"></div></div><div class="actions"><button id="use">USE</button><button id="report">REPORT</button><button id="emergency">EMERGENCY</button><button id="kill" class="danger">ELIMINATE</button><button id="sabotage" class="danger">LIGHTS</button></div></div><div class="toast" id="toast"></div><div class="meet" id="meet"></div></div>`);
  wireControls(); updateHud(latest);
}
function wireControls() {
  const stick=document.querySelector<HTMLElement>('#stick')!,knob=document.querySelector<HTMLElement>('#knob')!;let active=false;
  const move=(e:PointerEvent)=>{const r=stick.getBoundingClientRect();let dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,d=Math.hypot(dx,dy),max=43;if(d>max){dx=dx/d*max;dy=dy/d*max;}joystick={x:dx/max,y:dy/max};knob.style.transform=`translate(${dx}px,${dy}px)`;};
  stick.addEventListener('pointerdown',e=>{active=true;stick.setPointerCapture(e.pointerId);move(e);});stick.addEventListener('pointermove',e=>{if(active)move(e);});
  const stop=()=>{active=false;joystick={x:0,y:0};knob.style.transform='translate(0,0)';};stick.addEventListener('pointerup',stop);stick.addEventListener('pointercancel',stop);stick.addEventListener('lostpointercapture',stop);
  document.querySelector('#use')!.addEventListener('click',()=>{const t=nearestTask();if(t)openTask(t);else toast('Move closer to an unfinished task.');haptic();});
  document.querySelector('#report')!.addEventListener('click',()=>{const b=nearestBody();if(b){socket.emit('report',b.id);tone(300);}else toast('No body nearby to report.');haptic();});
  document.querySelector('#emergency')!.addEventListener('click',()=>{socket.emit('emergency');tone(300);haptic();});
  document.querySelector('#kill')!.addEventListener('click',()=>{const p=nearestTarget();if(p){socket.emit('kill',p.id);tone(160);}else toast('No target in elimination range.');haptic();});
  document.querySelector('#sabotage')!.addEventListener('click',()=>{socket.emit('sabotage','lights');tone(220);haptic();});
  document.querySelector('#sound')!.addEventListener('click',()=>{muted=!muted;document.querySelector('#sound')!.textContent=muted?'×':'♫';if(!muted)tone(520);});
}
function nearestTask(): Task | undefined { return latest?.tasks.filter(t=>!t.done).map(t=>({...t,d:Math.hypot(t.x-me.x,t.y-me.y)})).filter(t=>t.d<150).sort((a,b)=>a.d-b.d)[0]; }
function nearestBody(): PublicPlayer | undefined { return latest?.players.filter(p=>!p.alive&&!p.reported).map(p=>({...p,d:Math.hypot(p.x-me.x,p.y-me.y)})).filter(p=>p.d<180).sort((a,b)=>a.d-b.d)[0]; }
function nearestTarget(): PublicPlayer | undefined { return latest?.players.filter(p=>p.alive&&p.id!==myId).map(p=>({...p,d:Math.hypot(p.x-me.x,p.y-me.y)})).filter(p=>p.d<125).sort((a,b)=>a.d-b.d)[0]; }
function openTask(task: Task) {
  const m=document.querySelector<HTMLDivElement>('#meet');if(!m)return;
  m.innerHTML=`<div class="meetingbox taskbox"><p class="eyebrow">OCEAN DRIVE ESTATE · SECURE THE PROPERTY</p><h3>${escapeHtml(task.label)}</h3><p>Complete the operation to secure this estate objective.</p><div class="task-sequence">SYSTEM READY</div><button id="complete-task" class="primary">COMPLETE TASK</button><button id="cancel-task" class="textbtn">CANCEL</button></div>`;
  document.querySelector('#complete-task')!.addEventListener('click',()=>{socket.emit('use');m.innerHTML='';tone(760);haptic();});document.querySelector('#cancel-task')!.addEventListener('click',()=>m.innerHTML='');
}
function toast(message: string) { const el=document.querySelector('#toast');if(el)el.textContent=message; }
function renderMeeting(s: Snapshot) {
  const m=document.querySelector<HTMLDivElement>('#meet');if(!m||!s.meeting)return;currentMeetingEnds=s.meeting.endsAt;
  const votes=s.players.filter(p=>p.alive).map(p=>`<button data-vote="${escapeHtml(p.id)}">${escapeHtml(p.name)}</button>`).join('');
  m.innerHTML=`<div class="meetingbox"><div class="splash-mark">!</div><p class="eyebrow">EMERGENCY PROTOCOL</p><h3>${escapeHtml(s.meeting.reason)}</h3><p id="meeting-timer">Discuss and vote · ${Math.max(0,Math.ceil((s.meeting.endsAt-Date.now())/1000))}s</p><div class="votelist">${votes}<button data-vote="skip">SKIP</button></div><div id="chatlines" class="chatlines">${chatLines.slice(-6).map(escapeHtml).join('<br>')}</div><form id="chatform"><input id="chatinput" maxlength="180" placeholder="Message the crew"><button>SEND</button></form></div>`;
  m.querySelectorAll('[data-vote]').forEach(b=>b.addEventListener('click',()=>{socket.emit('vote',(b as HTMLElement).dataset.vote);tone(450);}));
  m.querySelector('#chatform')?.addEventListener('submit',e=>{e.preventDefault();const input=m.querySelector<HTMLInputElement>('#chatinput');if(input?.value.trim()){socket.emit('chat',input.value.trim());input.value='';}});
}
function updateHud(s: Snapshot | null) {
  if(!s||currentPhase!=='PLAYING')return;
  const done=s.tasks.filter(t=>t.done).length;const objective=document.querySelector('#objective');const local=s.players.find(p=>p.id===myId);
  if(objective)objective.textContent=local?.alive?`${done}/${s.taskTotal} estate jobs secured · ${s.selfRole==='MOLE'?'You are the Mole':'Find the Mole'}`:'YOU ARE DOWN · SPECTATING';
  const kill=document.querySelector<HTMLButtonElement>('#kill'),sab=document.querySelector<HTMLButtonElement>('#sabotage');
  if(kill){kill.style.display=s.selfRole==='MOLE'?'block':'none';const left=Math.max(0,Math.ceil((s.selfCooldownUntil-Date.now())/1000));kill.disabled=!local?.alive||left>0;kill.textContent=left>0?`ELIM ${left}s`:'ELIMINATE';}
  if(sab){sab.style.display=s.selfRole==='MOLE'?'block':'none';const left=Math.max(0,Math.ceil(((s.sabotage?.endsAt||0)-Date.now())/1000));sab.disabled=!local?.alive||left>0;sab.textContent=left>0?`LIGHTS ${left}s`:'LIGHTS';}
  const report=document.querySelector<HTMLButtonElement>('#report');if(report)report.disabled=!local?.alive||!nearestBody();
  const emergency=document.querySelector<HTMLButtonElement>('#emergency');if(emergency){const left=Math.max(0,Math.ceil((s.emergencyCooldownUntil-Date.now())/1000));emergency.disabled=!local?.alive||s.selfEmergencyUsed||left>0;emergency.textContent=s.selfEmergencyUsed?'USED':left>0?`CALL ${left}s`:'EMERGENCY';}
  const use=document.querySelector<HTMLButtonElement>('#use');if(use)use.disabled=!local?.alive||s.selfRole==='MOLE'||!nearestTask();
}
function renderState(s: Snapshot) {
  const prev=currentPhase;latest=s;const local=s.players.find(p=>p.id===myId);
  if(local){const d=Math.hypot(local.x-me.x,local.y-me.y);if(d>120){me.x=local.x;me.y=local.y;}else{me.x+=(local.x-me.x)*0.22;me.y+=(local.y-me.y)*0.22;}}
  sceneRef?.syncState(s);
  if(s.phase==='LOBBY'){if(currentPhase!=='LOBBY')lobby(s);else updateLobby(s);}
  else if(s.phase==='PLAYING'){
    if(currentPhase!=='PLAYING'){hud();if(!roleShown){roleShown=true;const role=s.selfRole==='MOLE'?'MOLE':'CREW';const m=document.querySelector<HTMLDivElement>('#meet');if(m)m.innerHTML=`<div class="meetingbox role-reveal"><p class="eyebrow">YOUR SECRET ROLE</p><h2>${role}</h2><p>${role==='MOLE'?'Eliminate the crew and sabotage the estate.':'Complete the estate jobs and identify the Mole.'}</p><button id="role-ok" class="primary">UNDERSTOOD</button></div>`;document.querySelector('#role-ok')?.addEventListener('click',()=>{const x=document.querySelector('#meet');if(x)x.innerHTML='';});tone(650,0.16);}}
    currentPhase='PLAYING';updateHud(s);
  } else if(s.phase==='MEETING'){
    if(currentPhase!=='PLAYING'&&currentPhase!=='MEETING')hud();
    if(currentPhase!=='MEETING'||currentMeetingEnds!==s.meeting?.endsAt){renderMeeting(s);tone(260,0.25);}currentPhase='MEETING';
    const timer=document.querySelector('#meeting-timer');if(timer&&s.meeting)timer.textContent=`Discuss and vote · ${Math.max(0,Math.ceil((s.meeting.endsAt-Date.now())/1000))}s`;
  } else if(s.phase==='GAME_OVER'){
    if(currentPhase!=='GAME_OVER'){currentPhase='GAME_OVER';show(`<div class="meetingbox gameover"><p class="eyebrow">OCEAN DRIVE ESTATE</p><h2>${s.winner==='CREW'?'CREW ESCAPED':'MOLES TOOK THE ESTATE'}</h2><p>The heist is over.</p><button id="again" class="primary">RETURN TO MAIN MENU</button></div>`);document.querySelector('#again')!.addEventListener('click',()=>{clearSession();socket.disconnect();location.reload();});tone(s.winner==='CREW'?740:130,0.4);}
  }
}

class Estate extends Phaser.Scene {
  private actors = new Map<string, Phaser.GameObjects.Sprite>();
  private keys!: any;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private ready = false; private lastEmit = 0;
  private taskDots!: Phaser.GameObjects.Graphics; private debugGraphics!: Phaser.GameObjects.Graphics;
  private masks: Uint8Array[] = []; private visionCanvas?: HTMLCanvasElement; private visionCtx?: CanvasRenderingContext2D; private lastVision = 0;
  constructor(){super('Estate');}
  preload(){
    for(let i=1;i<=8;i++){this.load.image(`map${i}`,`/assets/map/take-${i}.webp`);this.load.image(`mask${i}`,`/assets/map/mask-${i}.png`);}
    this.load.spritesheet('crew','/assets/characters/balaclava-sheet.webp',{frameWidth:512,frameHeight:512});
  }
  create(){
    this.cameras.main.setBounds(0,0,8192,4096);this.cameras.main.setZoom(Math.max(0.32,Math.min(innerWidth/950,innerHeight/560)*1.3));
    for(let i=0;i<8;i++)this.add.image((i%4)*2048+1024,Math.floor(i/4)*2048+1024,`map${i+1}`).setDepth(0);
    this.anims.create({key:'idle',frames:this.anims.generateFrameNumbers('crew',{start:0,end:3}),frameRate:2,repeat:-1});
    this.anims.create({key:'run',frames:this.anims.generateFrameNumbers('crew',{start:4,end:7}),frameRate:4,repeat:-1});
    this.anims.create({key:'down',frames:this.anims.generateFrameNumbers('crew',{start:12,end:15}),frameRate:3,repeat:0});
    this.taskDots=this.add.graphics().setDepth(4);this.debugGraphics=this.add.graphics().setDepth(30);
    this.keys=this.input.keyboard!.addKeys('W,A,S,D,C');this.cursors=this.input.keyboard!.createCursorKeys();
    this.loadMasks();this.ready=true;this.setupVision();this.scale.on('resize',()=>{this.resizeVision();this.cameras.main.setZoom(Math.max(0.32,Math.min(innerWidth/950,innerHeight/560)*1.3));});sceneRef=this;
    if(latest)this.syncState(latest);
  }
  private loadMasks(){
    for(let i=1;i<=8;i++){
      const image=this.textures.get(`mask${i}`).getSourceImage() as HTMLImageElement;
      const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;const ctx=canvas.getContext('2d',{willReadFrequently:true});
      if(!ctx||image.width!==2048||image.height!==2048){throw new Error(`Collision mask ${i} must be 2048 × 2048.`);}
      ctx.drawImage(image,0,0);const pixels=ctx.getImageData(0,0,2048,2048).data;const bits=new Uint8Array((2048*2048+7)>>3);
      for(let p=0,j=0;p<2048*2048;p++,j+=4)if(pixels[j]>200&&pixels[j+1]>200&&pixels[j+2]>200)bits[p>>3]|=1<<(p&7);
      this.masks.push(bits);canvas.width=1;canvas.height=1;this.textures.remove(`mask${i}`);
    }
  }
  private solid(x:number,y:number):boolean{
    if(x<0||y<0||x>=8192||y>=4096)return true;if(this.masks.length!==8)return true;
    const col=Math.floor(x/2048),row=Math.floor(y/2048),tile=this.masks[row*4+col];const p=(Math.floor(y)%2048)*2048+(Math.floor(x)%2048);return (tile[p>>3]&(1<<(p&7)))!==0;
  }
  private blocked(x:number,y:number,r=18):boolean{const d=r*.7071;return [[x-r,y],[x+r,y],[x,y-r],[x,y+r],[x-d,y-d],[x+d,y-d],[x-d,y+d],[x+d,y+d]].some(([a,b])=>this.solid(a,b));}
  syncState(s:Snapshot){
    const local=s.players.find(p=>p.id===myId);
    if(local){let a=this.actors.get(local.id);if(!a){const created=this.add.sprite(me.x,me.y,'crew',0).setOrigin(.5,.94).setDepth(10).setScale(.42);a=created;this.actors.set(local.id,created);this.cameras.main.startFollow(created,true,.12,.12);}if(a){
      a.setPosition(me.x,me.y);a.setTint(Phaser.Display.Color.HexStringToColor(local.color).color);a.setAlpha(local.alive?1:.4);if(!local.alive&&a.anims.currentAnim?.key!=='down')a.play('down',true);}
    }
    for(const p of s.players){if(p.id===myId)continue;let a=this.actors.get(p.id);if(!a){const created=this.add.sprite(p.x,p.y,'crew',0).setOrigin(.5,.94).setDepth(10).setScale(.42);created.setTint(Phaser.Display.Color.HexStringToColor(p.color).color);a=created;this.actors.set(p.id,created);}if(a){
      const moving=Math.hypot(a.x-p.x,a.y-p.y)>3;this.tweens.killTweensOf(a);this.tweens.add({targets:a,x:p.x,y:p.y,duration:220,ease:'Linear'});a.setFlipX(p.x<a.x);a.setAlpha(p.alive?1:.4);if(!p.alive){if(a.anims.currentAnim?.key!=='down')a.play('down',true);}else a.play(moving?'run':'idle',true);}
    }
    for(const [id,a] of this.actors)if(!s.players.some(p=>p.id===id)){a.destroy();this.actors.delete(id);}
  }
  private setupVision(){this.visionCanvas=document.createElement('canvas');this.visionCanvas.className='vision-layer';app.appendChild(this.visionCanvas);this.visionCtx=this.visionCanvas.getContext('2d')||undefined;this.resizeVision();}
  private resizeVision(){if(!this.visionCanvas)return;const dpr=Math.min(devicePixelRatio||1,2);this.visionCanvas.width=Math.max(1,Math.floor(innerWidth*dpr));this.visionCanvas.height=Math.max(1,Math.floor(innerHeight*dpr));this.visionCtx?.setTransform(dpr,0,0,dpr,0,0);}
  private drawVision(time:number){
    const ctx=this.visionCtx;if(!ctx||!this.visionCanvas)return;if(!latest||latest.phase!=='PLAYING'||this.keys?.C?.isDown){ctx.clearRect(0,0,innerWidth,innerHeight);return;}if(time-this.lastVision<140)return;this.lastVision=time;
    ctx.clearRect(0,0,innerWidth,innerHeight);ctx.fillStyle='rgba(5,7,13,.76)';ctx.fillRect(0,0,innerWidth,innerHeight);
    const mePlayer=latest.players.find(p=>p.id===myId);if(!mePlayer?.alive)return;
    const radius=latest.selfRole==='MOLE'?900:(latest.sabotage&&latest.sabotage.endsAt>Date.now()?310:690);const points:{x:number;y:number}[]=[];
    const rayCount=512,rayStep=2,cam=this.cameras.main;
    for(let i=0;i<rayCount;i++){
      const angle=i*Math.PI*2/rayCount,dx=Math.cos(angle),dy=Math.sin(angle);
      let clear=0,blocked=radius;
      for(let distance=rayStep;distance<=radius;distance+=rayStep){
        if(this.solid(me.x+dx*distance,me.y+dy*distance)){blocked=distance;clear=distance-rayStep;break;}
        clear=distance;
      }
      for(let refine=0;refine<7&&blocked>clear;refine++){
        const mid=(clear+blocked)*.5;
        if(this.solid(me.x+dx*mid,me.y+dy*mid))blocked=mid;else clear=mid;
      }
      const wx=me.x+dx*clear,wy=me.y+dy*clear;
      points.push({x:(wx-cam.scrollX)*cam.zoom+cam.x,y:(wy-cam.scrollY)*cam.zoom+cam.y});
    }
    const sx=(me.x-cam.scrollX)*cam.zoom+cam.x,sy=(me.y-cam.scrollY)*cam.zoom+cam.y;
    ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.moveTo(sx,sy);for(const p of points)ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fill();ctx.globalCompositeOperation='source-over';
  }
  update(time:number,delta:number){
    if(!this.ready)return;if(!latest||latest.phase!=='PLAYING'){this.drawVision(time);return;}
    const local=latest.players.find(p=>p.id===myId);if(!local?.alive){joystick={x:0,y:0};this.drawVision(time);return;}
    if(document.querySelector('#meet')?.childElementCount){joystick={x:0,y:0};this.drawVision(time);return;}
    const k=this.keys;let x=joystick.x,y=joystick.y;
    if(k.W.isDown||this.cursors.up.isDown)y=-1;if(k.S.isDown||this.cursors.down.isDown)y=1;if(k.A.isDown||this.cursors.left.isDown)x=-1;if(k.D.isDown||this.cursors.right.isDown)x=1;
    const len=Math.hypot(x,y)||1;
    if(x||y){const step=370*Math.min(delta/1000,.05),nx=me.x+x/len*step,ny=me.y+y/len*step;if(!this.blocked(nx,me.y))me.x=nx;if(!this.blocked(me.x,ny))me.y=ny;if(time-lastFootstep>320){tone(105,.035);lastFootstep=time;}
      const actor=this.actors.get(myId);if(actor){actor.setPosition(me.x,me.y);actor.setFlipX(x<0);actor.play('run',true);}if(time-this.lastEmit>50){socket.emit('move',{x,y});this.lastEmit=time;}
    }else this.actors.get(myId)?.play('idle',true);
    this.taskDots.clear();for(const t of latest.tasks)if(!t.done){this.taskDots.lineStyle(3,0xffd27b,.9);this.taskDots.strokeCircle(t.x,t.y,34);this.taskDots.fillStyle(0xffd27b,.9);this.taskDots.fillCircle(t.x,t.y,6);}
    for(const p of latest.players)if(!p.alive&&!p.reported){this.taskDots.lineStyle(5,0xff5555,1);this.taskDots.strokeCircle(p.x,p.y,27);this.taskDots.lineBetween(p.x-11,p.y-11,p.x+11,p.y+11);this.taskDots.lineBetween(p.x+11,p.y-11,p.x-11,p.y+11);}
    this.debugGraphics.clear();if(k.C.isDown){const v=this.cameras.main.worldView;this.debugGraphics.fillStyle(0xffffff,.35);for(let yy=Math.floor(v.y/16)*16;yy<v.y+v.height;yy+=16)for(let xx=Math.floor(v.x/16)*16;xx<v.x+v.width;xx+=16)if(this.solid(xx+8,yy+8))this.debugGraphics.fillRect(xx,yy,16,16);}
    this.drawVision(time);
  }
  shutdown(){this.visionCanvas?.remove();sceneRef=undefined;}
}

socket.on('connect',()=>{if(roomCode&&resumeKey)resumeSession();});
socket.on('state',(s:Snapshot)=>renderState(s));
socket.on('notice',(message:string)=>{toast(message);tone(340);});
socket.on('chat',(message:{name:string;text:string})=>{chatLines.push(`${message.name}: ${message.text}`);chatLines=chatLines.slice(-12);const el=document.querySelector('#chatlines');if(el)el.innerHTML=chatLines.slice(-6).map(escapeHtml).join('<br>');});
socket.on('disconnect',()=>toast('Connection lost. Reconnecting…'));
socket.on('connect_error',()=>toast('Unable to connect to the game server.'));
new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#15141b',scale:{mode:Phaser.Scale.RESIZE,width:'100%',height:'100%'},render:{antialias:true,pixelArt:false},scene:[Estate],physics:{default:'arcade'}});
menu();
