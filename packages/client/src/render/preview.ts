import { PLAYER_COLOURS } from './palette.js';
import { roundRect } from './actors.js';

/**
 * A standalone character portrait for the lobby and cosmetics screens. It
 * deliberately re-implements the body rather than borrowing the in-game
 * drawing code, because the portrait wants a clean idle pose and a fixed
 * camera, not whatever the simulation is currently doing to the poor thing.
 */
export function drawCharacterPreview(
  canvas: HTMLCanvasElement,
  colourIndex: number,
  hat: number,
  time: number,
  drawHat: (ctx: CanvasRenderingContext2D, hat: number, hx: number, hy: number, time: number, style: { main: string; dark: string; light: string }) => void,
): void {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  const dpr = Math.min(window.devicePixelRatio || 1, 2);
  const w = 108;
  const h = 128;
  if (canvas.width !== w * dpr) {
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;
  }
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  ctx.clearRect(0, 0, w, h);

  const style = PLAYER_COLOURS[colourIndex % PLAYER_COLOURS.length];
  const bob = Math.sin(time * 2.2) * 2.4;

  ctx.save();
  ctx.translate(w / 2, h - 26 + bob);
  ctx.scale(2.1, 2.1);

  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.beginPath();
  ctx.ellipse(0, 1, 10, 3, 0, 0, Math.PI * 2);
  ctx.fill();

  ctx.strokeStyle = style.dark;
  ctx.lineWidth = 4.4;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 3.4, -8);
    ctx.lineTo(side * 4, 0);
    ctx.stroke();
  }

  ctx.fillStyle = style.main;
  roundRect(ctx, -9, -25, 18, 17, 5);
  ctx.fill();
  ctx.fillStyle = style.light;
  ctx.fillRect(-8, -20, 16, 2.4);
  ctx.fillStyle = style.dark;
  ctx.fillRect(-8, -13, 16, 3);

  ctx.strokeStyle = style.light;
  ctx.lineWidth = 3.4;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, -21);
    ctx.lineTo(side * 8, -16 + Math.sin(time * 2.2 + side) * 1.5);
    ctx.stroke();
  }

  const headY = -34;
  ctx.fillStyle = style.main;
  ctx.beginPath();
  ctx.arc(0, headY, 8.6, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = 'rgba(0,0,0,0.2)';
  ctx.beginPath();
  ctx.arc(0, headY + 2.4, 8.6, 0.25, Math.PI - 0.25);
  ctx.fill();

  if (hat !== 5) {
    ctx.fillStyle = '#f4f6ff';
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.ellipse(side * 3.6, headY - 1.4, 2.2, 2.9, 0, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.fillStyle = '#12131c';
    const look = Math.sin(time * 0.9) * 1.1;
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.arc(side * 3.6 + look, headY - 1.4, 1.35, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.strokeStyle = '#12131c';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.arc(0, headY + 2.6, 3, 0.2, Math.PI - 0.2);
    ctx.stroke();
  }
  drawHat(ctx, hat, 0, headY, time, style);
  ctx.restore();
}
