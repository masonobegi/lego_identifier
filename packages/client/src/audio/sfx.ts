import {
  EV_BOUNCE,
  EV_CARGO_BREAK,
  EV_CARGO_HIT,
  EV_CARGO_LAND,
  EV_CHECKPOINT,
  EV_CRUMBLE,
  EV_DEATH,
  EV_EMOTE,
  EV_FINISH,
  EV_GRIP,
  EV_GRIP_FAIL,
  EV_JUMP,
  EV_LAND,
  EV_REEL,
  EV_RESPAWN,
  EV_RESTART,
  EV_BOOST,
  EV_ROPE_YANK,
  EV_SHUTTER_OPEN,
  EV_SHUTTER_SHUT,
  EV_STEP,
  GROUND_ICE,
  GROUND_MOVER,
  REEL_MAX_SPEED,
  type SimEvent,
} from '@haulmates/core';
import type { AudioEngine } from './synth.js';

/** Sounds louder than this many per frame get dropped: a cascade of crumbling
 *  blocks should feel busy, not turn into white noise. */
const MAX_PER_FRAME = 8;

export class Sfx {
  private budget = MAX_PER_FRAME;
  private lastStepAt = 0;

  constructor(private engine: AudioEngine) {}

  beginFrame(): void {
    this.budget = MAX_PER_FRAME;
  }

  /** Map one simulation event to a sound. `pan` is -1..1, `gain` 0..1. */
  play(event: SimEvent, pan: number, gain: number): void {
    if (!this.engine.ready || gain <= 0.02) return;
    if (this.budget-- <= 0) return;
    const bus = this.engine.panBus(pan);
    const e = this.engine;
    const g = gain;

    switch (event.kind) {
      case EV_JUMP: {
        // Wall jumps get a scrape underneath them so they read differently.
        const wall = event.b === 2;
        e.tone({ freq: wall ? 300 : 380, to: wall ? 620 : 700, dur: 0.11, type: 'square', gain: 0.14 * g, bus });
        if (wall) e.noise({ freq: 1800, to: 700, dur: 0.1, gain: 0.1 * g, bus });
        return;
      }
      case EV_LAND: {
        const force = Math.min(1, Math.abs(event.b) / 900);
        e.noise({ freq: 240 - force * 90, to: 90, q: 0.9, dur: 0.1 + force * 0.1, gain: (0.1 + force * 0.2) * g, type: 'lowpass', bus });
        e.tone({ freq: 130 - force * 40, to: 60, dur: 0.09, type: 'sine', gain: 0.16 * force * g, bus });
        return;
      }
      case EV_STEP: {
        const now = e.now;
        if (now - this.lastStepAt < 0.05) return;
        this.lastStepAt = now;
        const icy = event.b === GROUND_ICE;
        const metal = event.b === GROUND_MOVER;
        e.noise({
          freq: icy ? 3400 : metal ? 2200 : 1500,
          to: icy ? 2200 : 700,
          q: icy ? 3 : 1.1,
          dur: 0.045,
          gain: 0.05 * g,
          bus,
        });
        return;
      }
      case EV_BOOST: {
        // A heave: the grunt of the brace under you and the whoop of going up.
        // Deliberately unlike the jump it replaces, because the whole job of
        // this sound is to tell a pair that what just happened was a *different
        // thing* and they did it on purpose.
        e.tone({ freq: 160, to: 70, dur: 0.18, type: 'sawtooth', gain: 0.13 * g, send: 0.25, bus });
        e.tone({ freq: 330, to: 880, dur: 0.28, type: 'triangle', gain: 0.12 * g, bus });
        e.tone({ freq: 495, to: 1320, dur: 0.26, type: 'sine', gain: 0.07 * g, at: e.now + 0.04, bus });
        e.noise({ freq: 900, to: 2600, q: 1.4, dur: 0.22, gain: 0.07 * g, bus });
        return;
      }
      case EV_GRIP: {
        const anchor = event.b === 1;
        e.noise({ freq: anchor ? 700 : 1400, to: anchor ? 420 : 500, q: 2.4, dur: 0.16, gain: 0.09 * g, bus });
        if (anchor) e.tone({ freq: 220, to: 180, dur: 0.12, type: 'triangle', gain: 0.07 * g, bus });
        return;
      }
      case EV_REEL: {
        // Rope running through gloves, pitched and pushed by how fast it is
        // actually coming in — hauling on a rope that is barely moving should
        // not sound like hauling one that is flying.
        //
        // Emitted every ninth tick, so this fires nearly seven times a second
        // for as long as somebody holds the button. That is the whole design
        // constraint: quiet, short, and with no reverb send — a tail on a
        // sound this frequent turns a long rescue into a wash of noise.
        const speed = Math.min(1, Math.abs(event.b) / REEL_MAX_SPEED);
        e.noise({ freq: 700 + speed * 1700, to: 420 + speed * 800, q: 3.4, dur: 0.08, gain: (0.028 + speed * 0.05) * g, bus });
        return;
      }
      case EV_GRIP_FAIL: {
        // The hands going. Deliberately the mirror of EV_GRIP: that one bites
        // upward and stops, this one lets go and falls away, so a pair can
        // tell "I let go" from "I could not hold it" without looking.
        e.noise({ freq: 1500, to: 220, q: 1.5, dur: 0.3, gain: 0.11 * g, bus });
        e.tone({ freq: 330, to: 110, dur: 0.26, type: 'sawtooth', gain: 0.09 * g, send: 0.2, bus });
        return;
      }
      case EV_SHUTTER_OPEN: {
        // A motor taking the weight, and the door going up.
        //
        // The two door sounds are the only cues in the game that routinely
        // play with nothing to look at: a hauler standing on a plate can be
        // most of a rope away from the shutter it moves, and what they need to
        // know is not that something happened but which way it went. So the
        // pair are built as opposites — this one climbs and settles, the other
        // falls and lands — rather than as one sound with a filter on it.
        e.tone({ freq: 66, to: 128, dur: 0.32, type: 'sawtooth', gain: 0.08 * g, bus });
        e.noise({ freq: 420, to: 1600, q: 1.6, dur: 0.3, gain: 0.08 * g, bus });
        e.tone({ freq: 700, to: 1050, dur: 0.09, type: 'square', gain: 0.05 * g, at: e.now + 0.27, bus });
        return;
      }
      case EV_SHUTTER_SHUT: {
        // The same motor running down, and then the leading edge hitting the
        // floor. The weight is in the landing rather than in the run, because
        // the news is that a room somebody was walking through is a wall again.
        e.tone({ freq: 128, to: 62, dur: 0.2, type: 'sawtooth', gain: 0.08 * g, bus });
        e.noise({ freq: 1500, to: 300, q: 1.6, dur: 0.2, gain: 0.07 * g, bus });
        e.noise({ freq: 220, to: 70, q: 0.9, dur: 0.18, type: 'lowpass', gain: 0.18 * g, at: e.now + 0.19, bus });
        e.tone({ freq: 96, to: 44, dur: 0.22, type: 'sine', gain: 0.16 * g, at: e.now + 0.19, send: 0.25, bus });
        return;
      }
      case EV_ROPE_YANK: {
        const force = Math.min(1, Math.abs(event.a) / 900);
        // The signature sound of the game: a rope going bar-tight.
        e.tone({ freq: 90 + force * 70, to: 44, dur: 0.26, type: 'sawtooth', gain: (0.1 + force * 0.16) * g, send: 0.3, bus });
        e.noise({ freq: 2600, to: 380, q: 0.8, dur: 0.18, gain: (0.07 + force * 0.12) * g, bus });
        e.tone({ freq: 620 + force * 300, to: 240, dur: 0.14, type: 'triangle', gain: 0.07 * force * g, bus });
        return;
      }
      case EV_BOUNCE:
        e.tone({ freq: 220, to: 900, dur: 0.2, type: 'sine', gain: 0.2 * g, send: 0.2, bus });
        e.tone({ freq: 440, to: 1500, dur: 0.14, type: 'triangle', gain: 0.08 * g, bus });
        return;
      case EV_CARGO_HIT: {
        const force = Math.min(1, event.a / 30);
        e.noise({ freq: 420, to: 140, q: 1.6, dur: 0.12, gain: (0.08 + force * 0.16) * g, bus });
        e.tone({ freq: 190 - force * 60, to: 90, dur: 0.1, type: 'square', gain: 0.09 * g, bus });
        return;
      }
      case EV_CARGO_LAND:
        e.noise({ freq: 360, to: 120, q: 1.2, dur: 0.1, gain: 0.09 * g, bus });
        return;
      case EV_CARGO_BREAK:
        e.noise({ freq: 2600, to: 220, q: 0.6, dur: 0.5, gain: 0.3 * g, send: 0.4, bus });
        e.tone({ freq: 160, to: 42, dur: 0.5, type: 'sawtooth', gain: 0.2 * g, bus });
        for (let i = 0; i < 5; i++) {
          e.noise({ at: e.now + 0.04 * i + Math.random() * 0.05, freq: 1200 + Math.random() * 1800, q: 3, dur: 0.07, gain: 0.09 * g, bus });
        }
        return;
      case EV_DEATH:
        e.tone({ freq: 520, to: 70, dur: 0.44, type: 'sawtooth', gain: 0.16 * g, send: 0.3, bus });
        e.noise({ freq: 900, to: 120, dur: 0.34, q: 0.8, gain: 0.11 * g, bus });
        return;
      case EV_RESPAWN:
        e.tone({ freq: 260, to: 660, dur: 0.2, type: 'triangle', gain: 0.13 * g, bus });
        e.tone({ freq: 390, to: 990, dur: 0.22, type: 'sine', gain: 0.08 * g, at: e.now + 0.05, bus });
        return;
      case EV_CHECKPOINT: {
        // A rising major arpeggio: the only unambiguously good news in the game.
        const root = 523.25;
        [0, 4, 7, 12].forEach((semi, i) => {
          e.tone({
            freq: root * Math.pow(2, semi / 12),
            dur: 0.5,
            type: 'triangle',
            gain: 0.14 * g,
            at: e.now + i * 0.07,
            send: 0.45,
            bus,
          });
        });
        return;
      }
      case EV_CRUMBLE:
        e.noise({ freq: 1500, to: 300, q: 1.4, dur: 0.22, gain: 0.11 * g, bus });
        return;
      case EV_RESTART:
        e.tone({ freq: 300, to: 150, dur: 0.3, type: 'square', gain: 0.1 * g, bus });
        return;
      case EV_EMOTE: {
        const base = [420, 300, 540, 240][event.b % 4] ?? 400;
        e.tone({ freq: base, to: base * 1.6, dur: 0.09, type: 'square', gain: 0.09 * g, bus });
        e.tone({ freq: base * 1.5, to: base * 0.9, dur: 0.1, type: 'square', gain: 0.07 * g, at: e.now + 0.08, bus });
        return;
      }
      case EV_FINISH:
        this.fanfare();
        return;
      default:
        return;
    }
  }

  fanfare(): void {
    const e = this.engine;
    if (!e.ready) return;
    const root = 261.63;
    const melody = [0, 4, 7, 12, 7, 12, 16, 19];
    melody.forEach((semi, i) => {
      e.tone({
        freq: root * Math.pow(2, semi / 12),
        dur: 0.34,
        type: 'square',
        gain: 0.16,
        at: e.now + i * 0.11,
        send: 0.4,
      });
      e.tone({
        freq: root * 0.5 * Math.pow(2, semi / 12),
        dur: 0.3,
        type: 'triangle',
        gain: 0.1,
        at: e.now + i * 0.11,
      });
    });
  }

  ui(kind: 'move' | 'confirm' | 'back' | 'error'): void {
    const e = this.engine;
    if (!e.ready) return;
    switch (kind) {
      case 'move':
        e.tone({ freq: 700, dur: 0.04, type: 'square', gain: 0.05 });
        return;
      case 'confirm':
        e.tone({ freq: 520, to: 880, dur: 0.09, type: 'square', gain: 0.09 });
        return;
      case 'back':
        e.tone({ freq: 460, to: 260, dur: 0.09, type: 'square', gain: 0.08 });
        return;
      case 'error':
        e.tone({ freq: 200, to: 130, dur: 0.18, type: 'sawtooth', gain: 0.11 });
        return;
    }
  }
}
