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
const child=spawn(process.execPath,['dist/server/src/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),REQUIRE_TELEGRAM_AUTH:'false',VICE_HEIST_TEST_SEED:'418'},stdio:'ignore'});
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
  const started=await ack('solo',{name:'Vent Network QA'});
  assert.equal(started.ok,true,'solo room should start');
  const stateDeadline=Date.now()+3000;
  while((!latest||!latest.vents)&&Date.now()<stateDeadline)await wait(50);
  assert.ok(latest,'initial state snapshot should arrive');
  assert.ok(Array.isArray(latest.vents),'snapshot should include a vent list');
  if(latest.selfRole==='MOLE'){
    assert.equal(latest.vents.length,8,'Mole should receive all eight sector vent anchors');
    const sectors=new Set(latest.vents.map(v=>v.sector));
    assert.equal(sectors.size,8,'vent network should cover all eight sectors');
    for(const vent of latest.vents){
      assert.ok(vent.x>=0&&vent.x<8192&&vent.y>=0&&vent.y<4096,'vent coordinates must stay inside the estate');
      assert.ok(vent.id,'each vent must have a stable identifier');
    }
    const denied=await ack('vent:travel',{ventId:'not-a-real-vent'});
    assert.equal(denied.ok,false,'unknown vent identifiers must be rejected');
    assert.match(denied.error,/not part of this estate/,'unknown vent identifiers must be rejected');
  }else{
    assert.equal(latest.vents.length,0,'Crew snapshots must not reveal hidden vent locations');
    const denied=await ack('vent:travel',{ventId:'helipad'});
    assert.equal(denied.ok,false,'Crew must not use the Mole vent network');
    assert.match(denied.error,/Only a living Mole/,'vent access must be role-gated');
  }
  console.log('Vent network regression passed: eight sector anchors are published and unauthorized/unknown travel is rejected.');
}finally{
  socket?.close();child.kill('SIGTERM');await new Promise(resolve=>child.once('exit',resolve));
}
