/**
 * xorshift32 — deterministic, integer-only, cheap to snapshot (one 32-bit word).
 * Used for procedural tower assembly and for cosmetic-but-simulated randomness
 * such as debris scatter, so every peer produces identical results.
 */
export class Rng {
  state: number;

  constructor(seed: number) {
    // Zero is a fixed point of xorshift, so bias it away from zero.
    this.state = (seed | 0) === 0 ? 0x1a2b3c4d : seed | 0;
  }

  /** Next raw 32-bit unsigned value. */
  nextU32(): number {
    let x = this.state | 0;
    x ^= x << 13;
    x |= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x |= 0;
    this.state = x;
    return x >>> 0;
  }

  /** Uniform float in [0, 1). */
  nextFloat(): number {
    return this.nextU32() / 4294967296;
  }

  /** Uniform float in [lo, hi). */
  range(lo: number, hi: number): number {
    return lo + (hi - lo) * this.nextFloat();
  }

  /** Uniform integer in [0, n). */
  nextInt(n: number): number {
    return n <= 0 ? 0 : this.nextU32() % n;
  }

  pick<T>(items: readonly T[]): T {
    return items[this.nextInt(items.length)];
  }

  fork(salt: number): Rng {
    return new Rng((this.state ^ (salt * 0x9e3779b1)) | 0);
  }
}

/** Turn an arbitrary string (e.g. a daily seed or room code) into a 32-bit seed. */
export function hashSeed(text: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h | 0;
}
