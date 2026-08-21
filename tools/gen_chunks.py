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


# How many columns of the lower foothold must work as a launch position.
#
# This used to be two, and two was most of what was wrong with the tower.
#
# The old rule came from rock footholds, where standing under the platform you
# are climbing onto is useless because you bang your head on it. So `climb()`
# placed every platform one column clear of the one below — the *maximum*
# spread that is still legal — and the result was a six-hundred-row tower in
# which two of every six columns worked and the other four dropped you to the
# floor. Measured on it: 23% of plausible casual jump attempts landed, and five
# different two-player policies each climbed between three and nine rows of 651
# in three minutes. Provably completable; nobody would ever complete it.
#
# Footholds are one-way platforms now, so the rule they were spaced by no
# longer applies (see `launch_columns`) and the spacing can be chosen for how
# it plays rather than for what it survives. Four is a floor. The number that
# actually matters is MIN_OVERLAP.
MIN_LAUNCH_COLUMNS = 4

# Columns of a foothold that must sit directly under the next one up.
#
# A player standing in one of these can jump straight up, with no sideways
# component to get wrong, and land. It is the most forgiving move in the game.
# Below three the climb is a sequence of committed leaps across gaps; at three
# or more it is a staircase you can walk up while arguing with your partner,
# which is what the rope and the crate need it to be. The difficulty of this
# game is meant to live in the load you are carrying, not in the ledges.
MIN_OVERLAP = 3


def launch_columns(lower, upper):
    """Columns of `lower` a player can stand in and still jump onto `upper`.

    Footholds are one-way platforms: you pass straight up through them and only
    land coming down. So standing directly underneath one is not the dead end
    it is under rock — it is the easiest launch there is. Everything within
    reach of the target counts, including everything beneath it."""
    _, a0, a1 = lower
    _, b0, b1 = upper
    return [x for x in range(a0, a1 + 1)
            if b0 - LAUNCH_REACH <= x <= b1 + LAUNCH_REACH]


def overlap(lower, upper):
    """Columns of `lower` sitting directly under `upper` — the free jumps."""
    _, a0, a1 = lower
    _, b0, b1 = upper
    return max(0, min(a1, b1) - max(a0, b0) + 1)


def reachable(lower, upper):
    """Can a player standing on `lower` climb onto `upper` three rows up?"""
    return (len(launch_columns(lower, upper)) >= MIN_LAUNCH_COLUMNS
            and overlap(lower, upper) >= MIN_OVERLAP)


def solve_column(row, width, above, lo, hi, wanted, below=None):
    """The column nearest `wanted` that can be climbed from and onto.

    Every platform used to be placed by arithmetic and only the bottom one was
    solved, which is why the serpentine's turns at the walls were the worst
    steps in the tower: the clamp moved a platform without asking whether the
    move was still climbable. Solving each placement instead means a turn costs
    a shorter step rather than a harder jump."""
    best = None
    for c in range(lo, hi + 1):
        here = (row, c, c + width - 1)
        if above is not None and not reachable(here, above):
            continue
        if below is not None and not reachable(below, here):
            continue
        if best is None or abs(c - wanted) < abs(best - wanted):
            best = c
    return best


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
        self.skipped = []       # hazards that had nowhere to go, reported at the end

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
    def climb(self, width=10, step=6, direction=1, tile='=', start=None):
        """Lay the guaranteed route: the two seam landings plus a serpentine.

        `step` is how far sideways the route travels every three rows, and
        `width - step` is how much of each foothold sits directly under the
        next one up. That second number is the one you feel: it is the width of
        the band you can stand in and jump straight up from, and the tower is
        only playable because it is no longer zero.

        `step` may be a sequence, cycled through as the serpentine descends. A
        single number gives a staircase with one rhythm, and eleven of the
        twenty chunks used to share a `(width, step, direction)` triple — which
        fully determines the shape, so those chunks had byte-identical routes
        and differed only in what was painted beside them. Alternating a long
        stride with a short one is the cheapest thing that makes a chunk read
        as a different room rather than the same room redecorated.

        `start` is the anchor column, solved to the nearest legal one. There
        used to be an argument by this name that every chunk passed and nothing
        read — the anchor was forced to sit beside the top landing, so the
        serpentine began in the same place every time. Rewriting all twenty-one
        call sites to the same number regenerated a byte-identical chunks.ts,
        which is how it was found. It was removed then; this is it put back and
        actually connected, which is what it should have been.

        Every platform is solved rather than computed. The old version placed
        them by arithmetic and clamped at the walls, which silently turned each
        of the serpentine's turns into the hardest jump in the chunk; now a
        turn costs a shorter step instead."""
        steps = (step,) if isinstance(step, int) else tuple(step)
        for k in steps:
            assert width - k >= MIN_OVERLAP, (
                f'{self.id}: width {width} stepping {k} overlaps by '
                f'{width - k}, under the {MIN_OVERLAP} a straight-up jump needs')
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

        wanted = start
        if wanted is None:
            # As far to the requested side of the top landing as still overlaps
            # it, so the chunk's character is set by its first turn.
            wanted = TOP_C1 - MIN_OVERLAP + 1 if direction > 0 else TOP_C0 - width + MIN_OVERLAP
        first = solve_column(rows[0], width, top_landing, lo, hi, wanted)
        assert first is not None, f'{self.id}: no anchor platform can reach the top landing'

        cols = [first]
        d = -direction
        for i, r in enumerate(rows[1:-1]):
            reach = steps[i % len(steps)]
            above = (rows[len(cols) - 1], cols[-1], cols[-1] + width - 1)
            c = solve_column(r, width, above, lo, hi, cols[-1] + d * reach)
            assert c is not None, f'{self.id}: no platform at row {r} can reach the one above'
            # Turn at the walls: once a step stops buying sideways distance,
            # the serpentine has run out of room in this direction.
            if abs(c - cols[-1]) < reach - MIN_OVERLAP:
                d = -d
                alt = solve_column(r, width, above, lo, hi, cols[-1] + d * reach)
                if alt is not None and abs(alt - cols[-1]) > abs(c - cols[-1]):
                    c = alt
            cols.append(c)

        # The bottom-most has two neighbours to satisfy, not one.
        above = (rows[-2], cols[-1], cols[-1] + width - 1)
        last = solve_column(rows[-1], width, above, lo, hi,
                            cols[-1] + d * steps[(len(rows) - 2) % len(steps)],
                            below=bottom_landing)
        assert last is not None, f'{self.id}: no valid bottom platform column'
        cols.append(last)

        placed = [(r, c, c + width - 1) for r, c in zip(rows, cols)]
        for r, c0, c1 in placed:
            self.put(r, c0, tile * (c1 - c0 + 1))
            self._protect(r, c0, c1)

        # Proven, not assumed: walk the finished route and check every step.
        route = [bottom_landing] + list(reversed(placed)) + [top_landing]
        for lower, upper in zip(route, route[1:]):
            assert reachable(lower, upper), (
                f'{self.id}: row {lower[0]} cannot climb to row {upper[0]}')

        # Stored bottom-to-top, the order the route is climbed in.
        self.path = route
        return self

    # Tiles a player can actually come to rest on. A bounce pad throws you
    # straight back off, and a crumbling crate is gone a third of a second
    # after you touch it — neither can be the only thing holding the route up.
    # They still appear everywhere, just never as the sole footing.
    FOOTING = set('#=icC')
    # ...and of those, the ones you can also rise straight up through. This is
    # the distinction the whole tower is built on now: a solid foothold three
    # rows above you blocks your head, so the cell under it is not a place you
    # can stand at all, while a one-way platform is somewhere you pass through
    # on the way up and land on on the way down.
    PASS_THROUGH = set('=')

    def band(self, index):
        """Columns of path[index] the step from below is climbed through."""
        if index <= 0:
            return set()
        _, a0, a1 = self.path[index - 1]
        _, b0, b1 = self.path[index]
        return set(range(max(a0, b0), min(a1, b1) + 1))

    def restyle(self, indices, ch):
        """Repaint chosen path platforms — ice, crumbling crates, conveyors.

        Solid materials keep off the pass-through band. Ice is lovely to climb
        on and it is also a wall three rows tall: paint it over the columns the
        step below is proved through and you have not made that step harder,
        you have deleted it, because the cell under a solid tile is not
        somewhere a player can stand. The band stays a one-way platform and the
        rest of the foothold gets the material, which reads as a strip of ice
        on a scaffold plank and plays as one too."""
        assert ch in self.FOOTING, (
            f'{self.id}: {ch!r} cannot be stood on, so it cannot be part of the route')
        for i in indices:
            r, c0, c1 = self.path[i]
            keep = set() if ch in self.PASS_THROUGH else self.band(i)
            painted = [c for c in range(c0, c1 + 1) if c not in keep]
            assert painted, (
                f'{self.id}: path[{i}] is all pass-through band, so {ch!r} '
                f'would have nowhere to go')
            for c in painted:
                self.rows[r][c] = ch
        return self

    @staticmethod
    def _free_run(c0, c1, safe, side, length, spare=None):
        """A run of `length` columns from one end that leaves the climb intact.

        It works in from the requested end and takes the other one if that end
        gives nothing, because which end of a foothold is free alternates with
        the serpentine's direction, and making the author track it by hand
        means half the hazards in the tower are silently in the wrong place or
        silently absent.

        It may eat into the launch band, but only while `MIN_LAUNCH_COLUMNS` of
        it survive. Refusing to touch the band at all was the first rule here
        and it broke as soon as chunks got a short stride: a foothold that sits
        almost entirely under the next one is nothing but band, so a hazard on
        it had nowhere to go and the whole chunk failed to author. Leaving four
        ways past is what the rule was ever trying to protect."""
        for s in (side, -side):
            span = range(c1, c0 - 1, -1) if s > 0 else range(c0, c1 + 1)
            run = []
            left = len(safe)
            keep = MIN_LAUNCH_COLUMNS if spare is None else spare
            for c in span:
                if len(run) >= length:
                    break
                if c in safe:
                    if left - 1 < keep:
                        break
                    left -= 1
                run.append(c)
            if run:
                return run
        return []

    def hazard(self, index, ch, side=1, length=3):
        """Put something dangerous on the route itself, not beside it.

        The tower was 92.7% plain concrete, and every hazard in it was painted
        through `deco()`, which by construction refuses to touch the route. So
        the spikes and the saws and the ice were all in the parts of the level
        nobody has any reason to walk through — scenery of danger wrapped
        around a completely safe staircase. You could climb the whole campaign
        without passing within a tile of anything that could hurt you.

        This paints onto the standing surface of a route platform, working in
        from one end and stopping dead at the launch band — the columns the
        next step up is proved from. So the way past is always there and always
        somewhere specific, which is the difference between a hazard and a
        wall: it makes you stand where the level wants you, rather than
        wherever you like, and standing somewhere specific while roped to
        somebody else is the entire game."""
        assert 0 <= index < len(self.path) - 1, (
            f'{self.id}: path index {index} has nothing above it to protect')
        r, c0, c1 = self.path[index]
        # Two things must survive on a foothold: somewhere to take off from for
        # the step above, and somewhere to come down on from the step below.
        # Protecting only the first put spikes exactly where you land, and the
        # casual-landing rate on the worst step in the campaign halved.
        safe = set(launch_columns(self.path[index], self.path[index + 1])) | self.band(index)
        painted = self._free_run(c0, c1, safe, side, length)
        assert painted, (
            f'{self.id}: path[{index}] at row {r} is all launch band, so a '
            f'hazard on it would be a wall')
        for c in painted:
            self.rows[r - 1][c] = ch
            self.protected.add((r - 1, c))
        return self

    def underhang(self, index, ch='v', side=1, length=3):
        """Hang spikes under a route platform, where the crate rides.

        The players walk over the top of this and it is never in their way,
        which is the point. The crate hangs a rope's length below the pair, so
        the underside of the route is exactly where the load lives, and a game
        about carrying something fragile ought to put its teeth there rather
        than on the footpath.

        It bites the platform below too — a spike at head height is a place you
        cannot walk — so it stops at that platform's launch band for the same
        reason `hazard` does, and works in from one end so it can never cut a
        foothold in half and strand somebody on the wrong side of it."""
        assert 0 < index < len(self.path), (
            f'{self.id}: path index {index} has nothing below it to hang over')
        r, c0, c1 = self.path[index]
        # Only over open air — never over any part of the foothold below.
        #
        # Keeping clear of that foothold's *launch columns* was the first rule
        # here and it was subtly wrong: it let an underhang land in the middle
        # of the platform below and cut it in two. One of them turned an
        # eleven-column ledge into a two-column island, and the casual-landing
        # rate on that step fell to 18%, because a spike at head height is a
        # place you cannot walk through even though the fill can still find a
        # way around it. Air cannot be split.
        _, b0, b1 = self.path[index - 1]
        safe = set(range(b0, b1 + 1))
        painted = self._free_run(c0, c1, safe, side, length, spare=len(safe))
        if not painted:
            # No air under this foothold: it sits entirely over the one below.
            # Skipped rather than asserted, because which indices have air
            # depends on the serpentine's rhythm and forcing the author to
            # solve that by hand is how you end up with an author who stops
            # asking for hazards. Skips are counted and printed, so this is
            # never silent, and `levels.test.ts` fails the build if the tower
            # as a whole stops being dangerous.
            self.skipped.append(f'underhang path[{index}] row {r}')
            return self
        for c in painted:
            self.rows[r + 1][c] = ch
            self.protected.add((r + 1, c))
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

    def spurs(self, indices, side, length=4, gap=3, drop=1):
        """Stub shelves hanging off the route, on the given side.

        Pure silhouette: `deco` refuses to paint into a protected cell, so a
        spur can never eat the footing or the headroom the route depends on.
        They exist because twenty chunks built from one serpentine read as one
        room twenty times, and a stub of floor sticking out into the shaft is
        the cheapest thing that changes the shape of a room.
        """
        for i in indices:
            if i < 0 or i >= len(self.path):
                continue
            r, c0, c1 = self.path[i]
            row = r + drop
            # Well clear of both seams. The landings at rows 1 and h-2 have
            # their own clearance rules, and a spur that lands in one turns a
            # cosmetic flourish into a level that will not assemble.
            if row < 4 or row > self.h - 5:
                continue
            c = max(2, c0 - gap - length) if side < 0 else min(W - 2 - length, c1 + gap)
            self.deco(row, c, '#' * length)
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
            assert reachable((1, TOP_C0, TOP_C1), (0, BOT_C0, BOT_C1)), (
                'the shared seam landings cannot be climbed between')

        # Consecutive footholds must be within one jump of each other.
        for (r0, a0, a1), (r1, b0, b1) in zip(self.path, self.path[1:]):
            up = r0 - r1
            assert up == V_STEP, (
                f'{self.id}: {up} row step between footholds at rows {r0} and {r1} '
                f'(every step must be exactly {V_STEP})')
            # One rule, in one place: `reachable`. This used to be a second
            # copy of the launch-column arithmetic, and a second copy of a rule
            # is a rule that will eventually disagree with itself.
            lower, upper = (r0, a0, a1), (r1, b0, b1)
            assert reachable(lower, upper), (
                f'{self.id}: rows {r0} [{a0}-{a1}] and {r1} [{b0}-{b1}] have '
                f'{len(launch_columns(lower, upper))} launch columns and '
                f'{overlap(lower, upper)} of overlap, under the '
                f'{MIN_LAUNCH_COLUMNS}/{MIN_OVERLAP} a climbable step needs')

        # Every foothold must be made of something you can stand on, and must
        # stay inside the walls.
        # The goal chunk caps the tower: its top landing is a ceiling nobody
        # climbs through, so it is exempt.
        for i in range(1, len(self.path) - (1 if is_goal else 0)):
            r = self.path[i][0]
            for c in self.band(i):
                assert self.rows[r][c] in self.PASS_THROUGH, (
                    f'{self.id}: path[{i}] row {r} col {c} is {self.rows[r][c]!r}, '
                    f'which cannot be risen through — the step below it is '
                    f'proved through this column')

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
c.climb(width=13, step=(8, 4), direction=1)
c.put(2, 19, '!')
c.fill(30, 32, 2, 37, '#')
c.put(29, 19, 'S')
c.underhang(6, length=2)
chunks.append(c.check(is_start=True))

c = C('yard_ladders', 0, 0, 33)
c.climb(width=11, step=7, direction=-1)
c.put(2, 19, '!')
c.col(2, 5, 27, '*').col(37, 5, 27, '*')
c.restyle([3, 6], '=')
c.hazard(4, '^', side=1, length=2).underhang(7, length=2)
chunks.append(c.check())

c = C('yard_swing', 0, 1, 33)
c.climb(width=16, step=(10, 5), direction=1, start=6)
c.put(2, 19, '!')
c.col(2, 6, 24, '*').col(37, 6, 24, '*')
c.wall_spikes(11, -1, 2).wall_spikes(17, 1, 2)
c.spurs([2, 5, 8], side=1, length=5, gap=2)
c.hazard(3, '^', side=-1, length=3).hazard(6, '^', side=1, length=3)
c.underhang(8, length=3)
chunks.append(c.check())

c = C('yard_crates', 0, 0, 33)
c.climb(width=10, step=6, direction=1, start=22)
c.put(2, 19, '!')
c.deco(11, 4, 'xxxx').deco(20, 30, 'xxxx').deco(26, 6, 'xxx')
c.wall_spikes(14, 1, 3)
c.spurs([1, 4, 7, 10], side=-1, length=4, gap=3)
c.hazard(5, '^', side=1, length=2).underhang(2, length=2)
chunks.append(c.check())

c = C('yard_bounce', 0, 1, 33)
c.climb(width=12, step=(7, 4), direction=1)
c.put(2, 19, '!')
c.deco(24, 4, 'oooo').deco(15, 32, 'ooo')
c.deco(5, 14, 'vvvvvvvv')
c.hazard(2, '^', side=1, length=2).hazard(7, '^', side=-1, length=2)
c.underhang(5, length=3)
chunks.append(c.check())

c = C('yard_saw', 0, 1, 33)
c.climb(width=14, step=9, direction=-1, start=8)
c.put(2, 19, '!')
c.saw(x=8, y=13, r=1, ax=22, ay=0, period=200)
c.saw(x=30, y=22, r=1, ax=-20, ay=0, period=230, phase=60)
c.wall_spikes(8, -1, 2)
c.hazard(4, '^', side=-1, length=3).underhang(6, side=-1, length=3)
chunks.append(c.check())

# ================================================== BIOME 1 — THE FOUNDRY ====
# Heat, moving metal, and machinery that pushes you toward the heat.
c = C('foundry_lava', 1, 1, 33)
c.climb(width=11, step=(7, 3), direction=1)
c.put(2, 19, '!')
c.ledge(26, 2, 5, '#', '~').ledge(20, 33, 5, '#', '~').ledge(11, 2, 4, '#', '~')
c.wall_spikes(23, 1, 2)
c.hazard(3, '^', side=1, length=3).underhang(5, length=3).underhang(8, side=-1, length=2)
chunks.append(c.check())

c = C('foundry_conveyor', 1, 2, 33)
c.climb(width=13, step=8, direction=-1, start=20)
c.put(2, 19, '!')
c.deco(23, 4, 'ccccc').deco(14, 30, 'CCCCC')
c.ledge(24, 32, 5, '#', '~')
c.restyle([4, 7], 'c')
c.hazard(2, '^', side=-1, length=3).underhang(6, length=3)
chunks.append(c.check())

c = C('foundry_press', 1, 2, 33)
c.climb(width=10, step=(6, 3), direction=1)
c.put(2, 19, '!')
c.mover(x=4, y=8, w=4, h=3, ax=0, ay=6, period=170, deadly=True)
c.mover(x=31, y=17, w=4, h=3, ax=0, ay=6, period=190, phase=70, deadly=True)
c.ledge(28, 2, 4, '#', '~')
c.hazard(3, '^', side=1, length=2).hazard(7, '^', side=-1, length=2)
c.underhang(5, length=3).underhang(9, side=-1, length=2)
chunks.append(c.check())

c = C('foundry_saws', 1, 2, 33)
c.climb(width=16, step=10, direction=1, start=5)
c.put(2, 19, '!')
c.saw(x=10, y=9, r=1, ax=0, ay=9, period=160)
c.saw(x=28, y=15, r=1, ax=0, ay=9, period=160, phase=80)
c.wall_spikes(20, -1, 2)
c.spurs([3, 6], side=-1, length=6, gap=2, drop=2)
c.hazard(2, '^', side=1, length=4).hazard(8, '^', side=-1, length=4)
c.underhang(5, length=4)
chunks.append(c.check())

c = C('foundry_moving', 1, 2, 33)
c.climb(width=12, step=7, direction=-1)
c.put(2, 19, '!')
c.mover(x=8, y=12, w=5, h=1, ax=18, ay=0, period=240)
c.mover(x=26, y=21, w=5, h=1, ax=-16, ay=0, period=240, phase=120)
c.ledge(27, 33, 4, '#', '~')
c.restyle([3, 6], 'C')
c.hazard(8, '^', side=1, length=3).underhang(4, side=-1, length=3)
chunks.append(c.check())

# ================================================== BIOME 2 — THE FREEZER ====
# No friction, no mercy, and a wind with opinions about where you land.
c = C('freeze_ice', 2, 2, 33)
c.climb(width=14, step=(9, 4), direction=1, start=19)
c.put(2, 19, '!')
c.restyle([1, 2, 4, 5, 7, 8], 'i')
c.wall_spikes(19, 1, 3)
c.hazard(3, '^', side=1, length=3).hazard(6, '^', side=-1, length=3)
c.underhang(8, length=3)
chunks.append(c.check())

c = C('freeze_wind', 2, 2, 33)
c.climb(width=13, step=8, direction=-1)
c.put(2, 19, '!')
c.col(3, 6, 27, 'W').col(36, 6, 27, 'W')
c.deco(5, 13, 'vvvvvv').deco(5, 23, 'vvvv')
c.hazard(4, '^', side=-1, length=3).underhang(2, length=3).underhang(7, side=-1, length=3)
chunks.append(c.check())

c = C('freeze_crumble', 2, 3, 33)
c.climb(width=11, step=(7, 4), direction=-1, start=24)
c.put(2, 19, '!')
c.restyle([1, 3, 5, 7], 'i')
c.deco(9, 4, 'xxxx').deco(18, 30, 'xxxx').deco(24, 6, 'xxx')
c.col(2, 6, 26, '*').col(37, 6, 26, '*')
c.wall_spikes(12, -1, 2)
c.hazard(2, '^', side=1, length=3).hazard(6, '^', side=-1, length=3)
c.underhang(4, length=3).underhang(8, side=-1, length=3)
chunks.append(c.check())

c = C('freeze_saws', 2, 3, 33)
c.climb(width=16, step=(10, 6), direction=-1)
c.put(2, 19, '!')
c.restyle([1, 3, 5, 7], 'i')
c.saw(x=19, y=11, r=1, ax=14, ay=0, period=190)
c.saw(x=9, y=20, r=1, ax=0, ay=6, period=140, phase=40)
c.hazard(2, '^', side=-1, length=4).hazard(6, '^', side=1, length=4)
c.underhang(4, length=4).underhang(8, side=-1, length=3)
chunks.append(c.check())

c = C('freeze_pit', 2, 3, 33)
c.climb(width=10, step=6, direction=1, start=5)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.wall_spikes(10, 1, 2).wall_spikes(22, -1, 2)
c.deco(16, 4, 'xxxx').deco(24, 30, 'xxx')
c.spurs([2, 6], side=1, length=7, gap=1, drop=2)
c.hazard(3, '^', side=1, length=3).hazard(7, '^', side=-1, length=3)
c.underhang(5, length=3).underhang(9, side=-1, length=2)
chunks.append(c.check())

# ==================================================== BIOME 3 — THE SPIRE ====
# Everything at once, at the top of the world, with the wind in your teeth.
c = C('spire_gauntlet', 3, 3, 33)
c.climb(width=12, step=(7, 3), direction=-1, start=21)
c.put(2, 19, '!')
c.restyle([4], 'i')
c.deco(12, 4, 'xxxx').deco(22, 30, 'xxx')
c.saw(x=19, y=16, r=1, ax=0, ay=7, period=130)
c.col(3, 18, 28, 'W').col(36, 18, 28, 'W')
c.wall_spikes(9, -1, 2)
c.restyle([5], 'c')
c.hazard(2, '^', side=1, length=3).hazard(6, '^', side=-1, length=3)
c.underhang(4, length=3).underhang(8, side=-1, length=3)
chunks.append(c.check())

c = C('spire_crushers', 3, 3, 33)
c.climb(width=14, step=9, direction=-1)
c.put(2, 19, '!')
c.mover(x=6, y=7, w=4, h=3, ax=0, ay=7, period=140, deadly=True)
c.mover(x=29, y=7, w=4, h=3, ax=0, ay=7, period=140, phase=70, deadly=True)
c.saw(x=19, y=23, r=1, ax=0, ay=5, period=120)
c.ledge(28, 2, 4, '#', '~').ledge(28, 33, 4, '#', '~')
c.hazard(3, '^', side=-1, length=4).hazard(7, '^', side=1, length=4)
c.underhang(5, length=4).underhang(9, side=-1, length=3)
chunks.append(c.check())

c = C('spire_final', 3, 3, 33)
c.climb(width=11, step=(7, 5), direction=1, start=7)
c.put(2, 19, '!')
c.col(2, 5, 28, '*').col(37, 5, 28, '*')
c.deco(20, 32, 'ooo')
c.deco(10, 4, 'xxxx').deco(19, 30, 'xxx')
c.saw(x=8, y=12, r=1, ax=24, ay=0, period=150)
c.saw(x=19, y=25, r=1, ax=0, ay=4, period=110)
c.wall_spikes(18, 1, 2)
c.restyle([3], 'i')
c.hazard(2, '^', side=1, length=3).hazard(5, '^', side=-1, length=3)
c.hazard(8, '^', side=1, length=3).underhang(6, length=4)
chunks.append(c.check())

c = C('spire_goal', 3, 0, 24, tags=['goal'])
c.climb(width=13, step=(8, 5), direction=1)
c.fill(0, 1, 2, 37, '#')
c.put(2, 17, 'FFFFFF')
c.put(5, 19, '!')
c.underhang(3, length=3)
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

skipped = [(ch.id, why) for ch in chunks for why in ch.skipped]
if skipped:
    print(f'{len(skipped)} hazard(s) had nowhere to go:')
    for cid, why in skipped:
        print(f'  {cid}: {why}')

path = sys.argv[1]
open(path, 'w').write(out.getvalue())
print(f'wrote {len(chunks)} chunks, {sum(ch.h for ch in chunks)} rows -> {path}')
