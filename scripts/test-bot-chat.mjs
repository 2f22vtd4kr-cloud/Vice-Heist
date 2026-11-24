import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { io } from 'socket.io-client';

async function unusedPort(){
  const probe=createServer();
  await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
  const {port}=probe.address();
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  return port;
}
const port=await unusedPort(),origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['dist/server/src/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),REQUIRE_TELEGRAM_AUTH:'false',VICE_HEIST_TEST_SEED:'90124'},stdio:'ignore'});
let socket,latest;
const chat=[];
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
  socket.on('chat',message=>chat.push(message));
  const started=await new Promise(resolve=>socket.emit('solo',{name:'NPC Social QA'},resolve));
  assert.equal(started.ok,true,'solo room should start');
  const stateDeadline=Date.now()+3000;
  while((!latest||latest.phase!=='PLAYING')&&Date.now()<stateDeadline)await wait(50);
  assert.equal(latest?.phase,'PLAYING','solo round should be active');
  const botNames=new Set(latest.players.filter(player=>player.bot).map(player=>player.name));
  assert.ok(botNames.size>=4,'solo mode should include multiple NPCs');
  socket.emit('emergency');
  const meetingDeadline=Date.now()+2000;
  while(latest?.phase!=='MEETING'&&Date.now()<meetingDeadline)await wait(50);
  assert.equal(latest?.phase,'MEETING','emergency should open a discussion');
  socket.emit('chat','Where are you now?');
  const firstDeadline=Date.now()+2000;
  while(chat.filter(message=>botNames.has(message.name)).length<2&&Date.now()<firstDeadline)await wait(25);
  const first=chat.filter(message=>botNames.has(message.name));
  assert.equal(first.length,2,'two distinct NPCs should respond to the first message');
  assert.ok(first.every(message=>/near|by|around/i.test(message.text)),'NPCs should answer location questions using their current estate sector');
  socket.emit('chat','Who can confirm what happened near the generator?');
  const secondDeadline=Date.now()+2000;
  while(chat.filter(message=>botNames.has(message.name)).length<4&&Date.now()<secondDeadline)await wait(25);
  const all=chat.filter(message=>botNames.has(message.name));
  assert.equal(all.length,4,'another two NPCs should respond to the next message');
  assert.equal(new Set(all.map(message=>message.name)).size,4,'NPC response cooldowns should rotate the speakers instead of repeating the same two bots');
  console.log('NPC conversation regression passed: location-aware replies and rotating, rate-limited NPC speakers.');
}finally{
  if(socket)socket.close();
  if(child.exitCode===null&&child.signalCode===null){
    child.kill('SIGTERM');
    await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);});
  }
}
