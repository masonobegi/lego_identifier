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
  // Drawn from the thumbnail design, not shrunk from the wide one: this is
  // the size a shopper actually sees in a list, and a scaled-down capsule is mud.
  ['small-capsule-462x174', 462, 174, 'thumb'],
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

function render([mode, W, H]) {
  const canvas = document.getElementById('c');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');
  // Steam's library logo is the wordmark alone on transparency, laid over the
  // hero image the client already has. Everything below is skipped for it.
  const logoOnly = mode === 'logo';

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
   * The design is authored at three fixed sizes — 616x353 wide, 374x448 tall,
   * and 231x87 for the thumbnail, which is drawn rather than shrunk because a
   * scaled-down capsule is mud. Everything else Steam wants, from a 460x215
   * header to a 3840x1240 library hero, is one of those three fitted into the
   * frame and centred, at a uniform scale so the figures never stretch.
   *
   * Two rules keep the fit from tearing the picture. Anything the design ran
   * off the edge on purpose — the girders, the tower — is pinned back to the
   * new edge rather than scaled inward, or a wide canvas would show a girder
   * stopping in mid-air. And the background is painted from the target's own
   * width and height, so the area the composition does not reach is more yard
   * rather than a letterbox.
   */
  const DESIGNS = {
    wide: {
      W: 616,
      H: 353,
      detail: 2,
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
      wm: {
        cx: ox + d.wm.cx * k,
        top: oy + d.wm.top * k,
        capH: d.wm.capH * k,
        maxW: d.wm.maxW * k,
        sub: d.wm.sub,
      },
      hazeY: d.hazeY,
      yardTop: d.yardTop,
      tower: { x1: ox + d.tower.x1 * k },
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
      anchor: { px: ox + d.anchor.px * k, py: oy + d.anchor.py * k, s: d.anchor.s * k, rot: d.anchor.rot },
      flyer: { px: ox + d.flyer.px * k, py: oy + d.flyer.py * k, s: d.flyer.s * k, rot: d.flyer.rot },
      sag: d.sag * k,
      crate: { w: d.crate.w * k, h: d.crate.h * k, rot: d.crate.rot, drop: d.crate.drop, t: d.crate.t },
      ropeW: d.ropeW * k,
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
  function hash(i) {
    let h = (i * 374761393) | 0;
    h = (h ^ (h >>> 13)) * 1274126177;
    return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
  }

  function chevron(size) {
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
  const CH_SIZE = Math.max(6, Math.round(H / 24));
  const CHEV = chevron(CH_SIZE);

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
    for (let i = 0; i < 3; i++) {
      const cx = W * (0.30 + 0.30 * i) + hash(11 + i) * W * 0.08;
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
  ctx.fillRect(-10, -10, T.x1 + 10, H + 20);

  if (D > 0) {
    ctx.fillStyle = 'rgba(27,23,20,0.10)';
    for (let y = H * 0.07; y < H; y += H * 0.21) ctx.fillRect(0, Math.round(y), T.x1, 1.6);
    ctx.fillStyle = P.tileDetail;
    for (let i = 0; i < 44; i++) {
      ctx.fillRect(hash(i * 3 + 1) * T.x1, hash(i * 5 + 2) * H, 3 + hash(i) * 10, 1.6);
    }
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
  // the mark there.
  ctx.fillStyle = P.ink;
  const edgeW = Math.max(2, W * 0.006);
  const edgeTop = L.wm.top + L.wm.capH + H * 0.06;
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

    ctx.save();
    ctx.translate(cx, cy);
    ctx.rotate(L.crate.rot);
    ctx.fillStyle = P.shadow;
    ctx.fillRect(-cw / 2 + rw, -ch / 2 + rw * 1.5, cw, ch);
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
      const f = stencil('FRAGILE', ch * 0.21, P.red, undefined, false);
      const fw = Math.min(f.canvas.width, cw * 0.86);
      ctx.drawImage(f.canvas, -fw / 2, -ch * 0.12, fw, f.canvas.height);
    }
    ctx.restore();
  })();

  /* -------------------------------------------------------------- haulers */
  const VEST = {
    orange: { main: '#FF6A00', dark: '#B23F00' },
    lime: { main: '#C8E82A', dark: '#7E9A0F' },
  };

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

  } // end of the scene; the wordmark below is drawn for every asset
  /* -------------------------------------------------------------- wordmark */
  (function wordmark() {
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

// Steam's layout names map onto the three authored designs, except 'logo',
// which is the wordmark alone on transparency and has to reach the renderer
// under that name so it can skip the scene.
window.renderAsset = (w, h, layout) =>
  render([layout === 'tall' || layout === 'thumb' || layout === 'logo' ? layout : 'wide', w, h]);
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
