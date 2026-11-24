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
  env: { ...process.env, PORT: String(port), REQUIRE_TELEGRAM_AUTH: 'false', VICE_HEIST_TEST_SEED: '20261123' },
  stdio: 'ignore',
});
let socket;

try {
  const deadline = Date.now() + 15_000;
  let healthy = false;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error('Game server exited unexpectedly (' + child.exitCode + ').');
    try { const response = await fetch(origin + '/health'); if (response.ok) { healthy = true; break; } } catch { /* starting */ }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  assert.equal(healthy, true, 'game server should become healthy');
  socket = io(origin, { transports: ['websocket'], reconnection: false, timeout: 5_000 });
  await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
  const started = await new Promise(resolve => socket.emit('solo', { name: 'Bot QA' }, resolve));
  assert.equal(started.ok, true, 'solo room should start');

  let first, latest;
  const histories = new Map();
  const gotFirst = new Promise(resolve => socket.on('state', state => {
    first ??= state;
    latest = state;
    const time = Date.now();
    for (const bot of state.players.filter(player => player.bot)) {
      let history = histories.get(bot.id);
      if (!history) { history = { name: bot.name, samples: [] }; histories.set(bot.id, history); }
      history.samples.push({
        time, x: bot.x, y: bot.y, alive: bot.alive,
        tasks: state.tasks.filter(task => !task.done).map(task => ({ x: task.x, y: task.y })),
        players: state.players.filter(player => player.id !== bot.id && player.alive).map(player => ({ x: player.x, y: player.y })),
      });
    }
    resolve();
  }));
  await gotFirst;

  const startedAt = Date.now();
  await new Promise(resolve => setTimeout(resolve, 25_000));

  const livingBots = latest.players.filter(player => player.bot && player.alive);
  const movedBots = livingBots.filter(player => {
    const initial = first.players.find(candidate => candidate.id === player.id);
    return initial && Math.hypot(player.x - initial.x, player.y - initial.y) >= 100;
  });
  const completedTasks = latest.tasks.filter(task => task.done).length;
  const stuckBots = [];

  for (const [id, history] of histories) {
    for (let window = 0; window < 5; window++) {
      const from = startedAt + window * 5_000;
      const to = from + 5_000;
      const samples = history.samples.filter(sample => sample.time >= from && sample.time <= to);
      if (samples.length < 2) continue;
      let travelled = 0;
      for (let index = 1; index < samples.length; index++) {
        travelled += Math.hypot(samples[index].x - samples[index - 1].x, samples[index].y - samples[index - 1].y);
      }
      const last = samples[samples.length - 1];
      if (!last.alive || travelled >= 40) continue;
      const nearTask = last.tasks.some(task => Math.hypot(task.x - last.x, task.y - last.y) < 130);
      const nearPlayer = last.players.some(player => Math.hypot(player.x - last.x, player.y - last.y) < 150);
      if (!nearTask && !nearPlayer) stuckBots.push(history.name + ' (window ' + (window + 1) + ', travelled ' + Math.round(travelled) + ')');
    }
  }

  assert.ok(livingBots.length >= 3, 'expected at least three surviving NPCs, observed ' + livingBots.length);
  assert.ok(movedBots.length >= Math.min(2, livingBots.length), 'expected at least two surviving bots to navigate, observed ' + movedBots.length + '/' + livingBots.length);
  assert.ok(completedTasks >= 1, 'expected crew bots to complete an estate task, observed ' + completedTasks);
  const humanPlayer=latest.players.find(player=>player.id===started.playerId);
  // A human crew member is the priority target for killer NPCs in solo QA.
  if(latest.selfRole==='CREW'){
    assert.equal(humanPlayer.alive,false,'when the human is Crew, the killer NPC must successfully eliminate the human during the 25-second bot hunt regression');
  }
  assert.deepEqual(stuckBots, [], 'living bots must not remain stationary away from tasks or other players: ' + stuckBots.join(', '));
  console.log('Bot navigation regression passed: ' + movedBots.length + '/' + livingBots.length + ' surviving bots moved at least 100 world units; ' + completedTasks + ' tasks completed; no unattended stationary bots across five 5-second windows.');
} finally {
  socket?.close();
  child.kill('SIGTERM');
  await new Promise(resolve => child.once('exit', resolve));
}
