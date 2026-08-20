import {
  C_COSMETIC,
  C_HASH,
  C_HELLO,
  C_INPUTS,
  C_LEAVE,
  C_PING,
  C_READY,
  C_REMATCH,
  C_RESYNC,
  ERR_BAD_REQUEST,
  ERR_NO_ROOM,
  ERR_ROOM_FULL,
  ERR_SERVER_FULL,
  ERR_VERSION,
  INTENT_JOIN,
  INTENT_QUICKPLAY,
  PROTOCOL_VERSION,
  Reader,
  S_PONG,
  SIM_VERSION,
  Writer,
  normaliseRoomCode,
  readHello,
  writeError,
} from '@haulmates/core';
import { config } from './config.js';
import { Lobby, clampTowerLength } from './lobby.js';
import { log } from './log.js';
import type { Conn, Room } from './room.js';

export interface Session {
  conn: Conn;
  room: Room | null;
  index: number;
  greeted: boolean;
  lastSeen: number;
  /** Cheap flood guard: messages counted inside the current second. */
  messagesThisSecond: number;
  secondStartedAt: number;
}

const MAX_MESSAGES_PER_SECOND = 400;

export class Gateway {
  readonly sessions = new Map<Conn, Session>();
  /** Injectable so tests can drive rate limiting and idle reaping on a virtual
   *  clock instead of waiting out real seconds. */
  private now: () => number;

  constructor(
    private lobby: Lobby,
    now: () => number = Date.now,
  ) {
    this.now = now;
  }

  open(conn: Conn): void {
    const t = this.now();
    this.sessions.set(conn, {
      conn,
      room: null,
      index: -1,
      greeted: false,
      lastSeen: t,
      messagesThisSecond: 0,
      secondStartedAt: t,
    });
  }

  close(conn: Conn, reason = 'disconnected'): void {
    const session = this.sessions.get(conn);
    if (!session) return;
    if (session.room && session.index >= 0) {
      session.room.leave(session.index, reason);
      if (session.room.playerCount === 0) session.room.emptySince = Date.now();
    }
    this.sessions.delete(conn);
  }

  /** Handle one inbound frame. Never throws; malformed input closes the socket. */
  message(conn: Conn, data: Uint8Array): void {
    const session = this.sessions.get(conn);
    if (!session) return;

    const now = this.now();
    session.lastSeen = now;
    if (now - session.secondStartedAt >= 1000) {
      session.secondStartedAt = now;
      session.messagesThisSecond = 0;
    }
    if (++session.messagesThisSecond > MAX_MESSAGES_PER_SECOND) {
      this.fail(session, ERR_BAD_REQUEST, 'too many messages');
      return;
    }
    if (data.byteLength === 0 || data.byteLength > config.maxMessageBytes) {
      this.fail(session, ERR_BAD_REQUEST, 'message size');
      return;
    }

    try {
      this.dispatch(session, data);
    } catch (err) {
      log.warn('malformed message', err);
      this.fail(session, ERR_BAD_REQUEST, 'malformed message');
    }
  }

  private dispatch(session: Session, data: Uint8Array): void {
    const reader = new Reader(data);
    const type = reader.u8();

    if (!session.greeted && type !== C_HELLO) {
      this.fail(session, ERR_BAD_REQUEST, 'expected hello');
      return;
    }

    switch (type) {
      case C_HELLO:
        this.handleHello(session, reader);
        return;
      case C_PING: {
        const clientTime = reader.f64();
        const w = new Writer(32)
          .u8(S_PONG)
          .f64(clientTime)
          .f64(Date.now())
          .u32(session.room ? session.room.tick : 0);
        session.conn.send(w.finish());
        return;
      }
      case C_INPUTS: {
        const startTick = reader.u32();
        const count = reader.u16();
        if (count > 512) throw new Error('input run too long');
        const masks = reader.bytes(count);
        session.room?.receiveInputs(session.index, startTick, masks);
        return;
      }
      case C_READY:
        session.room?.setReady(session.index, reader.u8() !== 0);
        return;
      case C_COSMETIC:
        session.room?.setCosmetic(session.index, reader.u8(), reader.u8());
        return;
      case C_RESYNC:
        if (session.room && session.index >= 0) session.room.sendSnapshot(session.index);
        return;
      case C_HASH: {
        const tick = reader.u32();
        const hash = reader.u32();
        log.debug(`client hash report room=${session.room?.code} tick=${tick} hash=${hash}`);
        return;
      }
      case C_REMATCH:
        if (session.room) {
          session.room.rematch(session.room.mode === 1 ? (Math.random() * 0x7fffffff) | 0 : undefined);
        }
        return;
      case C_LEAVE:
        this.close(session.conn, 'left');
        session.conn.close(1000, 'left');
        return;
      default:
        this.fail(session, ERR_BAD_REQUEST, `unknown message type ${type}`);
    }
  }

  private handleHello(session: Session, reader: Reader): void {
    if (session.greeted) {
      this.fail(session, ERR_BAD_REQUEST, 'already greeted');
      return;
    }
    const hello = readHello(reader);
    if (hello.protocolVersion !== PROTOCOL_VERSION || hello.simVersion !== SIM_VERSION) {
      this.fail(session, ERR_VERSION, `server runs protocol ${PROTOCOL_VERSION}/sim ${SIM_VERSION}`);
      return;
    }
    session.greeted = true;

    let room: Room | null | undefined;
    if (hello.intent === INTENT_JOIN) {
      room = this.lobby.get(normaliseRoomCode(hello.room));
      if (!room) {
        this.fail(session, ERR_NO_ROOM, 'no such room');
        return;
      }
      if (room.freeSlot() < 0) {
        this.fail(session, ERR_ROOM_FULL, 'room full');
        return;
      }
    } else if (hello.intent === INTENT_QUICKPLAY) {
      room = this.lobby.findQuickplay(hello.mode);
      if (!room) {
        room = this.lobby.create(hello.mode, seedFor(hello), clampTowerLength(hello.towerLength), true);
      }
    } else {
      room = this.lobby.create(hello.mode, seedFor(hello), clampTowerLength(hello.towerLength), false);
    }

    if (!room) {
      this.fail(session, ERR_SERVER_FULL, 'server at capacity');
      return;
    }

    const index = room.join(session.conn, hello.name, hello.hat, hello.colour);
    if (index < 0) {
      this.fail(session, ERR_ROOM_FULL, 'room full');
      return;
    }
    session.room = room;
    session.index = index;
  }

  private fail(session: Session, code: number, message: string): void {
    session.conn.send(writeError(code, message));
    session.conn.close(1008, message);
    this.sessions.delete(session.conn);
  }

  /** Drop sockets that have gone quiet; called from a slow timer. */
  reapIdle(now = this.now()): void {
    for (const session of this.sessions.values()) {
      if (now - session.lastSeen > config.idleTimeoutMs) {
        this.close(session.conn, 'timed out');
        session.conn.close(1001, 'idle timeout');
      }
    }
  }
}

function seedFor(hello: { seed: number }): number {
  return hello.seed !== 0 ? hello.seed | 0 : (Math.random() * 0x7fffffff) | 0;
}
