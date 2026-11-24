import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
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
const child=spawn(process.execPath,['dist/server/src/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),REQUIRE_TELEGRAM_AUTH:'false'},stdio:'ignore'});
let socket,latest;
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ack=(event,payload)=>new Promise(resolve=>socket.emit(event,payload,resolve));
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
  const started=await ack('solo',{name:'Task Validation QA'});
  assert.equal(started.ok,true,'solo room should start');
  const stateDeadline=Date.now()+3000;
  while(!latest&&Date.now()<stateDeadline)await wait(50);
  assert.ok(latest,'initial state snapshot should arrive');
  const tasks=Object.fromEntries(latest.tasks.map(task=>[task.id,task]));
  assert.equal(Object.keys(tasks).length,8,'all eight task challenges should be present');
  assert.match(tasks.vault.challenge,/^[1-9][0-9]{3}$/,'vault challenge should be a fresh four-digit code');
  assert.deepEqual(tasks.server.challenge.split(',').sort(),['blue','gold','red','teal'],'server rack should contain each wire once');
  const serverSource=readFileSync('server/src/index.ts','utf8');
  assert.match(serverSource,/server:\(\)=>answer===challenge/,'server wire validation must accept this round\'s randomized wire order, not a hard-coded sequence');
  assert.match(tasks.generator.challenge,/^[01]{4}$/,'generator challenge should be a four-bit pattern');
  assert.notEqual(tasks.generator.challenge,'0000','generator pattern should not be all off');
  assert.notEqual(tasks.generator.challenge,'1111','generator pattern should not be all on');
  assert.ok(Number(tasks.dock.challenge)>=82&&Number(tasks.dock.challenge)<=100,'fuel target should be in range');
  assert.deepEqual(tasks.bar.challenge.split(',').sort(),['ice','lime','rum'],'cocktail recipe should contain each ingredient once');
  assert.ok(Number(tasks.pool.challenge)>=68&&Number(tasks.pool.challenge)<=76,'pool target should be in range');
  assert.ok(Number(tasks.garage.challenge)>=1600&&Number(tasks.garage.challenge)<=2600,'scan duration should be randomized in range');
  const denied=await ack('task:begin',{taskId:'server'});
  assert.equal(denied.ok,false,'a task terminal outside proximity must reject task start');
  console.log('Task validation regression passed: eight randomized challenges are present and remote task starts are rejected.');
}finally{
  socket?.close();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));
}
