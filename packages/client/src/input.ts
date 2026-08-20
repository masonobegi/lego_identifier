import {
  IN_DOWN,
  IN_EMOTE,
  IN_GRIP,
  IN_JUMP,
  IN_LEFT,
  IN_REEL,
  IN_RESTART,
  IN_RIGHT,
} from '@haulmates/core';
import { load, save } from './storage.js';

export type Action = 'left' | 'right' | 'jump' | 'grip' | 'reel' | 'down' | 'emote' | 'restart';

export const ACTIONS: Action[] = ['left', 'right', 'jump', 'grip', 'reel', 'down', 'emote', 'restart'];

export const ACTION_BIT: Record<Action, number> = {
  left: IN_LEFT,
  right: IN_RIGHT,
  jump: IN_JUMP,
  grip: IN_GRIP,
  reel: IN_REEL,
  down: IN_DOWN,
  emote: IN_EMOTE,
  restart: IN_RESTART,
};

export const ACTION_LABEL: Record<Action, string> = {
  left: 'Move left',
  right: 'Move right',
  jump: 'Jump',
  grip: 'Grip / brace',
  reel: 'Reel toward partner',
  down: 'Crouch / drop through',
  emote: 'Emote',
  restart: 'Hold to restart at checkpoint',
};

export type Bindings = Record<Action, string[]>;

/**
 * First player on a shared keyboard.
 *
 * Deliberately no arrow keys. They used to be here as a convenience, and it
 * quietly broke the entire couch mode: both players' masks are read from one
 * `down` set, so every arrow press drove player one as well. Player two
 * walking left dragged player one left; player two walking left while player
 * one held D set both direction bits and the cancel rule below froze player
 * one on the spot. In a game that is two bodies on one rope, the second player
 * could not move without wrecking the first.
 *
 * Solo players still reach for the arrows, so `soloKeyboard` hands them player
 * two's bindings as well — but only when nobody is sitting in that seat.
 */
export const DEFAULT_P1: Bindings = {
  left: ['KeyA'],
  right: ['KeyD'],
  jump: ['Space', 'KeyW'],
  grip: ['ShiftLeft', 'KeyJ'],
  reel: ['KeyF', 'KeyE'],
  down: ['KeyS'],
  emote: ['KeyT'],
  restart: ['KeyR'],
};

/** Second player on a shared keyboard. Gamepads are strongly preferred, but a
 *  split keyboard means two people can play the minute they install it. */
export const DEFAULT_P2: Bindings = {
  left: ['ArrowLeft'],
  right: ['ArrowRight'],
  jump: ['ArrowUp', 'Numpad8'],
  grip: ['ShiftRight', 'Numpad1'],
  reel: ['ControlRight', 'Numpad2'],
  down: ['ArrowDown'],
  emote: ['Numpad0'],
  restart: ['NumpadDecimal'],
};

/** Standard-gamepad button indices per action. */
const PAD_BUTTONS: Record<Action, number[]> = {
  left: [14],
  right: [15],
  jump: [0],
  grip: [5, 7],
  reel: [4, 6],
  down: [13],
  emote: [3],
  restart: [8],
};

const AXIS_DEADZONE = 0.4;

export interface InputConfig {
  p1: Bindings;
  p2: Bindings;
}

function cloneBindings(b: Bindings): Bindings {
  const out = {} as Bindings;
  for (const a of ACTIONS) out[a] = [...b[a]];
  return out;
}

export class InputManager {
  private down = new Set<string>();
  private consumed = new Set<string>();
  config: InputConfig;
  /** Gamepad index assigned to each local slot, or -1. */
  pads: number[] = [-1, -1];
  /**
   * True when the second seat is not a local human — playing online, or with
   * the bot. Player one then also answers to player two's keys.
   */
  soloKeyboard = false;

  /** True while a rebinding prompt is capturing the next key. */
  capture: ((code: string) => void) | null = null;
  lastInputWasPad = false;

  constructor() {
    this.config = load<InputConfig>('bindings', { p1: cloneBindings(DEFAULT_P1), p2: cloneBindings(DEFAULT_P2) });
    for (const a of ACTIONS) {
      if (!Array.isArray(this.config.p1[a])) this.config.p1[a] = [...DEFAULT_P1[a]];
      if (!Array.isArray(this.config.p2[a])) this.config.p2[a] = [...DEFAULT_P2[a]];
    }
    this.unalias();
  }

  attach(target: Window = window): void {
    target.addEventListener('keydown', (e) => {
      if (this.capture) {
        e.preventDefault();
        const fn = this.capture;
        this.capture = null;
        if (e.code !== 'Escape') fn(e.code);
        return;
      }
      if (e.repeat) return;
      this.down.add(e.code);
      this.lastInputWasPad = false;
      // Space and the arrows scroll the page and activate focused buttons;
      // during play that would fight the game, so they are swallowed.
      if (SWALLOW.has(e.code) && !isTextEntry(e.target)) e.preventDefault();
    });
    target.addEventListener('keyup', (e) => {
      this.down.delete(e.code);
      this.consumed.delete(e.code);
    });
    target.addEventListener('blur', () => this.releaseAll());
    target.addEventListener('gamepadconnected', () => this.assignPads());
    target.addEventListener('gamepaddisconnected', () => this.assignPads());
    this.assignPads();
  }

  releaseAll(): void {
    this.down.clear();
    this.consumed.clear();
  }

  private assignPads(): void {
    const list = navigator.getGamepads ? navigator.getGamepads() : [];
    const connected: number[] = [];
    for (const pad of list) if (pad && pad.connected) connected.push(pad.index);
    this.pads = [connected[0] ?? -1, connected[1] ?? -1];
  }

  isDown(code: string): boolean {
    return this.down.has(code);
  }

  /** True once per physical press. Used for menu navigation. */
  pressed(code: string): boolean {
    if (!this.down.has(code) || this.consumed.has(code)) return false;
    this.consumed.add(code);
    return true;
  }

  private padFor(slot: number): Gamepad | null {
    const index = this.pads[slot];
    if (index < 0 || !navigator.getGamepads) return null;
    return navigator.getGamepads()[index] ?? null;
  }

  /**
   * Build the input bitmask for a local slot. Keyboard and gamepad are merged,
   * so a player can hold a stick and still hit a keyboard key.
   */
  mask(slot: number): number {
    const bindings = slot === 0 ? this.config.p1 : this.config.p2;
    let mask = 0;
    for (const action of ACTIONS) {
      for (const code of bindings[action]) {
        if (this.down.has(code)) {
          mask |= ACTION_BIT[action];
          break;
        }
      }
    }

    // Nobody in the second seat: let player one use those keys too, so the
    // arrows work for someone playing alone without ever aliasing onto a real
    // second player.
    if (slot === 0 && this.soloKeyboard) {
      for (const action of ACTIONS) {
        for (const code of this.config.p2[action]) {
          if (this.down.has(code)) {
            mask |= ACTION_BIT[action];
            break;
          }
        }
      }
    }

    const pad = this.padFor(slot);
    if (pad) {
      for (const action of ACTIONS) {
        for (const button of PAD_BUTTONS[action]) {
          const b = pad.buttons[button];
          if (b && (b.pressed || b.value > 0.5)) {
            mask |= ACTION_BIT[action];
            this.lastInputWasPad = true;
            break;
          }
        }
      }
      const x = pad.axes[0] ?? 0;
      const y = pad.axes[1] ?? 0;
      if (x < -AXIS_DEADZONE) mask |= IN_LEFT;
      if (x > AXIS_DEADZONE) mask |= IN_RIGHT;
      if (y > AXIS_DEADZONE) mask |= IN_DOWN;
      if (Math.abs(x) > AXIS_DEADZONE || Math.abs(y) > AXIS_DEADZONE) this.lastInputWasPad = true;
    }

    // Left and right at the same time would cancel out unpredictably; the most
    // recent intent wins, and holding both simply stands still.
    if ((mask & IN_LEFT) && (mask & IN_RIGHT)) mask &= ~(IN_LEFT | IN_RIGHT);
    return mask;
  }

  /** Pause is deliberately not rebindable: every game uses Escape and Start. */
  pausePressed(): boolean {
    if (this.pressed('Escape')) return true;
    for (const slot of [0, 1]) {
      const pad = this.padFor(slot);
      const start = pad?.buttons[9];
      if (start?.pressed) {
        const key = `pad${slot}:start`;
        if (!this.consumed.has(key)) {
          this.consumed.add(key);
          return true;
        }
      } else {
        this.consumed.delete(`pad${slot}:start`);
      }
    }
    return false;
  }

  /**
   * Bind a key, refusing anything the other player already holds.
   *
   * One `down` set feeds both masks, so a key shared between players is not a
   * preference — it is one player driving the other. Returns false when the
   * key was rejected, so the UI can say why.
   */
  rebind(slot: number, action: Action, code: string): boolean {
    if (this.boundToOtherPlayer(slot, code)) return false;
    const bindings = slot === 0 ? this.config.p1 : this.config.p2;
    bindings[action] = [code];
    this.persist();
    return true;
  }

  /**
   * Strip any key player one shares with player two.
   *
   * Saved bindings outlive the defaults that created them, so a config written
   * before the arrow keys were taken off player one would keep aliasing the
   * two players together forever. Player two wins the key: their layout is the
   * smaller one and they have nowhere else to go.
   */
  private unalias(): void {
    let stripped = 0;
    for (const action of ACTIONS) {
      const kept = this.config.p1[action].filter((code) => !this.boundToOtherPlayer(0, code));
      if (kept.length !== this.config.p1[action].length) {
        stripped += this.config.p1[action].length - kept.length;
        // Never leave an action unbound: fall back to the default, minus
        // anything player two holds.
        this.config.p1[action] =
          kept.length > 0 ? kept : DEFAULT_P1[action].filter((code) => !this.boundToOtherPlayer(0, code));
      }
    }
    if (stripped > 0) this.persist();
  }

  /** Which action of the other player owns this key, if any. */
  boundToOtherPlayer(slot: number, code: string): Action | null {
    const other = slot === 0 ? this.config.p2 : this.config.p1;
    for (const action of ACTIONS) {
      if (other[action].includes(code)) return action;
    }
    return null;
  }

  resetDefaults(): void {
    this.config = { p1: cloneBindings(DEFAULT_P1), p2: cloneBindings(DEFAULT_P2) };
    this.persist();
  }

  persist(): void {
    save('bindings', this.config);
  }

  get padCount(): number {
    return this.pads.filter((p) => p >= 0).length;
  }
}

const SWALLOW = new Set([
  'Space', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Tab',
  'ShiftLeft', 'ShiftRight', 'ControlRight',
]);

function isTextEntry(target: EventTarget | null): boolean {
  const el = target as HTMLElement | null;
  return Boolean(el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable));
}

/** Human-readable name for a KeyboardEvent.code. */
export function keyName(code: string): string {
  if (code.startsWith('Key')) return code.slice(3);
  if (code.startsWith('Digit')) return code.slice(5);
  if (code.startsWith('Numpad')) return `NUM ${code.slice(6) || '·'}`;
  if (code.startsWith('Arrow')) return { Up: '↑', Down: '↓', Left: '←', Right: '→' }[code.slice(5)] ?? code;
  return (
    {
      Space: 'SPACE',
      ShiftLeft: 'L-SHIFT',
      ShiftRight: 'R-SHIFT',
      ControlLeft: 'L-CTRL',
      ControlRight: 'R-CTRL',
      AltLeft: 'L-ALT',
      AltRight: 'R-ALT',
      Enter: 'ENTER',
      Escape: 'ESC',
      Tab: 'TAB',
      Backquote: '`',
    }[code] ?? code.toUpperCase()
  );
}
