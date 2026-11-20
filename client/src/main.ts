import Phaser from 'phaser';
import { io, type Socket } from 'socket.io-client';
import './style.css';

declare global {
  interface Window { Telegram?: { WebApp?: { initData?:string; ready:()=>void; expand:()=>void; HapticFeedback?:{impactOccurred:(s:string)=>void} } } }
}
type PublicPlayer={id:string;name:string;color:string;x:number;y:number;alive:boolean;bot:boolean;tasks:number};
type GameState={code:string;phase:'LOBBY'|'PLAYING'|'MEETING'|'GAME_OVER';players:PublicPlayer[];selfRole?:'CREW'|'MOLE';tasks:{id:string;label:string;x:number;y:number;done:boolean;zone:number}[];taskTotal:number;bodies:{id:string;name:string;x:number;y:number;reported:boolean}[];meeting?:{reason:string;votes:Record<string,string>;endsAt:number};winner?:'CREW'|'MOLE';sabotage?:{kind:string;endsAt:number};emergencyCooldownUntil:number};
const tg=window.Telegram?.WebApp;tg?.ready();tg?.expand();
const socket:Socket=io({transports:['websocket','polling'],reconnection:true});
const overlay=document.querySelector<HTMLDivElement>('#overlay')!;
let state:GameState|null=null,roomCode='',joystick={x:0,y:0},self={x:3000,y:2070},muted=false,phase='MENU',chatLines:string[]=[];
let syncScene:((s:GameState)=>void)|undefined;
const buzz=()=>{try{tg?.HapticFeedback?.impactOccurred('light')}catch{}};
const esc=(s:string)=>String(s).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
function show(html:string){overlay.innerHTML=html;}
function playerName(){const n=(document.querySelector<HTMLInputElement>('#alias')?.value||'Player').trim().slice(0,20)||'Player';localStorage.setItem('vh-name',n);return n;}
function menu(){
  phase='MENU';
  show(`<main class="menu"><div class="brand">VICE <span>HEIST</span></div><p class="eyebrow">OCEAN DRIVE ESTATE · PRIVATE SECURITY NETWORK</p><h1>Trust is the<br><em>most expensive</em><br>thing here.</h1><p class="sub">A social deduction heist. Find the crew, finish the job, and get out alive.</p><label>Your alias<input id="alias" maxlength="20" placeholder="Enter your name" value="${esc(localStorage.getItem('vh-name')||'')}"></label><button class="primary" id="solo">PLAY SOLO · VS AI</button><button class="secondary" id="create">CREATE PRIVATE ROOM</button><div class="join"><input id="code" maxlength="5" placeholder="ROOM CODE"><button id="join">JOIN</button></div><p class="foot">MULTIPLAYER · SINGLE PLAYER · TELEGRAM MINI APP</p></main>`);
  document.querySelector('#solo')!.addEventListener('click',()=>{buzz();socket.emit('solo',{name:playerName(),initData:tg?.initData},(r:any)=>r.ok?enter(r.code):alert(r.error));});
  document.querySelector('#create')!.addEventListener('click',()=>{buzz();socket.emit('create',{name:playerName(),initData:tg?.initData},(r:any)=>r.ok?enter(r.code):alert(r.error));});
  document.querySelector('#join')!.addEventListener('click',()=>{buzz();const code=document.querySelector<HTMLInputElement>('#code')!.value.toUpperCase().trim();socket.emit('join',{code,name:playerName(),initData:tg?.initData},(r:any)=>r.ok?enter(r.code):alert(r.error));});
}
function enter(code:string){
  roomCode=code;phase='LOBBY';
  show(`<div class="lobby"><div class="topline">VICE HEIST <span>ROOM ${code}</span></div><h2>Assemble your crew.</h2><div id="players" class="players"></div><p class="muted" id="lobby-hint">Invite friends with room code ${code}</p><button id="start" class="primary">START HEIST</button><button id="copy" class="secondary">COPY ROOM CODE</button><button id="back" class="textbtn">LEAVE ROOM</button></div>`);
  document.querySelector('#start')!.addEventListener('click',()=>socket.emit('start'));
  document.querySelector('#copy')!.addEventListener('click',()=>navigator.clipboard?.writeText(code));
  document.querySelector('#back')!.addEventListener('click',()=>{socket.disconnect();location.reload();});
}
function hud(){
  phase='PLAYING';
  show(`<div class="hud"><div class="hudtop"><b>VICE HEIST</b><span>OCEAN DRIVE ESTATE</span><button id="sound" aria-label="Mute sound">♫</button></div><div class="objective" id="objective">Complete tasks. Find the Mole.</div><div class="controls"><div id="stick" class="stick"><div id="knob" class="knob"></div></div><div class="actions"><button id="use">USE</button><button id="report">REPORT</button><button id="emergency">EMERGENCY</button><button id="kill" class="danger">ELIMINATE</button><button id="sabotage" class="danger">LIGHTS</button></div></div><div id="toast" class="toast"></div><div id="meet" class="meet"></div></div>`);
  wireControls();
}
function wireControls(){
  const stick=document.querySelector<HTMLElement>('#stick')!,knob=document.querySelector<HTMLElement>('#knob')!;let active=false;
  const update=(e:PointerEvent)=>{const r=stick.getBoundingClientRect();let dx=e.clientX-r.left-r.width/2,dy=e.clientY-r.top-r.height/2,d=Math.hypot(dx,dy),max=43;if(d>max){dx=dx/d*max;dy=dy/d*max;}joystick={x:dx/max,y:dy/max};knob.style.transform=`translate(${dx}px,${dy}px)`;};
  stick.addEventListener('pointerdown',e=>{active=true;stick.setPointerCapture(e.pointerId);update(e);});
  stick.addEventListener('pointermove',e=>{if(active)update(e);});
  const stop=()=>{active=false;joystick={x:0,y:0};knob.style.transform='translate(0,0)';};
  stick.addEventListener('pointerup',stop);stick.addEventListener('pointercancel',stop);stick.addEventListener('lostpointercapture',stop);
  document.querySelector('#use')!.addEventListener('click',()=>{const t=nearestTask();if(t)openTask(t);else toast('Move closer to an unfinished task.');buzz();});
  document.querySelector('#report')!.addEventListener('click',()=>{const b=nearestBody();if(b){socket.emit('report',b.id);buzz();}else toast('No unreported body nearby.');});
  document.querySelector('#emergency')!.addEventListener('click',()=>{socket.emit('emergency');buzz();});
  document.querySelector('#kill')!.addEventListener('click',()=>{const p=nearestTarget();if(p){socket.emit('kill',p.id);buzz();}else toast('No target in elimination range.');});
  document.querySelector('#sabotage')!.addEventListener('click',()=>{socket.emit('sabotage','lights');buzz();});
  document.querySelector('#sound')!.addEventListener('click',()=>{muted=!muted;document.querySelector('#sound')!.textContent=muted?'×':'♫';});
}
function nearestTask(){if(!state)return undefined;return state.tasks.filter(t=>!t.done).map(t=>({...t,d:Math.hypot(t.x-self.x,t.y-self.y)})).sort((a,b)=>a.d-b.d)[0]?.d<140?state.tasks.filter(t=>!t.done).sort((a,b)=>Math.hypot(a.x-self.x,a.y-self.y)-Math.hypot(b.x-self.x,b.y-self.y))[0]:undefined;}
function nearestBody(){return state?.bodies.filter(b=>!b.reported).map(b=>({...b,d:Math.hypot(b.x-self.x,b.y-self.y)})).filter(b=>b.d<180).sort((a,b)=>a.d-b.d)[0];}
function nearestTarget(){return state?.players.filter(p=>p.alive&&p.id!==socket.id).map(p=>({...p,d:Math.hypot(p.x-self.x,p.y-self.y)})).filter(p=>p.d<125).sort((a,b)=>a.d-b.d)[0];}
function openTask(t:{id:string;label:string}){
  const m=document.querySelector<HTMLDivElement>('#meet');if(!m)return;
  m.innerHTML=`<div class="meetingbox taskbox"><p class="eyebrow">OCEAN DRIVE ESTATE · SECURE THE PROPERTY</p><h3>${esc(t.label)}</h3><p>Complete the operation to secure this estate objective.</p><div class="task-sequence" id="sequence">READY</div><button id="complete-task" class="primary">COMPLETE TASK</button><button id="cancel-task" class="textbtn">CANCEL</button></div>`;
  document.querySelector('#complete-task')!.addEventListener('click',()=>{socket.emit('task:complete',t.id);m.innerHTML='';buzz();});
  document.querySelector('#cancel-task')!.addEventListener('click',()=>m.innerHTML='');
}
function toast(text:string){const el=document.querySelector('#toast');if(el)el.textContent=text;}
function renderMeeting(s:GameState){
  const m=document.querySelector<HTMLDivElement>('#meet');if(!m)return;
  const votes=s.players.filter(p=>p.alive).map(p=>`<button data-vote="${esc(p.id)}">${esc(p.name)}</button>`).join('');
  m.innerHTML=`<div class="meetingbox"><div class="splash-mark">!</div><p class="eyebrow">EMERGENCY PROTOCOL</p><h3>${esc(s.meeting?.reason||'Meeting')}</h3><p id="meeting-timer">Discuss and vote · ${Math.max(0,Math.ceil(((s.meeting?.endsAt||Date.now())-Date.now())/1000))}s</p><div class="votelist">${votes}<button data-vote="skip">SKIP</button></div><div id="chatlines" class="chatlines">${chatLines.slice(-6).map(esc).join('<br>')}</div><form id="chatform"><input id="chatinput" maxlength="180" placeholder="Message the crew"><button>SEND</button></form></div>`;
  m.querySelectorAll('[data-vote]').forEach(b=>b.addEventListener('click',()=>socket.emit('vote',(b as HTMLElement).dataset.vote)));
  m.querySelector('#chatform')?.addEventListener('submit',e=>{e.preventDefault();const i=m.querySelector<HTMLInputElement>('#chatinput');if(i?.value.trim()){socket.emit('chat',i.value.trim());i.value='';}});
}
function updateMeetingTimer(s:GameState){const t=document.querySelector('#meeting-timer');if(t&&s.meeting)t.textContent='Discuss and vote · '+Math.max(0,Math.ceil((s.meeting.endsAt-Date.now())/1000))+'s';}
socket.on('state',(s:GameState)=>{
  const previous=state?.phase;state=s;syncScene?.(s);
  const local=s.players.find(p=>p.id===socket.id);
  if(local){const delta=Math.hypot(local.x-self.x,local.y-self.y);if(delta>60){self.x=local.x;self.y=local.y;}else{self.x+=(local.x-self.x)*.18;self.y+=(local.y-self.y)*.18;}}
  if(s.phase==='LOBBY'){
    if(phase!=='LOBBY')enter(s.code);
    const list=document.querySelector('#players');if(list)list.innerHTML=s.players.map(p=>`<div class="playerrow"><i style="background:${p.color}"></i>${esc(p.name)} ${p.bot?'<small>AI</small>':''}</div>`).join('');
    const hint=document.querySelector('#lobby-hint');if(hint)hint.textContent=s.players.length+' players · share code '+s.code;
  } else if(s.phase==='PLAYING'){
    if(phase!=='PLAYING')hud();
    const o=document.querySelector('#objective');if(o)o.textContent=s.tasks.filter(t=>t.done).length+'/'+s.taskTotal+' estate jobs secured · '+(s.selfRole==='MOLE'?'You are the Mole':'Find the Mole');
    const kill=document.querySelector<HTMLButtonElement>('#kill'),sab=document.querySelector<HTMLButtonElement>('#sabotage');if(kill)kill.style.display=s.selfRole==='MOLE'?'block':'none';if(sab)sab.style.display=s.selfRole==='MOLE'?'block':'none';
    const report=document.querySelector<HTMLButtonElement>('#report');if(report)report.disabled=!nearestBody();
    const meet=document.querySelector('#meet');if(meet)meet.innerHTML='';
  } else if(s.phase==='MEETING'){
    if(previous!=='MEETING'||phase!=='MEETING')renderMeeting(s);else updateMeetingTimer(s);
  } else if(s.phase==='GAME_OVER'){
    if(phase!=='GAME_OVER')show(`<div class="meetingbox gameover"><p class="eyebrow">OCEAN DRIVE ESTATE</p><h2>${s.winner==='CREW'?'CREW ESCAPED':'MOLES TOOK THE ESTATE'}</h2><p>The heist is over.</p><button id="again" class="primary">RETURN TO MAIN MENU</button></div>`);
    document.querySelector('#again')?.addEventListener('click',()=>location.reload());
  }
  phase=s.phase;
});
socket.on('notice',toast);
socket.on('chat',(m:{name:string;text:string})=>{chatLines.push(m.name+': '+m.text);chatLines=chatLines.slice(-12);const el=document.querySelector('#chatlines');if(el)el.innerHTML=chatLines.slice(-6).map(esc).join('<br>');});
socket.on('connect',()=>{const el=document.querySelector('#toast');if(el)el.textContent='';});
socket.on('disconnect',()=>toast('Connection lost. Reconnecting…'));
socket.on('connect_error',()=>toast('Unable to connect to game server.'));
class Estate extends Phaser.Scene {
  private actors=new Map<string,Phaser.GameObjects.Sprite>();private keys!:any;private debugGraphics!:Phaser.GameObjects.Graphics;private cursors!:any;private ready=false;private lastEmit=0;private taskDots!:Phaser.GameObjects.Graphics;
  private maskData:Uint8Array[]=[];private maskReady=false;private visionCanvas?:HTMLCanvasElement;private visionCtx?:CanvasRenderingContext2D;private lastVision=0;
  constructor(){super('Estate');}
  preload(){
    for(let i=1;i<=8;i++)this.load.image('map'+i,'/assets/map/take-'+i+'.webp');
    this.load.spritesheet('crew','/assets/characters/balaclava-sheet.webp',{frameWidth:512,frameHeight:512});
  }
  async create(){
    this.cameras.main.setBounds(0,0,8192,4096);this.cameras.main.setZoom(Math.min(innerWidth/950,innerHeight/560)*1.3);
    for(let i=0;i<8;i++){const x=(i%4)*2048+1024,y=Math.floor(i/4)*2048+1024;this.add.image(x,y,'map'+(i+1)).setDepth(0);}
    this.anims.create({key:'idle',frames:this.anims.generateFrameNumbers('crew',{start:0,end:3}),frameRate:5,repeat:-1});
    this.anims.create({key:'run',frames:this.anims.generateFrameNumbers('crew',{start:4,end:7}),frameRate:11,repeat:-1});
    this.anims.create({key:'down',frames:this.anims.generateFrameNumbers('crew',{start:12,end:15}),frameRate:5,repeat:0});
    this.taskDots=this.add.graphics().setDepth(4);this.debugGraphics=this.add.graphics().setDepth(50);this.keys=this.input.keyboard!.addKeys('W,A,S,D,C');this.cursors=this.input.keyboard!.createCursorKeys();
    await this.loadCollisionMasks();this.ready=true;this.setupVisionCanvas();
    this.scale.on('resize',()=>this.resizeVisionCanvas());syncScene=(s)=>this.syncState(s);if(state)this.syncState(state);
  }
  private async loadCollisionMasks(){
    const canvas=document.createElement('canvas');canvas.width=2048;canvas.height=2048;
    const ctx=canvas.getContext('2d',{willReadFrequently:true});if(!ctx)throw new Error('Canvas collision reader unavailable');
    for(let i=1;i<=8;i++){
      const img=new Image();img.src='/assets/map/mask-'+i+'.png';await new Promise<void>((resolve,reject)=>{img.onload=()=>resolve();img.onerror=()=>reject(new Error('Failed to load collision mask '+i));});
      ctx.clearRect(0,0,2048,2048);ctx.drawImage(img,0,0,2048,2048);
      const rgba=ctx.getImageData(0,0,2048,2048).data,oneBit=new Uint8Array(2048*2048);
      for(let p=0,j=0;p<oneBit.length;p++,j+=4)oneBit[p]=rgba[j]>200?1:0;
      this.maskData.push(oneBit);
    }
    this.maskReady=true;
  }
  private solid(x:number,y:number):boolean{
    if(!this.maskReady&&!this.maskData.length)return true;
    if(x<0||y<0||x>=8192||y>=4096)return true;
    const col=Math.floor(x/2048),row=Math.floor(y/2048),tile=this.maskData[row*4+col];
    return !tile||tile[Math.floor(y%2048)*2048+Math.floor(x%2048)]===1;
  }
  private blocked(x:number,y:number,r=18):boolean{
    const d=r*.7071;return [[x-r,y],[x+r,y],[x,y-r],[x,y+r],[x-d,y-d],[x+d,y-d],[x-d,y+d],[x+d,y+d]].some(([a,b])=>this.solid(a,b));
  }
  syncState(s:GameState){
    const mine=s.players.find(p=>p.id===socket.id);
    if(mine){const diff=Math.hypot(mine.x-self.x,mine.y-self.y);if(diff>60){self.x=mine.x;self.y=mine.y;}else{self.x+=(mine.x-self.x)*.18;self.y+=(mine.y-self.y)*.18;}
      let a=this.actors.get(mine.id);if(!a){a=this.add.sprite(mine.x,mine.y,'crew',0).setDepth(10).setScale(.22);this.actors.set(mine.id,a);this.cameras.main.startFollow(a,true,.12,.12);}a.setTint(Phaser.Display.Color.HexStringToColor(mine.color).color);a.setAlpha(mine.alive?1:.4);if(!mine.alive)a.play('down',true);else a.play('idle',true);}
    for(const p of s.players){if(p.id===socket.id)continue;let a=this.actors.get(p.id);if(!a){a=this.add.sprite(p.x,p.y,'crew',0).setDepth(10).setScale(.22);a.setTint(Phaser.Display.Color.HexStringToColor(p.color).color);this.actors.set(p.id,a);}this.tweens.add({targets:a,x:p.x,y:p.y,duration:180,ease:'Linear'});a.setAlpha(p.alive?1:.4);if(!p.alive)a.play('down',true);}
    for(const [id,a] of this.actors)if(!s.players.some(p=>p.id===id)){a.destroy();this.actors.delete(id);}
  }
  private setupVisionCanvas(){
    this.visionCanvas=document.createElement('canvas');this.visionCanvas.className='vision-layer';this.visionCanvas.style.position='absolute';this.visionCanvas.style.inset='0';this.visionCanvas.style.width='100%';this.visionCanvas.style.height='100%';this.visionCanvas.style.pointerEvents='none';this.visionCanvas.style.zIndex='3';
    this.game.canvas.parentElement?.appendChild(this.visionCanvas);this.visionCtx=this.visionCanvas.getContext('2d');this.resizeVisionCanvas();
  }
  private resizeVisionCanvas(){if(!this.visionCanvas)return;const dpr=Math.min(window.devicePixelRatio||1,2);this.visionCanvas.width=Math.max(1,Math.floor(innerWidth*dpr));this.visionCanvas.height=Math.max(1,Math.floor(innerHeight*dpr));this.visionCtx?.setTransform(dpr,0,0,dpr,0,0);}
  private drawVision(time:number){
    if(!this.visionCtx||!this.visionCanvas||!state||state.phase!=='PLAYING'||!this.maskData.length)return;
    if(time-this.lastVision<140)return;this.lastVision=time;
    const ctx=this.visionCtx,w=innerWidth,h=innerHeight,cam=this.cameras.main;
    ctx.clearRect(0,0,w,h);ctx.fillStyle='rgba(5,7,13,.82)';ctx.fillRect(0,0,w,h);
    const radius=state.sabotage&&state.sabotage.endsAt>Date.now()?380:850;
    const points:{x:number;y:number}[]=[];
    for(let i=0;i<180;i++){
      const angle=i*Math.PI*2/180;let dist=0,x=self.x,y=self.y;
      for(let d=0;d<=radius;d+=12){x=self.x+Math.cos(angle)*d;y=self.y+Math.sin(angle)*d;if(this.solid(x,y))break;dist=d;}
      const wx=self.x+Math.cos(angle)*dist,wy=self.y+Math.sin(angle)*dist;
      points.push({x:cam.x+(wx-cam.scrollX)*cam.zoom,y:cam.y+(wy-cam.scrollY)*cam.zoom});
    }
    const sx=cam.x+(self.x-cam.scrollX)*cam.zoom,sy=cam.y+(self.y-cam.scrollY)*cam.zoom;
    ctx.globalCompositeOperation='destination-out';ctx.beginPath();ctx.moveTo(sx,sy);for(const p of points)ctx.lineTo(p.x,p.y);ctx.closePath();ctx.fill();ctx.globalCompositeOperation='source-over';
  }
  update(time:number){
    if(!this.ready||!state||state.phase!=='PLAYING') {if(this.visionCtx)this.visionCtx.clearRect(0,0,innerWidth,innerHeight);return;}
    let x=joystick.x,y=joystick.y,k=this.keys;
    if(k.W.isDown||this.cursors.up.isDown)y=-1;if(k.S.isDown||this.cursors.down.isDown)y=1;if(k.A.isDown||this.cursors.left.isDown)x=-1;if(k.D.isDown||this.cursors.right.isDown)x=1;
    const len=Math.hypot(x,y)||1;
    if(x||y){
      const step=235*Math.min(this.game.loop.delta/1000,.05),nx=self.x+x/len*step,ny=self.y+y/len*step;
      if(!this.blocked(nx,self.y))self.x=nx;if(!this.blocked(self.x,ny))self.y=ny;
      const actor=this.actors.get(socket.id||'');if(actor){actor.setPosition(self.x,self.y);actor.setFlipX(x<0);actor.play('run',true);}
      if(time-this.lastEmit>45){socket.emit('move',{x,y});this.lastEmit=time;}
    }else this.actors.get(socket.id||'')?.play('idle',true);
    this.taskDots.clear();
    for(const t of state.tasks)if(!t.done){this.taskDots.lineStyle(3,0xffd27b,.9);this.taskDots.strokeCircle(t.x,t.y,34);this.taskDots.fillStyle(0xffd27b,.9);this.taskDots.fillCircle(t.x,t.y,6);}
    if(k.C.isDown){this.taskDots.lineStyle(1,0xffffff,.5);this.taskDots.strokeRect(0,0,8192,4096);}
    this.drawVision(time);
  }
}
new Phaser.Game({type:Phaser.AUTO,parent:'game',backgroundColor:'#15141b',scale:{mode:Phaser.Scale.RESIZE,width:'100%',height:'100%'},render:{antialias:true,pixelArt:false},scene:[Estate],physics:{default:'arcade'}});
menu();
