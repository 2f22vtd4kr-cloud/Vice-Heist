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
const child=spawn(process.execPath,['dist/server/src/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),REQUIRE_TELEGRAM_AUTH:'false',VICE_HEIST_TEST_SEED:'1'},stdio:['ignore','ignore','pipe']});
let errors='',socket,latest;
child.stderr?.on('data',chunk=>{errors+=chunk.toString();});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
const ack=(event,payload)=>new Promise(resolve=>socket.emit(event,payload,resolve));
try{
  const deadline=Date.now()+15000;let healthy=false;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error('server exited: '+errors);
    try{const response=await fetch(origin+'/health');if(response.ok){healthy=true;break;}}catch{}
    await wait(100);
  }
  assert.equal(healthy,true,'server should start');
  socket=io(origin,{transports:['websocket'],reconnection:false,timeout:5000});
  await new Promise((resolve,reject)=>{socket.once('connect',resolve);socket.once('connect_error',reject);});
  socket.on('state',state=>{latest=state;});
  const started=await ack('solo',{name:'Door Lockdown QA'});
  assert.equal(started.ok,true,'solo round should start');
  const stateDeadline=Date.now()+3000;
  while((!latest||!Array.isArray(latest.doorGates))&&Date.now()<stateDeadline)await wait(50);
  assert.ok(latest,'initial state should arrive');
  assert.ok(latest.doorGates.length>0,'at least one door gate must validate against walkable opening and solid jambs; boot warnings: '+errors);
  assert.equal(latest.selfRole,'MOLE','seed 1 should assign the QA player as Mole');
  socket.emit('sabotage','doors');
  const activeDeadline=Date.now()+2000;
  while((latest?.sabotage?.kind!=='doors')&&Date.now()<activeDeadline)await wait(25);
  assert.equal(latest.sabotage?.kind,'doors','Mole door sabotage should activate');
  assert.ok(latest.sabotage.endsAt>Date.now(),'door lockdown should have a future expiry');
  await wait(Math.max(0,latest.sabotage.endsAt-Date.now()+150));
  assert.ok(!latest.sabotage||latest.sabotage.endsAt<=Date.now(),'door lockdown should expire automatically');
  console.log('Door lockdown regression passed: collision-mask gates validate, Mole can activate them, and the 15-second lockdown expires.');
}finally{
  socket?.close();
  child.kill('SIGTERM');
  await new Promise(resolve=>child.once('exit',resolve));
}
