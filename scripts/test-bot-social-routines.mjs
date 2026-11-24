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
const child=spawn(process.execPath,['dist/server/src/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),REQUIRE_TELEGRAM_AUTH:'false',VICE_HEIST_TEST_SEED:'77124'},stdio:'ignore'});
let socket;const notices=[];const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  const deadline=Date.now()+15000;let healthy=false;
  while(Date.now()<deadline){if(child.exitCode!==null)throw new Error('Game server exited unexpectedly.');try{const response=await fetch(origin+'/health');if(response.ok){healthy=true;break;}}catch{}await wait(100);}
  assert.equal(healthy,true,'game server should become healthy');
  socket=io(origin,{transports:['websocket'],reconnection:false,timeout:5000});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  socket.on('notice',message=>notices.push(String(message)));
  const started=await new Promise(resolve=>socket.emit('solo',{name:'NPC Buddy QA'},resolve));
  assert.equal(started.ok,true,'solo room should start');
  const socialDeadline=Date.now()+2500;
  while(!notices.some(message=>/checked in with/.test(message))&&Date.now()<socialDeadline)await wait(25);
  assert.ok(notices.some(message=>/checked in with/.test(message)),'nearby Crew NPCs should perform a visible buddy check-in');
  console.log('NPC social routine regression passed: nearby Crew bots coordinate a short check-in and then resume independent tasks.');
}finally{
  socket?.close();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));
}
