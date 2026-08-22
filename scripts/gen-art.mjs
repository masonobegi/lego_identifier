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
// The achievement icons are named after the API names Steamworks is configured
// with, so they are read from the same list the game evaluates and the config
// generator writes. A second, hand-kept list here is how a store ends up with
// an icon for an achievement that no longer exists and none for the one added
// last week. Requires `npm run build` first, same as npm run steam:config.
import { ACHIEVEMENT_DEFS } from '../packages/core/dist/index.js';

const STORE_DIR = join('steam', 'store');
const ACHIEVEMENT_DIR = join(STORE_DIR, 'achievements');
const ICON_DIR = join('packages', 'desktop', 'build');

/** Steam renders achievement icons at exactly this, in the overlay and the profile. */
const ACHIEVEMENT_ICON = 64;

/** name, width, height, layout */
const STEAM_ASSETS = [
  ['header-capsule-460x215', 460, 215, 'wide'],
  // Drawn from the thumbnail design, not shrunk from the wide one: this is
  // the size a shopper actually sees in a list, and a scaled-down capsule is mud.
  ['small-capsule-462x174', 462, 174, 'thumb'],
  ['main-capsule-616x353', 616, 353, 'wide'],
  ['vertical-capsule-374x448', 374, 448, 'tall'],
  // The three below are 16:9, 3.1:1 and 16:9 again, and Steam puts each behind
  // something else. They get a design apiece rather than sharing the capsule's:
  // one composition stretched over all three shapes leaves the widest of them
  // half empty and the tallest cropped through the figures.
  ['page-background-1438x810', 1438, 810, 'background'],
  ['library-capsule-600x900', 600, 900, 'tall'],
  ['library-header-460x215', 460, 215, 'wide'],
  ['library-hero-3840x1240', 3840, 1240, 'hero'],
  ['library-logo-1280x720', 1280, 720, 'logo'],
  ['screenshot-frame-1920x1080', 1920, 1080, 'shot'],
];

const ICON_SIZES = [32, 64, 128, 256, 512, 1024];

/**
 * The initials of an achievement's display name, or the first two letters when
 * the name is a single word.
 *
 * Every achievement in ACHIEVEMENT_DEFS has a pictogram drawn for it by hand.
 * This is the plate an achievement added to core but not yet drawn falls back
 * to, so a badge can never come out blank; two of them landing on the same
 * initials, as Ten and Twenty Floors Up do, is the sign that the drawing is
 * the thing that was missed.
 */
function achievementMark(name) {
  const words = name.split(/\s+/).filter(Boolean);
  if (words.length === 1) return words[0].slice(0, 2).toUpperCase();
  return words.slice(0, 3).map((w) => w[0]).join('').toUpperCase();
}

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

/* ------------------------------------------------------------- palette */
const P = {
  paper: '#F4EFE2',
  haze: '#E4DCC8',
  far: '#DED5C1',
  mid: '#CEC3AB',
  near: '#B9AC90',
  livery: ['#1C6E9E', '#A63B1E', '#5C7A3A', '#C9C2B2'],
  tileBody: '#C6BCA6',
  tileTop: '#F0EADA',
  tileDetail: '#AFA48C',
  ink: '#1B1714',
  hazA: '#F2B01C',
  hazB: '#1B1714',
  chalk: '#FFFDF6',
  dust: '#8E8067',
  red: '#D6301C',
  cargo: '#E8DCC0',
  cargoDark: '#B49B6E',
  shadow: 'rgba(46,38,28,0.20)',
};
const FONT = 'ui-sans-serif, system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif';
const font = (px) => \`900 \${px}px \${FONT}\`;

// The two vests, shared by the capsule figures and the badge figures: a player
// learns which hauler is which from the store page before he ever presses a
// key, and an achievement in the wrong colours is a third character.
const VEST = {
  orange: { main: '#FF6A00', dark: '#B23F00' },
  lime: { main: '#C8E82A', dark: '#7E9A0F' },
};

/* ------------------------------------------------------------- helpers */
function hash(i) {
  let h = (i * 374761393) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

function chevron(ctx, size) {
  const t = document.createElement('canvas');
  t.width = size;
  t.height = size;
  const c = t.getContext('2d');
  c.fillStyle = P.hazA;
  c.fillRect(0, 0, size, size);
  c.fillStyle = P.hazB;
  c.beginPath();
  c.moveTo(0, size); c.lineTo(size / 2, size); c.lineTo(size, size / 2); c.lineTo(size, 0);
  c.closePath(); c.fill();
  c.beginPath();
  c.moveTo(0, size / 2); c.lineTo(size / 2, 0); c.lineTo(0, 0);
  c.closePath(); c.fill();
  return ctx.createPattern(t, 'repeat');
}

/**
 * A stencil mark on its own canvas, with the bridges punched through as real
 * holes (destination-out) rather than painted over. Painting them would put
 * sky-coloured bars onto the tower, and the holes are what stop a glyph
 * reading as ordinary text.
 */
function stencil(text, size, colour, tracking, bridges) {
  const tr = tracking === undefined ? size * 0.06 : tracking;
  const off = document.createElement('canvas');
  const probe = off.getContext('2d');
  probe.font = font(size);
  const chars = text.split('');
  const ws = chars.map((ch) => probe.measureText(ch).width);
  const total = ws.reduce((a, b) => a + b, 0) + tr * (chars.length - 1);
  const m = probe.measureText(text);
  const asc = m.actualBoundingBoxAscent || size * 0.72;
  const dsc = m.actualBoundingBoxDescent || 0;
  const pad = Math.ceil(size * 0.2) + 2;
  off.width = Math.ceil(total) + pad * 2;
  off.height = Math.ceil(asc + dsc) + pad * 2;
  const c = off.getContext('2d');
  c.font = font(size);
  c.textBaseline = 'alphabetic';
  c.fillStyle = colour;
  let x = pad;
  for (let i = 0; i < chars.length; i++) {
    c.fillText(chars[i], x, pad + asc);
    x += ws[i] + tr;
  }
  if (bridges !== false && asc > 22) {
    c.globalCompositeOperation = 'destination-out';
    const bw = Math.max(1.4, asc * 0.048);
    c.fillRect(0, pad + asc * 0.34, off.width, bw);
    c.fillRect(0, pad + asc * 0.665, off.width, bw);
    c.globalCompositeOperation = 'source-over';
  }
  return { canvas: off, pad, asc, capW: total };
}

function render([mode, W, H]) {
  const canvas = document.getElementById('c');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // Steam's library logo is the wordmark alone on transparency, laid over the
  // hero image the client already has. Everything below is skipped for it.
  const logoOnly = mode === 'logo';

  /* ---------------------------------------------------------------- poses */
  // Local figure units: torso 27 tall, shoulders at -23, an arm reaches ~26.
  const BRACE_LEGS = [[8, 24, 13, 12], [-31, 24, -17, 19]];
  const BRACE_HANDS = [{ h: [26, -14], e: [14, -21] }, { h: [-5, 5], e: [4, -11] }];
  const FLY_LEGS = [[2, 33, -3, 18], [25, 9, 12, 17]];
  const FLY_HANDS = [{ h: [20, -42], e: [16, -30] }, { h: [-22, -14], e: [-14, -23] }];

  /* --------------------------------------------------------------- layout */
  /**
   * The composition, fitted to whatever canvas Steam has asked for.
   *
   * Six compositions, authored at a fixed size apiece. Three are capsules —
   * 616x353 wide, 374x448 tall, and 231x87 for the thumbnail, which is drawn
   * rather than shrunk because a scaled-down capsule is mud — and every capsule
   * Steam asks for is one of those three fitted into the frame and centred, at
   * a uniform scale so the figures never stretch. The other three are the page
   * background, the library hero and the screenshot frame, whose proportions
   * (16:9, 3.1:1, 16:9) and jobs have nothing to do with a capsule's: each is
   * authored at half or a third of its delivered size and fits exactly.
   *
   * Two rules keep the fit from tearing the picture. Anything the design ran
   * off the edge on purpose — the girders, the tower — is pinned back to the
   * new edge rather than scaled inward, or a wide canvas would show a girder
   * stopping in mid-air. And the background is painted from the target's own
   * width and height, so the area the composition does not reach is more yard
   * rather than a letterbox.
   */
  // girders[0] is the ledge the braced hauler stands on: his heels, the dust he
  // is dragging off it and his cast shadow are all placed from it, so a design
  // that lists some other girder first drops him into thin air.
  const DESIGNS = {
    wide: {
      W: 616,
      H: 353,
      detail: 2,
      cranes: 3,
      figures: true,
      wm: { cx: 308, top: 13, capH: 52, maxW: 554, sub: 'A TWO-PLAYER CO-OP DISASTER' },
      hazeY: 0.73,
      yardTop: 0.93,
      tower: { x1: 168 },
      girders: [
        { x0: -8, x1: 300, y: 258, h: 22 },
        { x0: -8, x1: 208, y: 332, h: 19, mark: 'NO STEP' },
        { x0: -8, x1: 128, y: 122, h: 18 },
        { x0: 516, x1: 624, y: 322, h: 19, mark: 'SWL 2.5t' },
      ],
      numeral: { text: '7', cx: 76, cy: 240, h: 176 },
      anchor: { px: 208, py: 210, s: 2.15, rot: -0.42 },
      flyer: { px: 502, py: 238, s: 2.0, rot: -0.32 },
      sag: 44,
      crate: { w: 78, h: 62, rot: 0.14, drop: 0.1, t: 0.5 },
      ropeW: 3.1,
    },
    tall: {
      W: 374,
      H: 448,
      detail: 2,
      cranes: 3,
      figures: true,
      wm: { cx: 187, top: 17, capH: 50, maxW: 337, sub: 'A TWO-PLAYER CO-OP DISASTER' },
      hazeY: 0.74,
      yardTop: 0.94,
      tower: { x1: 126 },
      girders: [
        { x0: -8, x1: 236, y: 284, h: 21 },
        { x0: -8, x1: 150, y: 404, h: 18, mark: 'NO STEP' },
        { x0: -8, x1: 96, y: 162, h: 17 },
        { x0: 292, x1: 382, y: 426, h: 17, mark: 'SWL 2.5t' },
      ],
      numeral: { text: '7', cx: 58, cy: 282, h: 168 },
      anchor: { px: 162, py: 237, s: 1.95, rot: -0.42 },
      flyer: { px: 302, py: 282, s: 1.68, rot: -0.32 },
      sag: 74,
      crate: { w: 66, h: 60, rot: -0.13, drop: 0.12, t: 0.5 },
      ropeW: 3.0,
    },
    thumb: {
      W: 231,
      H: 87,
      detail: 0,
      cranes: 0,
      figures: true,
      wm: { cx: 115.5, top: 3, capH: 20, maxW: 208, sub: null },
      hazeY: 0.82,
      yardTop: 1.02,
      tower: { x1: 46 },
      girders: [
        { x0: -4, x1: 108, y: 82, h: 8 },
        { x0: 212, x1: 235, y: 84, h: 5 },
      ],
      numeral: null,
      anchor: { px: 66, py: 65, s: 0.72, rot: -0.42 },
      flyer: { px: 184, py: 65, s: 0.68, rot: -0.32 },
      sag: 9,
      crate: { w: 24, h: 18, rot: 0.14, drop: 0.12, t: 0.5 },
      ropeW: 1.6,
    },
    // Behind the store page, dimmed by Steam and covered down the middle by the
    // page's own content column. Valve's advice for it is atmosphere and no
    // subject, and cropping is unpredictable: the pair belongs on the capsules,
    // where a shopper is looking at them, not here where the content column
    // lands across the rope and the crop can take their heads off.
    background: {
      W: 719,
      H: 405,
      detail: 2,
      cranes: 7,
      figures: false,
      wm: null,
      hazeY: 0.60,
      yardTop: 0.80,
      tower: { x1: 264, top: -10 },
      girders: [
        { x0: -8, x1: 430, y: 254, h: 22 },
        { x0: -8, x1: 300, y: 120, h: 18, mark: 'NO STEP' },
        { x0: -8, x1: 350, y: 360, h: 18 },
        { x0: 470, x1: 727, y: 300, h: 20, mark: 'SWL 2.5t' },
        { x0: 560, x1: 727, y: 176, h: 17 },
        { x0: 620, x1: 727, y: 62, h: 15 },
      ],
      numeral: { text: '7', cx: 118, cy: 244, h: 220 },
      hoist: { x: 430, top: -10, drop: 158, w: 104, h: 84, rot: 0.06 },
    },
    // 3.1:1, and Valve composites the separately supplied logo over the top of
    // it at a position the customer's client decides. So the tower stops inside
    // the frame instead of running off the top, and the whole picture sits in
    // the lower four fifths: everything above 62 units is empty sky for the
    // logo to land on. The width buys the one thing no capsule has room for —
    // the full span of rope, with the crate swinging in the middle of it.
    hero: {
      W: 960,
      H: 310,
      detail: 2,
      cranes: 7,
      figures: true,
      wm: null,
      hazeY: 0.78,
      yardTop: 0.95,
      tower: { x1: 250, top: 96 },
      girders: [
        { x0: -8, x1: 330, y: 214, h: 15 },
        { x0: -8, x1: 200, y: 142, h: 13, mark: 'NO STEP' },
        { x0: -8, x1: 270, y: 292, h: 14 },
        { x0: 700, x1: 968, y: 232, h: 15, mark: 'SWL 2.5t' },
        { x0: 840, x1: 968, y: 152, h: 13 },
      ],
      numeral: { text: '7', cx: 122, cy: 202, h: 84 },
      anchor: { px: 285, py: 179, s: 1.6, rot: -0.42 },
      flyer: { px: 690, py: 196, s: 1.5, rot: -0.32 },
      sag: 22,
      crate: { w: 52, h: 44, rot: 0.14, drop: 0.1, t: 0.5 },
      ropeW: 2.4,
    },
    // Stands in for a screenshot in the carousel, so it is the only asset that
    // has to look like a moment of play rather than a poster: the camera is in
    // close, the yard has dropped away below the haze, and the floor number on
    // the tower is not the one the capsules show.
    shot: {
      W: 640,
      H: 360,
      detail: 2,
      cranes: 4,
      figures: true,
      wm: null,
      hazeY: 0.83,
      yardTop: 0.99,
      tower: { x1: 196, top: -10 },
      girders: [
        { x0: -8, x1: 316, y: 240, h: 22 },
        { x0: -8, x1: 176, y: 104, h: 19, mark: 'NO STEP' },
        { x0: -8, x1: 240, y: 348, h: 18 },
        { x0: 430, x1: 648, y: 136, h: 20, mark: 'SWL 2.5t' },
        { x0: 556, x1: 648, y: 320, h: 18 },
      ],
      numeral: { text: '12', cx: 92, cy: 186, h: 132 },
      anchor: { px: 250, py: 188, s: 2.3, rot: -0.42 },
      flyer: { px: 478, py: 248, s: 2.0, rot: -0.5 },
      sag: 40,
      crate: { w: 60, h: 50, rot: 0.16, drop: 0.1, t: 0.5 },
      ropeW: 3.0,
    },
  };

  const L = (() => {
    const d = DESIGNS[mode === 'logo' ? 'wide' : mode] || DESIGNS.wide;
    const k = Math.min(W / d.W, H / d.H);
    const ox = (W - d.W * k) / 2;
    const oy = (H - d.H * k) / 2;
    // Pin anything the design deliberately ran off its own edge back to the
    // new one, so a girder never stops in mid-air on a wider canvas.
    const sx = (x) => (x <= 0 ? x * k : x >= d.W ? W + (x - d.W) * k : ox + x * k);
    const sy = (y) => oy + y * k;
    return {
      k,
      detail: d.detail,
      cranes: d.cranes,
      figures: d.figures,
      wm: d.wm && {
        cx: ox + d.wm.cx * k,
        top: oy + d.wm.top * k,
        capH: d.wm.capH * k,
        maxW: d.wm.maxW * k,
        sub: d.wm.sub,
      },
      hazeY: d.hazeY,
      yardTop: d.yardTop,
      // A tower with no top of its own runs off the frame, and is pinned there
      // rather than scaled, the same way the girders are.
      tower: { x1: ox + d.tower.x1 * k, top: d.tower.top > 0 ? oy + d.tower.top * k : -10 },
      girders: d.girders.map((g) => ({
        x0: sx(g.x0),
        x1: sx(g.x1),
        y: sy(g.y),
        h: g.h * k,
        mark: g.mark,
      })),
      numeral: d.numeral
        ? { text: d.numeral.text, cx: ox + d.numeral.cx * k, cy: oy + d.numeral.cy * k, h: d.numeral.h * k }
        : null,
      hoist: d.hoist
        ? {
            x: ox + d.hoist.x * k,
            top: d.hoist.top > 0 ? oy + d.hoist.top * k : -10,
            drop: d.hoist.drop * k,
            w: d.hoist.w * k,
            h: d.hoist.h * k,
            rot: d.hoist.rot,
          }
        : null,
      ...(d.figures
        ? {
            anchor: { px: ox + d.anchor.px * k, py: oy + d.anchor.py * k, s: d.anchor.s * k, rot: d.anchor.rot },
            flyer: { px: ox + d.flyer.px * k, py: oy + d.flyer.py * k, s: d.flyer.s * k, rot: d.flyer.rot },
            sag: d.sag * k,
            crate: { w: d.crate.w * k, h: d.crate.h * k, rot: d.crate.rot, drop: d.crate.drop, t: d.crate.t },
            ropeW: d.ropeW * k,
          }
        : {}),
    };
  })();

  const D = L.detail;

  if (logoOnly) {
    // Fill the frame with the mark rather than sitting it where the capsule
    // puts it: a logo asset is cropped to its own artwork.
    L.wm = { cx: W / 2, top: H * 0.30, capH: H * 0.26, maxW: W * 0.86, sub: 'A TWO-PLAYER CO-OP DISASTER' };
  }

  /** Local figure coords → world, for whichever hauler. */
  function RP(f, x, y) {
    const c = Math.cos(f.rot);
    const sn = Math.sin(f.rot);
    const lx = x * f.s;
    const ly = y * f.s;
    return [f.px + lx * c - ly * sn, f.py + lx * sn + ly * c];
  }

  /* ------------------------------------------------------------- helpers */
  const CH_SIZE = Math.max(6, Math.round(H / 24));
  const CHEV = chevron(ctx, CH_SIZE);

  /** Chevron band, boxed top and bottom by a hard ink rule so it cannot dissolve. */
  function chevronBand(x, y, w, h, phase) {
    const rule = Math.max(1.3, h * 0.15);
    ctx.save();
    CHEV.setTransform(new DOMMatrix().translate(-phase, -phase));
    ctx.fillStyle = CHEV;
    ctx.fillRect(x, y, w, h);
    ctx.fillStyle = P.ink;
    ctx.fillRect(x, y, w, rule);
    ctx.fillRect(x, y + h - rule, w, rule);
    ctx.restore();
  }

  function drawMark(text, size, colour, x, y, alpha, bridges) {
    const m = stencil(text, size, colour, undefined, bridges);
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.drawImage(m.canvas, x - m.pad, y - m.pad);
    ctx.restore();
    return m;
  }

  if (!logoOnly) {
  /* ------------------------------------------------------------- backdrop */
  ctx.fillStyle = P.paper;
  ctx.fillRect(0, 0, W, H);

  // One flat haze band. Never a gradient.
  const hazeY = Math.round(H * L.hazeY);
  ctx.fillStyle = P.haze;
  ctx.fillRect(0, hazeY, W, H - hazeY);

  const yardTop = H * L.yardTop;

  // Far plant: gantry cranes one value off the haze, so they stay distance
  // rather than competing with the two figures.
  if (D > 0) {
    ctx.fillStyle = P.far;
    for (let i = 0; i < L.cranes; i++) {
      const cx = W * ((i + 0.5) / L.cranes) + hash(11 + i) * W * 0.06;
      const hgt = H * (0.11 + hash(3 + i * 7) * 0.05);
      const t = Math.max(2, W * 0.006);
      const legs = W * 0.035;
      ctx.fillRect(cx - legs, yardTop - hgt, t, hgt);
      ctx.fillRect(cx + legs, yardTop - hgt, t, hgt);
      ctx.fillRect(cx - legs * 2.2, yardTop - hgt, legs * 4.6, t * 1.6);
      ctx.fillRect(cx - legs * 2.2, yardTop - hgt, t, hgt * 0.30);
    }
  }

  /** Container stacks, far to near. Kept low and light: the sky is the star. */
  function stacks(baseY, u, colour, seed, livery) {
    let x = -u;
    let i = 0;
    while (x < W + u) {
      const w = u * (1.5 + hash(seed + i * 13) * 2.1);
      const n = 1 + Math.floor(hash(seed + i * 31) * 2.4);
      for (let k = 0; k < n; k++) {
        const useLivery = livery && hash(seed + i * 7 + k * 3) > 0.80;
        ctx.fillStyle = useLivery ? P.livery[Math.floor(hash(seed + i * 5 + k) * 4) % 4] : colour;
        const y = baseY - (k + 1) * u * 0.66;
        ctx.fillRect(x, y, w, u * 0.66);
        if (D > 0) {
          ctx.fillStyle = 'rgba(27,23,20,0.16)';
          ctx.fillRect(x, y, w, 1.4);
        }
      }
      x += w + u * (0.22 + hash(seed + i * 17) * 0.5);
      i++;
    }
  }
  const unit = H * 0.062;
  if (D > 0) {
    stacks(yardTop + unit * 0.5, unit * 0.9, P.mid, 29, false);
    stacks(H + unit * 0.2, unit * 1.15, P.near, 91, true);
  }

  /* ----------------------------------------------------------------- tower */
  const T = L.tower;
  ctx.fillStyle = P.tileBody;
  ctx.fillRect(-10, T.top, T.x1 + 10, H - T.top + 20);

  const tTop = Math.max(0, T.top);
  if (D > 0) {
    ctx.fillStyle = 'rgba(27,23,20,0.10)';
    for (let y = tTop + H * 0.07; y < H; y += H * 0.21) ctx.fillRect(0, Math.round(y), T.x1, 1.6);
    ctx.fillStyle = P.tileDetail;
    for (let i = 0; i < 44; i++) {
      ctx.fillRect(hash(i * 3 + 1) * T.x1, tTop + hash(i * 5 + 2) * (H - tTop), 3 + hash(i) * 10, 1.6);
    }
  }

  // A roof, when the design stops the tower inside the frame: the same capped
  // edge the girders wear, so the top of it reads as concrete rather than as
  // the picture running out.
  if (T.top > 0) {
    const cap = Math.max(2, H * 0.012);
    ctx.fillStyle = P.tileTop;
    ctx.fillRect(-10, T.top, T.x1 + 10, cap);
    ctx.fillStyle = P.ink;
    ctx.fillRect(-10, T.top, T.x1 + 10, Math.max(1.6, cap * 0.34));
  }

  // A floor number three metres tall, painted flat on the tower's face. The
  // girders then cross it for real rather than by masking.
  if (L.numeral) {
    const n = stencil(L.numeral.text, L.numeral.h * 1.34, P.ink, 0, true);
    ctx.save();
    ctx.globalAlpha = 0.42;
    ctx.drawImage(n.canvas, L.numeral.cx - n.canvas.width / 2, L.numeral.cy - n.canvas.height / 2);
    ctx.restore();
  }

  // The tower's near edge, in ink — started below the wordmark rather than at
  // the top of the frame. On the wide capsule the tower lands under the title
  // and the edge ran straight through the letterforms, splitting the A from
  // the U. The vertical capsule never showed it because the tower sits left of
  // the mark there. The scene assets carry no wordmark, so theirs starts where
  // the tower itself does.
  ctx.fillStyle = P.ink;
  const edgeW = Math.max(2, W * 0.006);
  const edgeTop = L.wm ? L.wm.top + L.wm.capH + H * 0.06 : T.top;
  ctx.fillRect(T.x1 - edgeW, edgeTop, edgeW, H - edgeTop + 20);

  /* --------------------------------------------------------------- girders */
  for (const g of L.girders) {
    const w = g.x1 - g.x0;
    const cap = Math.max(1.5, g.h * 0.17);
    ctx.fillStyle = 'rgba(46,38,28,0.15)';
    ctx.fillRect(g.x0, g.y + g.h, w, Math.max(2, g.h * 0.3));
    ctx.fillStyle = P.tileTop;
    ctx.fillRect(g.x0, g.y - cap, w, cap);
    chevronBand(g.x0, g.y, w, g.h, (g.y * 0.7) % CH_SIZE);
    ctx.fillStyle = P.ink;
    const wp = Math.max(1.6, g.h * 0.16);
    if (g.x1 < W) ctx.fillRect(g.x1 - wp, g.y - cap, wp, g.h + cap);
    if (g.x0 > 0) ctx.fillRect(g.x0, g.y - cap, wp, g.h + cap);
    if (D > 1 && g.mark) {
      const ms = g.h * 0.6;
      const mk = stencil(g.mark, ms, P.ink, undefined, false);
      const mx = g.x0 > 0
        ? Math.min(g.x0 + g.h * 0.7, W - mk.canvas.width - 2)
        : Math.max(4 - mk.pad, Math.min(g.h * 0.7, T.x1 - mk.canvas.width + mk.pad));
      ctx.save();
      ctx.globalAlpha = 0.5;
      ctx.drawImage(mk.canvas, mx, g.y - g.h * 0.7 - mk.canvas.height);
      ctx.restore();
    }
  }

  /* ----------------------------------------------------------------- load */
  // The crate, wherever it has ended up: on the end of the pair's rope, or on
  // a line of its own where a design has no pair in it.
  function crateAt(cx, cy, cw, ch, rot) {
    const off = Math.max(1.5, cw * 0.04);
    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(rot);
    ctx.fillStyle = P.shadow;
    ctx.fillRect(-cw / 2 + off, -ch / 2 + off * 1.5, cw, ch);
    ctx.fillStyle = P.cargo;
    ctx.fillRect(-cw / 2, -ch / 2, cw, ch);
    ctx.fillStyle = P.cargoDark;
    ctx.fillRect(-cw / 2, ch / 2 - ch * 0.12, cw, ch * 0.12);
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = Math.max(1.6, cw * 0.04);
    ctx.strokeRect(-cw / 2, -ch / 2, cw, ch);
    ctx.fillStyle = P.ink;
    ctx.fillRect(-cw * 0.44, -ch / 2, cw * 0.09, ch);
    ctx.fillRect(cw * 0.35, -ch / 2, cw * 0.09, ch);
    ctx.fillStyle = P.red;
    const band = Math.max(1.6, ch * 0.055);
    ctx.fillRect(-cw / 2 + cw * 0.05, -ch / 2 + ch * 0.13, cw - cw * 0.1, band);
    ctx.fillRect(-cw / 2 + cw * 0.05, ch / 2 - ch * 0.26, cw - cw * 0.1, band);
    if (D > 1) {
      // Scaled to fit, not clipped to fit. Clamping the width alone squashed
      // nothing and cropped instead, so the key art shipped a crate stencilled
      // FRAGILB — the E cut in half by the crate's own edge, on the object the
      // whole picture is about.
      const f = stencil('FRAGILE', ch * 0.21, P.red, undefined, false);
      const fit = Math.min(1, (cw * 0.8) / f.canvas.width);
      const fw = f.canvas.width * fit;
      const fh = f.canvas.height * fit;
      ctx.drawImage(f.canvas, -fw / 2, -ch * 0.12, fw, fh);
    }
    ctx.restore();
  }

  // A crate coming down out of the frame on a crane line. The page background
  // is the only design with nobody in it, and a yard with nothing moving in it
  // is a photograph of some scaffolding.
  if (L.hoist) {
    const ho = L.hoist;
    const hw = Math.max(2, ho.w * 0.03);
    ctx.lineCap = 'round';
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = hw * 2.6;
    ctx.beginPath();
    ctx.moveTo(ho.x, ho.top);
    ctx.lineTo(ho.x, ho.top + ho.drop);
    ctx.stroke();
    ctx.strokeStyle = P.chalk;
    ctx.lineWidth = hw * 0.95;
    ctx.beginPath();
    ctx.moveTo(ho.x, ho.top);
    ctx.lineTo(ho.x, ho.top + ho.drop);
    ctx.stroke();
    crateAt(ho.x, ho.top + ho.drop + ho.h / 2, ho.w, ho.h, ho.rot);
  }

  if (L.figures) {
  /* ----------------------------------------------------------------- rope */
  // The rope runs from the braced hauler's fists to the other one's harness:
  // that is how the two are actually tied, and it frees his arms to flail.
  const A = RP(L.anchor, BRACE_HANDS[0].h[0], BRACE_HANDS[0].h[1]);
  const B = RP(L.flyer, 0, -3);
  const C = [(A[0] + B[0]) / 2, (A[1] + B[1]) / 2 + L.sag * 2];
  const ropeAt = (t) => [
    (1 - t) * (1 - t) * A[0] + 2 * t * (1 - t) * C[0] + t * t * B[0],
    (1 - t) * (1 - t) * A[1] + 2 * t * (1 - t) * C[1] + t * t * B[1],
  ];
  const tailHand = RP(L.anchor, BRACE_HANDS[1].h[0], BRACE_HANDS[1].h[1]);
  function ropePath() {
    ctx.beginPath();
    ctx.moveTo(tailHand[0], tailHand[1]);
    ctx.lineTo(A[0], A[1]);
    ctx.quadraticCurveTo(C[0], C[1], B[0], B[1]);
  }
  const rw = L.ropeW;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.strokeStyle = P.shadow;
  ctx.lineWidth = rw * 3.0;
  ctx.save();
  ctx.translate(rw * 1.1, rw * 1.5);
  ropePath();
  ctx.stroke();
  ctx.restore();
  ctx.strokeStyle = P.ink;
  ctx.lineWidth = rw * 2.6;
  ropePath();
  ctx.stroke();
  ctx.strokeStyle = P.chalk;
  ctx.lineWidth = rw * 0.95;
  ropePath();
  ctx.stroke();

  /* ---------------------------------------------------------------- crate */
  const crateMid = ropeAt(L.crate.t);
  (function crate() {
    const cw = L.crate.w;
    const ch = L.crate.h;
    const cy = crateMid[1] + ch * L.crate.drop + ch / 2;
    const cx = crateMid[0] + ch * 0.05;
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = rw * 1.25;
    ctx.beginPath();
    ctx.moveTo(crateMid[0], crateMid[1]);
    ctx.lineTo(cx, cy - ch / 2);
    ctx.stroke();
    crateAt(cx, cy, cw, ch, L.crate.rot);
  })();

  /* -------------------------------------------------------------- haulers */
  function limb(x0, y0, kx, ky, x1, y1, wdt) {
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = wdt;
    ctx.beginPath();
    ctx.moveTo(x0, y0);
    ctx.quadraticCurveTo(kx, ky, x1, y1);
    ctx.stroke();
  }
  function knob(x, y, r) {
    ctx.fillStyle = P.ink;
    ctx.beginPath();
    ctx.arc(x, y, r, 0, Math.PI * 2);
    ctx.fill();
  }

  /**
   * A hauler. The body is always ink; the vest is worn rather than being what
   * the figure is made of, and only the retroreflective banding is white.
   */
  function hauler(o) {
    const f = { px: o.px, py: o.py, s: o.s, rot: o.rot };
    const s = o.s;
    const lw = 5.4 * s;
    const at = (x, y) => RP(f, x, y);
    const sh = at(0, -23);

    for (const g of o.legs) {
      const k = o.legsFollow ? at(g[2], g[3]) : [o.px + g[2] * s, o.py + g[3] * s];
      const e = o.legsFollow ? at(g[0], g[1]) : [o.px + g[0] * s, o.py + g[1] * s];
      limb(o.px, o.py, k[0], k[1], e[0], e[1], lw);
      knob(e[0], e[1], lw * 0.6);
    }
    for (const a of o.hands) {
      const k = at(a.e[0], a.e[1]);
      const e = at(a.h[0], a.h[1]);
      limb(sh[0], sh[1], k[0], k[1], e[0], e[1], lw * 0.86);
      knob(e[0], e[1], lw * 0.55);
    }

    ctx.save();
    ctx.translate(o.px, o.py);
    ctx.rotate(o.rot);
    const tw = 23 * s;
    const th = 27 * s;
    ctx.fillStyle = P.ink;
    const r = 6.5 * s;
    ctx.beginPath();
    ctx.moveTo(-tw / 2 + r, -th);
    ctx.arcTo(tw / 2, -th, tw / 2, -th + r, r);
    ctx.arcTo(tw / 2, 3 * s, tw / 2 - r, 3 * s, r * 0.75);
    ctx.arcTo(-tw / 2, 3 * s, -tw / 2, 3 * s - r, r * 0.75);
    ctx.arcTo(-tw / 2, -th, -tw / 2 + r, -th, r);
    ctx.closePath();
    ctx.fill();

    const vx = -tw / 2 + 1.6 * s;
    const vw = tw - 3.2 * s;
    const vy = -th + 5.5 * s;
    const vh = th * 0.68;
    ctx.fillStyle = o.vest.main;
    ctx.fillRect(vx, vy, vw, vh);
    ctx.fillStyle = o.vest.dark;
    ctx.fillRect(vx, vy + vh - 2 * s, vw, 2 * s);
    ctx.fillStyle = '#FFFFFF';
    const bandH = Math.max(1.5, 2.6 * s);
    ctx.fillRect(vx, vy + vh * 0.24, vw, bandH);
    if (s > 0.8) ctx.fillRect(vx, vy + vh * 0.64, vw, bandH);
    if (s > 1.2) ctx.fillRect(-1.3 * s, vy, 2.6 * s, vh);

    const hy = -th - 8.6 * s;
    ctx.fillStyle = P.ink;
    ctx.beginPath();
    ctx.arc(0, hy, 9.0 * s, 0, Math.PI * 2);
    ctx.fill();
    // Hard hat: a low dome and a short peak, never wider than the head is tall.
    ctx.beginPath();
    ctx.arc(0, hy - 4.2 * s, 7.9 * s, Math.PI, Math.PI * 2);
    ctx.closePath();
    ctx.fill();
    ctx.beginPath();
    ctx.ellipse(o.look * 1.6 * s, hy - 4.4 * s, 10.4 * s, 1.9 * s, 0, 0, Math.PI * 2);
    ctx.fill();
    if (s > 0.9) {
      // A light rim, not a dark one: shading down a near-black head is invisible.
      ctx.fillStyle = 'rgba(255,255,255,0.13)';
      ctx.beginPath();
      ctx.arc(0, hy - 5.2 * s, 7.9 * s, Math.PI * 1.06, Math.PI * 1.6);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = P.paper;
      const ex = o.look * 2.4 * s;
      ctx.beginPath();
      ctx.arc(ex + 3.6 * s, hy + 1.8 * s, 1.8 * s, 0, Math.PI * 2);
      ctx.arc(ex - 2.2 * s, hy + 1.8 * s, 1.8 * s, 0, Math.PI * 2);
      ctx.fill();
      if (o.mouth === 'o') {
        ctx.beginPath();
        ctx.ellipse(ex + 1.0 * s, hy + 5.6 * s, 2.7 * s, 2.2 * s, 0, 0, Math.PI * 2);
        ctx.fill();
      } else if (o.mouth === 'grit') {
        ctx.fillRect(ex - 2.4 * s, hy + 4.8 * s, 6.2 * s, 1.8 * s);
      }
    }
    ctx.restore();
  }

  const gA = L.girders[0];
  ctx.fillStyle = 'rgba(46,38,28,0.22)';
  ctx.beginPath();
  ctx.ellipse(L.anchor.px, gA.y + 1, 22 * L.anchor.s, 3.2 * L.anchor.s, 0, 0, Math.PI * 2);
  ctx.fill();

  if (D > 0) {
    // Grit dragged off the ledge by the heels — the load is winning.
    ctx.fillStyle = P.dust;
    for (let i = 0; i < 7; i++) {
      const t = hash(200 + i);
      ctx.globalAlpha = 0.32 - t * 0.13;
      ctx.beginPath();
      ctx.arc(L.anchor.px - (12 + t * 44) * L.anchor.s, gA.y - t * 9 * L.anchor.s,
        (1.4 + t * 3.2) * L.anchor.s * 0.6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.globalAlpha = 1;
  }

  hauler({
    px: L.anchor.px, py: L.anchor.py, s: L.anchor.s, rot: L.anchor.rot,
    legs: BRACE_LEGS, legsFollow: false, hands: BRACE_HANDS,
    look: 1, mouth: 'grit', vest: VEST.orange,
  });
  hauler({
    px: L.flyer.px, py: L.flyer.py, s: L.flyer.s, rot: L.flyer.rot,
    legs: FLY_LEGS, legsFollow: true, hands: FLY_HANDS,
    look: -1, mouth: 'o', vest: VEST.lime,
  });

  /* ------------------------------------------------------------- carabiner */
  // The rope is tied to this one's harness rather than held in his fists, which
  // is what frees his arms to flail and is how the two are actually roped in
  // the game. But the haulers are drawn over the rope, so the last inch of it
  // went under the vest panel and simply stopped: the rope appeared to
  // terminate inside his chest and his raised hand was empty. On a piece of key
  // art whose entire subject is two people tied together, the tie was invisible.
  (function carabiner() {
    const r = Math.max(3, L.ropeW * 2.2);
    ctx.save();
    ctx.translate(B[0], B[1]);
    ctx.lineCap = 'round';
    ctx.strokeStyle = P.ink;
    ctx.lineWidth = L.ropeW * 2.6;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.strokeStyle = P.chalk;
    ctx.lineWidth = L.ropeW * 0.95;
    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  })();

  } // end of the pair
  } // end of the scene
  /* -------------------------------------------------------------- wordmark */
  // The capsules carry it and the scene assets do not, which is what wm: null
  // in a design means. Valve composites the separately supplied Library Logo
  // over the hero at a position the user can move, so a hero with the logotype
  // already baked into it ships the wordmark twice, overlapping, and the store
  // page reads as a mistake before anyone has read a word of it. The page
  // background sits behind the page's own title block and the screenshot frame
  // stands in for a screenshot; neither wants a poster title either.
  if (L.wm) (function wordmark() {
    const text = 'HAULMATES';
    const probe = document.createElement('canvas').getContext('2d');
    probe.font = font(100);
    const asc100 = probe.measureText(text).actualBoundingBoxAscent || 72;
    let size = (L.wm.capH * 100) / asc100;
    const chars = text.split('');
    const widths = (sz) => {
      probe.font = font(sz);
      return chars.reduce((a, ch) => a + probe.measureText(ch).width, 0);
    };
    let natural = widths(size);
    let tracking = size * 0.05;
    let total = natural + tracking * (chars.length - 1);
    let sx = 1;
    if (total > L.wm.maxW) {
      sx = L.wm.maxW / total;
      if (sx < 0.80) {
        size *= sx / 0.80;
        natural = widths(size);
        tracking = size * 0.05;
        total = natural + tracking * (chars.length - 1);
        sx = L.wm.maxW / total;
      }
    } else {
      const extra = (L.wm.maxW - total) / (chars.length - 1);
      tracking += Math.min(extra, size * 0.3);
      total = natural + tracking * (chars.length - 1);
      sx = Math.min(1, L.wm.maxW / total);
    }
    const mark = stencil(text, size, P.ink, tracking, L.wm.capH >= 30);
    const drawW = mark.canvas.width * sx;
    ctx.drawImage(mark.canvas, L.wm.cx - drawW / 2, L.wm.top - mark.pad, drawW, mark.canvas.height);

    const ruleY = L.wm.top + L.wm.capH + Math.max(3, H * 0.018);
    ctx.fillStyle = P.ink;
    ctx.fillRect(L.wm.cx - L.wm.maxW / 2, ruleY, L.wm.maxW, Math.max(1.6, H * 0.009));

    if (L.wm.sub) {
      const sSize = Math.max(9, L.wm.capH * 0.21);
      const sm = stencil(L.wm.sub, sSize, P.ink, sSize * 0.36, false);
      ctx.save();
      ctx.globalAlpha = 0.8;
      ctx.drawImage(sm.canvas, L.wm.cx - sm.canvas.width / 2, ruleY + Math.max(2, H * 0.013));
      ctx.restore();
    }
  })();

  return canvas.toDataURL('image/png');
}

/**
 * The launcher icon: the same two haulers and the same rope, cropped square.
 *
 * It reuses \`render\` rather than drawing its own figures, because an icon that
 * disagrees with the capsule is two brands. The square is the middle of the
 * wide composition, blown up until the pair fills it, with the corners rounded
 * and everything outside them cut away.
 */
function icon(size) {
  const canvas = document.getElementById('c');
  render(['wide', size * 2.2, size * 1.26]);
  const scene = document.createElement('canvas');
  scene.width = canvas.width;
  scene.height = canvas.height;
  scene.getContext('2d').drawImage(canvas, 0, 0);

  canvas.width = size;
  canvas.height = size;
  const g = canvas.getContext('2d');
  g.clearRect(0, 0, size, size);

  const r = size * 0.19;
  g.beginPath();
  g.moveTo(size - r, 0);
  g.arcTo(size, 0, size, size - r, r);
  g.arcTo(size, size, r, size, r);
  g.arcTo(0, size, 0, r, r);
  g.arcTo(0, 0, size - r, 0, r);
  g.closePath();
  g.clip();

  // Frame on one hauler, the rope and the crate.
  //
  // Both of them will not fit: they stand 374 design units apart and the
  // composition is only 353 tall, so any square crop wide enough to hold the
  // pair has to include sky above them and shrinks everything to nothing at
  // 32 pixels. Cropping to the braced hauler and the load on the end of his
  // rope keeps a figure at a readable size and still says what the game is.
  // The crop starts below the wordmark, or the icon is a picture of some
  // letters.
  const m = scene.width / 616;
  const side = 250 * m;
  g.drawImage(scene, 152 * m, 103 * m, side, side, 0, 0, size, size);

  g.strokeStyle = 'rgba(27,23,20,0.55)';
  g.lineWidth = size * 0.035;
  g.stroke();
}

/* ------------------------------------------------- achievement pictograms */

/**
 * The badges are drawn in a 64-unit square, which is the pixel size Steam shows
 * them at in the overlay and on the profile: a unit is a pixel, so a 2-unit
 * line is a 2-pixel line and nothing about them is decided at a size nobody
 * sees. The bottom 11 units are the hazard strip every badge wears, so a figure
 * standing on GND is standing on the strip and the whole set shares a floor.
 */
const GND = 53;

/**
 * A hazard-taped ledge: the girder from the capsules, at badge scale.
 *
 * Below about four units tall the slashes and the two ink rules meet in the
 * middle and the bar turns solid grey, so a thin floor is drawn as an ink bar
 * with a yellow cap, which reads as the same tape seen from further away.
 */
function bledge(g, x, y, w, h) {
  if (h < 4) {
    g.fillStyle = P.ink;
    g.fillRect(x, y, w, h);
    g.fillStyle = P.hazA;
    g.fillRect(x, y, w, Math.max(0.8, h * 0.42));
    return;
  }
  const rule = Math.max(0.9, h * 0.18);
  g.fillStyle = P.hazA;
  g.fillRect(x, y, w, h);
  g.save();
  g.beginPath();
  g.rect(x, y, w, h);
  g.clip();
  g.fillStyle = P.hazB;
  const pitch = h * 1.9;
  for (let i = -h * 2; i < w + h; i += pitch) {
    g.beginPath();
    g.moveTo(x + i, y + h);
    g.lineTo(x + i + pitch * 0.5, y + h);
    g.lineTo(x + i + pitch * 0.5 + h, y);
    g.lineTo(x + i + h, y);
    g.closePath();
    g.fill();
  }
  g.restore();
  g.fillStyle = P.ink;
  g.fillRect(x, y, w, rule);
  g.fillRect(x, y + h - rule, w, rule);
}

/** The rope: ink with the chalk highlight down the middle, as on the capsules. */
function brope(g, ax, ay, cx, cy, bx, by, w) {
  g.lineCap = 'round';
  g.beginPath();
  g.moveTo(ax, ay);
  g.quadraticCurveTo(cx, cy, bx, by);
  g.strokeStyle = P.ink;
  g.lineWidth = w;
  g.stroke();
  g.strokeStyle = P.chalk;
  g.lineWidth = Math.max(0.55, w * 0.3);
  g.stroke();
}

/** The crate. No FRAGILE on it: seven letters inside 24 units is a red smear. */
function bcrate(g, x, y, w, h, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = P.cargo;
  g.fillRect(-w / 2, -h / 2, w, h);
  g.fillStyle = P.cargoDark;
  g.fillRect(-w / 2, h / 2 - h * 0.14, w, h * 0.14);
  g.fillStyle = P.ink;
  g.fillRect(-w * 0.44, -h / 2, w * 0.1, h);
  g.fillRect(w * 0.34, -h / 2, w * 0.1, h);
  g.fillStyle = P.red;
  const band = Math.max(1, h * 0.09);
  g.fillRect(-w * 0.46, -h * 0.30, w * 0.92, band);
  g.fillRect(-w * 0.46, h * 0.18, w * 0.92, band);
  g.strokeStyle = P.ink;
  g.lineWidth = Math.max(1.2, w * 0.06);
  g.strokeRect(-w / 2, -h / 2, w, h);
  g.restore();
}

/** A loose board off a crate that no longer exists. */
function bplank(g, x, y, w, h, rot, banded) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = P.cargo;
  g.fillRect(-w / 2, -h / 2, w, h);
  if (banded) {
    g.fillStyle = P.red;
    g.fillRect(-w / 2, -h * 0.18, w, Math.max(1, h * 0.3));
  }
  g.strokeStyle = P.ink;
  g.lineWidth = 1.2;
  g.strokeRect(-w / 2, -h / 2, w, h);
  g.restore();
}

/** The hard hat on its own, for the one badge where it is not on a head. */
function bhat(g, x, y, s, rot) {
  g.save();
  g.translate(x, y);
  g.rotate(rot);
  g.fillStyle = P.ink;
  g.beginPath();
  g.arc(0, 0, 3.8 * s, Math.PI, Math.PI * 2);
  g.closePath();
  g.fill();
  g.beginPath();
  g.ellipse(0, 0, 5.0 * s, 0.95 * s, 0, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** An open hook on the end of a line. */
function bhook(g, x, y, r) {
  g.strokeStyle = P.ink;
  g.lineWidth = 1.6;
  g.lineCap = 'round';
  g.beginPath();
  g.arc(x, y, r, Math.PI * 1.15, Math.PI * 0.45);
  g.stroke();
}

/** Rope that is not under tension, coiled on the deck. */
function bcoil(g, x, y, w) {
  g.strokeStyle = P.ink;
  g.lineWidth = 1.6;
  for (let i = 0; i < 3; i++) {
    g.beginPath();
    g.ellipse(x, y - i * 1.9, w * (1 - i * 0.16), w * 0.34, 0, 0, Math.PI * 2);
    g.stroke();
  }
}

/** Grit thrown off whatever just happened. */
function bdust(g, x, y, dx, n) {
  g.fillStyle = P.dust;
  for (let i = 0; i < n; i++) {
    const t = hash(400 + i * 7);
    g.globalAlpha = 0.42 - i * 0.07;
    g.beginPath();
    g.arc(x + dx * (i + t), y - t * 3, 1 + t * 1.6, 0, Math.PI * 2);
    g.fill();
  }
  g.globalAlpha = 1;
}

/** One of the yard's own chevrons, pointing wherever the load is going. */
function bchev(g, cx, cy, w, h) {
  g.fillStyle = P.hazA;
  g.strokeStyle = P.ink;
  g.lineWidth = 1;
  g.beginPath();
  g.moveTo(cx - w / 2, cy + h / 2);
  g.lineTo(cx, cy - h / 2);
  g.lineTo(cx + w / 2, cy + h / 2);
  g.lineTo(cx + w / 2 - h * 0.55, cy + h / 2);
  g.lineTo(cx, cy - h * 0.5 + h * 0.55);
  g.lineTo(cx - w / 2 + h * 0.55, cy + h / 2);
  g.closePath();
  g.fill();
  g.stroke();
}

/**
 * A hauler at badge scale, in the same silhouette the capsules established:
 * ink body, worn vest, hard hat with a brim wider than its dome.
 *
 * A figure is 33 units tall at s = 1, hat to heel, so one of them fills a plate
 * and a pair sits at about 0.75. Limbs are given as an end and a knee or elbow
 * to bend through, in figure units from the hip. What the capsule figure has
 * and this one drops — the second reflective band, the shoulder strap, the
 * mouth — is a single grey pixel on a torso eight pixels wide.
 */
function bhauler(g, o) {
  const s = o.s;
  const rot = o.rot || 0;
  const cs = Math.cos(rot);
  const sn = Math.sin(rot);
  const at = (x, y) => [o.x + (x * cs - y * sn) * s, o.y + (x * sn + y * cs) * s];
  const lw = 2.7 * s;
  const hip = [o.x, o.y];
  const shoulder = at(0, -11);
  g.lineCap = 'round';
  g.lineJoin = 'round';
  const limb = (from, a, w) => {
    const k = at(a.e[0], a.e[1]);
    const e = at(a.h[0], a.h[1]);
    g.strokeStyle = P.ink;
    g.lineWidth = w;
    g.beginPath();
    g.moveTo(from[0], from[1]);
    g.quadraticCurveTo(k[0], k[1], e[0], e[1]);
    g.stroke();
    g.fillStyle = P.ink;
    g.beginPath();
    g.arc(e[0], e[1], w * 0.52, 0, Math.PI * 2);
    g.fill();
  };
  for (const l of o.legs) limb(hip, l, lw);
  for (const a of o.hands) limb(shoulder, a, lw * 0.85);

  g.save();
  g.translate(o.x, o.y);
  g.rotate(rot);
  g.scale(s, s);
  const tw = 11;
  const th = 13;
  const r = 3.2;
  g.fillStyle = P.ink;
  g.beginPath();
  g.moveTo(-tw / 2 + r, -th);
  g.arcTo(tw / 2, -th, tw / 2, -th + r, r);
  g.arcTo(tw / 2, 1.5, tw / 2 - r, 1.5, r * 0.7);
  g.arcTo(-tw / 2, 1.5, -tw / 2, 1.5 - r, r * 0.7);
  g.arcTo(-tw / 2, -th, -tw / 2 + r, -th, r);
  g.closePath();
  g.fill();

  const vx = -tw / 2 + 0.8;
  const vw = tw - 1.6;
  const vy = -th + 2.6;
  const vh = th * 0.66;
  g.fillStyle = o.vest.main;
  g.fillRect(vx, vy, vw, vh);
  g.fillStyle = o.vest.dark;
  g.fillRect(vx, vy + vh - 1, vw, 1);
  g.fillStyle = '#FFFFFF';
  g.fillRect(vx, vy + vh * 0.36, vw, 1.4);

  const hy = -th - 4.3;
  g.fillStyle = P.ink;
  g.beginPath();
  g.arc(0, hy, 4.3, 0, Math.PI * 2);
  g.fill();
  if (o.hat !== false) {
    g.beginPath();
    g.arc(0, hy - 2.0, 3.8, Math.PI, Math.PI * 2);
    g.closePath();
    g.fill();
    g.beginPath();
    g.ellipse(o.look * 0.7, hy - 2.1, 5.0, 0.95, 0, 0, Math.PI * 2);
    g.fill();
  }
  const ex = o.look * 1.1;
  g.fillStyle = P.paper;
  if (o.eyes === 'x') {
    g.strokeStyle = P.paper;
    g.lineWidth = 0.75;
    for (const dx of [-1.2, 2.0]) {
      g.beginPath();
      g.moveTo(dx - 1, hy - 0.2);
      g.lineTo(dx + 1, hy + 1.8);
      g.moveTo(dx + 1, hy - 0.2);
      g.lineTo(dx - 1, hy + 1.8);
      g.stroke();
    }
  } else {
    g.beginPath();
    g.arc(ex + 1.7, hy + 0.9, 0.85, 0, Math.PI * 2);
    g.arc(ex - 1.0, hy + 0.9, 0.85, 0, Math.PI * 2);
    g.fill();
  }
  g.restore();
}

/** The tower's own painted floor number, behind everything, as on the capsules. */
function bnumeral(g, text, cx, cy, h) {
  const n = stencil(text, h, P.dust, h * 0.02, true);
  g.save();
  g.globalAlpha = 0.34;
  g.drawImage(n.canvas, cx - n.canvas.width / 2, cy - n.canvas.height / 2);
  g.restore();
}

const STAND = [{ h: [4, 10], e: [3, 5] }, { h: [-5, 10], e: [-4, 5] }];
const BRACED = [{ h: [11, 10], e: [7, 6] }, { h: [-9, 10], e: [-6, 7] }];
const DANGLE = [{ h: [4, 13], e: [5, 6] }, { h: [-2, 14], e: [2, 7] }];
const SPRAWL = [{ h: [9, 12], e: [7, 5] }, { h: [-8, 13], e: [-5, 6] }];

/**
 * One drawing per achievement, keyed by the API name so the badge cannot drift
 * from the unlock it belongs to. Several of the achievements are jokes and the
 * drawing is expected to be in on it: the hundredth death is a chalk-outline
 * pose with the hat somewhere else, and Human Scaffolding is two men being used
 * as scaffolding.
 */
const PICTOS = {
  // The flag is planted and the rope is still in a coil at his heels: he has
  // reached a checkpoint but has not yet found out what the other end is for.
  FIRST_STEPS: (g) => {
    g.strokeStyle = P.ink;
    g.lineWidth = 2;
    g.beginPath();
    g.moveTo(47, GND);
    g.lineTo(47, 16);
    g.stroke();
    g.fillStyle = P.red;
    g.beginPath();
    g.moveTo(47.5, 17);
    g.lineTo(61, 22);
    g.lineTo(47.5, 27);
    g.closePath();
    g.fill();
    bcoil(g, 11, GND - 2, 6);
    bhauler(g, {
      x: 25, y: GND - 10, s: 0.95, look: 1, vest: VEST.orange, legs: STAND,
      hands: [{ h: [13, -14], e: [10, -7] }, { h: [-8, 1], e: [-8, -6] }],
    });
  },

  // The load is up on the last ledge and the hook has been thrown off it: the
  // Long Haul, finished, in the one second before something rolls off.
  FIRST_HAUL: (g) => {
    brope(g, 37, 1, 43, 12, 45, 22, 2.2);
    bhook(g, 45, 26, 3);
    bledge(g, -2, 36, 50, 6);
    bcrate(g, 22, 27, 26, 19, 0);
    bdust(g, 40, 35, 3, 4);
  },

  // Two hands under it and not a board out of place. The crate is the only
  // thing in the frame because for one whole run it was the only thing anyone
  // was thinking about.
  FLAWLESS_CRATE: (g) => {
    g.strokeStyle = P.ink;
    g.lineWidth = 3;
    g.lineCap = 'round';
    g.beginPath();
    g.moveTo(6, GND);
    g.quadraticCurveTo(10, 38, 19, 35);
    g.moveTo(58, GND);
    g.quadraticCurveTo(54, 38, 45, 35);
    g.stroke();
    g.fillStyle = P.ink;
    g.beginPath();
    g.arc(19, 35, 2, 0, Math.PI * 2);
    g.arc(45, 35, 2, 0, Math.PI * 2);
    g.fill();
    bcrate(g, 32, 24, 30, 23, 0);
  },

  // Twenty five of them. The hook is still swinging and empty, which is how it
  // always looks a quarter of a second too late.
  BUTTERFINGERS: (g) => {
    brope(g, 33, 1, 28, 8, 26, 15, 2.2);
    bhook(g, 26, 19, 3);
    g.strokeStyle = P.ink;
    g.lineWidth = 1.4;
    g.lineCap = 'round';
    for (const a of [-2.5, -1.9, -1.2, -0.5, 0.2]) {
      g.beginPath();
      g.moveTo(32 + Math.cos(a) * 9, 41 + Math.sin(a) * 7);
      g.lineTo(32 + Math.cos(a) * 15, 41 + Math.sin(a) * 12);
      g.stroke();
    }
    bplank(g, 15, 42, 17, 5, -0.55, true);
    bplank(g, 48, 39, 15, 5, 0.6, false);
    bplank(g, 24, GND - 4, 19, 5, 0.12, false);
    bplank(g, 44, GND - 2, 14, 4, -0.22, true);
    bplank(g, 33, 35, 12, 4, 0.95, false);
  },

  // A hundred. He is not hurt, he is just lying there because it is quicker
  // than admitting whose fault it was.
  HUNDRED_DEATHS: (g) => {
    bhauler(g, {
      x: 31, y: 47, s: 0.85, rot: -1.55, look: 1, hat: false, eyes: 'x', vest: VEST.orange,
      legs: [{ h: [3, 13], e: [2, 7] }, { h: [-4, 12], e: [-3, 6] }],
      hands: [{ h: [5, -9], e: [3, -11] }, { h: [-6, -6], e: [-3, -10] }],
    });
    bhat(g, 51, GND - 3, 0.95, -0.35);
    g.strokeStyle = P.ink;
    g.lineWidth = 1.4;
    g.lineCap = 'round';
    for (const a of [-2.2, -1.6, -1.0]) {
      g.beginPath();
      g.moveTo(13 + Math.cos(a) * 7, 44 + Math.sin(a) * 7);
      g.lineTo(13 + Math.cos(a) * 11, 44 + Math.sin(a) * 11);
      g.stroke();
    }
  },

  // He did not mean it. The rope went tight, the ledge ran out, and his mate
  // left the building.
  BETRAYAL: (g) => {
    bledge(g, -2, 34, 30, 6);
    brope(g, 23, 17, 36, 27, 47, 43, 2.2);
    bhauler(g, {
      x: 14, y: 24, s: 0.8, look: 1, vest: VEST.orange, legs: BRACED,
      hands: [{ h: [11, -9], e: [7, -6] }, { h: [9, -3], e: [5, -2] }],
    });
    bdust(g, 27, 33, 3, 4);
    bhauler(g, {
      x: 47, y: 43, s: 0.72, rot: 0.5, look: -1, vest: VEST.lime, legs: SPRAWL,
      hands: [{ h: [7, -17], e: [6, -10] }, { h: [-9, -12], e: [-7, -8] }],
    });
  },

  // A hundred times, which stopped being an accident somewhere around the
  // fourth. He is not even watching this one go.
  BETRAYAL_100: (g) => {
    bledge(g, -2, 26, 24, 5);
    brope(g, 17, 12, 24, 20, 31, 28, 1.9);
    bhauler(g, {
      x: 10, y: 20, s: 0.62, look: -1, vest: VEST.orange, legs: BRACED,
      hands: [{ h: [11, -11], e: [7, -7] }, { h: [-9, -6], e: [-8, -2] }],
    });
    const fall = [[32, 29, 0.42, 0.5], [43, 38, 0.5, 0.9], [55, 47, 0.58, 1.3]];
    for (const [x, y, s, rot] of fall) {
      bhauler(g, {
        x, y, s, rot, look: -1, vest: VEST.lime, legs: SPRAWL,
        hands: [{ h: [8, -16], e: [7, -9] }, { h: [-9, -13], e: [-7, -8] }],
      });
    }
  },

  // A ledge neither of them can reach, and the only ladder on site is a man.
  FIRST_BOOST: (g) => {
    bledge(g, -2, 6, 26, 5);
    bhauler(g, {
      x: 32, y: GND - 7.5, s: 0.75, look: -1, vest: VEST.orange, legs: STAND,
      hands: [{ h: [5, -24], e: [7, -17] }, { h: [-5, -24], e: [-7, -17] }],
    });
    bhauler(g, {
      x: 32, y: 21, s: 0.62, look: -1, vest: VEST.lime,
      legs: [{ h: [4, 10], e: [5, 5] }, { h: [-4, 10], e: [-5, 5] }],
      hands: [{ h: [-13, -21], e: [-9, -14] }, { h: [8, -16], e: [7, -9] }],
    });
  },

  // A hundred boosts. At some point the pair of them stopped being climbers
  // and became site equipment.
  BOOST_100: (g) => {
    const legs = [{ h: [4, 10], e: [3, 5] }, { h: [-4, 10], e: [-3, 5] }];
    const up = [{ h: [5, -23], e: [7, -16] }, { h: [-5, -23], e: [-7, -16] }];
    bhauler(g, { x: 15, y: GND - 7, s: 0.7, look: 1, vest: VEST.orange, legs, hands: up });
    bhauler(g, { x: 45, y: GND - 7, s: 0.7, look: -1, vest: VEST.lime, legs, hands: up });
    g.fillStyle = P.cargo;
    g.fillRect(3, 26, 58, 4);
    g.strokeStyle = P.ink;
    g.lineWidth = 1.3;
    g.strokeRect(3, 26, 58, 4);
    bhauler(g, {
      x: 33, y: 21, s: 0.5, look: 1, vest: VEST.orange, legs,
      hands: [{ h: [12, -13], e: [8, -8] }, { h: [-11, -14], e: [-8, -8] }],
    });
  },

  // Five hundred moments of being the thing the other end of the rope is
  // attached to. A load-bearing friend, holding up the floor above.
  ANCHOR_500: (g) => {
    bledge(g, -2, 15, 50, 7);
    g.strokeStyle = P.dust;
    g.lineWidth = 0.9;
    g.beginPath();
    g.arc(45, 22, 19, 0.55, 1.65);
    g.stroke();
    brope(g, 45, 22, 47, 30, 50, 39, 2.2);
    bhauler(g, {
      x: 22, y: GND - 10, s: 0.95, look: 1, vest: VEST.orange, legs: BRACED,
      hands: [{ h: [6, -23], e: [8, -16] }, { h: [-6, -23], e: [-8, -16] }],
    });
    bdust(g, 12, GND - 1, -3, 4);
    bhauler(g, {
      x: 50, y: 39, s: 0.6, rot: 0.35, look: -1, vest: VEST.lime, legs: SPRAWL,
      hands: [{ h: [7, -16], e: [6, -9] }, { h: [-8, -14], e: [-7, -8] }],
    });
  },

  // Ten floors of Gauntlet, counted off in ledges, with the floor number
  // painted on the tower behind them the way the yard numbers everything.
  GAUNTLET_10: (g) => {
    bnumeral(g, '10', 33, 32, 34);
    for (let i = 0; i < 6; i++) {
      const y = GND - 3 - i * 6;
      bledge(g, i % 2 === 0 ? 2 : 30, y, 32, 3.4);
    }
    bhauler(g, {
      x: 44, y: 14, s: 0.5, look: -1, vest: VEST.orange, legs: STAND,
      hands: [{ h: [10, -14], e: [8, -8] }, { h: [-8, -2], e: [-8, -8] }],
    });
  },

  // Twice as far up the same tower: twice the ledges, half as deep, and the
  // climber is a speck on the top one.
  GAUNTLET_20: (g) => {
    bnumeral(g, '20', 33, 32, 34);
    for (let i = 0; i < 11; i++) {
      const y = GND - 2 - i * 3.1;
      bledge(g, i % 2 === 0 ? 4 : 32, y, 28, 1.8);
    }
    bhauler(g, {
      x: 46, y: 14, s: 0.42, look: -1, vest: VEST.lime, legs: STAND,
      hands: [{ h: [10, -14], e: [8, -8] }, { h: [-8, -2], e: [-8, -8] }],
    });
  },

  // Twelve minutes for the whole tower. The crate goes up the frame with the
  // yard's own chevrons under it and the line still snapping tight.
  SPEEDRUN: (g) => {
    for (let i = 0; i < 3; i++) bchev(g, 32, GND - 3 - i * 7, 22, 7);
    brope(g, 34, 1, 33, 6, 33, 12, 2.2);
    g.strokeStyle = P.ink;
    g.lineWidth = 1.3;
    g.lineCap = 'round';
    for (const [x, y, l] of [[14, 26, 9], [50, 22, 8], [17, 14, 6], [48, 34, 6]]) {
      g.beginPath();
      g.moveTo(x, y);
      g.lineTo(x, y + l);
      g.stroke();
    }
    bcrate(g, 33, 23, 25, 20, 0.1);
  },

  // Nobody died, nothing broke, and they are both looking at each other about
  // it. The whole picture is level, which never happens.
  NO_DEATHS: (g) => {
    bcrate(g, 32, 36, 21, 17, 0);
    bhauler(g, {
      x: 13, y: GND - 10, s: 0.8, look: 1, vest: VEST.orange, legs: STAND,
      hands: [{ h: [11, -9], e: [8, -5] }, { h: [-7, 3], e: [-8, -4] }],
    });
    bhauler(g, {
      x: 51, y: GND - 10, s: 0.8, look: -1, vest: VEST.lime, legs: STAND,
      hands: [{ h: [-11, -9], e: [-8, -5] }, { h: [7, 3], e: [8, -4] }],
    });
  },

  // A thousand metres, measured off a staff like any other survey, with the
  // man who climbed it the smallest thing in the frame.
  ONE_KILOMETRE: (g) => {
    g.fillStyle = P.tileBody;
    g.fillRect(0, 0, 27, GND);
    g.fillStyle = 'rgba(27,23,20,0.10)';
    for (let y = 5; y < GND; y += 8) g.fillRect(0, y, 27, 1.2);
    g.fillStyle = P.ink;
    g.fillRect(25.6, 0, 1.6, GND);
    g.fillStyle = P.ink;
    g.fillRect(46, 6, 1.4, GND - 6);
    for (let i = 0; i < 11; i++) {
      const y = GND - 2 - i * 4.3;
      g.fillRect(i % 5 === 0 ? 39 : 42, y, i % 5 === 0 ? 7 : 4, 1.2);
    }
    g.fillStyle = P.red;
    g.beginPath();
    g.moveTo(46, 9);
    g.lineTo(39, 12);
    g.lineTo(46, 15);
    g.closePath();
    g.fill();
    bhauler(g, {
      x: 20, y: GND - 5, s: 0.45, look: 1, vest: VEST.orange,
      legs: [{ h: [5, 10], e: [4, 5] }, { h: [-6, 8], e: [-5, 4] }],
      hands: [{ h: [7, -18], e: [7, -12] }, { h: [-7, -14], e: [-8, -9] }],
    });
  },

  // Twenty five runs and they are sitting on the same girder, which after
  // everything that has happened on it is the achievement.
  MARATHON: (g) => {
    bledge(g, -2, 32, 68, 7);
    bcoil(g, 9, 30, 5);
    bhauler(g, {
      x: 28, y: 32, s: 0.75, look: 1, vest: VEST.orange, legs: DANGLE,
      hands: [{ h: [13, -12], e: [8, -13] }, { h: [-8, -2], e: [-8, -7] }],
    });
    bhauler(g, {
      x: 39, y: 32, s: 0.75, look: -1, vest: VEST.lime, legs: DANGLE,
      hands: [{ h: [-13, -12], e: [-8, -13] }, { h: [8, -2], e: [8, -7] }],
    });
    brope(g, 55, 33, 59, 42, 57, GND, 2);
  },

  // A hidden achievement shows as "???" until it is earned, so the locked badge
  // gets the plate and not the drawing.
  '?': (g) => {
    const m = stencil('?', 40, P.ink, 0, false);
    g.drawImage(m.canvas, 32 - m.canvas.width / 2, 25 - m.asc / 2 - m.pad);
  },
};

/**
 * An achievement badge, at the 64x64 Steam shows in the overlay and on the
 * profile.
 *
 * It is the same yard as the capsules — paper ground, a corner of painted
 * livery, one hazard strip and a hard ink frame — because that is the size at
 * which a player decides whether these belong to the same game as the store
 * page. Inside the frame each one is a drawing of the thing it is for: sixteen
 * plates that differ only in their lettering are a wall of beige in the overlay
 * grid, and a monogram tells a player nothing he cannot already read in the
 * name printed next to it.
 *
 * The locked variant is the achieved one drawn again and then drained: a
 * saturation blend against flat grey, then a wash of paper over the top. Doing
 * it as a post-pass rather than a second palette means a locked icon can never
 * disagree with its achieved twin about anything but colour.
 */
function achievementBadge(subject, mark, order, achieved, size) {
  const canvas = document.getElementById('c');
  canvas.width = size;
  canvas.height = size;
  const ctx = canvas.getContext('2d');
  const u = size / 64;

  ctx.fillStyle = P.paper;
  ctx.fillRect(0, 0, size, size);

  // A corner flash in one of the three painted yard liveries, picked off the
  // badge's own number, so a row of them in the overlay grid has some colour
  // running down it that is not the vests.
  const painted = P.livery.slice(0, 3);
  const flash = painted[Math.floor(hash(order * 9 + 5) * painted.length) % painted.length];
  ctx.fillStyle = flash;
  ctx.beginPath();
  ctx.moveTo(size, 0);
  ctx.lineTo(size, 21 * u);
  ctx.lineTo(size - 21 * u, 0);
  ctx.closePath();
  ctx.fill();

  // The same hazard strip the girders wear, boxed by an ink rule.
  const bandH = 11 * u;
  ctx.fillStyle = chevron(ctx, Math.max(5, Math.round(8 * u)));
  ctx.fillRect(0, size - bandH, size, bandH);
  ctx.fillStyle = P.ink;
  ctx.fillRect(0, size - bandH, size, Math.max(1.2, 1.6 * u));

  // The drawing, in the 64-unit space it is authored in. An achievement that
  // core has but no pictogram has been drawn for falls back to the initials
  // plate, fitted rather than assumed: three initials have to survive at the
  // same plate size as one.
  ctx.save();
  ctx.scale(u, u);
  const picto = PICTOS[subject];
  if (picto) {
    picto(ctx);
  } else {
    const maxW = 50;
    let markSize = 32;
    let m = stencil(mark, markSize, P.ink, markSize * 0.04);
    if (m.capW > maxW) {
      markSize *= maxW / m.capW;
      m = stencil(mark, markSize, P.ink, markSize * 0.04);
    }
    ctx.drawImage(m.canvas, (64 - m.canvas.width) / 2, (GND - m.asc) / 2 - m.pad + 2);
  }
  ctx.restore();

  ctx.strokeStyle = P.ink;
  ctx.lineWidth = Math.max(1.4, 2 * u);
  ctx.strokeRect(ctx.lineWidth / 2, ctx.lineWidth / 2, size - ctx.lineWidth, size - ctx.lineWidth);

  if (!achieved) {
    ctx.globalCompositeOperation = 'saturation';
    ctx.fillStyle = '#808080';
    ctx.fillRect(0, 0, size, size);
    ctx.globalCompositeOperation = 'source-over';
    ctx.fillStyle = 'rgba(244,239,226,0.35)';
    ctx.fillRect(0, 0, size, size);
  }
}

// The layout named in STEAM_ASSETS is the design, except 'logo', which is the
// wordmark alone on transparency and reaches the renderer under that name so it
// can skip the scene. Anything unrecognised falls back to the wide capsule.
window.renderAsset = (w, h, layout) => render([layout, w, h]);
window.renderIcon = (size) => icon(size);
window.renderAchievement = (subject, mark, order, achieved, size) =>
  achievementBadge(subject, mark, order, achieved, size);
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
mkdirSync(ACHIEVEMENT_DIR, { recursive: true });
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

// Achieved and locked, for every achievement Steam is configured with. JPEG
// because that is the extension steam/achievements.json points the uploader at,
// and the badges are flat colour with no transparency to lose.
await page.setViewportSize({ width: ACHIEVEMENT_ICON, height: ACHIEVEMENT_ICON });
for (const [index, def] of ACHIEVEMENT_DEFS.entries()) {
  const mark = achievementMark(def.name);
  for (const achieved of [true, false]) {
    // A hidden achievement shows as "???" until it is earned, so its locked
    // badge should not give away the answer either.
    const subject = achieved || !def.hidden ? def.id : '?';
    await page.evaluate(
      ([s, m, order, on, size]) => window.renderAchievement(s, m, order, on, size),
      [subject, mark, index + 1, achieved, ACHIEVEMENT_ICON],
    );
    const buffer = await page.locator('#c').screenshot({ type: 'jpeg', quality: 94 });
    writeFileSync(join(ACHIEVEMENT_DIR, `${def.id.toLowerCase()}${achieved ? '' : '_locked'}.jpg`), buffer);
  }
}
console.log(`  ${ACHIEVEMENT_DEFS.length * 2} achievement icons in ${ACHIEVEMENT_DIR}/`);

writeFileSync(join(ICON_DIR, 'icon.ico'), buildIco(iconImages.filter((i) => i.size <= 256)));
writeFileSync(join(ICON_DIR, 'icon.icns'), buildIcns(iconImages.filter((i) => i.size >= 128)));
console.log(`  ${join(ICON_DIR, 'icon.ico')}`);
console.log(`  ${join(ICON_DIR, 'icon.icns')}`);

await browser.close();
console.log(`\nStore art in ${STORE_DIR}/ and installer icons in ${ICON_DIR}/`);
