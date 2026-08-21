/**
 * Measure what a jump can actually do, in the real simulation.
 *
 * The level authoring rules in tools/gen_chunks.py are derived from these
 * numbers, so whenever the movement tuning changes, run this and update them.
 * Guessing produces towers that look climbable and are not.
 */
import {
  assembleLevel,
  createWorld,
  step,
  TILE,
  IN_GRIP,
  IN_JUMP,
  IN_RIGHT,
  PLAYER_H,
} from '../packages/core/dist/index.js';

const HEIGHT = 30;
const FLOOR = 24;
const RUNWAY = 12;

function build(rise, gap) {
  const rows = [];
  for (let r = 0; r < HEIGHT; r++) rows.push('##' + '.'.repeat(36) + '##');
  rows[FLOOR] = '##' + '#'.repeat(RUNWAY) + '.'.repeat(36 - RUNWAY) + '##';
  const targetStart = 2 + RUNWAY + gap;
  const targetRow = FLOOR - rise;
  const width = Math.min(8, 38 - targetStart);
  rows[targetRow] =
    rows[targetRow].slice(0, targetStart) + '#'.repeat(width) + rows[targetRow].slice(targetStart + width);
  rows[2] = rows[2].slice(0, 19) + 'F' + rows[2].slice(20);
  rows[FLOOR - 1] = rows[FLOOR - 1].slice(0, 4) + 'S' + rows[FLOOR - 1].slice(5);
  const level = assembleLevel('cal', 'CALIBRATION', [
    { id: 'cal', biome: 0, difficulty: 0, rows, tags: ['start', 'goal'] },
  ]);
  return { level, targetRow, targetStart };
}

/**
 * Can one hauler cross this gap while the other stays put?
 *
 * `partner` is the input the other hauler holds throughout: IN_GRIP for a
 * braced anchor, 0 for one who is just standing there as dead weight.
 *
 * This used to drive BOTH haulers with the same mask off the same runway, and
 * that is not a situation any level puts a player in — they have separate
 * controllers and they take turns. Running them in lockstep means each is
 * dragging the other through the whole jump, which understates the envelope
 * badly: the lockstep measurement says four empty columns at rise 0, and one
 * hauler jumping past a braced partner clears six. Every authoring rule in
 * tools/gen_chunks.py is derived from these numbers, so a tower built to the
 * lockstep figure is built tighter than it needs to be, and the bot and the
 * flood fill inherit the same pessimism.
 */
function canMake(rise, gap, partner) {
  const { level, targetRow, targetStart } = build(rise, gap);
  const ctx = { level, seed: 1, mode: 0 };
  // Later jump ticks are longer run-ups: the hauler is holding RIGHT from the
  // first tick, so `jumpAt` sweeps the whole approach speed range for free.
  for (let jumpAt = 0; jumpAt < 90; jumpAt++) {
    const world = createWorld(ctx);
    for (let t = 0; t < 60; t++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    for (let t = 0; t < 130; t++) {
      const holding = t >= jumpAt && t < jumpAt + 22;
      const mask = IN_RIGHT | (holding ? IN_JUMP : 0);
      step(ctx, world, [mask, partner]);
      world.events.length = 0;
      const p = world.players[0];
      const row = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE);
      if (p.grounded && row === targetRow && p.x / TILE >= targetStart) return true;
      if (p.dead || world.restartTimer > 0) break;
    }
  }
  return false;
}

/** Widest gap crossable at this rise, or -1 if even a touching platform fails. */
function envelope(rise, partner) {
  let best = -1;
  for (let gap = 0; gap <= 9; gap++) {
    if (!canMake(rise, gap, partner)) break;
    best = gap;
  }
  return best;
}

const SCENARIOS = [
  { name: 'partner braced (holding GRIP)', partner: IN_GRIP },
  { name: 'partner idle (dead weight on the rope)', partner: 0 },
  { name: 'both driven in lockstep (the old measurement)', partner: IN_RIGHT },
];

console.log('Jump envelope, measured in the real simulation with the rope and the crate attached.');
console.log('Max empty columns between platform edges, by rows risen.\n');

const table = [];
for (const s of SCENARIOS) {
  const row = { scenario: s.name };
  for (const rise of [0, 1, 2, 3, 4]) {
    const gap = envelope(rise, s.partner);
    row[`rise ${rise}`] = gap < 0 ? 'impossible' : String(gap);
  }
  table.push(row);
}
console.table(table);

console.log(`
Authoring uses the WORST of these scenarios, minus a column, and never places
footholds closer than three rows apart — the player is 32px tall and a tile is
24px, so a two-row step leaves less clearance than the body and they clip the
underside of the platform they are reaching for.

The three rows are not academic. A hauler jumping past a braced partner has the
rope as an aid; one dragging an idle partner has it as an anchor; and driving
both off the same runway in lockstep — which is what this script used to do —
has each of them fighting the other for the whole arc. Only the first two
happen in play.`);
