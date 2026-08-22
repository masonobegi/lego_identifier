/**
 * How does this feel to somebody who is not very good at it?
 *
 * Every gate in this repo answers "can the level be finished by a perfect
 * player": the flood fill proves reachability, and `verify-levels.mjs`
 * brute-forces input scripts until one works. Both are necessary and neither
 * one has ever answered the question that actually decides whether anybody
 * keeps playing, which is how often an ordinary attempt succeeds.
 *
 * It turns out to matter enormously. Measured on the build where every gate
 * was green: 23.4% of plausible casual jump attempts landed, and five different
 * plausible two-player policies each climbed between three and nine rows of a
 * 651-row tower in three minutes, reaching none of the twenty checkpoints. The
 * game was provably completable and functionally unplayable at the same time,
 * and nothing in the repo could tell the difference. It is 67% and around 210
 * rows now, and every step of the way here was a number out of this file.
 *
 * The model of a player is the load-bearing part, and getting it wrong has
 * cost more time than anything it has found. In order, the versions that were
 * wrong: one that walked toward a fixed column, so it never aimed at a ledge;
 * one that re-picked its target in mid-air, so it dropped the ledge it was
 * flying at; one with no noise, so a step it could not do once it could never
 * do, and the tower appeared to have walls in it; one with no eyes for blades,
 * so a timed hazard read as an impassable one; and one that fled blades so
 * eagerly it never jumped. A person is sloppy, has memory of nothing, varies,
 * and can see. Model any of those wrong and this file will confidently
 * describe a different game.
 *
 * Two numbers come out of here, and tuning changes are judged on them:
 *
 *   REACH   Of every plausible way a person might attempt a jump — every
 *           launch column, a spread of timings, a spread of hold lengths —
 *           what fraction land? A precision platformer wants this high enough
 *           that failure reads as *your* mistake rather than the game's.
 *
 *   CLIMB   How far do plausible two-player policies actually get in three
 *           minutes? Nobody plays optimally on their first evening, so this is
 *           driven by policies a real pair might stumble into rather than by a
 *           solved input script.
 */
import {
  buildCampaign,
  buildTower,
  createWorld,
  step,
  TILE,
  PLAYER_H,
  GRIP_MAX,
  ROPE_NODES,
  CARGO_H,
  ROPE_REST,
  IN_JUMP,
  IN_LEFT,
  IN_RIGHT,
  IN_GRIP,
  IN_REEL,
  boosting,
  BOOST_REACH,
  MAX_RISE,
  sawX,
  sawY,
  tautPathLength,
  analyseLevel,
  ledgeSteps,
  Bot,
  LocalMatch,
  MODE_HAUL,
} from '../packages/core/dist/index.js';

/* ------------------------------------------------------------------ REACH */

function placePair(world, x, y) {
  const cx = x * TILE + TILE / 2;
  const cy = (y + 1) * TILE - PLAYER_H / 2 - 1;
  for (let i = 0; i < 2; i++) {
    const p = world.players[i];
    p.x = cx + (i === 0 ? -12 : 12);
    p.y = cy;
    p.vx = 0;
    p.vy = 0;
    p.grounded = 1;
    p.dead = 0;
    p.gripping = 0;
    p.coyote = 0;
    p.jumpBuffer = 0;
    p.jumpHeld = 0;
    p.grip = GRIP_MAX;
  }
  for (let i = 0; i < ROPE_NODES; i++) {
    const t = i / (ROPE_NODES - 1);
    world.ropeX[i] = world.players[0].x + (world.players[1].x - world.players[0].x) * t;
    world.ropeY[i] = cy;
    world.ropePX[i] = world.ropeX[i];
    world.ropePY[i] = cy;
  }
  world.cargo.x = cx;
  world.cargo.y = cy + (PLAYER_H - CARGO_H) / 2;
  world.cargo.px = world.cargo.x;
  world.cargo.py = world.cargo.y;
  world.cargo.hp = 100;
  world.cargo.calm = 0;
  world.restartTimer = 0;
}

/**
 * The attempt space of somebody who has not memorised the level.
 *
 * They stand somewhere on the ledge rather than on a computed launch column,
 * they hold the direction they want to go, and they press jump at roughly the
 * right moment for roughly the right length of time. Deliberately no run-ups
 * and no late steering: those are things a player learns, and this is the
 * measure of the first evening.
 */
export function reachRate(level, mode, seed, limit = 24) {
  const ctx = { level, seed, mode };
  // The pair's route. The solo fill stopped reaching the goal the moment the
  // levels grew gates, and a route that ends four ledges up measures nothing.
  const r = analyseLevel(level, { coop: true });
  const steps = ledgeSteps(level, r.route, r.standable).slice(0, limit);
  let tried = 0;
  let landed = 0;
  const perStep = [];

  for (const s of steps) {
    const toward = (s.to.x0 + s.to.x1) / 2 > (s.from.x0 + s.from.x1) / 2 ? IN_RIGHT : IN_LEFT;
    let ok = 0;
    let n = 0;
    for (let launch = s.from.x0; launch <= s.from.x1; launch++) {
      for (const jumpAt of [0, 6, 12, 18, 24, 30, 36]) {
        for (const hold of [8, 14, 20, 26]) {
          n++;
          tried++;
          const world = createWorld(ctx);
          placePair(world, launch, s.from.y);
          for (let t = 0; t < 4; t++) {
            step(ctx, world, [0, 0]);
            world.events.length = 0;
          }
          for (let t = 0; t < 150; t++) {
            const jumping = t >= jumpAt && t < jumpAt + hold;
            step(ctx, world, [toward | (jumping ? IN_JUMP : 0), IN_GRIP]);
            world.events.length = 0;
            if (world.restartTimer > 0) break;
            const p = world.players[0];
            if (p.dead || p.grounded !== 1) continue;
            const py = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1;
            // Landed anywhere higher than you set off from, not on one exact
            // row. Requiring the named ledge was the first version and it
            // scores an own goal: the footholds overlap now, so a full-hold
            // jump often sails past the ledge the route names and lands on the
            // one above it. That is the best possible outcome and it was being
            // counted as a miss — three of the four "hardest steps in the
            // campaign" turned out to be steps that were easy to overshoot.
            if (py < s.from.y) {
              ok++;
              landed++;
              break;
            }
          }
        }
      }
    }
    perStep.push(Math.round((100 * ok) / n));
  }

  return {
    rate: (100 * landed) / tried,
    tried,
    perStep,
    worst: Math.min(...perStep),
    dead: perStep.filter((p) => p === 0).length,
  };
}

/* ------------------------------------------------------------------ CLIMB */

/**
 * Ways two people who are still learning might actually play.
 *
 * The model of a person here is: good perception, sloppy execution. They can
 * see the next ledge — that is what eyes are for — so target selection comes
 * from the same route the build gate proves. What they cannot do is pick an
 * optimal launch column or hold the jump for exactly the right number of
 * frames, so the execution is deliberately imprecise and gets no run-up
 * planning, no arc check, and no late steering.
 *
 * An earlier version of this walked both players toward a fixed x and called
 * it a policy. It measured three rows on every tuning, including tunings that
 * had more than doubled the odds of landing a jump, because a player who never
 * aims at the next ledge does not climb however forgiving the jump is. A
 * measurement that cannot tell a good change from a bad one is worse than none.
 */
/** A deterministic stand-in for a person being slightly different each go. */
function noise(seed) {
  let s = (seed | 0) || 1;
  return () => {
    s = (Math.imul(s, 1664525) + 1013904223) | 0;
    return ((s >>> 8) & 0xffff) / 0x10000;
  };
}

export function makeFollower(level, phase = 0) {
  const r = analyseLevel(level, { coop: true });
  const cells = r.route;
  const stand = r.standable;
  const { w } = level;
  const standable = (x, y) => x >= 0 && x < w && y >= 0 && stand[y * w + x] === 1;
  /** The run of footing you are standing on, whose ends you can see. */
  const ledge = (x, y) => {
    let x0 = x;
    let x1 = x;
    while (standable(x0 - 1, y)) x0--;
    while (standable(x1 + 1, y)) x1++;
    return { x0, x1 };
  };
  // One latched target per player: the ledge they picked while they still had
  // their feet on something.
  const held = [null, null];
  // ...and where on the ledge they happen to be standing when they go.
  const spot = [0, 0];
  // Ticks left of a boost that is already under way.
  const lifting = [0, 0];
  const rnd = noise(phase * 2654435761 + 12345);

  /**
   * Is a blade about to be where I am?
   *
   * People wait for blades. Without this the instrument does not, and a tower
   * with timed hazards in it reads as a tower with walls in it — runs stalled
   * at exactly 453 rows of 651, and the four "hardest steps in the campaign"
   * at 15-19% of attempts landing turned out to be, every one of them, a step
   * with a saw sweeping the ledge. Which is the hazard doing its job. What was
   * wrong was a model of a person with no eyes.
   */
  const bladeComing = (world, p) => {
    for (const saw of level.saws) {
      // Where it will be when I get there, not anywhere it goes in the next
      // second. Smearing forty ticks of a blade's travel across the ledge marks
      // the whole ledge dangerous the whole time, and a follower that believes
      // that never jumps at all: it read 92 rows against 374 without the check.
      for (let ahead = 0; ahead <= 18; ahead += 6) {
        const sx = sawX(saw, world.tick + ahead);
        const sy = sawY(saw, world.tick + ahead);
        if (Math.abs(sy - p.y) < TILE * 1.5 && Math.abs(sx - p.x) < TILE * 1.8) return true;
      }
    }
    return false;
  };

  /** Which way to shuffle to get out from under a blade, or 0 to stay put. */
  const bladeFlee = (world, p) => {
    for (const saw of level.saws) {
      const sx = sawX(saw, world.tick);
      const sy = sawY(saw, world.tick);
      if (Math.abs(sy - p.y) > TILE * 1.5 || Math.abs(sx - p.x) > TILE * 2.6) continue;
      return sx > p.x ? -1 : 1;
    }
    return 0;
  };

  // People are noisy, and a policy that is not will get stuck forever.
  //
  // With a fixed cadence and a fixed aim, a pair that cannot make one
  // particular step cannot ever make it: the inputs at that ledge are the same
  // on the thousandth attempt as on the first, so the run ends there. Measured
  // over forty-five simulated minutes, that read as the tower having a wall in
  // it — two of three runs stopped dead at exactly the same row. It is not a
  // wall. It is a limit cycle, and the only thing wrong is the model of the
  // person: nobody stands on the same pixel and presses jump on the same frame
  // three hundred times. A little jitter in where they stand and how long they
  // hold it is what lets a human blunder past a step they cannot do on purpose,
  // and the instrument has to blunder too or it measures its own period.

  return (world, i, t, extra = 0) => {
    const p = world.players[i];
    const col = Math.floor(p.x / TILE);
    const row = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE) - 1;
    const grounded = p.grounded === 1;

    // Pick a target with your feet on the ground, and commit to it until you
    // land. Re-picking in mid-air is what an earlier version did, and it is not
    // a thing people do: rising past the row of the ledge you were aiming at
    // made it drop that ledge, re-aim at one further up that it could not
    // reach, stop steering at the apex, and fall back to exactly where it
    // started. It did that for three simulated minutes, on every tuning, which
    // is how a measurement that had stopped responding to the game looked
    // identical to a game that could not be climbed.
    if (grounded || held[i] === null) {
      let best = null;
      let bestCost = Infinity;
      for (const c of cells) {
        if (c.y >= row) continue;
        const cost = (row - c.y) * 3 + Math.abs(c.x - col);
        if (cost < bestCost) {
          bestCost = cost;
          best = c;
        }
      }
      held[i] = best;
      // Shuffle about a bit rather than standing on one mark forever.
      if (rnd() < 0.04) spot[i] = Math.round((rnd() - 0.5) * 5);
    }
    const target = held[i];
    if (!target) return 0;

    // A gate: the step with no foothold in the middle. Six rows is past what
    // anybody jumps, so the pair has to do the two-person move — one braces,
    // the other goes up off them, and then the one still down there hauls up
    // the rope. Modelled here because a person who has been shown the hint
    // will try it, and an instrument that has not been shown it would report
    // the gates as walls and every tuning above them as unreachable.
    if (grounded && row - target.y > MAX_RISE) {
      const mate = world.players[1 - i];
      const mateUp = mate.y < p.y - (MAX_RISE + 1) * TILE;
      if (mateUp) return IN_REEL | (rnd() < 0.3 ? IN_JUMP : 0);

      // One of them picks the place and the other comes to them.
      //
      // Both picking independently is a deadlock, and a quiet one: the climber
      // clamps the target column to the ledge it is standing on, the brace is
      // half a tile off the end of that ledge and clamps to where it already
      // is, and the two of them stand two columns apart — inside the rope,
      // outside the boost — for as long as you care to watch. Measured at the
      // second gate in the campaign: one boost, then fifty-nine seconds of
      // nothing, on every seed.
      if (i === 0) {
        const l = standable(col, row) ? ledge(col, row) : { x0: col, x1: col };
        const at = Math.max(l.x0, Math.min(l.x1, target.x));
        if (Math.abs(col - at) > 1) return at > col ? IN_RIGHT : IN_LEFT;
        // Keep holding once it has started. `boosting` asks whether your
        // partner is braced *beside* you, which stops being true the instant
        // you leave the ground — so a follower that reads it every tick lets
        // go two frames in and cuts its own jump short. Measured: four rows of
        // a six-row gate, over and over, on a gate that a held jump clears
        // from every column on the ledge.
        // Hold, then let go. A jump needs a *press*, so a follower that holds
        // the button from the moment a boost is available never jumps twice:
        // the first attempt fires and every one after it is swallowed, because
        // there is no rising edge left to swallow. Six boosts and then silence,
        // with the brace stood there ready and the bar full.
        if (lifting[i] > 0) {
          lifting[i]--;
          return lifting[i] > 8 ? IN_JUMP : 0;
        }
        if (boosting(world, 0)) {
          lifting[i] = 34;
          return IN_JUMP;
        }
        return 0;
      }
      if (Math.abs(mate.x - p.x) > BOOST_REACH * 0.7) return mate.x > p.x ? IN_RIGHT : IN_LEFT;
      return IN_GRIP;
    }

    // Walk toward it, but only as far as the footing goes — a bad player still
    // has eyes and does not stroll off the side of the platform they are on.
    let aim = target.x + spot[i];
    if (grounded && standable(col, row)) {
      const l = ledge(col, row);
      aim = Math.max(l.x0, Math.min(l.x1, aim));
    }
    // Get out from under a blade before worrying about where you were going.
    const flee = grounded ? bladeFlee(world, p) : 0;
    const dx = flee !== 0 ? flee : aim - col;
    let mask = dx > 0 ? IN_RIGHT : dx < 0 ? IN_LEFT : 0;
    // Jump on a rough cadence rather than on a computed launch mark, offset per
    // player so the pair does not move in lockstep, and per run so that two
    // tunings are not compared on one pair of hands. The campaign is a fixed
    // tower — its seed changes nothing — so the only honest way to run it more
    // than once is to vary the people playing it.
    const beat = (t + extra + phase) % (32 + (phase % 5));
    if (beat < 8 + Math.floor(rnd() * 6) && !bladeComing(world, p)) mask |= IN_JUMP;
    return mask;
  };
}

const POLICIES = {
  'both climb, no co-ordination': (follow) => (w, t) => [follow(w, 0, t, 0), follow(w, 1, t, 17)],
  // Both climb, and whoever feels the rope go tight stops and holds on. This
  // is the reflex, and it is the policy the rope is supposed to reward.
  //
  // It replaced one that blanked the lower player's input on a fixed timer,
  // which is not what "follow a beat later" means and is not a thing anybody
  // does: it left the player who most needed to catch up standing still for
  // half of every cycle, and read 16 rows on tunings where every other policy
  // read two hundred. A policy nobody would ever adopt is not a measurement.
  'both climb, brace when the rope bites': (follow, level) => (w, t) => {
    const out = [follow(w, 0, t, 0), follow(w, 1, t, 17)];
    if (tautPathLength(w, level) > ROPE_REST * 1.35) {
      const low = w.players[0].y > w.players[1].y ? 0 : 1;
      out[1 - low] = IN_GRIP;
    }
    return out;
  },
  'take turns, partner braces': (follow) => (w, t) => {
    const climber = Math.floor(t / 180) % 2;
    const out = [0, 0];
    out[climber] = follow(w, climber, t, 0);
    out[1 - climber] = IN_GRIP;
    return out;
  },
  'take turns, the low one reels': (follow) => (w, t) => {
    const climber = Math.floor(t / 180) % 2;
    const other = 1 - climber;
    const out = [0, 0];
    out[climber] = follow(w, climber, t, 0);
    out[other] = IN_GRIP;
    const p = w.players[climber];
    const q = w.players[other];
    if (Math.hypot(p.x - q.x, p.y - q.y) > ROPE_REST && q.y > p.y) out[other] |= IN_REEL;
    return out;
  },
};

/**
 * One policy, one seed, three minutes. Everything above the tower is noise.
 */
function runPolicy(mode, seed, towerLength, seconds, make, bot) {
  const m = new LocalMatch(mode, seed, towerLength);
  if (bot) m.setBot(1, new Bot(m.ctx.level));
  const follow = makeFollower(m.ctx.level, seed % 29);
  const policy = make ? make(follow, m.ctx.level) : (w, t) => [follow(w, 0, t, 0), 0];
  const w = m.world;
  const y0 = w.players[0].y;
  let best = y0;
  for (let t = 0; t < seconds * 60; t++) {
    m.update(1000 / 60, policy(w, t));
    m.events.length = 0;
    best = Math.min(best, w.players[0].y, w.players[1].y);
  }
  return {
    rows: (y0 - best) / TILE,
    checkpoints: w.checkpoint + 1,
    crates: w.cargoBreaks,
    deaths: w.players[0].deaths + w.players[1].deaths,
  };
}

/**
 * Averaged over several towers, because one is not a measurement.
 *
 * A single seed moved by more than a factor of two between tunings that could
 * not possibly have caused it — this is a chaotic simulation with two bodies on
 * a rope, and a crate that either catches a ledge or does not. Tuning against
 * one number meant tuning against which way a crate happened to bounce.
 */
export function climbTest(mode, seeds, towerLength, seconds = 180) {
  const mean = (xs) => xs.reduce((a, b) => a + b, 0) / xs.length;
  const rows = [];
  for (const [name, make] of Object.entries(POLICIES)) {
    const runs = seeds.map((seed) => runPolicy(mode, seed, towerLength, seconds, make, false));
    rows.push({
      policy: name,
      rows: Math.round(mean(runs.map((r) => r.rows))),
      checkpoints: mean(runs.map((r) => r.checkpoints)),
      crates: mean(runs.map((r) => r.crates)),
      deaths: mean(runs.map((r) => r.deaths)),
    });
  }
  // One human plus the Autohauler, since that is the shipped solo experience.
  const solo = seeds.map((seed) => runPolicy(mode, seed, towerLength, seconds, null, true));
  rows.push({
    policy: 'one player + the Autohauler',
    rows: Math.round(mean(solo.map((r) => r.rows))),
    checkpoints: mean(solo.map((r) => r.checkpoints)),
    crates: mean(solo.map((r) => r.crates)),
    deaths: mean(solo.map((r) => r.deaths)),
  });
  return rows;
}

/* ------------------------------------------------------------------- main */

/**
 * Run seeds. Fixed, so two tunings are compared on the same towers by the same
 * hands. On the Gauntlet a seed is a different tower; on the campaign, which is
 * one authored tower, it is a different pair of people playing it.
 */
const SEEDS = [7, 19, 42, 101];

if (import.meta.url === `file://${process.argv[1]}`) {
  const campaign = buildCampaign();
  const tower = buildTower(33, 10);

  console.log('REACH — what fraction of plausible casual jump attempts land\n');
  for (const [name, level, mode, seed] of [
    ['campaign', campaign, 0, 1],
    ['gauntlet 33', tower, 1, 33],
  ]) {
    const r = reachRate(level, mode, seed);
    console.log(
      `  ${name.padEnd(13)} ${r.rate.toFixed(1)}%  (${r.tried} attempts, worst step ${r.worst}%, ` +
        `${r.dead} impossible)`,
    );
    console.log(`  ${' '.repeat(13)} per step: ${r.perStep.join(' ')}`);
  }

  const total = campaign.h;
  console.log(
    `\nCLIMB — three minutes of the campaign, ${total} rows tall, ` +
      `${campaign.checkpoints.length} checkpoints; ` +
      `mean of ${SEEDS.length} runs\n`,
  );
  for (const row of climbTest(MODE_HAUL, SEEDS, 10)) {
    const pct = ((100 * row.rows) / total).toFixed(1);
    console.log(
      `  ${row.policy.padEnd(36)} ${String(row.rows).padStart(3)} rows (${pct.padStart(4)}%)  ` +
        `checkpoints ${row.checkpoints.toFixed(1)}  crates lost ${row.crates.toFixed(1)}  ` +
        `deaths ${row.deaths.toFixed(1)}`,
    );
  }
}
