"""Authoring tool for HAULMATES chunks.

Chunks are painted on a 40-wide grid and emitted as TypeScript. Painting beats
counting dots by hand: a miscounted row is a broken level.

The important thing this file enforces is that **every chunk is climbable, and
every pair of chunks is climbable across the seam between them**. That is not
something you can eyeball. The rules, all calibrated against the simulation:

  * Footholds sit 3 rows apart. Anything closer leaves less vertical clearance
    than the player is tall, and they clip the platform they are jumping to.
  * Consecutive footholds are never vertically aligned. To climb onto a
    platform you have to be standing clear of it first, so the lower foothold
    must extend past the upper one's edge — within two columns of it, one less
    than a 3 row jump actually crosses (scripts/calibrate-jump.mjs).
  * Nothing on the route is a bounce pad or a crumbling crate: one throws you
    off, the other is gone a third of a second after you touch it.
  * Decoration is painted through `deco()`, which refuses to write into a
    foothold or the headroom above it. Hazards are placed by eye; the route is
    placed by rule, and the rule wins.
  * Every chunk has a landing platform at local row 1 and another at row h-2,
    horizontally offset from each other. Stacked, those two sit exactly 3 rows
    apart with clear rows between, so any chunk can follow any other.
  * `climb()` lays that path automatically as a serpentine up the shaft;
    chunks then restyle individual platforms and hang hazards around them.

`scripts/verify-levels.mjs` re-derives all of this from the built level data,
finds a route from the spawn to the goal, and then replays every step of it in
the real simulation. It fails the build if any tower stops being climbable.
"""
import io, os, sys

W = 40
# The two shared landings are deliberately *offset* from each other. Stacked,
# a chunk's top landing and the next chunk's bottom landing must not sit
# directly above one another: a player cannot rise through a platform, so they
# need somewhere to stand that is clear of the one they are climbing onto.
TOP_C0, TOP_C1 = 10, 21
BOT_C0, BOT_C1 = 18, 29
LO, HI = 5, 30              # leftmost / rightmost platform start column
# Footholds are three rows apart, not two. A player is 32px tall and a tile is
# 24px, so a two row step leaves a single tile of clearance — less than the
# player — and they clip the underside of the platform they are trying to
# reach. Three rows leaves two tiles, which fits.
V_STEP = 3
# How far to the side of a platform a player may stand and still jump on to it.
# The measurement says three columns; authoring uses two, so the route always
# has a column of slack and never needs a frame-perfect launch.
LAUNCH_REACH = 2


def reachable(lower, upper):
    """Can a player standing on `lower` jump onto `upper` three rows above?

    Only if some column of the lower foothold is clear of the upper one and
    within LAUNCH_REACH of its edge — you cannot rise through a platform, so
    standing directly underneath it is useless."""
    _, a0, a1 = lower
    _, b0, b1 = upper
    return any((b0 - LAUNCH_REACH <= x <= b0 - 1) or (b1 + 1 <= x <= b1 + LAUNCH_REACH)
               for x in range(a0, a1 + 1))


class C:
    def __init__(self, cid, biome, diff, h, tags=None, walls=True):
        assert (h - 9) % V_STEP == 0, (
            f'{cid}: height {h} does not land the climb path on the top seam '
            f'(needs h - 9 divisible by {V_STEP})')
        self.id, self.biome, self.diff, self.tags = cid, biome, diff, tags or []
        self.h = h
        self.rows = []
        for _ in range(h):
            r = ['.'] * W
            if walls:
                r[0] = r[1] = '#'
                r[W - 2] = r[W - 1] = '#'
            self.rows.append(r)
        self.ents = []
        self.path = []          # [(row, c0, c1)] bottom-to-top, the guaranteed route
        self.protected = set()  # cells decoration must never touch

    # ------------------------------------------------------------- painting
    def put(self, r, c, s):
        for k, ch in enumerate(s):
            assert 0 <= c + k < W, f'{self.id}: column overflow at row {r}'
            self.rows[r][c + k] = ch
        return self

    def deco(self, r, c, s):
        """Paint decoration without ever writing over the climbing route.

        Hazards are positioned by eye; the route is positioned by rule. If the
        two ever overlap, the rule wins — otherwise a stray spike silently
        turns a foothold lethal."""
        for k, ch in enumerate(s):
            x = c + k
            if 0 <= x < W and self.rows[r][x] == '.' and (r, x) not in self.protected:
                self.rows[r][x] = ch
        return self

    def _protect(self, r, c0, c1):
        """Reserve a foothold and the space a player stands in above it.

        Without this, a decorative row of ceiling spikes lands in the headroom
        over a platform and quietly turns the only route through the chunk into
        a death trap — which is exactly what happened the first time."""
        for x in range(max(2, c0 - 1), min(W - 2, c1 + 2)):
            for y in (r, r - 1, r - 2):
                if 0 <= y < self.h:
                    self.protected.add((y, x))

    def fill(self, r0, r1, c0, c1, ch):
        for r in range(r0, r1 + 1):
            for c in range(c0, c1 + 1):
                self.rows[r][c] = ch
        return self

    def col(self, c, r0, r1, ch):
        for r in range(r0, r1 + 1):
            self.deco(r, c, ch)
        return self

    def saw(self, x, y, r=1, ax=0, ay=0, period=200, phase=0):
        self.ents.append(dict(type='saw', x=x, y=y, r=r, ax=ax, ay=ay, period=period, phase=phase))
        return self

    def mover(self, x, y, w=4, h=1, ax=0, ay=0, period=220, phase=0, deadly=False, smooth=1):
        self.ents.append(dict(type='crusher' if deadly else 'mover', x=x, y=y, w=w, h=h,
                              ax=ax, ay=ay, period=period, phase=phase, smooth=smooth))
        return self

    # ------------------------------------------------------------ the climb
    def climb(self, width=6, step=7, direction=1, tile='#'):
        """Lay the guaranteed route: the two seam landings plus a serpentine.

        Built top-down from a platform that can reach the top landing, then
        stepping down by a little more than one platform width so each foothold
        sticks out past the one above it. The bottom-most is solved against the
        bottom landing rather than assumed.

        There used to be a `start=` argument here, and every chunk passed a
        different value. It was never read: the anchor column is forced to sit
        beside the top landing, so the serpentine begins in the same place
        every time and only `direction` distinguishes one chunk's route from
        another's. Rewriting all twenty-one call sites to the same number
        regenerated a byte-identical chunks.ts, which is how it was found.
        Removed rather than honoured, because an argument that does nothing
        reads as variety that is not there. Real variety has to come from
        `width`, `step` and `direction`, which do work — see the tower-variety
        task."""
        self.put(1, TOP_C0, tile * (TOP_C1 - TOP_C0 + 1))
        self._protect(1, TOP_C0, TOP_C1)
        self.put(self.h - 2, BOT_C0, tile * (BOT_C1 - BOT_C0 + 1))
        self._protect(self.h - 2, BOT_C0, BOT_C1)
        top_landing = (1, TOP_C0, TOP_C1)
        bottom_landing = (self.h - 2, BOT_C0, BOT_C1)

        rows = list(range(4, self.h - 4, V_STEP))    # ascending = top to bottom
        assert rows[-1] == self.h - 5, f'{self.id}: climb rows do not reach the bottom landing'

        # The usable start columns depend on the platform width: a wide one
        # placed at HI would run straight through the right-hand wall.
        lo = max(LO, 2)
        hi = min(HI, W - 3 - (width - 1))
        assert lo <= hi, f'{self.id}: width {width} leaves no room between the walls'

        # Anchor: a platform beside the top landing, on the requested side.
        first = TOP_C1 + 1 if direction > 0 else TOP_C0 - width
        first = max(lo, min(hi, first))
        assert reachable((rows[0], first, first + width - 1), top_landing), (
            f'{self.id}: anchor platform cannot reach the top landing')

        cols = [first]
        d = -direction
        for _ in rows[1:]:
            c = cols[-1] + d * step
            if c > hi or c < lo:
                d = -d
                c = max(lo, min(hi, cols[-1] + d * step))
            cols.append(c)

        # Solve the bottom-most against the fixed bottom landing.
        wanted = cols[-1]
        above = (rows[-2], cols[-2], cols[-2] + width - 1) if len(cols) > 1 else top_landing
        best = None
        for c in range(lo, hi + 1):
            here = (rows[-1], c, c + width - 1)
            if not reachable(here, above):
                continue
            if not reachable(bottom_landing, here):
                continue
            if best is None or abs(c - wanted) < abs(best - wanted):
                best = c
        assert best is not None, f'{self.id}: no valid bottom platform column'
        cols[-1] = best

        placed = [(r, c, c + width - 1) for r, c in zip(rows, cols)]
        for r, c0, c1 in placed:
            self.put(r, c0, tile * (c1 - c0 + 1))
            self._protect(r, c0, c1)

        # Stored bottom-to-top, the order the route is climbed in.
        self.path = [bottom_landing] + list(reversed(placed)) + [top_landing]
        return self

    # Tiles a player can actually come to rest on. A bounce pad throws you
    # straight back off, and a crumbling crate is gone a third of a second
    # after you touch it — neither can be the only thing holding the route up.
    # They still appear everywhere, just never as the sole footing.
    FOOTING = set('#=i')

    def restyle(self, indices, ch):
        """Repaint chosen path platforms — ice, crumbling crates, conveyors."""
        assert ch in self.FOOTING, (
            f'{self.id}: {ch!r} cannot be stood on, so it cannot be part of the route')
        for i in indices:
            r, c0, c1 = self.path[i]
            self.put(r, c0, ch * (c1 - c0 + 1))
        return self

    def under(self, index, ch, inset=1):
        """Hang something (usually spikes) beneath a path platform."""
        r, c0, c1 = self.path[index]
        self.put(r + 1, c0 + inset, ch * max(1, (c1 - c0 + 1) - inset * 2))
        return self

    def beside(self, index, ch, side, gap=2, length=2):
        """Put something on the wall side of a path platform, out of the route."""
        r, c0, c1 = self.path[index]
        if side < 0:
            c = max(2, c0 - gap - length)
        else:
            c = min(W - 2 - length, c1 + gap + 1)
        self.put(r, c, ch * length)
        return self

    def wall_spikes(self, row, side, length=3):
        """Spikes mounted on a side wall, pointing into the shaft."""
        if side < 0:
            self.deco(row, 2, '>' * length)
        else:
            self.deco(row, W - 2 - length, '<' * length)
        return self

    def ledge(self, row, c0, width, ch='#', top=None):
        """A decorative shelf away from the route, optionally capped."""
        self.deco(row, c0, ch * width)
        if top:
            self.deco(row - 1, c0, top * width)
        return self

    # ----------------------------------------------------------- validation
    def check(self, is_start=False, is_goal=False):
        for i, r in enumerate(self.rows):
            assert len(r) == W, f'{self.id}: row {i} is {len(r)} wide'

        def clear(rows, what):
            for r in rows:
                for c in range(2, W - 2):
                    assert self.rows[r][c] in '.!:', (
                        f'{self.id}: {what} row {r} col {c} must stay clear (found {self.rows[r][c]})')

        if not is_goal:
            clear((0, 2), 'top seam')
            for c in range(TOP_C0, TOP_C1 + 1):
                assert self.rows[1][c] not in '.!:', f'{self.id}: missing top landing at col {c}'
        if not is_start:
            clear((self.h - 1, self.h - 3), 'bottom seam')
            for c in range(BOT_C0, BOT_C1 + 1):
                assert self.rows[self.h - 2][c] not in '.!:', f'{self.id}: missing bottom landing at col {c}'
            # The seam itself: this chunk's bottom landing has to be climbable
            # from the top landing of whatever chunk ends up underneath it.
            launches = [x for x in range(TOP_C0, TOP_C1 + 1)
                        if (BOT_C0 - LAUNCH_REACH <= x <= BOT_C0 - 1)
                        or (BOT_C1 + 1 <= x <= BOT_C1 + LAUNCH_REACH)]
            assert launches, 'the shared seam landings are vertically aligned and cannot be climbed'

        # Consecutive footholds must be within one jump of each other.
        for (r0, a0, a1), (r1, b0, b1) in zip(self.path, self.path[1:]):
            up = r0 - r1
            assert up == V_STEP, (
                f'{self.id}: {up} row step between footholds at rows {r0} and {r1} '
                f'(every step must be exactly {V_STEP})')
            gap = 0 if (b0 <= a1 and b1 >= a0) else (b0 - a1 - 1 if b0 > a1 else a0 - b1 - 1)
            # There must be somewhere on the lower foothold to stand that is
            # clear of the upper one and within jumping distance of its edge.
            launches = [x for x in range(a0, a1 + 1)
                        if (b0 - LAUNCH_REACH <= x <= b0 - 1) or (b1 + 1 <= x <= b1 + LAUNCH_REACH)]
            assert launches, (
                f'{self.id}: no launch column between rows {r0} [{a0}-{a1}] and '
                f'{r1} [{b0}-{b1}] — the lower platform must stick out past the '
                f'upper one by 1 to {LAUNCH_REACH} columns')
            assert gap <= LAUNCH_REACH - 1, (
                f'{self.id}: {gap} column gap between rows {r0} and {r1}')

        # Every foothold must be made of something you can stand on, and must
        # stay inside the walls.
        for r, c0, c1 in self.path:
            assert 2 <= c0 and c1 <= W - 3, (
                f'{self.id}: foothold at row {r} spans {c0}-{c1}, outside the walls')
            for x in range(c0, c1 + 1):
                assert self.rows[r][x] in self.FOOTING, (
                    f'{self.id}: foothold at row {r} col {x} is {self.rows[r][x]!r}, '
                    f'which cannot be stood on')

        for e in self.ents:
            assert 0 <= e['y'] < self.h, f"{self.id}: entity y={e['y']} out of range"
        return self

    # ------------------------------------------------------------- emitting
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
# A scaffolded builder's yard. Wide ledges, forgiving gaps, and the first
# lessons in what the rope does to you.
c = C('yard_start', 0, 0, 33, tags=['start'])
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.fill(30, 32, 2, 37, '#')
c.put(29, 19, 'S')
chunks.append(c.check(is_start=True))

c = C('yard_ladders', 0, 0, 33)
c.climb(width=9, step=8, direction=-1)
c.put(2, 19, '!')
c.col(2, 5, 27, '*').col(37, 5, 27, '*')
c.restyle([3, 6], '=')
chunks.append(c.check())

c = C('yard_swing', 0, 1, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.col(2, 6, 24, '*').col(37, 6, 24, '*')
c.wall_spikes(11, -1, 2).wall_spikes(17, 1, 2)
chunks.append(c.check())

c = C('yard_crates', 0, 0, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.deco(11, 4, 'xxxx').deco(20, 30, 'xxxx').deco(26, 6, 'xxx')
c.wall_spikes(14, 1, 3)
chunks.append(c.check())

c = C('yard_bounce', 0, 1, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.deco(24, 4, 'oooo').deco(15, 32, 'ooo')
c.deco(5, 14, 'vvvvvvvv')
chunks.append(c.check())

c = C('yard_saw', 0, 1, 33)
c.climb(width=9, step=8, direction=-1)
c.put(2, 19, '!')
c.saw(x=8, y=13, r=1, ax=22, ay=0, period=200)
c.saw(x=30, y=22, r=1, ax=-20, ay=0, period=230, phase=60)
c.wall_spikes(8, -1, 2)
chunks.append(c.check())

# ================================================== BIOME 1 — THE FOUNDRY ====
# Heat, moving metal, and machinery that pushes you toward the heat.
c = C('foundry_lava', 1, 1, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.ledge(26, 2, 5, '#', '~').ledge(20, 33, 5, '#', '~').ledge(11, 2, 4, '#', '~')
c.wall_spikes(23, 1, 2)
chunks.append(c.check())

c = C('foundry_conveyor', 1, 2, 33)
c.climb(width=9, step=8, direction=-1)
c.put(2, 19, '!')
c.deco(23, 4, 'ccccc').deco(14, 30, 'CCCCC')
c.ledge(24, 32, 5, '#', '~')
chunks.append(c.check())

c = C('foundry_press', 1, 2, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.mover(x=4, y=8, w=4, h=3, ax=0, ay=6, period=170, deadly=True)
c.mover(x=31, y=17, w=4, h=3, ax=0, ay=6, period=190, phase=70, deadly=True)
c.ledge(28, 2, 4, '#', '~')
chunks.append(c.check())

c = C('foundry_saws', 1, 2, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.saw(x=10, y=9, r=1, ax=0, ay=9, period=160)
c.saw(x=28, y=15, r=1, ax=0, ay=9, period=160, phase=80)
c.wall_spikes(20, -1, 2)
chunks.append(c.check())

c = C('foundry_moving', 1, 2, 33)
c.climb(width=9, step=8, direction=-1)
c.put(2, 19, '!')
c.mover(x=8, y=12, w=5, h=1, ax=18, ay=0, period=240)
c.mover(x=26, y=21, w=5, h=1, ax=-16, ay=0, period=240, phase=120)
c.ledge(27, 33, 4, '#', '~')
chunks.append(c.check())

# ================================================== BIOME 2 — THE FREEZER ====
# No friction, no mercy, and a wind with opinions about where you land.
c = C('freeze_ice', 2, 2, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.restyle([1, 2, 4, 5, 7, 8], 'i')
c.wall_spikes(19, 1, 3)
chunks.append(c.check())

c = C('freeze_wind', 2, 2, 33)
c.climb(width=9, step=8, direction=-1)
c.put(2, 19, '!')
c.col(3, 6, 27, 'W').col(36, 6, 27, 'W')
c.deco(5, 13, 'vvvvvv').deco(5, 23, 'vvvv')
chunks.append(c.check())

c = C('freeze_crumble', 2, 3, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.restyle([1, 3, 5, 7], 'i')
c.deco(9, 4, 'xxxx').deco(18, 30, 'xxxx').deco(24, 6, 'xxx')
c.col(2, 6, 26, '*').col(37, 6, 26, '*')
c.wall_spikes(12, -1, 2)
chunks.append(c.check())

c = C('freeze_saws', 2, 3, 33)
c.climb(width=9, step=8, direction=-1)
c.put(2, 19, '!')
c.restyle([1, 3, 5, 7], 'i')
c.saw(x=19, y=11, r=1, ax=14, ay=0, period=190)
c.saw(x=9, y=20, r=1, ax=0, ay=6, period=140, phase=40)
chunks.append(c.check())

c = C('freeze_pit', 2, 3, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.wall_spikes(10, 1, 2).wall_spikes(22, -1, 2)
c.deco(16, 4, 'xxxx').deco(24, 30, 'xxx')
chunks.append(c.check())

# ==================================================== BIOME 3 — THE SPIRE ====
# Everything at once, at the top of the world, with the wind in your teeth.
c = C('spire_gauntlet', 3, 3, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.restyle([4], 'i')
c.deco(12, 4, 'xxxx').deco(22, 30, 'xxx')
c.saw(x=19, y=16, r=1, ax=0, ay=7, period=130)
c.col(3, 18, 28, 'W').col(36, 18, 28, 'W')
c.wall_spikes(9, -1, 2)
chunks.append(c.check())

c = C('spire_crushers', 3, 3, 33)
c.climb(width=9, step=8, direction=-1)
c.put(2, 19, '!')
c.mover(x=6, y=7, w=4, h=3, ax=0, ay=7, period=140, deadly=True)
c.mover(x=29, y=7, w=4, h=3, ax=0, ay=7, period=140, phase=70, deadly=True)
c.saw(x=19, y=23, r=1, ax=0, ay=5, period=120)
c.ledge(28, 2, 4, '#', '~').ledge(28, 33, 4, '#', '~')
chunks.append(c.check())

c = C('spire_final', 3, 3, 33)
c.climb(width=9, step=8, direction=1)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.deco(20, 32, 'ooo')
c.deco(10, 4, 'xxxx').deco(19, 30, 'xxx')
c.saw(x=8, y=12, r=1, ax=24, ay=0, period=150)
c.saw(x=19, y=25, r=1, ax=0, ay=4, period=110)
c.wall_spikes(18, 1, 2)
chunks.append(c.check())

c = C('spire_goal', 3, 0, 24, tags=['goal'])
c.climb(width=9, step=8, direction=1)
c.fill(0, 1, 2, 37, '#')
c.put(2, 17, 'FFFFFF')
c.put(5, 19, '!')
chunks.append(c.check(is_goal=True))

out = io.StringIO()
out.write("""import type { ChunkDef } from './level.js';

/**
 * Hand-authored chunks, generated by tools/gen_chunks.py.
 *
 * Every chunk is 40 tiles wide with solid side walls, and carries a landing
 * platform at local row 1 and another at row h-2. Stacked, those land exactly
 * three rows apart with clear rows between them, so any chunk can follow any
 * other and the seam is always jumpable. Inside a chunk the route is a
 * serpentine whose footholds are never more than three rows and three columns
 * apart — one jump. `scripts/verify-levels.mjs` re-derives all of this from the
 * assembled level and fails the build if it stops holding.
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

path = sys.argv[1]
open(path, 'w').write(out.getvalue())
print(f'wrote {len(chunks)} chunks, {sum(ch.h for ch in chunks)} rows -> {path}')
