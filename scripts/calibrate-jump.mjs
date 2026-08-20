/**
 * Measure what a jump can actually do, in the real simulation.
 *
 * The level authoring rules in tools/gen_chunks.py are derived from these
 * numbers, so whenever the movement tuning changes, run this and update them.
 * Guessing produces towers that look climbable and are not.
 */
import { assembleLevel, createWorld, step, TILE, IN_JUMP, IN_RIGHT, PLAYER_H } from '../packages/core/dist/index.js';

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

function canMake(rise, gap) {
  const { level, targetRow, targetStart } = build(rise, gap);
  const ctx = { level, seed: 1, mode: 0 };
  for (let jumpAt = 0; jumpAt < 90; jumpAt++) {
    const world = createWorld(ctx);
    for (let t = 0; t < 60; t++) {
      step(ctx, world, [0, 0]);
      world.events.length = 0;
    }
    for (let t = 0; t < 130; t++) {
      const holding = t >= jumpAt && t < jumpAt + 22;
      const mask = IN_RIGHT | (holding ? IN_JUMP : 0);
      step(ctx, world, [mask, mask]);
      world.events.length = 0;
      const p = world.players[0];
      const row = Math.floor((p.y + PLAYER_H / 2 + 1) / TILE);
      if (p.grounded && row === targetRow && p.x / TILE >= targetStart) return true;
      if (p.dead || world.restartTimer > 0) break;
    }
  }
  return false;
}

console.log('Jump envelope, measured with both players roped together and the crate attached.');
console.log('  rise  max gap  (empty columns between platform edges)');
for (const rise of [0, 1, 2, 3, 4]) {
  let best = -1;
  for (let gap = 0; gap <= 9; gap++) {
    if (canMake(rise, gap)) best = gap;
    else break;
  }
  console.log(`  ${String(rise).padStart(4)}  ${best < 0 ? 'impossible' : String(best).padStart(7)}`);
}
console.log('\nAuthoring uses one column less than the measured maximum, and never');
console.log('places footholds closer than three rows apart (the player is taller');
console.log('than the two tiles a smaller step would leave clear).');
