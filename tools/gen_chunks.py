"""Authoring tool for HAULMATES chunks.

Chunks are painted on a 40-wide grid with permanent side walls, then emitted as
TypeScript. Painting beats counting dots by hand: a miscounted row is a broken
level, and this script asserts the invariants the game relies on.
"""
import io, os, sys

W = 40
GAP0, GAP1 = 16, 23  # the middle band that must stay open at chunk seams

class C:
    def __init__(self, cid, biome, diff, h, tags=None, walls=True):
        self.id, self.biome, self.diff, self.tags = cid, biome, diff, tags or []
        self.h = h
        self.rows = []
        for _ in range(h):
            r = ['.'] * W
            if walls:
                r[0] = r[1] = '#'
                r[W-2] = r[W-1] = '#'
            self.rows.append(r)
        self.ents = []

    def put(self, r, c, s):
        for k, ch in enumerate(s):
            assert 0 <= c + k < W, f'{self.id}: column overflow at row {r}'
            self.rows[r][c + k] = ch
        return self

    def fill(self, r0, r1, c0, c1, ch):
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                self.rows[r][c] = ch
        return self

    def col(self, c, r0, r1, ch):
        return self.fill(r0, r1, c, c, ch)

    def saw(self, x, y, r=1, ax=0, ay=0, period=200, phase=0):
        self.ents.append(dict(type='saw', x=x, y=y, r=r, ax=ax, ay=ay, period=period, phase=phase))
        return self

    def mover(self, x, y, w=4, h=1, ax=0, ay=0, period=220, phase=0, deadly=False, smooth=1):
        self.ents.append(dict(type='crusher' if deadly else 'mover', x=x, y=y, w=w, h=h,
                              ax=ax, ay=ay, period=period, phase=phase, smooth=smooth))
        return self

    def check(self, is_start=False, is_goal=False):
        """Chunks must stack in any order, so every seam is a guaranteed
        full-width open band: three clear rows at the top of each chunk meeting
        three at the bottom of the one above it. Only non-solid markers may
        appear there."""
        for i, r in enumerate(self.rows):
            assert len(r) == W, f'{self.id}: row {i} is {len(r)} wide'
        def band(rows, what):
            for r in rows:
                for c in range(2, W - 2):
                    assert self.rows[r][c] in '.!:', (
                        f'{self.id}: {what} seam blocked at r{r} c{c} '
                        f'({self.rows[r][c]})')
        if not is_goal:
            band((0, 1, 2), 'top')
        if not is_start:
            band((self.h - 3, self.h - 2, self.h - 1), 'bottom')
        for e in self.ents:
            assert 0 <= e['y'] < self.h, f"{self.id}: entity y={e['y']} out of range"
        return self

    def emit(self):
        rows = ',\n      '.join("'" + ''.join(r) + "'" for r in self.rows)
        ents = ''
        if self.ents:
            parts = []
            for e in self.ents:
                fields = ', '.join(f"{k}: {repr(v) if not isinstance(v, str) else chr(39)+v+chr(39)}" for k, v in e.items())
                parts.append('{ ' + fields + ' }')
            ents = '    entities: [\n      ' + ',\n      '.join(parts) + ',\n    ],\n'
        tags = f"    tags: [{', '.join(chr(39)+t+chr(39) for t in self.tags)}],\n" if self.tags else ''
        return (f"  {{\n    id: '{self.id}',\n    biome: {self.biome},\n    difficulty: {self.diff},\n"
                f"{tags}    rows: [\n      {rows},\n    ],\n{ents}  }}")

chunks = []

# ===================================================== BIOME 0 — THE YARD ====
# A scaffolded builder's yard. Wide ledges, generous gaps, nothing that kills
# you for a mistimed jump. This is where you learn that the rope has opinions.
c = C('yard_start', 0, 0, 32, tags=['start'])
c.put(2, 19, '!')
c.put(5, 9, '####').put(5, 25, '####')
c.put(8, 5, '#####').put(8, 29, '#####')
c.put(10, 16, '========')
c.put(13, 8, '####').put(13, 28, '####')
c.put(16, 12, '#####').put(16, 23, '#####')
c.put(19, 4, '######').put(19, 30, '######')
c.put(21, 15, '======')
c.put(24, 8, '#####').put(24, 27, '#####')
c.put(27, 13, '=====').put(27, 22, '=====')
c.put(28, 19, 'S')
c.fill(30, 31, 2, 37, '#')
chunks.append(c.check(is_start=True))

c = C('yard_ladders', 0, 0, 30)
c.put(2, 19, '!')
c.col(2, 4, 25, '*').col(37, 4, 25, '*')
c.put(5, 6, '#####').put(5, 29, '#####')
c.put(8, 14, '=========')
c.put(11, 5, '######').put(11, 29, '######')
c.put(14, 16, '#######')
c.put(17, 6, '#####').put(17, 29, '#####')
c.put(20, 13, '=====').put(20, 22, '=====')
c.put(23, 4, '#######').put(23, 29, '#######')
c.put(26, 9, '#####').put(26, 26, '#####')
chunks.append(c.check())

c = C('yard_swing', 0, 1, 30)
c.put(2, 19, '!')
c.col(2, 5, 24, '*').col(37, 5, 24, '*')
c.put(5, 4, '######').put(5, 30, '######')
c.put(10, 3, '#####').put(10, 32, '#####')
c.put(9, 6, '^^').put(9, 33, '^^')
c.put(16, 3, '######').put(16, 31, '######')
c.put(22, 3, '#####').put(22, 32, '#####')
c.put(26, 3, '########').put(26, 29, '########')
c.put(25, 9, '^^').put(25, 30, '^^')
chunks.append(c.check())

c = C('yard_crates', 0, 0, 30)
c.put(2, 19, '!')
c.put(5, 8, 'xxxx').put(5, 28, 'xxxx')
c.put(8, 14, 'xxxxxx')
c.put(11, 5, '#####').put(11, 30, '#####')
c.put(10, 7, '^^').put(10, 32, '^^')
c.put(14, 16, 'xxxxxxx')
c.put(17, 6, '####').put(17, 30, '####')
c.put(20, 11, 'xxxx').put(20, 25, 'xxxx')
c.put(23, 4, '######').put(23, 30, '######')
c.put(22, 6, '^^').put(22, 32, '^^')
c.put(26, 12, '#####').put(26, 23, '#####')
chunks.append(c.check())

c = C('yard_bounce', 0, 1, 30)
c.put(2, 19, '!')
c.put(6, 3, '####').put(6, 33, '####')
c.put(5, 14, 'vvvvvvvv')
c.put(11, 8, '#####').put(11, 27, '#####')
c.put(10, 10, 'oo').put(10, 29, 'oo')
c.put(16, 16, '########')
c.put(15, 18, 'oooo')
c.put(21, 4, '#####').put(21, 31, '#####')
c.put(20, 6, 'oo').put(20, 33, 'oo')
c.put(26, 2, '#########').put(26, 29, '#########')
chunks.append(c.check())

c = C('yard_saw', 0, 1, 30)
c.put(2, 19, '!')
c.put(6, 2, '#########').put(6, 29, '#########')
c.saw(x=14, y=9, r=1, ax=12, ay=0, period=190)
c.put(12, 12, '#############')
c.put(17, 3, '######').put(17, 31, '######')
c.saw(x=8, y=20, r=1, ax=0, ay=5, period=150, phase=40)
c.saw(x=31, y=20, r=1, ax=0, ay=5, period=150, phase=110)
c.put(22, 14, '#########')
c.put(26, 2, '########').put(26, 30, '########')
c.put(25, 4, '^^').put(25, 34, '^^')
chunks.append(c.check())

# ================================================== BIOME 1 — THE FOUNDRY ====
# Heat, moving metal and things that push you toward the heat.
c = C('foundry_lava', 1, 1, 30)
c.put(2, 19, '!')
c.put(6, 5, '######').put(6, 29, '######')
c.put(10, 13, '##########')
c.put(14, 3, '######').put(14, 31, '######')
c.put(18, 15, '########')
c.put(22, 4, '########').put(22, 28, '########')
c.put(26, 2, '#############').put(26, 27, '###########')
c.put(25, 5, '~~~~~~~~').put(25, 29, '~~~~~~~')
chunks.append(c.check())

c = C('foundry_conveyor', 1, 2, 30)
c.put(2, 19, '!')
c.put(6, 4, 'cccccccc').put(6, 28, 'CCCCCCCC')
c.put(5, 10, '^').put(5, 29, '^')
c.put(11, 14, 'CCCCCCCCCC')
c.put(15, 3, 'cccccccc').put(15, 29, 'CCCCCCCC')
c.put(20, 12, 'cccccccccccc')
c.put(24, 4, '######').put(24, 30, '######')
c.put(26, 2, '###########').put(26, 29, '#########')
c.put(25, 5, '~~~~~~').put(25, 31, '~~~~~')
chunks.append(c.check())

c = C('foundry_press', 1, 2, 32)
c.put(2, 19, '!')
c.put(7, 2, '##########').put(7, 28, '##########')
c.mover(x=13, y=5, w=6, h=3, ax=0, ay=6, period=170, deadly=True)
c.put(13, 14, '############')
c.mover(x=4, y=16, w=5, h=3, ax=0, ay=5, period=200, phase=60, deadly=True)
c.mover(x=31, y=16, w=5, h=3, ax=0, ay=5, period=200, phase=140, deadly=True)
c.put(21, 2, '########').put(21, 30, '########')
c.put(25, 13, '##########')
c.put(28, 3, '######').put(28, 31, '######')
c.put(27, 4, '~~~~').put(27, 33, '~~~')
chunks.append(c.check())

c = C('foundry_saws', 1, 2, 30)
c.put(2, 19, '!')
c.put(6, 2, '#######').put(6, 31, '#######')
c.saw(x=12, y=8, r=1, ax=0, ay=8, period=160)
c.saw(x=27, y=8, r=1, ax=0, ay=8, period=160, phase=80)
c.put(12, 14, '##########')
c.put(17, 4, '######').put(17, 30, '######')
c.saw(x=20, y=20, r=1, ax=14, ay=0, period=230, phase=30)
c.put(22, 2, '######').put(22, 32, '######')
c.put(26, 12, '#############')
c.put(25, 14, '^^').put(25, 30, '^^')
chunks.append(c.check())

c = C('foundry_moving', 1, 2, 32)
c.put(2, 19, '!')
c.put(7, 3, '######').put(7, 31, '######')
c.mover(x=10, y=11, w=5, h=1, ax=16, ay=0, period=240)
c.mover(x=25, y=16, w=5, h=1, ax=-16, ay=0, period=240, phase=120)
c.put(21, 2, '#####').put(21, 33, '#####')
c.mover(x=15, y=24, w=6, h=1, ax=0, ay=-7, period=200)
c.put(28, 2, '###########').put(28, 28, '##########')
c.put(27, 5, '~~~~~~').put(27, 30, '~~~~~')
chunks.append(c.check())

# ================================================== BIOME 2 — THE FREEZER ====
# No friction, no mercy, and a wind that has opinions about where you land.
c = C('freeze_ice', 2, 2, 30)
c.put(2, 19, '!')
c.put(6, 3, 'iiiiiiii').put(6, 29, 'iiiiiiii')
c.put(11, 13, 'iiiiiiiiii')
c.put(10, 14, '^').put(10, 21, '^')
c.put(16, 2, 'iiiiiiiii').put(16, 29, 'iiiiiiiii')
c.put(21, 12, 'iiiiiiiiiiii')
c.put(26, 2, 'iiiiiii').put(26, 31, 'iiiiiii')
c.put(25, 4, '^^').put(25, 34, '^^')
chunks.append(c.check())

c = C('freeze_wind', 2, 2, 32)
c.put(2, 19, '!')
c.col(6, 5, 28, 'W').col(33, 5, 28, 'W')
c.put(5, 12, 'vvvvvvvv').put(5, 24, 'vvvv')
c.put(9, 2, '####').put(9, 34, '####')
c.put(13, 14, '#########')
c.put(12, 16, 'vvv')
c.put(18, 2, '#####').put(18, 33, '#####')
c.put(23, 13, '##########')
c.put(28, 2, '########').put(28, 30, '########')
c.put(27, 4, '^^').put(27, 34, '^^')
chunks.append(c.check())

c = C('freeze_crumble', 2, 3, 30)
c.put(2, 19, '!')
c.col(2, 5, 25, '*').col(37, 5, 25, '*')
c.put(5, 8, 'xxxx').put(5, 28, 'xxxx')
c.put(9, 15, 'xxxxxxxx')
c.put(13, 4, 'xxxxx').put(13, 31, 'xxxxx')
c.put(12, 6, '^').put(12, 33, '^')
c.put(17, 13, 'xxxxxx').put(17, 23, 'xxxxxx')
c.put(21, 6, 'xxxx').put(21, 30, 'xxxx')
c.put(26, 12, 'xxxxxxxxxxxx')
c.put(25, 14, '^^^').put(25, 26, '^^^')
chunks.append(c.check())

c = C('freeze_saws', 2, 3, 30)
c.put(2, 19, '!')
c.put(6, 2, 'iiiiiii').put(6, 31, 'iiiiiii')
c.saw(x=10, y=9, r=1, ax=18, ay=0, period=200)
c.put(12, 14, 'iiiiiiiiii')
c.put(17, 3, 'iiiii').put(17, 32, 'iiiii')
c.saw(x=7, y=19, r=1, ax=0, ay=7, period=140, phase=20)
c.saw(x=32, y=19, r=1, ax=0, ay=7, period=140, phase=90)
c.put(22, 15, 'iiiiiiiii')
c.put(26, 2, 'iiiiiiii').put(26, 30, 'iiiiiiii')
c.put(25, 5, '^^').put(25, 33, '^^')
chunks.append(c.check())

c = C('freeze_pit', 2, 3, 32)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.put(5, 3, '#####').put(5, 32, '#####')
c.put(11, 3, '####').put(11, 33, '####')
c.put(10, 5, '^').put(10, 35, '^')
c.put(17, 3, '####').put(17, 33, '####')
c.put(23, 3, '#####').put(23, 32, '#####')
c.put(28, 3, '######').put(28, 31, '######')
c.put(27, 5, '^^').put(27, 33, '^^')
chunks.append(c.check())

# ==================================================== BIOME 3 — THE SPIRE ====
# Everything at once, at the top of the world, with the wind in your teeth.
c = C('spire_gauntlet', 3, 3, 32)
c.put(2, 19, '!')
c.put(6, 2, '######').put(6, 32, '######')
c.saw(x=19, y=9, r=1, ax=0, ay=6, period=130)
c.put(11, 6, 'xxxxxx').put(11, 28, 'xxxxxx')
c.put(15, 14, 'iiiiiiiiii')
c.col(6, 17, 27, 'W').col(33, 17, 27, 'W')
c.put(20, 2, '#####').put(20, 33, '#####')
c.mover(x=14, y=24, w=6, h=1, ax=0, ay=-6, period=170)
c.put(28, 2, '########').put(28, 30, '########')
c.put(27, 4, '^^^').put(27, 33, '^^^')
chunks.append(c.check())

c = C('spire_crushers', 3, 3, 32)
c.put(2, 19, '!')
c.put(7, 2, '#########').put(7, 29, '#########')
c.mover(x=12, y=4, w=5, h=3, ax=0, ay=7, period=140, deadly=True)
c.mover(x=23, y=4, w=5, h=3, ax=0, ay=7, period=140, phase=70, deadly=True)
c.put(14, 13, '##########')
c.saw(x=8, y=19, r=1, ax=0, ay=6, period=120)
c.saw(x=31, y=19, r=1, ax=0, ay=6, period=120, phase=60)
c.put(20, 3, '######').put(20, 31, '######')
c.put(25, 14, '#########')
c.put(28, 2, '###########').put(28, 28, '##########')
c.put(27, 5, '~~~~~').put(27, 30, '~~~~')
chunks.append(c.check())

c = C('spire_final', 3, 3, 32)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.put(6, 4, '####').put(6, 32, '####')
c.saw(x=20, y=10, r=1, ax=13, ay=0, period=150)
c.put(12, 6, 'xxxx').put(12, 30, 'xxxx')
c.put(16, 16, '#######')
c.put(15, 18, 'ooo')
c.put(21, 4, 'iiiii').put(21, 31, 'iiiii')
c.saw(x=19, y=25, r=1, ax=0, ay=4, period=110)
c.put(28, 3, '######').put(28, 31, '######')
c.put(27, 5, '^^').put(27, 33, '^^')
chunks.append(c.check())

c = C('spire_goal', 3, 0, 24, tags=['goal'])
c.fill(0, 1, 2, 37, '#')
c.put(2, 17, 'FFFFFF')
c.put(3, 14, '############')
c.put(6, 19, '!')
c.put(9, 5, '######').put(9, 29, '######')
c.put(13, 15, '########')
c.put(17, 4, '#######').put(17, 29, '#######')
c.put(20, 13, '=====').put(20, 22, '=====')
chunks.append(c.check(is_goal=True))

out = io.StringIO()
out.write("""import type { ChunkDef } from './level.js';

/**
 * Hand-authored chunks, generated by tools/gen_chunks.py.
 *
 * Every chunk is exactly 40 tiles wide with solid side walls, and the top and
 * bottom three rows of every chunk are clear across the full interior. That is
 * what lets any chunk stack on any other and still be climbable — the invariant
 * the endless tower generator depends on, and the one the level test suite
 * re-checks on every build.
 */
export const CHUNKS: ChunkDef[] = [
""")
out.write(',\n'.join(ch.emit() for ch in chunks))
out.write(",\n];\n\nexport const BIOME_NAMES = ['THE YARD', 'THE FOUNDRY', 'THE FREEZER', 'THE SPIRE'];\n")
out.write("""
/** The campaign, in order, bottom to top. */
export const CAMPAIGN_CHUNK_IDS = [
""")
out.write('\n'.join(f"  '{ch.id}'," for ch in chunks))
out.write("\n];\n")

dest = os.path.join(os.path.dirname(os.path.abspath(__file__)), '..')
path = sys.argv[1]
open(path, 'w').write(out.getvalue())
print(f'wrote {len(chunks)} chunks, {sum(ch.h for ch in chunks)} rows -> {path}')
