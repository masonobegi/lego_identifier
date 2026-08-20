import type { AudioEngine } from './synth.js';

/**
 * Generative soundtrack.
 *
 * Each biome owns a tempo, a scale and a chord loop; the sequencer walks a
 * 16-step grid and improvises a bassline, an arpeggio and percussion from
 * them. It never repeats exactly, costs nothing to ship, and can cross-fade
 * between biomes as the players climb.
 */

interface Biome {
  name: string;
  bpm: number;
  root: number;
  scale: number[];
  chords: number[][];
  bassType: OscillatorType;
  leadType: OscillatorType;
  brightness: number;
  drive: number;
}

const BIOMES: Biome[] = [
  {
    name: 'THE YARD',
    bpm: 102,
    root: 110,
    scale: [0, 3, 5, 7, 10],
    chords: [[0, 3, 7], [-2, 3, 5], [5, 8, 12], [3, 7, 10]],
    bassType: 'square',
    leadType: 'triangle',
    brightness: 1,
    drive: 0.55,
  },
  {
    name: 'THE FOUNDRY',
    bpm: 122,
    root: 98,
    scale: [0, 1, 5, 7, 8],
    chords: [[0, 5, 8], [1, 5, 8], [0, 3, 7], [-4, 1, 5]],
    bassType: 'sawtooth',
    leadType: 'square',
    brightness: 1.25,
    drive: 0.85,
  },
  {
    name: 'THE FREEZER',
    bpm: 94,
    root: 130.81,
    scale: [0, 2, 3, 7, 8],
    chords: [[0, 3, 7], [-4, 0, 3], [2, 5, 9], [3, 7, 10]],
    bassType: 'triangle',
    leadType: 'sine',
    brightness: 1.6,
    drive: 0.35,
  },
  {
    name: 'THE SPIRE',
    bpm: 138,
    root: 82.41,
    scale: [0, 2, 3, 5, 7, 10],
    chords: [[0, 3, 7], [5, 8, 12], [3, 7, 10], [-2, 2, 5]],
    bassType: 'sawtooth',
    leadType: 'square',
    brightness: 1.4,
    drive: 1,
  },
];

const LOOKAHEAD_MS = 60;
const SCHEDULE_AHEAD = 0.28;

export class Music {
  private step = 0;
  private nextNoteAt = 0;
  private timer = 0;
  private biome = 0;
  private targetBiome = 0;
  private intensity = 0.6;
  private running = false;
  private bar = 0;
  private rngState = 0x2f6e2b1;

  constructor(private engine: AudioEngine) {}

  get biomeName(): string {
    return BIOMES[this.biome]?.name ?? '';
  }

  start(biome = 0): void {
    if (this.running) {
      this.setBiome(biome);
      return;
    }
    this.engine.unlock();
    if (!this.engine.ctx) return;
    this.running = true;
    this.biome = biome;
    this.targetBiome = biome;
    this.step = 0;
    this.bar = 0;
    this.nextNoteAt = this.engine.now + 0.1;
    this.timer = window.setInterval(() => this.pump(), LOOKAHEAD_MS);
  }

  stop(): void {
    this.running = false;
    window.clearInterval(this.timer);
    this.timer = 0;
  }

  /** Biome changes take effect on the next bar so the loop never stumbles. */
  setBiome(biome: number): void {
    this.targetBiome = Math.max(0, Math.min(BIOMES.length - 1, biome));
  }

  /** 0 = wandering the lobby, 1 = everything is on fire. */
  setIntensity(value: number): void {
    this.intensity = Math.max(0, Math.min(1, value));
  }

  private rng(): number {
    let x = this.rngState;
    x ^= x << 13;
    x |= 0;
    x ^= x >>> 17;
    x ^= x << 5;
    x |= 0;
    this.rngState = x;
    return (x >>> 0) / 4294967296;
  }

  private pump(): void {
    const e = this.engine;
    if (!this.running || !e.ctx || !e.musicBus) return;
    const now = e.now;
    const b = BIOMES[this.biome];
    const stepDur = 60 / b.bpm / 4;

    while (this.nextNoteAt < now + SCHEDULE_AHEAD) {
      this.emit(this.nextNoteAt, stepDur);
      this.nextNoteAt += stepDur;
      this.step++;
      if (this.step % 16 === 0) {
        this.bar++;
        if (this.targetBiome !== this.biome) this.biome = this.targetBiome;
      }
    }
  }

  private emit(at: number, stepDur: number): void {
    const e = this.engine;
    const bus = e.musicBus;
    if (!bus) return;
    const b = BIOMES[this.biome];
    const step = this.step % 16;
    const chord = b.chords[Math.floor(this.step / 16) % b.chords.length];
    const level = 0.35 + this.intensity * 0.65;

    /* kick */
    if (step === 0 || step === 6 || (step === 10 && this.intensity > 0.5)) {
      e.tone({ freq: 150, to: 42, dur: 0.16, type: 'sine', gain: 0.4 * b.drive * level, at, bus });
      e.noise({ freq: 200, to: 60, dur: 0.05, q: 0.7, gain: 0.12 * level, at, bus, type: 'lowpass' });
    }

    /* snare / clap */
    if (step === 4 || step === 12) {
      e.noise({ freq: 1900, to: 900, q: 0.8, dur: 0.13, gain: 0.16 * level, at, bus });
    }

    /* hats */
    if (step % 2 === 1 && (this.intensity > 0.25 || step % 4 === 3)) {
      e.noise({
        freq: 8000 * b.brightness,
        q: 2.5,
        dur: 0.035,
        gain: (step % 4 === 3 ? 0.075 : 0.045) * level,
        at,
        bus,
      });
    }

    /* bass */
    if (step % 4 === 0 || (step === 7 && this.rng() < 0.55)) {
      const semi = chord[0] + (step === 7 ? 12 : 0);
      e.tone({
        freq: b.root * Math.pow(2, semi / 12),
        dur: stepDur * (step % 8 === 0 ? 3.4 : 1.7),
        type: b.bassType,
        gain: 0.2 * b.drive * level,
        at,
        bus,
      });
    }

    /* arpeggio */
    if (this.intensity > 0.15 && step % 2 === 0) {
      const note = chord[(this.step >> 1) % chord.length] + (this.rng() < 0.2 ? 12 : 0);
      e.tone({
        freq: b.root * 4 * Math.pow(2, note / 12),
        dur: stepDur * 1.6,
        type: b.leadType,
        gain: 0.075 * level,
        at,
        bus,
        send: 0.3,
      });
    }

    /* a sparse counter-melody so long climbs do not feel looped */
    if (this.intensity > 0.55 && step === 14 && this.rng() < 0.4) {
      const degree = b.scale[Math.floor(this.rng() * b.scale.length)];
      e.tone({
        freq: b.root * 8 * Math.pow(2, degree / 12),
        dur: stepDur * 2,
        type: b.leadType,
        gain: 0.06 * level,
        at,
        bus,
        send: 0.5,
      });
    }
  }
}

export const BIOME_MUSIC_NAMES = BIOMES.map((b) => b.name);
