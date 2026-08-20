import { VIEW_MAX_H, VIEW_MIN_H, type Level, type World } from '@haulmates/core';

/**
 * Framing for two players tied together: the camera tracks the midpoint and
 * zooms out far enough to keep both of them, and the crate, on screen. If a
 * player is off screen they cannot help — so the zoom is gameplay, not polish.
 */
export class Camera {
  x = 0;
  y = 0;
  viewH = 700;
  private shakeAmount = 0;
  private shakeSeed = 1;
  shakeX = 0;
  shakeY = 0;
  /** Multiplier from the settings screen; 0 disables shake entirely. */
  shakeScale = 1;
  private initialised = false;

  snapTo(world: World): void {
    const [a, b] = world.players;
    this.x = (a.x + b.x) * 0.5;
    this.y = (a.y + b.y) * 0.5;
    this.initialised = true;
  }

  kick(amount: number): void {
    this.shakeAmount = Math.min(34, this.shakeAmount + amount);
  }

  update(dt: number, world: World, level: Level, aspect: number): void {
    const [a, b] = world.players;
    const cargo = world.cargo;
    const midX = (a.x + b.x) * 0.5;
    // Bias upward: in a climbing game the interesting space is above you.
    const midY = (a.y + b.y) * 0.5 - 40;

    const spanX = Math.abs(a.x - b.x);
    const spanY = Math.max(Math.abs(a.y - b.y), Math.abs(cargo.y - midY) * 1.2);
    const neededByHeight = spanY * 2.3 + 340;
    const neededByWidth = (spanX * 2.1 + 420) / Math.max(0.6, aspect);
    const targetView = Math.max(VIEW_MIN_H, Math.min(VIEW_MAX_H, Math.max(neededByHeight, neededByWidth)));

    if (!this.initialised) {
      this.x = midX;
      this.y = midY;
      this.viewH = targetView;
      this.initialised = true;
    }

    // Frame-rate independent exponential smoothing.
    const follow = 1 - Math.pow(0.0007, dt);
    const zoom = 1 - Math.pow(0.02, dt);
    this.x += (midX - this.x) * follow;
    this.y += (midY - this.y) * follow;
    this.viewH += (targetView - this.viewH) * zoom;

    const viewW = this.viewH * aspect;
    // Keep the shaft framed: if the view is wider than the level, centre it.
    if (viewW >= level.widthPx) this.x = level.widthPx / 2;
    else this.x = Math.max(viewW / 2, Math.min(level.widthPx - viewW / 2, this.x));
    const slack = this.viewH * 0.35;
    this.y = Math.max(-slack, Math.min(level.heightPx + slack, this.y));

    this.shakeAmount *= Math.pow(0.0025, dt);
    if (this.shakeAmount < 0.05) this.shakeAmount = 0;
    const strength = this.shakeAmount * this.shakeScale;
    if (strength > 0) {
      this.shakeSeed = (this.shakeSeed * 1103515245 + 12345) & 0x7fffffff;
      const r1 = (this.shakeSeed / 0x7fffffff) * 2 - 1;
      this.shakeSeed = (this.shakeSeed * 1103515245 + 12345) & 0x7fffffff;
      const r2 = (this.shakeSeed / 0x7fffffff) * 2 - 1;
      this.shakeX = r1 * strength;
      this.shakeY = r2 * strength;
    } else {
      this.shakeX = 0;
      this.shakeY = 0;
    }
  }

  /** World units per screen pixel, for the current canvas height. */
  scaleFor(canvasH: number): number {
    return canvasH / this.viewH;
  }

  /** Apply the world transform. Callers pair this with ctx.save/restore. */
  apply(ctx: CanvasRenderingContext2D, canvasW: number, canvasH: number): number {
    const scale = this.scaleFor(canvasH);
    ctx.translate(canvasW / 2 + this.shakeX, canvasH / 2 + this.shakeY);
    ctx.scale(scale, scale);
    ctx.translate(-this.x, -this.y);
    return scale;
  }

  /** Visible world rectangle, used to cull everything off screen. */
  bounds(canvasW: number, canvasH: number, pad = 64): { x0: number; y0: number; x1: number; y1: number } {
    const scale = this.scaleFor(canvasH);
    const halfW = canvasW / 2 / scale;
    const halfH = canvasH / 2 / scale;
    return {
      x0: this.x - halfW - pad,
      y0: this.y - halfH - pad,
      x1: this.x + halfW + pad,
      y1: this.y + halfH + pad,
    };
  }
}
