import type { Level } from './level.js';

/** One player's simulated state. Every field is part of the rollback snapshot. */
export interface PlayerState {
  x: number;
  y: number;
  vx: number;
  vy: number;
  facing: number;
  grounded: number;
  groundKind: number;
  coyote: number;
  jumpBuffer: number;
  jumpHeld: number;
  wallDir: number;
  gripping: number;
  gripX: number;
  gripY: number;
  grip: number;
  gripCooldown: number;
  stunned: number;
  dead: number;
  respawn: number;
  emote: number;
  emoteTimer: number;
  anim: number;
  ridePlatform: number;
  deaths: number;
  restartHeld: number;
  prevInput: number;
}

/** The crate. Verlet-integrated so it plays nicely with the rope solver. */
export interface CargoState {
  x: number;
  y: number;
  px: number;
  py: number;
  rot: number;
  rotV: number;
  hp: number;
  shake: number;
  grounded: number;
  /** Ticks since the crate last took damage, for self-repair. */
  calm: number;
  /**
   * Ticks of grace after a hazard bites, during which spikes cannot bite again.
   *
   * Hazard contact used to be evaluated every tick, so a spike did 34 damage
   * sixty times a second and three frames of brushing past one destroyed a
   * crate with full health. That is not a hazard, it is a trapdoor, and it
   * made the underside of the route unusable for level design: any spike the
   * crate could be dragged through was an instant loss. One bite per contact
   * is both fairer and far more readable — you hear it, you see the bar drop,
   * and you have time to haul the thing clear.
   */
  hurt: number;
}

/** Presentation-only events emitted by a tick. Rendered, never simulated. */
export interface SimEvent {
  kind: number;
  x: number;
  y: number;
  a: number;
  b: number;
}

/** The full mutable world. Cloned for rollback; hashed for desync detection. */
export interface World {
  tick: number;
  rng: number;
  players: PlayerState[];
  ropeX: Float64Array;
  ropeY: Float64Array;
  ropePX: Float64Array;
  ropePY: Float64Array;
  cargo: CargoState;
  crumble: Int32Array;
  /**
   * Whether each room's shutter is standing open this tick.
   *
   * Derived, not remembered: `step` recomputes it from where everybody is
   * before anything moves, so it is the same on every peer that agrees about
   * positions and it is deliberately absent from the snapshot and from
   * WORLD_KEYS. A rollback replays the ticks, and replaying them recomputes it.
   */
  open: Uint8Array;
  checkpoint: number;
  spawnX: number;
  spawnY: number;
  best: number;
  finished: number;
  finishTick: number;
  restartTimer: number;
  bonds: number;
  betrayals: number;
  /**
   * Ticks before another betrayal can be counted.
   *
   * Without this the counter incremented on every tick the rope was yanking
   * hard with exactly one hauler on the ground — which is a state that lasts
   * as long as the fall does, so one shove off a ledge scored somewhere
   * between ten and forty betrayals. The results screen was reporting a frame
   * count under a heading that reads as a number of incidents, and the
   * headline stat of the funniest screen in the game was noise.
   */
  yankHold: number;
  /**
   * Times somebody went up off their partner's shoulders.
   *
   * Counted because it is the only thing in the run that could not have
   * happened with one player, which makes it the honest measure of whether a
   * pair actually played together or merely took turns being in the way.
   */
  boosts: number;
  cargoBreaks: number;
  events: SimEvent[];
}

/** Immutable per-match context: the level and the run seed. */
export interface SimContext {
  level: Level;
  seed: number;
  mode: number;
}

export const EV_JUMP = 1;
export const EV_LAND = 2;
export const EV_DEATH = 3;
export const EV_RESPAWN = 4;
export const EV_CARGO_HIT = 5;
export const EV_CARGO_BREAK = 6;
export const EV_CHECKPOINT = 7;
export const EV_BOUNCE = 8;
export const EV_GRIP = 9;
export const EV_ROPE_YANK = 10;
export const EV_CRUMBLE = 11;
export const EV_FINISH = 12;
export const EV_EMOTE = 13;
export const EV_RESTART = 14;
export const EV_STEP = 15;
export const EV_CARGO_LAND = 16;
export const EV_REEL = 17;
/** A hauler launched off a braced partner. The only co-op verb that gains height. */
export const EV_BOOST = 18;
/**
 * A brace whose hands gave out, as opposed to one who chose to let go.
 *
 * Separate from EV_GRIP because it is the opposite piece of news: the anchor
 * under a rescue has just stopped existing, and the player holding the button
 * did nothing to cause it and gets no other signal that it happened.
 */
export const EV_GRIP_FAIL = 19;
/**
 * A shutter that has just moved, and which way it went.
 *
 * Two kinds rather than one with a flag, because they are the only events in
 * the game that routinely fire off-screen: the plate that opens a door can be
 * most of a rope away from it, so for the hauler standing on the plate the
 * sound is the entire report of what they just did. `a` is the hold group and
 * the position is the middle of its shutter, so a door at the far end of a
 * long room is quieter than the one you are standing in.
 */
export const EV_SHUTTER_OPEN = 20;
export const EV_SHUTTER_SHUT = 21;

export const MODE_HAUL = 0;
export const MODE_GAUNTLET = 1;

/** Ground material, used for footstep audio and friction. */
export const GROUND_NONE = 0;
export const GROUND_SOLID = 1;
export const GROUND_ICE = 2;
export const GROUND_CONVEYOR_L = 3;
export const GROUND_CONVEYOR_R = 4;
export const GROUND_CRUMBLE = 5;
export const GROUND_PLATFORM = 6;
export const GROUND_MOVER = 7;
