/**
 * SAFE WORKING LOAD — the sun-bleached stencil yard.
 *
 * Nearly every platformer on a storefront is a dark world with a bright
 * character on it. This one is inverted: the sky is the lightest thing in the
 * frame, the tower is warm concrete standing in front of it, and the two
 * haulers are near-black silhouettes in hi-vis vests — the darkest objects on
 * screen against the brightest background. That inversion is most of what
 * makes a screenshot recognisable at capsule size.
 *
 * The grammar is painted industrial signage rather than lighting: hazard
 * chevrons on every ledge you can stand on, stencilled floor numbers three
 * metres tall painted flat onto the tower's face, and load markings on the
 * flats. Colour is doing all of the art direction, so it is defined once,
 * centrally, and every biome is a full re-skin rather than a hue shift.
 */

export interface BiomePalette {
  name: string;
  /** Backdrop. The lightest value in the frame in biomes 0-2, the darkest in the Spire. */
  paper: string;
  /** A single flat haze band across the lower third. Never a gradient. */
  haze: string;
  /** Parallax layer fills, far to near. */
  far: string;
  mid: string;
  near: string;
  /** Block colours for the near parallax layer — container stacks and plant. */
  livery: string[];
  tileBody: string;
  /** Cap highlight, used only where chevrons are not. */
  tileTop: string;
  tileEdge: string;
  tileDetail: string;
  /** Every outline, every stencil, the dark half of every chevron. */
  ink: string;
  /** Hazard chevron halves. */
  hazA: string;
  hazB: string;
  /** Rope core, and the colour the rope grinds into the paint. */
  chalk: string;
  /** Painted stencil colour on the tower face. */
  stencil: string;
  /** Alpha for baked floor numbers and load stencils. */
  paintAlpha: number;
  /** Alpha per accumulated rope scuff mark. */
  scuffAlpha: number;
  /** Rope shadow and contact occlusion. Low alpha, never black. */
  shadowInk: string;
  /** Outside the shaft. Deliberately not ink: a black mass here kills the light. */
  voidFill: string;
  /** Distance wash. Washes toward paper, not toward black. */
  hazeVeil: string;
  /** The one emissive hue. Rationed to lava, checkpoints and the goal. */
  hot: string;
  dust: string;
}

/** The crate's FRAGILE stencil, the rope at breaking tension, and death. */
export const STENCIL_RED = '#D6301C';
/** Retroreflective banding. Only ever this, and only ever on the vests. */
export const REFLECTIVE = '#FFFFFF';
/** Every hauler is this colour. Cosmetics change the vest, never the body. */
export const PLAYER_BODY = '#1B1714';

export const BIOMES: BiomePalette[] = [
  {
    // Dockside concrete at high noon.
    name: 'THE YARD',
    paper: '#F4EFE2',
    haze: '#E4DCC8',
    far: '#DED5C1',
    mid: '#CEC3AB',
    near: '#B9AC90',
    livery: ['#1C6E9E', '#A63B1E', '#5C7A3A', '#C9C2B2'],
    tileBody: '#C6BCA6',
    tileTop: '#F0EADA',
    tileEdge: '#1B1714',
    tileDetail: '#AFA48C',
    ink: '#1B1714',
    hazA: '#F2B01C',
    hazB: '#1B1714',
    chalk: '#FFFDF6',
    stencil: '#1B1714',
    paintAlpha: 0.42,
    scuffAlpha: 0.24,
    shadowInk: 'rgba(46,38,28,0.20)',
    // Everything outside the shaft is this, and at a wide camera that is most
    // of the frame — so it has to read as more yard receding into the haze,
    // not as a mud border painted round the picture.
    voidFill: '#B2A68C',
    hazeVeil: 'rgba(228,220,200,0.55)',
    hot: '#FFB300',
    dust: '#8E8067',
  },
  {
    // Bright, not dark. The melt whites out the sky.
    name: 'THE FOUNDRY',
    paper: '#F6C63F',
    haze: '#E39B22',
    far: '#D98A1E',
    mid: '#C1721A',
    near: '#A55A16',
    livery: ['#8E3B12', '#5C3A1C', '#C0761E', '#3A2410'],
    tileBody: '#8E6B3E',
    tileTop: '#F7DE9A',
    tileEdge: '#1B1714',
    tileDetail: '#7A5A33',
    ink: '#1B1714',
    hazA: '#F35A14',
    hazB: '#1B1714',
    chalk: '#FFE9B0',
    stencil: '#1B1714',
    paintAlpha: 0.38,
    scuffAlpha: 0.26,
    shadowInk: 'rgba(58,26,8,0.22)',
    voidFill: '#A8641A',
    hazeVeil: 'rgba(227,155,34,0.50)',
    // Molten core: the only value in the game brighter than paper.
    hot: '#FFF6D8',
    dust: '#B8791E',
  },
  {
    // Whiteout — the world losing its ink. The wash is carried by the tile
    // bodies, deliberately not by weakening the lines you have to read.
    name: 'THE FREEZER',
    paper: '#EDF3F4',
    haze: '#DCE7EA',
    far: '#D2E0E5',
    mid: '#C0D2DA',
    near: '#A9BFC9',
    livery: ['#4E7E93', '#6E8C97', '#93A9B2', '#C3D3D8'],
    tileBody: '#AEC0C7',
    tileTop: '#FBFEFF',
    tileEdge: '#1F2B33',
    tileDetail: '#9AAEB7',
    ink: '#1F2B33',
    // Hazard marking inverts to blue-on-white up here.
    hazA: '#2F6FA8',
    hazB: '#EDF3F4',
    chalk: '#FFFFFF',
    stencil: '#1F2B33',
    paintAlpha: 0.22,
    scuffAlpha: 0.12,
    shadowInk: 'rgba(31,43,51,0.16)',
    voidFill: '#A3B8C2',
    hazeVeil: 'rgba(220,231,234,0.55)',
    hot: '#8EE7FF',
    dust: '#7E939E',
  },
  {
    // The deliberate inversion of the inversion: hard UV sky, sunlit
    // galvanised steel. Scuff reads as a dark smear on a bone wall, so chalk
    // goes dark here and the rope core switches to reflective white.
    name: 'THE SPIRE',
    paper: '#123258',
    haze: '#1B4372',
    far: '#17385F',
    mid: '#214B79',
    near: '#91A8C0',
    livery: ['#0E2848', '#163A64', '#B8CDE4', '#7D97B6'],
    tileBody: '#E6E2D6',
    tileTop: '#FFFFFF',
    tileEdge: '#0A1A2E',
    tileDetail: '#CFC9BA',
    ink: '#0A1A2E',
    hazA: '#E8267F',
    hazB: '#0A1A2E',
    chalk: '#0A1A2E',
    stencil: '#0A1A2E',
    paintAlpha: 0.34,
    scuffAlpha: 0.28,
    shadowInk: 'rgba(10,26,46,0.26)',
    voidFill: '#0A1A2E',
    hazeVeil: 'rgba(18,50,88,0.55)',
    hot: '#FFD9F0',
    dust: '#9FC0E0',
  },
];

/**
 * Player colours. The body is never one of these — `main` is the vest, `dark`
 * is the vest in shadow, and `light` is always the retroreflective band.
 */
export const PLAYER_COLOURS = [
  { name: 'HI-VIS ORANGE', main: '#FF6A00', dark: '#B23F00', light: REFLECTIVE },
  { name: 'HI-VIS LIME', main: '#C8E82A', dark: '#7E9A0F', light: REFLECTIVE },
  { name: 'SAFETY YELLOW', main: '#FFC800', dark: '#B07E00', light: REFLECTIVE },
  { name: 'SIGNAL RED', main: '#E02A16', dark: '#8E1206', light: REFLECTIVE },
  { name: 'COOLANT CYAN', main: '#0FB6C8', dark: '#08707D', light: REFLECTIVE },
  { name: 'DUCT TAPE', main: '#9E9683', dark: '#5F5849', light: REFLECTIVE },
  { name: 'MANDATORY BLUE', main: '#1F5FA8', dark: '#123A69', light: REFLECTIVE },
  { name: 'BUBBLEGUM', main: '#FF4D96', dark: '#B0175A', light: REFLECTIVE },
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
  /** Pale ply, so the crate reads as cargo rather than as another platform. */
  body: '#E8DCC0',
  bodyDark: '#B49B6E',
  strap: '#1B1714',
  metal: '#C9BFA6',
  crack: '#7A5A32',
  /** FRAGILE. The single saturated red in the picture. */
  stencil: STENCIL_RED,
};

export function biomeFor(index: number): BiomePalette {
  return BIOMES[Math.max(0, Math.min(BIOMES.length - 1, index))];
}

/**
 * Maximum readability. Keeps the inversion — that is the identity, not the
 * decoration — but collapses the chevron to a solid bar and switches off both
 * accumulating effects, which are the two things that put texture on surfaces
 * a player has to parse at speed.
 */
export function applyHighContrast(p: BiomePalette): BiomePalette {
  return {
    ...p,
    paper: '#FFFFFF',
    haze: '#E8E8E8',
    far: '#E4E4E4',
    mid: '#D8D8D8',
    near: '#C8C8C8',
    livery: ['#C8C8C8'],
    tileBody: '#DCDCDC',
    tileTop: '#FFFFFF',
    tileEdge: '#000000',
    tileDetail: '#C4C4C4',
    ink: '#000000',
    hazA: '#000000',
    hazB: '#000000',
    chalk: '#FFFFFF',
    stencil: '#000000',
    paintAlpha: 0,
    scuffAlpha: 0,
    shadowInk: 'rgba(0,0,0,0)',
    voidFill: '#7A7A7A',
    hazeVeil: 'rgba(255,255,255,0.6)',
    hot: '#000000',
    dust: '#666666',
  };
}

/** Deterministic per-tile jitter, so texture never crawls between frames. */
export function tileHash(x: number, y: number): number {
  let h = (x * 374761393 + y * 668265263) | 0;
  h = (h ^ (h >>> 13)) * 1274126177;
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}
