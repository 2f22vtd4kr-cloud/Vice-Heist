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
let socket;

try {
  const deadline = Date.now() + 15_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Game server exited unexpectedly (${child.exitCode}).`);
    try { const response = await fetch(`${origin}/health`); if (response.ok) { healthy = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(healthy, true, 'game server should become healthy');
  socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 5_000 });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const started = await new Promise(resolve => socket.emit('solo', { name: 'Bot QA' }, resolve));
  assert.equal(started.ok, true, 'solo room should start');

  let first, latest;
  const gotFirst = new Promise(resolve => socket.on('state', state => { first ??= state; latest = state; resolve(); }));
  await gotFirst;
  await new Promise(resolve => setTimeout(resolve, 22_000));

  const movedBots = latest.players.filter(player => player.bot).filter(player => {
    const initial = first.players.find(candidate => candidate.id === player.id);
    return initial && Math.hypot(player.x - initial.x, player.y - initial.y) >= 100;
  });
  const completedTasks = latest.tasks.filter(task => task.done).length;
  assert.ok(movedBots.length >= 4, `expected at least four bots to navigate, observed ${movedBots.length}`);
  assert.ok(completedTasks >= 1, `expected crew bots to complete an estate task, observed ${completedTasks}`);
  console.log(`Bot navigation regression passed: ${movedBots.length}/5 bots moved at least 100 world units; ${completedTasks} tasks completed in 22 seconds.`);
} finally {
  socket?.close();
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}
