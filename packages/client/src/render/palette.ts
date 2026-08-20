/** Colour is doing most of the art direction here, so it is defined once,
 *  centrally, and every biome is a full re-skin rather than a hue shift. */

export interface BiomePalette {
  name: string;
  skyTop: string;
  skyBottom: string;
  far: string;
  mid: string;
  near: string;
  tileBody: string;
  tileTop: string;
  tileEdge: string;
  tileDetail: string;
  fog: string;
  glow: string;
  dust: string;
}

export const BIOMES: BiomePalette[] = [
  {
    name: 'THE YARD',
    skyTop: '#0a0e1c',
    skyBottom: '#1b2340',
    far: '#141b33',
    mid: '#1c2542',
    near: '#243053',
    tileBody: '#3b4467',
    tileTop: '#7c88bd',
    tileEdge: '#232a45',
    tileDetail: '#333c5c',
    fog: 'rgba(28,37,66,0.55)',
    glow: '#ffb03a',
    dust: '#9aa6cc',
  },
  {
    name: 'THE FOUNDRY',
    skyTop: '#170a09',
    skyBottom: '#3d1710',
    far: '#22100c',
    mid: '#2e1610',
    near: '#3d1e15',
    tileBody: '#4a3229',
    tileTop: '#a8674a',
    tileEdge: '#2a1a14',
    tileDetail: '#3d2a22',
    fog: 'rgba(74,32,20,0.5)',
    glow: '#ff6b2a',
    dust: '#d99a72',
  },
  {
    name: 'THE FREEZER',
    skyTop: '#060d18',
    skyBottom: '#152740',
    far: '#0e1b2c',
    mid: '#15263c',
    near: '#1d3350',
    tileBody: '#31485f',
    tileTop: '#8dc3e0',
    tileEdge: '#1c2b3c',
    tileDetail: '#2a3e52',
    fog: 'rgba(30,60,90,0.5)',
    glow: '#8ee7ff',
    dust: '#cfe8f7',
  },
  {
    name: 'THE SPIRE',
    skyTop: '#0d0720',
    skyBottom: '#2a1550',
    far: '#150c2e',
    mid: '#1d1240',
    near: '#2a1b56',
    tileBody: '#3f3170',
    tileTop: '#a78ae0',
    tileEdge: '#241a45',
    tileDetail: '#33285c',
    fog: 'rgba(45,26,90,0.5)',
    glow: '#c88bff',
    dust: '#d3bdf5',
  },
];

/** Player colours. Index 0 and 1 are the defaults, the rest are unlockable. */
export const PLAYER_COLOURS = [
  { name: 'HAZARD ORANGE', main: '#ff7a4d', dark: '#c44a24', light: '#ffb08c' },
  { name: 'COOLANT CYAN', main: '#4fd6e0', dark: '#1f8f9c', light: '#a5f0f6' },
  { name: 'HI-VIS LIME', main: '#b4e33d', dark: '#76a114', light: '#dcf58f' },
  { name: 'BUBBLEGUM', main: '#ff6fae', dark: '#c23570', light: '#ffb3d4' },
  { name: 'DUCT TAPE', main: '#9aa4b8', dark: '#5e677a', light: '#d2d8e4' },
  { name: 'RADIOACTIVE', main: '#7bffb0', dark: '#2fae6a', light: '#c4ffdd' },
  { name: 'ROYAL PURPLE', main: '#a97bff', dark: '#6b3fc4', light: '#d5bcff' },
  { name: 'SAFETY YELLOW', main: '#ffd23d', dark: '#c79300', light: '#ffe999' },
];

export interface Hat {
  id: number;
  name: string;
  /** How it is earned; shown in the cosmetics picker. */
  unlock: string;
}

export const HATS: Hat[] = [
  { id: 0, name: 'NO HAT', unlock: 'Always available' },
  { id: 1, name: 'HARD HAT', unlock: 'Reach the first checkpoint' },
  { id: 2, name: 'TRAFFIC CONE', unlock: 'Break 25 crates' },
  { id: 3, name: 'PROPELLER CAP', unlock: 'Finish The Long Haul' },
  { id: 4, name: 'TOP HAT', unlock: 'Finish a run without dropping the crate' },
  { id: 5, name: 'PAPER BAG', unlock: 'Die 100 times' },
  { id: 6, name: 'CROWN', unlock: 'Finish a Gauntlet of 20 floors' },
  { id: 7, name: 'HALO', unlock: 'Anchor for your partner 500 times' },
];

export const CARGO_COLOURS = {
  body: '#c08a3e',
  bodyDark: '#8a5d24',
  strap: '#3a3140',
  metal: '#d7c3a0',
  crack: '#2a1c12',
};

export function biomeFor(index: number): BiomePalette {
  return BIOMES[Math.max(0, Math.min(BIOMES.length - 1, index))];
}

/** A stronger, flatter palette for players who need maximum readability. */
export function applyHighContrast(p: BiomePalette): BiomePalette {
  return {
    ...p,
    skyTop: '#000000',
    skyBottom: '#0a0a12',
    far: '#0b0b14',
    mid: '#101020',
    near: '#16162a',
    tileBody: '#2a2a3a',
    tileTop: '#ffffff',
    tileEdge: '#000000',
    tileDetail: '#3a3a50',
    fog: 'rgba(0,0,0,0.55)',
  };
}

/** Deterministic per-tile jitter, so texture never crawls between frames. */
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
