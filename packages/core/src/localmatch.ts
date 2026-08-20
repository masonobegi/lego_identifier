import { TICK_RATE } from './constants.js';
import { levelForMatch } from './modes.js';
import { cloneWorld, copyWorldInto, createWorld } from './state.js';
import { step } from './sim.js';
import type { SimContext, SimEvent, World } from './types.js';
import type { MatchPhase } from './netclient.js';

const TICK_MS = 1000 / TICK_RATE;
const MAX_STEPS_PER_FRAME = 6;

/**
 * Couch co-op and practice: the same simulation with both inputs supplied
 * locally and no network in the loop. Shares the session shape with the online
 * client so the renderer, HUD and audio never learn which one they are drawing.
 */
export class LocalMatch {
  readonly ctx: SimContext;
  world: World;
  prev: World;
  alpha = 0;
  phase: MatchPhase = 'running';
  localIndex = -1;
  events: SimEvent[] = [];
  localTick = 0;

  private accumulatorMs = 0;

  constructor(mode: number, seed: number, towerLength: number) {
    const level = levelForMatch(mode, seed, towerLength);
    this.ctx = { level, seed, mode };
    this.world = createWorld(this.ctx);
    this.prev = cloneWorld(this.world);
  }

  update(dtMs: number, inputs: number[]): void {
    this.accumulatorMs += Math.min(dtMs, 250);
    let steps = 0;
    while (this.accumulatorMs >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      this.accumulatorMs -= TICK_MS;
      copyWorldInto(this.prev, this.world);
      step(this.ctx, this.world, [inputs[0] & 0xff, inputs[1] & 0xff]);
      for (const e of this.world.events) this.events.push(e);
      this.world.events.length = 0;
      this.localTick = this.world.tick;
      steps++;
    }
    this.alpha = Math.max(0, Math.min(1, this.accumulatorMs / TICK_MS));
    if (this.world.finished && this.phase === 'running') this.phase = 'ended';
  }

  restart(seed = this.ctx.seed): void {
    this.world = createWorld({ ...this.ctx, seed });
    this.prev = cloneWorld(this.world);
    this.phase = 'running';
    this.localTick = 0;
    this.events.length = 0;
  }

  drainEvents(): SimEvent[] {
    const out = this.events;
    this.events = [];
    return out;
  }

  dispose(): void {
    this.events.length = 0;
  }
}
