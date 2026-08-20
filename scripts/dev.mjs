/**
 * Development runner: the matchmaking server plus the Vite dev server, so
 * `npm run dev` gives you a hot-reloading client already pointed at a working
 * backend. Open the printed URL in two tabs to test online play locally.
 */
import { spawn } from 'node:child_process';

const children = [];

function start(name, command, args, env = {}) {
  const child = spawn(command, args, {
    stdio: ['ignore', 'pipe', 'pipe'],
    env: { ...process.env, ...env },
    shell: process.platform === 'win32',
  });
  const prefix = `[${name}] `;
  const pipe = (stream, out) => {
    let buffer = '';
    stream.on('data', (chunk) => {
      buffer += chunk.toString();
      const lines = buffer.split('\n');
      buffer = lines.pop() ?? '';
      for (const line of lines) out.write(prefix + line + '\n');
    });
  };
  pipe(child.stdout, process.stdout);
  pipe(child.stderr, process.stderr);
  child.on('exit', (code) => {
    if (code !== 0 && code !== null) console.error(`${prefix}exited with ${code}`);
  });
  children.push(child);
  return child;
}

console.log('Building core...');
const build = spawn('npm', ['run', 'build:core'], { stdio: 'inherit', shell: process.platform === 'win32' });
build.on('exit', (code) => {
  if (code !== 0) process.exit(code ?? 1);

  start('server', process.execPath, ['packages/server/dist/cli.js'], { PORT: '8787', HAULMATES_LOG: 'info' });
  start('client', 'npx', ['vite', '--host', '--port', '5173', '--config', 'packages/client/vite.config.ts', 'packages/client']);

  console.log('\n  Server  ws://localhost:8787');
  console.log('  Client  http://localhost:5173');
  console.log('\n  Open the client in two browser tabs to play online with yourself.\n');
});

const shutdown = () => {
  for (const child of children) child.kill('SIGTERM');
  process.exit(0);
};
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
