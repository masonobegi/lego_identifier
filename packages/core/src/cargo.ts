import {
  CARGO_BOUNCE,
  CARGO_DAMPING,
  CARGO_GRAVITY,
  CARGO_H,
  CARGO_HAZARD_BITE,
  CARGO_HAZARD_GRACE,
  CARGO_HP,
  CARGO_IMPACT_MIN,
  CARGO_IMPACT_SCALE,
  CARGO_SHUFFLE,
  CARGO_MAX_FALL,
  CARGO_TETHER,
  CARGO_W,
  DT,
  BRACED_LOAD_SHARE,
  MAX_FALL_HEAVY,
  ROPE_LOAD,
  ROPE_MAX,
  ROPE_REST,
  TICK_RATE,
  TILE,
  WIND_ACCEL,
} from './constants.js';
import { T_WIND, type Level, tileAt } from './level.js';
import { collider, moveCollider, rectHitsTiles } from './physics.js';
import { hazardAt } from './hazards.js';
import { pushEvent } from './events.js';
import { ROPE_MID, anchorX, anchorY } from './rope.js';
import { EV_CARGO_BREAK, EV_CARGO_HIT, EV_CARGO_LAND, type World } from './types.js';

const HW = CARGO_W / 2;
const HH = CARGO_H / 2;
const G_STEP = CARGO_GRAVITY * DT * DT;
const CARGO_MAX_FALL_STEP = CARGO_MAX_FALL * DT;
/** Sideways pixels per tick when the crate is shuffling out from under a lip. */
const SHUFFLE_STEP = CARGO_SHUFFLE * DT;
const WIND_STEP = WIND_ACCEL * DT * DT;

function damage(world: World, amount: number, x: number, y: number): void {
  if (world.cargo.hp <= 0) return;
  world.cargo.hp -= amount;
  world.cargo.calm = 0;
  world.cargo.shake = Math.min(24, world.cargo.shake + amount * 0.6);
  pushEvent(world, EV_CARGO_HIT, x, y, amount, world.cargo.hp);
  if (world.cargo.hp <= 0) {
    world.cargo.hp = 0;
    world.cargoBreaks++;
    pushEvent(world, EV_CARGO_BREAK, x, y, 0, 0);
  }
}

/** Verlet crate: heavy, bouncy, tethered to the middle of the rope, doomed. */
export function updateCargo(level: Level, world: World): void {
  const c = world.cargo;
  if (c.shake > 0) c.shake *= 0.9;

  // Damage to the crate is permanent until you reach a checkpoint.
  //
  // It used to heal itself after a few calm seconds, which quietly took the
  // teeth out of the whole thing: the crate could not accumulate a history, so
  // no individual mistake ever cost you anything you could still feel two
  // minutes later. Now the bar only goes one way, and the only thing that puts
  // it back is a checkpoint — which turns every checkpoint from a save point
  // into a repair stop, and makes the stretch between two of them a resource
  // you are spending rather than a distance you are covering.
  //
  // `calm` is still counted because the crate's own wobble reads off it.
  if (c.hp > 0 && c.hp < CARGO_HP) c.calm++;

  let vx = (c.x - c.px) * CARGO_DAMPING;
  let vy = (c.y - c.py) * CARGO_DAMPING;
  // Terminal velocity, in pixels per tick. Both haulers have had one since the
  // beginning; the crate never did, so anything that put speed into it — a
  // long drop, a rope yank, a positional correction read back as motion —
  // simply kept accumulating.
  if (vy > CARGO_MAX_FALL_STEP) vy = CARGO_MAX_FALL_STEP;
  else if (vy < -CARGO_MAX_FALL_STEP) vy = -CARGO_MAX_FALL_STEP;
  if (vx > CARGO_MAX_FALL_STEP) vx = CARGO_MAX_FALL_STEP;
  else if (vx < -CARGO_MAX_FALL_STEP) vx = -CARGO_MAX_FALL_STEP;
  c.px = c.x;
  c.py = c.y;
  vy += G_STEP;
  if (tileAt(level, Math.floor(c.x / TILE), Math.floor(c.y / TILE)) === T_WIND) vy += WIND_STEP;

  collider.set(c.x, c.y, HW, HH);
  collider.dropThrough = false;
  moveCollider(level, world, collider, vx, vy);
  c.x = collider.x;
  c.y = collider.y;

  const impactX = Math.abs(vx) * TICK_RATE;
  const impactY = Math.abs(vy) * TICK_RATE;

  if (collider.hitY !== 0) {
    if (collider.hitY === 1) {
      if (!c.grounded) pushEvent(world, EV_CARGO_LAND, c.x, c.y + HH, impactY, 0);
      c.grounded = 1;
    }
    if (impactY > CARGO_IMPACT_MIN) damage(world, (impactY - CARGO_IMPACT_MIN) * CARGO_IMPACT_SCALE, c.x, c.y);
    c.py = c.y + vy * CARGO_BOUNCE;
  } else {
    c.grounded = 0;
  }
  if (collider.hitX !== 0) {
    if (impactX > CARGO_IMPACT_MIN) damage(world, (impactX - CARGO_IMPACT_MIN) * CARGO_IMPACT_SCALE, c.x, c.y);
    c.px = c.x + vx * CARGO_BOUNCE;
  }

  // Tether to the middle of the rope. The crate is much heavier than the rope,
  // so most of the correction lands on the rope node, not the crate.
  //
  // The crate's share is swept through the world rather than assigned, which
  // is the whole point of routing it through moveCollider. Writing the
  // corrected position straight onto the crate is a teleport, and a rope yanked
  // hard enough produces a correction bigger than a tile — so the crate
  // arrived on the far side of the floor without ever touching it. Every other
  // body in the simulation moves by sweeping; this one used not to.
  const mx = world.ropeX[ROPE_MID];
  const my = world.ropeY[ROPE_MID];
  const dx = c.x - mx;
  const dy = c.y - my;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > CARGO_TETHER && d > 0.0001) {
    const corr = (d - CARGO_TETHER) / d;
    collider.set(c.x, c.y, HW, HH);
    collider.dropThrough = false;
    moveCollider(level, world, collider, -dx * corr * 0.3, -dy * corr * 0.3);
    // Carry the previous position along with it.
    //
    // This is Verlet: velocity is inferred from `x - px`, so moving the crate
    // and leaving `px` behind does not *reposition* it, it launches it. The
    // tether can shift the crate a hundred pixels in a tick when the rope goes
    // taut, and a hundred pixels a tick reads back as six thousand pixels a
    // second — which is what the next collision is charged for. Measured on a
    // gauntlet tower: the crate hit 5904 px/s, better than five times the
    // haulers' own terminal velocity and enough for 320 points of impact
    // damage against a hundred-point crate. It was not falling. It was being
    // thrown by its own leash.
    c.x = collider.x;
    c.y = collider.y;
    if (collider.hitY === 1) c.grounded = 1;

    // Jammed under a ledge: shuffle out from under it.
    //
    // The tether pulls in a straight line toward the rope, and a straight line
    // up is exactly the wrong direction when the thing above you is the ledge
    // your partners just climbed. The crate wedges against the underside and
    // stays there — measured on the campaign: twenty seconds pinned beneath a
    // twelve-wide platform, fifteen rows below a pair who could not have
    // reached it if they had tried, with the rope stretched to 1.65 times its
    // own length hauling uselessly upward the whole time.
    //
    // A hauler in that situation walks the crate sideways until it clears the
    // lip, so the crate does too. It only ever moves toward whichever side has
    // headroom, so this cannot push it somewhere worse, and if both sides are
    // blocked it stays where it is and the pair have to come back down.
    if (collider.hitY === -1 && dy > 0) {
      const toward = mx > c.x ? 1 : -1;
      for (const side of [toward, -toward]) {
        const at = c.x + side * (HW + 2);
        if (rectHitsTiles(level, world, at - HW, c.y - HH - TILE, at + HW, c.y + HH)) continue;
        collider.set(c.x, c.y, HW, HH);
        collider.dropThrough = false;
        moveCollider(level, world, collider, side * SHUFFLE_STEP, 0);
        c.px += collider.x - c.x;
        c.x = collider.x;
        break;
      }
    }

    world.ropeX[ROPE_MID] += dx * corr * 0.7;
    world.ropeY[ROPE_MID] += dy * corr * 0.7;
  }

  // Spin from horizontal motion, so the crate tumbles convincingly.
  c.rotV = c.rotV * 0.96 + (c.x - c.px) * 0.012;
  if (c.grounded) c.rotV *= 0.82;
  c.rot += c.rotV;

  if (c.hurt > 0) c.hurt--;
  if (
    c.hurt === 0 &&
    hazardAt(level, world, c.x - HW + 4, c.y - HH + 4, c.x + HW - 4, c.y + HH - 4)
  ) {
    damage(world, CARGO_HAZARD_BITE, c.x, c.y);
    c.hurt = CARGO_HAZARD_GRACE;
  }
  if (c.y > level.heightPx + 400) damage(world, CARGO_HP, c.x, c.y);
}

/**
 * The load the crate places on the players. Applied at the rope endpoints so
 * that hauling actually feels like hauling: a taut rope with a crate on it
 * drags you back down the wall you were climbing.
 */
export function applyRopeLoad(world: World): void {
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    if (p.gripping || p.dead) continue;
    const node = i === 0 ? 1 : world.ropeX.length - 2;
    const ax = anchorX(world, i);
    const ay = anchorY(world, i);
    const dx = world.ropeX[node] - ax;
    const dy = world.ropeY[node] - ay;
    const d = Math.sqrt(dx * dx + dy * dy);
    if (d < 0.0001) continue;
    // Scale by how stretched the rope is: slack rope droops, taut rope hauls.
    const other = world.players[1 - i];
    const sx = other.x - p.x;
    const sy = other.y - p.y;
    const span = Math.sqrt(sx * sx + sy * sy);
    const tension = Math.min(1, Math.max(0, (span - ROPE_REST) / (ROPE_MAX - ROPE_REST)));
    const anchored = other.gripping === 1 && !other.dead ? BRACED_LOAD_SHARE : 1;
    const load = ROPE_LOAD * (0.3 + 0.7 * tension) * (world.cargo.hp > 0 ? 1 : 0.4) * anchored;
    p.vx += (dx / d) * load * DT;
    p.vy += (dy / d) * load * DT;
    // The rope may add to a fall but must not break terminal velocity.
    if (p.vy > MAX_FALL_HEAVY) p.vy = MAX_FALL_HEAVY;
  }
}
