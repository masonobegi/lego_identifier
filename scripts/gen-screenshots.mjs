/**
 * Photograph the game, from the game.
 *
 * The README's screenshots and the store page's screenshots were both taken by
 * hand, once, and then the art direction was rewritten underneath them. Nothing
 * complained, because a stale PNG looks exactly like a fresh one. So this exists
 * to make them a build artefact rather than a memory: `npm run shots` and every
 * picture in the repo is of the game that is actually in the repo.
 *
 * It drives the real single-file build in a real browser — the same one
 * `npm run e2e` uses — so what it captures is what a player sees, not a mock-up
 * of it. Steam wants 1920x1080; the docs want something that fits on a page, so
 * both sizes come out of one pass.
 */
import { chromium } from 'playwright';
import { findChromium } from './chromium.mjs';
import { existsSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { requireFreshBuild } from './fresh.mjs';

const BUILD = 'dist/haulmates.html';

// The store page is made of these. A stale one is a screenshot of a game that
// no longer exists.
requireFreshBuild(['web'], 'npm run build && npm run web');
const DOCS = join('docs', 'screenshots');
const STORE = join('steam', 'store', 'screenshots');

if (!existsSync(BUILD)) {
  console.error(`Build the single-file client first: npm run web  (missing ${BUILD})`);
  process.exit(1);
}
mkdirSync(DOCS, { recursive: true });
mkdirSync(STORE, { recursive: true });

/**
 * Where to stand the pair for each biome shot, as a fraction of the way up.
 *
 * The campaign's four biomes are stacked, so a height is a biome. Picking them
 * explicitly rather than playing up to them keeps this quick and, more usefully,
 * deterministic — a screenshot that depends on how a bot happened to play is a
 * screenshot that changes for no reason every time anyone touches the bot.
 */
const BIOME_SHOTS = [
  { name: 'yard', frac: 0.12, caption: 'THE YARD' },
  { name: 'foundry', frac: 0.4, caption: 'THE FOUNDRY' },
  { name: 'freezer', frac: 0.66, caption: 'THE FREEZER' },
  { name: 'spire', frac: 0.92, caption: 'THE SPIRE' },
];

const browser = await chromium.launch({ executablePath: findChromium() });
const errors = [];

/** Capture one page state at both sizes. */
async function shoot(page, name) {
  await page.setViewportSize({ width: 1920, height: 1080 });
  await page.waitForTimeout(320);
  await page.screenshot({ path: join(STORE, `${name}.png`) });
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.waitForTimeout(320);
  await page.screenshot({ path: join(DOCS, `${name}.png`) });
  console.log(`  ${name}`);
}

async function open() {
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.goto(`file://${process.cwd()}/${BUILD}`);
  await page.waitForFunction(() => Boolean(window.HAULMATES), null, { timeout: 20000 });
  await page.waitForTimeout(500);
  return page;
}

console.log('Menus:');
{
  const page = await open();
  await shoot(page, 'title');
  for (const id of ['controls', 'customise', 'achievements', 'couch']) {
    await page.evaluate((s) => window.HAULMATES.show(s), id);
    await shoot(page, id);
  }
  await page.close();
}

console.log('Gameplay:');
{
  const page = await open();
  await page.evaluate(() => {
    const app = window.HAULMATES;
    app.botPartner = true;
    app.startCouch();
    // Silence the coaching. The tutorial hint and the achievement toast both
    // land in the middle of the frame, and a screenshot of a game explaining
    // its controls is a screenshot of a tutorial.
    const quiet = () => {
      app.hintStrength = 0;
      app.hintText = '';
      if (app.achievements && app.achievements.pending) app.achievements.pending.length = 0;
      if (app.toasts) app.toasts.length = 0;
      // Staging a shot means teleporting the pair around, which kills them
      // repeatedly. A hero shot reading "27 DEATHS" at twelve seconds is a
      // screenshot of the screenshot script, not of the game.
      const w = app.local.world;
      w.players[0].deaths = 0;
      w.players[1].deaths = 0;
      w.cargoBreaks = 0;
      w.betrayals = 0;
      window.__quiet = requestAnimationFrame(quiet);
    };
    quiet();
  });
  await page.waitForTimeout(1200);

  for (const shot of BIOME_SHOTS) {
    await page.evaluate((frac) => {
      const app = window.HAULMATES;
      const w = app.local.world;
      const level = app.local.ctx.level;
      const y = level.heightPx * (1 - frac);
      // Hold the pair in place across the frames the screenshot spans, so the
      // camera settles and the shot is not of them falling out of the sky.
      const hold = () => {
        for (let i = 0; i < 2; i++) {
          const p = w.players[i];
          p.x = level.spawnX + (i ? 34 : -34);
          p.y = y;
          p.vx = 0;
          p.vy = 0;
          p.dead = 0;
          p.grounded = 1;
        }
        const n = w.ropeX.length;
        for (let i = 0; i < n; i++) {
          const t = i / (n - 1);
          w.ropeX[i] = w.players[0].x + (w.players[1].x - w.players[0].x) * t;
          w.ropeY[i] = y;
          w.ropePX[i] = w.ropeX[i];
          w.ropePY[i] = y;
        }
        // The crate, in frame. Left alone it hangs a full rope-length below a
        // pair standing on a ledge, which is correct behaviour and puts the
        // subject of the game off the bottom of the picture.
        w.cargo.x = level.spawnX;
        w.cargo.y = y + 46;
        w.cargo.px = w.cargo.x;
        w.cargo.py = w.cargo.y;
        w.cargo.hp = 100;
        window.__hold = requestAnimationFrame(hold);
      };
      hold();
    }, shot.frac);
    await page.waitForTimeout(900);
    await shoot(page, `biome-${shot.name}`);
    await page.evaluate(() => cancelAnimationFrame(window.__hold));
  }

  // The gate: the only thing in the game two people can do and one cannot, and
  // therefore the one picture that says what this is rather than what genre it
  // is in. One hauler braced at the foot of a step with no foothold in it, the
  // other stood against them about to go up off their shoulders, and the
  // stencil the level paints over it to say so.
  await page.evaluate(() => {
    const app = window.HAULMATES;
    const w = app.local.world;
    const level = app.local.ctx.level;
    // From the app's own cache, filled by the hint system, which is filled by
    // the same fill that proves the tower climbable — so this can never point
    // at somewhere that is not a gate.
    const gates = Array.isArray(app.gateCells) ? app.gateCells.slice() : [];
    const gate = gates.sort((a, b) => b.y - a.y)[0];
    if (!gate) throw new Error('no gates found to photograph');
    if (!gate) return;
    const TILE = 24;
    // On the gate cell itself, which is standable by definition — the ledge
    // it is launched from sits somewhere else along the row and putting the
    // pair there drops them into the gap.
    const y = (gate.y + 1) * TILE - 17;
    const hold = () => {
      for (let i = 0; i < 2; i++) {
        const p = w.players[i];
        p.x = gate.x * TILE + TILE / 2 + (i ? 13 : -13);
        p.y = y;
        p.vx = 0;
        p.vy = 0;
        p.dead = 0;
        p.grounded = 1;
        p.grip = 210;
      }
      // The brace, holding. The renderer draws a gripping hauler differently,
      // which is most of what makes the picture legible.
      w.players[1].gripping = 1;
      const n = w.ropeX.length;
      for (let i = 0; i < n; i++) {
        const t = i / (n - 1);
        w.ropeX[i] = w.players[0].x + (w.players[1].x - w.players[0].x) * t;
        w.ropeY[i] = y;
        w.ropePX[i] = w.ropeX[i];
        w.ropePY[i] = y;
      }
      w.cargo.x = w.ropeX[(n - 1) >> 1];
      w.cargo.y = y + 46;
      w.cargo.px = w.cargo.x;
      w.cargo.py = w.cargo.y;
      w.cargo.hp = 100;
      window.__gate = requestAnimationFrame(hold);
    };
    hold();
  });
  await page.waitForTimeout(900);
  await shoot(page, 'gate');
  await page.evaluate(() => cancelAnimationFrame(window.__gate));

  // The hero shot the README leads with: the pair mid-climb, crate on the rope.
  await page.evaluate(() => {
    const app = window.HAULMATES;
    const w = app.local.world;
    const level = app.local.ctx.level;
    const y = level.heightPx * 0.78;
    for (let i = 0; i < 2; i++) {
      const p = w.players[i];
      p.x = level.spawnX + (i ? 30 : -30);
      p.y = y - (i ? 70 : 0);
      p.vx = 0;
      p.vy = 0;
      p.dead = 0;
    }
    const n = w.ropeX.length;
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1);
      w.ropeX[i] = w.players[0].x + (w.players[1].x - w.players[0].x) * t;
      w.ropeY[i] = w.players[0].y + (w.players[1].y - w.players[0].y) * t;
      w.ropePX[i] = w.ropeX[i];
      w.ropePY[i] = w.ropeY[i];
    }
    const mid = (n - 1) >> 1;
    w.cargo.x = w.ropeX[mid];
    w.cargo.y = w.ropeY[mid] + 40;
    w.cargo.px = w.cargo.x;
    w.cargo.py = w.cargo.y;
    w.cargo.hp = 100;
  });
  await page.waitForTimeout(700);
  await shoot(page, 'gameplay');

  // The results screen. It is the funniest thing in the game and it is what a
  // shopper reads if they only look at one picture — so the numbers on it have
  // to be real. Finishing a freshly staged run photographs a twelve-second
  // flawless delivery, which is honest about nothing: it makes the game look
  // trivial and every stat on the card reads zero. So let the bots actually
  // play for a few minutes first, at speed, and photograph what they did.
  await page.evaluate(() => {
    const app = window.HAULMATES;
    cancelAnimationFrame(window.__quiet);
    // Played badly, on purpose, by two hands that do not know what they are
    // doing — which is what the first hour of this game is for everybody.
    //
    // The bot pair was the obvious choice and it is the wrong one: they play
    // carefully, so after three and a half minutes the card read all zeroes.
    // A results screen with nothing on it says "nothing happens in this game",
    // which is a worse lie than the twelve-second run it replaced. These are
    // real inputs through the real simulation, from a fixed seed so the picture
    // is the same every time it is taken.
    app.local.setBot(0, null);
    app.local.setBot(1, null);
    let seed = 0x5eed1234;
    const rnd = () => {
      seed = (seed * 1664525 + 1013904223) >>> 0;
      return seed / 4294967296;
    };
    const masks = [0, 0];
    const target = app.local.world.tick + 200 * 60;
    let guard = 0;
    while (app.local.world.tick < target && guard++ < 40000) {
      for (let i = 0; i < 2; i++) {
        const r = rnd();
        // Mostly walking, sometimes jumping, occasionally gripping. Enough
        // structure that they climb a bit, enough chaos that they fall.
        let m = r < 0.42 ? 1 : r < 0.84 ? 2 : 0;   // IN_LEFT / IN_RIGHT
        if (rnd() < 0.22) m |= 4;                  // IN_JUMP
        if (rnd() < 0.12) m |= 8;                  // IN_GRIP
        if (rnd() < 0.06) m |= 16;                 // IN_REEL
        masks[i] = m;
      }
      app.local.update(250, masks);
      app.local.events.length = 0;
    }
  });
  await page.waitForTimeout(400);
  await page.evaluate(() => {
    const app = window.HAULMATES;
    app.local.world.finished = 1;
    app.local.world.finishTick = app.local.world.tick;
  });
  await page.waitForTimeout(1400);
  await shoot(page, 'results');
  await page.close();
}

await browser.close();

if (errors.length) {
  console.error('\nPage errors while shooting:');
  for (const e of errors.slice(0, 5)) console.error(`  ${e}`);
  process.exit(1);
}
console.log(`\nWrote ${DOCS}/ (1280x720) and ${STORE}/ (1920x1080).`);
