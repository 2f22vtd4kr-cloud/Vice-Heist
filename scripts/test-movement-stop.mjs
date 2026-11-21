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
const child = spawn(process.execPath, ['dist/server/src/index.js'], { cwd: process.cwd(), env: { ...process.env, PORT: String(port), REQUIRE_TELEGRAM_AUTH: 'false' }, stdio: 'ignore' });
let socket;
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
function emitAck(event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(event + ' acknowledgement timed out.')), 3_000);
    socket.emit(event, payload, value => { clearTimeout(timeout); resolve(value); });
  });
}
try {
  const deadline = Date.now() + 15_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Game server exited unexpectedly.');
    try { const response = await fetch(origin + '/health'); if (response.ok) { healthy = true; break; } } catch { /* server starting */ }
    await wait(100);
  }
  assert.equal(healthy, true, 'game server should become healthy');
  socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 5_000 });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const started = await emitAck('solo', { name: 'Movement QA' });
  assert.equal(started.ok, true, 'solo game should start');
  let latest;
  socket.on('state', state => { latest = state; });
  for (let index = 0; index < 10; index++) {
    const moved = await emitAck('move', { x: 1, y: 0 });
    assert.equal(moved.ok, true, 'movement input should be acknowledged');
    await wait(50);
  }
  const stopped = await emitAck('move', { x: 0, y: 0 });
  assert.equal(stopped.ok, true, 'release should be acknowledged');
  const stopX = stopped.x, stopY = stopped.y;
  assert.ok(Number.isFinite(stopX) && Number.isFinite(stopY), 'release acknowledgement must include authoritative coordinates');
  await wait(900);
  const player = latest?.players.find(candidate => candidate.id === started.playerId);
  assert.ok(player, 'latest server snapshot should include the local player');
  assert.ok(Math.hypot(player.x - stopX, player.y - stopY) <= 2, 'player must remain at the acknowledged release position; drifted ' + Math.hypot(player.x - stopX, player.y - stopY).toFixed(2) + ' world units');
  console.log('Movement stop regression passed: explicit release acknowledged and authoritative position remained stationary for 900ms.');
} finally {
  socket?.close();
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}
