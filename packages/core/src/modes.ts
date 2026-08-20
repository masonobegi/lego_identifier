import { CHUNKS } from './chunks.js';
import { assembleLevel, generateTower, type ChunkDef, type Level } from './level.js';
import { MODE_GAUNTLET, MODE_HAUL } from './types.js';

/** The authored campaign, bottom to top. */
export function buildCampaign(): Level {
  return assembleLevel('campaign', 'THE LONG HAUL', CHUNKS);
}

/** A seeded endless tower drawn from the same chunk library. */
export function buildTower(seed: number, length: number): Level {
  const chunks: ChunkDef[] = generateTower(seed, CHUNKS, Math.max(1, Math.min(60, length)));
  return assembleLevel(`tower-${seed >>> 0}-${length}`, 'THE GAUNTLET', chunks);
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
