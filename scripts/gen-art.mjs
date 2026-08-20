/**
 * Generate every image the store page and the installers need.
 *
 * The art is drawn with canvas in a headless browser rather than hand-painted,
 * so it regenerates from source at any size, stays consistent with the in-game
 * look, and carries no third-party asset licensing. Steam's required capsule
 * dimensions are listed in STEAM_ASSETS below.
 */
import { chromium } from 'playwright';
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const STORE_DIR = join('steam', 'store');
const ICON_DIR = join('packages', 'desktop', 'build');

/** name, width, height, layout */
const STEAM_ASSETS = [
  ['header-capsule-460x215', 460, 215, 'wide'],
  ['small-capsule-462x174', 462, 174, 'wide'],
  ['main-capsule-616x353', 616, 353, 'wide'],
  ['vertical-capsule-374x448', 374, 448, 'tall'],
  ['page-background-1438x810', 1438, 810, 'scene'],
  ['library-capsule-600x900', 600, 900, 'tall'],
  ['library-header-460x215', 460, 215, 'wide'],
  ['library-hero-3840x1240', 3840, 1240, 'scene'],
  ['library-logo-1280x720', 1280, 720, 'logo'],
  ['screenshot-frame-1920x1080', 1920, 1080, 'scene'],
];

const ICON_SIZES = [32, 64, 128, 256, 512, 1024];

function findChromium() {
  if (process.env.PLAYWRIGHT_CHROMIUM) return process.env.PLAYWRIGHT_CHROMIUM;
  const root = process.env.PLAYWRIGHT_BROWSERS_PATH;
  if (!root || !existsSync(root)) return undefined;
  const candidates = [];
  for (const entry of readdirSync(root)) {
    if (!entry.startsWith('chromium')) continue;
    candidates.push(join(root, entry, 'chrome-linux', 'chrome'));
    candidates.push(join(root, entry, 'chrome-linux', 'headless_shell'));
  }
  return candidates.find((p) => existsSync(p));
}

const PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html,body{margin:0;padding:0;background:transparent;overflow:hidden}
canvas{display:block}
</style></head><body><canvas id="c"></canvas>
<script>
const COL = {
  p1: { main: '#ff7a4d', dark: '#c44a24', light: '#ffb08c' },
  p2: { main: '#4fd6e0', dark: '#1f8f9c', light: '#a5f0f6' },
};

function rr(g, x, y, w, h, r) {
  const rad = Math.min(r, w / 2, h / 2);
  g.beginPath();
  g.moveTo(x + rad, y);
  g.arcTo(x + w, y, x + w, y + h, rad);
  g.arcTo(x + w, y + h, x, y + h, rad);
  g.arcTo(x, y + h, x, y, rad);
  g.arcTo(x, y, x + w, y, rad);
  g.closePath();
}

function hash(n) { let x = Math.sin(n * 127.1) * 43758.5453; return x - Math.floor(x); }

function tower(g, w, h, seed) {
  // Layered scaffolding silhouettes: the tower the whole game is about.
  const layers = [
    { colour: '#141b33', count: 9, alpha: 0.9, scale: 1 },
    { colour: '#1c2542', count: 7, alpha: 0.85, scale: 0.75 },
    { colour: '#243053', count: 5, alpha: 0.8, scale: 0.55 },
  ];
  layers.forEach((layer, li) => {
    g.globalAlpha = layer.alpha;
    g.fillStyle = layer.colour;
    for (let i = 0; i < layer.count; i++) {
      const r = hash(seed + li * 31 + i * 7);
      const bw = w * (0.05 + r * 0.07);
      const x = (i / layer.count) * w + r * w * 0.06;
      const bh = h * (0.35 + hash(seed + i * 13 + li) * 0.65);
      g.fillRect(x, h - bh, bw, bh);
      for (let j = 0; j < 6; j++) {
        const y = h - bh + (j / 6) * bh;
        g.fillRect(x - bw * 0.5, y, bw * 2, Math.max(2, h * 0.006));
      }
    }
  });
  g.globalAlpha = 1;
}

function hauler(g, x, y, s, colour, flip, pose) {
  g.save();
  g.translate(x, y);
  g.scale(flip ? -s : s, s);

  g.strokeStyle = colour.dark;
  g.lineWidth = 4.4;
  g.lineCap = 'round';
  const legSwing = pose === 'dangle' ? 6 : 3;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.moveTo(side * 3.4, 8);
    g.lineTo(side * 3.4 + side * legSwing, 17);
    g.stroke();
  }

  g.fillStyle = colour.main;
  rr(g, -9, -9, 18, 17, 5);
  g.fill();
  g.fillStyle = colour.light;
  g.fillRect(-8, -4, 16, 2.4);
  g.fillStyle = colour.dark;
  g.fillRect(-8, 3, 16, 3);

  g.strokeStyle = colour.light;
  g.lineWidth = 3.4;
  g.beginPath();
  g.moveTo(0, -5);
  g.lineTo(pose === 'dangle' ? 11 : 9, -14);
  g.stroke();
  g.beginPath();
  g.moveTo(0, -5);
  g.lineTo(-8, -1);
  g.stroke();

  const hy = -18;
  g.fillStyle = colour.main;
  g.beginPath();
  g.arc(0, hy, 8.6, 0, Math.PI * 2);
  g.fill();
  g.fillStyle = 'rgba(0,0,0,0.2)';
  g.beginPath();
  g.arc(0, hy + 2.4, 8.6, 0.25, Math.PI - 0.25);
  g.fill();

  g.fillStyle = '#f4f6ff';
  const wide = pose === 'dangle' ? 3.4 : 2.8;
  for (const side of [-1, 1]) {
    g.beginPath();
    g.ellipse(side * 3.6, hy - 1.4, wide * 0.75, wide, 0, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#12131c';
  for (const side of [-1, 1]) {
    g.beginPath();
    g.arc(side * 3.6 + (pose === 'dangle' ? 0.8 : 0), hy - 0.8, 1.35, 0, Math.PI * 2);
    g.fill();
  }
  g.fillStyle = '#12131c';
  if (pose === 'dangle') {
    g.beginPath();
    g.ellipse(0, hy + 4.4, 2.6, 3.1, 0, 0, Math.PI * 2);
    g.fill();
  } else {
    g.strokeStyle = '#12131c';
    g.lineWidth = 1.5;
    g.beginPath();
    g.arc(0, hy + 2.6, 3, 0.2, Math.PI - 0.2);
    g.stroke();
  }

  // Hard hat on the leading hauler for silhouette variety.
  if (pose !== 'dangle') {
    g.fillStyle = '#ffd23d';
    g.beginPath();
    g.arc(0, hy - 3, 8.4, Math.PI, 0);
    g.fill();
    g.fillRect(-11, hy - 4, 22, 2.6);
  }
  g.restore();
}

function crate(g, x, y, s, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.scale(s, s);
  g.fillStyle = 'rgba(0,0,0,0.45)';
  g.fillRect(-11, -10, 26, 24);
  g.fillStyle = '#c08a3e';
  g.fillRect(-13, -12, 26, 24);
  g.fillStyle = '#8a5d24';
  g.fillRect(-13, 8, 26, 4);
  g.fillRect(-13, -12, 26, 3);
  g.fillStyle = '#3a3140';
  g.fillRect(-13, -3, 26, 5);
  g.fillRect(-3, -12, 5, 24);
  g.fillStyle = '#d7c3a0';
  g.fillRect(-4, -4, 7, 7);
  g.strokeStyle = '#2a1c12';
  g.lineWidth = 1.4;
  g.beginPath();
  g.moveTo(-9, -10);
  g.lineTo(-3, 2);
  g.lineTo(-7, 11);
  g.stroke();
  g.restore();
}

function rope(g, ax, ay, bx, by, sag, width) {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2 + sag;
  const stroke = (w, c, o) => {
    g.strokeStyle = c;
    g.lineWidth = w;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(ax, ay + o);
    g.quadraticCurveTo(mx, my + o, bx, by + o);
    g.stroke();
  };
  stroke(width * 1.4, 'rgba(0,0,0,0.5)', width * 0.3);
  stroke(width, '#ffb03a', 0);
  stroke(width * 0.32, 'rgba(255,255,255,0.4)', -width * 0.24);
  return { mx, my };
}

/**
 * Draw the wordmark, shrunk to fit the given maximum width.
 *
 * Capsule art is rendered at ten different aspect ratios and the exact glyph
 * metrics depend on whichever system font is present, so the size is measured
 * rather than assumed — otherwise the logo clips off the edge of the capsule
 * on whatever machine builds the release.
 */
function wordmark(g, cx, cy, size, maxWidth) {
  const text = 'HAULMATES';
  const font = (px) => '900 ' + px + 'px ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
  g.font = font(size);
  g.letterSpacing = (-size * 0.035) + 'px';
  const measured = g.measureText(text).width;
  // Leave room for the outline stroke, which extends past the glyph box.
  const budget = maxWidth * 0.92;
  if (measured > budget) {
    size = Math.max(8, size * (budget / measured));
  }

  g.save();
  g.translate(cx, cy);
  g.rotate(-0.021);
  g.textAlign = 'center';
  g.textBaseline = 'middle';
  g.font = font(size);
  g.letterSpacing = (-size * 0.035) + 'px';

  g.lineJoin = 'round';
  g.lineWidth = size * 0.17;
  g.strokeStyle = '#05070f';
  g.strokeText(text, 0, 0);

  const grad = g.createLinearGradient(0, -size * 0.55, 0, size * 0.55);
  grad.addColorStop(0, '#ffffff');
  grad.addColorStop(0.42, '#ffd23d');
  grad.addColorStop(0.78, '#ff8a3c');
  grad.addColorStop(1, '#e2591b');
  g.fillStyle = grad;
  g.fillText(text, 0, 0);
  g.restore();
}

function draw(w, h, layout) {
  const c = document.getElementById('c');
  c.width = w;
  c.height = h;
  const g = c.getContext('2d');
  g.clearRect(0, 0, w, h);

  if (layout === 'logo') {
    wordmark(g, w / 2, h / 2, Math.min(h * 0.42, w * 0.135), w * 0.9);
    return;
  }

  const sky = g.createLinearGradient(0, 0, 0, h);
  sky.addColorStop(0, '#070b18');
  sky.addColorStop(0.55, '#141c34');
  sky.addColorStop(1, '#1e1330');
  g.fillStyle = sky;
  g.fillRect(0, 0, w, h);

  const glow = g.createRadialGradient(w * 0.5, -h * 0.1, 0, w * 0.5, -h * 0.1, h * 1.25);
  glow.addColorStop(0, 'rgba(255,176,58,0.30)');
  glow.addColorStop(0.45, 'rgba(255,122,77,0.08)');
  glow.addColorStop(1, 'rgba(0,0,0,0)');
  g.fillStyle = glow;
  g.fillRect(0, 0, w, h);

  tower(g, w, h, 7);

  const fog = g.createLinearGradient(0, h * 0.35, 0, h);
  fog.addColorStop(0, 'rgba(0,0,0,0)');
  fog.addColorStop(1, 'rgba(6,9,20,0.85)');
  g.fillStyle = fog;
  g.fillRect(0, 0, w, h);

  // The hero beat: one hauler braced on a ledge, the other swinging off the
  // rope, crate dangling between them.
  const isTall = layout === 'tall';
  const scale = isTall ? w / 190 : Math.min(w / 620, h / 300) * 1.5;
  const cy = isTall ? h * 0.60 : h * 0.58;
  const ax = isTall ? w * 0.27 : w * 0.60;
  const bx = isTall ? w * 0.75 : w * 0.85;
  const ay = cy;
  const by = cy - 26 * scale;

  g.fillStyle = '#2a3149';
  g.fillRect(ax - 34 * scale, ay + 17 * scale, 62 * scale, 12 * scale);
  g.fillStyle = '#7c88bd';
  g.fillRect(ax - 34 * scale, ay + 17 * scale, 62 * scale, 3 * scale);

  const mid = rope(g, ax, ay - 5 * scale, bx, by - 5 * scale, 34 * scale, 5.5 * scale);
  g.strokeStyle = '#8a6c2c';
  g.lineWidth = 2.6 * scale;
  g.beginPath();
  g.moveTo(mid.mx, mid.my);
  g.lineTo(mid.mx - 3 * scale, mid.my + 20 * scale);
  g.stroke();
  crate(g, mid.mx - 3 * scale, mid.my + 32 * scale, scale, 0.24);

  hauler(g, ax, ay, scale, COL.p1, false, 'brace');
  hauler(g, bx, by, scale, COL.p2, true, 'dangle');

  const vig = g.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.3, w / 2, h / 2, Math.max(w, h) * 0.75);
  vig.addColorStop(0, 'rgba(0,0,0,0)');
  vig.addColorStop(1, 'rgba(0,0,0,0.6)');
  g.fillStyle = vig;
  g.fillRect(0, 0, w, h);

  if (layout === 'wide') {
    wordmark(g, w * 0.35, h * 0.40, Math.min(h * 0.30, w * 0.11), w * 0.64);
    g.font = '800 ' + Math.max(9, h * 0.05) + 'px ui-sans-serif, system-ui, Arial, sans-serif';
    g.letterSpacing = '1px';
    g.fillStyle = '#b9c3e0';
    g.textAlign = 'center';
    g.fillText('TWO PLAYERS · ONE ROPE', w * 0.35, h * 0.62);
    g.letterSpacing = '0px';
  } else if (layout === 'tall') {
    wordmark(g, w / 2, h * 0.16, Math.min(w * 0.16, h * 0.09), w * 0.88);
    g.font = '800 ' + Math.max(10, w * 0.042) + 'px ui-sans-serif, system-ui, Arial, sans-serif';
    g.fillStyle = '#b9c3e0';
    g.textAlign = 'center';
    g.fillText('TWO PLAYERS · ONE ROPE', w / 2, h * 0.245);
  } else if (layout === 'scene') {
    wordmark(g, w * 0.5, h * 0.20, Math.min(h * 0.16, w * 0.075), w * 0.7);
  }
}

function icon(size) {
  const c = document.getElementById('c');
  c.width = size;
  c.height = size;
  const g = c.getContext('2d');
  g.clearRect(0, 0, size, size);
  const s = size / 64;

  const bg = g.createLinearGradient(0, 0, 0, size);
  bg.addColorStop(0, '#1b2340');
  bg.addColorStop(1, '#0a0e1c');
  g.fillStyle = bg;
  rr(g, 0, 0, size, size, size * 0.19);
  g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.10)';
  g.lineWidth = size * 0.02;
  rr(g, size * 0.01, size * 0.01, size * 0.98, size * 0.98, size * 0.19);
  g.stroke();

  const ax = size * 0.26;
  const bx = size * 0.74;
  const y = size * 0.40;
  rope(g, ax, y, bx, y, size * 0.28, size * 0.075);
  crate(g, size * 0.5, size * 0.70, s * 0.62, 0.16);
  hauler(g, ax, y + size * 0.02, s * 0.72, COL.p1, false, 'brace');
  hauler(g, bx, y + size * 0.02, s * 0.72, COL.p2, true, 'brace');
}

window.renderAsset = (w, h, layout) => draw(w, h, layout);
window.renderIcon = (size) => icon(size);
</script></body></html>`;

/* --------------------------------------------------------- icon containers */

/** Minimal ICO writer. Windows accepts PNG payloads for every modern size. */
function buildIco(images) {
  const count = images.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);
  const entries = Buffer.alloc(16 * count);
  let offset = 6 + 16 * count;
  images.forEach((img, i) => {
    const base = i * 16;
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, base);
    entries.writeUInt8(img.size >= 256 ? 0 : img.size, base + 1);
    entries.writeUInt8(0, base + 2);
    entries.writeUInt8(0, base + 3);
    entries.writeUInt16LE(1, base + 4);
    entries.writeUInt16LE(32, base + 6);
    entries.writeUInt32LE(img.data.length, base + 8);
    entries.writeUInt32LE(offset, base + 12);
    offset += img.data.length;
  });
  return Buffer.concat([header, entries, ...images.map((i) => i.data)]);
}

/** Minimal ICNS writer: a magic header followed by typed PNG chunks. */
function buildIcns(images) {
  const TYPES = { 128: 'ic07', 256: 'ic08', 512: 'ic09', 1024: 'ic10' };
  const chunks = [];
  for (const img of images) {
    const type = TYPES[img.size];
    if (!type) continue;
    const header = Buffer.alloc(8);
    header.write(type, 0, 4, 'ascii');
    header.writeUInt32BE(img.data.length + 8, 4);
    chunks.push(Buffer.concat([header, img.data]));
  }
  const body = Buffer.concat(chunks);
  const head = Buffer.alloc(8);
  head.write('icns', 0, 4, 'ascii');
  head.writeUInt32BE(body.length + 8, 4);
  return Buffer.concat([head, body]);
}

/* ------------------------------------------------------------------- main */

mkdirSync(STORE_DIR, { recursive: true });
mkdirSync(ICON_DIR, { recursive: true });

const browser = await chromium.launch({ headless: true, executablePath: findChromium(), args: ['--force-device-scale-factor=1'] });
const page = await browser.newPage({ viewport: { width: 400, height: 400 }, deviceScaleFactor: 1 });
await page.setContent(PAGE, { waitUntil: 'load' });

for (const [name, w, h, layout] of STEAM_ASSETS) {
  await page.setViewportSize({ width: Math.min(w, 3840), height: Math.min(h, 2160) });
  await page.evaluate(([w2, h2, l]) => window.renderAsset(w2, h2, l), [w, h, layout]);
  const buffer = await page.locator('#c').screenshot({ omitBackground: layout === 'logo' });
  const file = join(STORE_DIR, `${name}.png`);
  writeFileSync(file, buffer);
  console.log(`  ${file}  ${w}x${h}`);
}

const iconImages = [];
for (const size of ICON_SIZES) {
  await page.setViewportSize({ width: Math.max(size, 64), height: Math.max(size, 64) });
  await page.evaluate((s) => window.renderIcon(s), size);
  const buffer = await page.locator('#c').screenshot({ omitBackground: true });
  iconImages.push({ size, data: buffer });
  if (size === 512) writeFileSync(join(ICON_DIR, 'icon.png'), buffer);
  if (size === 256) writeFileSync(join(STORE_DIR, 'icon-256.png'), buffer);
  if (size === 32) writeFileSync(join(STORE_DIR, 'client-icon-32.png'), buffer);
  console.log(`  icon ${size}x${size}`);
}

writeFileSync(join(ICON_DIR, 'icon.ico'), buildIco(iconImages.filter((i) => i.size <= 256)));
writeFileSync(join(ICON_DIR, 'icon.icns'), buildIcns(iconImages.filter((i) => i.size >= 128)));
console.log(`  ${join(ICON_DIR, 'icon.ico')}`);
console.log(`  ${join(ICON_DIR, 'icon.icns')}`);

await browser.close();
console.log(`\nStore art in ${STORE_DIR}/ and installer icons in ${ICON_DIR}/`);
