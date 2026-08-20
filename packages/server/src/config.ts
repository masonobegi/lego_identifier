function num(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const v = Number(raw);
  return Number.isFinite(v) ? v : fallback;
}

export const config = {
  port: num('PORT', 8787),
  host: process.env.HOST ?? '0.0.0.0',
  /** Serve a built client from this directory, if set. */
  staticDir: process.env.HAULMATES_STATIC ?? '',
  /** Hard ceiling on concurrent rooms, so one host can be sized predictably. */
  maxRooms: num('HAULMATES_MAX_ROOMS', 2000),
  maxConnectionsPerIp: num('HAULMATES_MAX_CONN_PER_IP', 24),
  /** Largest message we will even look at, in bytes. */
  maxMessageBytes: num('HAULMATES_MAX_MESSAGE', 4096),
  /** Drop a socket that has not spoken in this long. */
  idleTimeoutMs: num('HAULMATES_IDLE_TIMEOUT', 45_000),
  /** Keep a room alive this long after the last player leaves, so a dropped
   *  player can reconnect with the same code and resume the run. */
  roomGraceMs: num('HAULMATES_ROOM_GRACE', 120_000),
  /** How often the server broadcasts confirmed input frames. */
  frameBatchTicks: num('HAULMATES_FRAME_BATCH', 2),
  /** How often the server publishes a state hash for desync detection. */
  hashIntervalTicks: num('HAULMATES_HASH_INTERVAL', 60),
  /** How far ahead of the server a client may buffer inputs. */
  maxInputLead: num('HAULMATES_MAX_INPUT_LEAD', 40),
  logLevel: process.env.HAULMATES_LOG ?? 'info',
};

export type Config = typeof config;
