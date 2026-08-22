import { describe, expect, it } from 'vitest';
import { ACTIONS, DEFAULT_P1, DEFAULT_P2, InputManager, type Action, type Bindings } from '../src/input.js';

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

/**
 * A tiny stand-in for `window`: enough of an event target to drive the key
 * handlers, and no DOM at all, because the thing under test here is which keys
 * the game takes away from the page rather than what the page does with them.
 */
function fakeWindow(): { fire: (type: string, event: unknown) => void } & Pick<Window, 'addEventListener'> {
  const handlers = new Map<string, (event: unknown) => void>();
  return {
    addEventListener: ((type: string, fn: (event: unknown) => void) => handlers.set(type, fn)) as Window['addEventListener'],
    fire: (type, event) => handlers.get(type)?.(event),
  };
}

function keyEvent(code: string): { code: string; repeat: boolean; target: null; preventDefault: () => void; prevented: number } {
  const e = {
    code,
    repeat: false,
    target: null,
    prevented: 0,
    preventDefault(): void {
      e.prevented++;
    },
  };
  return e;
}

describe('the keys a menu needs back', () => {
  it('only swallows Tab and Space while the haulers are the thing on screen', () => {
    const input = new InputManager();
    const win = fakeWindow();
    input.attach(win as unknown as Window);

    const inPlay = keyEvent('Tab');
    win.fire('keydown', inPlay);
    expect(inPlay.prevented, 'Tab during a match belongs to the game').toBe(1);

    // Every menu control is a real button, so Tab reaching it and Space
    // pressing it are what makes the game playable without a mouse. Swallowed
    // everywhere, they made the whole interface pointer-only.
    input.swallowKeys = false;
    for (const code of ['Tab', 'Space']) {
      const inMenu = keyEvent(code);
      win.fire('keydown', inMenu);
      expect(inMenu.prevented, `${code} in a menu belongs to the browser`).toBe(0);
    }
  });

  it('reports one menu press per press, not one per frame held', () => {
    const input = new InputManager();
    const win = fakeWindow();
    input.attach(win as unknown as Window);

    win.fire('keydown', keyEvent('ArrowDown'));
    expect(input.menuEdges().down).toBe(true);
    expect(input.menuEdges().down, 'held is not pressed again').toBe(false);
    win.fire('keyup', keyEvent('ArrowDown'));
    win.fire('keydown', keyEvent('ArrowDown'));
    expect(input.menuEdges().down).toBe(true);
  });
});
