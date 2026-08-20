import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_P1, DEFAULT_P2, type Action, type Bindings } from '../src/input.js';

/**
 * Both players' input masks are read from one set of held keys, so a key bound
 * to both players is not a preference — it is one player driving the other.
 *
 * This shipped: player one held the four arrow keys, which are player two's
 * only movement keys. Player two walking left dragged player one left; player
 * two walking left while player one held D set both direction bits on player
 * one, and the "both directions cancel" rule froze him where he stood. In a
 * game about two bodies on one rope, the second player could not move without
 * wrecking the first, and the end-to-end test never caught it because it only
 * ever pressed D.
 */
function keysOf(bindings: Bindings): Map<string, Action> {
  const out = new Map<string, Action>();
  for (const action of ACTIONS) {
    for (const code of bindings[action]) out.set(code, action);
  }
  return out;
}

describe('keyboard bindings', () => {
  it('never gives one key to both players', () => {
    const p2 = keysOf(DEFAULT_P2);
    const clashes: string[] = [];
    for (const action of ACTIONS) {
      for (const code of DEFAULT_P1[action]) {
        const owner = p2.get(code);
        if (owner) clashes.push(`${code}: player one's ${action} is player two's ${owner}`);
      }
    }
    expect(clashes).toEqual([]);
  });

  it('leaves both players able to move, jump and brace', () => {
    for (const [name, bindings] of [
      ['player one', DEFAULT_P1],
      ['player two', DEFAULT_P2],
    ] as const) {
      for (const action of ['left', 'right', 'jump', 'grip'] as Action[]) {
        expect(bindings[action].length, `${name} has no ${action}`).toBeGreaterThan(0);
      }
    }
  });

  it('keeps the arrow keys on player two, who has nowhere else to go', () => {
    const p2 = keysOf(DEFAULT_P2);
    for (const arrow of ['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown']) {
      expect(p2.has(arrow), `${arrow} should belong to player two`).toBe(true);
    }
  });
});
