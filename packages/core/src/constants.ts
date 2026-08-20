/** Tuning constants for the HAULMATES simulation. All units are world pixels. */

/** Simulation rate. Everything in the sim is expressed per-tick, never per-frame. */
export const TICK_RATE = 60;
export const DT = 1 / TICK_RATE;

/** Tile grid. */
export const TILE = 24;
export const CHUNK_W = 40;

/** Gravity and global limits. */
export const GRAVITY = 2000;
export const MAX_FALL = 1150;
export const MAX_FALL_HEAVY = 1500;

/** Player body. */
export const PLAYER_W = 20;
export const PLAYER_H = 32;
export const PLAYER_HALF_W = PLAYER_W / 2;

/** Player locomotion. */
/** Calibrated against the level authoring rules: a jump has to comfortably
 *  clear a two-tile rise with a two-column gap while carrying the rope's load.
 *  scripts/calibrate-jump.mjs measures what these actually buy. */
export const RUN_SPEED = 235;
export const GROUND_ACCEL = 2600;
export const AIR_ACCEL = 1500;
export const GROUND_FRICTION = 2400;
export const AIR_FRICTION = 260;
export const ICE_FRICTION = 130;
export const ICE_ACCEL = 700;

/** Jumping. */
export const JUMP_VELOCITY = -585;
export const JUMP_CUT = 0.42;
export const COYOTE_TICKS = 7;
export const JUMP_BUFFER_TICKS = 8;
export const WALL_JUMP_X = 250;
export const WALL_JUMP_Y = -520;

/** Grip: the anchor verb. Holding GRIP on a grippable surface pins you in place
 *  so your partner can swing, be reeled in, or be launched off you. */
export const GRIP_MAX = 210;
export const GRIP_DRAIN = 42;
export const GRIP_REGEN = 62;
export const GRIP_REGEN_DELAY = 12;
/**
 * Share of the full drain rate paid for bracing a partner who is hanging on
 * the rope. At 0.35 a full bar holds a dangling hauler for fourteen seconds:
 * long enough that a rescue is a rescue, short enough that a pair who have
 * wedged themselves cannot stay wedged.
 */
export const HANG_DRAIN_SHARE = 0.35;
export const GRIP_REACH = 5;

/** Rope. The rope is elastic between REST and MAX, then hard-clamped. */
export const ROPE_NODES = 15;
export const ROPE_REST = 118;
export const ROPE_MAX = 232;
/** Deliberately soft. The hard length clamp does the dramatic work; this is
 *  only a reminder that your friend exists. Stiff values here turn the puller
 *  around instead of transferring load, which kills every drag and swing. */
export const ROPE_SPRING = 3.2;
export const ROPE_DAMPING = 0.86;
export const ROPE_ITERATIONS = 7;
export const ROPE_NODE_DRAG = 0.994;
export const ROPE_CORRECTION = 0.62;
export const ROPE_YANK_SPEED = 250;

/** Reel: pull yourself toward your partner along the rope.
 *
 *  This has to beat gravity, or the verb is a lie. At 1450 it did not: a player
 *  hauling straight up toward an anchored partner netted -550 px/s^2 and climbed
 *  a sixth of a tile in five seconds, while every menu in the game told them the
 *  fastest way up was the other person. */
export const REEL_FORCE = 3100;
export const REEL_MAX_SPEED = 430;
/** Reeling is hard work: it drains the same stamina pool gripping does. */
export const REEL_DRAIN = 16;
/**
 * How fast you walk up a wall while reeling on a rope that runs above you.
 *
 * Without this, reeling gets you to just under the lip your partner is standing
 * on and abandons you there, which made every pit in the game a dead end rather
 * than a puzzle. Deliberately slower than a run: this is hauling yourself up,
 * not climbing a ladder.
 */
export const REEL_CLIMB_SPEED = 150;
/** Sideways push that gets a climbing hauler over the lip they have reached. */
export const REEL_MANTLE_SPEED = 130;

/** Cargo — the crate that dangles from the middle of the rope and ruins lives. */
export const CARGO_W = 26;
export const CARGO_H = 24;
export const CARGO_HP = 100;
export const CARGO_TETHER = 20;
export const CARGO_DAMPING = 0.995;
export const CARGO_BOUNCE = 0.28;
/** Impacts gentler than this do nothing at all. Set high on purpose: at a
 *  lower threshold the crate accumulated chip damage from ordinary jumping and
 *  died roughly every ten seconds, which reads as a broken game rather than a
 *  tense one. Only a real fall should hurt. */
export const CARGO_IMPACT_MIN = 560;
export const CARGO_IMPACT_SCALE = 0.06;
export const CARGO_REPAIR_PER_TICK = 0.55;
/** Ticks of clean handling before the crate starts patching itself up. */
export const CARGO_REGEN_DELAY = 90;
export const CARGO_REGEN = 0.08;

/** Damage, death and respawn. */
export const RESPAWN_TICKS = 54;
export const STUN_TICKS = 26;
export const DEATH_FADE_TICKS = 30;

/** Hazard behaviour. */
export const BOUNCE_VELOCITY = -880;
export const CONVEYOR_SPEED = 130;
export const WIND_ACCEL = -1550;
export const CRUMBLE_DELAY = 22;
export const CRUMBLE_RESPAWN = 150;
export const SAW_RADIUS = 20;
export const CRUSHER_MARGIN = 2;

/** Camera framing hints consumed by the renderer (not part of the sim). */
export const VIEW_BASE_H = 620;
export const VIEW_MIN_H = 520;
export const VIEW_MAX_H = 1060;

/** Input bit flags, packed into one byte per player per tick. */
export const IN_LEFT = 1 << 0;
export const IN_RIGHT = 1 << 1;
export const IN_JUMP = 1 << 2;
export const IN_GRIP = 1 << 3;
export const IN_REEL = 1 << 4;
export const IN_DOWN = 1 << 5;
export const IN_EMOTE = 1 << 6;
export const IN_RESTART = 1 << 7;

/** Emotes. Purely social, fully networked, essential to the genre. */
export const EMOTE_COUNT = 4;
export const EMOTE_TICKS = 70;

/** Protocol/versioning. Bump when the simulation changes in a way that would
 *  make two different builds disagree — the server refuses mismatched peers. */
export const SIM_VERSION = 12;

/** Rope self-gravity — lower than player gravity so the rope drapes lazily. */
export const ROPE_GRAVITY = 1500;
/** Cargo gravity. Heavier than the players, which is the entire joke. */
export const CARGO_GRAVITY = 2150;
/** Restitution applied when the rope snaps taut, so a yank flings you. */
export const ROPE_RESTITUTION = 0.18;
/**
 * How much a player standing on solid ground can resist being hauled sideways
 * or downward by the rope. Nothing resists being lifted straight up, which is
 * what lets one player winch the other out of a pit by walking away from the
 * lip it runs over.
 */
export const GROUND_HAUL_RESISTANCE = 0.35;

/** How hard a taut, loaded rope drags on the player it is tied to. */
export const ROPE_LOAD = 380;
/** Ticks after a checkpoint reset before control returns. */
export const RESET_DELAY = 42;
/** Both players must hold RESTART this long to force a checkpoint reset. */
export const RESTART_HOLD = 72;
