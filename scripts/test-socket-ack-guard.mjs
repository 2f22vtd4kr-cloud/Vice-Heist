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
const origin = `http://127.0.0.1:${port}`;
const child = spawn(process.execPath, ['dist/server/src/index.js'], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: String(port), REQUIRE_TELEGRAM_AUTH: 'false' },
  stdio: 'ignore',
});
const sockets = [];

async function waitForServer() {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Game server exited unexpectedly (${child.exitCode}).`);
    try {
      const response = await fetch(`${origin}/health`);
      if (response.ok) return;
    } catch { /* server is still starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error('Game server did not become healthy within 15 seconds.');
}

async function connect() {
  const socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 5_000 });
  sockets.push(socket);
  await new Promise((resolve, reject) => {
    socket.once('connect', resolve);
    socket.once('connect_error', reject);
  });
  return socket;
}

function emitWithAck(socket, event, payload) {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`${event} acknowledgement timed out.`)), 5_000);
    socket.emit(event, payload, value => {
      clearTimeout(timeout);
      resolve(value);
    });
  });
}

async function assertServerHealthy() {
  await new Promise(resolve => setTimeout(resolve, 100));
  assert.equal(child.exitCode, null, 'an event without an acknowledgement must not crash the server');
  const response = await fetch(`${origin}/health`);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json().then(({ ok, game }) => ({ ok, game })), { ok: true, game: 'Vice Heist' });
}

try {
  await waitForServer();

  const noAckCreate = await connect();
  noAckCreate.emit('create', { name: 'NoAckCreate' });
  await assertServerHealthy();

  const host = await connect();
  const created = await emitWithAck(host, 'create', { name: 'Host' });
  assert.equal(created.ok, true);

  const noAckJoin = await connect();
  noAckJoin.emit('join', { code: created.code, name: 'NoAckJoin' });
  await assertServerHealthy();

  const noAckResume = await connect();
  noAckResume.emit('resume', { code: created.code, sessionKey: created.sessionKey });
  await assertServerHealthy();

  const solo = await connect();
  const started = await emitWithAck(solo, 'solo', { name: 'SoloTest' });
  assert.equal(started.ok, true);
  await assertServerHealthy();

  console.log('Socket acknowledgement guard integration test passed (create, join, resume, solo).');
} finally {
  for (const socket of sockets) socket.close();
  child.kill('SIGTERM');
}
