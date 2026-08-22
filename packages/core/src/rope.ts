import {
  DT,
  GRIP_REGEN_DELAY,
  REEL_DRAIN,
  REEL_FORCE,
  REEL_CLIMB_SPEED,
  REEL_MANTLE_SPEED,
  REEL_MAX_SPEED,
  ROPE_CORRECTION,
  ROPE_GRAVITY,
  ROPE_ITERATIONS,
  ROPE_MAX,
  ROPE_NODES,
  ROPE_NODE_DRAG,
  ROPE_REST,
  ROPE_RESTITUTION,
  ROPE_SPRING,
  GROUND_HAUL_RESISTANCE,
  PLAYER_H,
  GRIP_REACH,
  PLAYER_HALF_W,
  ROPE_YANK_SPEED,
  IN_REEL,
  BETRAYAL_DEBOUNCE,

  TILE,} from './constants.js';
import type { Level } from './level.js';
import { collider, moveCollider, rectHitsTiles, pointSolid } from './physics.js';
import { EV_REEL, EV_ROPE_YANK, type World } from './types.js';
import { WORST_BETRAYAL, pushEvent, recordWorst } from './events.js';

const SEG_MAX = ROPE_MAX / (ROPE_NODES - 1);
const ROPE_G_STEP = ROPE_GRAVITY * DT * DT;

/** Where the rope is tied to a player — chest height, not the feet. */
export function anchorX(world: World, i: number): number {
  return world.players[i].x;
}

export function anchorY(world: World, i: number): number {
  return world.players[i].y - 5;
}

/**
 * How much of a rope correction each player absorbs. A player who is gripping a
 * surface, dead, or stunned is immovable, so their partner takes the whole
 * correction — which is exactly how you turn your friend into a wrecking ball.
 */
function mobility(world: World, i: number): number {
  const p = world.players[i];
  // A corpse is dead weight, not an anchor: it gets dragged around at full
  // strength. Only a gripping player is immovable.
  if (p.gripping && !p.dead) return 0;
  return 1;
}

/**
 * How readily the rope can haul this player, given which way it is pulling.
 *
 * Feet on solid ground resist a sideways or downward haul — that is what makes
 * one of you an anchor without gripping. Nothing resists being lifted straight
 * up, which is the whole reason a rope over a ledge can winch your partner out
 * of a pit while you simply walk away from it.
 */
/**
 * How much of a rope correction this hauler absorbs, for splitting the
 * overshoot between the two ends. A pull that is mostly upward moves them
 * freely; a sideways or downward one meets their feet.
 *
 * This is only the *share*. How that share is then applied is `haulTraction`,
 * and the two must be separate, because a hauler being lifted is still standing
 * on the ground in the sideways direction.
 */
function haulMobility(world: World, i: number, dirY: number): number {
  const p = world.players[i];
  if (p.gripping && !p.dead) return 0;
  if (p.dead) return 1;
  if (p.grounded !== 1) return 1;
  const lifting = dirY < 0 ? -dirY : 0;
  return GROUND_HAUL_RESISTANCE + (1 - GROUND_HAUL_RESISTANCE) * lifting;
}

/**
 * Traction, per axis, for a hauler the rope is dragging. This is the winch.
 *
 * The length clamp removes excess rope and does not care how it is removed, so
 * offered a choice between lifting a grounded hauler and skidding them
 * sideways it always takes the cheaper one — and the floor is cheaper.
 * Measured, that meant a partner walking away from a beam lifted their mate
 * exactly 0.0 tiles: they were skidded along the ground instead, usually until
 * they were under an overhang where they could no longer be lifted at all.
 *
 * Applying the correction through traction is what fixes it. Boots on solid
 * ground resist a skid; nothing resists being picked up. The sideways option
 * stops being cheap, so the clamp takes the vertical one, and a hauler dangling
 * off a beam finally goes *up* when their partner walks away from it.
 *
 * The correction is deliberately not conserved within a tick: a resisted hauler
 * leaves the rope over-long and the clamp fires again next tick. That is the
 * difference between a winch and a snap.
 */
function haulTraction(world: World, i: number, dirY: number, out: { x: number; y: number }): void {
  const p = world.players[i];
  if (p.dead || p.grounded !== 1 || p.gripping) {
    out.x = 1;
    out.y = 1;
    return;
  }
  out.x = GROUND_HAUL_RESISTANCE;
  // Up is free; down is resisted, because you cannot be pulled through a floor.
  out.y = dirY < 0 ? 1 : GROUND_HAUL_RESISTANCE;
}

/**
 * Forces the rope applies to the players before they move: a soft spring once
 * the rope passes its rest length, plus the REEL input which drags you toward
 * your partner along the rope.
 */
/**
 * Rope forces: the spring that reminds you your partner exists, and the reel.
 *
 * The spring pulls each hauler toward the first thing the rope bends around at
 * *their* end, not toward their partner. With a clear run between them those
 * are the same direction; with a beam in between they are not, and that
 * difference is the entire pulley.
 *
 * It used to pull along the straight line between the two of them, which meant
 * a rope hooked over a beam still yanked you sideways through the wall the beam
 * was part of. Combined with the spring being exempt from traction, that was
 * what made the winch measure 0.0 tiles of lift: a hauler standing under a beam
 * was skidded along the floor toward their partner by a force that did not know
 * the beam existed.
 */
export function applyRopeForces(world: World, level: Level, inputs: number[]): void {
  const a = world.players[0];
  const b = world.players[1];
  let dx = b.x - a.x;
  let dy = b.y - a.y;
  let d = Math.sqrt(dx * dx + dy * dy);
  if (d < 0.0001) {
    dx = 0;
    dy = 1;
    d = 1;
  }
  const nx = dx / d;
  const ny = dy / d;

  if (d > ROPE_REST) {
    const excess = d - ROPE_REST;
    const accel = ROPE_SPRING * excess;
    const ma = mobility(world, 0);
    const mb = mobility(world, 1);
    const total = ma + mb;
    if (total > 0) {
      // A pinned partner means the whole spring lands on the free player.
      const wa = ma === 0 ? 0 : mb === 0 ? 1 : 0.5;
      const wb = mb === 0 ? 0 : ma === 0 ? 1 : 0.5;

      // Along the straight line between them, deliberately, even though the
      // rope may be draped over something. Following the taut path here is more
      // faithful and makes the game worse: with geometry between the pair — and
      // in this tower there almost always is — each is pulled at a corner
      // rather than at their partner, the two never close up, and the rope
      // stops being a tether at all. Measured, it stalled a bot pair
      // permanently at eight tiles. The pulley belongs in the length clamp,
      // which is a hard constraint; this is a soft reminder that your friend
      // exists, and it should read as one.
      a.vx += nx * accel * wa * DT;
      a.vy += ny * accel * wa * DT;
      b.vx -= nx * accel * wb * DT;
      b.vy -= ny * accel * wb * DT;
    }
  }

  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    if (p.dead || p.gripping || p.stunned > 0) continue;
    if ((inputs[i] & IN_REEL) === 0) continue;
    // Hauling on a slack rope does nothing — there is nothing to pull against.
    if (d < ROPE_REST * 0.55) continue;
    if (p.grip <= 0) continue;
    const sx = i === 0 ? nx : -nx;
    const sy = i === 0 ? ny : -ny;
    const along = p.vx * sx + p.vy * sy;
    if (along < REEL_MAX_SPEED) {
      p.vx += sx * REEL_FORCE * DT;
      p.vy += sy * REEL_FORCE * DT;
    }

    // Walking your feet up the wall while you haul on the rope.
    //
    // Reeling alone hauls you along the rope toward your partner, which brings
    // you to just under the lip they are standing on and leaves you there —
    // measured, a hauler reeling out of a six-tile pit climbed 3.6 tiles and
    // stopped, because there is no verb that gets you over an edge. That single
    // missing move is why a pit could never be a co-operative puzzle.
    //
    // With a wall against your shoulder and the rope pulling up, you climb it.
    // The wall is required: this must never read as flying.
    // Gated on where the partner is, not on the reel vector's slope. Using the
    // slope switched the climb off exactly as it became useful: as you rise to
    // your partner's level the pull goes horizontal, so a hauler climbing out
    // of a pit stopped dead the moment their head drew level with the lip.
    const mate = world.players[1 - i];
    if (p.wallDir !== 0 && !mate.dead && mate.y < p.y + PLAYER_H && p.grounded !== 1) {
      if (p.vy > -REEL_CLIMB_SPEED) p.vy = -REEL_CLIMB_SPEED;

      // The mantle. Climbing gets your head level with the lip and leaves you
      // hanging there — measured, a hauler reeling out of a five-tile pit
      // stalled one tile short, every time, which is the most infuriating
      // possible place to stop. Once there is clear air beside your head, you
      // swing your legs over instead of dangling under the edge you just
      // reached.
      const side = p.wallDir;
      const headY = p.y - PLAYER_H / 2;
      const clear = !rectHitsTiles(
        level,
        world,
        p.x + side * PLAYER_HALF_W,
        headY - 2,
        p.x + side * (PLAYER_HALF_W + GRIP_REACH + 6),
        headY + 8,
      );
      if (clear) p.vx = side * REEL_MANTLE_SPEED;
    }
    p.grip = Math.max(0, p.grip - REEL_DRAIN * DT);
    p.gripCooldown = GRIP_REGEN_DELAY;
    // Every ninth tick, carrying how fast the rope is actually running: a
    // rhythm rather than a one-shot, because hauling is a continuous verb, and
    // with the speed in the event the presentation can tell a haul that is
    // barely moving from one that is flying.
    if (world.tick % 9 === 0) pushEvent(world, EV_REEL, p.x, p.y, i, along);
  }
}

/** Verlet-integrate the rope, pin it to both players, then relax the segments. */
export function solveRope(world: World, level: Level): void {
  const rx = world.ropeX;
  const ry = world.ropeY;
  const px = world.ropePX;
  const py = world.ropePY;

  for (let i = 0; i < ROPE_NODES; i++) {
    const vx = (rx[i] - px[i]) * ROPE_NODE_DRAG;
    const vy = (ry[i] - py[i]) * ROPE_NODE_DRAG;
    px[i] = rx[i];
    py[i] = ry[i];
    let nx = rx[i] + vx;
    let ny = ry[i] + vy + ROPE_G_STEP;
    // Rope never enters geometry; blocked nodes simply stay put, which makes
    // the rope drape over ledges and catch on corners.
    if (pointSolid(level, world, nx, ny)) {
      if (!pointSolid(level, world, nx, ry[i])) {
        ny = ry[i];
      } else if (!pointSolid(level, world, rx[i], ny)) {
        nx = rx[i];
      } else {
        nx = rx[i];
        ny = ry[i];
      }
    }
    rx[i] = nx;
    ry[i] = ny;
  }

  const ax = anchorX(world, 0);
  const ay = anchorY(world, 0);
  const bx = anchorX(world, 1);
  const by = anchorY(world, 1);

  tightenRope(world);
}

/**
 * Re-apply the segment length constraint, pinning both ends to the haulers.
 *
 * Split out of `solveRope` because it has to run again after the crate has
 * moved. The crate's tether hauls the rope's middle node up to seventy per cent
 * of the way toward itself every tick, and it does that *after* the solver has
 * run — so with a crate that cannot move, the middle node walks toward it and
 * the rope stretches without limit. Measured: a 232-pixel rope reached 1727
 * pixels while `tautPathLength` reported a comfortable 165, because that
 * function string-pulls between the two haulers and never sees the sag. The
 * crate was left forty-six tiles below a pair who did not notice.
 */
export function tightenRope(world: World): void {
  const rx = world.ropeX;
  const ry = world.ropeY;
  const ax = anchorX(world, 0);
  const ay = anchorY(world, 0);
  const bx = anchorX(world, 1);
  const by = anchorY(world, 1);

  for (let iter = 0; iter < ROPE_ITERATIONS; iter++) {
    rx[0] = ax;
    ry[0] = ay;
    rx[ROPE_NODES - 1] = bx;
    ry[ROPE_NODES - 1] = by;
    for (let i = 0; i < ROPE_NODES - 1; i++) {
      const dx = rx[i + 1] - rx[i];
      const dy = ry[i + 1] - ry[i];
      const d = Math.sqrt(dx * dx + dy * dy);
      if (d <= SEG_MAX || d < 0.0001) continue;
      const scale = ((d - SEG_MAX) / d) * 0.5;
      const ox = dx * scale;
      const oy = dy * scale;
      if (i !== 0) {
        rx[i] += ox;
        ry[i] += oy;
      }
      if (i + 1 !== ROPE_NODES - 1) {
        rx[i + 1] -= ox;
        ry[i + 1] -= oy;
      }
    }
  }
  rx[0] = ax;
  ry[0] = ay;
  rx[ROPE_NODES - 1] = bx;
  ry[ROPE_NODES - 1] = by;
}

/**
 * The hard length limit. Once the players are further apart than the rope can
 * physically stretch, both are pulled back in and the separating part of their
 * relative velocity is cancelled — turning a fall into a pendulum swing, and a
 * sprint into your partner being ripped off a ledge.
 */
const pullA = { x: 0, y: 0 };
const pullB = { x: 0, y: 0 };
const tractionA = { x: 1, y: 1 };
const tractionB = { x: 1, y: 1 };

function haul(world: World, level: Level, index: number, dx: number, dy: number): void {
  if (dx === 0 && dy === 0) return;
  const p = world.players[index];
  // Match the body the player's own update uses, or a corpse — which lies in a
  // squashed box — snags on the floor the moment anyone tries to drag it.
  const halfHeight = p.dead ? (PLAYER_H / 2) * 0.7 : PLAYER_H / 2;
  collider.set(p.x, p.y, PLAYER_HALF_W, halfHeight);
  collider.dropThrough = true;
  moveCollider(level, world, collider, dx, dy);
  p.x = collider.x;
  p.y = collider.y;
  if (collider.hitY === 1) p.grounded = 1;
}

export function clampRopeLength(world: World, level: Level): void {
  const a = world.players[0];
  const b = world.players[1];

  const length = tautPathLength(world, level);
  if (length <= ROPE_MAX || length < 0.0001) return;
  const overshoot = length - ROPE_MAX;

  // Each player is pulled along their own end of the rope, toward the first
  // thing it bends around — not toward their partner. With a clear run between
  // them those are the same direction; with a beam in between they are not, and
  // that difference is the pulley.
  const anchorAX = anchorX(world, 0);
  const anchorAY = anchorY(world, 0);
  const anchorBX = anchorX(world, 1);
  const anchorBY = anchorY(world, 1);
  ropePullTarget(0, anchorAX, anchorAY, pullA);
  ropePullTarget(1, anchorBX, anchorBY, pullB);
  let ax = pullA.x - anchorAX;
  let ay = pullA.y - anchorAY;
  let bx = pullB.x - anchorBX;
  let by = pullB.y - anchorBY;
  const da = Math.sqrt(ax * ax + ay * ay);
  const db = Math.sqrt(bx * bx + by * by);
  if (da < 0.0001 || db < 0.0001) return;
  ax /= da;
  ay /= da;
  bx /= db;
  by /= db;

  const ma = haulMobility(world, 0, ay);
  const mb = haulMobility(world, 1, by);
  const total = ma + mb;
  if (total <= 0) return;
  const wa = ma / total;
  const wb = mb / total;

  // Haul through collision rather than teleporting. Sliding a hauled player
  // along a wall is the difference between being winched up out of a pit and
  // being shoved into its side, where every subsequent lift just re-collides.
  haulTraction(world, 0, ay, tractionA);
  haulTraction(world, 1, by, tractionB);
  const amountA = overshoot * wa * ROPE_CORRECTION;
  const amountB = overshoot * wb * ROPE_CORRECTION;
  haul(world, level, 0, ax * amountA * tractionA.x, ay * amountA * tractionA.y);
  haul(world, level, 1, bx * amountB * tractionB.x, by * amountB * tractionB.y);

  // Cancel the part of their motion that is paying out more rope, leaving
  // everything sideways intact so the pair swings instead of stopping dead.
  const paying = -(a.vx * ax + a.vy * ay) - (b.vx * bx + b.vy * by);
  if (paying > 0) {
    const impulse = paying * (1 + ROPE_RESTITUTION);
    a.vx += ax * impulse * wa;
    a.vy += ay * impulse * wa;
    b.vx += bx * impulse * wb;
    b.vy += by * impulse * wb;
    if (paying > ROPE_YANK_SPEED) {
      const mx = (a.x + b.x) * 0.5;
      const my = (a.y + b.y) * 0.5;
      pushEvent(world, EV_ROPE_YANK, mx, my, paying, 0);
      // Being ripped off solid ground by your partner is the signature failure
      // of this game, so it is counted and reported on the results screen —
      // once per incident. One shove off a ledge is one betrayal, however many
      // ticks the resulting fall takes.
      if ((a.grounded === 1) !== (b.grounded === 1) && world.yankHold === 0) {
        world.betrayals++;
        world.yankHold = BETRAYAL_DEBOUNCE;
        // Scored by how hard the rope was pulling, in tiles' worth of yank, so
        // the worst one of an evening is the one that actually launched
        // somebody rather than the one that scuffed them off a lip.
        recordWorst(world, WORST_BETRAYAL, paying / TILE);
      }
    }
  }
}

/** Index of the rope node the cargo hangs from. */
export const ROPE_MID = (ROPE_NODES - 1) >> 1;

/* ---------------------------------------------------------------- wrapping */

/**
 * The taut path the rope actually takes between the two players.
 *
 * The rope already drapes over ledges — its nodes cannot enter geometry — but
 * until now the length limit was measured along the straight line between the
 * players, so a rope that visibly hooked over a beam still behaved as though it
 * passed straight through it.
 *
 * Pulling the rope tight around the obstacles it is resting on changes that,
 * and it is where the game's mechanics come from. Hook the rope over a beam and
 * the leash is measured the long way round, so wrapping it costs you slack; and
 * because each player is pulled along their own end of the rope rather than
 * toward their partner, a partner falling down the far side of a beam hauls you
 * *up* it. A pulley, out of geometry the level designer already had.
 */
const MAX_CONTACTS = 8;
// Room for both spans of the path — hauler to load, load to hauler — plus the
// three fixed points those spans hang between.
const pathX = new Float64Array(MAX_CONTACTS * 2 + 3);
const pathY = new Float64Array(MAX_CONTACTS * 2 + 3);
let pathCount = 0;
/** Bends around level geometry only. The load is on the path but is not a bend. */
let bendCount = 0;

/** Sampled line-of-sight test. Deterministic: integer steps, no transcendentals. */
function segmentClear(level: Level, world: World, x0: number, y0: number, x1: number, y1: number): boolean {
  const dx = x1 - x0;
  const dy = y1 - y0;
  const dist = Math.sqrt(dx * dx + dy * dy);
  if (dist < 0.0001) return true;
  const steps = Math.ceil(dist / 6);
  for (let i = 1; i < steps; i++) {
    const t = i / steps;
    if (pointSolid(level, world, x0 + dx * t, y0 + dy * t)) return false;
  }
  return true;
}

/**
 * Pull the rope taut around whatever it is resting on, and return its length.
 *
 * Classic string pulling over the rope's own nodes: walk forward, and from each
 * contact point jump as far along the rope as still has clear line of sight.
 * With nothing in the way this collapses to the straight line between the two
 * players, which is exactly the old behaviour.
 */
export function tautPathLength(world: World, level: Level): number {
  const ax = anchorX(world, 0);
  const ay = anchorY(world, 0);
  const bx = anchorX(world, 1);
  const by = anchorY(world, 1);

  pathCount = 0;
  bendCount = 0;
  pathX[pathCount] = ax;
  pathY[pathCount] = ay;
  pathCount++;

  // Candidate bend points: the rope's own interior nodes, then the far anchor.
  let cursor = -1;
  let guard = 0;
  while (guard++ < MAX_CONTACTS) {
    const fromX = pathX[pathCount - 1];
    const fromY = pathY[pathCount - 1];
    if (segmentClear(level, world, fromX, fromY, bx, by)) break;

    let next = -1;
    for (let i = ROPE_NODES - 2; i > cursor; i--) {
      if (segmentClear(level, world, fromX, fromY, world.ropeX[i], world.ropeY[i])) {
        next = i;
        break;
      }
    }
    // Nothing visible ahead: the rope is buried in geometry, so fall back to
    // the straight line rather than inventing a path.
    if (next < 0 || next <= cursor) break;
    cursor = next;
    if (pathCount >= pathX.length - 2) break;
    pathX[pathCount] = world.ropeX[next];
    pathY[pathCount] = world.ropeY[next];
    pathCount++;
    bendCount++;
  }

  pathX[pathCount] = bx;
  pathY[pathCount] = by;
  pathCount++;

  let length = 0;
  for (let i = 0; i < pathCount - 1; i++) {
    const dx = pathX[i + 1] - pathX[i];
    const dy = pathY[i + 1] - pathY[i];
    length += Math.sqrt(dx * dx + dy * dy);
  }
  return length;
}

/** How many bends the rope currently has. Zero means a clear straight run. */
export function ropeContactCount(): number {
  return bendCount;
}

/**
 * The point a player's end of the rope pulls toward.
 *
 * Contacts that the player has climbed right up to are skipped: a bend you are
 * standing on is a bend the rope has already come off, and using it would leave
 * the pull direction undefined — which previously switched the whole constraint
 * off the moment somebody reached the corner they were being hauled toward.
 */
const MIN_PULL_DISTANCE_SQ = 64;

export function ropePullTarget(index: number, ax: number, ay: number, out: { x: number; y: number }): void {
  if (index === 0) {
    for (let i = 1; i < pathCount; i++) {
      const dx = pathX[i] - ax;
      const dy = pathY[i] - ay;
      if (dx * dx + dy * dy > MIN_PULL_DISTANCE_SQ) {
        out.x = pathX[i];
        out.y = pathY[i];
        return;
      }
    }
    out.x = pathX[pathCount - 1];
    out.y = pathY[pathCount - 1];
    return;
  }
  for (let i = pathCount - 2; i >= 0; i--) {
    const dx = pathX[i] - ax;
    const dy = pathY[i] - ay;
    if (dx * dx + dy * dy > MIN_PULL_DISTANCE_SQ) {
      out.x = pathX[i];
      out.y = pathY[i];
      return;
    }
  }
  out.x = pathX[0];
  out.y = pathY[0];
}
