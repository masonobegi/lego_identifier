import { describe, expect, it } from 'vitest';
import { analyseLevel, assembleLevel, type Level } from '../src/index.js';
import { verifyLevel } from '../../../scripts/verify-levels.mjs';

/**
 * A room split by a shutter, with a plate on each side of it.
 *
 * `doorTop` is where the shutter starts: taken to the ceiling it is a door and
 * the only way across, and stopped short of it — with a shelf over the top —
 * it is a door the pair have no reason to open. Both shapes matter, because
 * the fill has to prefer the ordinary way round wherever there is one.
 */
function room(opts: {
  doorTop: number;
  far?: number;
  nearPlate?: boolean;
  farPlate?: boolean;
  shelf?: boolean;
}): Level {
  const W = 40;
  const H = 24;
  const floor = 20;
  const door = 12;
  const near = 6;
  const far = opts.far ?? 14;
  const rows: string[] = [];
  for (let r = 0; r < H; r++) {
    let s = '';
    for (let c = 0; c < W; c++) {
      if (r <= 1 || r > floor) s += '#';
      else if (c < 2 || c >= W - 2) s += '#';
      else if (r === floor) {
        const plate = (c === near && opts.nearPlate !== false) || (c === far && opts.farPlate !== false);
        s += plate ? '_' : '#';
      } else if (c === door && r >= opts.doorTop) s += 'H';
      else if (opts.shelf && r === floor - 3 && c >= 10 && c <= 20) s += '#';
      else s += '.';
    }
    rows.push(s);
  }
  const stand = floor - 1;
  rows[stand] = `${rows[stand].slice(0, 4)}S${rows[stand].slice(5)}`;
  rows[stand] = `${rows[stand].slice(0, 30)}F${rows[stand].slice(31)}`;
  return assembleLevel('room', 'ROOM', [{ id: 'room', biome: 0, difficulty: 0, rows, tags: ['start'] }]);
}

const DOOR_COL = 12;

describe('shutters in the reachability fill', () => {
  /**
   * The fill's edges are indifferent to what lies between their ends, because
   * everything else it models a gap through is empty. A door is not, and a
   * two-tile jump over a floor-to-ceiling one would have made every hold room
   * in the tower decoration the moment it was authored.
   */
  it('is a wall to one player and a door to a pair', () => {
    const level = room({ doorTop: 2 });
    const solo = analyseLevel(level);
    const pair = analyseLevel(level, { coop: true });
    expect(solo.ok, 'one player walked through a shutter').toBe(false);
    expect(pair.ok, 'a pair could not open a shutter').toBe(true);
    expect(
      pair.route.some((c) => c.x > DOOR_COL),
      'the route never crossed the door',
    ).toBe(true);
  });

  it('reports the crossing as a gate, and says which room it was', () => {
    const pair = analyseLevel(room({ doorTop: 2 }), { coop: true });
    expect(pair.holds.length, 'no hold on the route').toBeGreaterThan(0);
    const gated = new Set(pair.gates.map((g) => `${g.x},${g.y}`));
    for (const hold of pair.holds) {
      expect(hold.group, 'a hold from a room that does not exist').toBe(0);
      expect(hold.x, 'a hold short of the door').toBeGreaterThanOrEqual(DOOR_COL);
      expect(gated.has(`${hold.x},${hold.y}`), 'a hold missing from the gates').toBe(true);
    }
  });

  /**
   * A shutter is only a way on once the pair could be standing on the plate
   * that holds it. With the plate walled off on the far side there is nobody to
   * open it from, and a fill that spends the door anyway would report a room
   * as climbable that a pair would stand in until they quit.
   */
  it('will not open a door whose only plate is on the far side of it', () => {
    const level = room({ doorTop: 2, nearPlate: false });
    expect(analyseLevel(level, { coop: true }).ok).toBe(false);
  });

  /**
   * The same reason the boost is deferred: breadth-first, a co-op edge is the
   * shortest way anywhere it exists, so the fill would call for a hold at every
   * doorway it passed rather than at the ones that are in the way.
   */
  it('takes the shelf over the door rather than the door', () => {
    const level = room({ doorTop: 18, shelf: true });
    const solo = analyseLevel(level);
    const pair = analyseLevel(level, { coop: true });
    expect(solo.ok, 'the way over the shelf').toBe(true);
    expect(pair.holds.length, 'a hold spent where there was a way round').toBe(0);
  });

  /** Plates on their own are floor, and a room of them is the ordinary fill. */
  it('leaves a room with no shutter in it alone', () => {
    const level = room({ doorTop: 24 });
    const pair = analyseLevel(level, { coop: true });
    expect(pair.ok).toBe(true);
    expect(pair.holds.length).toBe(0);
  });
});

/**
 * The same room, seen by the build gate rather than by the fill.
 *
 * `far` is where the plate on the far side of the door sits, and it is the
 * whole difference between a room that needs two people and one that does not.
 */
function crossing(far: number): Level {
  return room({ doorTop: 2, far });
}

describe('hold rooms in the build gate', () => {
  it('replays the leapfrog in the simulation, and cannot do it alone', () => {
    // Two hundred random scripts rather than the fifteen hundred the build gate
    // spends on a room. The targeted sweep it runs first is the part that finds
    // the ways through — it is what catches the room below — and the rest is
    // there for the towers, where the shapes are not known in advance.
    const outcome = verifyLevel(crossing(14), 0, 1, { soloTries: 200 });
    expect(outcome.failures, 'a room built for a pair came back broken').toEqual([]);
    expect(outcome.holds, 'the room was never replayed').toBe(1);
  }, 120_000);

  it('rejects a shutter with a plate on only one side of it', () => {
    const level = room({ doorTop: 2, farPlate: false });
    const outcome = verifyLevel(level, 0, 1, { solo: false });
    expect(outcome.ok).toBe(false);
    expect(outcome.failures.join(' ')).toContain('only one side');
  });

  /**
   * The crate is the thing that beats a hold room, and where the far plate sits
   * decides whether it does.
   *
   * Measured on this room, one hauler walking right with a partner who presses
   * nothing: the crate hangs off the middle of the rope and is towed along the
   * floor behind them, and with the far plate four columns past the shutter it
   * comes to rest on that plate at the moment the towed partner reaches the
   * doorway — so the pair are through the room and neither of them held
   * anything. Two columns past, the crate settles clear of the plate and the
   * door shuts on the partner, which is the room working as designed.
   */
  it('rejects a room where one hauler can tow the other through', () => {
    const outcome = verifyLevel(crossing(16), 0, 1);
    expect(outcome.ok).toBe(false);
    expect(outcome.failures.join(' ')).toContain('ONE PLAYER CLEARED IT');
  });
});
