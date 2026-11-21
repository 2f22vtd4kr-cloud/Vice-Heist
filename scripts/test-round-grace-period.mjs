import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { io } from 'socket.io-client';

async function unusedPort() {
  const probe=createServer();
  await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
  const {port}=probe.address();
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  return port;
}
const port=await unusedPort(),origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['dist/server/src/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),REQUIRE_TELEGRAM_AUTH:'false'},stdio:'ignore'});
let socket,latest;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  const deadline=Date.now()+15000;let healthy=false;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error('Game server exited unexpectedly.');
    try{const response=await fetch(origin+'/health');if(response.ok){healthy=true;break;}}catch{}
    await wait(100);
  }
  assert.equal(healthy,true,'game server should become healthy');
  socket=io(origin,{transports:['websocket'],reconnection:false,timeout:5000});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  socket.on('state',state=>{latest=state;});
  const started=await new Promise(resolve=>socket.emit('solo',{name:'Round Grace QA'},resolve));
  assert.equal(started.ok,true,'solo round should start');
  const stateDeadline=Date.now()+3000;
  while(!latest&&Date.now()<stateDeadline)await wait(50);
  assert.ok(latest,'initial round snapshot should arrive');
  assert.equal(latest.phase,'PLAYING');
  assert.equal(latest.players.filter(p=>p.bot).length,5);
  assert.ok(latest.players.every(p=>p.alive),'all players must begin alive');
  await wait(3500);
  assert.ok(latest.players.every(p=>p.alive),'no human or AI Mole may eliminate anyone during the 12-second round-start grace period');
  console.log('Round-start elimination grace regression passed: all five NPCs and the human remained alive during the opening window.');
}finally{
  socket?.close();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));
}
