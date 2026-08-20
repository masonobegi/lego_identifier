import { describe, expect, it } from 'vitest';
import {
  CODE_ALPHABET,
  CODE_LENGTH,
  C_HELLO,
  C_INPUTS,
  PROTOCOL_VERSION,
  Reader,
  S_ERROR,
  SIM_VERSION,
  Writer,
  isValidRoomCode,
  normaliseRoomCode,
  readHello,
  writeError,
  writeHello,
  writeInputFrames,
  writeInputs,
} from '@haulmates/core';

describe('binary writer and reader', () => {
  it('round-trips every primitive', () => {
    const bytes = new Writer(8)
      .u8(200)
      .u16(65_000)
      .u32(4_000_000_000)
      .i32(-123_456)
      .f64(Math.PI)
      .str('hello ✨')
      .bytes(new Uint8Array([1, 2, 3]))
      .finish();

    const r = new Reader(bytes);
    expect(r.u8()).toBe(200);
    expect(r.u16()).toBe(65_000);
    expect(r.u32()).toBe(4_000_000_000);
    expect(r.i32()).toBe(-123_456);
    expect(r.f64()).toBe(Math.PI);
    expect(r.str()).toBe('hello ✨');
    expect(Array.from(r.bytes(3))).toEqual([1, 2, 3]);
    expect(r.remaining).toBe(0);
  });

  it('grows past its initial capacity', () => {
    const w = new Writer(2);
    for (let i = 0; i < 5000; i++) w.u32(i);
    const r = new Reader(w.finish());
    for (let i = 0; i < 5000; i++) expect(r.u32()).toBe(i);
  });

  it('throws rather than reading past the end', () => {
    const r = new Reader(new Uint8Array([1, 2]));
    r.u8();
    expect(() => r.u32()).toThrow(/truncated/);
  });

  it('clips oversized strings instead of corrupting the stream', () => {
    const long = 'x'.repeat(1000);
    const r = new Reader(new Writer(64).str(long).u8(7).finish());
    expect(r.str().length).toBe(255);
    expect(r.u8()).toBe(7);
  });
});

describe('messages', () => {
  it('round-trips a hello', () => {
    const hello = {
      simVersion: SIM_VERSION,
      protocolVersion: PROTOCOL_VERSION,
      name: 'HAULER',
      intent: 1,
      room: 'AC3F7',
      mode: 1,
      towerLength: 12,
      seed: -998877,
      hat: 3,
      colour: 5,
    };
    const bytes = writeHello(hello);
    const r = new Reader(bytes);
    expect(r.u8()).toBe(C_HELLO);
    expect(readHello(r)).toEqual(hello);
  });

  it('round-trips an input run', () => {
    const masks = Uint8Array.from([1, 3, 7, 0, 255, 128]);
    const r = new Reader(writeInputs(9001, masks));
    expect(r.u8()).toBe(C_INPUTS);
    expect(r.u32()).toBe(9001);
    expect(r.u16()).toBe(masks.length);
    expect(Array.from(r.bytes(masks.length))).toEqual(Array.from(masks));
  });

  it('encodes interleaved input frames with a tick count, not a byte count', () => {
    const frames = Uint8Array.from([1, 2, 3, 4, 5, 6]);
    const r = new Reader(writeInputFrames(100, frames));
    r.u8();
    expect(r.u32()).toBe(100);
    expect(r.u16()).toBe(3);
  });

  it('round-trips an error', () => {
    const r = new Reader(writeError(4, 'nope'));
    expect(r.u8()).toBe(S_ERROR);
    expect(r.u8()).toBe(4);
    expect(r.str()).toBe('nope');
  });
});

describe('room codes', () => {
  it('excludes every lookalike character', () => {
    for (const ch of 'BILOSZ01258') expect(CODE_ALPHABET).not.toContain(ch);
  });

  it('accepts only well-formed codes', () => {
    expect(isValidRoomCode('ACDEF')).toBe(true);
    expect(isValidRoomCode('ACDE')).toBe(false);
    expect(isValidRoomCode('ACDEFG')).toBe(false);
    expect(isValidRoomCode('ACDEO')).toBe(false);
  });

  it('repairs the mistakes people actually make', () => {
    expect(normaliseRoomCode('ac-def')).toBe('ACDEF');
    expect(normaliseRoomCode('0IlS8')).toBe('QJJ46');
    expect(normaliseRoomCode('  a c d e f  ')).toBe('ACDEF');
    expect(normaliseRoomCode('ACDEFGHJK')).toHaveLength(CODE_LENGTH);
    expect(isValidRoomCode(normaliseRoomCode('0IlS8'))).toBe(true);
  });

  it('leaves an already-valid code untouched', () => {
    expect(normaliseRoomCode('QJJ46')).toBe('QJJ46');
  });
});
