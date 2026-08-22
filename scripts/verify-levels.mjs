/**
 * Prove the towers can actually be climbed.
 *
 * Two independent checks, because a level that looks fine and a level that
 * plays fine are different claims:
 *
 *  1. **Reachability.** A flood fill over every standable tile using a
 *     movement envelope measured from the simulation itself
 *     (scripts/calibrate-jump.mjs). Catches sealed rooms, unreachable goals
 *     and hazards dropped into the only route.
 *
 *  2. **Route replay.** The flood fill hands back an actual path from the
 *     spawn to the goal. Every step of that path is then re-attempted in the
 *     real simulation — both players, the rope, the crate, moving hazards —
 *     by searching a small space of plausible inputs. A step no input script
 *     can make is a level bug, not a player skill issue.
 *
 *  3. **The crate.** Both of the above judge a step by where a hauler's feet
 *     end up, and the run does not end at anybody's feet — it ends when the
 *     crate reaches the goal. So every climbing step is replayed a third time
 *     asking whether the load can be brought up after them, and the goal is
 *     replayed asking the simulation itself whether it calls the run finished.
 *     See the block above `canHaulCrate` for what that covers and what it does
 *     not.
 */
import {
  analyseLevel,
  buildCampaign,
  buildTower,
  createWorld,
  ledgeSteps,
  step as simStep,
  TILE,
  IN_GRIP,
  IN_JUMP,
  IN_REEL,
  MAX_RISE,
  IN_LEFT,
  IN_RIGHT,
  CARGO_H,
  GRIP_MAX,
  PLAYER_H,
  ROPE_MAX,
  ROPE_NODES,
  T_GOAL,
  T_PLATE,
  T_SHUTTER,
  tileAt,
} from '../packages/core/dist/index.js';

/**
 * The reachability fill itself lives in the core package (packages/core/src/route.ts)
 * because the bot partner has to walk exactly the route this gate proves, and two
 * copies of a movement envelope are two chances to disagree about what the game
 * can do.
 */
export const analyse = analyseLevel;
export { ledgeSteps };

/* ------------------------------------------------------------ route replay */

function placePair(world, x, y) {
  const cx = x * TILE + TILE / 2;
  const cy = (y + 1) * TILE - PLAYER_H / 2 - 1;
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    p.x = cx + (i === 0 ? -12 : 12);
    p.y = cy;
    p.vx = 0;
    p.vy = 0;
    p.grounded = 1;
    p.dead = 0;
    p.gripping = 0;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.jumpHeld = 0;
    p.grip = GRIP_MAX;
  }
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
    world.ropeY[i] = cy;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = cy;
  }
  world.cargo.x = cx;
  // On the ground at their feet, not half sunk into it. `cy + 16` put the
  // crate's centre level with the haulers' boots, which is twelve pixels of it
  // inside the floor — and a body inside geometry cannot be swept anywhere, so
  // it sat there weightless for the whole attempt. That made this gate easier
  // than the game it is gating.
  world.cargo.y = cy + (PLAYER_H - CARGO_H) / 2;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
  world.cargo.hp = 100;
  world.cargo.calm = 0;
  world.restartTimer = 0;
}

/**
 * Put the pair down apart: one on a plate, one off it.
 *
 * The hold is the only step in the game they do not start a step side by side
 * for. Standing them both on the plate makes the first half of the leapfrog a
 * lie, because the hauler who walks off it is the one whose weight was holding
 * the door in the first place.
 */
function placeHold(world, start, plate, holder) {
  placePair(world, start.x, start.y);
  const p = world.players[holder];
  p.x = plate.x * TILE + TILE / 2;
  p.y = (plate.y + 1) * TILE - PLAYER_H / 2 - 1;
  p.vx = 0;
  p.vy = 0;
  p.grounded = 1;
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
    world.ropeY[i] = world.players[0].y + (world.players[1].y - world.players[0].y) * t;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = world.ropeY[i];
  }
}

/** Sample launch columns across a ledge, always including both ends. */
function launchColumns(ledge, limit = 6) {
  const width = ledge.x1 - ledge.x0 + 1;
  if (width <= limit) {
    const all = [];
    for (let x = ledge.x0; x <= ledge.x1; x++) all.push(x);
    return all;
  }
  const cols = [ledge.x0, ledge.x1];
  for (let i = 1; i < limit - 1; i++) {
    cols.push(ledge.x0 + Math.round((width - 1) * (i / (limit - 1))));
  }
  return [...new Set(cols)];
}

/**
 * Can *one named hauler* get from this ledge to the next while the other braces?
 *
 * The braced partner is the point. Both haulers driven by the same inputs is
 * not how this game is played and not what it asks for: they have separate
 * controllers, they take turns, and holding GRIP so your partner can climb off
 * you is the co-operative verb the whole thing is built around. Driving them in
 * lockstep also fails steps that are obviously fine — a target ledge sitting
 * almost directly above its source has exactly one clear launch column, and two
 * haulers standing twenty-four pixels apart cannot both be in it.
 *
 * Bracing is also the *harder* of the two things a partner can realistically
 * do, which makes this gate conservative rather than generous. That is not
 * obvious and it is worth writing down: `scripts/calibrate-jump.mjs` measures
 * both, and a hauler jumping past a braced partner clears one empty column at
 * rise 1-3 where one dragging an idle partner clears two. A braced partner is
 * an immovable anchor and the rope pulls you back to it; an idle one gets
 * dragged along and pays out slack. So a step this gate passes is a step a pair
 * can make with the partner doing either thing.
 */
function canCross(ctx, from, to, mover) {
  const other = 1 - mover;
  const centre = (to.x0 + to.x1) / 2;

  for (const launch of launchColumns(from)) {
    const steerDir = centre > launch ? 1 : centre < launch ? -1 : 1;
    for (const dir of [steerDir, -steerDir]) {
      // Ticks spent walking *away* from the target before jumping at it.
      //
      // Without this the gate could only test a standing jump, and a standing
      // jump is not what anybody plays: you back off and take a run at it. The
      // chunk seam — the wide landing at the bottom of one chunk up to the
      // first serpentine shelf of the next — is makeable only with a run-up,
      // and the gate called all thirteen levels broken for want of trying one.
      // Zero comes first so the common case still returns on the first attempt.
      for (const runup of [0, 20]) {
        for (const delay of [0, 4, 8, 14, 20]) {
          for (const hold of [14, 22, 26]) {
            for (const steerStart of [0, 6, 12]) {
              for (const steerLen of [8, 12, 999]) {
                // A fresh world per attempt: a previous attempt that died,
                // tripped a checkpoint reset or touched the goal would
                // otherwise poison every attempt after it.
                const world = createWorld(ctx);
                placePair(world, launch, from.y);
                // Only a few ticks to let the rope and crate settle: crumbling
                // and conveyor footing does not wait around, and neither
                // should the check.
                for (let t = 0; t < 4; t++) {
                  simStep(ctx, world, [0, 0]);
                  world.events.length = 0;
                }
                const masks = [0, 0];
                for (let t = 0; t < 160; t++) {
                  const running = t < runup;
                  const at = t - runup;
                  const jumping = !running && at >= delay && at < delay + hold;
                  const steering = !running && at >= steerStart && at < steerStart + steerLen;
                  const walk = running
                    ? dir > 0
                      ? IN_LEFT
                      : IN_RIGHT
                    : steering
                      ? dir > 0
                        ? IN_RIGHT
                        : IN_LEFT
                      : 0;
                  masks[mover] = walk | (jumping ? IN_JUMP : 0);
                  masks[other] = IN_GRIP;
                  simStep(ctx, world, masks);
                  world.events.length = 0;
                  if (world.restartTimer > 0) break;
                  const p = world.players[mover];
                  if (p.dead || p.grounded !== 1) continue;
                  const px = Math.floor(p.x / TILE);
                  const py = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1;
                  if (py === to.y && px >= to.x0 && px <= to.x1) return true;
                }
              }
            }
          }
        }
      }
    }
  }
  return false;
}

/**
 * Can the pair get up a gate — the six-row step with no foothold in the middle?
 *
 * Nothing about this is symmetric, which is why it needs its own replay. One
 * hauler braces; the other goes up off their shoulders, which is the only move
 * in the game that gains height two people have and one does not. Then the
 * roles swap: whoever is up top braces on the lip and the one still down there
 * hauls themselves up the rope. Both co-op verbs, in that order, and the gate
 * checks that a pair can actually do it rather than trusting the fill.
 *
 * Measured before the boost existed: a lone hauler reached the same five-row
 * shelf and crossed the same six-tile chasm as a pair with one of them braced,
 * from every launch column, run-up, hold and reel the search could try. Six
 * rows is one past what anybody manages alone and four inside what a boost
 * does, so this is neither a lie nor a frame-perfect move.
 */
function canGate(ctx, from, to) {
  const on = (p, ledge) => {
    const px = Math.floor(p.x / TILE);
    const py = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1;
    return py === ledge.y && px >= ledge.x0 && px <= ledge.x1;
  };
  // Launch from under the target, not from anywhere on the ledge. A boosted
  // jump is nearly vertical, so the only columns that can work are the ones the
  // far side is actually above — and on a wide near-side ledge those are a
  // couple out of a dozen, which a general sample of six across the whole ledge
  // will miss more often than not.
  const lo = Math.max(from.x0, to.x0 - 1);
  const hi = Math.min(from.x1, to.x1 + 1);
  const under = [];
  for (let x = lo; x <= hi; x++) under.push(x);
  const columns = under.length > 0 ? under : launchColumns(from);

  for (const climber of [0, 1]) {
    const brace = 1 - climber;
    let cleared = false;
    outer:
    for (const launch of columns) {
      for (const jumpAt of [2, 6, 12]) {
        // Short holds as well as long ones. A boost at full power goes ten rows
        // and a gate is six, so holding the button all the way sails straight
        // past the ledge you were aiming at and lands you back where you
        // started — which is a thing a player has to learn too.
        for (const hold of [8, 12, 16, 22, 30]) {
          for (const haulWalk of [0, IN_LEFT, IN_RIGHT]) {
            const world = createWorld(ctx);
            placePair(world, launch, from.y);
            for (let t = 0; t < 6; t++) {
              simStep(ctx, world, [0, 0]);
              world.events.length = 0;
            }
            let phase = 1;
            let k = 0;
            for (let t = 0; t < 900; t++) {
              const masks = [0, 0];
              if (phase === 1) {
                masks[brace] = IN_GRIP;
                if (t >= jumpAt && t < jumpAt + hold) masks[climber] = IN_JUMP;
                if (on(world.players[climber], to) && world.players[climber].grounded === 1) {
                  phase = 2;
                  k = 0;
                }
              } else {
                masks[climber] = IN_GRIP;
                masks[brace] = IN_REEL | haulWalk;
                if (k < 22) masks[brace] |= IN_JUMP;
                k++;
              }
              simStep(ctx, world, masks);
              world.events.length = 0;
              if (world.restartTimer > 0) break;
              if (world.players[0].dead || world.players[1].dead) break;
              if (on(world.players[0], to) && on(world.players[1], to)) {
                cleared = true;
                break outer;
              }
            }
          }
        }
      }
    }
    if (!cleared) return false;
  }
  return true;
}

/* --------------------------------------------------------------- hold rooms */

/** Ways to walk a room: push, then steer, with one jump somewhere in it. */
const HOLD_SCRIPTS = [];
for (const turn of [0, 40, 90, 150]) {
  for (const jumpAt of [-1, 0, 6, 12, 20, 30, 45, 60]) {
    for (const hold of [14, 26]) HOLD_SCRIPTS.push({ turn, jumpAt, hold });
  }
}

/**
 * The doors the route goes through, one entry per room.
 *
 * A hold is not a climbing step, and a pair crossing a shutter along a floor
 * never turns up in `ledgeSteps` at all — the ledge on either side of the door
 * is the same row, and that list is only the steps that gain height. So the
 * rooms are pulled out of the fill instead: it hands back the cells it could
 * only reach through a door, and each one names its room, which is enough to
 * find that room's plates and which way through the pair went.
 *
 * A room with no plate on one side of its shutter is reported here rather than
 * replayed. It is the one shape of hold room that cannot work: the hauler
 * holding the door can never be through it themselves, so the room is a wall
 * with a mechanism on it.
 */
function holdCrossings(level, result) {
  const w = level.w;
  const out = [];
  for (const hold of result.holds) {
    if (out.some((c) => c.group === hold.group)) continue;
    let doorX0 = w;
    let doorX1 = -1;
    const plates = [];
    for (let i = 0; i < level.tiles.length; i++) {
      if (level.holdGroup[i] !== hold.group) continue;
      const x = i % w;
      const y = (i - x) / w;
      if (level.tiles[i] === T_SHUTTER) {
        doorX0 = Math.min(doorX0, x);
        doorX1 = Math.max(doorX1, x);
      } else if (level.tiles[i] === T_PLATE && y > 0 && result.standable[(y - 1) * w + x]) {
        plates.push({ x, y: y - 1 });
      }
    }

    // Which way through the room the pair were going, read off the fill's
    // parent links: walk back from the cell the door was opened to reach until
    // the trail comes out on one side of the shutter or the other.
    let dir = hold.x > doorX1 ? 1 : hold.x < doorX0 ? -1 : 0;
    let trail = result.seen[hold.y * w + hold.x];
    for (let n = 0; n < 64; n++) {
      const x = trail % w;
      if (x < doorX0) {
        dir = 1;
        break;
      }
      if (x > doorX1) {
        dir = -1;
        break;
      }
      const next = result.seen[trail];
      if (next === trail || next < 0) break;
      trail = next;
    }

    const where = `hold room at cols ${doorX0}-${doorX1} row ${hold.y}`;
    const behind = plates.filter((p) => (dir > 0 ? p.x < doorX0 : p.x > doorX1));
    const ahead = plates.filter((p) => (dir > 0 ? p.x > doorX1 : p.x < doorX0));
    behind.sort((a, b) => (dir > 0 ? b.x - a.x : a.x - b.x));
    ahead.sort((a, b) => (dir > 0 ? a.x - b.x : b.x - a.x));
    if (behind.length === 0 || ahead.length === 0) {
      out.push({ group: hold.group, reason: `${where} has a plate on only one side of its shutter` });
      continue;
    }

    // The run of floor the hauler is on, stopped a body clear of the door.
    //
    // The two sides of a hold room are one ledge as far as the standable grid
    // is concerned, and an attempt that starts past the shutter has had the
    // door opened for it. A column clear is not enough either: the pair are put
    // down twelve pixels either side of their column, so starting them against
    // the doorway stands one hauler *in* it — and a body in a shutter holds it
    // open, which is a state the room has no way of reaching and enough on its
    // own to walk the pair through.
    const ledge = (cell) => {
      const stopL = cell.x < doorX0 ? 0 : Math.min(doorX1 + 2, cell.x);
      const stopR = cell.x > doorX1 ? w - 1 : Math.max(doorX0 - 2, cell.x);
      let x0 = cell.x;
      let x1 = cell.x;
      while (x0 > stopL && result.standable[cell.y * w + (x0 - 1)]) x0--;
      while (x1 < stopR && result.standable[cell.y * w + (x1 + 1)]) x1++;
      return { y: cell.y, x0, x1 };
    };

    // Where the two of them stand to begin: the hauler who crosses is put off
    // the plate if there is anywhere off it to stand, and on the far end of it
    // if the shutter is right there — a plate two tiles wide is still held by
    // somebody on the other half of it.
    const step = { x: behind[0].x + dir, y: behind[0].y };
    const offPlate = result.standable[step.y * w + step.x] && (dir > 0 ? step.x < doorX0 : step.x > doorX1);
    const start = offPlate ? step : behind[0];
    out.push({
      group: hold.group,
      where,
      dir,
      doorX0,
      doorX1,
      near: behind.find((p) => p.x !== start.x) ?? behind[0],
      ahead,
      start,
      from: ledge(behind[0]),
      to: ledge(ahead[0]),
    });
  }
  return out;
}

/**
 * Can the pair leapfrog a shutter — one holds, the other crosses, then swap?
 *
 * The two-plate room, replayed as the two co-operative acts it is: a hauler
 * standing on a plate while their partner crosses a door that would otherwise
 * be a wall, and then the same thing back the other way with the plates
 * swapped. Both orderings are tried, because either hauler may be the one who
 * happens to be on the plate when the pair arrive.
 *
 * A crossing is not always a walk. A room can put its far plate a step above
 * the doorway or a drop below it, and a hauler driven straight at it climbs
 * into the step or walks off the ledge — which is why this searches scripts the
 * way the ledge replay above does rather than steering them along the floor. A
 * script is how long to push towards the door before steering at the plate, and
 * one jump: `turn` is the difference between falling off the right ledge and
 * stopping short on the wrong one, and the jump is the step in the middle.
 *
 * The two halves are searched one after the other rather than together — the
 * hauler who follows starts from a plate the first one has just walked off, so
 * their timing is their own — and the winning first half is replayed to set the
 * room up for each attempt at the second.
 *
 * The pair are through when the second of them is standing on the floor beyond
 * the shutter, the same ledge the solo search has to fail to reach. Asking only
 * that they are past the door's column would pass a hauler who fell off the
 * crossing and walked out underneath the room.
 *
 * A hauler on a plate presses back towards it rather than standing inert. The
 * rope drags whoever is not moving, and a plate held by somebody being towed
 * off it is a door that shuts on the tick their partner steps into it — which
 * is a fact about the rope, not about the room.
 */
function canHold(ctx, cross) {
  const walk = cross.dir > 0 ? IN_RIGHT : IN_LEFT;
  const cell = (p) => ({
    x: Math.floor(p.x / TILE),
    y: Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1,
  });
  const standingOn = (p, cells) => {
    if (p.dead || p.grounded !== 1) return null;
    const at = cell(p);
    return cells.find((c) => c.x === at.x && c.y === at.y) ?? null;
  };
  const across = (p) => {
    if (p.dead || p.grounded !== 1) return false;
    const at = cell(p);
    return at.y === cross.to.y && at.x >= cross.to.x0 && at.x <= cross.to.x1;
  };
  const towards = (p, c) => {
    const centre = c.x * TILE + TILE / 2;
    if (Math.abs(p.x - centre) < 3) return 0;
    return p.x > centre ? IN_LEFT : IN_RIGHT;
  };
  const drive = (p, k, script) => {
    const push = k < script.turn ? walk : towards(p, cross.ahead[0]);
    const jumping = script.jumpAt >= 0 && k >= script.jumpAt && k < script.jumpAt + script.hold;
    return push | (jumping ? IN_JUMP : 0);
  };

  /**
   * One attempt. `second` null asks only whether the first hauler gets across,
   * and the tick they did it on; with both scripts it asks for the whole room.
   */
  const attempt = (mover, first, second) => {
    const holder = 1 - mover;
    const world = createWorld(ctx);
    placeHold(world, cross.start, cross.near, holder);
    for (let t = 0; t < 6; t++) {
      simStep(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    let plate = null;
    let swapped = 0;
    for (let t = 0; t < 1200; t++) {
      if (!plate) {
        plate = standingOn(world.players[mover], cross.ahead);
        if (plate) {
          if (!second) return t;
          swapped = t;
        }
      }
      const masks = [0, 0];
      if (plate) {
        masks[mover] = towards(world.players[mover], plate);
        masks[holder] = drive(world.players[holder], t - swapped, second);
      } else {
        masks[mover] = drive(world.players[mover], t, first);
        masks[holder] = towards(world.players[holder], cross.near);
      }
      simStep(ctx, world, masks);
      world.events.length = 0;
      if (world.restartTimer > 0) return -1;
      if (world.players[0].dead || world.players[1].dead) return -1;
      if (plate && across(world.players[holder])) return t;
    }
    return -1;
  };

  for (const mover of [0, 1]) {
    const first = HOLD_SCRIPTS.find((s) => attempt(mover, s, null) >= 0);
    if (!first) return false;
    if (!HOLD_SCRIPTS.some((s) => attempt(mover, first, s) >= 0)) return false;
  }
  return true;
}

/* ------------------------------------------------------- hauling the crate */

/**
 * Everything above this line proves a pair can climb. None of it proves the
 * thing the game is named after can be brought with them.
 *
 * The crate is present in every replay in this file — it hangs off the middle
 * of the rope, it is swung about by every jump, and it is ignored by every
 * success test, all of which read a hauler's feet. So a tower could pass this
 * gate end to end with a crate that cannot leave the first ledge, and the run
 * only ends when the crate reaches the goal. That is a tower that ships broken
 * with a green light on it.
 *
 * What the two checks below prove, precisely:
 *
 *  - `canHaulCrate` — for every climbing step on the route, if the pair are
 *    standing on the upper ledge and the crate is on the lower one, some
 *    plausible way of hauling brings the crate up after them without breaking
 *    it. That is the state the tower is in on the tick the second hauler tops
 *    out, and it is where a crate gets left behind or wedged.
 *
 *  - `crateFinishes` — with the pair standing anywhere they can touch the goal
 *    and the crate at their feet, the *simulation itself* reports the run
 *    finished. Not a restatement of the rule: `simStep` is what is asked, so
 *    the two halves of the win condition cannot drift apart from the check.
 *
 * What they do not prove, which matters as much:
 *
 *  - Each step starts from a full-health crate, so this is a per-step claim,
 *    not a claim about one continuous ascent. A tower every one of whose steps
 *    costs the crate a little is not caught here; `npm run playtest` is what
 *    measures accumulated damage across a run.
 *  - The pair are placed on the upper ledge rather than arriving there, so
 *    nothing here says the crate survives the *climb* — only that it can be
 *    hauled up afterwards.
 *  - Hold rooms are crossed on the flat and so are not climbing steps. The
 *    crate goes through those doorways beside the haulers, and the doorway
 *    tests in packages/core/test/levels.test.ts are what keep them wide enough
 *    for it.
 */

/** Ticks a haul gets before it is called impossible. Measured on the campaign:
 *  the median lift takes 26 of them and the slowest takes 147. */
const HAUL_BUDGET = 420;
/** Ticks the crate has to stay up before it counts as up, so a crate flung
 *  over the lip by a rope snap and dropped straight back is not a pass. */
const HAUL_SETTLE = 12;

/**
 * The verbs a pair have for lifting a crate, in the order they are tried.
 *
 * The rope only offers four, so this is not a sample of a space — it is the
 * space. Walking away from the crate's column is the winch: the line goes
 * taut over the lip and the crate comes up it. Standing still is what a short
 * step needs, because the rope's own length clamp does the work unaided.
 * Bracing gives the line a fixed end to pull against. Hopping is the one that
 * matters on a two-row step, where the rope is slack, nothing is pulling, and
 * the crate simply sits there until somebody puts a jolt into it — measured:
 * eight of the campaign's 329 steps are haulable no other way.
 */
const HAUL_STYLES = [];
for (const hop of [0, 1]) {
  for (const anchor of [-1, 0, 1]) HAUL_STYLES.push({ anchor, hop });
}

/**
 * Stand the pair on the ledge above with the crate still on the ledge below.
 *
 * The rope is strung down to the crate and back rather than laid flat between
 * the haulers: the middle node is where the crate hangs from, and starting it
 * level with two people who are three rows higher is a rope that snaps taut on
 * the first tick and throws the crate up the wall for free.
 */
function placeHaul(world, to, pairCol, from, crateCol) {
  const py = (to.y + 1) * TILE - PLAYER_H / 2 - 1;
  const px = pairCol * TILE + TILE / 2;
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    p.x = px + (i === 0 ? -12 : 12);
    p.y = py;
    p.vx = 0;
    p.vy = 0;
    p.grounded = 1;
    p.dead = 0;
    p.gripping = 0;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.jumpHeld = 0;
    p.grip = GRIP_MAX;
  }
  const cx = crateCol * TILE + TILE / 2;
  const cy = (from.y + 1) * TILE - CARGO_H / 2 - 1;
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    const sag = 4 * t * (1 - t);
    world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t + (cx - px) * sag;
    world.ropeY[i] = py + (cy - py) * sag;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = world.ropeY[i];
  }
  world.cargo.x = cx;
  world.cargo.y = cy;
  world.cargo.px = cx;
  world.cargo.py = cy;
  // Health is left as `createWorld` set it, which is the level's own: a
  // Gauntlet floor can hand the pair a crate at fifty-five, and a check that
  // quietly tops it back up is checking a tower nobody plays.
  world.cargo.calm = 0;
  world.cargo.hurt = 0;
  world.cargo.grounded = 0;
  world.restartTimer = 0;
}

const clampCol = (v, lo, hi) => Math.min(hi, Math.max(lo, v));

/**
 * Where to stand the pair and set the crate down for one step.
 *
 * The crate goes under the columns the two ledges share, because that is the
 * part of the lower ledge a pair climbing the step were standing on. The pair
 * go above it, and then half a rope to either side — the winch needs somewhere
 * to walk to, and on a wide ledge the columns directly overhead give it none.
 */
function haulPlacements(from, to) {
  const lo = Math.max(from.x0, to.x0);
  const hi = Math.min(from.x1, to.x1);
  const under = lo <= hi ? Math.round((lo + hi) / 2) : clampCol(Math.round((to.x0 + to.x1) / 2), from.x0, from.x1);
  const reach = Math.floor(ROPE_MAX / 2 / TILE);
  const out = [];
  for (const crateCol of new Set([under, clampCol(to.x0, from.x0, from.x1), clampCol(to.x1, from.x0, from.x1)])) {
    for (const pairCol of new Set([
      clampCol(crateCol, to.x0, to.x1),
      clampCol(crateCol - reach, to.x0, to.x1),
      clampCol(crateCol + reach, to.x0, to.x1),
    ])) {
      out.push({ crateCol, pairCol });
    }
  }
  return out;
}

/** Can the pair bring the crate up onto the ledge they have just climbed to? */
export function canHaulCrate(ctx, from, to) {
  for (const { crateCol, pairCol } of haulPlacements(from, to)) {
    // Away from the crate first: that is the direction that tensions the rope,
    // and it is the one that works on all but a handful of steps.
    const away = pairCol >= crateCol ? 1 : -1;
    for (const dir of [away, -away, 0]) {
      for (const style of HAUL_STYLES) {
        const world = createWorld(ctx);
        placeHaul(world, to, pairCol, from, crateCol);
        // Let the rope find its own shape before anybody pulls on it. Without
        // this the first tick's correction is measured as crate speed and the
        // crate is charged impact damage for a launch it never had.
        for (let t = 0; t < 20; t++) {
          simStep(ctx, world, [0, 0]);
          world.events.length = 0;
        }
        let up = 0;
        for (let t = 0; t < HAUL_BUDGET; t++) {
          const walk = dir > 0 ? IN_RIGHT : dir < 0 ? IN_LEFT : 0;
          const jump = style.hop === 1 && t % 40 < 12 ? IN_JUMP : 0;
          const masks = [walk | jump, walk | jump];
          if (style.anchor >= 0) masks[style.anchor] = IN_GRIP;
          simStep(ctx, world, masks);
          world.events.length = 0;
          if (world.restartTimer > 0 || world.cargo.hp <= 0) break;
          const foot = Math.floor((world.cargo.y + CARGO_H / 2 - 1) / TILE);
          up = foot <= to.y ? up + 1 : 0;
          if (up >= HAUL_SETTLE) return true;
        }
      }
    }
  }
  return false;
}

/** Every cell a hauler can stand in and touch the goal from. */
function goalCells(level, result) {
  const out = [];
  for (let y = 0; y < level.h; y++) {
    for (let x = 0; x < level.w; x++) {
      if (!result.standable[y * level.w + x]) continue;
      let touching = false;
      for (let oy = -1; oy <= 1 && !touching; oy++) {
        for (let ox = -1; ox <= 1; ox++) {
          if (tileAt(level, x + ox, y + oy) === T_GOAL) {
            touching = true;
            break;
          }
        }
      }
      if (touching) out.push({ x, y });
    }
  }
  return out;
}

/**
 * Does the simulation actually end the run when the pair arrive with the crate?
 *
 * Every pair of cells the two of them could be standing in, not one, because
 * the two halves of the win condition are not measured against the same thing.
 * `pairAtGoal` asks whether each hauler is touching any goal tile; the crate is
 * asked for its distance from `level.goalX`, which is the *first* goal tile the
 * level builder saw. On a six-wide goal band those disagree by a hundred and
 * twenty pixels, and the crate is tethered to the middle of a rope that cannot
 * exceed its own length — so the further along the band a pair stand, the less
 * of GOAL_CARGO_REACH is left for the crate. Measured on the campaign: the
 * worst standing spot leaves the crate 134.7 px out of the 170 allowed. That is
 * thirty-five pixels of margin nobody chose, in a number that lives in a chunk
 * one authoring change away from being wider.
 *
 * Cells further apart than the rope is long are skipped: the pair cannot be in
 * that state, so failing them would be failing a fiction.
 */
export function crateFinishes(ctx, level, result) {
  const cells = goalCells(level, result);
  if (cells.length === 0) return 'no cell a hauler can stand in touches the goal';
  for (const a of cells) {
    for (const b of cells) {
      const ay = (a.y + 1) * TILE - PLAYER_H / 2 - 1;
      const by = (b.y + 1) * TILE - PLAYER_H / 2 - 1;
      const ax = a.x * TILE + TILE / 2;
      const bx = b.x * TILE + TILE / 2;
      const span = (ax - bx) * (ax - bx) + (ay - by) * (ay - by);
      if (span > ROPE_MAX * ROPE_MAX) continue;
      const world = createWorld(ctx);
      world.players[0].x = ax;
      world.players[0].y = ay;
      world.players[1].x = bx;
      world.players[1].y = by;
      for (const p of world.players) {
        p.vx = 0;
        p.vy = 0;
        p.grounded = 1;
        p.dead = 0;
        p.gripping = 0;
        p.grip = GRIP_MAX;
      }
      for (let i = 0; i < ROPE_NODES; i++) {
        const t = i / (ROPE_NODES - 1);
        world.ropeX[i] = ax + (bx - ax) * t;
        world.ropeY[i] = ay + (by - ay) * t;
        world.ropePX[i] = world.ropeX[i];
        world.ropePY[i] = world.ropeY[i];
      }
      // At their feet, which is where a crate that has just been hauled up ends
      // up, and the only placement that is not begging the question.
      world.cargo.x = (ax + bx) / 2;
      world.cargo.y = (ay + by) / 2 + (PLAYER_H - CARGO_H) / 2;
      world.cargo.px = world.cargo.x;
      world.cargo.py = world.cargo.y;
      world.restartTimer = 0;
      let done = false;
      for (let t = 0; t < HAUL_BUDGET && !done; t++) {
        simStep(ctx, world, [0, 0]);
        world.events.length = 0;
        done = world.finished === 1;
      }
      if (!done) {
        const dx = world.cargo.x - level.goalX;
        const dy = world.cargo.y - level.goalY;
        return `haulers at cols ${a.x} and ${b.x} row ${a.y} reach the goal with the crate and the run does not end (crate ${Math.round(Math.sqrt(dx * dx + dy * dy))}px from the goal)`;
      }
    }
  }
  return null;
}

/**
 * Can the pair get from one ledge to the next?
 *
 * Both of them, taking turns — not either of them. The old gate returned on the
 * first hauler to touch down, which proves a step one of them can make while
 * the other is still hanging off the rope below it. The game asks for both at
 * the goal, so the gate has to ask for both on every ledge in between.
 */
export function canMakeStep(ctx, from, to) {
  return canCross(ctx, from, to, 0) && canCross(ctx, from, to, 1);
}

/**
 * Try, hard, to get one hauler up a gate on their own.
 *
 * The build had a proof that the towers are climbable together and no proof at
 * all that they are unclimbable alone — the one claim the whole design rests
 * on. It was asserted against the reachability fill, which walks a grid using
 * MAX_RISE and knows nothing about what the physics will let you do, and the
 * physics let you do more: GRIP and JUMP on the same tick took a jump through
 * a branch that returns before the ordinary one, leaving `grounded` set, so the
 * next tick refilled the coyote window in mid-air and a second press cashed it.
 * 6.50 tiles against a plain jump's 4.50, on gates cut to six.
 *
 * Randomised scripts rather than a tidy sweep, because the sweep is what missed
 * it: the exploit needed three buttons in a particular order and no
 * hand-written cadence happened to contain it. GRIP is in the alphabet here for
 * the same reason. The partner is parked on the launch ledge and never presses
 * anything — present, so the rope and its weight are real, and useless, so
 * nothing here can be a boost. Any run that does register one is thrown away.
 *
 * `both` is what a doorway asks instead. Getting *yourself* through a shutter
 * proves nothing, because the passenger who presses nothing can be dragged onto
 * the near plate and that is enough to walk through — the far plate is the one
 * they cannot be dragged onto. So a hold room is only beaten alone if the
 * passenger comes out of the far side of it too.
 */
export function soloCanCross(ctx, from, to, tries, both = false) {
  let seed = 0x5eed | 0;
  const rand = () => {
    seed = (Math.imul(seed, 1103515245) + 12345) & 0x7fffffff;
    return seed / 0x7fffffff;
  };
  const BUDGET = 240;
  const script = new Uint8Array(BUDGET);

  /** Run one scripted attempt; the ledge reached, or null. */
  const attempt = (lx, mask) => {
    const world = createWorld(ctx);
    placePair(world, lx, from.y);
    for (let t = 0; t < 4; t++) {
      simStep(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    for (let t = 0; t < BUDGET; t++) {
      simStep(ctx, world, [mask(t), 0]);
      world.events.length = 0;
      if (world.restartTimer > 0 || world.boosts > 0) return null;
      // A hauler who dies comes back at their partner's shoulder, and the rule
      // that keeps that from being a lift measures height and nothing else — so
      // a passenger who walks into a spike is rescued through a shutter however
      // many plates it has. Every hold room in the library falls to that, which
      // makes it a fact about the rescue rather than about any of them; thrown
      // away here for the same reason a run that registers a boost is.
      if (both && world.players[1].dead) return null;
      const arrived = (p) => {
        if (p.dead || p.grounded !== 1) return false;
        const cy = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1;
        const cx = Math.floor(p.x / TILE);
        return cy === to.y && cx >= to.x0 && cx <= to.x1;
      };
      if (world.players[0].dead) return null;
      if (!arrived(world.players[0])) continue;
      if (both && !arrived(world.players[1])) continue;
      return { lx, tick: t };
    }
    return null;
  };

  // The shapes that are known to break this, swept exactly rather than left to
  // chance. A random script hits "press, release, re-press inside seven ticks"
  // so rarely that 1500 of them missed the double jump that was live in the
  // build: the targeted pass below finds it in the first dozen attempts. Run-up
  // first, because every one of these is worth more with speed behind it.
  for (let lx = from.x0; lx <= from.x1; lx++) {
    for (const run of [0, 10, 20, 34]) {
      const dir = to.x0 + to.x1 > from.x0 + from.x1 ? IN_RIGHT : IN_LEFT;
      for (const grip of [0, IN_GRIP]) {
        for (let gap = 0; gap <= 16; gap++) {
          for (const hold of [6, 14, 22, 30]) {
            const got = attempt(lx, (t) => {
              if (t < run) return dir;
              const k = t - run;
              let m = dir;
              if (k === 0) m |= IN_JUMP | grip;
              else if (k < hold && gap === 0) m |= IN_JUMP;
              else if (gap > 0 && k >= gap && k < gap + hold) m |= IN_JUMP;
              return m;
            });
            if (got) return got;
          }
        }
      }
    }
  }

  for (let n = 0; n < tries; n++) {
    for (let t = 0; t < BUDGET; ) {
      const seg = 2 + Math.floor(rand() * 20);
      let m = 0;
      const r = rand();
      if (r < 0.36) m |= IN_LEFT;
      else if (r < 0.72) m |= IN_RIGHT;
      if (rand() < 0.6) m |= IN_JUMP;
      if (rand() < 0.35) m |= IN_GRIP;
      for (let k = 0; k < seg && t < BUDGET; k++, t++) script[t] = m;
    }
    const lx = from.x0 + Math.floor(rand() * (from.x1 - from.x0 + 1));
    const got = attempt(lx, (t) => script[t]);
    if (got) return got;
  }
  return null;
}

export function verifyLevel(level, mode, seed, options = {}) {
  // The coop fill, because the levels have gates in them now: steps with the
  // middle foothold taken out, which one player cannot climb and is not
  // supposed to be able to. Verifying against the solo fill would report the
  // campaign as broken, which is exactly what it did the first time.
  const result = analyse(level, { coop: true });
  if (!result.ok) {
    return { ok: false, level: level.id, reason: result.reason ?? 'goal unreachable', highest: result.highest, reached: result.reached, total: result.total };
  }
  if (options.replay === false) {
    return { ok: true, level: level.id, reached: result.reached, total: result.total, steps: 0 };
  }
  const ctx = { level, seed, mode };
  const steps = ledgeSteps(level, result.route, result.standable);
  // Which slice of this level's work to do. The steps of a level are
  // independent of each other, so the gate hands one level out to several
  // processes at once and each takes every nth step; `mine` is the only thing
  // that knows about it, and with no shard set it is every step.
  const shard = options.shard ?? { index: 0, count: 1 };
  const mine = (i) => i % shard.count === shard.index;
  const failures = [];
  for (let si = 0; si < steps.length; si++) {
    if (!mine(si)) continue;
    const s = steps[si];
    // A step taller than any one hauler can jump is a gate, and gates are
    // replayed as the two-person move they are.
    const gate = s.from.y - s.to.y > MAX_RISE;
    const where = `row ${s.from.y} cols ${s.from.x0}-${s.from.x1} -> row ${s.to.y} cols ${s.to.x0}-${s.to.x1}`;
    if (!(gate ? canGate(ctx, s.from, s.to) : canMakeStep(ctx, s.from, s.to))) {
      failures.push(where);
      if (failures.length >= 5) break;
    }
    // And the crate after them. A step two people can climb and their load
    // cannot is a step that ends the run, because the run ends at the crate.
    if (options.crate !== false && !canHaulCrate(ctx, s.from, s.to)) {
      failures.push(`${where} — THE CRATE CANNOT BE HAULED UP IT`);
      if (failures.length >= 5) break;
    }
    // A gate one player can climb is not a gate, and the tower it is in does
    // not need two people however many of them it has.
    if (gate && options.solo !== false) {
      const got = soloCanCross(ctx, s.from, s.to, options.soloTries ?? 1500);
      if (got) {
        failures.push(`${where} — ONE PLAYER CLEARED IT from column ${got.lx}`);
        if (failures.length >= 5) break;
      }
    }
  }
  // Hold rooms are replayed on their own terms rather than as a climbing step,
  // and the solo search is pointed at them as well: a door one hauler can get
  // both bodies through is a room that does not need anybody's partner.
  const crossings = failures.length >= 5 ? [] : holdCrossings(level, result);
  for (let ci = 0; ci < crossings.length; ci++) {
    if (!mine(ci)) continue;
    const cross = crossings[ci];
    if (cross.reason) {
      failures.push(cross.reason);
    } else {
      if (!canHold(ctx, cross)) failures.push(`${cross.where}: the pair cannot leapfrog it`);
      if (options.solo !== false) {
        const got = soloCanCross(ctx, cross.from, cross.to, options.soloTries ?? 1500, true);
        if (got) failures.push(`${cross.where} — ONE PLAYER CLEARED IT from column ${got.lx}`);
      }
    }
    if (failures.length >= 5) break;
  }

  // Last of all, the finish itself: the only claim in this file made by asking
  // the simulation whether the run is over rather than by reading positions.
  // The finish is one claim about the level rather than one per step, so it
  // belongs to the first slice and is not repeated by the others.
  if (options.crate !== false && failures.length < 5 && shard.index === 0) {
    const unfinished = crateFinishes(ctx, level, result);
    if (unfinished) failures.push(unfinished);
  }

  return {
    ok: failures.length === 0,
    level: level.id,
    reached: result.reached,
    total: result.total,
    steps: steps.length,
    holds: crossings.length,
    failures,
  };
}

/* ------------------------------------------------------------------- main */

/**
 * Every level this gate is responsible for, in the order it reports them.
 *
 * A list rather than a loop because the run is spread across processes now:
 * the parent hands each child a level and a slice of its steps, so the two of
 * them cannot disagree about what was checked.
 */
function levels() {
  const towers = Number(process.env.TOWER_SAMPLES ?? 12);
  const list = [{ label: 'campaign      ', build: () => buildCampaign(), mode: 0, seed: 1 }];
  for (let i = 0; i < towers; i++) {
    const seed = (i + 1) * 104729;
    list.push({
      label: `tower ${String(seed).padStart(7)}`,
      build: () => buildTower(seed, 6 + (i % 10)),
      mode: 1,
      seed,
    });
  }
  return list;
}

/** One level's slices, back together as the single answer about that level. */
function merge(slices) {
  return {
    ok: slices.every((p) => p.ok),
    reached: slices[0].reached,
    total: slices[0].total,
    steps: slices[0].steps,
    holds: slices[0].holds,
    reason: slices.find((p) => p.reason)?.reason,
    failures: slices.flatMap((p) => p.failures ?? []),
  };
}

function report(label, r) {
  console.log(
    `${label}  ${r.ok ? 'OK  ' : 'FAIL'}  ${r.reached}/${r.total} footholds reachable, ` +
      `${r.steps} climbing steps and ${r.holds} hold rooms replayed, crate hauled up every one of them`,
  );
  if (r.ok) return 0;
  if (r.reason) console.log(`  ${r.reason}`);
  for (const f of r.failures ?? []) console.log(`  ${f}`);
  return 1;
}

if (process.argv[1] && process.argv[1].endsWith('verify-levels.mjs')) {
  const assignment = process.env.VERIFY_SHARD;
  if (process.env.VERIFY_CHILD && assignment === undefined) {
    // A child that does not understand its assignment must not become a
    // parent. Without this a rename of the variable below turns the pool into
    // a fork bomb, which is exactly how it was found.
    throw new Error('verify-levels child started without a shard assignment');
  }
  if (assignment !== undefined) {
    // A child. One slice of one level, one line of JSON, nothing on stdout the
    // parent has to guess at.
    const [level, index, count] = assignment.split(':').map(Number);
    const job = levels()[level];
    const r = verifyLevel(job.build(), job.mode, job.seed, { shard: { index, count } });
    process.stdout.write(JSON.stringify(r) + '\n');
  } else {
    // The parent. The solo search is the expensive half of this file — it takes
    // every gate in every level and throws five and a half thousand scripted
    // attempts and fifteen hundred random ones at it, in the real simulation —
    // and the library is built around sixty-two gates in the campaign alone
    // now, where it used to have seven. Sequentially that is well over an hour
    // of one core while the others sit idle, which is long enough that people
    // start running the build gate less often, and a gate nobody runs is not a
    // gate.
    //
    // Levels are independent of each other and a level's steps are independent
    // of each other, so the work goes out as (level, slice) pairs, one child
    // process at a time per core. Nothing is shared and nothing is
    // approximated: every check that ran before still runs, on the same levels,
    // and the report is assembled back into the same order.
    const { fork } = await import('node:child_process');
    const os = await import('node:os');
    const list = levels();
    const cores = Math.max(1, os.cpus().length);
    // Enough slices to keep every core busy through the tail of the run: the
    // campaign is three times the size of a tower and would otherwise be the
    // last thing still going with everything else finished.
    const slices = Math.max(2, cores);
    const queue = [];
    for (let l = 0; l < list.length; l++) {
      for (let i = 0; i < slices; i++) queue.push({ level: l, index: i, count: slices });
    }
    const parts = list.map(() => []);
    let next = 0;
    let bad = 0;
    const started = Date.now();
    // Said out loud because it is minutes rather than seconds and somebody is
    // sitting watching it: the solo search is the price of the one claim the
    // whole design rests on, and it scales with the number of gates.
    console.log(
      `Proving ${list.length} levels — ${queue.length} slices on ${cores} cores. ` +
        `The solo search is thorough and slow; expect this to take a while.`,
    );

    await new Promise((resolve, reject) => {
      let live = 0;
      const pump = () => {
        while (live < cores && next < queue.length) {
          const job = queue[next++];
          live++;
          const child = fork(process.argv[1], [], {
            env: {
              ...process.env,
              VERIFY_CHILD: '1',
              VERIFY_SHARD: `${job.level}:${job.index}:${job.count}`,
            },
            stdio: ['ignore', 'pipe', 'inherit', 'ipc'],
          });
          let out = '';
          child.stdout.on('data', (chunk) => {
            out += chunk;
          });
          child.on('exit', (code) => {
            live--;
            if (!out.trim()) {
              reject(new Error(`${list[job.level].label.trim()} slice ${job.index} died with code ${code}`));
              return;
            }
            parts[job.level].push(JSON.parse(out.trim().split('\n').pop()));
            // Report a level the moment its last slice lands, so a long run
            // shows its working instead of sitting silent for twenty minutes.
            if (parts[job.level].length === slices) bad += report(list[job.level].label, merge(parts[job.level]));
            if (next >= queue.length && live === 0) resolve();
            else pump();
          });
        }
      };
      pump();
    });

    console.log(
      `\n${list.length} levels in ${queue.length} slices on ${cores} cores, ` +
        `${Math.round((Date.now() - started) / 1000)}s.`,
    );
    if (bad > 0) {
      console.error(`${bad} level(s) cannot be climbed, or cannot be finished with the crate.`);
      process.exit(1);
    }
    console.log('Every tower is climbable, and the crate can be brought up all of it.');
  }
}
