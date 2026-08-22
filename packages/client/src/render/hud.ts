import {
  CARGO_HP,
  DT,
  GRIP_MAX,
  RESTART_HOLD,
  TILE,
  cargoAtGoal,
  pairAtGoal,
  type Level,
  type World,
} from '@haulmates/core';
import { biomeFor } from './palette.js';
import { roundRect } from './actors.js';

export interface HudState {
  world: World;
  level: Level;
  mode: number;
  modeName: string;
  localIndex: number;
  names: [string, string];
  colours: [string, string];
  elapsedSeconds: number;
  /** Net diagnostics; omitted for couch co-op. */
  net?: { rtt: number; rollbacks: number; worstRollback: number; tick: number; lead: number; desyncs: number };
  showNetgraph: boolean;
  /**
   * True when one player can force the checkpoint reset alone, because the
   * second hauler is the Autohauler and echoes the vote rather than casting
   * one. The instruction on the bar has to say what this configuration will
   * actually accept.
   */
  soloRestart: boolean;
  hint: string;
  hintStrength: number;
}

const FONT = 'ui-sans-serif, system-ui, -apple-system, Segoe UI, Roboto, sans-serif';

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  const cs = Math.floor((seconds * 100) % 100);
  return `${m}:${s.toString().padStart(2, '0')}.${cs.toString().padStart(2, '0')}`;
}

function panel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number): void {
  ctx.fillStyle = 'rgba(9,12,22,0.72)';
  roundRect(ctx, x, y, w, h, 10);
  ctx.fill();
  ctx.strokeStyle = 'rgba(255,255,255,0.09)';
  ctx.lineWidth = 2;
  roundRect(ctx, x, y, w, h, 10);
  ctx.stroke();
}

/** The HUD is drawn in screen space, after the camera transform is restored. */
export function drawHud(ctx: CanvasRenderingContext2D, w: number, h: number, s: HudState): void {
  const scale = Math.max(0.72, Math.min(1.35, h / 900));
  ctx.save();
  ctx.scale(scale, scale);
  const vw = w / scale;
  const vh = h / scale;

  drawTopBar(ctx, vw, s);
  drawProgress(ctx, vw, vh, s);
  drawCargoWarning(ctx, vw, vh, s);
  drawCargoCall(ctx, vw, vh, s);
  drawRestartVote(ctx, vw, vh, s);
  if (s.showNetgraph && s.net) drawNetgraph(ctx, vw, s.net);
  if (s.hintStrength > 0.01 && s.hint) drawHint(ctx, vw, vh, s);

  ctx.restore();
}

function drawTopBar(ctx: CanvasRenderingContext2D, vw: number, s: HudState): void {
  const biome = biomeFor(s.level.biome[Math.max(0, Math.min(s.level.h - 1, Math.floor(s.world.players[0].y / TILE)))]);
  const deathRow = s.world.players[0].deaths + s.world.players[1].deaths > 0;
  panel(ctx, 18, 16, 286, deathRow ? 74 : 62);

  ctx.font = `900 13px ${FONT}`;
  ctx.fillStyle = '#8c97b6';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.fillText(s.modeName.toUpperCase(), 32, 38);

  ctx.font = `900 26px ${FONT}`;
  ctx.fillStyle = '#e8ecf7';
  ctx.fillText(formatTime(s.elapsedSeconds), 32, 66);

  ctx.font = `800 12px ${FONT}`;
  ctx.fillStyle = biome.hot;
  ctx.textAlign = 'right';
  ctx.fillText(biome.name, 290, 38);

  // Count the failure that actually happens.
  //
  // This read `0 DEATHS` through entire runs, and it was not lying — you rarely
  // die in this game. What happens is the crate goes, and losing the crate is
  // what sends you back to the checkpoint. Reporting deaths and not crates
  // meant the HUD's only number was the one thing that never moved.
  ctx.font = `800 12px ${FONT}`;
  const lost = s.world.cargoBreaks;
  const deaths = s.world.players[0].deaths + s.world.players[1].deaths;
  ctx.fillStyle = lost > 0 ? '#ff4d6d' : '#8c97b6';
  ctx.fillText(lost === 1 ? '1 CRATE LOST' : `${lost} CRATES LOST`, 290, 66);
  // Deaths are the smaller story, so they only get space once there are any.
  if (deaths > 0) {
    ctx.font = `800 11px ${FONT}`;
    ctx.fillStyle = '#8c97b6';
    ctx.fillText(`${deaths} DEATH${deaths === 1 ? '' : 'S'}`, 290, 78);
  }
  ctx.textAlign = 'left';
}

/** A vertical bar showing how far up the tower the pair has climbed. */
function drawProgress(ctx: CanvasRenderingContext2D, vw: number, vh: number, s: HudState): void {
  const x = vw - 44;
  const top = 90;
  const bottom = vh - 120;
  const height = bottom - top;
  if (height < 80) return;

  ctx.fillStyle = 'rgba(9,12,22,0.6)';
  roundRect(ctx, x - 9, top - 10, 20, height + 20, 10);
  ctx.fill();

  const levelH = s.level.heightPx;
  const at = (y: number): number => bottom - (1 - Math.max(0, Math.min(1, y / levelH))) * height;

  // Checkpoints already banked.
  for (const cp of s.level.checkpoints) {
    const cy = at(cp.y);
    const reached = cp.y >= s.world.spawnY - 4 && cp.y <= s.world.spawnY + 4;
    const passed = cp.y >= s.world.best;
    ctx.fillStyle = reached ? '#ffd166' : passed ? '#4d5b7a' : '#2a3149';
    ctx.fillRect(x - 5, cy - 1.5, 12, 3);
  }

  ctx.fillStyle = '#6ee787';
  ctx.beginPath();
  ctx.arc(x + 1, at(s.level.goalY), 4.5, 0, Math.PI * 2);
  ctx.fill();

  const mid = (s.world.players[0].y + s.world.players[1].y) / 2;
  const py = at(mid);
  ctx.fillStyle = s.colours[0];
  ctx.beginPath();
  ctx.moveTo(x - 12, py);
  ctx.lineTo(x - 4, py - 5);
  ctx.lineTo(x - 4, py + 5);
  ctx.closePath();
  ctx.fill();

  ctx.font = `800 11px ${FONT}`;
  ctx.fillStyle = '#8c97b6';
  ctx.textAlign = 'center';
  const metres = Math.max(0, Math.round((levelH - mid) / 24));
  ctx.fillText(`${metres}m`, x + 1, bottom + 26);
  ctx.textAlign = 'left';
}

function drawCargoWarning(ctx: CanvasRenderingContext2D, vw: number, vh: number, s: HudState): void {
  const hp = s.world.cargo.hp / CARGO_HP;
  if (hp > 0.999) return;
  const barW = 240;
  const x = vw / 2 - barW / 2;
  const y = vh - 74;
  panel(ctx, x - 12, y - 22, barW + 24, 46);
  ctx.font = `900 12px ${FONT}`;
  ctx.fillStyle = hp < 0.34 ? '#ff4d6d' : '#8c97b6';
  ctx.textAlign = 'center';
  ctx.fillText(hp < 0.34 ? 'THE CRATE IS ABOUT TO GO' : 'CRATE CONDITION', vw / 2, y - 6);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y + 2, barW, 10);
  ctx.fillStyle = hp > 0.6 ? '#6ee787' : hp > 0.3 ? '#ffb03a' : '#ff4d6d';
  ctx.fillRect(x, y + 2, barW * hp, 10);
}


/**
 * "You are both here, the crate is not."
 *
 * A run does not finish until the load is up here too, and a pair standing on
 * the goal watching nothing happen deserves to be told which of them is
 * missing rather than left to guess. Drawn from the same two predicates the
 * simulation finishes on, so the message can never disagree with the rule.
 */
function drawCargoCall(ctx: CanvasRenderingContext2D, vw: number, vh: number, s: HudState): void {
  if (s.world.finished) return;
  if (!pairAtGoal(s.world, s.level) || cargoAtGoal(s.world, s.level)) return;

  const rows = Math.max(0, Math.round((s.world.cargo.y - s.level.goalY) / TILE));
  // A destroyed crate has already sent the simulation back to the checkpoint by
  // the time this is drawn, so the line reports what is happening rather than
  // asking for a restart. Copy that instructs the player to start something
  // that is under way while they read it is worse than no copy at all.
  const dead = s.world.cargo.hp <= 0;
  const text = dead ? 'THE CRATE IS GONE — BACK TO THE CHECKPOINT' : 'BRING THE CRATE UP';
  const under = dead ? '' : rows > 0 ? `still ${rows} row${rows === 1 ? '' : 's'} below` : 'almost there';

  const y = vh / 2 - 96;
  ctx.font = `900 22px ${FONT}`;
  const w = Math.max(300, ctx.measureText(text).width + 56);
  panel(ctx, vw / 2 - w / 2, y - 30, w, under ? 74 : 50);
  ctx.textAlign = 'center';
  ctx.fillStyle = dead ? '#ff4d6d' : '#ffd166';
  ctx.fillText(text, vw / 2, y);
  if (under) {
    ctx.font = `600 13px ${FONT}`;
    ctx.fillStyle = '#8c97b6';
    ctx.fillText(under, vw / 2, y + 26);
  }
  ctx.textAlign = 'left';
}

function drawRestartVote(ctx: CanvasRenderingContext2D, vw: number, vh: number, s: HudState): void {
  const held = Math.min(s.world.players[0].restartHeld, s.world.players[1].restartHeld);
  const any = Math.max(s.world.players[0].restartHeld, s.world.players[1].restartHeld);
  if (any <= 2) return;
  const frac = Math.min(1, held / RESTART_HOLD);
  const anyFrac = Math.min(1, any / RESTART_HOLD);
  const barW = 300;
  const x = vw / 2 - barW / 2;
  const y = vh / 2 + 120;
  panel(ctx, x - 14, y - 26, barW + 28, 54);
  ctx.font = `900 13px ${FONT}`;
  ctx.textAlign = 'center';
  ctx.fillStyle = '#ffd166';
  const label =
    held > 0
      ? 'RESTARTING AT CHECKPOINT…'
      : s.soloRestart
        ? 'HOLD TO RESTART AT CHECKPOINT'
        : 'BOTH OF YOU MUST HOLD RESTART';
  ctx.fillText(label, vw / 2, y - 8);
  ctx.textAlign = 'left';
  ctx.fillStyle = 'rgba(0,0,0,0.5)';
  ctx.fillRect(x, y, barW, 12);
  ctx.fillStyle = 'rgba(255,209,102,0.3)';
  ctx.fillRect(x, y, barW * anyFrac, 12);
  ctx.fillStyle = '#ffd166';
  ctx.fillRect(x, y, barW * frac, 12);
}

function drawNetgraph(ctx: CanvasRenderingContext2D, vw: number, net: NonNullable<HudState['net']>): void {
  const w = 200;
  const x = vw - w - 62;
  panel(ctx, x, 16, w, 96);
  ctx.font = `700 12px ${FONT}`;
  ctx.textBaseline = 'alphabetic';
  const rows: [string, string, string][] = [
    ['PING', `${Math.round(net.rtt)} ms`, net.rtt < 90 ? '#6ee787' : net.rtt < 180 ? '#ffb03a' : '#ff4d6d'],
    ['LEAD', `${net.lead} ticks`, '#8c97b6'],
    ['ROLLBACKS', `${net.rollbacks} (max ${net.worstRollback})`, '#8c97b6'],
    ['RESYNCS', `${net.desyncs}`, net.desyncs > 0 ? '#ff4d6d' : '#8c97b6'],
  ];
  rows.forEach(([label, value, colour], i) => {
    const y = 40 + i * 18;
    ctx.fillStyle = '#5d6787';
    ctx.fillText(label, x + 14, y);
    ctx.fillStyle = colour;
    ctx.textAlign = 'right';
    ctx.fillText(value, x + w - 14, y);
    ctx.textAlign = 'left';
  });
}

function drawHint(ctx: CanvasRenderingContext2D, vw: number, vh: number, s: HudState): void {
  ctx.save();
  ctx.globalAlpha = Math.min(1, s.hintStrength);
  ctx.font = `800 15px ${FONT}`;
  const width = ctx.measureText(s.hint).width + 44;
  const x = vw / 2 - width / 2;
  const y = vh - 132;
  panel(ctx, x, y, width, 40);
  ctx.fillStyle = '#e8ecf7';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(s.hint, vw / 2, y + 21);
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  ctx.restore();
}

/** Nameplates and emote bubbles live in world space, above each player. */
export function drawPlayerTags(
  ctx: CanvasRenderingContext2D,
  s: HudState,
  scale: number,
): void {
  const EMOTES = ['!', '?', '♥', '#$%!'];

  // Stack the tags when the pair stands close.
  //
  // Both used to be drawn at the same height above their own hauler, and this
  // is a game whose two players spend most of it within a rope's length of each
  // other — so the names overlapped constantly, and what a screenshot showed
  // was `LITTLE MA|AUTOHAULER`. Whichever hauler you are not gets lifted a row,
  // so your own name stays where you expect it.
  const labels: string[] = [];
  const widths: number[] = [];
  for (let i = 0; i < 2; i++) {
    labels.push(s.names[i] || (i === 0 ? 'HAULER ONE' : 'HAULER TWO'));
    ctx.font = `900 ${i === s.localIndex ? 13 : 12}px ${FONT}`;
    widths.push(ctx.measureText(labels[i]).width);
  }
  const apartPx = Math.abs(s.world.players[0].x - s.world.players[1].x) * scale;
  const crowded = apartPx < (widths[0] + widths[1]) / 2 + 14;
  const lifted = s.localIndex === 0 ? 1 : 0;

  for (let i = 0; i < 2; i++) {
    const p = s.world.players[i];
    const isLocal = i === s.localIndex;
    const label = labels[i];

    ctx.save();
    ctx.translate(p.x, p.y - 30);
    ctx.scale(1 / scale, 1 / scale);
    ctx.translate(0, crowded && i === lifted ? -21 : 0);
    ctx.font = `900 ${isLocal ? 13 : 12}px ${FONT}`;
    ctx.textAlign = 'center';
    const textW = widths[i];
    ctx.globalAlpha = isLocal ? 0.95 : 0.75;
    ctx.fillStyle = 'rgba(9,12,22,0.7)';
    roundRect(ctx, -textW / 2 - 8, -14, textW + 16, 19, 6);
    ctx.fill();
    ctx.fillStyle = s.colours[i];
    ctx.fillText(label, 0, 0);
    if (isLocal) {
      ctx.fillStyle = s.colours[i];
      ctx.beginPath();
      ctx.moveTo(0, 8);
      ctx.lineTo(-5, 2);
      ctx.lineTo(5, 2);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();

    if (p.emoteTimer > 0) {
      const life = p.emoteTimer / 70;
      ctx.save();
      ctx.translate(p.x + 20, p.y - 40 - (1 - life) * 6);
      ctx.scale(1 / scale, 1 / scale);
      ctx.globalAlpha = Math.min(1, life * 3);
      ctx.fillStyle = '#f4f6ff';
      roundRect(ctx, -26, -22, 52, 34, 10);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-14, 10);
      ctx.lineTo(-22, 20);
      ctx.lineTo(-6, 11);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#12131c';
      ctx.font = `900 18px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(EMOTES[p.emote % EMOTES.length], 0, -4);
      ctx.restore();
    }
  }
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
}

export { formatTime, DT, GRIP_MAX };
