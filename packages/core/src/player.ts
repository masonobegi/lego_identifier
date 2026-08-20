import {
  AIR_ACCEL,
  AIR_FRICTION,
  BOUNCE_VELOCITY,
  CONVEYOR_SPEED,
  COYOTE_TICKS,
  DT,
  EMOTE_COUNT,
  EMOTE_TICKS,
  GRAVITY,
  GRIP_DRAIN,
  GRIP_MAX,
  GRIP_REACH,
  GRIP_REGEN,
  GRIP_REGEN_DELAY,
  GROUND_ACCEL,
  GROUND_FRICTION,
  ICE_ACCEL,
  ICE_FRICTION,
  IN_DOWN,
  IN_EMOTE,
  IN_GRIP,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  JUMP_BUFFER_TICKS,
  JUMP_CUT,
  JUMP_VELOCITY,
  MAX_FALL,
  MAX_FALL_HEAVY,
  PLAYER_H,
  PLAYER_HALF_W,
  RUN_SPEED,
  TILE,
  WALL_JUMP_X,
  WALL_JUMP_Y,
  WIND_ACCEL,
} from './constants.js';
import { approach } from './math.js';
import {
  T_BOUNCE,
  T_GRIP,
  T_WIND,
  isGrippyTile,
  type Level,
  moverX,
  moverY,
  tileAt,
} from './level.js';
import { collider, moveCollider, probeGround, rectHitsTiles } from './physics.js';
import { pushEvent } from './events.js';
import {
  EV_BOUNCE,
  EV_EMOTE,
  EV_GRIP,
  EV_JUMP,
  EV_LAND,
  EV_STEP,
  GROUND_CONVEYOR_L,
  GROUND_CONVEYOR_R,
  GROUND_CRUMBLE,
  GROUND_ICE,
  GROUND_MOVER,
  GROUND_NONE,
  type World,
} from './types.js';

const HALF_H = PLAYER_H / 2;
const moverScratch = { dx: 0, dy: 0 };

function pressed(p: { prevInput: number }, input: number, bit: number): boolean {
  return (input & bit) !== 0 && (p.prevInput & bit) === 0;
}

/** Which side, if any, the player is pressed against. */
function wallCheck(level: Level, world: World, x: number, y: number): number {
  const top = y - HALF_H + 4;
  const bottom = y + HALF_H - 4;
  if (rectHitsTiles(level, world, x - PLAYER_HALF_W - GRIP_REACH, top, x - PLAYER_HALF_W, bottom)) return -1;
  if (rectHitsTiles(level, world, x + PLAYER_HALF_W, top, x + PLAYER_HALF_W + GRIP_REACH, bottom)) return 1;
  return 0;
}

/** Is the player overlapping a dedicated grip surface (rebar, vines, pipes)? */
function onGripSurface(level: Level, x: number, y: number): boolean {
  const x0 = Math.floor((x - PLAYER_HALF_W - GRIP_REACH) / TILE);
  const x1 = Math.floor((x + PLAYER_HALF_W + GRIP_REACH) / TILE);
  const y0 = Math.floor((y - HALF_H) / TILE);
  const y1 = Math.floor((y + HALF_H) / TILE);
  for (let ty = y0; ty <= y1; ty++) {
    for (let tx = x0; tx <= x1; tx++) {
      if (isGrippyTile(tileAt(level, tx, ty))) return true;
    }
  }
  return false;
}

function inWind(level: Level, x: number, y: number): boolean {
  return tileAt(level, Math.floor(x / TILE), Math.floor(y / TILE)) === T_WIND;
}

/**
 * One player's tick: intent, then forces, then movement, then contact response.
 * The rope is applied outside this function so that both players have already
 * moved before the constraint is solved.
 */
export function updatePlayer(level: Level, world: World, index: number, input: number): void {
  const p = world.players[index];

  if (p.emoteTimer > 0) p.emoteTimer--;
  if (p.stunned > 0) p.stunned--;

  if (p.dead) {
    updateCorpse(level, world, index);
    p.prevInput = input;
    return;
  }

  if (pressed(p, input, IN_EMOTE) && p.emoteTimer <= 0) {
    p.emote = (p.emote + 1) % EMOTE_COUNT;
    p.emoteTimer = EMOTE_TICKS;
    pushEvent(world, EV_EMOTE, p.x, p.y, index, p.emote);
  }

  const stunned = p.stunned > 0;
  const wantLeft = !stunned && (input & IN_LEFT) !== 0;
  const wantRight = !stunned && (input & IN_RIGHT) !== 0;
  const axis = (wantRight ? 1 : 0) - (wantLeft ? 1 : 0);
  if (axis !== 0) p.facing = axis;

  /* ---------------------------------------------------------------- grip */
  const wall = wallCheck(level, world, p.x, p.y);
  p.wallDir = wall;
  const grippy = onGripSurface(level, p.x, p.y);
  const canAnchor = p.grounded === 1 || wall !== 0 || grippy;
  const wantGrip = !stunned && (input & IN_GRIP) !== 0;

  if (wantGrip && canAnchor && p.grip > 0) {
    if (!p.gripping) {
      p.gripX = p.x;
      p.gripY = p.y;
      pushEvent(world, EV_GRIP, p.x, p.y, index, grippy ? 1 : 0);
    }
    p.gripping = 1;
    // Bracing on your own two feet costs nothing. Hanging off a wall by your
    // fingers burns stamina; rebar is free because that is what rebar is for.
    //
    // This used to drain on solid ground too, which made an anchor expire after
    // five seconds — and being an anchor is the whole co-operative half of this
    // game. Measured: a partner reeling out of a six-tile pit needs about nine
    // seconds, so the anchor gave out every time and the verb was decorative.
    if (!grippy && p.grounded !== 1) p.grip -= GRIP_DRAIN * DT;
    if (p.grip <= 0) {
      p.grip = 0;
      p.gripping = 0;
      p.gripCooldown = 40;
    }
  } else {
    if (p.gripping) p.gripCooldown = GRIP_REGEN_DELAY;
    p.gripping = 0;
  }

  if (!p.gripping) {
    if (p.gripCooldown > 0) p.gripCooldown--;
    else if (p.grip < GRIP_MAX) p.grip = Math.min(GRIP_MAX, p.grip + GRIP_REGEN * DT);
  }

  /* -------------------------------------------------------------- jumping */
  if (pressed(p, input, IN_JUMP)) p.jumpBuffer = JUMP_BUFFER_TICKS;
  else if (p.jumpBuffer > 0) p.jumpBuffer--;

  if (p.grounded) p.coyote = COYOTE_TICKS;
  else if (p.coyote > 0) p.coyote--;

  const jumpHeldNow = (input & IN_JUMP) !== 0;

  if (p.gripping) {
    // Anchored: pinned in place, absorbing whatever the rope throws at you.
    p.vx = 0;
    p.vy = 0;
    if (p.ridePlatform >= 0 && p.ridePlatform < level.movers.length) {
      const m = level.movers[p.ridePlatform];
      p.gripX += moverX(m, world.tick) - moverX(m, world.tick - 1);
      p.gripY += moverY(m, world.tick) - moverY(m, world.tick - 1);
    }
    p.x = p.gripX;
    p.y = p.gripY;
    if (p.jumpBuffer > 0 && !stunned) {
      p.jumpBuffer = 0;
      p.gripping = 0;
      p.gripCooldown = GRIP_REGEN_DELAY;
      if (wall !== 0 && p.grounded !== 1) {
        p.vx = -wall * WALL_JUMP_X;
        p.vy = WALL_JUMP_Y;
      } else {
        p.vy = JUMP_VELOCITY;
      }
      pushEvent(world, EV_JUMP, p.x, p.y, index, 1);
    }
    p.anim += 0.04;
    p.prevInput = input;
    return;
  }

  if (p.jumpBuffer > 0 && !stunned) {
    if (p.coyote > 0) {
      p.jumpBuffer = 0;
      p.coyote = 0;
      p.vy = JUMP_VELOCITY;
      pushEvent(world, EV_JUMP, p.x, p.y, index, 0);
    } else if (wall !== 0) {
      p.jumpBuffer = 0;
      p.vx = -wall * WALL_JUMP_X;
      p.vy = WALL_JUMP_Y;
      p.facing = -wall;
      pushEvent(world, EV_JUMP, p.x, p.y, index, 2);
    }
  }

  // Variable jump height: releasing the button early clips the arc.
  if (!jumpHeldNow && p.jumpHeld && p.vy < 0) p.vy *= JUMP_CUT;
  p.jumpHeld = jumpHeldNow ? 1 : 0;

  /* ----------------------------------------------------- horizontal drive */
  const onIce = p.groundKind === GROUND_ICE;
  let accel = p.grounded ? (onIce ? ICE_ACCEL : GROUND_ACCEL) : AIR_ACCEL;
  let friction = p.grounded ? (onIce ? ICE_FRICTION : GROUND_FRICTION) : AIR_FRICTION;

  let drift = 0;
  if (p.grounded) {
    if (p.groundKind === GROUND_CONVEYOR_R) drift = CONVEYOR_SPEED;
    else if (p.groundKind === GROUND_CONVEYOR_L) drift = -CONVEYOR_SPEED;
  }

  if (axis !== 0) {
    const target = axis * RUN_SPEED + drift;
    const faster = axis > 0 ? p.vx > target : p.vx < target;
    // Momentum from a rope yank is never scrubbed by holding a direction —
    // you keep the speed you were flung with.
    p.vx = approach(p.vx, target, (faster ? friction * 0.25 : accel) * DT);
  } else {
    p.vx = approach(p.vx, drift, friction * DT);
  }

  /* ------------------------------------------------------------- gravity */
  const fastFall = (input & IN_DOWN) !== 0 && !p.grounded;
  let g = GRAVITY * (fastFall ? 1.45 : 1);
  if (p.vy < 0 && jumpHeldNow) g *= 0.86;
  p.vy += g * DT;
  if (inWind(level, p.x, p.y)) p.vy += WIND_ACCEL * DT;
  const cap = fastFall ? MAX_FALL_HEAVY : MAX_FALL;
  if (p.vy > cap) p.vy = cap;

  /* -------------------------------------------------------------- movement */
  collider.set(p.x, p.y, PLAYER_HALF_W, HALF_H);
  collider.dropThrough = (input & IN_DOWN) !== 0;

  if (p.ridePlatform >= 0 && p.ridePlatform < level.movers.length) {
    const m = level.movers[p.ridePlatform];
    moverScratch.dx = moverX(m, world.tick) - moverX(m, world.tick - 1);
    moverScratch.dy = moverY(m, world.tick) - moverY(m, world.tick - 1);
    collider.x += moverScratch.dx;
    collider.y += moverScratch.dy;
  }

  const wasGrounded = p.grounded;
  moveCollider(level, world, collider, p.vx * DT, p.vy * DT);
  p.x = collider.x;
  p.y = collider.y;

  if (collider.hitX !== 0) p.vx = 0;

  let landed = false;
  if (collider.hitY === 1) {
    landed = true;
    if (!wasGrounded && p.vy > 240) pushEvent(world, EV_LAND, p.x, p.y + HALF_H, index, p.vy);
    p.vy = 0;
  } else if (collider.hitY === -1) {
    p.vy = 0;
  }

  p.grounded = landed ? 1 : 0;
  p.ridePlatform = -1;
  p.groundKind = GROUND_NONE;
  if (landed) {
    p.groundKind = probeGround(level, world, collider);
    if (collider.ride >= 0) p.ridePlatform = collider.ride;
    if (p.groundKind === GROUND_CRUMBLE && collider.steppedCrumble >= 0) {
      const slot = collider.steppedCrumble;
      if (world.crumble[slot] === 0) world.crumble[slot] = 1;
    }
    // Bounce pads override everything: they are the level designer shouting.
    const footTile = tileAt(level, Math.floor(p.x / TILE), Math.floor((p.y + HALF_H + 2) / TILE));
    if (footTile === T_BOUNCE) {
      p.vy = BOUNCE_VELOCITY;
      p.grounded = 0;
      pushEvent(world, EV_BOUNCE, p.x, p.y + HALF_H, index, 0);
    }
  }

  /* --------------------------------------------------------------- polish */
  const speed = p.vx < 0 ? -p.vx : p.vx;
  p.anim += p.grounded ? 0.006 + speed * 0.00055 : 0.02;
  if (p.grounded && speed > 40) {
    const phase = Math.floor(p.anim * 8);
    if (phase !== Math.floor((p.anim - (0.006 + speed * 0.00055)) * 8)) {
      pushEvent(world, EV_STEP, p.x, p.y + HALF_H, index, p.groundKind);
    }
  }
  if (p.groundKind === GROUND_MOVER && collider.ride >= 0) p.ridePlatform = collider.ride;

  p.prevInput = input;
}

/** A dead player is a ragdoll dangling from the rope until they pop back. */
function updateCorpse(level: Level, world: World, index: number): void {
  const p = world.players[index];
  p.gripping = 0;
  p.grounded = 0;
  p.vy += GRAVITY * 0.85 * DT;
  if (p.vy > MAX_FALL) p.vy = MAX_FALL;
  // A corpse slides: low friction so a partner can actually drag it.
  p.vx = approach(p.vx, 0, 110 * DT);

  collider.set(p.x, p.y, PLAYER_HALF_W, HALF_H * 0.7);
  collider.dropThrough = false;
  moveCollider(level, world, collider, p.vx * DT, p.vy * DT);
  p.x = collider.x;
  p.y = collider.y;
  if (collider.hitX !== 0) p.vx *= -0.3;
  if (collider.hitY !== 0) {
    p.vy *= -0.2;
    p.vx *= 0.8;
  }
  p.anim += 0.05;
  if (p.respawn > 0) p.respawn--;
}

export { HALF_H as PLAYER_HALF_H };
