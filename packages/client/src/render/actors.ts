import {
  CARGO_H,
  CARGO_HP,
  CARGO_W,
  GRIP_MAX,
  PLAYER_H,
  PLAYER_W,
  ROPE_MAX,
  ROPE_NODES,
  ROPE_REST,
  type Level,
  type World,
  moverX,
  moverY,
  sawX,
  sawY,
} from '@haulmates/core';
import { CARGO_COLOURS, PLAYER_BODY, STENCIL_RED, type BiomePalette } from './palette.js';

/**
 * Face lines are drawn straight onto a near-black head, so they are paper, not
 * ink. Only the pupils stay dark, and those sit on white eye whites.
 */
const FACE_LINE = '#F4EFE2';

export interface ActorStyle {
  main: string;
  dark: string;
  light: string;
}

const HALF_H = PLAYER_H / 2;
const HALF_W = PLAYER_W / 2;

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

/* ------------------------------------------------------------------- rope */

/** Rope colour runs green → amber → red as it approaches breaking tension. */
/** Only ever used above 0.72 tension: below that the rope core is chalk. */
function tensionColour(t: number): string {
  return t < 0.86 ? '#FFC800' : STENCIL_RED;
}

export function drawRope(
  ctx: CanvasRenderingContext2D,
  world: World,
  prev: World,
  alpha: number,
  time: number,
): void {
  const a = world.players[0];
  const b = world.players[1];
  const span = Math.hypot(b.x - a.x, b.y - a.y);
  const tension = Math.max(0, Math.min(1, (span - ROPE_REST) / (ROPE_MAX - ROPE_REST)));

  const xs: number[] = [];
  const ys: number[] = [];
  for (let i = 0; i < ROPE_NODES; i++) {
    xs.push(lerp(prev.ropeX[i], world.ropeX[i], alpha));
    ys.push(lerp(prev.ropeY[i], world.ropeY[i], alpha));
  }

  const stroke = (width: number, style: string, offset = 0): void => {
    ctx.strokeStyle = style;
    ctx.lineWidth = width;
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0] + offset);
    for (let i = 1; i < ROPE_NODES - 1; i++) {
      const mx = (xs[i] + xs[i + 1]) / 2;
      const my = (ys[i] + ys[i + 1]) / 2 + offset;
      ctx.quadraticCurveTo(xs[i], ys[i] + offset, mx, my);
    }
    ctx.lineTo(xs[ROPE_NODES - 1], ys[ROPE_NODES - 1] + offset);
    ctx.stroke();
  };

  // The rope is the one clean line in the picture, so it is drawn as ink,
  // chalk, then a soft cast shadow — never as a coloured cord. Tension is
  // carried by the core going red rather than by the whole rope changing hue,
  // which keeps it legible against every biome.
  stroke(8, 'rgba(46,38,28,0.18)', 3);
  stroke(6.5, PLAYER_BODY);
  stroke(3.6, tension > 0.72 ? tensionColour(tension) : '#FFFDF6');

  if (tension > 0.86) {
    // At breaking tension the rope shivers and glows: the visual warning that
    // somebody is about to be launched.
    ctx.save();
    ctx.globalAlpha = (tension - 0.86) * 4;
    ctx.strokeStyle = STENCIL_RED;
    ctx.lineWidth = 1.4 + Math.sin(time * 40) * 0.6;
    ctx.beginPath();
    ctx.moveTo(xs[0], ys[0]);
    for (let i = 1; i < ROPE_NODES; i++) ctx.lineTo(xs[i], ys[i]);
    ctx.stroke();
    ctx.restore();
  }
}

/* ------------------------------------------------------------------ cargo */

export function drawCargo(
  ctx: CanvasRenderingContext2D,
  world: World,
  prev: World,
  alpha: number,
  time: number,
  reducedFlash: boolean,
): void {
  const c = world.cargo;
  const x = lerp(prev.cargo.x, c.x, alpha);
  const y = lerp(prev.cargo.y, c.y, alpha);
  const rot = lerp(prev.cargo.rot, c.rot, alpha);
  const health = Math.max(0, c.hp) / CARGO_HP;
  const shake = c.shake;

  // Tether from the middle of the rope down to the crate.
  const mid = (ROPE_NODES - 1) >> 1;
  ctx.strokeStyle = PLAYER_BODY;
  ctx.lineWidth = 2.6;
  ctx.beginPath();
  ctx.moveTo(lerp(prev.ropeX[mid], world.ropeX[mid], alpha), lerp(prev.ropeY[mid], world.ropeY[mid], alpha));
  ctx.lineTo(x, y - CARGO_H / 2);
  ctx.stroke();

  ctx.save();
  ctx.translate(x + (shake > 0.4 ? Math.sin(time * 90) * shake * 0.16 : 0), y);
  ctx.rotate(rot);

  const w = CARGO_W;
  const h = CARGO_H;
  ctx.fillStyle = 'rgba(46,38,28,0.20)';
  ctx.fillRect(-w / 2 + 2, -h / 2 + 3, w, h);

  // Pale ply with a hard ink outline, so the crate never reads as another
  // platform. It is the thing you are protecting; it has to look like freight.
  ctx.fillStyle = CARGO_COLOURS.body;
  ctx.fillRect(-w / 2, -h / 2, w, h);
  ctx.fillStyle = CARGO_COLOURS.bodyDark;
  ctx.fillRect(-w / 2, h / 2 - 4, w, 4);
  ctx.strokeStyle = CARGO_COLOURS.strap;
  ctx.lineWidth = 2;
  ctx.strokeRect(-w / 2 + 1, -h / 2 + 1, w - 2, h - 2);

  // Strapping, then the one saturated red in the picture.
  ctx.fillStyle = CARGO_COLOURS.strap;
  ctx.fillRect(-3, -h / 2, 5, h);
  ctx.fillStyle = CARGO_COLOURS.stencil;
  ctx.fillRect(-w / 2 + 3, -h / 2 + 5, w - 6, 3);
  ctx.fillRect(-w / 2 + 3, h / 2 - 9, w - 6, 3);

  // Cracks accumulate as the crate takes damage — readable at a glance.
  const cracks = Math.round((1 - health) * 5);
  ctx.strokeStyle = CARGO_COLOURS.crack;
  ctx.lineWidth = 1.4;
  for (let i = 0; i < cracks; i++) {
    const sx = -w / 2 + 3 + ((i * 37) % (w - 6));
    ctx.beginPath();
    ctx.moveTo(sx, -h / 2 + 2);
    ctx.lineTo(sx + (i % 2 === 0 ? 5 : -5), 0);
    ctx.lineTo(sx + (i % 2 === 0 ? 1 : -1), h / 2 - 2);
    ctx.stroke();
  }

  if (health < 0.34) {
    // A crate this hurt rarely climbs back above the threshold, so this is the
    // longest-lived warning in the game: it runs from the landing that did the
    // damage to the end of the run. Its pulse is 4.1 Hz at the threshold and
    // 5.4 Hz at death's door — the middle of the 3-30 Hz band that provokes
    // photosensitive seizures. Held steady it still says the same thing.
    ctx.globalAlpha = reducedFlash ? 0.4 : 0.28 + 0.22 * Math.sin(time * (10 + (1 - health) * 24));
    ctx.fillStyle = CARGO_COLOURS.stencil;
    ctx.fillRect(-w / 2, -h / 2, w, h);
    ctx.globalAlpha = 1;
  }
  ctx.restore();

  // Health pips above the crate, only while it is hurt.
  if (health < 0.999) {
    const barW = 30;
    ctx.fillStyle = 'rgba(0,0,0,0.55)';
    ctx.fillRect(x - barW / 2 - 1, y - h / 2 - 12, barW + 2, 5);
    ctx.fillStyle = health > 0.6 ? '#6ee787' : health > 0.3 ? '#ffb03a' : '#ff4d6d';
    ctx.fillRect(x - barW / 2, y - h / 2 - 11, barW * health, 3);
  }
}

/* ---------------------------------------------------------------- players */

export function drawPlayer(
  ctx: CanvasRenderingContext2D,
  world: World,
  prev: World,
  index: number,
  alpha: number,
  style: ActorStyle,
  hat: number,
  time: number,
): void {
  const p = world.players[index];
  const q = prev.players[index];
  const x = lerp(q.x, p.x, alpha);
  const y = lerp(q.y, p.y, alpha);
  const other = world.players[1 - index];

  const dead = p.dead === 1;
  const falling = p.vy > 480;
  const gripping = p.gripping === 1;
  const moving = Math.abs(p.vx) > 55 && p.grounded === 1;

  ctx.save();
  ctx.translate(x, y);

  // Squash and stretch reads velocity long before the numbers do.
  const stretch = Math.max(-0.16, Math.min(0.26, p.vy / 2600));
  const sy = dead ? 1 : 1 + stretch;
  const sx = dead ? 1 : 1 - stretch * 0.7;
  if (dead) ctx.rotate(1.4);
  ctx.scale(sx, sy);

  const bob = p.grounded && moving ? Math.sin(p.anim * 34) * 1.2 : 0;
  const lean = gripping ? p.wallDir * 2.4 : Math.max(-4, Math.min(4, p.vx / 55));

  /* contact shadow — warm and light, because nothing here is lit from behind */
  ctx.fillStyle = 'rgba(46,38,28,0.22)';
  ctx.beginPath();
  ctx.ellipse(0, HALF_H - 1, HALF_W * 0.95, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();

  /* legs */
  const legPhase = p.anim * 34;
  ctx.strokeStyle = PLAYER_BODY;
  ctx.lineWidth = 4.4;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    const swing = p.grounded === 1 ? Math.sin(legPhase + (side > 0 ? Math.PI : 0)) * (moving ? 5.5 : 0.8) : side * 3.2;
    const drop = p.grounded === 1 ? 0 : 2.5;
    ctx.beginPath();
    ctx.moveTo(side * 3.4, 8 + bob);
    ctx.lineTo(side * 3.4 + swing, HALF_H - 1 + drop);
    ctx.stroke();
  }

  /* torso — a dark body wearing a hi-vis vest, not a coloured body */
  const torsoY = -3 + bob;
  const tx = -HALF_W + 1 + lean * 0.3;
  ctx.fillStyle = PLAYER_BODY;
  roundRect(ctx, tx, torsoY - 6, PLAYER_W - 2, 17, 5);
  ctx.fill();

  // The vest is the only saturated hue on the figure, and it is worn rather
  // than being what the figure is made of. That is the whole costume gag and
  // it is also why two haulers stay tellable apart at capsule size.
  ctx.fillStyle = style.main;
  ctx.fillRect(tx + 1, torsoY - 4.5, PLAYER_W - 4, 13);
  ctx.fillStyle = style.dark;
  ctx.fillRect(tx + 1, torsoY + 6, PLAYER_W - 4, 2.5);

  // Two retroreflective bands, always white, always the brightest thing on the
  // body. At a distance the pair of them is what you actually track.
  ctx.fillStyle = style.light;
  ctx.fillRect(tx + 1, torsoY - 2.6, PLAYER_W - 4, 2.2);
  ctx.fillRect(tx + 1, torsoY + 2.4, PLAYER_W - 4, 2.2);

  /* arms — the leading arm always reaches for the rope */
  const towardPartner = Math.sign(other.x - p.x) || 1;
  ctx.strokeStyle = PLAYER_BODY;
  ctx.lineWidth = 3.4;
  ctx.beginPath();
  ctx.moveTo(0, torsoY - 2);
  if (gripping) {
    ctx.lineTo(p.wallDir !== 0 ? p.wallDir * 11 : towardPartner * 7, torsoY - 12);
  } else if (dead) {
    ctx.lineTo(-towardPartner * 10, torsoY + 4);
  } else {
    ctx.lineTo(towardPartner * 9, torsoY - 4 + Math.sin(legPhase) * 2);
  }
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(0, torsoY - 2);
  ctx.lineTo(-towardPartner * 7, torsoY + 3 - Math.sin(legPhase) * 2);
  ctx.stroke();

  /* head */
  const headY = torsoY - 15;
  const headX = lean * 0.5;
  ctx.fillStyle = PLAYER_BODY;
  ctx.beginPath();
  ctx.arc(headX, headY, 8.6, 0, Math.PI * 2);
  ctx.fill();
  // A light rim rather than a dark one: on a near-black head, shading down is
  // invisible and shading up is what gives it a form.
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(headX, headY - 2.2, 8.6, Math.PI + 0.25, -0.25);
  ctx.fill();

  if (hat !== 5) drawFace(ctx, headX, headY, p, dead, falling, gripping, moving, towardPartner);
  drawHat(ctx, hat, headX, headY, time, style);

  ctx.restore();

  /* grip stamina ring — only while it matters */
  if (gripping || p.grip < GRIP_MAX * 0.98) {
    const frac = Math.max(0, p.grip / GRIP_MAX);
    ctx.save();
    ctx.translate(x, y - HALF_H - 13);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)';
    ctx.lineWidth = 3.6;
    ctx.beginPath();
    ctx.arc(0, 0, 7, -Math.PI / 2, Math.PI * 1.5);
    ctx.stroke();
    ctx.strokeStyle = frac > 0.35 ? '#6ee787' : '#ff4d6d';
    ctx.lineWidth = 2.6;
    ctx.beginPath();
    ctx.arc(0, 0, 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * frac);
    ctx.stroke();
    ctx.restore();
  }
}

function drawFace(
  ctx: CanvasRenderingContext2D,
  hx: number,
  hy: number,
  p: World['players'][number],
  dead: boolean,
  falling: boolean,
  gripping: boolean,
  moving: boolean,
  towardPartner: number,
): void {
  const look = Math.max(-1.4, Math.min(1.4, p.vx / 160)) + (dead ? 0 : 0);
  const eyeY = hy - 1.4;

  if (dead) {
    ctx.strokeStyle = FACE_LINE;
    ctx.lineWidth = 1.7;
    for (const side of [-1, 1]) {
      const ex = hx + side * 3.4;
      ctx.beginPath();
      ctx.moveTo(ex - 2, eyeY - 2);
      ctx.lineTo(ex + 2, eyeY + 2);
      ctx.moveTo(ex + 2, eyeY - 2);
      ctx.lineTo(ex - 2, eyeY + 2);
      ctx.stroke();
    }
    ctx.fillStyle = FACE_LINE;
    ctx.beginPath();
    ctx.ellipse(hx, hy + 4, 2.4, 1.8, 0, 0, Math.PI * 2);
    ctx.fill();
    return;
  }

  if (gripping) {
    // Squinting with effort.
    ctx.strokeStyle = FACE_LINE;
    ctx.lineWidth = 1.8;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(hx + side * 5, eyeY);
      ctx.lineTo(hx + side * 1.6, eyeY + (side === Math.sign(p.wallDir || 1) ? 0.8 : -0.8));
      ctx.stroke();
    }
    ctx.beginPath();
    ctx.moveTo(hx - 3, hy + 4.4);
    ctx.lineTo(hx + 3, hy + 4.4);
    ctx.stroke();
    return;
  }

  const wide = falling ? 3.6 : 2.9;
  ctx.fillStyle = '#f4f6ff';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.ellipse(hx + side * 3.6, eyeY, wide * 0.75, wide, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#12131c';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.arc(hx + side * 3.6 + look, eyeY + (falling ? 0.8 : 0), 1.35, 0, Math.PI * 2);
    ctx.fill();
  }

  ctx.strokeStyle = FACE_LINE;
  ctx.fillStyle = FACE_LINE;
  ctx.lineWidth = 1.5;
  if (falling) {
    ctx.beginPath();
    ctx.ellipse(hx, hy + 4.4, 2.6, 3.1, 0, 0, Math.PI * 2);
    ctx.fill();
  } else if (moving) {
    ctx.beginPath();
    ctx.arc(hx + towardPartner * 0.4, hy + 2.6, 3, 0.15, Math.PI - 0.15);
    ctx.stroke();
  } else {
    ctx.beginPath();
    ctx.moveTo(hx - 2.4, hy + 4.2);
    ctx.lineTo(hx + 2.4, hy + 4.2);
    ctx.stroke();
  }
}

export function drawHat(
  ctx: CanvasRenderingContext2D,
  hat: number,
  hx: number,
  hy: number,
  time: number,
  style: ActorStyle,
): void {
  switch (hat) {
    case 1: {
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath();
      ctx.arc(hx, hy - 3, 8.4, Math.PI, 0);
      ctx.fill();
      ctx.fillRect(hx - 11, hy - 4, 22, 2.6);
      ctx.fillStyle = '#c79300';
      ctx.fillRect(hx - 1.2, hy - 11.4, 2.4, 8);
      return;
    }
    case 2: {
      ctx.fillStyle = '#ff7a1f';
      ctx.beginPath();
      ctx.moveTo(hx, hy - 20);
      ctx.lineTo(hx + 8, hy - 3);
      ctx.lineTo(hx - 8, hy - 3);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fff';
      ctx.fillRect(hx - 5.4, hy - 11, 10.8, 2.6);
      ctx.fillStyle = '#e0620f';
      ctx.fillRect(hx - 10, hy - 3.4, 20, 2.6);
      return;
    }
    case 3: {
      ctx.fillStyle = '#4fd6e0';
      ctx.beginPath();
      ctx.arc(hx, hy - 3, 8, Math.PI, 0);
      ctx.fill();
      ctx.fillStyle = '#ff6fae';
      ctx.save();
      ctx.translate(hx, hy - 12);
      ctx.rotate(time * 14);
      ctx.fillRect(-9, -1.2, 18, 2.4);
      ctx.fillRect(-1.2, -9, 2.4, 18);
      ctx.restore();
      return;
    }
    case 4: {
      ctx.fillStyle = '#1a1a22';
      ctx.fillRect(hx - 11, hy - 8, 22, 2.6);
      ctx.fillRect(hx - 6.5, hy - 20, 13, 12);
      ctx.fillStyle = '#c0392b';
      ctx.fillRect(hx - 6.5, hy - 11.5, 13, 2.8);
      return;
    }
    case 5: {
      // Paper bag: replaces the face entirely, which is the joke.
      ctx.fillStyle = '#c9a173';
      roundRect(ctx, hx - 9, hy - 11, 18, 20, 2);
      ctx.fill();
      ctx.fillStyle = '#12131c';
      ctx.beginPath();
      ctx.arc(hx - 3.4, hy - 1, 1.9, 0, Math.PI * 2);
      ctx.arc(hx + 3.4, hy - 1, 1.9, 0, Math.PI * 2);
      ctx.fill();
      ctx.strokeStyle = '#a37f52';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(hx - 9, hy - 6);
      ctx.lineTo(hx + 9, hy - 6);
      ctx.stroke();
      return;
    }
    case 6: {
      ctx.fillStyle = '#ffd23d';
      ctx.beginPath();
      ctx.moveTo(hx - 8, hy - 6);
      ctx.lineTo(hx - 8, hy - 15);
      ctx.lineTo(hx - 4, hy - 10);
      ctx.lineTo(hx, hy - 17);
      ctx.lineTo(hx + 4, hy - 10);
      ctx.lineTo(hx + 8, hy - 15);
      ctx.lineTo(hx + 8, hy - 6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#ff6fae';
      ctx.beginPath();
      ctx.arc(hx, hy - 8.5, 1.6, 0, Math.PI * 2);
      ctx.fill();
      return;
    }
    case 7: {
      ctx.strokeStyle = '#fff2a8';
      ctx.lineWidth = 2.2;
      ctx.globalAlpha = 0.85 + Math.sin(time * 3) * 0.15;
      ctx.beginPath();
      ctx.ellipse(hx, hy - 14 + Math.sin(time * 2) * 0.8, 7.5, 2.6, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.globalAlpha = 1;
      return;
    }
    case 8: {
      // A folding stepladder, worn as a hat, by somebody who has spent the
      // evening being one. Unlocked by the first boost.
      ctx.strokeStyle = '#8a6c2c';
      ctx.lineWidth = 2;
      ctx.lineCap = 'round';
      for (const side of [-1, 1]) {
        ctx.beginPath();
        ctx.moveTo(hx + side * 1.5, hy - 8);
        ctx.lineTo(hx + side * 6, hy - 17);
        ctx.stroke();
      }
      ctx.lineWidth = 1.4;
      for (let i = 0; i < 3; i++) {
        const t = 0.3 + i * 0.24;
        ctx.beginPath();
        ctx.moveTo(hx - 1.5 - 4.5 * t, hy - 8 - 9 * t);
        ctx.lineTo(hx + 1.5 + 4.5 * t, hy - 8 - 9 * t);
        ctx.stroke();
      }
      return;
    }
    default: {
      // A tiny cowlick so a bare head still has a silhouette.
      ctx.strokeStyle = style.dark;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.moveTo(hx + 1, hy - 8);
      ctx.quadraticCurveTo(hx + 5, hy - 13, hx + 2, hy - 14);
      ctx.stroke();
      return;
    }
  }
}

/* --------------------------------------------------------- level entities */

export function drawMovers(
  ctx: CanvasRenderingContext2D,
  level: Level,
  tick: number,
  alpha: number,
  p: BiomePalette,
): void {
  for (const m of level.movers) {
    const x = lerp(moverX(m, tick - 1), moverX(m, tick), alpha);
    const y = lerp(moverY(m, tick - 1), moverY(m, tick), alpha);
    ctx.fillStyle = p.shadowInk;
    ctx.fillRect(x + 2, y + 3, m.w, m.h);
    if (m.deadly) {
      ctx.fillStyle = p.ink;
      ctx.fillRect(x, y, m.w, m.h);
      // Hazard stripes: universal shorthand for "this will kill you". In the
      // hazard colour rather than a fixed yellow, so a crusher, a saw and a
      // lava pool are all the same colour as each other and none of them is
      // the colour of the tape on the ledge you are standing on.
      ctx.save();
      ctx.beginPath();
      ctx.rect(x, y, m.w, m.h);
      ctx.clip();
      ctx.fillStyle = p.hazard;
      for (let s = -m.h; s < m.w; s += 16) {
        ctx.beginPath();
        ctx.moveTo(x + s, y + m.h);
        ctx.lineTo(x + s + 8, y + m.h);
        ctx.lineTo(x + s + 8 + m.h, y);
        ctx.lineTo(x + s + m.h, y);
        ctx.closePath();
        ctx.fill();
      }
      ctx.restore();
      ctx.fillStyle = p.hazardDark;
      ctx.fillRect(x, y + m.h - 4, m.w, 4);
      ctx.fillStyle = p.hazard;
      for (let s = 3; s < m.w - 4; s += 9) {
        ctx.beginPath();
        ctx.moveTo(x + s, y + m.h);
        ctx.lineTo(x + s + 4.5, y + m.h + 6);
        ctx.lineTo(x + s + 9, y + m.h);
        ctx.closePath();
        ctx.fill();
      }
    } else {
      ctx.fillStyle = '#4a5470';
      ctx.fillRect(x, y, m.w, m.h);
      ctx.fillStyle = '#8b98c4';
      ctx.fillRect(x, y, m.w, 3);
      ctx.fillStyle = '#2a3149';
      for (let s = 4; s < m.w - 3; s += 12) ctx.fillRect(x + s, y + m.h * 0.5 - 1, 3, 2);
    }
  }
}

export function drawSaws(
  ctx: CanvasRenderingContext2D,
  level: Level,
  tick: number,
  alpha: number,
  time: number,
  p: BiomePalette,
): void {
  for (const s of level.saws) {
    const x = lerp(sawX(s, tick - 1), sawX(s, tick), alpha);
    const y = lerp(sawY(s, tick - 1), sawY(s, tick), alpha);

    // The track the blade rides, so its path is readable before it arrives.
    // In ink at low alpha: white on a bone-white sky is a track nobody can see
    // until the blade is on it.
    if (s.ax !== 0 || s.ay !== 0) {
      ctx.save();
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = p.ink;
      ctx.lineWidth = 2;
      ctx.setLineDash([6, 6]);
      ctx.beginPath();
      ctx.moveTo(s.x, s.y);
      ctx.lineTo(s.x + s.ax, s.y + s.ay);
      ctx.stroke();
      ctx.setLineDash([]);
      ctx.restore();
    }

    ctx.save();
    ctx.translate(x, y);
    ctx.rotate(time * 9 * s.spin);
    // A pale steel blade is the same failure the spikes had: on a bone-white
    // ground the one object in the frame that dismembers you was the hardest
    // thing in it to see. Hazard-coloured and boxed in ink instead, so the
    // silhouette holds against the sky as well as against the tower.
    ctx.fillStyle = p.hazard;
    ctx.strokeStyle = p.ink;
    ctx.lineWidth = 2;
    ctx.lineJoin = 'round';
    ctx.beginPath();
    const teeth = 12;
    for (let i = 0; i < teeth; i++) {
      const a0 = (i / teeth) * Math.PI * 2;
      const a1 = ((i + 0.5) / teeth) * Math.PI * 2;
      ctx.lineTo(Math.cos(a0) * s.r, Math.sin(a0) * s.r);
      ctx.lineTo(Math.cos(a1) * s.r * 0.76, Math.sin(a1) * s.r * 0.76);
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = p.hazardDark;
    ctx.beginPath();
    ctx.arc(0, 0, s.r * 0.42, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = p.ink;
    ctx.beginPath();
    ctx.arc(0, 0, s.r * 0.16, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export { lerp as lerpRender };
export type { BiomePalette };
