import {
  CARGO_HP,
  CARGO_REPAIR_PER_TICK,
  CRUMBLE_DELAY,
  CRUMBLE_RESPAWN,
  IN_RESTART,
  PLAYER_H,
  PLAYER_HALF_W,
  RESET_DELAY,
  RESPAWN_TICKS,
  RESTART_HOLD,
  GOAL_CARGO_REACH,
  TILE,
} from './constants.js';
import { hazardAt } from './hazards.js';
import { T_CHECKPOINT, T_GOAL, type Level, tileAt } from './level.js';
import { MAX_RISE } from './route.js';
import { applyRopeForces, clampRopeLength, solveRope, tightenRope } from './rope.js';
import { applyRopeLoad, updateCargo } from './cargo.js';
import { updateHolds } from './physics.js';
import { resolveBoosts, updatePlayer } from './player.js';
import { placeAtSpawn } from './state.js';
import { pushEvent } from './events.js';
import {
  EV_CHECKPOINT,
  EV_CRUMBLE,
  EV_DEATH,
  EV_FINISH,
  EV_RESPAWN,
  EV_RESTART,
  type SimContext,
  type World,
} from './types.js';

const HALF_H = PLAYER_H / 2;
/** Death hitbox is inset from the body so near misses stay near misses. */
const HURT_INSET_X = 5;
const HURT_INSET_Y = 5;

function updateCrumble(world: World): void {
  const c = world.crumble;
  for (let i = 0; i < c.length; i++) {
    const s = c[i];
    if (s > 0) {
      c[i] = s + 1 > CRUMBLE_DELAY ? -CRUMBLE_RESPAWN : s + 1;
    } else if (s < 0) {
      c[i] = s + 1;
    }
  }
}

function killPlayer(world: World, index: number, x: number, y: number): void {
  const p = world.players[index];
  if (p.dead) return;
  p.dead = 1;
  p.gripping = 0;
  p.respawn = RESPAWN_TICKS;
  p.deaths++;
  p.vy = -140;
  pushEvent(world, EV_DEATH, x, y, index, 0);
}

function triggerReset(world: World): void {
  if (world.restartTimer > 0) return;
  world.restartTimer = RESET_DELAY;
  pushEvent(world, EV_RESTART, world.spawnX, world.spawnY, 0, 0);
}

function checkCheckpoints(world: World, ctx: SimContext): void {
  const level = ctx.level;
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    if (p.dead) continue;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    for (let oy = -1; oy <= 1; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (tileAt(level, tx + ox, ty + oy) !== T_CHECKPOINT) continue;
        const cx = (tx + ox) * TILE + TILE / 2;
        const cy = (ty + oy) * TILE + TILE / 2;
        // Only ever move the respawn point upward.
        if (cy < world.spawnY - 8) {
          world.spawnX = cx;
          world.spawnY = cy;
          world.checkpoint++;
          world.cargo.hp = CARGO_HP;
          pushEvent(world, EV_CHECKPOINT, cx, cy, world.checkpoint, 0);
        } else if (Math.abs(cy - world.spawnY) <= 8 && world.cargo.hp < CARGO_HP) {
          // Lingering at your last checkpoint patches the crate back up.
          world.cargo.hp = Math.min(CARGO_HP, world.cargo.hp + CARGO_REPAIR_PER_TICK);
        }
      }
    }
  }
}

/**
 * Are both haulers touching the goal?
 *
 * Exported because the HUD needs to say why a pair standing on the goal is not
 * finishing, and the only thing worse than a rule the player cannot see is two
 * copies of it that disagree.
 */
export function pairAtGoal(world: World, level: Level): boolean {
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    if (p.dead) return false;
    const tx = Math.floor(p.x / TILE);
    const ty = Math.floor(p.y / TILE);
    let touching = false;
    for (let oy = -1; oy <= 1 && !touching; oy++) {
      for (let ox = -1; ox <= 1; ox++) {
        if (tileAt(level, tx + ox, ty + oy) === T_GOAL) {
          touching = true;
          break;
        }
      }
    }
    if (!touching) return false;
  }
  return true;
}

/** Has the load been brought up with them, in one piece? */
export function cargoAtGoal(world: World, level: Level): boolean {
  if (world.cargo.hp <= 0) return false;
  const dx = world.cargo.x - level.goalX;
  const dy = world.cargo.y - level.goalY;
  return dx * dx + dy * dy <= GOAL_CARGO_REACH * GOAL_CARGO_REACH;
}

function checkGoal(world: World, ctx: SimContext): void {
  if (world.finished) return;
  const level = ctx.level;
  // The crate has to arrive too.
  //
  // It never used to. This asked only that both haulers were touching the goal
  // tile, so in a game named after hauling a crate up a tower, the crate was
  // not part of finishing one — which is the deepest reason nothing in the
  // game ever made anybody care about it. A pair who sprint to the top and
  // leave the load three ledges down have not finished the level; they have
  // abandoned it.
  if (!pairAtGoal(world, level) || !cargoAtGoal(world, level)) return;

  world.finished = 1;
  world.finishTick = world.tick;
  pushEvent(world, EV_FINISH, level.goalX, level.goalY, world.tick, 0);
}

/**
 * Advance the world by exactly one tick.
 *
 * This function is the contract between every peer in a match: given the same
 * `ctx`, the same `world` and the same `inputs`, it must produce byte-identical
 * output everywhere. Nothing in here may read wall-clock time, `Math.random`,
 * or any transcendental math function.
 */
export function step(ctx: SimContext, world: World, inputs: number[]): void {
  const level = ctx.level;
  world.tick++;
  // Before anything moves, so both peers read the same doors all tick, and so
  // a shutter that is about to close is still open for whoever is inside it.
  updateHolds(level, world);
  updateCrumble(world);

  for (let i = 0; i < world.crumble.length; i++) {
    if (world.crumble[i] === CRUMBLE_DELAY) {
      const tile = level.crumbleTile[i];
      pushEvent(world, EV_CRUMBLE, (tile % level.w) * TILE + TILE / 2, Math.floor(tile / level.w) * TILE + TILE / 2, 0, 0);
    }
  }

  if (world.yankHold > 0) world.yankHold--;

  if (world.restartTimer > 0) {
    world.restartTimer--;
    if (world.restartTimer === 0) {
      placeAtSpawn(level, world, world.spawnX, world.spawnY);
      world.cargo.hp = CARGO_HP;
      world.crumble.fill(0);
      pushEvent(world, EV_RESPAWN, world.spawnX, world.spawnY, -1, 0);
    }
    // Controls are locked during the reset beat so nobody instantly re-dies.
    const frozen = [0, 0];
    applyRopeForces(world, level, frozen);
    updatePlayer(level, world, 0, 0);
    updatePlayer(level, world, 1, 0);
    solveRope(world, level);
    clampRopeLength(world, level);
    updateCargo(level, world);
    tightenRope(world);
    return;
  }

  const effective = world.finished ? [0, 0] : inputs;

  applyRopeForces(world, level, effective);
  const boosts = resolveBoosts(world, effective);
  updatePlayer(level, world, 0, effective[0], boosts[0]);
  updatePlayer(level, world, 1, effective[1], boosts[1]);
  solveRope(world, level);
  clampRopeLength(world, level);
  applyRopeLoad(world);
  updateCargo(level, world);
  // The crate has just hauled on the rope's middle node. Put the rope back
  // inside its own length before anything reads it, or a crate that cannot
  // move drags the middle a little further toward itself every tick, for ever.
  tightenRope(world);

  /* --------------------------------------------------------------- deaths */
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    if (p.dead) continue;
    const left = p.x - PLAYER_HALF_W + HURT_INSET_X;
    const right = p.x + PLAYER_HALF_W - HURT_INSET_X;
    const top = p.y - HALF_H + HURT_INSET_Y;
    const bottom = p.y + HALF_H - HURT_INSET_Y;
    if (hazardAt(level, world, left, top, right, bottom) || p.y > level.heightPx + 260) {
      killPlayer(world, i, p.x, p.y);
    }
  }

  /* -------------------------------------------------------------- revival */
  const bothDead = world.players[0].dead === 1 && world.players[1].dead === 1;
  if (bothDead) {
    triggerReset(world);
  } else {
    for (let i = 0; i < 2; i++) {
      const p = world.players[i];
      if (!p.dead || p.respawn > 0) continue;
      const other = world.players[1 - i];

      // Coming back next to your partner is a rescue. It must not be a lift.
      //
      // This used to be unconditional, and it quietly beat every co-operative
      // verb in the game. Reeling moves you 430 px/s along a rope that is 232px
      // long and drains your grip; a boost costs the brace a fifth of their bar
      // and needs both of you lined up. Dying is instant, unlimited, free, and
      // goes as far as your partner has got — so at a gate, the fastest way for
      // the second hauler to follow the first is to walk into a spike. Every
      // gate in the tower, and the entire reason the campaign needs two people,
      // was one bad habit away from being decoration.
      //
      // So: if your partner is meaningfully above where you died, you go back
      // to the checkpoint instead. Level with them or below, you get the
      // rescue, which is the version of this that makes the game forgiving
      // rather than the version that makes it pointless.
      const lift = p.y - other.y > (MAX_RISE + 1) * TILE;
      if (lift) {
        placeAtSpawn(level, world, world.spawnX, world.spawnY);
        pushEvent(world, EV_RESPAWN, world.spawnX, world.spawnY, i, 1);
        continue;
      }

      // And put them somewhere that is not itself lethal. The death sweep runs
      // earlier in this same tick, so a body placed inside a spike dies again
      // on the next one, which reads as the game taking two lives for one
      // mistake and can loop.
      let px = other.x - other.facing * 26;
      const py = other.y - 12;
      for (const dx of [0, 26, -26, 52, -52]) {
        const x = other.x - other.facing * 26 + dx;
        const clear = !hazardAt(
          level,
          world,
          x - PLAYER_HALF_W + HURT_INSET_X,
          py - PLAYER_H / 2 + HURT_INSET_Y,
          x + PLAYER_HALF_W - HURT_INSET_X,
          py + PLAYER_H / 2 - HURT_INSET_Y,
        );
        if (clear) {
          px = x;
          break;
        }
      }

      p.dead = 0;
      p.respawn = 0;
      p.stunned = 8;
      p.grip = 0;
      p.gripCooldown = 20;
      p.x = px;
      p.y = py;
      p.vx = other.vx * 0.5;
      p.vy = -180;
      pushEvent(world, EV_RESPAWN, p.x, p.y, i, 0);
    }
  }

  if (world.cargo.hp <= 0) triggerReset(world);

  /* ------------------------------------------------------------- progress */
  checkCheckpoints(world, ctx);
  checkGoal(world, ctx);

  const midY = (world.players[0].y + world.players[1].y) * 0.5;
  if (midY < world.best) world.best = midY;

  // "Bonds": one of you anchored while the other is in the air is the whole
  // co-op loop working. Counted here so the results screen can praise it.
  const a = world.players[0];
  const b = world.players[1];
  if ((a.gripping === 1 && b.grounded === 0 && !b.dead) || (b.gripping === 1 && a.grounded === 0 && !a.dead)) {
    if (world.tick % 20 === 0) world.bonds++;
  }

  /* --------------------------------------------------- manual reset voting */
  let bothHolding = true;
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    if ((effective[i] & IN_RESTART) !== 0) p.restartHeld++;
    else p.restartHeld = 0;
    if (p.restartHeld < RESTART_HOLD) bothHolding = false;
  }
  if (bothHolding && !world.finished) {
    world.players[0].restartHeld = 0;
    world.players[1].restartHeld = 0;
    triggerReset(world);
  }
}

/** Advance `count` ticks with the same inputs. Used by tests and by rollback. */
export function stepMany(ctx: SimContext, world: World, inputs: number[], count: number): void {
  for (let i = 0; i < count; i++) step(ctx, world, inputs);
}
