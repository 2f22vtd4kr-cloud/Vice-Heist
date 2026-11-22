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
let movementEpoch = 0;
let movementRequestId = 0;
function sendMove(x, y, epoch = movementEpoch, requestId = ++movementRequestId) {
  return emitAck('move', { x, y, epoch, requestId });
}
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
  const snapshotDeadline = Date.now() + 3_000;
  while (Date.now() < snapshotDeadline && !latest?.players?.some(candidate => candidate.id === started.playerId)) await wait(20);
  const initial = latest?.players.find(candidate => candidate.id === started.playerId);
  assert.ok(initial, 'authoritative starting snapshot should include the local player');
  const startX = initial.x, startY = initial.y;

  const waitForPlayer = async (timeoutMs = 2_000) => {
    const until = Date.now() + timeoutMs;
    while (Date.now() < until) {
      const current = latest?.players?.find(candidate => candidate.id === started.playerId);
      if (current) return current;
      await wait(20);
    }
    throw new Error('Timed out waiting for an authoritative player snapshot.');
  };
  const fullStart = await waitForPlayer();
  movementEpoch = 1;
  await sendMove(1, 0);
  await wait(320);
  const fullEnd = await waitForPlayer();
  const fullDistance = fullEnd.x - fullStart.x;
  assert.ok(fullDistance >= 80 && fullDistance <= 145, 'held full-speed input should advance about 118 world units in 320ms; advanced ' + fullDistance.toFixed(2));

  movementEpoch = 2;
  const stopped = await sendMove(0, 0);
  assert.equal(stopped.ok, true, 'release should be acknowledged');
  const stopX = stopped.x, stopY = stopped.y;
  assert.ok(Number.isFinite(stopX) && Number.isFinite(stopY), 'release acknowledgement must include authoritative coordinates');
  await wait(900);
  let player = await waitForPlayer();
  assert.ok(Math.hypot(player.x - stopX, player.y - stopY) <= 2, 'player must remain at the acknowledged release position; drifted ' + Math.hypot(player.x - stopX, player.y - stopY).toFixed(2) + ' world units');
  const stale = await sendMove(1, 0, 1, movementRequestId + 1);
  assert.equal(stale.ok, false, 'server must reject a delayed movement packet from a completed epoch');
  await wait(250);
  player = await waitForPlayer();
  assert.ok(Math.hypot(player.x - stopX, player.y - stopY) <= 2, 'stale movement must not restart after release');

  const analogStart = player;
  movementEpoch = 3;
  await sendMove(0.25, 0);
  await wait(320);
  player = await waitForPlayer();
  const analogDistance = player.x - analogStart.x;
  assert.ok(analogDistance >= 16 && analogDistance <= 42, '25% joystick deflection should move at about 25% speed; advanced ' + analogDistance.toFixed(2));
  movementEpoch = 4;
  const analogStop = await sendMove(0, 0);
  await wait(900);
  player = await waitForPlayer();
  assert.ok(Math.hypot(player.x - analogStop.x, player.y - analogStop.y) <= 2, 'analog release must remain stationary');
  console.log('Movement regression passed: server-tick movement advanced ' + fullDistance.toFixed(2) + ' units at full input and ' + analogDistance.toFixed(2) + ' units at 25% input; both releases held stationary.');

  const resumedSocket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 5_000 });
  await new Promise((resolve, reject) => { resumedSocket.once('connect', resolve); resumedSocket.once('connect_error', reject); });
  socket.close();
  socket = resumedSocket;
  latest = undefined;
  socket.on('state', state => { latest = state; });
  const resumed = await emitAck('resume', { code: started.code, sessionKey: started.sessionKey });
  assert.equal(resumed.ok, true, 'existing session should resume');
  movementEpoch = 1;
  movementRequestId = 0;
  await sendMove(1, 0);
  await wait(220);
  player = await waitForPlayer();
  assert.ok(player.x > analogStop.x + 30, 'movement must work after reconnect resets the server epoch');
  movementEpoch = 2;
  const reconnectStop = await sendMove(0, 0);
  await wait(200);
  player = await waitForPlayer();
  assert.ok(Math.hypot(player.x - reconnectStop.x, player.y - reconnectStop.y) <= 2, 'reconnected movement release must remain stationary');

} finally {
  socket?.close();
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}
