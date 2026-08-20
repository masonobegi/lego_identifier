#!/usr/bin/env node
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { createReadStream, statSync } from 'node:fs';
import { extname, join, normalize, resolve, sep } from 'node:path';
import { WebSocketServer, type WebSocket } from 'ws';
import { config } from './config.js';
import { Gateway } from './net.js';
import { Lobby } from './lobby.js';
import { log } from './log.js';
import type { Conn } from './room.js';

export { Lobby } from './lobby.js';
export { Gateway } from './net.js';
export { Room } from './room.js';
export type { Conn } from './room.js';

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.woff2': 'font/woff2',
  '.webmanifest': 'application/manifest+json',
};

function serveStatic(root: string, req: IncomingMessage, res: ServerResponse): boolean {
  const url = new URL(req.url ?? '/', 'http://localhost');
  let rel = decodeURIComponent(url.pathname);
  if (rel.endsWith('/')) rel += 'index.html';
  // Refuse anything that escapes the root once normalised.
  const target = resolve(join(root, normalize(rel)));
  if (target !== resolve(root) && !target.startsWith(resolve(root) + sep)) {
    res.writeHead(403).end('forbidden');
    return true;
  }
  try {
    const stat = statSync(target);
    if (!stat.isFile()) return false;
    res.writeHead(200, {
      'content-type': MIME[extname(target)] ?? 'application/octet-stream',
      'content-length': stat.size,
      'cache-control': extname(target) === '.html' ? 'no-cache' : 'public, max-age=3600',
    });
    createReadStream(target).pipe(res);
    return true;
  } catch {
    return false;
  }
}

export interface ServerHandle {
  port: number;
  lobby: Lobby;
  gateway: Gateway;
  http: Server;
  close(): Promise<void>;
}

export interface ServerOptions {
  port?: number;
  host?: string;
  staticDir?: string;
}

let nextConnId = 1;

export async function startServer(options: ServerOptions = {}): Promise<ServerHandle> {
  const port = options.port ?? config.port;
  const host = options.host ?? config.host;
  const staticDir = options.staticDir ?? config.staticDir;

  const lobby = new Lobby();
  const gateway = new Gateway(lobby);

  const http = createServer((req, res) => {
    const url = new URL(req.url ?? '/', 'http://localhost');
    if (url.pathname === '/health') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ ok: true }));
      return;
    }
    if (url.pathname === '/stats') {
      res.writeHead(200, { 'content-type': 'application/json' }).end(
        JSON.stringify({ ...lobby.stats(), sessions: gateway.sessions.size, uptime: process.uptime() }),
      );
      return;
    }
    if (staticDir && req.method === 'GET' && serveStatic(staticDir, req, res)) return;
    // Single-page fallback so deep links still load the game shell.
    if (staticDir && req.method === 'GET') {
      const fakeReq = { ...req, url: '/index.html' } as IncomingMessage;
      if (serveStatic(staticDir, fakeReq, res)) return;
    }
    res.writeHead(404).end('not found');
  });

  const wss = new WebSocketServer({ server: http, maxPayload: config.maxMessageBytes });
  const perIp = new Map<string, number>();

  wss.on('connection', (socket: WebSocket, req: IncomingMessage) => {
    const ip = (req.socket.remoteAddress ?? 'unknown').replace('::ffff:', '');
    const count = (perIp.get(ip) ?? 0) + 1;
    if (count > config.maxConnectionsPerIp) {
      socket.close(1013, 'too many connections');
      return;
    }
    perIp.set(ip, count);

    const conn: Conn = {
      id: nextConnId++,
      ip,
      send(bytes) {
        if (socket.readyState === socket.OPEN) socket.send(bytes, { binary: true });
      },
      close(code, reason) {
        try {
          socket.close(code ?? 1000, reason ?? '');
        } catch {
          /* already closing */
        }
      },
    };

    gateway.open(conn);
    socket.binaryType = 'nodebuffer';
    socket.on('message', (data: Buffer | ArrayBuffer | Buffer[]) => {
      const bytes = Array.isArray(data)
        ? new Uint8Array(Buffer.concat(data))
        : data instanceof ArrayBuffer
          ? new Uint8Array(data)
          : new Uint8Array(data.buffer, data.byteOffset, data.byteLength);
      gateway.message(conn, bytes);
    });
    socket.on('close', () => {
      gateway.close(conn, 'disconnected');
      const remaining = (perIp.get(ip) ?? 1) - 1;
      if (remaining <= 0) perIp.delete(ip);
      else perIp.set(ip, remaining);
    });
    socket.on('error', () => gateway.close(conn, 'socket error'));
  });

  lobby.start();
  const housekeeping = setInterval(() => {
    lobby.sweep();
    gateway.reapIdle();
  }, 5000);

  await new Promise<void>((done) => http.listen(port, host, done));
  const actual = (http.address() as { port: number }).port;
  log.info(`HAULMATES server listening on ${host}:${actual}${staticDir ? ` (serving ${staticDir})` : ''}`);

  return {
    port: actual,
    lobby,
    gateway,
    http,
    async close() {
      clearInterval(housekeeping);
      lobby.stop();
      for (const client of wss.clients) client.terminate();
      await new Promise<void>((done) => wss.close(() => done()));
      await new Promise<void>((done) => http.close(() => done()));
    },
  };
}
