import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AudioEngine } from '../src/audio/synth.js';
import { Music } from '../src/audio/music.js';

/**
 * Enough of the Web Audio API to build the graph and none of it to hear the
 * result. What is being tested is the wiring — which node reaches the speakers
 * through which gain — and that is a property of the connections, so the fake
 * records those and nothing else.
 */
class FakeParam {
  value = 0;
  setValueAtTime(): void {}
  exponentialRampToValueAtTime(): void {}
  linearRampToValueAtTime(): void {}
}

class FakeNode {
  readonly outputs: FakeNode[] = [];
  gain = new FakeParam();
  delayTime = new FakeParam();
  frequency = new FakeParam();
  detune = new FakeParam();
  Q = new FakeParam();
  threshold = new FakeParam();
  knee = new FakeParam();
  ratio = new FakeParam();
  attack = new FakeParam();
  release = new FakeParam();
  playbackRate = new FakeParam();
  pan = new FakeParam();
  type = '';
  buffer: unknown = null;
  loop = false;

  constructor(readonly kind: string) {}

  connect(node: FakeNode): FakeNode {
    this.outputs.push(node);
    return node;
  }

  disconnect(): void {}
  start(): void {}
  stop(): void {}
}

class FakeContext {
  state = 'running';
  currentTime = 0;
  sampleRate = 48000;
  destination = new FakeNode('destination');
  readonly created: FakeNode[] = [];

  private make(kind: string): FakeNode {
    const node = new FakeNode(kind);
    this.created.push(node);
    return node;
  }

  createGain(): FakeNode {
    return this.make('gain');
  }

  createDelay(): FakeNode {
    return this.make('delay');
  }

  createBiquadFilter(): FakeNode {
    return this.make('filter');
  }

  createDynamicsCompressor(): FakeNode {
    return this.make('limiter');
  }

  createOscillator(): FakeNode {
    return this.make('oscillator');
  }

  createBufferSource(): FakeNode {
    return this.make('source');
  }

  createStereoPanner(): FakeNode {
    return this.make('panner');
  }

  createBuffer(): { getChannelData: () => Float32Array } {
    return { getChannelData: (): Float32Array => new Float32Array(8) };
  }

  resume(): void {}
  suspend(): void {}
}

/** Every route from `from` to the destination, as lists of nodes. */
function pathsToOutput(from: FakeNode, destination: FakeNode, seen: FakeNode[] = []): FakeNode[][] {
  if (from === destination) return [[from]];
  // The reverb feeds itself, so a path may not revisit a node it is already on.
  if (seen.includes(from)) return [];
  const trail = [...seen, from];
  const out: FakeNode[][] = [];
  for (const next of from.outputs) {
    for (const rest of pathsToOutput(next, destination, trail)) out.push([from, ...rest]);
  }
  return out;
}

function sources(ctx: FakeContext, kind: string): FakeNode[] {
  return ctx.created.filter((n) => n.kind === kind);
}

let ctx: FakeContext;

beforeEach(() => {
  ctx = new FakeContext();
  (globalThis as { window?: unknown }).window = { AudioContext: function (): FakeContext { return ctx; } };
});

afterEach(() => {
  delete (globalThis as { window?: unknown }).window;
});

function engine(): AudioEngine {
  const e = new AudioEngine();
  e.unlock();
  return e;
}

describe('the mix', () => {
  /**
   * The reverb return used to be a single send into the master gain, which put
   * the wet half of every voice downstream of nothing but the master fader.
   * Dragging Sound effects to zero silenced the dry impacts and left their
   * tails ringing at full level — and muting is the one control in an options
   * menu that has to be absolutely literal.
   *
   * Stated as a property of the graph rather than as a node count, because the
   * failure was invisible in the node count: the wiring was tidy, it just went
   * to the wrong place.
   */
  for (const send of [0, 0.4]) {
    it(`keeps every sound-effect path behind the SFX fader, send ${send}`, () => {
      const e = engine();
      e.tone({ freq: 440, send });
      e.noise({ freq: 900, send });
      const voices = [...sources(ctx, 'oscillator'), ...sources(ctx, 'source')];
      expect(voices.length, 'the voices should have been built').toBe(2);
      for (const voice of voices) {
        const paths = pathsToOutput(voice, ctx.destination);
        expect(paths.length, 'a voice that reaches nothing is a voice nobody hears').toBeGreaterThan(0);
        for (const path of paths) {
          expect(path, 'a path that bypasses the SFX bus').toContain(e.sfxBus as unknown as FakeNode);
        }
      }
    });
  }

  it('keeps every music path behind the Music fader', () => {
    const e = engine();
    e.tone({ freq: 220, send: 0.5, bus: e.musicBus });
    const voices = sources(ctx, 'oscillator');
    expect(voices.length).toBe(1);
    for (const path of pathsToOutput(voices[0], ctx.destination)) {
      expect(path, 'a path that bypasses the music bus').toContain(e.musicBus as unknown as FakeNode);
      expect(path, 'music leaking into the sound-effects bus').not.toContain(e.sfxBus as unknown as FakeNode);
    }
  });

  /** Panned effects hang off the SFX bus, so their tails have to as well. */
  it('keeps a panned effect and its reverb behind the SFX fader', () => {
    const e = engine();
    e.noise({ freq: 700, send: 0.4, bus: e.panBus(-0.8) });
    const voices = sources(ctx, 'source');
    expect(voices.length).toBe(1);
    const paths = pathsToOutput(voices[0], ctx.destination);
    expect(paths.length).toBeGreaterThan(1);
    for (const path of paths) {
      expect(path).toContain(e.sfxBus as unknown as FakeNode);
    }
  });
});

/**
 * The settings screen says the music is "generated live, never the same twice".
 *
 * It was not. The kit was a fixed grid — kick on 0, 6 and 10, snare on 4 and
 * 12, hat on every odd step, no randomness in any of it — so a hundred bars
 * were a hundred identical drum bars, and a fixed rng seed meant two launches
 * produced the same sequence note for note. This is a loop a player hears for
 * a whole session, which is the worst thing in the game to make bit-identical,
 * and the claim was on a menu they could read while listening to it.
 */
describe('the music', () => {
  /** The drum hits of `bars` consecutive bars, as one string per bar. */
  function drumBars(bars: number): string[] {
    const e = engine();
    const m = new Music(e);
    (globalThis as { window?: { setInterval?: unknown; clearInterval?: unknown } }).window!.setInterval =
      (): number => 0;
    (globalThis as { window?: { clearInterval?: unknown } }).window!.clearInterval = (): void => {};
    m.start(0);
    const inner = m as unknown as { emit(at: number, d: number): void; step: number; bar: number; rollFigure(): void };
    const out: string[] = [];
    for (let bar = 0; bar < bars; bar++) {
      let line = '';
      for (let i = 0; i < 16; i++) {
        const before = ctx.created.length;
        inner.emit(0, 0.1);
        line += String(Math.min(9, ctx.created.length - before));
        inner.step++;
      }
      inner.bar++;
      inner.rollFigure();
      out.push(line);
    }
    return out;
  }

  it('does not play the same bar over and over', () => {
    const bars = drumBars(64);
    const unique = new Set(bars);
    expect(unique.size, `only ${unique.size} distinct bars in 64`).toBeGreaterThan(8);
  });

  it('starts somewhere different every launch', () => {
    const a = drumBars(16).join('|');
    const b = drumBars(16).join('|');
    expect(a).not.toBe(b);
  });
});
