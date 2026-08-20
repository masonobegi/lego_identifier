import {
  CARGO_BOUNCE,
  CARGO_DAMPING,
  CARGO_GRAVITY,
  CARGO_H,
  CARGO_HP,
  CARGO_IMPACT_MIN,
  CARGO_IMPACT_SCALE,
  CARGO_REGEN,
  CARGO_REGEN_DELAY,
  CARGO_TETHER,
  CARGO_W,
  DT,
  MAX_FALL_HEAVY,
  ROPE_LOAD,
  ROPE_MAX,
  ROPE_REST,
  TICK_RATE,
  TILE,
  WIND_ACCEL,
} from './constants.js';
import { T_WIND, type Level, tileAt } from './level.js';
import { collider, moveCollider } from './physics.js';
import { hazardAt } from './hazards.js';
import { pushEvent } from './events.js';
import { ROPE_MID, anchorX, anchorY } from './rope.js';
import { EV_CARGO_BREAK, EV_CARGO_HIT, EV_CARGO_LAND, type World } from './types.js';

const HW = CARGO_W / 2;
const HH = CARGO_H / 2;
const G_STEP = CARGO_GRAVITY * DT * DT;
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

  // Handle it carefully for a while and the straps get retightened. Without
  // this, a long climb is a slow accumulation of unavoidable chip damage.
  if (c.hp > 0 && c.hp < CARGO_HP) {
    c.calm++;
    if (c.calm > CARGO_REGEN_DELAY) c.hp = Math.min(CARGO_HP, c.hp + CARGO_REGEN);
  }

  let vx = (c.x - c.px) * CARGO_DAMPING;
  let vy = (c.y - c.py) * CARGO_DAMPING;
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
  const mx = world.ropeX[ROPE_MID];
  const my = world.ropeY[ROPE_MID];
  const dx = c.x - mx;
  const dy = c.y - my;
  const d = Math.sqrt(dx * dx + dy * dy);
  if (d > CARGO_TETHER && d > 0.0001) {
    const corr = (d - CARGO_TETHER) / d;
    c.x -= dx * corr * 0.3;
    c.y -= dy * corr * 0.3;
    world.ropeX[ROPE_MID] += dx * corr * 0.7;
    world.ropeY[ROPE_MID] += dy * corr * 0.7;
  }

  // Spin from horizontal motion, so the crate tumbles convincingly.
  c.rotV = c.rotV * 0.96 + (c.x - c.px) * 0.012;
  if (c.grounded) c.rotV *= 0.82;
  c.rot += c.rotV;

  if (hazardAt(level, world, c.x - HW + 4, c.y - HH + 4, c.x + HW - 4, c.y + HH - 4)) {
    damage(world, 34, c.x, c.y);
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
    const load = ROPE_LOAD * (0.3 + 0.7 * tension) * (world.cargo.hp > 0 ? 1 : 0.4);
    p.vx += (dx / d) * load * DT;
    p.vy += (dy / d) * load * DT;
    // The rope may add to a fall but must not break terminal velocity.
    if (p.vy > MAX_FALL_HEAVY) p.vy = MAX_FALL_HEAVY;
  }
}
