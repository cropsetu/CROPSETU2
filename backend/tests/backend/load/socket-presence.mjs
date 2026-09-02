/**
 * Measures the cost of Socket.IO presence broadcast.
 *
 * chat.socket.js announces every connect with `io.emit('user_online', …)` and
 * every disconnect with `io.emit('user_offline', …)`. `io.emit` reaches EVERY
 * connected socket, so one user opening the app costs N frames when N users are
 * online — the work per event grows with the size of the audience, and the work
 * per SECOND grows with (churn × audience).
 *
 * This script connects N clients, then makes a few more connect and disconnect,
 * and counts the frames the existing clients actually receive. If frames per
 * event ≈ N, the fan-out is linear in connected users and the total is quadratic
 * in a population that churns — which is what decides whether 10k is reachable.
 *
 * Usage:
 *   node tests/backend/load/mint-tokens.mjs > /tmp/tokens.json
 *   node tests/backend/load/socket-presence.mjs \
 *        --url http://localhost:3005 --tokens /tmp/tokens.json --n 300
 */
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';

// socket.io-client lives in the mobile apps, not the backend — load it from there
// rather than adding a dependency the server does not need.
const require = createRequire(import.meta.url);
const CLIENT_PATH = path.resolve(process.cwd(), '../frontend/node_modules/socket.io-client');
const { io } = require(CLIENT_PATH);

const arg = (k, d) => {
  const i = process.argv.indexOf(`--${k}`);
  return i > -1 ? process.argv[i + 1] : d;
};
const URL      = arg('url', 'http://localhost:3005');
const TOKENS   = JSON.parse(fs.readFileSync(arg('tokens', 'tokens.json'), 'utf8'));
const N        = parseInt(arg('n', '200'), 10);
const PER_USER = parseInt(arg('perUser', '10'), 10); // must match SOCKET_MAX_CONN_PER_USER
const PROBES   = parseInt(arg('probes', '5'), 10);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let onlineFrames = 0;
let offlineFrames = 0;
const sockets = [];

function connectOne(i) {
  return new Promise((resolve) => {
    const token = TOKENS[Math.floor(i / PER_USER) % TOKENS.length].token;
    const s = io(URL, {
      transports: ['websocket'],
      auth: { token },
      reconnection: false,
      timeout: 20000,
    });
    s.on('user_online',  () => { onlineFrames++; });
    s.on('user_offline', () => { offlineFrames++; });
    s.on('connect', () => resolve(s));
    s.on('connect_error', (e) => resolve({ failed: e.message }));
  });
}

const capacity = TOKENS.length * PER_USER;
if (N > capacity) {
  console.error(`[warn] ${N} sockets exceeds ${TOKENS.length} users x ${PER_USER}/user = ${capacity}; capping`);
}
const target = Math.min(N, capacity - PROBES);

console.log(`Connecting ${target} observer sockets to ${URL} …`);
const t0 = Date.now();
let failed = 0;
for (let i = 0; i < target; i += 25) {
  const batch = await Promise.all(
    Array.from({ length: Math.min(25, target - i) }, (_, j) => connectOne(i + j)),
  );
  for (const s of batch) { if (s.failed) failed++; else sockets.push(s); }
  await sleep(40); // gentle arrival: we are measuring fan-out, not accept bursts
}
await sleep(1500);
console.log(`Connected ${sockets.length} (failed ${failed}) in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

// Reset counters: everything above was the observers announcing each other.
const settleOnline = onlineFrames, settleOffline = offlineFrames;
onlineFrames = 0; offlineFrames = 0;

console.log(`\nNow connecting + disconnecting ${PROBES} more sockets, one at a time …`);
const perEvent = [];
for (let p = 0; p < PROBES; p++) {
  const before = onlineFrames;
  const s = await connectOne(target + p);
  if (s.failed) { console.log(`  probe ${p + 1}: connect failed (${s.failed})`); continue; }
  await sleep(700);
  const onConnect = onlineFrames - before;
  const beforeOff = offlineFrames;
  s.disconnect();
  await sleep(700);
  const onDisconnect = offlineFrames - beforeOff;
  perEvent.push({ onConnect, onDisconnect });
  console.log(`  probe ${p + 1}: connect → ${onConnect} frames delivered, disconnect → ${onDisconnect} frames`);
}

const avgC = perEvent.length ? perEvent.reduce((a, x) => a + x.onConnect, 0) / perEvent.length : 0;
const avgD = perEvent.length ? perEvent.reduce((a, x) => a + x.onDisconnect, 0) / perEvent.length : 0;

console.log(`\n── Result ─────────────────────────────────────────────`);
console.log(`observers online          : ${sockets.length}`);
console.log(`frames per connect        : ${avgC.toFixed(0)}  (${(avgC / Math.max(sockets.length, 1)).toFixed(2)} x online users)`);
console.log(`frames per disconnect     : ${avgD.toFixed(0)}  (${(avgD / Math.max(sockets.length, 1)).toFixed(2)} x online users)`);
console.log(`frames during ramp-up     : ${settleOnline} online / ${settleOffline} offline`);
console.log(`\nExtrapolation at the same ratio:`);
for (const users of [1000, 5000, 10000]) {
  const ratio = avgC / Math.max(sockets.length, 1);
  const perEventFrames = Math.round(users * ratio);
  console.log(`  ${String(users).padStart(6)} online, 1% churn/s → ${(users * 0.01).toFixed(0)} events/s`
    + ` x ${perEventFrames} frames = ${((users * 0.01 * perEventFrames) / 1e6).toFixed(2)} M frames/s`);
}

for (const s of sockets) s.disconnect();
await sleep(500);
process.exit(0);
