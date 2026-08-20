/**
 * Compact binary protocol.
 *
 * Input frames dominate the traffic (two bytes per tick), so everything is
 * hand-packed rather than JSON: a full second of inputs for both players is
 * 120 bytes plus a 7 byte header.
 */

export const PROTOCOL_VERSION = 4;

/* client -> server */
export const C_HELLO = 1;
export const C_INPUTS = 2;
export const C_PING = 3;
export const C_READY = 4;
export const C_HASH = 5;
export const C_RESYNC = 6;
export const C_LEAVE = 7;
export const C_COSMETIC = 8;
export const C_REMATCH = 9;

/* server -> client */
export const S_WELCOME = 128;
export const S_PEER = 129;
export const S_INPUTS = 130;
export const S_SNAPSHOT = 131;
export const S_PONG = 132;
export const S_START = 133;
export const S_ERROR = 134;
export const S_PEER_LEFT = 135;
export const S_DESYNC = 136;
export const S_RESULT = 137;

export const ERR_VERSION = 1;
export const ERR_NO_ROOM = 2;
export const ERR_ROOM_FULL = 3;
export const ERR_KICKED = 4;
export const ERR_BAD_REQUEST = 5;
export const ERR_SERVER_FULL = 6;
export const ERR_TIMEOUT = 7;

export const INTENT_CREATE = 0;
export const INTENT_JOIN = 1;
export const INTENT_QUICKPLAY = 2;

const textEncoder = new TextEncoder();
const textDecoder = new TextDecoder();

export class Writer {
  private buf: Uint8Array;
  private view: DataView;
  private o = 0;

  constructor(capacity = 256) {
    this.buf = new Uint8Array(capacity);
    this.view = new DataView(this.buf.buffer);
  }

  private ensure(n: number): void {
    if (this.o + n <= this.buf.length) return;
    let cap = this.buf.length * 2;
    while (cap < this.o + n) cap *= 2;
    const next = new Uint8Array(cap);
    next.set(this.buf);
    this.buf = next;
    this.view = new DataView(next.buffer);
  }

  u8(v: number): this {
    this.ensure(1);
    this.view.setUint8(this.o, v & 0xff);
    this.o += 1;
    return this;
  }

  u16(v: number): this {
    this.ensure(2);
    this.view.setUint16(this.o, v & 0xffff);
    this.o += 2;
    return this;
  }

  u32(v: number): this {
    this.ensure(4);
    this.view.setUint32(this.o, v >>> 0);
    this.o += 4;
    return this;
  }

  i32(v: number): this {
    this.ensure(4);
    this.view.setInt32(this.o, v | 0);
    this.o += 4;
    return this;
  }

  f64(v: number): this {
    this.ensure(8);
    this.view.setFloat64(this.o, v);
    this.o += 8;
    return this;
  }

  bytes(b: Uint8Array): this {
    this.ensure(b.length);
    this.buf.set(b, this.o);
    this.o += b.length;
    return this;
  }

  /** Length-prefixed UTF-8, truncated to 255 bytes. */
  str(s: string): this {
    const raw = textEncoder.encode(s);
    const clipped = raw.length > 255 ? raw.subarray(0, 255) : raw;
    this.u8(clipped.length);
    return this.bytes(clipped);
  }

  finish(): Uint8Array {
    return this.buf.slice(0, this.o);
  }
}

export class Reader {
  private view: DataView;
  private o = 0;

  constructor(private data: Uint8Array) {
    this.view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  }

  get remaining(): number {
    return this.data.byteLength - this.o;
  }

  private need(n: number): void {
    if (this.o + n > this.data.byteLength) throw new Error('protocol: truncated message');
  }

  u8(): number {
    this.need(1);
    const v = this.view.getUint8(this.o);
    this.o += 1;
    return v;
  }

  u16(): number {
    this.need(2);
    const v = this.view.getUint16(this.o);
    this.o += 2;
    return v;
  }

  u32(): number {
    this.need(4);
    const v = this.view.getUint32(this.o);
    this.o += 4;
    return v;
  }

  i32(): number {
    this.need(4);
    const v = this.view.getInt32(this.o);
    this.o += 4;
    return v;
  }

  f64(): number {
    this.need(8);
    const v = this.view.getFloat64(this.o);
    this.o += 8;
    return v;
  }

  bytes(n: number): Uint8Array {
    this.need(n);
    const v = this.data.subarray(this.o, this.o + n);
    this.o += n;
    return v;
  }

  str(): string {
    const n = this.u8();
    return textDecoder.decode(this.bytes(n));
  }
}

/* ------------------------------------------------------------- shorthands */

export interface HelloMessage {
  simVersion: number;
  protocolVersion: number;
  name: string;
  intent: number;
  room: string;
  mode: number;
  towerLength: number;
  seed: number;
  hat: number;
  colour: number;
}

export function writeHello(m: HelloMessage): Uint8Array {
  return new Writer(96)
    .u8(C_HELLO)
    .u8(m.simVersion)
    .u8(m.protocolVersion)
    .str(m.name)
    .u8(m.intent)
    .str(m.room)
    .u8(m.mode)
    .u8(m.towerLength)
    .i32(m.seed)
    .u8(m.hat)
    .u8(m.colour)
    .finish();
}

export function readHello(r: Reader): HelloMessage {
  return {
    simVersion: r.u8(),
    protocolVersion: r.u8(),
    name: r.str(),
    intent: r.u8(),
    room: r.str(),
    mode: r.u8(),
    towerLength: r.u8(),
    seed: r.i32(),
    hat: r.u8(),
    colour: r.u8(),
  };
}

/** A run of consecutive input masks for one player, starting at `startTick`. */
export function writeInputs(startTick: number, masks: Uint8Array): Uint8Array {
  return new Writer(masks.length + 8).u8(C_INPUTS).u32(startTick).u16(masks.length).bytes(masks).finish();
}

/** Authoritative interleaved inputs: [p0, p1] per tick from `startTick`. */
export function writeInputFrames(startTick: number, frames: Uint8Array): Uint8Array {
  return new Writer(frames.length + 8).u8(S_INPUTS).u32(startTick).u16(frames.length >> 1).bytes(frames).finish();
}

export function writeError(code: number, message: string): Uint8Array {
  return new Writer(64).u8(S_ERROR).u8(code).str(message).finish();
}

export const ERROR_TEXT: Record<number, string> = {
  [ERR_VERSION]: 'Your game version does not match your friend’s. Both of you need the same update.',
  [ERR_NO_ROOM]: 'No haul found with that code.',
  [ERR_ROOM_FULL]: 'That haul already has two people on the rope.',
  [ERR_KICKED]: 'You were disconnected from the haul.',
  [ERR_BAD_REQUEST]: 'The server did not understand that request.',
  [ERR_SERVER_FULL]: 'The server is full right now. Try again in a moment.',
  [ERR_TIMEOUT]: 'Connection timed out.',
};

/** Room codes avoid characters that get misheard or misread over voice chat. */
export const CODE_ALPHABET = 'ACDEFGHJKMNPQRTUVWXY34679';
export const CODE_LENGTH = 5;

export function isValidRoomCode(code: string): boolean {
  if (code.length !== CODE_LENGTH) return false;
  for (const ch of code) if (!CODE_ALPHABET.includes(ch)) return false;
  return true;
}

/** Map characters people commonly mistype onto the closest alphabet member. */
const CODE_CONFUSABLES: Record<string, string> = {
  I: 'J', L: 'J', '1': 'J',
  O: 'Q', '0': 'Q',
  S: '4', '5': '4',
  B: '6', '8': '6',
  Z: 'X', '2': 'X',
};

export function normaliseRoomCode(input: string): string {
  let out = '';
  for (const raw of input.toUpperCase()) {
    const ch = CODE_CONFUSABLES[raw] ?? raw;
    if (CODE_ALPHABET.includes(ch)) out += ch;
    if (out.length === CODE_LENGTH) break;
  }
  return out;
}
