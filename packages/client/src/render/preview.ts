import { PLAYER_BODY, PLAYER_COLOURS } from './palette.js';
import { roundRect } from './actors.js';

/**
 * A standalone character portrait for the lobby and cosmetics screens.
 *
 * It re-implements the body rather than borrowing the in-game drawing code,
 * because the portrait wants a clean idle pose and a fixed camera rather than
 * whatever the simulation is currently doing to the poor thing. That is a fair
 * trade and it has a standing cost, which came due: the two drawings drifted,
 * and the portrait ended up painting a bright orange *person* where the game
 * draws a dark one in an orange vest. Anything changed in `drawPlayer`'s
 * costume has to be changed here too, and the test that compares them is a
 * person looking at the customise screen and then at the spawn.
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

  ctx.strokeStyle = PLAYER_BODY;
  ctx.lineWidth = 4.4;
  ctx.lineCap = 'round';
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(side * 3.4, -8);
    ctx.lineTo(side * 4, 0);
    ctx.stroke();
  }

  // A dark body wearing a hi-vis vest, not a coloured body.
  //
  // This is the whole costume gag in the game and the portrait was not in on
  // it: it painted the whole torso and the whole head in the player's colour,
  // so the character on the customise screen was a bright orange person and the
  // one who then walked out of the spawn was a near-black one in an orange
  // vest. Different character, same screen, one click apart — and the picture
  // is the only reason anybody presses a colour swatch at all.
  ctx.fillStyle = PLAYER_BODY;
  roundRect(ctx, -9, -25, 18, 17, 5);
  ctx.fill();
  ctx.fillStyle = style.main;
  ctx.fillRect(-8, -23.5, 16, 13);
  ctx.fillStyle = style.dark;
  ctx.fillRect(-8, -13, 16, 2.5);
  // The two retroreflective bands, always white, always the brightest thing on
  // the body. At a distance they are what you actually track in the game.
  ctx.fillStyle = style.light;
  ctx.fillRect(-8, -21.6, 16, 2.2);
  ctx.fillRect(-8, -16.6, 16, 2.2);

  ctx.strokeStyle = PLAYER_BODY;
  ctx.lineWidth = 3.4;
  for (const side of [-1, 1]) {
    ctx.beginPath();
    ctx.moveTo(0, -21);
    ctx.lineTo(side * 8, -16 + Math.sin(time * 2.2 + side) * 1.5);
    ctx.stroke();
  }

  const headY = -34;
  ctx.fillStyle = PLAYER_BODY;
  ctx.beginPath();
  ctx.arc(0, headY, 8.6, 0, Math.PI * 2);
  ctx.fill();
  // A light rim rather than a dark one: on a near-black head, shading down is
  // invisible and shading up is what gives it a form. Same as in the game.
  ctx.fillStyle = 'rgba(255,255,255,0.12)';
  ctx.beginPath();
  ctx.arc(0, headY - 2.2, 8.6, Math.PI + 0.25, -0.25);
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
