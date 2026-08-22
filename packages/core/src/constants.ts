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
/**
 * Jump strength. Raised from -585 alongside making the route one-way.
 *
 * The two changes together are what turned this from a game nobody could play
 * into one somebody can. Measured as the fraction of plausible casual jump
 * attempts that land — every launch column, a spread of timings and hold
 * lengths, no memorised launch marks:
 *
 *     solid route, -585   24.4%   worst step  2%
 *     solid route, -645   30.5%   worst step  2%
 *     one-way route, -585 43.5%   worst step 22%
 *     one-way route, -645 55.3%   worst step 25%
 *
 * Jump height alone barely moved it, and never fixed the near-impossible step,
 * because the binding constraint was never height — it was that a solid
 * platform cannot be risen through, so the only legal launch columns were the
 * one or two clear of the shelf above. See `climb()` in tools/gen_chunks.py.
 */
export const JUMP_VELOCITY = -645;
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
/**
 * How close the crate has to be to the goal for a run to count as finished.
 *
 * The crate hangs off the middle of the rope, so with both haulers standing on
 * the goal it can never be further than half a rope plus its tether — about a
 * hundred and thirty-six pixels — and it settles at ninety-six on every level
 * measured. A hundred and seventy leaves that comfortable margin while still
 * being less than three ledges, so a crate left behind on the way up cannot be
 * mistaken for one that arrived.
 */
export const GOAL_CARGO_REACH = 170;
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
/**
 * Terminal velocity for the crate, in pixels per second.
 *
 * Above the haulers' own heavy-fall cap, because a crate should be able to
 * outrun you and land hard — but bounded, which it was not. Measured at 5904
 * before this existed, which is 320 points of impact damage against a
 * hundred-point crate: unsurvivable, and not from any drop in the level.
 */
export const CARGO_MAX_FALL = 1750;
/**
 * How fast the crate shuffles sideways when it is wedged under a ledge, in
 * pixels per second. Slow enough to read as working it free rather than
 * sliding it, fast enough to clear a twelve-wide platform inside a few seconds.
 */
export const CARGO_SHUFFLE = 190;
/**
 * Impact speed, in pixels per second, below which a landing costs the crate
 * nothing. About a six-and-a-half tile drop — two ledges and a bit of margin.
 *
 * This was 560, roughly three tiles, back when the crate healed itself after a
 * few calm seconds. Damage is permanent now, and a threshold that charges for
 * every ordinary landing turns permanence into a crate made of glass: measured
 * over three minutes of bot play, 67 damaging hits and sixteen crates lost, one
 * every eleven seconds. At this figure the same run takes seven hits, loses
 * none, and finishes on nine health out of a hundred — the bar tells the story
 * of the whole climb instead of resetting every time you look away.
 */
/**
 * Ticks before a second betrayal can be counted. A yank hard enough to rip
 * somebody off a ledge is one incident, not one per frame of the fall.
 */
/**
 * The leg-up: how much higher you go when you jump off a braced partner.
 *
 * This exists because the rope did not do anything. Measured before it: a
 * hauler with a partner braced beside them, or braced on a perch above them,
 * crossed a chasm of exactly the same width as a hauler on their own — six
 * tiles either way, at every launch column, run-up, hold and reel the search
 * could try. Every metre of a game called "a two-player co-op disaster about a
 * rope" was reachable by one person, and the second player was cargo with
 * opinions. The co-op reachability fill agreed: 2787 cells solo, 2787 together.
 *
 * A rope cannot fix that on its own. Reeling pulls you *toward* your partner,
 * so it can never take you anywhere they could not already stand, and a taut
 * rope against an anchor is a leash whichever way you run. What two people have
 * that one does not is a second pair of hands to stand on. So: brace, and your
 * partner goes up half again as high as they can alone, which is the difference
 * between a three-row step and a five-row one, and it is the only way in the
 * game to gain a metre you could not have gained by yourself.
 *
 * It costs the brace real grip, so it is a resource rather than a free verb,
 * and the crate takes the swing.
 */
export const BOOST_SCALE = 1.5;
/**
 * How fast a hauler braced on solid ground gets their grip back, as a share of
 * the ordinary regeneration rate. Slower than letting go, because letting go is
 * still the quicker way to recover — but not zero, which is what it was, and
 * which stranded a pair under a gate the moment they had fumbled it five times.
 */
export const BRACE_REGEN_SHARE = 0.55;
/** How close you have to be to your braced partner to get a leg up, in pixels. */
export const BOOST_REACH = 40;
/** ...and how level with them. */
export const BOOST_RISE = 30;
/** What the brace pays for it. Roughly a fifth of a full grip meter. */
export const BOOST_COST = 42;

export const BETRAYAL_DEBOUNCE = 45;

/**
 * What one bite from a spike costs the crate, and how long before it can bite
 * again.
 *
 * This was 34 applied *every tick of contact*, so a spike did two thousand
 * damage a second and three frames of brushing past one destroyed a crate at
 * full health. That is not a hazard, it is a trapdoor, and it is why the
 * underside of the route — where the crate rides — carried no hazards at all:
 * anything the load could be dragged through was an instant loss, so nothing
 * was ever put there.
 *
 * One bite per contact, and the value swept against `npm run playtest`. There
 * is a cliff between 20 and 26: at 26 the two-player policies fall from ~375
 * rows of the campaign in three minutes to ~92, losing eleven crates. At 20
 * they hold their distance and lose between half a crate and four, depending
 * entirely on whether they stay level with each other — which is the lesson
 * the game is trying to teach, arrived at by the crate rather than by a hint.
 */
export const CARGO_HAZARD_BITE = 20;
export const CARGO_HAZARD_GRACE = 30;

export const CARGO_IMPACT_MIN = 820;
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
export const SIM_VERSION = 19;

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
