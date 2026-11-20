import express from 'express';
import {createServer} from 'node:http';
import {Server} from 'socket.io';
import {createHmac,randomBytes,timingSafeEqual} from 'node:crypto';
import path from 'node:path';
import {existsSync,readFileSync} from 'node:fs';
import {PNG} from 'pngjs';
import type {Player,PublicPlayer,Task,Snapshot,Role} from '../../shared/types.js';

const app=express(),http=createServer(app),io=new Server(http,{cors:{origin:true}});
const PORT=Number(process.env.PORT)||3000,ROOT=process.cwd();
const web=existsSync(path.join(ROOT,'dist/client'))?path.join(ROOT,'dist/client'):path.join(ROOT,'client');
app.get('/health',(_q,res)=>res.json({ok:true,game:'Vice Heist'}));
app.use(express.static(web,{etag:true,maxAge:'1h'}));
app.get('*',(q,res,next)=>q.path.startsWith('/socket.io')?next():res.sendFile(path.join(web,'index.html')));
let pixels:Buffer|undefined;
try{pixels=PNG.sync.read(readFileSync(path.join(ROOT,'client/public/assets/map/collision.png'))).data}catch{console.warn('Collision mask missing; server movement is bounds-only.')}
const solid=(x:number,y:number)=>{if(x<0||y<0||x>=8192||y>=4096)return true;if(!pixels)return false;const i=(Math.floor(y)*8192+Math.floor(x))*4;return pixels[i]>200&&pixels[i+1]>200&&pixels[i+2]>200};
const colors=['#f45b5b','#54b7f2','#f0bd4b','#a98af5','#58c99b','#f18dc3','#e4e7ec','#e78b4e','#6dd4d0','#b6cf5b'];
const taskSeed:Omit<Task,'done'>[]=[
{id:'helipad',label:'Align beacon',x:780,y:300,zone:0},{id:'bar',label:'Mix VIP cocktail',x:2812,y:504,zone:1},
{id:'vault',label:'Crack safe code',x:5200,y:560,zone:2},{id:'pool',label:'Balance pool pump',x:6600,y:500,zone:3},
{id:'garage',label:'Diagnose engine',x:616,y:2816,zone:4},{id:'server',label:'Trace firewall',x:2750,y:2800,zone:5},
{id:'generator',label:'Reset breakers',x:4900,y:2900,zone:6},{id:'dock',label:'Fuel speedboat',x:7192,y:2416,zone:7}];
type Room={code:string;phase:'LOBBY'|'PLAYING'|'MEETING'|'GAME_OVER';players:Map<string,Player>;tasks:Task[];host:string;meeting?:{reason:string;votes:Record<string,string>;endsAt:number};winner?:'CREW'|'MOLE';sabotage?:{kind:string;endsAt:number}};
const rooms=new Map<string,Room>();
const clamp=(n:number,a:number,b:number)=>Math.max(a,Math.min(b,n));
const roomCode=()=>{let c='';do{c=randomBytes(4).toString('hex').slice(0,5).toUpperCase()}while(rooms.has(c));return c};
function telegramUser(raw?:string){if(!raw||!process.env.BOT_TOKEN)return null;try{const p=new URLSearchParams(raw),hash=p.get('hash');if(!hash)return null;p.delete('hash');const data=[...p.entries()].sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>k+'='+v).join('\n');const secret=createHmac('sha256','WebAppData').update(process.env.BOT_TOKEN).digest(),calc=createHmac('sha256',secret).update(data).digest('hex');if(!timingSafeEqual(Buffer.from(calc,'hex'),Buffer.from(hash,'hex')))return null;if(Date.now()/1000-Number(p.get('auth_date'))>86400)return null;return JSON.parse(p.get('user')||'{}')}catch{return null}}
const cleanName=(name:string|undefined,raw?:string)=>String(telegramUser(raw)?.first_name||name||'Player').replace(/[<>]/g,'').slice(0,20);
function pub(p:Player):PublicPlayer{const {role,...v}=p;return v}
function snap(r:Room,id:string):Snapshot{return{code:r.code,phase:r.phase,players:[...r.players.values()].map(pub),selfRole:r.players.get(id)?.role,tasks:r.tasks,taskTotal:r.tasks.length,meeting:r.meeting,winner:r.winner,sabotage:r.sabotage}}
function emit(r:Room){for(const p of r.players.values())io.sockets.sockets.get(p.id)?.emit('state',snap(r,p.id))}
function notice(r:Room,text:string){io.to(r.code).emit('notice',text)}
function makeRoom(host:string):Room{const code=roomCode(),r:Room={code,phase:'LOBBY',players:new Map(),tasks:taskSeed.map(t=>({...t,done:false})),host};rooms.set(code,r);return r}
function bot(r:Room){const id='ai-'+randomBytes(5).toString('hex');r.players.set(id,{id,name:['Rico','Mia','Jax','Nova','Ace','Skye','Luca','Zee'][r.players.size%8],color:colors[r.players.size%colors.length],x:3000+r.players.size*55,y:2070,alive:true,role:'CREW',bot:true,tasks:0,lastMove:Date.now(),cooldownUntil:0})}
function start(r:Room){const ps=[...r.players.values()];if(ps.length<2)return false;r.phase='PLAYING';r.tasks=taskSeed.map(t=>({...t,done:false}));r.meeting=undefined;r.winner=undefined;ps.forEach((p,i)=>{p.alive=true;p.tasks=0;p.x=3000+(i%4)*70;p.y=2070+Math.floor(i/4)*65;p.role='CREW';p.cooldownUntil=0});const n=ps.length>=8?2:1;for(const p of [...ps].sort(()=>Math.random()-.5).slice(0,n))p.role='MOLE';return true}
function finish(r:Room){const a=[...r.players.values()].filter(p=>p.alive),m=a.filter(p=>p.role==='MOLE').length,c=a.length-m;if(!m||r.tasks.every(t=>t.done)){r.phase='GAME_OVER';r.winner='CREW'}else if(m>=c){r.phase='GAME_OVER';r.winner='MOLE'}}
function taskNear(r:Room,p:Player){return r.tasks.find(t=>!t.done&&Math.hypot(t.x-p.x,t.y-p.y)<125)}
function canMove(p:Player,x:number,y:number){const r=18,points:[[number,number],[number,number],[number,number],[number,number]]=[[x-r,y],[x+r,y],[x,y-r],[x,y+r]];return points.every(([a,b])=>!solid(a,b))}
function bots(r:Room,now:number){if(r.phase==='PLAYING'){const alive=[...r.players.values()].filter(p=>p.alive);for(const b of alive.filter(p=>p.bot)){const target=b.role==='MOLE'?alive.find(p=>p.role==='CREW'&&!p.bot):taskNear(r,b);if(target){const dx=target.x-b.x,dy=target.y-b.y,d=Math.hypot(dx,dy)||1,nx=b.x+dx/d*12,ny=b.y+dy/d*12;if(canMove(b,nx,b.y))b.x=nx;if(canMove(b,b.x,ny))b.y=ny}if(b.role==='CREW'){const t=taskNear(r,b);if(t&&Math.hypot(t.x-b.x,t.y-b.y)<100&&Math.random()<.025){t.done=true;b.tasks++;notice(r,b.name+' completed '+t.label+'.')}}else{const v=alive.find(p=>p.role==='CREW'&&Math.hypot(p.x-b.x,p.y-b.y)<95);if(v&&now>b.cooldownUntil&&Math.random()<.012){v.alive=false;b.cooldownUntil=now+18000;notice(r,v.name+' was eliminated.')}}}}
if(r.phase==='MEETING'&&r.meeting&&now>r.meeting.endsAt){const alive=[...r.players.values()].filter(p=>p.alive);for(const p of alive.filter(p=>p.bot)){if(!r.meeting.votes[p.id]){const suspects=alive.filter(x=>x.id!==p.id);const v=suspects[Math.floor(Math.random()*suspects.length)];r.meeting.votes[p.id]=v?.id||'skip'}}const counts=new Map<string,number>();Object.values(r.meeting.votes).forEach(v=>counts.set(v,(counts.get(v)||0)+1));const sorted=[...counts].sort((a,b)=>b[1]-a[1]);if(sorted[0]&&sorted[0][0]!=='skip'&&(!sorted[1]||sorted[0][1]>sorted[1][1])){const e=r.players.get(sorted[0][0]);if(e){e.alive=false;notice(r,e.name+' was ejected. They were '+(e.role==='MOLE'?'a Mole.':'Crew.'))}}r.meeting=undefined;r.phase='PLAYING';finish(r)}}
io.on('connection',s=>{let room:Room|undefined,me:Player|undefined;
s.on('create',(a:{name?:string;initData?:string},ack:(v:any)=>void)=>{room=makeRoom(s.id);me={id:s.id,name:cleanName(a.name,a.initData),color:colors[0],x:3000,y:2070,alive:true,role:'CREW',bot:false,tasks:0,lastMove:Date.now(),cooldownUntil:0};room.players.set(s.id,me);s.join(room.code);ack({ok:true,code:room.code});emit(room)});
s.on('solo',(a:{name?:string;initData?:string},ack:(v:any)=>void)=>{room=makeRoom(s.id);for(let i=0;i<5;i++)bot(room);me={id:s.id,name:cleanName(a.name,a.initData),color:colors[room.players.size%colors.length],x:3000,y:2070,alive:true,role:'CREW',bot:false,tasks:0,lastMove:Date.now(),cooldownUntil:0};room.players.set(s.id,me);s.join(room.code);start(room);ack({ok:true,code:room.code});emit(room)});
s.on('join',(a:{code:string;name?:string;initData?:string},ack:(v:any)=>void)=>{const r=rooms.get(String(a.code||'').toUpperCase());if(!r||r.phase!=='LOBBY'||r.players.size>=10){ack({ok:false,error:'Room unavailable'});return}room=r;me={id:s.id,name:cleanName(a.name,a.initData),color:colors[r.players.size%colors.length],x:3000,y:2070,alive:true,role:'CREW',bot:false,tasks:0,lastMove:Date.now(),cooldownUntil:0};r.players.set(s.id,me);s.join(r.code);ack({ok:true,code:r.code});emit(r)});
s.on('start',()=>{if(room&&me&&room.host===s.id&&start(room)){notice(room,'The heist is on. Watch your back.');emit(room)}});
s.on('move',(v:{x:number;y:number})=>{if(!room||!me||room.phase!=='PLAYING'||!me.alive||!Number.isFinite(v.x)||!Number.isFinite(v.y))return;const now=Date.now(),dt=clamp((now-me.lastMove)/1000,0,.12),dx=clamp(v.x,-1,1),dy=clamp(v.y,-1,1),d=Math.hypot(dx,dy)||1,speed=235,nx=clamp(me.x+dx/d*speed*dt,32,8160),ny=clamp(me.y+dy/d*speed*dt,32,4064);if(canMove(me,nx,me.y))me.x=nx;if(canMove(me,me.x,ny))me.y=ny;me.lastMove=now});
s.on('use',()=>{if(!room||!me||room.phase!=='PLAYING'||!me.alive||me.role!=='CREW')return;const t=taskNear(room,me);if(t){t.done=true;me.tasks++;notice(room,me.name+' completed '+t.label+'.');finish(room);emit(room)}});
s.on('kill',(id:string)=>{if(!room||!me||room.phase!=='PLAYING'||!me.alive||me.role!=='MOLE'||Date.now()<me.cooldownUntil)return;const p=room.players.get(id);if(!p||!p.alive||p.role==='MOLE'||Math.hypot(p.x-me.x,p.y-me.y)>125)return;p.alive=false;me.cooldownUntil=Date.now()+20000;notice(room,p.name+' has been eliminated.');finish(room);emit(room)});
s.on('sabotage',(kind:string)=>{if(!room||!me||room.phase!=='PLAYING'||!me.alive||me.role!=='MOLE'||room.sabotage&&room.sabotage.endsAt>Date.now())return;room.sabotage={kind:kind==='doors'?'doors':'lights',endsAt:Date.now()+15000};notice(room,'Sabotage activated: '+room.sabotage.kind);emit(room)});
s.on('report',(id?:string)=>{if(!room||!me||room.phase!=='PLAYING'||!me.alive)return;if(id){const p=room.players.get(id);if(!p||p.alive||Math.hypot(p.x-me.x,p.y-me.y)>180)return}room.phase='MEETING';room.meeting={reason:id?'Body reported':'Emergency meeting',votes:{},endsAt:Date.now()+30000};notice(room,room.meeting.reason);emit(room)});
s.on('vote',(id:string)=>{if(!room||!me||room.phase!=='MEETING'||!room.meeting||!me.alive)return;room.meeting.votes[me.id]=id==='skip'?'skip':room.players.has(id)?id:'skip';emit(room)});
s.on('chat',(msg:string)=>{if(!room||!me||room.phase!=='MEETING'||typeof msg!=='string')return;const text=msg.replace(/[<>]/g,'').trim().slice(0,180);if(text)io.to(room.code).emit('chat',{name:me.name,text})});
s.on('disconnect',()=>{if(room&&me){room.players.delete(me.id);if(!room.players.size)rooms.delete(room.code);else emit(room)}});
});
setInterval(()=>{const now=Date.now();for(const r of rooms.values()){bots(r,now);if(r.sabotage&&now>r.sabotage.endsAt)r.sabotage=undefined;if(r.phase!=='LOBBY')emit(r)}},250);
http.listen(PORT,'0.0.0.0',()=>console.log('Vice Heist listening on '+PORT));
