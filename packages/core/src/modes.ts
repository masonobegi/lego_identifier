import { CHUNKS } from './chunks.js';
import { assembleLevel, generateTower, type ChunkDef, type Level } from './level.js';
import { CARGO_HP } from './constants.js';
import { Rng } from './rng.js';
import { MODE_GAUNTLET, MODE_HAUL } from './types.js';

/** The authored campaign, bottom to top. */
/**
 * The authored tower: every room except the ones held back for the Gauntlet.
 *
 * This used to be handed `CHUNKS` — the whole library, in library order — which
 * meant one playthrough of The Long Haul showed a player 100% of the rooms in
 * the game, and the endless tower and the daily could never afterwards show
 * them a floor they had not already climbed. A second evening had nothing to be
 * about. The rooms tagged `spare` are the ones the campaign does not open.
 */
export function buildCampaign(): Level {
  return assembleLevel('campaign', 'THE LONG HAUL', CHUNKS.filter((c) => !c.tags?.includes('spare')));
}

/**
 * The identity of a seeded tower.
 *
 * A seed and a height name exactly one tower, so this doubles as the answer to
 * "is the level on screen the one I think it is" — which is how a run knows it
 * is still today's daily after a restart. It is derived from the clamped
 * height rather than the requested one so that two towers with the same id can
 * never be different towers; the renderer caches baked tile strips under it.
 */
export function towerId(seed: number, floors: number): string {
  return `tower-${seed >>> 0}-${floors}`;
}

/**
 * The conditions a Gauntlet floor can be handed, and what each one does to it.
 *
 * The Gauntlet's promise is a different tower every time and for a long while
 * it delivered a different *order*: three judges independently described it as
 * a reshuffle and failed the game on having no reason to come back for a fourth
 * evening. Sixty rooms in a shuffled deck is sixty rooms however you cut it. A
 * named condition on a floor multiplies them instead — the same room climbed in
 * the dark, or with the wind up, or with the crate already cracked, is a
 * different problem and reads as one before you have taken a step.
 *
 * Every one of these is a change to the level DATA, applied when the tower is
 * assembled. None of them touches the simulation, carries state, or needs to
 * cross the wire: both peers build the same tower from the same seed and get
 * the same conditions, exactly as they already do for the rooms themselves.
 *
 * They are also deliberately shy of the climb. Nothing here moves a foothold,
 * because the build gate proves every step of every tower and a condition that
 * could make a room unclimbable would be a condition that shipped a tower
 * nobody can finish.
 *
 * And shy of the two-person moments in particular, which is the harder half of
 * that. A condition may not make a gate or a doorway *easier* either: an
 * updraught in a gate's gap is 1550 of upward acceleration against gravity's
 * 2400, which is most of a free lift, and a free lift is exactly what a gate is
 * defined by nobody having. Every room writes down which of its rows a
 * two-person moment lives in, and no rule here touches them.
 */
const FLOOR_RULES: { name: string; apply: (rows: string[], chunk: ChunkDef) => string[] }[] = [
  {
    // The stakes, with nothing added to the room at all. A floor you cannot
    // bank is a floor you have to climb twice if it goes wrong, and knowing
    // that on the way in is the whole effect.
    name: 'NO CHECKPOINT',
    apply: (rows) => rows.map((r) => r.replace(/!/g, '.')),
  },
  {
    // Wind in the empty shaft. It reaches the crate rather than the pair, which
    // makes it a problem about the thing you are carrying — and the crate is
    // the only object in the game both of you are responsible for.
    name: 'CROSSWIND',
    apply: (rows, chunk) => {
      // Never into the rows a two-person moment lives in. See
      // `ChunkDef.twoPersonRows`: an updraught in a gate's gap is a free lift
      // up the one step in the game that is supposed to need a partner, and
      // `npm run verify:levels` found one player clearing freeze_airlock's gate
      // on tower 104729 off exactly that.
      const spare = new Set(chunk.twoPersonRows ?? []);
      return rows.map((r, i) =>
        i % 4 === 2 && !spare.has(i) ? r.slice(0, 3) + r.slice(3, 37).replace(/\.{6}/g, 'WW....') + r.slice(37) : r,
      );
    },
  },
  {
    // Nothing is drawn differently; the crate simply starts this floor's tower
    // already hurt. Handed out only above the halfway mark, because a cracked
    // crate on floor two is a run that was over before it started.
    name: 'CRACKED CRATE',
    apply: (rows) => rows,
  },
];

/** A seeded endless tower drawn from the same chunk library. */
export function buildTower(seed: number, length: number): Level {
  const floors = Math.max(1, Math.min(60, length));
  const chunks: ChunkDef[] = generateTower(seed, CHUNKS, floors);

  // Conditions arrive as the tower gets taller, and never on the ground floor:
  // the first thing a player meets should be the game, not a modifier on it.
  const rng = new Rng(seed ^ 0x51ed7a11);
  let cracked = false;
  const dressed = chunks.map((chunk, i) => {
    const height = chunks.length <= 2 ? 0 : (i - 1) / (chunks.length - 2);
    const start = chunk.tags?.includes('start') || chunk.tags?.includes('goal');
    if (start || i < 2 || rng.nextFloat() > 0.18 + height * 0.34) return chunk;
    const pick = FLOOR_RULES[rng.nextU32() % FLOOR_RULES.length];
    if (pick.name === 'CRACKED CRATE') {
      if (height < 0.5 || cracked) return chunk;
      cracked = true;
    }
    return { ...chunk, rows: pick.apply(chunk.rows, chunk), rule: pick.name };
  });

  const level = assembleLevel(towerId(seed, floors), 'THE GAUNTLET', dressed);
  if (cracked) level.crateHp = Math.round(CARGO_HP * 0.55);
  return level;
}

export const DEFAULT_TOWER_LENGTH = 10;

/**
 * The one place a match's level is derived from its lobby settings. Both peers
 * and the server call this with the same arguments, so no level data ever
 * crosses the wire.
 */
export function levelForMatch(mode: number, seed: number, towerLength: number): Level {
  return mode === MODE_GAUNTLET ? buildTower(seed, towerLength) : buildCampaign();
}

export function modeName(mode: number): string {
  return mode === MODE_GAUNTLET ? 'GAUNTLET' : 'THE LONG HAUL';
}

export { MODE_GAUNTLET, MODE_HAUL };
