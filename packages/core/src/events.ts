import type { SimEvent, World } from './types.js';

/** Hard cap so a pathological tick can never balloon memory during rollback. */
const MAX_EVENTS = 64;

/**
 * Presentation events. The renderer and audio engine consume these; nothing in
 * the simulation ever reads them, and they are deliberately excluded from the
 * state hash so that dropping them during rollback cannot cause a desync.
 */
export function pushEvent(world: World, kind: number, x: number, y: number, a: number, b: number): void {
  if (world.events.length >= MAX_EVENTS) return;
  world.events.push({ kind, x, y, a, b });
}

export function drainEvents(world: World): SimEvent[] {
  const out = world.events;
  world.events = [];
  return out;
}

/**
 * Remember the worst thing that happened, if this is it.
 *
 * The results card is a row of counts, and a count summarises an evening
 * rather than telling a story about one. What a pair actually repeat to each
 * other afterwards is a moment — the drop, the yank, the fall — so the run
 * keeps the single most expensive one it saw, with the tick it happened on, and
 * the card names it.
 *
 * Ranked by metres rather than by kind, because that is the only currency the
 * three of them share and it is also the one a player felt.
 */
export function recordWorst(world: World, kind: number, metres: number): void {
  if (metres <= world.worstValue) return;
  world.worstTick = world.tick;
  world.worstKind = kind;
  world.worstValue = metres;
}

/** What `World.worstKind` means. */
export const WORST_CRATE = 1;
export const WORST_BETRAYAL = 2;
export const WORST_FALL = 3;
