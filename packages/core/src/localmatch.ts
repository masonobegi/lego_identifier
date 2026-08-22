import { IN_RESTART, RESTART_HOLD, TICK_RATE } from './constants.js';
import { levelForMatch } from './modes.js';
import { cloneWorld, copyWorldInto, createWorld } from './state.js';
import { step } from './sim.js';
import type { SimContext, SimEvent, World } from './types.js';
import type { MatchPhase } from './netclient.js';
import { Bot } from './bot.js';

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
  /**
   * A bot in a slot supplies that player's input instead of the caller.
   * Consulted once per simulation tick rather than once per frame, because a
   * bot that thinks at the display's rate holds its jump for the wrong length
   * of time on every machine but the author's.
   */
  readonly bots: (Bot | null)[] = [null, null];

  private accumulatorMs = 0;
  /**
   * Ticks of restart vote still owed to a reset asked for from outside the
   * match — the pause menu, which has no key to hold.
   *
   * Cast as input rather than by resetting the world here, so there is exactly
   * one description of what a checkpoint reset does and it lives in the
   * simulation. The player watches the same bar fill that a held key fills.
   */
  private forcedRestart = 0;

  /** Kept so a restart on a new seed can assemble the tower it asks for. */
  private readonly towerLength: number;

  constructor(mode: number, seed: number, towerLength: number) {
    const level = levelForMatch(mode, seed, towerLength);
    this.ctx = { level, seed, mode };
    this.towerLength = towerLength;
    this.world = createWorld(this.ctx);
    this.prev = cloneWorld(this.world);
  }

  update(dtMs: number, inputs: number[]): void {
    this.accumulatorMs += Math.min(dtMs, 250);
    let steps = 0;
    while (this.accumulatorMs >= TICK_MS && steps < MAX_STEPS_PER_FRAME) {
      this.accumulatorMs -= TICK_MS;
      copyWorldInto(this.prev, this.world);
      const masks = [inputs[0] & 0xff, inputs[1] & 0xff];
      // A checkpoint reset needs a held vote from both ends of the rope, and
      // the Autohauler never asks for one — it has no notion of being stuck.
      // Left alone that puts the reset out of reach of anybody playing beside
      // it: the bar the HUD fills from the lower of the two holds never leaves
      // zero, under an instruction to hold a key that can never be enough, and
      // a solo player who wedges the crate has nothing left but to abandon the
      // run. So the bot abstains rather than blocks, and echoes whoever is at
      // the keyboard. Only ever an echo: with two people on the sofa, one of
      // them holding restart must still not speak for the other.
      let echo = 0;
      for (let i = 0; i < 2; i++) if (!this.bots[i]) echo |= masks[i] & IN_RESTART;
      for (let i = 0; i < 2; i++) {
        const bot = this.bots[i];
        if (bot) masks[i] = (bot.think(this.world, i) & 0xff) | echo;
      }
      if (this.forcedRestart > 0) {
        this.forcedRestart--;
        masks[0] |= IN_RESTART;
        masks[1] |= IN_RESTART;
      }
      step(this.ctx, this.world, masks);
      for (const e of this.world.events) this.events.push(e);
      this.world.events.length = 0;
      this.localTick = this.world.tick;
      steps++;
    }
    this.alpha = Math.max(0, Math.min(1, this.accumulatorMs / TICK_MS));
    if (this.world.finished && this.phase === 'running') this.phase = 'ended';
  }

  /** Put a bot in a player slot, or clear it with null. */
  setBot(index: number, bot: Bot | null): void {
    this.bots[index] = bot;
  }

  /**
   * Hold restart on both haulers' behalf, as the pause menu does.
   *
   * The hold is there so a mis-hit key cannot throw away a climb. Picking the
   * reset out of a menu is already deliberate, but it still goes through the
   * vote: the reset beat, the crate repair and the crumbled ledges coming back
   * are the simulation's business, not the caller's.
   */
  resetToCheckpoint(): void {
    this.forcedRestart = RESTART_HOLD;
  }

  /**
   * Start the run over, optionally on a different tower.
   *
   * A new seed only means a new tower if the level is assembled again from it.
   * Resetting the world onto the level already built spends the seed on
   * `world.rng` and nothing else, which made every Gauntlet "play again" the
   * identical tower — the mode's whole promise, silently reduced to one level.
   *
   * The level is only reassembled when the seed actually moves, because the
   * two callers that restart on the same seed (the menu backdrop looping, a
   * campaign retry) would otherwise pay for a rebuild that cannot change
   * anything, and the campaign's is the expensive one.
   */
  restart(seed = this.ctx.seed): void {
    if (seed !== this.ctx.seed) {
      this.ctx.seed = seed;
      this.ctx.level = levelForMatch(this.ctx.mode, seed, this.towerLength);
      // A bot's route is planned once, against the level it was handed. Left
      // alone it would walk the old tower's route through the new one.
      for (let i = 0; i < 2; i++) if (this.bots[i]) this.bots[i] = new Bot(this.ctx.level);
    }
    this.world = createWorld(this.ctx);
    this.prev = cloneWorld(this.world);
    this.phase = 'running';
    this.localTick = 0;
    this.events.length = 0;
    this.forcedRestart = 0;
    for (const bot of this.bots) bot?.reset();
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
