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
