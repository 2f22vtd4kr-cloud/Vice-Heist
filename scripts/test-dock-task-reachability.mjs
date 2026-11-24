import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { io } from 'socket.io-client';
import { PNG } from 'pngjs';

const COLS=256,ROWS=128,CELL=32;
const masks=Array.from({length:8},(_,i)=>PNG.sync.read(readFileSync(`client/public/assets/map/mask-${i+1}.png`)).data);
function solid(x,y){
  if(x<0||y<0||x>=8192||y>=4096)return true;
  const col=Math.floor(x/2048),row=Math.floor(y/2048),mask=masks[row*4+col];
  const px=Math.floor(x)%2048,py=Math.floor(y)%2048,index=(py*2048+px)*4;
  return mask[index]>200&&mask[index+1]>200&&mask[index+2]>200;
}
function blocked(x,y,r=18){
  const d=r*.7071;
  return [[x-r,y],[x+r,y],[x,y-r],[x,y+r],[x-d,y-d],[x+d,y-d],[x-d,y+d],[x+d,y+d]].some(([a,b])=>solid(a,b));
}
function center(index){return{x:(index%COLS)*CELL+CELL/2,y:Math.floor(index/COLS)*CELL+CELL/2};}
function nearestWalkable(index){
  const p=center(index);if(!blocked(p.x,p.y))return index;
  const sx=index%COLS,sy=Math.floor(index/COLS);
  for(let radius=1;radius<=8;radius++)for(let y=sy-radius;y<=sy+radius;y++)for(let x=sx-radius;x<=sx+radius;x++){
    if(x<0||x>=COLS||y<0||y>=ROWS||Math.max(Math.abs(x-sx),Math.abs(y-sy))!==radius)continue;
    const q=center(y*COLS+x);if(!blocked(q.x,q.y))return y*COLS+x;
  }
  throw new Error('No walkable start cell near the human spawn.');
}
function reachable(from,target){
  const start=nearestWalkable(Math.floor(from.y/CELL)*COLS+Math.floor(from.x/CELL));
  const goal=Math.floor(target.y/CELL)*COLS+Math.floor(target.x/CELL);
  const q=new Int32Array(COLS*ROWS),seen=new Uint8Array(COLS*ROWS);let head=0,tail=0;
  q[tail++]=start;seen[start]=1;
  const dirs=[[0,-1],[1,0],[0,1],[-1,0],[1,-1],[1,1],[-1,1],[-1,-1]];
  while(head<tail){
    const at=q[head++];if(at===goal)return true;
    const cx=at%COLS,cy=Math.floor(at/COLS);
    for(const[dx,dy]of dirs){
      const x=cx+dx,y=cy+dy;if(x<0||x>=COLS||y<0||y>=ROWS)continue;
      const next=y*COLS+x;if(seen[next])continue;
      const p=center(next);if(blocked(p.x,p.y))continue;
      if(dx&&dy){const a=center(cy*COLS+x),b=center(y*COLS+cx);if(blocked(a.x,a.y)||blocked(b.x,b.y))continue;}
      seen[next]=1;q[tail++]=next;
    }
  }
  return false;
}
async function unusedPort(){
  const probe=createServer();
  await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
  const {port}=probe.address();
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  return port;
}
const port=await unusedPort(),origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['dist/server/src/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),REQUIRE_TELEGRAM_AUTH:'false'},stdio:'ignore'});
let socket;
try{
  const deadline=Date.now()+15000;let healthy=false;
  while(Date.now()<deadline){if(child.exitCode!==null)throw new Error('Game server exited unexpectedly.');try{const response=await fetch(origin+'/health');if(response.ok){healthy=true;break;}}catch{}await new Promise(resolve=>setTimeout(resolve,100));}
  assert.equal(healthy,true,'game server should become healthy');
  socket=io(origin,{transports:['websocket'],reconnection:false,timeout:5000});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  let latest;socket.on('state',state=>{latest=state;});
  const started=await new Promise(resolve=>socket.emit('solo',{name:'Dock Reachability QA'},resolve));
  assert.equal(started.ok,true,'solo room should start');
  const stateDeadline=Date.now()+3000;while(!latest&&Date.now()<stateDeadline)await new Promise(resolve=>setTimeout(resolve,50));
  assert.ok(latest,'initial state snapshot should arrive');
  const dock=latest.tasks.find(task=>task.id==='dock');
  const human=latest.players.find(player=>player.id===started.playerId);
  assert.ok(dock,'dock refuel task should exist');
  assert.ok(human,'human spawn should exist');
  assert.ok(Math.hypot(dock.x-7172,dock.y-2401)<=640,'dock objective must remain close to the boat area');
  assert.equal(blocked(dock.x,dock.y),false,'dock objective must be on a walkable collision-mask point');
  assert.equal(reachable(human,dock),true,'dock objective must be connected to the human spawn in the collision navigation graph');
  console.log('Dock task reachability regression passed: objective is walkable and connected to the player spawn.');
}finally{
  socket?.close();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));
}
