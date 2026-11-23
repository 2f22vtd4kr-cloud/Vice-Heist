import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { io } from 'socket.io-client';

async function unusedPort() {
  const probe = createServer();
  await new Promise((resolve, reject) => probe.once('error', reject).listen(0, '127.0.0.1', resolve));
  const { port } = probe.address();
  await new Promise((resolve, reject) => probe.close(error => error ? reject(error) : resolve()));
  return port;
}
const port = await unusedPort();
const origin = 'http://127.0.0.1:' + port;
const child = spawn(process.execPath, ['dist/server/src/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), REQUIRE_TELEGRAM_AUTH: 'false' },
  stdio: 'ignore',
});
const sockets = [];
const latest = new Map();
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
async function waitFor(predicate, timeoutMs = 8_000, message = 'condition') {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    const value = predicate();
    if (value) return value;
    if (child.exitCode !== null) throw new Error('Game server exited unexpectedly.');
    await wait(25);
  }
  throw new Error('Timed out waiting for ' + message + '.');
}
function connect() {
  const socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 5_000 });
  sockets.push(socket);
  socket.on('state', state => latest.set(socket, state));
  return new Promise((resolve, reject) => {
    socket.once('connect', () => resolve(socket));
    socket.once('connect_error', reject);
  });
}
function ack(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error(event + ' acknowledgement timed out.')), 3_000);
    socket.emit(event, payload, result => { clearTimeout(timer); resolve(result); });
  });
}
try {
  await waitFor(async () => {
    try { const response = await fetch(origin + '/health'); return response.ok; }
    catch { return false; }
  }, 15_000, 'server health');
  const host = await connect();
  const created = await ack(host, 'create', { name: 'Ghost movement host' });
  assert.equal(created.ok, true);
  const clients = [{ socket: host, id: created.playerId }];
  for (let i = 0; i < 3; i++) {
    const socket = await connect();
    const joined = await ack(socket, 'join', { code: created.code, name: 'Ghost movement ' + i });
    assert.equal(joined.ok, true);
    clients.push({ socket, id: joined.playerId });
  }
  host.emit('start');
  await waitFor(() => clients.every(c => latest.get(c.socket)?.phase === 'PLAYING'), 5_000, 'round start');
  const mole = await waitFor(() => clients.find(c => latest.get(c.socket)?.selfRole === 'MOLE'), 3_000, 'Mole assignment');
  const victim = clients.filter(c => c.id !== mole.id).sort((a,b) => {
    const p=latest.get(mole.socket)?.players.find(x=>x.id===mole.id);
    const pa=latest.get(mole.socket)?.players.find(x=>x.id===a.id);
    const pb=latest.get(mole.socket)?.players.find(x=>x.id===b.id);
    return Math.hypot(pa.x-p.x,pa.y-p.y)-Math.hypot(pb.x-p.x,pb.y-p.y);
  })[0];
  const moleState=latest.get(mole.socket);
  const molePlayer=moleState.players.find(p=>p.id===mole.id);
  const victimPlayer=moleState.players.find(p=>p.id===victim.id);
  assert.ok(Math.hypot(victimPlayer.x-molePlayer.x,victimPlayer.y-molePlayer.y)<=125,'spawned crew member should be in elimination range');
  await wait(12_200);
  mole.socket.emit('kill', victim.id);
  await waitFor(() => latest.get(victim.socket)?.players.find(p=>p.id===victim.id)?.alive===false, 3_000, 'authoritative elimination');
  const before=latest.get(victim.socket).players.find(p=>p.id===victim.id);
  let requestId=0;
  const epoch=1;
  for(let i=0;i<10;i++){
    await ack(victim.socket,'move',{x:1,y:0,epoch,requestId:++requestId});
    await wait(50);
  }
  const after=await waitFor(()=>{
    const p=latest.get(victim.socket)?.players.find(x=>x.id===victim.id);
    return p&&Math.hypot(p.x-before.x,p.y-before.y)>35?p:null;
  },3_000,'ghost movement snapshots');
  assert.equal(after.alive,false,'the moving player must remain eliminated');
  await ack(victim.socket,'move',{x:0,y:0,epoch:epoch+1,requestId:++requestId});
  console.log('Ghost movement regression passed: an eliminated player can move under server authority while remaining dead.');
} finally {
  for (const socket of sockets) socket.close();
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}
