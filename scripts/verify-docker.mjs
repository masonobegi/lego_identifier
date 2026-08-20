/**
 * Build the container and play a match against it.
 *
 * scripts/verify-server.mjs proves the entrypoint, the environment-only
 * configuration and the shutdown behaviour, which is most of what goes wrong.
 * It cannot prove the image: that the base image has what the server needs,
 * that every COPY path resolves, that `npm prune --omit=dev` did not remove a
 * runtime dependency, that the thing runs as a non-root user.
 *
 * This does. It needs a Docker daemon, so it is not part of `npm run verify`
 * — run it before publishing an image.
 *
 *   npm run verify:docker
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { setTimeout as sleep } from 'node:timers/promises';

const IMAGE = 'haulmates-server:verify';
const NAME = 'haulmates-verify';
const PORT = Number(process.env.VERIFY_PORT ?? 8972);

const failures = [];
function check(name, condition, detail = '') {
  if (condition) console.log(`  PASS  ${name}`);
  else {
    console.log(`  FAIL  ${name} ${detail}`);
    failures.push(name);
  }
}

function docker(args, opts = {}) {
  return spawnSync('docker', args, { encoding: 'utf8', ...opts });
}

const daemon = docker(['info'], { stdio: 'ignore' });
if (daemon.status !== 0) {
  console.error(
    'No reachable Docker daemon. This check builds and runs the real image, so it\n' +
      'cannot be faked — run it somewhere with Docker. `npm run verify:server` covers\n' +
      'the entrypoint, configuration and shutdown behaviour without one.',
  );
  process.exit(2);
}

function cleanup() {
  docker(['rm', '-f', NAME], { stdio: 'ignore' });
}
cleanup();

try {
  console.log('building the image (this pulls node:22-alpine on a cold cache)…');
  execFileSync('docker', ['build', '--build-arg', 'WITH_CLIENT=1', '-t', IMAGE, '.'], { stdio: 'inherit' });
  check('the image builds', true);

  const run = docker([
    'run', '-d', '--name', NAME,
    '-p', `${PORT}:8787`,
    '-e', 'HAULMATES_LOG=warn',
    '-e', 'HAULMATES_STATIC=/app/packages/client/dist',
    IMAGE,
  ]);
  check('the container starts', run.status === 0, run.stderr?.trim());
  if (run.status !== 0) throw new Error('container did not start');

  // Wait for the container's own HEALTHCHECK to go green, which is the same
  // signal a managed host waits on before it sends anyone to this instance.
  const origin = `http://127.0.0.1:${PORT}`;
  const started = Date.now();
  let healthy = false;
  while (Date.now() - started < 60000) {
    const state = docker(['inspect', '-f', '{{.State.Health.Status}}', NAME]).stdout?.trim();
    if (state === 'healthy') {
      healthy = true;
      break;
    }
    if (state === 'unhealthy') break;
    await sleep(1000);
  }
  check("the container's own HEALTHCHECK reports healthy", healthy,
    `after ${Math.round((Date.now() - started) / 1000)}s`);

  const health = await fetch(`${origin}/health`).then((r) => r.json()).catch((e) => ({ error: e.message }));
  check('/health answers from inside the container', health.ok === true, JSON.stringify(health));

  const index = await fetch(`${origin}/`).then((r) => r.text()).catch(() => '');
  check('the baked-in client is served', index.includes('id="stage"'), `${index.length}b`);

  const whoami = docker(['exec', NAME, 'id', '-un']).stdout?.trim();
  check('the server does not run as root', whoami === 'node', whoami);

  // The real point of building the image: prove the pruned dependency tree can
  // still open a socket and run a match.
  const { INTENT_CREATE, INTENT_JOIN, IN_RIGHT, NetClient } = await import('../packages/core/dist/index.js');
  const { WebSocket } = await import('ws');
  const transport = (url) => {
    const socket = new WebSocket(url);
    socket.binaryType = 'nodebuffer';
    const t = { onOpen: null, onMessage: null, onClose: null,
      send(b) { if (socket.readyState === WebSocket.OPEN) socket.send(b, { binary: true }); },
      close() { socket.close(); } };
    socket.on('open', () => t.onOpen?.());
    socket.on('message', (d) => t.onMessage?.(new Uint8Array(d)));
    socket.on('close', () => t.onClose?.('closed'));
    socket.on('error', () => t.onClose?.('error'));
    return t;
  };
  const waitFor = async (fn, label, ms = 10000) => {
    const t0 = Date.now();
    while (!fn()) {
      if (Date.now() - t0 > ms) throw new Error(`timed out waiting for ${label}`);
      await sleep(20);
    }
  };

  const a = new NetClient({ transport: transport(`ws://127.0.0.1:${PORT}`), name: 'ALPHA',
    intent: INTENT_CREATE, mode: 0, seed: 4242, towerLength: 4 });
  await waitFor(() => a.roomCode !== '', 'a room code');
  const b = new NetClient({ transport: transport(`ws://127.0.0.1:${PORT}`), name: 'BRAVO',
    intent: INTENT_JOIN, room: a.roomCode });
  await waitFor(() => b.localIndex === 1, 'the guest to join');
  a.ready(true);
  b.ready(true);
  await waitFor(() => a.phase === 'running' && b.phase === 'running', 'the match to start');
  for (let i = 0; i < 120; i++) {
    a.update(16, [IN_RIGHT, 0]);
    b.update(16, [0, IN_RIGHT]);
    await sleep(8);
  }
  check('two players play a real match against the container',
    a.localTick > 60 && b.localTick > 60 && a.desyncs === 0 && b.desyncs === 0,
    `${a.localTick}/${b.localTick} desyncs ${a.desyncs}/${b.desyncs}`);
  a.dispose();
  b.dispose();

  // `docker stop` sends SIGTERM then SIGKILL after a grace period. A clean stop
  // well inside that window means the signal was handled, not waited out.
  const stopAt = Date.now();
  docker(['stop', '-t', '15', NAME]);
  const stopMs = Date.now() - stopAt;
  const code = docker(['inspect', '-f', '{{.State.ExitCode}}', NAME]).stdout?.trim();
  check('docker stop is handled rather than waited out', code === '0' && stopMs < 12000,
    `exit ${code} after ${stopMs}ms`);
} catch (err) {
  check('the verification ran to completion', false, err.message);
} finally {
  cleanup();
  if (failures.length > 0) {
    console.error(`\nDocker verification: ${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log('\nDocker verification: all checks passed.');
}
