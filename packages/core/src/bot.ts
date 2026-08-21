/**
 * A bot hauler.
 *
 * HAULMATES needs two people. That is the point of it, and it is also the
 * reason nobody can try it alone. This is the fix: a partner that climbs the
 * route the level verifier already proved is climbable, and — more
 * importantly — behaves like a rope partner rather than a racer.
 *
 * It is not a neural network and it does not search the state space. It reads
 * the same flood fill that gates the build (route.ts), walks the cell path it
 * hands back, and runs a handful of rules about the rope on top:
 *
 *   - never climb so far ahead that the rope starts dragging you;
 *   - brace while your partner is mid-climb, so the rope has a fixed end to
 *     pivot on rather than a second moving one;
 *   - when your partner is stranded below, keep bracing and let them reel up
 *     you; when you are the one stranded, reel;
 *   - never take off while the crate is still travelling, because climbing
 *     shortens the rope and the rope yanks whatever is on the end of it.
 *
 * Those rules are why the bot is worth having rather than a moving obstacle:
 * they are the co-operative half of the game, played back at you. Bracing in
 * particular is measurable — with it on, a bot pair climbs roughly twice as far
 * before the crate gives out.
 *
 * Three details are worth knowing before changing anything here.
 *
 * **The route is not a walking path.** The flood fill's edges are hops — from
 * one cell it can see everything within four columns on the same row, so two
 * consecutive route cells on flat ground are usually four tiles apart with
 * solid floor the whole way. Treating that as a required jump makes the bot
 * pogo down corridors. `rowClear` is what tells the two apart.
 *
 * **Jumps need a run-up.** The reach numbers in route.ts were measured from a
 * player at running speed. A bot that walks back to line up on the launch
 * column arrives with its velocity pointing the wrong way and falls two tiles
 * short of every gap. So the bot backs off, turns around, and launches at
 * speed — the same thing a person does without noticing they do it.
 *
 * **Where you jump from matters more than when.** The flood fill only knows
 * that some cell on the upper ledge is within reach of some cell on the lower
 * one; it does not care that the route cell it picked has a ceiling nine
 * pixels above the hauler's head. The bot therefore chooses its own launch
 * column — the one nearest the landing ledge with enough clear air overhead to
 * complete the rise — which is exactly the search the level verifier runs
 * before it will call a step makeable.
 *
 * Saws are handled separately and cheaply: their positions are pure functions
 * of the tick, so the bot simply looks at where the blade will be, steps out of
 * the way, and declines to jump into a landing that is about to be swept.
 *
 * The bot is deliberately deterministic — no wall clock, no randomness — so a
 * test can replay a climb and get the same answer every time. It never runs on
 * the netcode path (both peers send their own inputs), so it does not have to
 * be, but a bot you cannot reproduce is a bot you cannot debug.
 *
 * What it cannot do, so nobody has to rediscover it: bounce pads and grip walls
 * are invisible to it, because the route analysis deliberately ignores both as
 * shortcuts. It plays the tower the boring way, which is the way the level was
 * proved climbable.
 */
import {
  AIR_ACCEL,
  DT,
  GRAVITY,
  GRIP_MAX,
  IN_DOWN,
  IN_GRIP,
  IN_JUMP,
  IN_LEFT,
  IN_REEL,
  IN_RIGHT,
  JUMP_CUT,
  SAW_RADIUS,
  JUMP_VELOCITY,
  PLAYER_H,
  PLAYER_HALF_W,
  ROPE_MAX,
  ROPE_REST,
  RUN_SPEED,
  TILE,
} from './constants.js';
import { approach } from './math.js';
import { T_PLATFORM, isDeadlyTile, isSolidTile, sawX, sawY, tileAt, type Level } from './level.js';
import { bodyCell, cellCentreX, cellCentreY, planRoute, type RouteCell, type RoutePlan } from './route.js';
import type { World } from './types.js';

/** How much of the rope's length the bot will spend on a lead before waiting. */
/** Stay inside the rope's rest length: past it the rope is a spring, and a
 *  spring with a crate on it is how the crate dies. */
const LEASH = ROPE_MAX * 0.45;
/** Rows the bot will climb above its partner before waiting for them. */
const LEAD_ROWS = 3;
/** Rows below the bot the partner has to be before it braces as an anchor. */
const ANCHOR_ROWS = 3.5;
/** Horizontal slop, in pixels, before the bot bothers correcting. */
const DEADZONE = 4;
/** Distance at which the bot stops driving and coasts onto its mark. */
const BRAKE_DIST = 18;
/** Speed above which coasting beats another tick of acceleration. */
const BRAKE_SPEED = 110;
/**
 * How far off its mark a settled hauler has to be pushed before it steps back.
 *
 * A Schmitt trigger, in pixels, and the multiplier matters more than the
 * number: stopping still happens at DEADZONE, so the bot lands on its mark just
 * as precisely as before. Only *starting* is harder. Two earlier attempts at
 * this widened the deadzone itself instead, which made the bot stop short of
 * everything and halved how far the pair climbed — the fidget is caused by
 * being nudged off a mark it has already reached, not by imprecision reaching
 * it.
 */
const RESETTLE = DEADZONE * 3;
/**
 * How far below the waiting thresholds a hauler has to come before it sets off
 * again. The same Schmitt trigger as RESETTLE, applied to the decision that
 * actually deadlocked the campaign — starting to wait is easy, stopping is not.
 */
const WAIT_RELEASE = 0.8;
/**
 * Ticks a hauler will hold position for a partner before setting off anyway.
 *
 * Every deadlock this bot has ever produced has been a mutual wait: each of
 * them correctly concluded that the considerate thing to do was stand still,
 * and they were both right, and the pair then sat there for four minutes.
 * Nothing in the position of either hauler distinguishes that from a rescue
 * going well, so it cannot be detected — only timed out.
 */
const WAIT_PATIENCE = 300;
/**
 * Ticks without advancing along the route before the bot treats itself as
 * stuck, however busy it looks.
 *
 * The older stillness check measured pixels moved, which a bot alternating
 * LEFT and RIGHT sixty times a second passes with room to spare. Route
 * progress is the thing actually at stake, so it is the thing to measure.
 */
const STALL_TICKS = 480;
/** Pixels per tick of crate movement that counts as "still swinging". */
const CRATE_CALM_SPEED = 4;
/** Ticks to hold JUMP, indexed by rows to rise. Longer is higher, not further. */
const JUMP_HOLD = [10, 6, 14, 22];
/** Ticks between jump attempts, so a failed jump does not become a stutter. */
const JUMP_COOLDOWN = 12;
/** Speed, as a fraction of a full run, that counts as a proper run-up. */
const CHARGE_SPEED = 0.6;
/** Cells of run-up the bot will back off to find, room permitting. */
const RUNUP_CELLS = 2;
/** How far along a ledge the bot will look for a better launch column. */
const LEDGE_SCAN = 14;
/** Rows of clear air the bot checks for above a launch column. */
const HEADROOM_MAX = 7;
/** Ticks the bot will hold a big climb waiting for slack before trying anyway. */
const ROPE_PATIENCE = 260;
/** Jump strength the arc check assumes, as a fraction of the real one. */
const ARC_MARGIN = 0.95;
/** Ticks ahead the bot looks for a saw on its own square. */
const SAW_LOOKAHEAD = 40;
/** Ticks ahead the bot checks the far side of a jump for a saw. */
const SAW_LANDING_LOOKAHEAD = 70;
/** Clearance the bot wants from a blade, on top of both radii. */
const SAW_CLEARANCE = 16;
/** How far from its route cell the bot must be before it accepts a lower one. */
const BACKTRACK_REACH = 6;
/** Ticks of near-total stillness before the bot decides it is stuck. */
const STUCK_TICKS = 70;
/** How long an unstick manoeuvre runs. */
const UNSTICK_TICKS = 40;

interface Leap {
  launch: number;
  aim: number;
  land: number;
  hold: number;
  /** Launch at a run, or from a standstill. */
  running: boolean;
  /** Ticks after take-off before steering starts. */
  delay: number;
  cost: number;
  /** False when no arc flew and the bot is guessing. */
  sure: boolean;
}

/**
 * The take-off styles the bot knows, in the order it prefers them. A run keeps
 * momentum and clears distance; a standing jump with a late steer is how you
 * climb the inside corner of a step without putting your head through it, and
 * without it the bot cannot get off the first ledge of the campaign.
 */
const TAKEOFFS = [
  { running: true, delay: 0 },
  { running: false, delay: 0 },
  { running: false, delay: 5 },
  { running: false, delay: 9 },
  { running: false, delay: 14 },
];

export interface BotOptions {
  /** Extra rows of slack the bot allows before waiting. Default 0. */
  slack?: number;
  /** Rope length, in pixels, at which the leading hauler stops to wait. */
  leash?: number;
  /** Rows the bot climbs above its partner before waiting. */
  leadRows?: number;
  /** Refuse to take off while the crate is still travelling. Default true. */
  settleCrate?: boolean;
  /** Pixels per tick of crate motion that still counts as settled. */
  crateCalm?: number;
  /** Brace on the rope while the partner is mid-climb. Measured: with both
   *  this and `stagger` on, a bot pair climbs nearly twice as far before the
   *  crate gives out. It is also what the game is asking you to do. */
  brace?: boolean;
  /** Refuse to take off while the partner is mid-jump. Only worth doing
   *  alongside `brace`: waiting by itself just halves the climb rate, but
   *  waiting *while braced* is what stops the crate being catapulted. */
  stagger?: boolean;
}

/**
 * One bot, bound to a level. Call `think` exactly once per simulation tick —
 * it carries timers, and calling it twice per tick makes it jump twice as fast
 * and hold nothing for long enough.
 */
export class Bot {
  readonly level: Level;
  readonly plan: RoutePlan;

  /** How far along the route the bot believes it is standing. */
  cursor = 0;
  private jumpTicks = 0;
  private jumpCooldown = 0;
  private charging = false;
  private chargeFor = -1;
  private unstick = 0;
  private unstickDir = 1;
  private stillTicks = 0;
  private lastX = 0;
  private lastY = 0;
  private anchoring = false;
  private ropeWait = 0;
  /** True while holding position for a partner, with hysteresis on both edges. */
  private holding = false;
  /** Ticks spent holding position for a partner, so patience can run out. */
  private waitTicks = 0;
  /** Ticks since the route cursor last advanced. */
  private stallTicks = 0;
  /** Highest route cursor reached, so shuffling backwards does not reset the clock. */
  private bestCursor = -1;
  private leap: Leap | null = null;
  private leapFor = -1;
  private steerWait = 0;
  /** True while standing on a mark, so small shoves do not restart the walk. */
  private settled = false;
  private slack: number;
  private leash: number;
  private leadRows: number;
  private settleCrate: boolean;
  private crateCalm: number;
  private stagger: boolean;
  private brace: boolean;
  /** Ticks alive, for jitter that is not randomness. */
  private age = 0;

  constructor(level: Level, options: BotOptions = {}) {
    this.level = level;
    this.plan = planRoute(level);
    this.slack = options.slack ?? 0;
    this.leash = options.leash ?? LEASH;
    this.leadRows = options.leadRows ?? LEAD_ROWS;
    this.settleCrate = options.settleCrate ?? true;
    this.crateCalm = options.crateCalm ?? CRATE_CALM_SPEED;
    this.stagger = options.stagger ?? true;
    this.brace = options.brace ?? true;
  }

  /** Whether this level gave the bot anything to follow. */
  get ready(): boolean {
    return this.plan.ok && this.plan.cells.length > 1;
  }

  /** How far along the route the bot has climbed, 0..1. */
  get progress(): number {
    if (this.plan.cells.length < 2) return 0;
    return this.cursor / (this.plan.cells.length - 1);
  }

  reset(): void {
    this.cursor = 0;
    this.jumpTicks = 0;
    this.jumpCooldown = 0;
    this.charging = false;
    this.chargeFor = -1;
    this.unstick = 0;
    this.stillTicks = 0;
    this.anchoring = false;
    this.ropeWait = 0;
    this.leap = null;
    this.leapFor = -1;
    this.steerWait = 0;
    this.age = 0;
  }

  /** One tick of intent, as an input mask for player `index`. */
  think(world: World, index: number): number {
    this.age++;
    if (this.jumpCooldown > 0) this.jumpCooldown--;
    if (this.unstick > 0) this.unstick--;

    const p = world.players[index];
    const mate = world.players[1 - index];
    if (p.dead || world.restartTimer > 0 || world.finished) {
      this.jumpTicks = 0;
      this.charging = false;
      return 0;
    }
    if (!this.ready) return this.flail(index);

    this.trackStillness(p.x, p.y);
    const airborne = p.grounded !== 1;
    if (!airborne) this.relocate(p.x, p.y);

    const rx = mate.x - p.x;
    const ry = mate.y - p.y;
    const ropeDist = Math.sqrt(rx * rx + ry * ry);
    const mateRows = ry / TILE;

    let mask = 0;

    /* ------------------------------------------------------------- blades */
    // Saws are pure functions of the tick, so the bot can simply look at where
    // they will be. Without this it walks into the first sweeping blade on the
    // route and stays there, dying on a loop, which is exactly what it did.
    // Checked before everything else: a blade beats every other reason to be
    // standing somewhere, including bracing for a partner.
    const flee = this.bladeNear(world.tick, p.x, p.y, SAW_LOOKAHEAD);
    if (flee !== 0) {
      this.charging = false;
      this.anchoring = false;
      if (this.jumpTicks > 0) {
        this.jumpTicks--;
        mask |= IN_JUMP;
      }
      return mask | (flee > 0 ? IN_RIGHT : IN_LEFT);
    }

    /* ------------------------------------------------------------- anchor */
    const canAnchor = !airborne || p.wallDir !== 0;

    // Partner stranded below on a taut rope: brace so they can reel up you.
    // The most useful thing a partner can do in this game, and the thing a
    // human partner most reliably forgets to do. Hysteresis on all three
    // thresholds, so it commits to the hold instead of flickering out of it.
    const stranded =
      canAnchor &&
      mateRows > (this.anchoring ? ANCHOR_ROWS - 1 : ANCHOR_ROWS) &&
      ropeDist > ROPE_REST * (this.anchoring ? 0.85 : 1.02) &&
      p.grip > (this.anchoring ? 8 : GRIP_MAX * 0.25);
    this.anchoring = stranded;

    // Bracing while your partner is mid-climb gives the rope a fixed end to
    // pivot on, so their jump lifts the crate instead of whipping it.
    const bracing =
      this.brace && canAnchor && mate.grounded !== 1 && !mate.dead && mate.y < p.y && p.grip > GRIP_MAX * 0.3;

    if (stranded || bracing) {
      this.charging = false;
      return IN_GRIP;
    }

    /* --------------------------------------------------------------- reel */
    // Stranded ourselves: hanging or stuck with the partner well above.
    if (
      p.grip > GRIP_MAX * 0.2 &&
      -mateRows > 2 &&
      ropeDist > ROPE_REST * 1.05 &&
      (airborne || this.stillTicks > STUCK_TICKS)
    ) {
      mask |= IN_REEL;
    }

    /* --------------------------------------------------------- manoeuvre */
    const cells = this.plan.cells;
    const here = cells[Math.min(this.cursor, cells.length - 1)];
    const nextIndex = Math.min(this.cursor + 1, cells.length - 1);
    const next = cells[nextIndex];

    // Wait for a partner falling behind rather than hauling them into a wall.
    // A rope is only a leash if you use it as one.
    //
    // Only the hauler in front waits. Deciding purely on "is the rope tight"
    // deadlocks two bots instantly — both see a taut rope, both stop, and the
    // rope stays taut forever. Route position settles it: whoever is further
    // along holds, and the tower is a serpentine, so height alone would not.
    const mateCell = bodyCell(mate.x, mate.y);
    const mateIndex = this.indexAt(mateCell.x, mateCell.y);
    const inFront = mateIndex >= 0 ? this.cursor > mateIndex : mateRows > 0.5;
    //
    // Both thresholds have hysteresis, and they need it more than anything
    // else in here does. `waiting` chooses between two route cells that are
    // usually on opposite sides of the hauler, so a decision sitting on its
    // threshold does not wobble the bot by a pixel — it sends it left, then
    // right, then left, at sixty hertz. Measured on the campaign: three
    // hundred LEFTs and three hundred RIGHTs in six hundred ticks, perfectly
    // alternating, while the partner braced for it and the pair sat there for
    // four solid minutes.
    const patience = this.holding ? WAIT_RELEASE : 1;
    const considerate =
      !airborne &&
      nextIndex !== this.cursor &&
      inFront &&
      (ropeDist > this.leash * patience || mateRows > this.leadRows * patience + this.slack);
    // Patience runs out. Without this the wait is unbounded, and an unbounded
    // wait held by both haulers at once is a deadlock with no way out of it.
    const waiting = considerate && this.waitTicks < WAIT_PATIENCE;
    this.waitTicks = considerate ? this.waitTicks + 1 : 0;
    this.holding = waiting;
    const target = waiting ? here : next;

    if (this.chargeFor !== nextIndex) {
      this.chargeFor = nextIndex;
      this.charging = false;
    }

    const rise = here.y - target.y;
    const gap = Math.abs(target.x - here.x);
    // Same row with clear floor between is a stroll, not a leap: the flood
    // fill's edges span four columns even when every tile between is walkable.
    const stroll = rise === 0 && this.rowClear(here.y, here.x, target.x);
    const needJump = !waiting && !stroll && (rise > 0 || (rise === 0 && gap > 0) || (rise < 0 && gap > 3));

    // A leap is planned only when one is needed. Asking for the nearest cell
    // of the destination ledge when the destination is the ledge you are
    // already standing on answers "right here", and the bot never sets off.
    const leap = needJump ? this.planLeap(here, target, Math.max(0, rise)) : null;
    // Do not jump into a blade's path. Landing on the far ledge a tick before
    // the saw arrives there is worse than standing still for a second.
    const landingSwept =
      leap !== null &&
      this.bladeNear(
        world.tick,
        cellCentreX(leap.land),
        cellCentreY(target.y),
        SAW_LANDING_LOOKAHEAD,
      ) !== 0;
    const launchX = cellCentreX(leap ? leap.launch : here.x);
    const aimX = cellCentreX(leap ? leap.land : target.x);
    const dir = leap ? (leap.aim > leap.launch ? 1 : leap.aim < leap.launch ? -1 : 0) : 0;
    const hold = leap ? leap.hold : JUMP_HOLD[0];

    // Do not start a real climb on a taut rope. The reach figures the route
    // was proved against assume a hauler carrying their own weight; with a
    // partner and half a crate hanging off you, a three-tile jump lands two
    // tiles short. Standing at the lip until they catch up is both the
    // correct play and a legible one — it looks like waiting, because it is.
    const roped = rise >= 2 && ropeDist > ROPE_REST;
    if (roped && !airborne) this.ropeWait++;
    else this.ropeWait = 0;
    // Never take off while the crate is already travelling. Climbing shortens
    // the rope, the rope yanks whatever is on the end of it, and a crate doing
    // a thousand pixels a second into the underside of the ledge you just left
    // is most of the damage in a bad run.
    const swinging = this.settleCrate && rise > 0 && Math.abs(world.cargo.y - world.cargo.py) > this.crateCalm;
    // One hauler in the air at a time, and it is always the same one who yields.
    //
    // The rule itself is sound: two people jumping off the same ledge in
    // opposite directions is how a rope becomes a catapult. Applying it
    // symmetrically is not, because then it is a rule about *both* of them and
    // each defers to the other. Measured over the 7,309 ticks a stalled
    // campaign pair spent declining to take off, they could legally jump on
    // 10.5% of them, and the partner being airborne accounted for 44%. Two
    // bots with identical courtesy starve each other's takeoff windows.
    //
    // Deriving right of way from route position — whoever is behind goes first
    // — is the rule two people would use and it is measurably worse here,
    // because the roles then swap several times a step and neither of them is
    // ever consistently the one who waits. Across ten levels: route 16.33% but
    // crate breaks 30, against 16.14% and 8 breaks for a fixed role. What the
    // pair needs is not a fair rule, it is a settled one.
    //
    // Fixing it to the slot also gets the human case right for free, because
    // the bot always takes the second one: a person playing with the Autohauler
    // is player zero, so the bot is the one who waits for them.
    //
    // Turning the gate off for *both* of them measures 12.70% with 24 breaks,
    // which is what proves the asymmetry is doing the work and not the removal.
    const yields = index === 1;
    const bothAirborne = this.stagger && rise > 0 && mate.grounded !== 1 && !mate.dead && yields;
    const heldByRope = (roped && this.ropeWait < ROPE_PATIENCE) || swinging || bothAirborne;

    let want = 0;
    if (this.unstick > 0) {
      want = this.unstickDir;
      if (!airborne && this.jumpTicks === 0 && this.jumpCooldown === 0) {
        this.jumpTicks = JUMP_HOLD[2];
        this.jumpCooldown = JUMP_COOLDOWN + this.jumpTicks;
      }
    } else if (this.jumpTicks > 0 || airborne) {
      // Committed. Hold the line for as long as the arc said, then steer at
      // where we mean to land — on a corner climb those first few ticks are
      // the difference between clearing the step and headbutting it.
      if (this.steerWait > 0) {
        this.steerWait--;
        want = 0;
      } else {
        want = this.toward(p.x, aimX, p.vx);
      }
    } else if (!needJump) {
      this.charging = false;
      want = this.toward(p.x, waiting ? cellCentreX(here.x) : aimX, p.vx);
      // Dropping onto a route cell directly below a one-way platform: step
      // down through it rather than walking round to the side.
      if (rise < 0 && Math.abs(aimX - p.x) < TILE * 0.6 && tileAt(this.level, here.x, here.y + 1) === T_PLATFORM) {
        mask |= IN_DOWN;
      }
    } else if (leap && leap.running) {
      const ahead = (p.x - launchX) * dir;
      if (!this.charging) {
        const back = this.runupX(leap.launch, here.y, dir);
        if (ahead <= 0 && p.vx * dir >= RUN_SPEED * CHARGE_SPEED) this.charging = true;
        else if ((p.x - back) * dir <= 4) this.charging = true;
        else want = -dir;
      }
      if (this.charging) {
        want = dir;
        // Launch as late as the ledge allows: every column travelled on the
        // ground is a column the jump does not have to buy.
        if (!heldByRope && !landingSwept && ahead >= -2 && ahead <= TILE * 0.9 && this.jumpCooldown === 0) {
          this.jumpTicks = hold;
          this.jumpCooldown = JUMP_COOLDOWN + hold;
          this.steerWait = 0;
        }
      }
    } else {
      this.charging = false;
      want = this.toward(p.x, launchX, p.vx);
      const settled = Math.abs(launchX - p.x) <= DEADZONE * 2 && Math.abs(p.vx) < 45;
      if (!heldByRope && !landingSwept && settled && this.jumpCooldown === 0) {
        this.jumpTicks = hold;
        this.jumpCooldown = JUMP_COOLDOWN + hold;
        this.steerWait = leap ? leap.delay : 0;
        want = 0;
      }
    }

    if (this.jumpTicks > 0) {
      this.jumpTicks--;
      mask |= IN_JUMP;
    }
    if (want > 0) mask |= IN_RIGHT;
    else if (want < 0) mask |= IN_LEFT;
    return mask;
  }

  /* -------------------------------------------------------------- helpers */

  private toward(x: number, goal: number, vx = 0): number {
    const d = goal - x;
    const away = Math.abs(d);
    // Hysteresis. Standing on a ledge with a partner and a crate on the end of
    // the rope, the bot is shoved a pixel or two off its mark several times a
    // second; without this it answers every shove, and the answer is a
    // direction change. Measured at twenty-six reversals a second, which is
    // not a deadlock and does not fail anything — it just looks broken to
    // anyone watching it for five seconds.
    if (away <= (this.settled ? RESETTLE : DEADZONE)) {
      this.settled = true;
      return 0;
    }
    this.settled = false;
    // Coast the last few pixels. Driving all the way onto the mark and then
    // correcting back sends a whip down the rope, and the crate hanging off
    // the middle of it is what pays for that.
    if (away < BRAKE_DIST && vx * d > 0 && Math.abs(vx) > BRAKE_SPEED) return 0;
    return d > 0 ? 1 : -1;
  }

  /** Every cell between two columns on one row is standable. */
  private rowClear(y: number, x0: number, x1: number): boolean {
    const lo = Math.min(x0, x1);
    const hi = Math.max(x0, x1);
    for (let x = lo; x <= hi; x++) {
      if (!this.plan.standable[y * this.plan.w + x]) return false;
    }
    return true;
  }

  /** How far back along this ledge the bot can go to build up speed. */
  private runupX(x0: number, y: number, dir: number): number {
    let x = x0;
    for (let k = 0; k < RUNUP_CELLS; k++) {
      const nx = x - dir;
      if (nx < 0 || nx >= this.plan.w) break;
      if (!this.plan.standable[y * this.plan.w + nx]) break;
      x = nx;
    }
    return cellCentreX(x);
  }

  /** The contiguous run of standable cells containing this one. */
  private ledgeSpan(x: number, y: number): { x0: number; x1: number } {
    let x0 = x;
    let x1 = x;
    while (x0 > 0 && this.plan.standable[y * this.plan.w + (x0 - 1)]) x0--;
    while (x1 < this.plan.w - 1 && this.plan.standable[y * this.plan.w + (x1 + 1)]) x1++;
    return { x0, x1 };
  }

  /** Rows of clear air above a cell, capped. Solid or deadly both stop it. */
  private headroom(x: number, y: number): number {
    for (let n = 1; n <= HEADROOM_MAX; n++) {
      const t = tileAt(this.level, x, y - n);
      if (isSolidTile(t) || isDeadlyTile(t)) return n - 1;
    }
    return HEADROOM_MAX;
  }

  /**
   * Pick where to jump from, what to aim at, and how long to hold the button.
   *
   * The route only names one cell on each ledge, and both ledges are usually
   * wider than that. Which column you leave from decides whether the jump
   * works: leaving from the cell nearest a three-tile climb means crossing the
   * wall you are climbing while your head is still level with it, which is a
   * bonk, a two-tile fall, and a bot that tries the same thing forever.
   *
   * So each candidate column on the launch ledge gets its arc flown — plain
   * ballistics against the tile grid, with the body's actual box — and the
   * cheapest one that lands on the destination ledge wins. This is the same
   * question the level verifier answers by brute-forcing input scripts through
   * the real simulation; the bot cannot afford that at 60 Hz, so it answers it
   * the cheap way and keeps a margin in hand for the rope's weight.
   */
  private planLeap(here: RouteCell, target: RouteCell, rise: number): Leap {
    if (this.leapFor === this.cursor && this.leap) return this.leap;

    const from = this.ledgeSpan(here.x, here.y);
    const to = this.ledgeSpan(target.x, target.y);
    const lo = Math.max(from.x0, here.x - LEDGE_SCAN);
    const hi = Math.min(from.x1, here.x + LEDGE_SCAN);
    const holds = [JUMP_HOLD[Math.max(0, Math.min(JUMP_HOLD.length - 1, rise))], JUMP_HOLD[3], 6];

    // Cheapest launch column first, so the first arc that flies is also the
    // one that asks for the least walking.
    const columns: { x: number; aim: number; dir: number; cost: number }[] = [];
    for (let x = lo; x <= hi; x++) {
      const aim = x < to.x0 ? to.x0 : x > to.x1 ? to.x1 : x;
      const dir = aim > x ? 1 : aim < x ? -1 : 0;
      columns.push({ x, aim, dir, cost: Math.abs(x - here.x) + Math.abs(aim - x) * 2 });
    }
    columns.sort((a, b) => a.cost - b.cost);

    for (const c of columns) {
      for (const t of TAKEOFFS) {
        if (c.dir === 0 && t.running) continue;
        for (const hold of holds) {
          if (!this.arcClears(c.x, here.y, c.dir, hold, t.running, t.delay, to, target.y)) continue;
          this.leapFor = this.cursor;
          this.leap = {
            launch: c.x,
            aim: c.aim,
            land: c.dir === 0 ? c.aim : this.landing(c.aim, c.x, to),
            hold,
            running: t.running,
            delay: t.delay,
            cost: c.cost,
            sure: true,
          };
          return this.leap;
        }
      }
    }

    // Nothing flies. Fall back to the shortest hop with clear air overhead and
    // let the unstick timer deal with it if that fails too.
    let fallback = { x: here.x, aim: target.x, cost: Infinity };
    for (let x = lo; x <= hi; x++) {
      if (rise > 0 && this.headroom(x, here.y) < rise + 1) continue;
      const aim = x < to.x0 ? to.x0 : x > to.x1 ? to.x1 : x;
      const cost = Math.abs(aim - x) * 4 + Math.abs(x - here.x);
      if (cost < fallback.cost) fallback = { x, aim, cost };
    }
    this.leapFor = this.cursor;
    this.leap = {
      launch: fallback.x,
      aim: fallback.aim,
      land: this.landing(fallback.aim, fallback.x, to),
      hold: holds[0],
      running: true,
      delay: 0,
      cost: fallback.cost,
      sure: false,
    };
    return this.leap;
  }

  /** Steer one column deeper than the lip, so we arrive with speed to spare. */
  private landing(aim: number, launch: number, to: { x0: number; x1: number }): number {
    if (aim < to.x1 && aim <= launch) return aim + 1;
    if (aim > to.x0 && aim >= launch) return aim - 1;
    return aim;
  }

  /**
   * Fly one arc and report whether it lands on the destination ledge without
   * hitting anything. Deliberately conservative: no wall sliding, no coyote
   * time, and a jump slightly weaker than the real one, because a jump the bot
   * believes in and cannot make is worse than one it declines.
   */
  private arcClears(
    launch: number,
    row: number,
    dir: number,
    hold: number,
    running: boolean,
    delay: number,
    to: { x0: number; x1: number },
    toRow: number,
  ): boolean {
    let x = cellCentreX(launch);
    let y = cellCentreY(row);
    let vy = JUMP_VELOCITY * ARC_MARGIN;
    let vx = running ? dir * RUN_SPEED : 0;
    const floor = (toRow + 1) * TILE;
    for (let t = 0; t < 96; t++) {
      vy += GRAVITY * DT;
      if (t === hold && vy < 0) vy *= JUMP_CUT;
      if (t >= delay) vx = approach(vx, dir * RUN_SPEED, AIR_ACCEL * DT);
      const ny = y + vy * DT;
      const nx = x + vx * DT;
      if (this.boxHits(nx, ny)) return false;
      x = nx;
      y = ny;
      const feet = y + PLAYER_H / 2;
      if (vy > 0 && feet >= floor - 2 && feet <= floor + 8) {
        const col = Math.floor(x / TILE);
        if (col >= to.x0 && col <= to.x1) return true;
      }
      if (y > floor + TILE * 2) return false;
    }
    return false;
  }

  /**
   * Will a blade sweep across this spot soon? Returns the way to run, or 0.
   */
  private bladeNear(tick: number, x: number, y: number, ahead: number): number {
    const saws = this.level.saws;
    if (saws.length === 0) return 0;
    const reach = SAW_RADIUS + PLAYER_HALF_W + SAW_CLEARANCE;
    const vertical = SAW_RADIUS + PLAYER_H / 2 + SAW_CLEARANCE;
    for (const saw of saws) {
      for (let t = 0; t <= ahead; t += 2) {
        const sy = sawY(saw, tick + t);
        if (Math.abs(sy - y) > vertical) continue;
        const sx = sawX(saw, tick + t);
        if (Math.abs(sx - x) < reach) return sx > x ? -1 : 1;
      }
    }
    return 0;
  }

  /** Does a body centred here overlap anything solid or lethal? */
  private boxHits(x: number, y: number): boolean {
    const tx0 = Math.floor((x - PLAYER_HALF_W) / TILE);
    const tx1 = Math.floor((x + PLAYER_HALF_W - 1) / TILE);
    const ty0 = Math.floor((y - PLAYER_H / 2) / TILE);
    const ty1 = Math.floor((y + PLAYER_H / 2 - 1) / TILE);
    for (let ty = ty0; ty <= ty1; ty++) {
      for (let tx = tx0; tx <= tx1; tx++) {
        const t = tileAt(this.level, tx, ty);
        if (isSolidTile(t) || isDeadlyTile(t)) return true;
      }
    }
    return false;
  }

  /**
   * Keep `cursor` pointing at where the bot actually is on the route.
   *
   * Every candidate goes through `adopt`, which is what stops the bot
   * vibrating. Re-deriving the cursor from the body cell on every grounded
   * tick sounds harmless and is not: standing between two route cells, a
   * pixel of drift flips which one is nearest, the two have launch columns on
   * opposite sides, and the bot alternates LEFT and RIGHT at twenty-nine
   * reversals a second. It never falls over and it never gets anywhere, and
   * to anyone watching it is simply broken.
   */
  private relocate(x: number, y: number): void {
    const cell = bodyCell(x, y);
    const direct = this.indexAt(cell.x, cell.y);
    if (direct >= 0) {
      this.adopt(direct, cell);
      return;
    }
    // Mid-stroll between two route cells: the cells in between are not on the
    // route at all. Hold the cursor while we are plausibly still walking the leg.
    const held = this.plan.cells[Math.min(this.cursor, this.plan.cells.length - 1)];
    if (held.y === cell.y && Math.abs(held.x - cell.x) <= 5) return;

    // Landed somewhere else on the ledge we were aiming at — which is the
    // normal case, since the bot aims at whichever end of it is nearest.
    if (cell.y >= 0 && cell.y < this.plan.h) {
      const span = this.ledgeSpan(cell.x, cell.y);
      let onLedge = -1;
      let nearest = Infinity;
      for (let sx = span.x0; sx <= span.x1; sx++) {
        const i = this.indexAt(sx, cell.y);
        if (i < 0) continue;
        const d = Math.abs(sx - cell.x);
        if (d < nearest || (d === nearest && i > onLedge)) {
          nearest = d;
          onLedge = i;
        }
      }
      if (onLedge >= 0) {
        this.adopt(onLedge, cell);
        return;
      }
    }

    // Knocked off the route by a rope yank, a crumbling ledge or a fall:
    // rejoin at the nearest route cell rather than marching toward a waypoint
    // no longer connected to where we ended up.
    let bestIndex = -1;
    let bestScore = Infinity;
    for (let r = 1; r <= 7 && bestIndex < 0; r++) {
      for (let oy = -r; oy <= r; oy++) {
        for (let ox = -r; ox <= r; ox++) {
          if (Math.max(Math.abs(ox), Math.abs(oy)) !== r) continue;
          const i = this.indexAt(cell.x + ox, cell.y + oy);
          if (i < 0) continue;
          const score = ox * ox + oy * oy;
          if (score < bestScore || (score === bestScore && i > bestIndex)) {
            bestScore = score;
            bestIndex = i;
          }
        }
      }
    }
    if (bestIndex >= 0) this.adopt(bestIndex, cell);
  }

  /**
   * Move the cursor, but only forwards unless we have genuinely lost ground.
   *
   * Forwards is always fine — that is progress. Backwards has to be earned:
   * the bot must actually be below where the route says it should be, or far
   * enough away that the current leg is meaningless. Without that test, two
   * adjacent cells that happen to resolve to different route indices trade the
   * cursor back and forth forever.
   */
  private adopt(index: number, cell: RouteCell): void {
    if (index >= this.cursor) {
      this.cursor = index;
      return;
    }
    const here = this.plan.cells[Math.min(this.cursor, this.plan.cells.length - 1)];
    const fellBelow = cell.y > here.y + 1;
    const strayed = Math.abs(cell.x - here.x) > BACKTRACK_REACH || Math.abs(cell.y - here.y) > BACKTRACK_REACH;
    if (fellBelow || strayed) this.cursor = index;
  }

  private indexAt(x: number, y: number): number {
    if (x < 0 || y < 0 || x >= this.plan.w || y >= this.plan.h) return -1;
    return this.plan.indexAt[y * this.plan.w + x];
  }

  private trackStillness(x: number, y: number): void {
    const moved = Math.abs(x - this.lastX) + Math.abs(y - this.lastY);
    this.lastX = x;
    this.lastY = y;
    if (moved < 0.6) this.stillTicks++;
    else this.stillTicks = 0;

    // Two clocks, because there are two ways to get nowhere. Standing
    // perfectly still is the obvious one. The other is being extremely busy
    // about it — pacing, jiggling, running up to a jump and backing off again
    // — which sails past a check on pixels moved and gets absolutely nothing
    // done. Route progress catches both.
    if (this.cursor > this.bestCursor) {
      this.bestCursor = this.cursor;
      this.stallTicks = 0;
    } else {
      this.stallTicks++;
    }

    if ((this.stillTicks > STUCK_TICKS || this.stallTicks > STALL_TICKS) && this.unstick === 0) {
      this.unstick = UNSTICK_TICKS;
      this.unstickDir = -this.unstickDir;
      this.stillTicks = 0;
      this.stallTicks = 0;
      this.waitTicks = WAIT_PATIENCE;
    }
  }

  /**
   * Fallback for a level with no computable route — a hand-made test fixture,
   * or a chunk library change that broke the fill. Wander and jump rather than
   * stand there looking broken.
   */
  private flail(index: number): number {
    const t = (this.age + index * 37) % 180;
    let mask = 0;
    if (t < 70) mask |= IN_RIGHT;
    else if (t < 140) mask |= IN_LEFT;
    if (t % 34 < 6) mask |= IN_JUMP;
    return mask;
  }
}
