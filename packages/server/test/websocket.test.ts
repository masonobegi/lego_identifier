import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { WebSocket } from 'ws';
import {
  INTENT_CREATE,
  INTENT_JOIN,
  IN_JUMP,
  IN_RIGHT,
  NetClient,
  hashWorld,
  type Transport,
} from '@haulmates/core';
import { startServer, type ServerHandle } from '../src/index.js';

/** Adapts the `ws` client to the transport the netcode client expects. */
function wsTransport(url: string): Transport {
  const socket = new WebSocket(url);
  socket.binaryType = 'nodebuffer';
  const transport: Transport = {
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
  socket.on('message', (data: Buffer) => transport.onMessage?.(new Uint8Array(data)));
  socket.on('close', () => transport.onClose?.('closed'));
  socket.on('error', () => transport.onClose?.('error'));
  return transport;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));

describe('real websocket stack', () => {
  let server: ServerHandle;
  let url = '';

  beforeAll(async () => {
    server = await startServer({ port: 0, host: '127.0.0.1' });
    url = `ws://127.0.0.1:${server.port}`;
  });

  afterAll(async () => {
    await server.close();
  });

  it('plays a real match over websockets and stays in sync', async () => {
    const a = new NetClient({
      transport: wsTransport(url),
      name: 'ALPHA',
      intent: INTENT_CREATE,
      mode: 0,
      seed: 555_000,
      towerLength: 5,
    });
    await waitFor(() => a.roomCode !== '', 4000);

    const b = new NetClient({
      transport: wsTransport(url),
      name: 'BRAVO',
      intent: INTENT_JOIN,
      room: a.roomCode,
    });
    await waitFor(() => b.localIndex === 1, 4000);

    a.ready(true);
    b.ready(true);
    await waitFor(() => a.phase === 'running' && b.phase === 'running', 4000);

    // Drive both clients as if they were rendering at 60fps for three seconds.
    const started = Date.now();
    while (Date.now() - started < 3000) {
      const tick = Math.max(a.localTick, b.localTick);
      a.update(16, [tick % 40 < 20 ? IN_RIGHT : IN_JUMP, 0]);
      b.update(16, [0, tick % 30 < 15 ? IN_JUMP : IN_RIGHT]);
      await sleep(8);
    }

    // Let the last confirmations land.
    for (let i = 0; i < 60; i++) {
      a.update(16, [0, 0]);
      b.update(16, [0, 0]);
      await sleep(16);
    }

    expect(a.localTick).toBeGreaterThan(100);
    expect(b.localTick).toBeGreaterThan(100);
    expect(a.desyncs).toBe(0);
    expect(b.desyncs).toBe(0);
    expect(a.confirmedTick).toBeGreaterThan(60);
    const tick = Math.min(a.confirmedTick, b.confirmedTick);
    expect(tick).toBeGreaterThan(0);
    if (a.confirmedTick === b.confirmedTick) {
      expect(hashWorld(a.confirmedWorld!)).toBe(hashWorld(b.confirmedWorld!));
    }
    a.dispose();
    b.dispose();
  });

  it('refuses a join for an unknown room code', async () => {
    const c = new NetClient({
      transport: wsTransport(url),
      name: 'LOST',
      intent: INTENT_JOIN,
      room: 'QQQQQ',
    });
    await waitFor(() => c.phase === 'error', 4000);
    expect(c.errorMessage).toMatch(/No haul found/);
    c.dispose();
  });

  it('serves health and stats endpoints', async () => {
    const health = await fetch(`http://127.0.0.1:${server.port}/health`);
    expect(health.status).toBe(200);
    expect(await health.json()).toEqual({ ok: true });
    const stats = await fetch(`http://127.0.0.1:${server.port}/stats`);
    const body = (await stats.json()) as Record<string, number>;
    expect(typeof body.rooms).toBe('number');
    expect(typeof body.uptime).toBe('number');
  });
});

async function waitFor(predicate: () => boolean, timeoutMs: number): Promise<void> {
  const started = Date.now();
  while (!predicate()) {
    if (Date.now() - started > timeoutMs) throw new Error('timed out waiting for condition');
    await sleep(10);
  }
}
