import express from 'express';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { randomBytes, createHmac, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { PNG } from 'pngjs';
import { readFileSync, existsSync } from 'node:fs';
import type { Player, PublicPlayer, Task, Snapshot, Meeting } from '../../shared/types.js';

const app = express();
const http = createServer(app);
const io = new Server(http, { cors: { origin: true, credentials: false }, maxHttpBufferSize: 100_000 });
const PORT = Number(process.env.PORT) || 3000;
const BOT_TOKEN = process.env.BOT_TOKEN;
const REQUIRE_TELEGRAM_AUTH = process.env.REQUIRE_TELEGRAM_AUTH === 'true';
// Production remains nondeterministic. The optional seed makes bot-navigation
// regression runs reproducible so a stuck-NPC failure can be diagnosed exactly.
let randomState = Number(process.env.VICE_HEIST_TEST_SEED) >>> 0;
const random = process.env.VICE_HEIST_TEST_SEED
  ? () => { randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0; return randomState / 0x1_0000_0000; }
  : () => Math.random();
const ROOT = process.cwd();
const webRoot = existsSync(path.join(ROOT, 'dist/client')) ? path.join(ROOT, 'dist/client') : path.join(ROOT, 'client');
app.get('/health', (_req, res) => res.json({ ok: true, game: 'Vice Heist', version: '1.0.1' }));
app.get('/api/config', (_req, res) => res.json({ telegramAuthRequired: REQUIRE_TELEGRAM_AUTH, groqAvailable: true }));
app.use(express.static(webRoot, { etag: true, maxAge: '1h', setHeaders: (res: any, filePath: string) => { if (filePath.endsWith('index.html')) res.setHeader('Cache-Control', 'no-cache'); } }));
app.get('*', (req, res, next) => { if (req.path.startsWith('/socket.io')) return next(); res.sendFile(path.join(webRoot, 'index.html'), e => e && res.status(404).end()); });

type Room = {
  code: string; phase: 'LOBBY' | 'PLAYING' | 'MEETING' | 'GAME_OVER';
  players: Map<string, Player>; tasks: Task[]; meeting?: Meeting;
  winner?: 'CREW' | 'MOLE'; sabotage?: { kind: string; endsAt: number };
  lastTick: number; lastStateEmitAt: number; host: string; emergencyCooldownUntil: number; roundStartedAt: number; suspicions: Map<string, number>;
};

// Keep a compact one-bit mask per sector instead of retaining an 8192×4096 RGBA atlas.
const collisionMasks: Uint8Array[] = [];
for (let tile = 1; tile <= 8; tile++) {
  const maskPath = path.join(ROOT, `client/public/assets/map/mask-${tile}.png`);
  if (!existsSync(maskPath)) throw new Error(`Required collision mask missing: ${maskPath}`);
  const decoded = PNG.sync.read(readFileSync(maskPath));
  if (decoded.width !== 2048 || decoded.height !== 2048) throw new Error(`Collision mask ${tile} must be 2048 × 2048 pixels.`);
  const bits = new Uint8Array((2048 * 2048 + 7) >> 3);
  for (let p = 0, i = 0; p < 2048 * 2048; p++, i += 4) {
    const r = decoded.data[i], g = decoded.data[i + 1], b = decoded.data[i + 2];
    if (r > 200 && g > 200 && b > 200) bits[p >> 3] |= 1 << (p & 7);
  }
  collisionMasks.push(bits);
}
function solid(x: number, y: number): boolean {
  if (x < 0 || y < 0 || x >= 8192 || y >= 4096) return true;
  const col = Math.floor(x / 2048), row = Math.floor(y / 2048), tile = collisionMasks[row * 4 + col];
  const p = (Math.floor(y) % 2048) * 2048 + (Math.floor(x) % 2048);
  return (tile[p >> 3] & (1 << (p & 7))) !== 0;
}
function blocked(x: number, y: number, radius = 18): boolean {
  const d = radius * 0.7071;
  return [[x-radius,y],[x+radius,y],[x,y-radius],[x,y+radius],[x-d,y-d],[x+d,y-d],[x-d,y+d],[x+d,y+d]].some(([a,b]) => solid(a,b));
}
function advancePlayer(p: Player, now: number) {
  const dt = clamp((now - p.lastMove) / 1000, 0, 0.06);
  p.lastMove = now;
  // Living players run at full speed; eliminated players remain mobile ghosts
  // at a reduced speed, with the same authoritative collision sweep.
  if (now - p.movementInputAt > 180) { p.moveX = 0; p.moveY = 0; }
  const magnitude = Math.hypot(p.moveX, p.moveY);
  if (magnitude < 0.08 || dt <= 0) return;
  const speedScale = Math.min(1, magnitude);
  const speed = p.alive ? 370 : 250;
  const dx = p.moveX / magnitude * speed * dt * speedScale;
  const dy = p.moveY / magnitude * speed * dt * speedScale;
  // Substep the authoritative collision sweep so low server tick rates or
  // event-loop stalls cannot tunnel a player through thin walls.
  const steps = Math.max(1, Math.ceil(Math.max(Math.abs(dx), Math.abs(dy)) / 6));
  const stepX = dx / steps, stepY = dy / steps;
  for (let i = 0; i < steps; i++) {
    const nextX = p.x + stepX, nextY = p.y + stepY;
    if (!blocked(nextX, p.y)) p.x = nextX;
    if (!blocked(p.x, nextY)) p.y = nextY;
  }
}
const rooms = new Map<string, Room>();
const COLORS = ['#f45b5b','#54b7f2','#f0bd4b','#a98af5','#58c99b','#f18dc3','#e4e7ec','#e78b4e','#6dd4d0','#b6cf5b'];
const BOT_NAMES = ['Rico','Mia','Jax','Nova','Ace','Skye','Luca','Zee'];
const TASKS: Omit<Task, 'done'>[] = [
  { id:'helipad', label:'Align beacon', x:780, y:300, zone:0 },
  { id:'bar', label:'Mix VIP cocktail', x:2822, y:504, zone:1 },
  { id:'vault', label:'Crack safe code', x:5200, y:560, zone:2 },
  { id:'pool', label:'Balance pool pump', x:6600, y:500, zone:3 },
  { id:'garage', label:'Diagnose engine', x:616, y:2831, zone:4 },
  { id:'server', label:'Trace firewall', x:2750, y:2800, zone:5 },
  { id:'generator', label:'Reset breakers', x:4905, y:2910, zone:6 },
  { id:'dock', label:'Fuel speedboat', x:7172, y:2401, zone:7 },
];
const clamp = (n: number, a: number, b: number) => Math.max(a, Math.min(b, n));
function roomCode(): string { let s = ''; do { s = randomBytes(4).toString('hex').slice(0,5).toUpperCase(); } while (rooms.has(s)); return s; }
function validTelegram(raw?: string) {
  if (!raw || !BOT_TOKEN) return null;
  try {
    const p = new URLSearchParams(raw); const hash = p.get('hash'); if (!hash || !/^[a-f0-9]{64}$/i.test(hash)) return null;
    p.delete('hash'); const data = [...p.entries()].sort(([a],[b]) => a.localeCompare(b)).map(([k,v]) => `${k}=${v}`).join('\n');
    const secret = createHmac('sha256', BOT_TOKEN).update('WebAppData').digest();
    const calc = createHmac('sha256', secret).update(data).digest('hex');
    if (!timingSafeEqual(Buffer.from(calc, 'hex'), Buffer.from(hash, 'hex'))) return null;
    const authDate = Number(p.get('auth_date'));
    if (!authDate || authDate > Date.now()/1000 + 60 || Date.now()/1000 - authDate > 86400) return null;
    return JSON.parse(p.get('user') || '{}') as { id?: number; first_name?: string; username?: string };
  } catch { return null; }
}
function cleanName(value: unknown): string { return String(value || 'Player').replace(/[<>\u0000-\u001f]/g, '').trim().slice(0,20) || 'Player'; }
function publicPlayer(p: Player): PublicPlayer { return { id:p.id,name:p.name,color:p.color,x:p.x,y:p.y,alive:p.alive,reported:p.reported,bot:p.bot,tasks:p.tasks,corpseX:p.corpseX,corpseY:p.corpseY }; }
function snapshot(r: Room, viewer: string): Snapshot {
  const p = r.players.get(viewer);
  return { code:r.code,phase:r.phase,players:[...r.players.values()].map(publicPlayer),selfRole:p?.role,isHost:r.host===viewer,
    tasks:r.tasks,taskTotal:r.tasks.length,meeting:r.meeting,winner:r.winner,sabotage:r.sabotage,
    selfCooldownUntil:p?.cooldownUntil || 0,selfEmergencyUsed:p?.emergencyUsed || false,
    emergencyCooldownUntil:r.emergencyCooldownUntil };
}
function emit(r: Room) { for (const p of r.players.values()) if(!p.bot&&p.connected&&p.socketId) io.sockets.sockets.get(p.socketId)?.emit('state', snapshot(r,p.id)); }
function notice(r: Room, text: string) { io.to(r.code).emit('notice', text); }
function createRoom(): Room {
  const code = roomCode(); const r: Room = { code,phase:'LOBBY',players:new Map(),tasks:TASKS.map(t=>({...t,done:false})),lastTick:Date.now(),lastStateEmitAt:Date.now(),host:'',emergencyCooldownUntil:0,roundStartedAt:0,suspicions:new Map() };
  rooms.set(code,r); return r;
}
function addPlayer(r: Room, socketId: string, name: string, bot = false): Player {
  const n = r.players.size; const id=bot?socketId:`player-${randomBytes(8).toString('hex')}`;
  const spawnX=2800+(n%4)*70,spawnY=2000+Math.floor(n/4)*65;
  const p: Player = { id,name,color:COLORS[n%COLORS.length],x:spawnX,y:spawnY,corpseX:spawnX,corpseY:spawnY,alive:true,reported:false,role:'CREW',bot,tasks:0,lastMove:Date.now(),movementInputAt:0,moveX:0,moveY:0,movementEpoch:0,movementRequestId:0,cooldownUntil:0,emergencyUsed:false,socketId:bot?undefined:socketId,sessionKey:bot?undefined:randomBytes(24).toString('hex'),connected:!bot };
  r.players.set(id,p); return p;
}
function start(r: Room): boolean {
  const list = [...r.players.values()]; if (list.length < 4) return false;
  r.phase='PLAYING'; r.winner=undefined; r.meeting=undefined; r.sabotage=undefined; r.emergencyCooldownUntil=0;r.roundStartedAt=Date.now();
  r.tasks=TASKS.map(t=>({...t,done:false}));r.suspicions.clear();botRoutes.clear();botTaskAssignments.clear();botHuntTargets.clear();ghostWanderTargets.clear();
  list.forEach((p,i)=>{p.alive=true;p.reported=false;p.tasks=0;p.x=2800+(i%4)*70;p.y=2000+Math.floor(i/4)*65;p.corpseX=p.x;p.corpseY=p.y;p.lastMove=Date.now();p.movementInputAt=0;p.moveX=0;p.moveY=0;p.movementEpoch=0;p.movementRequestId=0;p.cooldownUntil=r.roundStartedAt+12_000;p.emergencyUsed=false;p.role='CREW';});
  const moleCount = list.length >= 8 ? 2 : 1;
  const shuffled = [...list].sort(() => random() - 0.5);
  for (const p of shuffled.slice(0,moleCount)) p.role='MOLE';
  const availableTasks=[...r.tasks];
  list.filter(p=>p.bot&&p.role==='CREW').sort((a,b)=>a.id.localeCompare(b.id)).forEach(bot=>{
    const nearest=availableTasks.sort((a,b)=>Math.hypot(a.x-bot.x,a.y-bot.y)-Math.hypot(b.x-bot.x,b.y-bot.y)).shift();
    if(nearest)botTaskAssignments.set(bot.id,nearest.id);
  });
  return true;
}
function closestTask(r: Room, p: Player) { return r.tasks.filter(t=>!t.done).sort((a,b)=>Math.hypot(a.x-p.x,a.y-p.y)-Math.hypot(b.x-p.x,b.y-p.y))[0]; }
function nearestTask(r: Room, p: Player) { const t=closestTask(r,p);return t&&Math.hypot(t.x-p.x,t.y-p.y)<150?t:undefined; }
const BOT_CELL = 32, BOT_COLS = 256, BOT_ROWS = 128;
type BotRoute = { key:string; goalX:number; goalY:number; path:number[]; index:number; plannedAt:number; lastX:number; lastY:number; stuckSince:number };
const botRoutes = new Map<string,BotRoute>();
const botTaskAssignments = new Map<string,string>();
const botHuntTargets = new Map<string,{targetId:string; selectedAt:number}>();
const ghostWanderTargets = new Map<string,{x:number;y:number;selectedAt:number}>();
const botNeighbors = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[1,-1],[-1,1],[-1,-1]] as const;
function cellCenter(index:number){return{x:(index%BOT_COLS+.5)*BOT_CELL,y:(Math.floor(index/BOT_COLS)+.5)*BOT_CELL};}
function cellAt(x:number,y:number){return Math.max(0,Math.min(BOT_ROWS-1,Math.floor(y/BOT_CELL)))*BOT_COLS+Math.max(0,Math.min(BOT_COLS-1,Math.floor(x/BOT_CELL)));}
function nearestWalkableCell(index:number):number{
  const origin=cellCenter(index);if(!blocked(origin.x,origin.y,18))return index;
  for(let radius=1;radius<=12;radius++)for(let dy=-radius;dy<=radius;dy++)for(let dx=-radius;dx<=radius;dx++){
    if(Math.max(Math.abs(dx),Math.abs(dy))!==radius)continue;
    const x=index%BOT_COLS+dx,y=Math.floor(index/BOT_COLS)+dy;if(x<0||x>=BOT_COLS||y<0||y>=BOT_ROWS)continue;
    const candidate=y*BOT_COLS+x,point=cellCenter(candidate);if(!blocked(point.x,point.y,18))return candidate;
  }return index;
}
function findBotPath(from:{x:number;y:number},to:{x:number;y:number}):number[]{
  const start=nearestWalkableCell(cellAt(from.x,from.y)),goal=nearestWalkableCell(cellAt(to.x,to.y));if(start===goal)return[goal];
  const previous=new Int32Array(BOT_COLS*BOT_ROWS);previous.fill(-2);previous[start]=-1;
  const queue=new Int32Array(BOT_COLS*BOT_ROWS);let head=0,tail=0;queue[tail++]=start;
  while(head<tail){const current=queue[head++];if(current===goal)break;const cx=current%BOT_COLS,cy=Math.floor(current/BOT_COLS);
    for(const[dx,dy]of botNeighbors){const x=cx+dx,y=cy+dy;if(x<0||x>=BOT_COLS||y<0||y>=BOT_ROWS)continue;const next=y*BOT_COLS+x;if(previous[next]!==-2)continue;
      const point=cellCenter(next);if(blocked(point.x,point.y,18))continue;
      if(dx&&dy){const sideA=cellCenter(cy*BOT_COLS+x),sideB=cellCenter(y*BOT_COLS+cx);if(blocked(sideA.x,sideA.y,18)||blocked(sideB.x,sideB.y,18))continue;}
      previous[next]=current;queue[tail++]=next;
    }
  }
  if(previous[goal]===-2)return[];const path:number[]=[];for(let at=goal;at!==-1;at=previous[at])path.push(at);path.reverse();return path;
}
function steerBotToward(bot:Player,target:{x:number;y:number},step:number):boolean{
  const dx=target.x-bot.x,dy=target.y-bot.y,base=Math.atan2(dy,dx);
  let best:{x:number;y:number;score:number}|undefined;
  for(const offset of [0,0.35,-0.35,0.7,-0.7,1.1,-1.1,1.55,-1.55,Math.PI]){
    const angle=base+offset,nx=bot.x+Math.cos(angle)*Math.min(step,28),ny=bot.y+Math.sin(angle)*Math.min(step,28);
    // Apply the same axis-separated collision sweep as normal bot movement;
    // checking X and Y independently from the old position can cut a diagonal
    // corner and leave an NPC inside a solid mask pixel.
    let candidateX=bot.x,candidateY=bot.y;
    if(!blocked(nx,candidateY,18))candidateX=nx;
    if(!blocked(candidateX,ny,18))candidateY=ny;
    if(Math.hypot(candidateX-bot.x,candidateY-bot.y)<0.1)continue;
    const score=Math.hypot(target.x-candidateX,target.y-candidateY)+Math.abs(offset)*18;
    if(!best||score<best.score)best={x:candidateX,y:candidateY,score};
  }
  if(!best)return false;
  bot.x=best.x;bot.y=best.y;return true;
}
function moveBotToward(bot:Player,target:{x:number;y:number},speed:number,dtSeconds:number,key:string,now:number){
  const step=speed*dtSeconds;
  let route=botRoutes.get(bot.id);
  const changed=!route||route.key!==key||Math.hypot(route.goalX-target.x,route.goalY-target.y)>192;
  const stuck=!!route&&Math.hypot(bot.x-route.lastX,bot.y-route.lastY)<5&&now-route.stuckSince>1250;
  if(changed||!route||(route.path.length>0&&route.index>=route.path.length)||stuck||now-route.plannedAt>4000){
    route={key,goalX:target.x,goalY:target.y,path:findBotPath(bot,target),index:0,plannedAt:now,lastX:bot.x,lastY:bot.y,stuckSince:now};botRoutes.set(bot.id,route);
  }
  if(!route.path.length){
    // A* can return a geometrically valid coarse path whose first waypoint is
    // still unreachable by the radius-aware collision sweep. Use local
    // collision-safe steering rather than leaving the NPC frozen indefinitely.
    if(steerBotToward(bot,target,step)){route.lastX=bot.x;route.lastY=bot.y;route.stuckSince=now;}
    return;
  }
  while(route.index<route.path.length-1){const point=cellCenter(route.path[route.index]);if(Math.hypot(point.x-bot.x,point.y-bot.y)>42)break;route.index++;}
  const point=cellCenter(route.path[Math.min(route.index,route.path.length-1)]),dx=point.x-bot.x,dy=point.y-bot.y,d=Math.hypot(dx,dy)||1;
  const travel=Math.min(step,d),nx=bot.x+dx/d*travel,ny=bot.y+dy/d*travel;
  const beforeX=bot.x,beforeY=bot.y;
  if(!blocked(nx,bot.y,18))bot.x=nx;
  if(!blocked(bot.x,ny,18))bot.y=ny;
  const moved=Math.hypot(bot.x-beforeX,bot.y-beforeY);
  if(moved<0.5){
    // Do not keep retrying the same blocked first waypoint for four seconds.
    // Drop the coarse path and take a safe local step around the obstruction.
    route.path=[];route.index=0;route.plannedAt=now;
    if(steerBotToward(bot,target,step)){route.lastX=bot.x;route.lastY=bot.y;route.stuckSince=now;}
    return;
  }
  if(Math.hypot(bot.x-route.lastX,bot.y-route.lastY)>4){route.lastX=bot.x;route.lastY=bot.y;route.stuckSince=now;}
}
function hasLineOfSight(a:{x:number;y:number},b:{x:number;y:number}):boolean{
  const distance=Math.hypot(b.x-a.x,b.y-a.y),steps=Math.ceil(distance/12);
  for(let i=1;i<steps;i++){const t=i/steps;if(solid(a.x+(b.x-a.x)*t,a.y+(b.y-a.y)*t))return false;}return true;
}
function finish(r: Room) {
  const alive=[...r.players.values()].filter(p=>p.alive); const moles=alive.filter(p=>p.role==='MOLE').length; const crew=alive.length-moles;
  if (moles===0) { r.phase='GAME_OVER';r.winner='CREW'; }
  else if (moles>=crew) { r.phase='GAME_OVER';r.winner='MOLE'; }
  else if (r.tasks.every(t=>t.done)) { r.phase='GAME_OVER';r.winner='CREW'; }
}
function beginMeeting(r: Room, reason: string) { r.phase='MEETING';r.meeting={reason,votes:{},endsAt:Date.now()+30_000};notice(r,reason);emit(r);}
function fallbackBotLine(bot: Player, text: string, r: Room): string {
  const msg=text.toLowerCase();
  const leading=[...r.suspicions.entries()].sort((a,b)=>b[1]-a[1])[0];
  const suspect=leading&&leading[1]>=2?r.players.get(leading[0]):undefined;
  if(suspect&&/suspect|who|vote|mole|impostor|body|report|kill/.test(msg))return `${suspect.name} was close to the last incident. I want to hear their route.`;
  if (/where|location|last seen|saw/.test(msg)) return ['I was near the lounge; I saw someone cut through the hall.','I crossed the main hall a moment ago.','I was checking the cameras room. Ask who else was there.'][Math.floor(random()*3)];
  if (/suspect|who|vote|mole|impostor/.test(msg)) return ['Let’s compare who was near the last task.','I’m not voting without a reason. Who can confirm that?','The timing feels off. We should hear everyone first.'][Math.floor(random()*3)];
  if (/kill|body|dead|report/.test(msg)) return ['That is serious. Who found them, and where?','We need a timeline before we vote.','Did anyone see someone leave the area?'][Math.floor(random()*3)];
  return ['I hear you. What did you notice?','Can someone confirm that before we vote?','Let’s keep the timeline straight.'][Math.floor(random()*3)];
}
async function botReply(r: Room, sender: Player, text: string) {
  const bots=[...r.players.values()].filter(p=>p.bot&&p.alive).slice(0,2);
  const allowGroq=!!sender.aiKey&&Date.now()-(sender.lastChatAt||0)>4500;if(allowGroq)sender.lastChatAt=Date.now();
  let conversationalContext=text;
  for (const bot of bots) {
    let reply = fallbackBotLine(bot,conversationalContext,r);
    if (sender.aiKey && allowGroq) {
      try {
        const roleContext = bot.role==='MOLE' ? 'You are secretly a Mole. Conceal it naturally.' : 'You are a Crew member. Help identify inconsistencies.';
        const response = await fetch('https://api.groq.com/openai/v1/chat/completions', { method:'POST',headers:{'Authorization':`Bearer ${sender.aiKey}`,'Content-Type':'application/json'},signal:AbortSignal.timeout(4500),body:JSON.stringify({model:'llama-3.3-70b-versatile',temperature:0.75,max_tokens:70,messages:[{role:'system',content:`You are ${bot.name}, a short-message NPC in a social deduction game. ${roleContext} Stay in character, be concise, do not claim facts not provided, do not reveal the hidden role.`},{role:'user',content:`Meeting context: ${r.meeting?.reason||'discussion'}. The conversation so far: ${conversationalContext}. Respond to the latest point in one natural sentence.`}]}) });
        if (response.ok) { const json=await response.json() as {choices?:{message?:{content?:string}}[]}; const candidate=json.choices?.[0]?.message?.content?.trim(); if(candidate) reply=candidate.slice(0,180); }
      } catch { /* deterministic fallback is intentionally retained */ }
    }
    io.to(r.code).emit('chat',{name:bot.name,text:reply});
    conversationalContext += `\n${bot.name}: ${reply}`;
  }
}
function botsTick(r: Room, now: number) {
  const dtSeconds=Math.min(0.1,Math.max(0,(now-r.lastTick)/1000));
  if(r.phase==='PLAYING'){
    const alive=[...r.players.values()].filter(p=>p.alive);
    // Eliminated NPCs remain active as ghosts: they wander the estate but cannot
    // interact with tasks, report bodies, or eliminate living players.
    for(const ghost of [...r.players.values()].filter(p=>p.bot&&!p.alive)){
      let target=ghostWanderTargets.get(ghost.id);
      if(!target||Math.hypot(target.x-ghost.x,target.y-ghost.y)<70||now-target.selectedAt>9_000){
        const waypoint=TASKS[Math.floor(random()*TASKS.length)];
        target={x:waypoint.x,y:waypoint.y,selectedAt:now};ghostWanderTargets.set(ghost.id,target);
      }
      moveBotToward(ghost,target,208,dtSeconds,'ghost-wander',now);
    }
    for(const bot of alive.filter(p=>p.bot)){
      if(bot.role==='CREW'){
        let task=r.tasks.find(t=>!t.done&&t.id===botTaskAssignments.get(bot.id));
        if(!task){
          const claimed=new Set([...botTaskAssignments.entries()].filter(([id])=>id!==bot.id&&alive.some(p=>p.id===id&&p.role==='CREW')).map(([,taskId])=>taskId));
          task=r.tasks.filter(t=>!t.done&&!claimed.has(t.id)).sort((x,y)=>Math.hypot(x.x-bot.x,x.y-bot.y)-Math.hypot(y.x-bot.x,y.y-bot.y))[0]||closestTask(r,bot);
          if(task)botTaskAssignments.set(bot.id,task.id);
        }
        if(task)moveBotToward(bot,task,272,dtSeconds,`task:${task.id}`,now);
        const underLights=!!r.sabotage&&r.sabotage.kind==='lights'&&r.sabotage.endsAt>now;
        if(task&&Math.hypot(task.x-bot.x,task.y-bot.y)<112&&random()<(1-Math.pow(1-(underLights ? 0.08 : 0.16),dtSeconds/0.25))){
          task.done=true;bot.tasks++;botRoutes.delete(bot.id);botTaskAssignments.delete(bot.id);notice(r,`${bot.name} completed ${task.label}.`);finish(r);
        }
      }else{
        const crew=alive.filter(p=>p.role==='CREW').map(candidate=>{
          const distance=Math.hypot(candidate.x-bot.x,candidate.y-bot.y);
          const nearbyCrew=alive.filter(other=>other.id!==candidate.id&&other.role==='CREW'&&Math.hypot(other.x-candidate.x,other.y-candidate.y)<320).length;
          const visible=hasLineOfSight(bot,candidate);
          const previous=botHuntTargets.get(bot.id);
          const repeatPenalty=0; // Keep the selected human target instead of oscillating between crew bots.
          const playerBias=candidate.bot?900:-450;
          return {candidate,distance,visible,score:distance+nearbyCrew*210+(visible?0:360)+repeatPenalty+playerBias};
        }).sort((a,b)=>a.score-b.score);
        const previous=botHuntTargets.get(bot.id);
        const current=crew.find(entry=>entry.candidate.id===previous?.targetId);
        const humanTarget=crew.find(entry=>!entry.candidate.bot);
        // A Mole NPC should blend into the estate instead of beelining toward
        // the human from across the map. It only commits to a hunt at close
        // range, with a low per-tick decision chance; an active short hunt is
        // retained briefly to avoid visibly twitching between targets.
        const retain=!!current&&!!previous&&now-previous.selectedAt<3_500&&current.distance<650;
        const commit=retain||!!humanTarget&&humanTarget.distance<620&&random()<0.015;
        if(commit&&humanTarget){
          if(!previous||previous.targetId!==humanTarget.candidate.id)botHuntTargets.set(bot.id,{targetId:humanTarget.candidate.id,selectedAt:now});
          moveBotToward(bot,humanTarget.candidate,260,dtSeconds,'hunt:'+humanTarget.candidate.id,now);
        }else{
          botHuntTargets.delete(bot.id);
          const patrol=TASKS[(Math.floor(now/12_000)+bot.name.length*3)%TASKS.length];
          moveBotToward(bot,patrol,218,dtSeconds,'patrol:'+patrol.id,now);
        }
        if((!r.sabotage||r.sabotage.endsAt<=now)&&random()<(1-Math.pow(1-.008,dtSeconds/0.25))){r.sabotage={kind:'lights',endsAt:now+15_000};notice(r,`${bot.name} triggered a lights outage.`);}
        const victim=crew.map(entry=>entry.candidate)
          .filter(p=>{
            const distance=Math.hypot(p.x-bot.x,p.y-bot.y);
            // Preserve wall occlusion at normal attack range. At true sprite
            // overlap, tolerate a one-cell mask edge discrepancy so the NPC
            // cannot orbit a player it has physically reached.
            // Reliable close-contact attack even when collision samples differ slightly.
            return distance<150&&(hasLineOfSight(bot,p)||distance<108);
          })
          .sort((a,b)=>Math.hypot(a.x-bot.x,a.y-bot.y)-Math.hypot(b.x-bot.x,b.y-bot.y))[0];
        if(victim&&now>=Math.max(bot.cooldownUntil,r.roundStartedAt+12_000)){
          victim.corpseX=victim.x;victim.corpseY=victim.y;victim.alive=false;victim.reported=false;victim.moveX=0;victim.moveY=0;victim.movementInputAt=0;bot.cooldownUntil=now+20_000;
          for(const witness of r.players.values())if(witness.bot&&witness.id!==bot.id&&witness.alive&&Math.hypot(witness.x-bot.x,witness.y-bot.y)<420)r.suspicions.set(bot.id,(r.suspicions.get(bot.id)||0)+2);
          notice(r,`${victim.name} was eliminated.`);finish(r);
        }
      }
    }
  }
  if(r.phase==='MEETING'&&r.meeting&&now>r.meeting.endsAt){
    const alive=[...r.players.values()].filter(p=>p.alive);
    for(const p of alive.filter(p=>p.bot&&!r.meeting!.votes[p.id])){
      const suspects=alive.filter(x=>x.id!==p.id&&(p.role!=='MOLE'||x.role!=='MOLE')).sort((a,b)=>(r.suspicions.get(b.id)||0)-(r.suspicions.get(a.id)||0));
      const pick=suspects[0];r.meeting.votes[p.id]=pick&&(r.suspicions.get(pick.id)||0)>0?pick.id:'skip';
    }
    const counts=new Map<string,number>();Object.values(r.meeting.votes).forEach(v=>counts.set(v,(counts.get(v)||0)+1));
    const top=[...counts].sort((a,b)=>b[1]-a[1]);
    if(top.length&&top[0][0]!=='skip'&&(!top[1]||top[0][1]>top[1][1])){const e=r.players.get(top[0][0]);if(e){e.corpseX=e.x;e.corpseY=e.y;e.alive=false;e.reported=true;e.moveX=0;e.moveY=0;e.movementInputAt=0;notice(r,`${e.name} was ejected. They were ${e.role==='MOLE'?'a Mole':'Crew'}.`);}}
    r.meeting=undefined;r.phase='PLAYING';finish(r);emit(r);
  }
}

io.on('connection', socket => {
  let room: Room | undefined; let player: Player | undefined;
  const reply = (ack: unknown, payload: unknown) => {
    if (typeof ack === 'function') (ack as (value: unknown) => void)(payload);
  };
  const authPlayer = (initData?: string, requestedName?: string) => {
    const tg=validTelegram(initData);
    if(REQUIRE_TELEGRAM_AUTH&&!tg) return null;
    return {name:cleanName(tg?.first_name||requestedName),tg};
  };
  socket.on('create',(data:{name?:string;initData?:string},ack?: (v: any) => void)=>{
    const auth=authPlayer(data?.initData,data?.name);if(!auth){reply(ack, {ok:false,error:'Telegram authentication failed. Open this game from its Telegram bot.'});return;}
    room=createRoom();player=addPlayer(room,socket.id,auth.name);room.host=player.id;socket.join(room.code);reply(ack, {ok:true,code:room.code,playerId:player.id,sessionKey:player.sessionKey});emit(room);
  });
  socket.on('solo',(data:{name?:string;initData?:string},ack?: (v: any) => void)=>{
    const auth=authPlayer(data?.initData,data?.name);if(!auth){reply(ack, {ok:false,error:'Telegram authentication failed. Open this game from its Telegram bot.'});return;}
    room=createRoom();for(let i=0;i<5;i++)addPlayer(room,`bot-${randomBytes(6).toString('hex')}`,BOT_NAMES[i],true);
    player=addPlayer(room,socket.id,auth.name);room.host=player.id;socket.join(room.code);start(room);reply(ack, {ok:true,code:room.code,playerId:player.id,sessionKey:player.sessionKey});emit(room);
  });
  socket.on('join',(data:{code?:string;name?:string;initData?:string},ack?: (v: any) => void)=>{
    const auth=authPlayer(data?.initData,data?.name);if(!auth){reply(ack, {ok:false,error:'Telegram authentication failed.'});return;}
    const r=rooms.get(String(data?.code||'').toUpperCase());if(!r||r.phase!=='LOBBY'||r.players.size>=10){reply(ack, {ok:false,error:'Room unavailable or full.'});return;}
    room=r;player=addPlayer(r,socket.id,auth.name);if(!r.players.get(r.host)?.connected)r.host=player.id;socket.join(r.code);reply(ack, {ok:true,code:r.code,playerId:player.id,sessionKey:player.sessionKey});emit(r);
  });
  socket.on('resume',(data:{code?:string;sessionKey?:string},ack?: (v: any) => void)=>{
    const r=rooms.get(String(data?.code||'').toUpperCase());
    const existing=r&&[...r.players.values()].find(p=>!p.bot&&p.sessionKey===data?.sessionKey);
    if(!r||!existing){reply(ack, {ok:false,error:'Your previous game session expired.'});return;}
    room=r;player=existing;player.moveX=0;player.moveY=0;player.movementInputAt=0;player.lastMove=Date.now();player.movementEpoch=0;player.movementRequestId=0;player.socketId=socket.id;player.connected=true;socket.join(r.code);
    reply(ack, {ok:true,code:r.code,playerId:player.id,sessionKey:player.sessionKey});emit(r);
  });
  socket.on('ai:key',(value:unknown)=>{if(!player)return;const key=typeof value==='string'?value.trim():'';player.aiKey=/^gsk_[A-Za-z0-9_-]{20,}$/.test(key)?key.slice(0,200):undefined;});
  socket.on('start',()=>{if(!room||!player||room.host!==player.id)return;if(start(room)){notice(room,'The heist is on. Watch your back.');emit(room);}});
  socket.on('move',(input:{x:number;y:number;epoch:number;requestId:number},ack?:(result:{ok:boolean;x?:number;y?:number})=>void)=>{
    const reply=(result:{ok:boolean;x?:number;y?:number})=>{if(typeof ack==='function')ack(result);};
    if(!room||!player||room.phase!=='PLAYING'||!Number.isFinite(input?.x)||!Number.isFinite(input?.y)||!Number.isSafeInteger(input?.epoch)||!Number.isSafeInteger(input?.requestId)){reply({ok:false});return;}
    const now=Date.now();
    // Ignore reordered packets, especially delayed movement from an epoch
    // that ended with a newer zero-vector release.
    if(input.epoch<player.movementEpoch){reply({ok:false,x:player.x,y:player.y});return;}
    if(input.epoch>player.movementEpoch){player.movementEpoch=input.epoch;player.movementRequestId=0;player.moveX=0;player.moveY=0;}
    if(input.requestId<=player.movementRequestId){reply({ok:false,x:player.x,y:player.y});return;}
    player.movementRequestId=input.requestId;
    const dx=clamp(input.x,-1,1),dy=clamp(input.y,-1,1),magnitude=Math.hypot(dx,dy);
    // The client sends intent, not coordinates. The server integrates that
    // intent on its fixed simulation tick and remains authoritative.
    if(magnitude<0.08){
      // Integrate the final fraction of the active movement interval before
      // clearing intent. Without this, the server discards up to one tick of
      // movement at release while the client has already predicted that time,
      // producing the visible backward correction when the stick is lifted.
      advancePlayer(player,now);
      player.moveX=0;player.moveY=0;player.movementInputAt=0;
      emit(room);
      room.lastStateEmitAt=now;
      reply({ok:true,x:player.x,y:player.y});
      return;
    }
    player.moveX=dx;player.moveY=dy;player.movementInputAt=now;
    reply({ok:true,x:player.x,y:player.y});
  });
  socket.on('use',(input?:{taskId?:unknown;answer?:unknown})=>{
    if(!room||!player||room.phase!=='PLAYING'||!player.alive||player.role!=='CREW')return;
    const taskId=typeof input?.taskId==='string'?input.taskId:'';
    const task=room.tasks.find(t=>t.id===taskId&&!t.done);
    if(!task||Math.hypot(task.x-player.x,task.y-player.y)>=150){socket.emit('notice','Move closer to an unfinished task.');return;}
    const answer=input?.answer;
    const numeric=typeof answer==='number'&&Number.isFinite(answer)?answer:NaN;
    const valid:Record<string,()=>boolean>={
      vault:()=>answer==='2741',
      server:()=>answer==='blue,gold,red,teal',
      helipad:()=>numeric>=250&&numeric<=1500,
      generator:()=>answer==='1011',
      dock:()=>numeric>=2000&&numeric<=10000,
      bar:()=>answer==='lime,ice,rum',
      pool:()=>numeric>=68&&numeric<=76,
      garage:()=>numeric>=1600&&numeric<=10000,
    };
    if(!valid[task.id]?.()){
      socket.emit('notice','That operation did not pass verification. Try the puzzle again.');
      return;
    }
    task.done=true;player.tasks++;notice(room,`${player.name} completed ${task.label}.`);finish(room);emit(room);
  });
  socket.on('kill',(targetId:unknown)=>{if(!room||!player||room.phase!=='PLAYING'||player.role!=='MOLE'||!player.alive||Date.now()<Math.max(player.cooldownUntil,room.roundStartedAt+12_000)){if(room&&player&&room.phase==='PLAYING'&&player.role==='MOLE'&&Date.now()<room.roundStartedAt+12_000)socket.emit('notice','Eliminations are disabled for the first 12 seconds of the round.');return;}const t=room.players.get(String(targetId));if(!t||!t.alive||t.id===player.id||t.role==='MOLE'||Math.hypot(t.x-player.x,t.y-player.y)>125)return;t.corpseX=t.x;t.corpseY=t.y;t.alive=false;t.reported=false;t.moveX=0;t.moveY=0;t.movementInputAt=0;player.cooldownUntil=Date.now()+20_000;for(const witness of room.players.values())if(witness.bot&&witness.alive&&Math.hypot(witness.x-player.x,witness.y-player.y)<420)room.suspicions.set(player.id,(room.suspicions.get(player.id)||0)+2);notice(room,`${t.name} has been eliminated.`);finish(room);emit(room);});
  socket.on('sabotage',(kind:unknown)=>{if(!room||!player||room.phase!=='PLAYING'||player.role!=='MOLE'||!player.alive||room.sabotage&&room.sabotage.endsAt>Date.now())return;const type=kind==='doors'?'doors':'lights';room.sabotage={kind:type,endsAt:Date.now()+15_000};notice(room,type==='doors'?'Security lockdown: doors sealed for 15 seconds.':'Lights sabotaged: crew vision reduced.');emit(room);});
  socket.on('report',(targetId:unknown)=>{if(!room||!player||room.phase!=='PLAYING'||!player.alive)return;const t=room.players.get(String(targetId));if(!t||t.alive||t.reported||Math.hypot(t.corpseX-player.x,t.corpseY-player.y)>180)return;t.reported=true;beginMeeting(room,`${player.name} reported a body.`);});
  socket.on('emergency',()=>{if(!room||!player||room.phase!=='PLAYING'||!player.alive)return;if(player.emergencyUsed||Date.now()<room.emergencyCooldownUntil){socket.emit('notice','Emergency protocol is unavailable right now.');return;}player.emergencyUsed=true;room.emergencyCooldownUntil=Date.now()+60_000;beginMeeting(room,`${player.name} called an emergency meeting.`);});
  socket.on('vote',(targetId:unknown)=>{if(!room||!player||room.phase!=='MEETING'||!room.meeting||!player.alive)return;const target=String(targetId);if(target==='skip')room.meeting.votes[player.id]='skip';else{const candidate=room.players.get(target);if(candidate?.alive)room.meeting.votes[player.id]=target;}emit(room);});
  socket.on('chat',(message:unknown)=>{if(!room||!player||room.phase!=='MEETING'||typeof message!=='string')return;const clean=message.replace(/[<>\u0000-\u001f]/g,' ').trim().slice(0,180);if(!clean)return;io.to(room.code).emit('chat',{name:player.name,text:clean});void botReply(room,player,clean);});
  socket.on('leave',()=>{if(!room||!player)return;room.players.delete(player.id);if(room.players.size===0||![...room.players.values()].some(p=>!p.bot))rooms.delete(room.code);else{if(room.host===player.id)room.host=[...room.players.values()].find(p=>!p.bot&&p.connected)?.id||'';if(room.phase==='PLAYING')finish(room);emit(room);}player=undefined;room=undefined;});
  socket.on('disconnect',()=>{if(room&&player){player.connected=false;player.moveX=0;player.moveY=0;player.movementInputAt=0;player.lastMove=Date.now();player.socketId=undefined;if(room.host===player.id)room.host=[...room.players.values()].find(p=>!p.bot&&p.connected)?.id||room.host;const disconnectedPlayer=player,disconnectedRoom=room;setTimeout(()=>{if(!disconnectedPlayer.connected&&disconnectedRoom.players.get(disconnectedPlayer.id)===disconnectedPlayer){disconnectedRoom.players.delete(disconnectedPlayer.id);if(disconnectedRoom.players.size===0||![...disconnectedRoom.players.values()].some(p=>!p.bot))rooms.delete(disconnectedRoom.code);else{if(disconnectedRoom.phase==='PLAYING')finish(disconnectedRoom);emit(disconnectedRoom);}}},30_000);emit(room);}});
});
setInterval(()=>{const now=Date.now();for(const r of rooms.values()){if(now-r.lastTick>=50){botsTick(r,now);r.lastTick=now;}if(r.sabotage&&now>r.sabotage.endsAt)r.sabotage=undefined;if(r.phase==='PLAYING'){for(const p of r.players.values())if(!p.bot)advancePlayer(p,now);}else{for(const p of r.players.values())if(!p.bot){p.moveX=0;p.moveY=0;p.lastMove=now;}}if(r.phase!=='LOBBY'&&now-r.lastStateEmitAt>=50){emit(r);r.lastStateEmitAt=now;}}},50);
http.listen(PORT,'0.0.0.0',()=>console.log(`Vice Heist listening on ${PORT}`));
