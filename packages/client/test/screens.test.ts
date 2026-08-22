import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { App } from '../src/app.js';
import type { Profile } from '../src/settings.js';

/**
 * A document that keeps the tree instead of rendering it.
 *
 * The menus are the one part of this game that is plain HTML, and the reason
 * they are is that plain HTML is better at focus and at being read aloud than
 * anything painted into the canvas. That leaves them untested: there is no DOM
 * in this runner and the end-to-end pass only ever opens a healthy profile. So
 * `h` gets somewhere to build into, and the screens get asked the question the
 * saves in the wild will ask them — what a profile written by an older build
 * makes them do.
 */
interface FakeElement {
  tag: string;
  className: string;
  style: Record<string, string>;
  attrs: Record<string, string>;
  children: unknown[];
  setAttribute(name: string, value: string): void;
  appendChild(child: unknown): unknown;
  addEventListener(): void;
}

function element(tag: string): FakeElement {
  const el: FakeElement = {
    tag,
    className: '',
    style: {},
    attrs: {},
    children: [],
    setAttribute(name, value) {
      el.attrs[name] = value;
    },
    appendChild(child) {
      el.children.push(child);
      return child;
    },
    addEventListener() {},
  };
  return el;
}

/** Everything the tree would read as, in order. */
function text(node: unknown): string {
  if (node === null || typeof node !== 'object') return '';
  if ('nodeText' in node) return String((node as { nodeText: string }).nodeText);
  return ((node as FakeElement).children ?? []).map(text).join('');
}

/** Every element in the tree carrying a class, for the ones that are a picture. */
function classes(node: unknown): string[] {
  if (node === null || typeof node !== 'object' || !('children' in node)) return [];
  const el = node as FakeElement;
  return [el.className, ...el.children.flatMap(classes)].filter(Boolean);
}

beforeEach(() => {
  (globalThis as { document?: unknown }).document = {
    createElement: (tag: string) => element(tag),
    createTextNode: (nodeText: string) => ({ nodeText }),
    getElementById: () => null,
  };
  (globalThis as { window?: unknown }).window = {
    HAULMATES_SERVER: 'ws://test',
    matchMedia: () => ({ matches: false }),
    location: { protocol: 'https:', host: 'example.test' },
  };
});

afterEach(() => {
  delete (globalThis as { document?: unknown }).document;
  delete (globalThis as { window?: unknown }).window;
});

async function screens(): Promise<typeof import('../src/ui/screens.js')> {
  return import('../src/ui/screens.js');
}

async function profile(over: Partial<Profile> = {}): Promise<Profile> {
  const { DEFAULT_PROFILE } = await import('../src/settings.js');
  return { ...DEFAULT_PROFILE, daily: { ...DEFAULT_PROFILE.daily, history: [] }, crews: [], ...over };
}

const TODAY = 20686;

function fakeApp(p: Profile): App {
  return {
    profile: p,
    today: TODAY,
    version: '1.0.0',
    achievements: { earned: [] },
    sfx: { ui: () => {} },
    net: null,
    local: null,
  } as unknown as App;
}

describe('the title screen', () => {
  it('says nothing about a fortnight nobody has started', async () => {
    const { buildScreen } = await screens();
    const screen = buildScreen(fakeApp(await profile()), 'title');
    expect(classes(screen), 'a chore chart before the first mark').not.toContain('strip');
    expect(text(screen)).not.toContain('Last on the rope');
  });

  it('draws the strip and names your last crew once there is something to say', async () => {
    const { buildScreen } = await screens();
    const p = await profile({
      daily: {
        day: TODAY,
        bestTicks: 11550,
        bestCheckpoints: 12,
        attempts: 2,
        streak: 3,
        history: [{ day: TODAY - 1, ticks: 0, checkpoints: 6, attempts: 1 }],
      },
      crews: [
        { name: 'RUSTY BRICK', runs: 9, finishes: 4, bestTicks: 11550, bestFloors: 0, boosts: 30, crates: 2, lastDay: TODAY },
        { name: 'BIG PIGEON', runs: 2, finishes: 0, bestTicks: 0, bestFloors: 6, boosts: 1, crates: 9, lastDay: TODAY - 9 },
      ],
    });
    const screen = buildScreen(fakeApp(p), 'title');
    const marks = classes(screen).filter((c) => c.startsWith('day '));
    expect(marks, 'one box a day').toHaveLength(14);
    expect(marks[13]).toContain('delivered');
    expect(marks[13], 'tonight is the box being looked for').toContain('today');
    expect(marks[12]).toContain('climbed');
    expect(marks[0]).toContain('missed');
    const said = text(screen);
    expect(said, 'the most recent crew, not the busiest').toContain('Last on the rope with RUSTY BRICK');
    expect(said).toContain('9 hauls');
    expect(said).not.toContain('BIG PIGEON');
  });

  /**
   * Saves already exist in the wild, and the daily record they hold is one day
   * wide with no history in it at all. The title screen is the first thing
   * such a player sees.
   */
  it('builds from a profile written before any of this existed', async () => {
    const { buildScreen } = await screens();
    const { PROFILE_STATS_KEY, loadProfile } = await import('../src/settings.js');
    const stored = {
      runs: 40,
      finishes: 12,
      daily: { day: TODAY - 1, bestTicks: 900, bestCheckpoints: 9, attempts: 3, streak: 5 },
    };
    (globalThis as { window: { haulmates: unknown } }).window.haulmates = {
      readSave: (key: string) => (key === PROFILE_STATS_KEY ? JSON.stringify(stored) : null),
      writeSave: () => {},
    };
    const app = fakeApp(loadProfile());
    expect(() => buildScreen(app, 'title')).not.toThrow();
    expect(() => buildScreen(app, 'records')).not.toThrow();
    const marks = classes(buildScreen(app, 'title')).filter((c) => c.startsWith('day '));
    expect(marks, 'yesterday is all it can honestly draw').toHaveLength(14);
    expect(marks.filter((c) => c.includes('delivered'))).toHaveLength(1);
    expect(marks[13], 'and tonight is still blank').toContain('missed');
  });
});

describe('the ledger', () => {
  it('names the marks and counts them', async () => {
    const { buildScreen } = await screens();
    const p = await profile({
      daily: {
        day: TODAY,
        bestTicks: 0,
        bestCheckpoints: 4,
        attempts: 1,
        streak: 2,
        history: [{ day: TODAY - 1, ticks: 800, checkpoints: 12, attempts: 2 }],
      },
    });
    const said = text(buildScreen(fakeApp(p), 'records'));
    expect(said).toContain('The last fortnight');
    expect(said).toContain('Climbed, not delivered');
    expect(said).toContain('Evenings you weren’t on the rope');
    expect(said, 'no stock glyphs anywhere on it').not.toMatch(/\p{Extended_Pictographic}/u);
  });
});
