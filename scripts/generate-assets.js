/**
 * Generates app icon (1024x1024) and splash screen (1024x1024) PNGs.
 * Run with: node scripts/generate-assets.js
 */
const { Jimp } = require('jimp');
const path = require('path');

const RED = 0xCC0000FF;
const WHITE = 0xFFFFFFFF;
const DARK_RED = 0x990000FF;

async function fillRect(img, x, y, w, h, color) {
  for (let px = x; px < x + w; px++) {
    for (let py = y; py < y + h; py++) {
      img.setPixelColor(color, px, py);
    }
  }
}

async function fillCircle(img, cx, cy, r, color) {
  for (let px = cx - r; px <= cx + r; px++) {
    for (let py = cy - r; py <= cy + r; py++) {
      if ((px - cx) ** 2 + (py - cy) ** 2 <= r ** 2) {
        img.setPixelColor(color, px, py);
      }
    }
  }
}

async function roundedRect(img, x, y, w, h, r, color) {
  // Fill main body
  await fillRect(img, x + r, y, w - 2 * r, h, color);
  await fillRect(img, x, y + r, w, h - 2 * r, color);
  // Fill corners
  await fillCircle(img, x + r,     y + r,     r, color);
  await fillCircle(img, x + w - r, y + r,     r, color);
  await fillCircle(img, x + r,     y + h - r, r, color);
  await fillCircle(img, x + w - r, y + h - r, r, color);
}

async function generateIcon() {
  const SIZE = 1024;
  const img = new Jimp({ width: SIZE, height: SIZE, color: RED });

  // Subtle gradient effect — darker red at bottom
  for (let y = 0; y < SIZE; y++) {
    const factor = 1 - (y / SIZE) * 0.25;
    const r = Math.round(0xCC * factor);
    const g = 0x00;
    const b = 0x00;
    const color = (((r << 24) | (g << 16) | (b << 8) | 0xFF) >>> 0);
    for (let x = 0; x < SIZE; x++) {
      img.setPixelColor(color, x, y);
    }
  }

  // Brick body — white rounded rectangle
  const brickX = 192, brickY = 380, brickW = 640, brickH = 300, brickR = 48;
  await roundedRect(img, brickX, brickY, brickW, brickH, brickR, WHITE);

  // Studs — two white circles on top of brick
  const studR = 90;
  const studY = brickY - studR + 20;
  await fillCircle(img, 320, studY, studR, WHITE);
  await fillCircle(img, 704, studY, studR, WHITE);

  // Stud inner shadows (slightly darker circles inside studs)
  const innerR = 68;
  const shadowColor = 0xEEEEEEFF;
  await fillCircle(img, 320, studY, innerR, shadowColor);
  await fillCircle(img, 704, studY, innerR, shadowColor);

  await img.write(path.join(__dirname, '../assets/icon.png'));
  console.log('✓ icon.png generated (1024x1024)');
}

async function generateSplash() {
  const SIZE = 1024;
  const img = new Jimp({ width: SIZE, height: SIZE, color: RED });

  // Gradient background
  for (let y = 0; y < SIZE; y++) {
    const factor = 1 - (y / SIZE) * 0.3;
    const r = Math.round(0xCC * factor);
    const color = (((r << 24) | (0x00 << 16) | (0x00 << 8) | 0xFF) >>> 0);
    for (let x = 0; x < SIZE; x++) {
      img.setPixelColor(color, x, y);
    }
  }

  // Centered brick logo (smaller)
  const s = 0.55; // scale
  const ox = Math.round(SIZE / 2 - (640 * s) / 2);
  const oy = Math.round(SIZE / 2 - (300 * s) / 2) + 30;

  const brickW = Math.round(640 * s), brickH = Math.round(300 * s), brickR = Math.round(48 * s);
  await roundedRect(img, ox, oy, brickW, brickH, brickR, WHITE);

  const studR = Math.round(90 * s);
  const studY = oy - studR + Math.round(20 * s);
  await fillCircle(img, ox + Math.round(128 * s), studY, studR, WHITE);
  await fillCircle(img, ox + Math.round(512 * s), studY, studR, WHITE);

  const innerR = Math.round(68 * s);
  const shadowColor = 0xEEEEEEFF;
  await fillCircle(img, ox + Math.round(128 * s), studY, innerR, shadowColor);
  await fillCircle(img, ox + Math.round(512 * s), studY, innerR, shadowColor);

  await img.write(path.join(__dirname, '../assets/splash-icon.png'));
  console.log('✓ splash-icon.png generated (1024x1024)');
}

async function generateAdaptiveIcon() {
  // Android adaptive icon foreground — brick on transparent bg
  const SIZE = 1024;
  const TRANSPARENT = 0x00000000;
  const img = new Jimp({ width: SIZE, height: SIZE, color: TRANSPARENT });

  const brickX = 192, brickY = 380, brickW = 640, brickH = 300, brickR = 48;
  await roundedRect(img, brickX, brickY, brickW, brickH, brickR, WHITE);

  const studR = 90, studY = brickY - studR + 20;
  await fillCircle(img, 320, studY, studR, WHITE);
  await fillCircle(img, 704, studY, studR, WHITE);
  await fillCircle(img, 320, studY, 68, 0xEEEEEEFF);
  await fillCircle(img, 704, studY, 68, 0xEEEEEEFF);

  await img.write(path.join(__dirname, '../assets/adaptive-icon.png'));
  console.log('✓ adaptive-icon.png generated (1024x1024, transparent bg)');
}

(async () => {
  console.log('Generating Brick ID assets...\n');
  await Promise.all([generateIcon(), generateSplash(), generateAdaptiveIcon()]);
  console.log('\nDone! Assets written to assets/');
})();
