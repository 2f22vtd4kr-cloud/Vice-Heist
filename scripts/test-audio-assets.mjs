import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';

async function unusedPort(){
  const probe=createServer();
  await new Promise((resolve,reject)=>probe.once('error',reject).listen(0,'127.0.0.1',resolve));
  const {port}=probe.address();
  await new Promise((resolve,reject)=>probe.close(error=>error?reject(error):resolve()));
  return port;
}
const port=await unusedPort(),origin='http://127.0.0.1:'+port;
const child=spawn(process.execPath,['dist/server/src/index.js'],{cwd:process.cwd(),env:{...process.env,PORT:String(port),REQUIRE_TELEGRAM_AUTH:'false'},stdio:'ignore'});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
try{
  const deadline=Date.now()+15000;let healthy=false;
  while(Date.now()<deadline){
    if(child.exitCode!==null)throw new Error('Game server exited unexpectedly.');
    try{const response=await fetch(origin+'/health');if(response.ok){healthy=true;break;}}catch{}
    await wait(100);
  }
  assert.equal(healthy,true,'game server should become healthy');
  const tracks=[
    {url:'/audio/kleiner-finger.m4a',mime:'audio/mp4'},
    {url:'/audio/rose-bianche.mp3',mime:'audio/mpeg'},
  ];
  for(const track of tracks){
    const response=await fetch(origin+track.url);
    assert.equal(response.status,200,track.url+' should be served');
    assert.ok(response.headers.get('content-type')?.includes(track.mime),track.url+' should use the correct audio MIME type');
    const bytes=await response.arrayBuffer();
    assert.ok(bytes.byteLength>100_000,track.url+' should contain the uploaded audio bytes, not an empty placeholder');
    const range=await fetch(origin+track.url,{headers:{Range:'bytes=0-1023'}});
    assert.equal(range.status,206,track.url+' should support byte-range streaming');
    assert.match(range.headers.get('content-range')||'',/^bytes 0-1023\//,track.url+' should return the requested byte range');
    assert.equal((await range.arrayBuffer()).byteLength,1024,track.url+' should return exactly 1 KiB for the range request');
  }
  console.log('Playlist audio regression passed: both uploaded tracks serve with correct MIME types and HTTP byte-range support.');
}finally{
  if(child.exitCode===null&&child.signalCode===null){
    child.kill('SIGTERM');
    await new Promise(resolve=>{if(child.exitCode!==null||child.signalCode!==null)return resolve();child.once('exit',resolve);});
  }
}
