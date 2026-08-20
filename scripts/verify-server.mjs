/**
 * Prove the deployed server actually works.
 *
 * The unit tests start the server in-process with `startServer({port: 0})`,
 * which is a different thing from what a host runs. A container starts a bare
 * `node packages/server/dist/cli.js`, hands it configuration through the
 * environment and nothing else, waits for `/health` before routing traffic at
 * it, and eventually sends it a SIGTERM. Every one of those is a place a
 * deployment can be broken while every test still passes.
 *
 * So this launches the server exactly the way the Dockerfile's ENTRYPOINT does
 * — separate process, config from the environment only — and then:
 *
 *   - waits for /health the way an orchestrator would;
 *   - checks the environment actually configured the thing it claims to;
 *   - plays a real two-player match against it over websockets;
 *   - checks the baked-in client is served from the same origin, because that
 *     is what lets a browser infer its own server with no configuration;
 *   - sends SIGTERM and requires a clean exit inside the grace period.
 *
 * What this cannot do is build the image. Run `npm run verify:docker` on a
 * machine with a Docker daemon for that.
 */
import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { setTimeout as sleep } from 'node:timers/promises';
import { WebSocket } from 'ws';
import {
  INTENT_CREATE,
  INTENT_JOIN,
  IN_JUMP,
  IN_RIGHT,
  NetClient,
  hashWorld,
} from '../packages/core/dist/index.js';

const PORT = Number(process.env.VERIFY_PORT ?? 8971);
const STATIC = new URL('../packages/client/dist', import.meta.url).pathname;
const ORIGIN = `http://127.0.0.1:${PORT}`;

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    console.log(`  FAIL  ${name} ${detail}`);
    failures.push(name);
  }
}

/** Adapts the `ws` client to the transport the netcode client expects. */
function wsTransport(url) {
  const socket = new WebSocket(url);
  socket.binaryType = 'nodebuffer';
  const transport = {
    onOpen: null,
    onMessage: null,
    onClose: null,
    send(bytes) {
      if (socket.readyState === WebSocket.OPEN) socket.send(bytes, { binary: true });
    },
    close() {
      socket.close();
    },
  };
  socket.on('open', () => transport.onOpen?.());
  socket.on('message', (data) => transport.onMessage?.(new Uint8Array(data)));
  socket.on('close', () => transport.onClose?.('closed'));
  socket.on('error', () => transport.onClose?.('error'));
  return transport;
}

/** Awaits the predicate, so an async probe like a fetch works as a condition. */
async function waitFor(predicate, label, timeoutMs = 8000) {
  const started = Date.now();
  for (;;) {
    if (await predicate()) return;
    if (Date.now() - started > timeoutMs) throw new Error(`timed out waiting for ${label}`);
    await sleep(15);
  }
}

if (!existsSync('packages/server/dist/cli.js')) {
  console.error('Build first: npm run build');
  process.exit(1);
}

// Exactly the Dockerfile's ENTRYPOINT, configured exactly the way the compose
// file configures it: through the environment, with no command line flags.
const server = spawn(process.execPath, ['packages/server/dist/cli.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'production',
    PORT: String(PORT),
    HOST: '127.0.0.1',
    HAULMATES_STATIC: STATIC,
    HAULMATES_LOG: 'warn',
    HAULMATES_MAX_ROOMS: '7',
  },
  stdio: ['ignore', 'inherit', 'inherit'],
});

let exitCode = null;
let exitSignal = null;
server.on('exit', (code, signal) => {
  exitCode = code;
  exitSignal = signal;
});

async function main() {
  /* ------------------------------------------- the orchestrator's handshake */
  const readyAt = Date.now();
  await waitFor(
    async () => {
      try {
        const r = await fetch(`${ORIGIN}/health`);
        return r.ok;
      } catch {
        return false;
      }
    },
    '/health to come up',
    15000,
  );
  const health = await fetch(`${ORIGIN}/health`).then((r) => r.json());
  check('the server answers /health with 200 and {ok:true}', health.ok === true, JSON.stringify(health));
  console.log(`  ...ready in ${Date.now() - readyAt}ms`);

  /* --------------------------------------- configuration came from the env */
  // The port is the loudest proof the environment was read at all: nothing on
  // the command line said 8971.
  const stats = await fetch(`${ORIGIN}/stats`).then((r) => r.json());
  check('the port came from the environment', typeof stats.uptime === 'number', JSON.stringify(stats));
  check('the server starts with no rooms', stats.rooms === 0 && stats.players === 0, JSON.stringify(stats));

  /* ------------------------------------------------ the client, same origin */
  const index = await fetch(`${ORIGIN}/`);
  const html = await index.text();
  check(
    'the baked-in client is served from the same origin as the socket',
    index.status === 200 && html.includes('id="stage"'),
    `${index.status} ${html.length}b`,
  );
  check(
    'a deep link still loads the game shell',
    (await fetch(`${ORIGIN}/join/ABCDE`)).status === 200,
  );

  /* ------------------------------------------------------- a real live match */
  const host = new NetClient({
    transport: wsTransport(`ws://127.0.0.1:${PORT}`),
    name: 'ALPHA',
    intent: INTENT_CREATE,
    mode: 0,
    seed: 909_000,
    towerLength: 4,
  });
  await waitFor(() => host.roomCode !== '', 'a room code');
  check('a player can open a haul on the deployed server', /^[A-Z0-9]{5}$/.test(host.roomCode), host.roomCode);

  const guest = new NetClient({
    transport: wsTransport(`ws://127.0.0.1:${PORT}`),
    name: 'BRAVO',
    intent: INTENT_JOIN,
    room: host.roomCode,
  });
  await waitFor(() => guest.localIndex === 1, 'the guest to join');
  host.ready(true);
  guest.ready(true);
  await waitFor(() => host.phase === 'running' && guest.phase === 'running', 'the match to start');
  check('two players reach a running match', true);

  const started = Date.now();
  while (Date.now() - started < 3000) {
    const tick = Math.max(host.localTick, guest.localTick);
    host.update(16, [tick % 40 < 20 ? IN_RIGHT : IN_JUMP, 0]);
    guest.update(16, [0, tick % 30 < 15 ? IN_JUMP : IN_RIGHT]);
    await sleep(8);
  }
  for (let i = 0; i < 60; i++) {
    host.update(16, [0, 0]);
    guest.update(16, [0, 0]);
    await sleep(16);
  }

  check('the simulation ran on both clients', host.localTick > 100 && guest.localTick > 100,
    `${host.localTick}/${guest.localTick}`);
  check('neither client desynced', host.desyncs === 0 && guest.desyncs === 0,
    `${host.desyncs}/${guest.desyncs}`);
  if (host.confirmedTick === guest.confirmedTick && host.confirmedWorld && guest.confirmedWorld) {
    check('both clients hold a byte-identical world', hashWorld(host.confirmedWorld) === hashWorld(guest.confirmedWorld));
  }

  const busy = await fetch(`${ORIGIN}/stats`).then((r) => r.json());
  check('the server reports the live room', busy.running === 1 && busy.players === 2, JSON.stringify(busy));

  host.dispose();
  guest.dispose();

  /* -------------------------------------------------------- graceful SIGTERM */
  // Managed hosts send SIGTERM and kill the container a short while later. If
  // the process ignores it, every deploy drops every match mid-run.
  const stopping = Date.now();
  server.kill('SIGTERM');
  await waitFor(() => exitCode !== null || exitSignal !== null, 'the server to exit', 10000).catch(() => {});
  check('SIGTERM shuts the server down cleanly', exitCode === 0,
    `code=${exitCode} signal=${exitSignal} after ${Date.now() - stopping}ms`);
}

main()
  .catch((err) => {
    check('the verification ran to completion', false, err.message);
  })
  .finally(async () => {
    if (exitCode === null && exitSignal === null) server.kill('SIGKILL');
    await sleep(150);
    if (failures.length > 0) {
      console.error(`\nServer verification: ${failures.length} check(s) failed`);
      process.exit(1);
    }
    console.log('\nServer verification: all checks passed.');
  });
