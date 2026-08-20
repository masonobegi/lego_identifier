import { config } from './config.js';

const LEVELS: Record<string, number> = { error: 0, warn: 1, info: 2, debug: 3 };
const threshold = LEVELS[config.logLevel] ?? 2;

function emit(level: string, msg: string, extra?: unknown): void {
  if ((LEVELS[level] ?? 2) > threshold) return;
  const line = `${new Date().toISOString()} ${level.toUpperCase().padEnd(5)} ${msg}`;
  if (extra !== undefined) console.log(line, extra);
  else console.log(line);
}

export const log = {
  error: (m: string, e?: unknown) => emit('error', m, e),
  warn: (m: string, e?: unknown) => emit('warn', m, e),
  info: (m: string, e?: unknown) => emit('info', m, e),
  debug: (m: string, e?: unknown) => emit('debug', m, e),
};
