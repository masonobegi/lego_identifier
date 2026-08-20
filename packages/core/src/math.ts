/**
 * Deterministic math helpers.
 *
 * Everything in the simulation must produce bit-identical results on every
 * machine that runs the same build, because clients rollback-resimulate ticks
 * locally and compare state hashes with the authoritative server. IEEE-754
 * guarantees that `+ - * /` and `Math.sqrt` are correctly rounded, so those are
 * safe. `Math.sin`, `Math.cos`, `Math.pow`, `Math.atan2` and friends are NOT
 * specified to be correctly rounded and genuinely differ between engines and
 * CPU architectures, so the simulation never calls them. The approximations
 * below are built exclusively from safe primitives.
 */

export const PI = 3.141592653589793;
export const TAU = 6.283185307179586;
const INV_TAU = 0.15915494309189535;
const FOUR_OVER_PI = 1.2732395447351628;
const NEG_FOUR_OVER_PI_SQ = -0.40528473456935109;

/** Wrap an angle into [-PI, PI) using only exact operations. */
export function wrapAngle(x: number): number {
  let t = x * INV_TAU + 0.5;
  t = t - Math.floor(t);
  return t * TAU - PI;
}

/**
 * Sine approximation (max absolute error ~1.1e-3) built from multiply, add and
 * `Math.abs` only. Accurate enough for gameplay forces and visual wobble, and
 * identical everywhere.
 */
export function dsin(x: number): number {
  const a = wrapAngle(x);
  const y = FOUR_OVER_PI * a + NEG_FOUR_OVER_PI_SQ * a * (a < 0 ? -a : a);
  return 0.225 * (y * (y < 0 ? -y : y) - y) + y;
}

/** Cosine, via the sine identity. */
export function dcos(x: number): number {
  return dsin(x + 1.5707963267948966);
}

export function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

export function sign(v: number): number {
  return v < 0 ? -1 : v > 0 ? 1 : 0;
}

export function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/** Move `v` toward `target` by at most `maxDelta`. */
export function approach(v: number, target: number, maxDelta: number): number {
  if (v < target) {
    const n = v + maxDelta;
    return n > target ? target : n;
  }
  const n = v - maxDelta;
  return n < target ? target : n;
}

export function length(x: number, y: number): number {
  return Math.sqrt(x * x + y * y);
}

export function distance(ax: number, ay: number, bx: number, by: number): number {
  const dx = bx - ax;
  const dy = by - ay;
  return Math.sqrt(dx * dx + dy * dy);
}

/** Quantise to a fixed grid. Used to scrub float drift out of network state. */
export function quantise(v: number, step: number): number {
  return Math.round(v / step) * step;
}
