import { CHUNKS } from './chunks.js';
import { assembleLevel, generateTower, type ChunkDef, type Level } from './level.js';
import { MODE_GAUNTLET, MODE_HAUL } from './types.js';

/** The authored campaign, bottom to top. */
export function buildCampaign(): Level {
  return assembleLevel('campaign', 'THE LONG HAUL', CHUNKS);
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

/** A seeded endless tower drawn from the same chunk library. */
export function buildTower(seed: number, length: number): Level {
  const floors = Math.max(1, Math.min(60, length));
  const chunks: ChunkDef[] = generateTower(seed, CHUNKS, floors);
  return assembleLevel(towerId(seed, floors), 'THE GAUNTLET', chunks);
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
