import express from 'express';
import { createServer } from 'node:http';
import { Server, type Socket } from 'socket.io';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { PNG } from 'pngjs';
import type { Body, Player, PublicPlayer, Role, Snapshot, Task } from '../../shared/types.js';

const ROOT = process.cwd();
const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: process.env.ALLOWED_ORIGIN?.split(',') ?? true }, maxHttpBufferSize: 32_000 });
const webRoot = existsSync(path.join(ROOT, 'dist/client')) ? path.join(ROOT, 'dist/client') : path.join(ROOT, 'client');
app.disable('x-powered-by');
app.get('/health', (_req, res) => res.json({ ok: true, game: 'Vice Heist', version: '1.0.1' }));
app.use(express.static(webRoot, { etag: true, maxAge: '1h', index: false }));
app.get('*', (req, res, next) => req.path.startsWith('/socket.io') ? next() : res.sendFile(path.join(webRoot, 'index.html'), err => err && res.status(404).end()));

const maskPath = path.join(ROOT, 'client/public/assets/map/collision.png');
if (!existsSync(maskPath)) throw new Error('Required collision mask is missing: ' + maskPath);
const mask = PNG.sync.read(readFileSync(maskPath));
if (mask.width !== 8192 || mask.height !== 4096) throw new Error('Collision mask must be exactly 8192x4096.');
const pixels = mask.data;
function solid(x:number,y:number):boolean {
  if (x < 0 || y < 0 || x >= mask.width || y >= mask.height) return true;
  const i = (Math.floor(y) * mask.width + Math.floor(x)) * 4;
  return pixels[i] > 200 && pixels[i+1] > 200 && pixels[i+2] > 200;
}
function blocked(x:number,y:number,r=18):boolean {
  const d = r * .7071;
  return [[x-r,y],[x+r,y],[x,y-r],[x,y+r],[x-d,y-d],[x+d,y-d],[x-d,y+d],[x+d,y+d]].some(([a,b])=>solid(a,b));
}
const COLORS = ['#f45b5b','#54b7f2','#f0bd4b','#a98af5','#58c99b','#f18dc3','#e4e7ec','#e78b4e','#6dd4d0','#b6cf5b'];
const TASKS: Omit<Task,'done'>[] = [
  {id:'helipad',label:'Align beacon',x:780,y:300,zone:0},{id:'bar',label:'Mix VIP cocktail',x:2828,y:504,zone:1},
  {id:'vault',label:'Crack safe code',x:5200,y:560,zone:2},{id:'pool',label:'Balance pool pump',x:6600,y:500,zone:3},
  {id:'garage',label:'Diagnose engine',x:620,y:2840,zone:4},{id:'server',label:'Trace firewall',x:2750,y:2800,zone:5},
  {id:'generator',label:'Reset breakers',x:4900,y:2920,zone:6},{id:'dock',label:'Fuel speedboat',x:7072,y:2232,zone:7}
];
type Room = {
  code:string; phase:'LOBBY'|'PLAYING'|'MEETING'|'GAME_OVER'; players:Map<string,Player>;
  tasks:Task[]; bodies:Body[]; host:string; meeting?:{reason:string;votes:Record<string,string>;endsAt:number};
  winner?:'CREW'|'MOLE'; sabotage?:{kind:'lights';endsAt:number}; emergencyCooldownUntil:number;
};
const rooms = new Map<string,Room>();
const clamp=(n:number,min:number,max:number)=>Math.max(min,Math.min(max,n));
const roomCode=()=>{let code='';do{code=randomBytes(4).toString('hex').slice(0,5).toUpperCase()}while(rooms.has(code));return code;};
function telegramUser(raw?:string):{id?:number;first_name?:string;username?:string}|null {
  if(!raw || !BOT_TOKEN) return null;
  try {
    const p=new URLSearchParams(raw), hash=p.get('hash');
    if(!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
    p.delete('hash');
    const data=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');
    const secret=createHmac('sha256','WebAppData').update(BOT_TOKEN).digest();
    const calculated=createHmac('sha256',secret).update(data).digest('hex');
    if(!timingSafeEqual(Buffer.from(calculated,'hex'),Buffer.from(hash,'hex'))) return null;
    const authDate=Number(p.get('auth_date'));
    if(!Number.isFinite(authDate) || authDate>Date.now()/1000+60 || Date.now()/1000-authDate>86400) return null;
    const user=JSON.parse(p.get('user')||'{}');
    return user && typeof user.id==='number' ? user : null;
  } catch { return null; }
}
function playerName(name:string|undefined, initData:string|undefined):string {
  if(BOT_TOKEN) {
    const tg=telegramUser(initData);
    if(!tg) throw new Error('Telegram authentication failed. Open the game from its Telegram Mini App.');
    return String(tg.first_name||tg.username||'Player').replace(/[<>]/g,'').slice(0,20);
  }
  return String(name||'Player').replace(/[<>]/g,'').trim().slice(0,20)||'Player';
}
function publicPlayer(p:Player):PublicPlayer {
  const {role:_role,emergencyUsed:_emergencyUsed,...safe}=p;
  return safe;
}
function snapshot(r:Room,viewer:string):Snapshot {
  return {code:r.code,phase:r.phase,players:[...r.players.values()].map(publicPlayer),selfRole:r.players.get(viewer)?.role,
    tasks:r.tasks,bodies:r.bodies,taskTotal:r.tasks.length,meeting:r.meeting,winner:r.winner,sabotage:r.sabotage,
    emergencyCooldownUntil:r.emergencyCooldownUntil};
}
function emitRoom(r:Room):void {
  for(const p of r.players.values()) io.sockets.sockets.get(p.id)?.emit('state',snapshot(r,p.id));
}
function notice(r:Room,message:string):void { io.to(r.code).emit('notice',message); }
function createRoom(host:string):Room {
  const r:Room={code:roomCode(),phase:'LOBBY',players:new Map(),tasks:TASKS.map(t=>({...t,done:false})),bodies:[],host,emergencyCooldownUntil:0};
  rooms.set(r.code,r); return r;
}
function addBot(r:Room):void {
  const id='ai-'+randomBytes(5).toString('hex');
  const names=['Rico','Mia','Jax','Nova','Ace','Skye','Luca','Zee'];
  const n=r.players.size;
  r.players.set(id,{id,name:names[n%names.length],color:COLORS[n%COLORS.length],x:3000+(n%4)*30,y:2070+Math.floor(n/4)*30,
    alive:true,role:'CREW',bot:true,tasks:0,lastMove:Date.now(),cooldownUntil:0,emergencyUsed:false});
}
function startGame(r:Room):boolean {
  const list=[...r.players.values()]; if(list.length<2)return false;
  r.phase='PLAYING';r.winner=undefined;r.meeting=undefined;r.sabotage=undefined;r.bodies=[];
  r.tasks=TASKS.map(t=>({...t,done:false}));
  list.forEach((p,i)=>{p.alive=true;p.tasks=0;p.x=3000+(i%4)*30;p.y=2070+Math.floor(i/4)*30;p.cooldownUntil=0;p.emergencyUsed=false;p.role='CREW';});
  const moleCount=list.length>=8?2:1;
  for(const p of [...list].sort(()=>Math.random()-.5).slice(0,moleCount))p.role='MOLE';
  return true;
}
function nearestTask(r:Room,p:Player):Task|undefined {
  return r.tasks.filter(t=>!t.done).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0];
}
function finishIfNeeded(r:Room):void {
  const alive=[...r.players.values()].filter(p=>p.alive);
  const moles=alive.filter(p=>p.role==='MOLE').length, crew=alive.length-moles;
  if(moles===0 || r.tasks.every(t=>t.done)){r.phase='GAME_OVER';r.winner='CREW';}
  else if(moles>=crew){r.phase='GAME_OVER';r.winner='MOLE';}
}
function addBody(r:Room,p:Player):void { r.bodies.push({id:p.id,name:p.name,x:p.x,y:p.y,reported:false}); }
function beginMeeting(r:Room,reason:string):void {
  if(r.phase!=='PLAYING')return;
  r.phase='MEETING';r.meeting={reason,votes:{},endsAt:Date.now()+30_000};
  notice(r,reason);emitRoom(r);
}
function completeMeeting(r:Room):void {
  if(!r.meeting)return;
  const alive=[...r.players.values()].filter(p=>p.alive);
  for(const bot of alive.filter(p=>p.bot)) {
    if(r.meeting.votes[bot.id])continue;
    const candidates=alive.filter(p=>p.id!==bot.id);
    const target=candidates.find(p=>p.role==='MOLE' && Math.random()<.48) || candidates[Math.floor(Math.random()*Math.max(1,candidates.length))];
    r.meeting.votes[bot.id]=target?.id||'skip';
  }
  const counts=new Map<string,number>();
  for(const v of Object.values(r.meeting.votes))counts.set(v,(counts.get(v)||0)+1);
  const ranked=[...counts].sort((a,b)=>b[1]-a[1]);
  if(ranked[0]&&ranked[0][0]!=='skip'&&(!ranked[1]||ranked[0][1]>ranked[1][1])) {
    const ejected=r.players.get(ranked[0][0]);
    if(ejected&&ejected.alive){ejected.alive=false;addBody(r,ejected);notice(r,ejected.name+' was ejected. They were '+(ejected.role==='MOLE'?'a Mole.':'Crew.'));}
  }
  r.meeting=undefined;r.phase='PLAYING';finishIfNeeded(r);emitRoom(r);
}
function botsTick(r:Room,now:number):void {
  if(r.phase==='PLAYING') {
    const alive=[...r.players.values()].filter(p=>p.alive);
    for(const b of alive.filter(p=>p.bot)) {
      const target=b.role==='MOLE'?alive.find(p=>!p.bot&&p.role==='CREW'):nearestTask(r,b);
      if(target) {
        const dx=target.x-b.x,dy=target.y-b.y,d=Math.hypot(dx,dy)||1;
        const speed=12,angle=Math.atan2(dy,dx);
        const options=[angle,angle+.45,angle-.45,angle+1.1,angle-1.1,angle+Math.PI/2,angle-Math.PI/2];
        for(const a of options){const nx=b.x+Math.cos(a)*speed,ny=b.y+Math.sin(a)*speed;if(!blocked(nx,ny)){b.x=nx;b.y=ny;break;}}
      }
      if(b.role==='CREW') {
        const t=nearestTask(r,b);
        if(t&&Math.hypot(t.x-b.x,t.y-b.y)<115&&Math.random()<.035){t.done=true;b.tasks++;notice(r,b.name+' secured '+t.label+'.');}
      } else {
        const victim=alive.find(p=>p.role==='CREW'&&Math.hypot(p.x-b.x,p.y-b.y)<95);
        if(victim&&now>b.cooldownUntil&&Math.random()<.012){victim.alive=false;addBody(r,victim);b.cooldownUntil=now+18_000;notice(r,victim.name+' was eliminated.');finishIfNeeded(r);}
      }
    }
  }
  if(r.phase==='MEETING'&&r.meeting&&now>r.meeting.endsAt)completeMeeting(r);
}
function rateLimit(socket:Socket,event:string,interval:number):boolean {
  const s=socket.data.rates as Record<string,number>|undefined;
  const rates=s||(socket.data.rates={});
  const now=Date.now();if(now-(rates[event]||0)<interval)return false;rates[event]=now;return true;
}
type Ack=(value:{ok:boolean;code?:string;error?:string})=>void;
io.on('connection',(socket:Socket)=>{
  let room:Room|undefined,me:Player|undefined;
  const identity=(a:{name?:string;initData?:string})=>playerName(a.name,a.initData);
  socket.on('create',(a:{name?:string;initData?:string},ack:Ack=()=>{})=>{
    try{if(!rateLimit(socket,'create',1000))return;const name=identity(a||{});room=createRoom(socket.id);
      me={id:socket.id,name,color:COLORS[0],x:3000,y:2070,alive:true,role:'CREW',bot:false,tasks:0,lastMove:Date.now(),cooldownUntil:0,emergencyUsed:false};
      room.players.set(me.id,me);socket.join(room.code);ack({ok:true,code:room.code});emitRoom(room);
    }catch(e){ack({ok:false,error:e instanceof Error?e.message:'Unable to create room'});}
  });
  socket.on('solo',(a:{name?:string;initData?:string},ack:Ack=()=>{})=>{
    try{if(!rateLimit(socket,'solo',1000))return;const name=identity(a||{});room=createRoom(socket.id);for(let i=0;i<5;i++)addBot(room);
      me={id:socket.id,name,color:COLORS[5],x:3000,y:2070,alive:true,role:'CREW',bot:false,tasks:0,lastMove:Date.now(),cooldownUntil:0,emergencyUsed:false};
      room.players.set(me.id,me);socket.join(room.code);startGame(room);ack({ok:true,code:room.code});emitRoom(room);
    }catch(e){ack({ok:false,error:e instanceof Error?e.message:'Unable to start solo game'});}
  });
  socket.on('join',(a:{code:string;name?:string;initData?:string},ack:Ack=()=>{})=>{
    try{if(!rateLimit(socket,'join',1000))return;const name=identity(a||{});const r=rooms.get(String(a?.code||'').toUpperCase());
      if(!r||r.phase!=='LOBBY'||r.players.size>=10){ack({ok:false,error:'Room unavailable or full'});return;}
      room=r;me={id:socket.id,name,color:COLORS[r.players.size%COLORS.length],x:3000+(r.players.size%4)*30,y:2070+Math.floor(r.players.size/4)*30,
        alive:true,role:'CREW',bot:false,tasks:0,lastMove:Date.now(),cooldownUntil:0,emergencyUsed:false};
      r.players.set(me.id,me);socket.join(r.code);ack({ok:true,code:r.code});emitRoom(r);
    }catch(e){ack({ok:false,error:e instanceof Error?e.message:'Unable to join room'});}
  });
  socket.on('start',()=>{if(!room||!me||room.host!==socket.id||!rateLimit(socket,'start',1000))return;if(startGame(room)){notice(room,'The heist is on. Watch your back.');emitRoom(room);}});
  socket.on('move',(v:{x:number;y:number})=>{
    if(!room||!me||room.phase!=='PLAYING'||!me.alive||!rateLimit(socket,'move',25)||!Number.isFinite(v?.x)||!Number.isFinite(v?.y))return;
    const now=Date.now(),dt=clamp((now-me.lastMove)/1000,0,.12),dx=clamp(v.x,-1,1),dy=clamp(v.y,-1,1),len=Math.hypot(dx,dy)||1;
    const speed=235,nx=clamp(me.x+dx/len*speed*dt,24,8168),ny=clamp(me.y+dy/len*speed*dt,24,4072);
    if(!blocked(nx,me.y))me.x=nx;if(!blocked(me.x,ny))me.y=ny;me.lastMove=now;
  });
  socket.on('task:complete',(taskId:string)=>{
    if(!room||!me||room.phase!=='PLAYING'||!me.alive||me.role!=='CREW'||!rateLimit(socket,'task',500))return;
    const task=room.tasks.find(t=>t.id===taskId&&!t.done);
    if(task&&Math.hypot(task.x-me.x,task.y-me.y)<135){task.done=true;me.tasks++;notice(room,me.name+' completed '+task.label+'.');finishIfNeeded(room);emitRoom(room);}
  });
  socket.on('kill',(targetId:string)=>{
    if(!room||!me||room.phase!=='PLAYING'||!me.alive||me.role!=='MOLE'||Date.now()<me.cooldownUntil||!rateLimit(socket,'kill',300))return;
    const target=room.players.get(targetId);
    if(!target||!target.alive||target.role==='MOLE'||Math.hypot(target.x-me.x,target.y-me.y)>125)return;
    target.alive=false;addBody(room,target);me.cooldownUntil=Date.now()+20_000;
    notice(room,target.name+' has been eliminated.');finishIfNeeded(room);emitRoom(room);
  });
  socket.on('sabotage',(kind:string)=>{
    if(!room||!me||room.phase!=='PLAYING'||!me.alive||me.role!=='MOLE'||!rateLimit(socket,'sabotage',1000))return;
    if(room.sabotage&&room.sabotage.endsAt>Date.now())return;
    room.sabotage={kind:'lights',endsAt:Date.now()+15_000};notice(room,'Lights sabotaged: visibility reduced for 15 seconds.');emitRoom(room);
  });
  socket.on('report',(bodyId:string)=>{
    if(!room||!me||room.phase!=='PLAYING'||!me.alive||!rateLimit(socket,'report',1000))return;
    const body=room.bodies.find(b=>b.id===bodyId&&!b.reported);
    if(!body||Math.hypot(body.x-me.x,body.y-me.y)>180)return;
    body.reported=true;beginMeeting(room,'Body reported: '+body.name);
  });
  socket.on('emergency',()=>{
    if(!room||!me||room.phase!=='PLAYING'||!me.alive||me.emergencyUsed||Date.now()<room.emergencyCooldownUntil||!rateLimit(socket,'emergency',1000))return;
    me.emergencyUsed=true;room.emergencyCooldownUntil=Date.now()+60_000;beginMeeting(room,'Emergency meeting called by '+me.name);
  });
  socket.on('vote',(targetId:string)=>{
    if(!room||!me||room.phase!=='MEETING'||!room.meeting||!me.alive||!rateLimit(socket,'vote',500))return;
    room.meeting.votes[me.id]=targetId==='skip'?'skip':room.players.has(targetId)&&room.players.get(targetId)!.alive?targetId:'skip';emitRoom(room);
  });
  socket.on('chat',(message:string)=>{
    if(!room||!me||room.phase!=='MEETING'||typeof message!=='string'||!rateLimit(socket,'chat',700))return;
    const clean=message.replace(/[<>]/g,'').trim().slice(0,180);if(!clean)return;
    io.to(room.code).emit('chat',{name:me.name,text:clean});
    for(const bot of [...room.players.values()].filter(p=>p.bot&&p.alive).slice(0,2)){
      const response=/where|кто|who|saw|видел/i.test(clean)?'I was checking the nearby rooms.':/mole|sus|подозр/i.test(clean)?'We should compare who was near the last body.':'I am focusing on my tasks. Has anyone seen anything?';
      setTimeout(()=>{if(room&&room.phase==='MEETING')io.to(room!.code).emit('chat',{name:bot.name,text:response});},500+Math.random()*1400);
    }
  });
  socket.on('disconnect',()=>{
    if(room&&me){room.players.delete(me.id);if(room.players.size===0)rooms.delete(room.code);else{if(room.host===me.id)room.host=room.players.keys().next().value||'';emitRoom(room);}}
  });
});
setInterval(()=>{
  const now=Date.now();
  for(const r of rooms.values()){
    botsTick(r,now);
    if(r.sabotage&&now>r.sabotage.endsAt)r.sabotage=undefined;
    if(r.phase!=='LOBBY')emitRoom(r);
  }
},250);
http.listen(PORT,'0.0.0.0',()=>console.log('Vice Heist listening on '+PORT));
