import { describe, expect, it } from 'vitest';
import { CARGO_HP, analyseLevel, buildCampaign, buildTower } from '../src/index.js';

/**
 * The Gauntlet had to stop being a reshuffle.
 *
 * Its promise is a different tower every time, and for a long while it
 * delivered a different order: sixty rooms dealt in a new sequence is sixty
 * rooms however you cut it. Three judges scored the game independently and all
 * three failed it on "at least a week of reasons to come back", two of them
 * using the word reshuffle. A named condition on a floor multiplies the library
 * instead — the same room climbed with the wind up, or with no checkpoint to
 * bank it, or with the crate already cracked, is a different problem, and it
 * says so before you have taken a step.
 */
describe('floor conditions', () => {
  it('names a fraction of the floors, and more of them higher up', () => {
    const share = (l: ReturnType<typeof buildTower>): number =>
      l.floorRules.filter(Boolean).length / l.floorRules.length;
    expect(share(buildTower(4242, 40)), 'a tall tower should carry more than a short one').toBeGreaterThan(
      share(buildTower(4242, 6)),
    );
    // Not every floor: a condition on all of them is the same as none of them.
    expect(share(buildTower(4242, 40))).toBeLessThan(0.7);
  });

  it('leaves the ground floor and the roof alone', () => {
    for (const seed of [1, 7, 99, 104729]) {
      const l = buildTower(seed, 12);
      expect(l.floorRules[0], 'the first thing a player meets should be the game').toBe('');
      expect(l.floorRules[1]).toBe('');
      expect(l.floorRules[l.floorRules.length - 1], 'the goal room').toBe('');
    }
  });

  it('gives both peers the same tower, because it is all derived from the seed', () => {
    for (const seed of [3, 55, 8191]) {
      const a = buildTower(seed, 15);
      const b = buildTower(seed, 15);
      expect(a.floorRules).toEqual(b.floorRules);
      expect(a.crateHp).toBe(b.crateHp);
      expect(Array.from(a.tiles)).toEqual(Array.from(b.tiles));
    }
  });

  it('never hands out a cracked crate on the way up from the ground', () => {
    // A crate that starts damaged on floor two is a run that was over before it
    // began. It is only ever dealt above the halfway mark, and only once.
    for (let seed = 1; seed <= 60; seed++) {
      const l = buildTower(seed * 7919, 12);
      const at = l.floorRules.indexOf('CRACKED CRATE');
      if (at < 0) {
        expect(l.crateHp).toBe(0);
        continue;
      }
      expect(at / l.floorRules.length, 'dealt below the halfway mark').toBeGreaterThan(0.4);
      expect(l.crateHp).toBeGreaterThan(0);
      expect(l.crateHp).toBeLessThan(CARGO_HP);
      expect(l.floorRules.filter((r) => r === 'CRACKED CRATE')).toHaveLength(1);
    }
  });

  /**
   * The load-bearing one. A condition that could make a room unclimbable is a
   * condition that ships a tower nobody can finish, so none of them moves a
   * foothold — and this is what proves that rather than the comment saying so.
   */
  it('never makes a tower unclimbable', () => {
    for (let seed = 1; seed <= 40; seed++) {
      const l = buildTower(seed * 7919, 10);
      expect(analyseLevel(l, { coop: true }).ok, `tower ${seed * 7919}`).toBe(true);
    }
  });

  it('leaves the authored campaign exactly as it was authored', () => {
    const c = buildCampaign();
    expect(c.floorRules.every((r) => r === ''), 'a hand-built tower needs no dressing').toBe(true);
    expect(c.crateHp).toBe(0);
  });
});
