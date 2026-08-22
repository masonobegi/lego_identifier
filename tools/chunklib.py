"""The chunk painter: the grid, the rules, and the climbability checks.

Chunks are painted on a 40-wide grid and emitted as TypeScript. Painting beats
counting dots by hand: a miscounted row is a broken level.

What this file enforces is that **every chunk is climbable, and every pair of
chunks is climbable across the seam between them**. That is not something you
can eyeball. The rules, all calibrated against the simulation:

  * Footholds sit 3 rows apart. Anything closer leaves less vertical clearance
    than the player is tall, and they clip the platform they are jumping to.
  * Consecutive footholds are never vertically aligned. To climb onto a
    platform you have to be standing clear of it first, so the lower foothold
    must extend past the upper one's edge — within two columns of it, one less
    than a 3 row jump actually crosses (scripts/calibrate-jump.mjs).
  * Nothing on the route is a bounce pad or a crumbling crate: one throws you
    off, the other is gone a third of a second after you touch it.
  * Decoration is painted through `deco()`, which refuses to write into a
    foothold or the headroom above it. Hazards go on the route through
    `hazard()`, which refuses to write into the columns the climb is proved
    from; the route is placed by rule, and the rule wins.
  * A shutter across the route has a plate on each side of it. A door only one
    of you can hold open is a wall, and it is a wall none of the rules above
    can see: the route past it is still a legal staircase.
  * Every chunk has a landing platform at local row 1 and another at row h-2,
    horizontally offset from each other. Stacked, those two sit exactly 3 rows
    apart with clear rows between, so any chunk can follow any other.
  * `climb()` lays that path automatically as a serpentine up the shaft;
    chunks then restyle individual platforms and hang hazards around them.

The chunks themselves live in `gen_chunks.py`, which is the file you edit to
add a floor. This one is the machine underneath it, and separating the two is
what makes either readable: nine hundred lines of rules with the level content
buried at the bottom is a file nobody opens to add a floor.

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
# How far a hauler can be reeled up a wall by a partner braced on the lip.
# Mirrors REEL_CLIMB_TILES in packages/core/src/route.ts, which is what decides
# whether the build gate believes a rope gate is passable.
REEL_CLIMB = 8


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
# How much standing room a moving blade has to leave beside itself. Two haulers,
# the rope between them, and the crate that swings under whichever moved last.
MIN_REFUGE_COLUMNS = 6

# Columns of a foothold that must sit directly under the next one up.
#
# A player standing in one of these can jump straight up, with no sideways
# component to get wrong, and land. It is the most forgiving move in the game.
# Below three the climb is a sequence of committed leaps across gaps; at three
# or more it is a staircase you can walk up while arguing with your partner,
# which is what the rope and the crate need it to be. The difficulty of this
# game is meant to live in the load you are carrying, not in the ledges.
MIN_OVERLAP = 3

# ...and how much a *gate* needs, which is more.
#
# A boosted jump is nearly vertical, so the far side of a gate has to sit
# squarely over the near side rather than clipping the corner of it — and the
# brace needs a tile to stand on beside the climber, which the last column of a
# ledge does not provide. Three columns of overlap passes the generator's own
# arithmetic and then fails the replay: the pair has one launch column, the
# brace is stood on air beside it, and nobody goes anywhere.
GATE_OVERLAP = 6

# How much clear floor a gate has to leave between its far side and a side wall,
# when the near side reaches that wall too.
#
# A wall jump is the one move in the game that gains height with nobody else in
# it: 520 of upward velocity off any solid tile within a finger's reach. Gates
# are proof against it everywhere except the corners of the shaft, and
# foundry_tap was a corner: near side and far side both ran to column 34, three
# clear of the wall. One player ran off the near side, jumped, drifted into the
# wall, kicked off it at 2.6 tiles of rise and came down on the far side —
# from column 31, replayed by the build gate. Moving the far side two columns
# in put the kick's landing spot in the gap instead, and the same room turned
# the solo search down at every column. Four columns is still beaten; five is
# not. The near side has to reach the wall as well, or there is no run-off into
# the corner to begin with: seven gates in the library sit two to four columns
# off a wall with their near side eight or ten columns clear of it, and the
# build gate finds no way up any of them.
WALL_JUMP_REACH = 5

# How wide a shutter has to be, which the crate decides rather than the haulers.
#
# A hauler is 20px across and the crate is 26, in a 24px tile. So a one column
# doorway is a door the pair walk through and the thing they are carrying does
# not — and it hangs off the middle of the rope, so leaving it on the wrong
# side of a door is not on offer. Two columns is 48px of clear air: the crate,
# and a shoulder beside it.
DOOR_W = 2

# ...and how tall, which is decided by how high a hauler can jump.
#
# A plain jump rises 4.50 tiles, measured on the campaign's flat ledge at row
# 666 (packages/core/src/player.ts). Three tiles of door is one you hop over
# without breaking stride. Four leaves 42px of travel above the lip against the
# 68px of door and shoulder that have to cross it: it does not work, and it is
# near enough to working that somebody would eventually find the frame it works
# on. Five is a door nobody argues with, and open it is still two clear tiles to
# walk through, which is what a 32px hauler needs.
DOOR_H = 5

# Columns of plate under each end of the leapfrog.
#
# One column is a tile you have to stop on exactly, which is not a thing to ask
# of somebody being towed about by a rope, and it is narrower than the crate
# that is meant to be able to hold a door down in their place.
PLATE_W = 2

# How far apart a door's two plates may sit, in tiles.
#
# `ROPE_MAX` is 232px, a shade under ten tiles, and the leapfrog needs one
# hauler standing on the near plate at the moment the other reaches the far
# one. Plates further apart than the rope make a door that opens once and never
# lets the second one through, which is a room the pair can only lose in. Nine
# is the room `hold.test.ts` proves the leapfrog on, and it is the whole of the
# rope: the two ends of a hold are as far apart as they can be made.
HOLD_ROPE = 9

# Columns of clear floor between the near plate and the door.
#
# It is a run-up, and it is what keeps one hauler from doing this room alone.
# The crate hangs off the middle of the rope, so it creeps forward at about
# half the speed of a hauler walking away from an inert partner: a plate close
# to its door is still under the crate when that hauler reaches the doorway,
# and they walk through a door their own cargo is holding open for them.
# `verify-levels.mjs` walked one player and their passenger through a four
# column run-up and said so. Five clear columns puts the plate six from its
# door, which is what `hold.test.ts` builds its room from, and at six the crate
# has been towed clear of the plate before anybody reaches the door. It cannot
# go further: the two plates have to stay inside a rope end to end.
PLATE_GAP = 5

# The narrowest a ledge may be shaved to, to make room for a door beneath it.
#
# A door, its run-up and its two plates are twelve columns, a third of the
# shaft, and the foothold above the door has to sit past all of them. Left
# at the width the serpentine gave it there is no room, and every wide room in
# the library turns a door down. Eight columns is still a ledge with a column of
# slack at each end of the bands it is landed on and launched from; seven is a
# plank.
MIN_LEDGE = 8


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


def seam_rows(h):
    """Rows a chunk may not paint on: the landings it is stacked by.

    `check` asserts these stay clear, which used to be enough because nothing
    ever tried to paint there. A hazard that relocates to a neighbouring step
    can, and the first one that did put a spike across the bottom landing of
    yard_narrow — a surface every chunk underneath it is proved able to reach.
    """
    return {0, 1, 2, h - 3, h - 2, h - 1}


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
        self.moved = []         # ...and the ones that went to a neighbouring step
        self.cleared = []       # entities lifted out of a gate's airspace, on purpose
        self.gates = set()      # path indices reached only by hauling on the rope
        self.holds = 0          # shutters the pair have to take turns opening

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
    # They still appear everywhere, just never as the sole footing. A plate is
    # in here because it is ordinary floor with a switch under it, and a route
    # that could not be walked over one would be a route with a hole in it.
    FOOTING = set('#=icC_')
    # ...and of those, the ones you can also rise straight up through. This is
    # the distinction the whole tower is built on now: a solid foothold three
    # rows above you blocks your head, so the cell under it is not a place you
    # can stand at all, while a one-way platform is somewhere you pass through
    # on the way up and land on on the way down.
    PASS_THROUGH = set('=')

    #: Columns of clearance either side of the pass-through band.
    #
    # A hauler is 20px wide in a 24px tile, so a body centred on the last column
    # of the band has a shoulder in the next one along. If that next column is
    # solid — ice, a conveyor — the jump is a head-butt, and the band is one
    # column narrower than it looks. Measured before this margin existed, the
    # four worst steps in the campaign were all the same shape: a band that ran
    # right up against a strip of ice, at 8% to 18% of casual attempts landing
    # against 63% everywhere else.
    BODY_MARGIN = 1

    def band(self, index, margin=0):
        """Columns of path[index] the step from below is climbed through."""
        if index <= 0:
            return set()
        _, a0, a1 = self.path[index - 1]
        _, b0, b1 = self.path[index]
        lo = max(a0, b0) - margin
        hi = min(a1, b1) + margin
        return set(range(max(b0, lo), min(b1, hi) + 1))

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
            keep = set() if ch in self.PASS_THROUGH else self.band(i, self.BODY_MARGIN)
            painted = [c for c in range(c0, c1 + 1) if c not in keep]
            assert painted, (
                f'{self.id}: path[{i}] is all pass-through band, so {ch!r} '
                f'would have nowhere to go')
            for c in painted:
                self.rows[r][c] = self._belt(ch, c, keep) if ch in 'cC' else ch
        return self

    @staticmethod
    def _belt(ch, col, keep):
        """A conveyor that pushes you toward the climb, not off the edge.

        `restyle` paints a material on the columns the route does not need,
        which for a conveyor means the outside of the foothold — so a
        right-pusher would land on the right-hand end and carry anybody who
        stepped on it straight off. It did, at row 105 of the campaign, and
        every run stopped within a few rows of it.

        The direction is not a property of the material, it is a property of
        where the material ends up: outside the band on the left, push right;
        outside on the right, push left. Either way the belt herds you back
        toward the columns you have to launch from, which is a better mechanic
        than the one that was intended and much better than a trapdoor."""
        if not keep:
            return ch
        return 'c' if col < min(keep) else 'C'

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

    def _near(self, index):
        """Where to try putting a hazard, best first.

        A foothold whose whole width is launch band has nowhere to put a spike
        at any width, and thirty of the tower's hazards were asked for on one
        and quietly dropped — the author writes the call, the generator says
        nothing, and the level ships with a clean staircase where the design
        says there is a spike. `hazard(4, ...)` means "make the climb around
        here dangerous", not "row 22, column 9 specifically", so a neighbouring
        step is a far better answer than none, and unlike none it is reported.

        Two sweeps: the whole chunk keeping clear of hazards already painted,
        then the whole chunk again willing to share a surface with one. Sharing
        makes two hazards read as one, so it is a last resort — but it is still
        a better last resort than a foothold the design wanted dangerous and
        that a player strolls across."""
        last = len(self.path) - 2
        for clear in (True, False):
            for step in range(0, last + 1):
                for at in ([index] if step == 0 else [index - step, index + step]):
                    # The seams are how chunks stack: the two rows at each end
                    # have to stay walkable whatever ends up above and below,
                    # so a step whose surface is one of them is not a candidate
                    # however badly the hazard needs a home.
                    if 0 <= at <= last and self.path[at][0] - 1 not in seam_rows(self.h):
                        yield at, clear

    def _spoken_for(self, index, clear):
        """Columns of step `index` that a hazard may not touch.

        Always the launch band and the landing band, which are what the climb
        is proved from. `clear` additionally spares whatever is already painted
        on that surface."""
        safe = set(launch_columns(self.path[index], self.path[index + 1])) | self.band(index)
        if not clear:
            return safe
        r = self.path[index][0]
        return safe | {c for (rr, c) in self.protected if rr == r - 1}

    def _shrink_to_fit(self, c0, c1, safe, side, length):
        """The longest run of `length` or fewer that fits outside the climb.

        `_free_run` asks for one width and takes no for an answer, and the
        answer on a short foothold is always no: a ledge whose ends are both
        launch columns has nothing to spare, so a three-wide hazard on it is
        dropped whole. Thirty of the tower's hazards were being asked for and
        silently not placed that way — the author writes the call, the
        generator says nothing, and the level ships with a clean staircase
        where the design says there is a spike.

        Two spikes where three were asked for is a smaller lie than none, and
        the author is still told when even one will not fit."""
        for want in range(length, 0, -1):
            run = self._free_run(c0, c1, safe, side, want, spare=len(safe))
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
        # Two things must survive on a foothold: somewhere to take off from for
        # the step above, and somewhere to come down on from the step below.
        # Neither may be touched.
        #
        # The first version let a hazard eat into that as long as four columns
        # of it survived, which sounds generous and is not, because the columns
        # it ate were the ones next to the route. Three spikes ended up one
        # column from the route cell at row 267 of the campaign, and a pair
        # landing there from below has a single column of tolerance: 360 of the
        # 366 deaths in a twenty-minute run were on those three tiles, and every
        # policy stalled at exactly 381 rows of 651. The level gate could not see
        # it — the route was still provably climbable, and it is, if you land
        # perfectly every time.
        for at, clear in self._near(index):
            r, c0, c1 = self.path[at]
            painted = self._shrink_to_fit(c0, c1, self._spoken_for(at, clear), side, length)
            if painted:
                for c in painted:
                    self.rows[r - 1][c] = ch
                    self.protected.add((r - 1, c))
                if at != index:
                    self.moved.append(f'hazard path[{index}] -> path[{at}]')
                return self
        self.skipped.append(f'hazard path[{index}] row {r}')
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
        for at, _clear in self._near(index):
            if at < 1:
                continue
            r, c0, c1 = self.path[at]
            _, b0, b1 = self.path[at - 1]
            # ...and never under the columns the pair launches the next step
            # from, which is where the crate hangs longest.
            #
            # The teeth belong under the walk, not under the wait. A pair
            # lining up a jump stands on the launch band for as long as it
            # takes them to get it right, and the crate swings a rope's length
            # underneath them the whole time — so an underhang there is not a
            # hazard the load passes through, it is one it sits in. Measured on
            # the campaign at rows 597-614, where one sat directly beneath the
            # launch band of a three-row step: a solo pair took 20 deaths, 25
            # respawns, 34 crate hits and 5 destroyed crates there, and made no
            # progress for 107 seconds, in every run.
            safe = set(range(b0, b1 + 1))
            if at + 1 < len(self.path):
                safe |= set(launch_columns(self.path[at], self.path[at + 1]))
            painted = self._shrink_to_fit(c0, c1, safe, side, length)
            if painted:
                for c in painted:
                    self.rows[r + 1][c] = ch
                    self.protected.add((r + 1, c))
                if at != index:
                    self.moved.append(f'underhang path[{index}] -> path[{at}]')
                return self
        if True:
            # No air under this foothold: it sits entirely over the one below.
            # Skipped rather than asserted, because which indices have air
            # depends on the serpentine's rhythm and forcing the author to
            # solve that by hand is how you end up with an author who stops
            # asking for hazards. Skips are counted and printed, so this is
            # never silent, and `levels.test.ts` fails the build if the tower
            # as a whole stops being dangerous.
            self.skipped.append(f'underhang path[{index}] row {r}')
            return self

    def _gate_column(self, index):
        """Where the far side of a gate at `index` would have to go, or None.

        The far side has two masters: it must sit over the near side, because a
        boosted jump is nearly vertical, and it must still be one ordinary jump
        under the foothold above it. In a serpentine those two pull in opposite
        directions — six rows apart is two strides sideways — so most steps
        cannot carry a gate at all."""
        if not (1 <= index and index + 2 < len(self.path)):
            return None
        low = self.path[index]
        up_r, up_c0, up_c1 = self.path[index + 2]
        width = up_c1 - up_c0 + 1
        lo = max(LO, 2)
        hi = min(HI, W - 3 - (width - 1))
        above = self.path[index + 3] if index + 3 < len(self.path) else None
        best = None
        for c in range(lo, hi + 1):
            here = (up_r, c, c + width - 1)
            if overlap(low, here) < GATE_OVERLAP:
                continue
            if not self._clear_of_walls(low, here):
                continue
            if above is not None and not reachable(here, above):
                continue
            if best is None or abs(c - up_c0) < abs(best - up_c0):
                best = c
        return best

    @staticmethod
    def _clear_of_walls(low, up):
        """Is a gate's far side out of wall-jump range of the shaft's corners?

        See WALL_JUMP_REACH: a hauler who can run off the near side into a
        corner comes back off the wall with height nobody gave them."""
        for near, far in ((low[1] - 2, up[1] - 2), (W - 3 - low[2], W - 3 - up[2])):
            if near < WALL_JUMP_REACH and far < WALL_JUMP_REACH:
                return False
        return True

    def gate(self, index):
        """Take one foothold out, so the step needs two people.

        This is the hole that was at the middle of the game. `analyseLevel` can
        answer "could ONE player reach this cell", and it has a second mode that
        adds what a pair can do. The difference between the two fills is exactly
        the set of places you cannot go alone, and on the finished campaign that
        set was **empty**: 2787 cells solo, 2787 together. Every metre of a game
        called "a two-player co-op disaster about a rope" was reachable by one
        person with a passenger. Measured rather than assumed — a full input
        sweep found a lone hauler crossing exactly the same six-tile chasm as a
        pair with one of them braced, and reaching exactly the same five-row
        shelf, from every launch column, run-up, hold and reel it could try.

        The fix was a new verb rather than a new shape (see BOOST_SCALE), and
        this is the shape that asks for it: the middle foothold of three simply
        removed, leaving six clear rows. Alone that is one row past the highest
        shelf anybody can reach. Together it is: one of you braces, the other
        goes up off their shoulders, then braces on the lip while the first
        hauls up the rope. Both co-op verbs, in order, and no way to fake it.

        Deliberately no pillar in the gap. The first version stood one there for
        the second hauler to climb, which is exactly the wall a lone player
        wall-jumps straight up.

        Called last, because it rewrites `self.path` and every other authoring
        call is indexed off it."""
        # Which step is gateable depends on where the serpentine happens to be
        # when it gets there, so the index is a preference rather than an
        # instruction: a chunk asks for a gate about here and gets one at the
        # nearest step that can carry it.
        for candidate in sorted(range(1, len(self.path) - 2), key=lambda i: abs(i - index)):
            if self._gate_column(candidate) is not None:
                index = candidate
                break
        else:
            self.skipped.append(f'gate near path[{index}]')
            return self
        low = self.path[index]
        up = self.path[index + 2]

        # Wipe the gap: the middle foothold, whatever was hanging off it, and
        # the row directly under the far side.
        #
        # That last row does not belong to the foothold being removed, and
        # leaving it standing was the difference between a gate and a
        # staircase. `spurs` hangs its stub shelves one row under a platform,
        # so yard_stack and freeze_rime each had four or five columns of floor
        # a plain jump below the far side: one player went up onto the spur and
        # in from there, from column 24 and column 16, and the build gate named
        # both. A spike hanging there is no better — the climber comes up
        # through that row on the way to the landing.
        for r in range(up[0] + 1, low[0] - 1):
            for c in range(2, W - 2):
                self.rows[r][c] = '.'

        # The two survivors have to sit under one another, because a boosted
        # jump goes up rather than along — and two footholds six rows apart in a
        # serpentine are two strides apart sideways, which is nowhere near. So
        # the upper one moves, solved against the lower one it must sit over and
        # against the one above it that must still be an ordinary jump away.
        up_r, up_c0, up_c1 = up
        width = up_c1 - up_c0 + 1
        lo = max(LO, 2)
        hi = min(HI, W - 3 - (width - 1))
        above = self.path[index + 3] if index + 3 < len(self.path) else None
        best = self._gate_column(index)
        for c in range(up_c0, up_c1 + 1):
            self.rows[up_r][c] = '.'
        for c in range(best, best + width):
            self.rows[up_r][c] = '='
        self._protect(up_r, best, best + width - 1)
        up = (up_r, best, best + width - 1)
        self.path[index + 2] = up

        climb_rows = low[0] - up[0]
        assert climb_rows == 2 * V_STEP, (
            f'{self.id}: a {climb_rows} row gate is not what removing one '
            f'foothold makes')

        # Nothing lethal in the gap or on the landing.
        #
        # A gate is the one step in the game with no way to hedge: the climber
        # goes up nearly vertically off a braced partner, lands in a band six
        # columns wide, and cannot steer out of it. A blade parked in that band
        # is not a hazard, it is a wall with a rumour of a way through — and one
        # was, at row 132 of a seeded tower, sitting exactly on the landing of a
        # gate the fill had just proved. So a gate clears its own airspace.
        lo_row, hi_row = up[0] - 2, low[0] + 1
        keep = []
        for e in self.ents:
            ey = e['y'] + max(0, e.get('ay', 0))
            ey0 = e['y'] - max(0, -e.get('ay', 0))
            ex = e['x']
            ex1 = ex + max(0, e.get('ax', 0)) + e.get('w', 1)
            ex0 = ex - max(0, -e.get('ax', 0)) - 1
            overlaps_rows = ey >= lo_row and ey0 <= hi_row
            overlaps_cols = ex1 >= up[1] - 1 and ex0 <= up[2] + 1
            if overlaps_rows and overlaps_cols:
                self.cleared.append(f"{e['type']} cleared from the gate at row {up[0]}")
                continue
            keep.append(e)
        self.ents = keep

        self.path = self.path[:index + 1] + self.path[index + 2:]
        self.gates.add(index + 1)
        if 'gate' not in self.tags:
            self.tags.append('gate')
        return self

    def _hold_columns(self, index):
        """Where a hold at `index` would put its door, or None if it will not fit.

        Everything lands on one ledge: plate, run-up, door, plate. That is not
        a preference, it is the only arrangement the pair can play. A near plate
        on the foothold *below* the door reads better and fails twice over. The
        hauler holding it is three rows under the door, so following their
        partner through is a jump and not a walk, and the leapfrog is a walk —
        `verify-levels.mjs` could not get a pair through a single room shaped
        that way. And the crate hangs a rope's length under the pair, which is
        precisely where that plate is: one hauler alone strolled through a door
        the crate was holding open for them from the ledge below.

        The room that is left is a corridor, and this tower is a stack of
        serpentines with no corridor anywhere in it, so one has to be built: the
        ledge is stretched sideways until it can carry a plate, a run-up, a door
        and a plate, and the foothold above it is moved out past all four. That
        is the same trade `gate` makes — the shape the verb needs is bought by
        rewriting the two platforms it lands between, and where the serpentine
        happens to be when it gets there decides whether it can be.
        """
        if not (1 <= index and index + 1 <= len(self.path) - 2):
            return None
        r, c0, c1 = self.path[index]
        if r - DOOR_H < 0 or (r - DOOR_H) in seam_rows(self.h):
            return None
        landed = self.band(index, self.BODY_MARGIN)
        if not landed:
            return None

        # The door leads away from the columns the ledge is landed on, whichever
        # end of it those are. At a turn in the serpentine they sit in the
        # middle, and then neither side is a way out and this step cannot carry
        # a door at all.
        d = 1 if min(landed) - c0 <= c1 - max(landed) else -1
        edge = max(landed) if d > 0 else min(landed)
        near = [edge + (1 + k) * d for k in range(PLATE_W)]
        door = [near[-1] + (PLATE_GAP + 1 + k) * d for k in range(DOOR_W)]
        far = [door[-1] + (2 + k) * d for k in range(PLATE_W)]
        # The rope, measured between the two tiles the leapfrog is actually
        # stood on: the end of the near plate the holder waits at, and the end
        # of the far plate their partner arrives on.
        if (far[0] - near[-1]) * d > HOLD_ROPE:
            return None

        # The foothold above the door is moved out past it, and shaved if it has
        # to be. A door, its run-up and its two plates are twelve columns and the
        # ledge above still has to fit past them inside the same shaft, so a
        # room with a wide serpentine cannot have a door at all unless the one
        # platform that is being rebuilt anyway is allowed to come back
        # narrower. It never comes back narrower than a step needs: a column of
        # slack at each end of the columns it is landed on and launched from.
        kr, e0, e1 = self.path[index + 1]
        above = self.path[index + 2] if index + 2 < len(self.path) else None
        best = None
        for width in range(e1 - e0 + 1, MIN_LEDGE - 1, -1):
            for c in range(max(LO, 2), min(HI, W - 3 - (width - 1)) + 1):
                up = (kr, c, c + width - 1)
                # Nothing on the near side of the door may be a column the step
                # above can be launched from, or the door has a way round it
                # that costs one jump and no co-operation at all.
                reach = (c - LAUNCH_REACH) if d > 0 else (c + width - 1 + LAUNCH_REACH)
                if (reach - door[-1]) * d < 1:
                    continue
                if not reachable(self._hold_run(index, up, d), up):
                    continue
                if above is not None and not reachable(up, above):
                    continue
                if best is None or abs(c - e0) < abs(best[1] - e0):
                    best = (kr, c, c + width - 1)
            if best is not None:
                break
        if best is None:
            return None
        up = best
        run = self._hold_run(index, up, d)
        if not (run[1] <= min(near + far) and max(near + far) <= run[2]):
            return None

        # Nothing overhead on the near side of the door, six rows up or three.
        #
        # A pair can climb six rows with no foothold in between — brace, boost,
        # reel — which is the whole of what `gate` is made out of. Moving the
        # foothold above the door out past it leaves exactly that gap over the
        # near side, and if the next one along reaches back over it the room has
        # a way round the door that costs one gate and no plate at all. Nothing
        # downstream would notice: the route past it is still a legal staircase,
        # and the fill walks it.
        skip = self.path[index + 2] if index + 2 < len(self.path) else None
        approach = (r, run[1], min(door) - 1) if d > 0 else (r, max(door) + 1, run[2])
        if skip is not None and overlap(approach, skip) > 0:
            return None

        # The three rows the moved foothold vacates are wiped, and so is the
        # shaft over the near side, so what is painted in them now is no reason
        # to turn a step down.
        wiped = {kr - 1, kr, kr + 1}

        def air(row, cols):
            return row in wiped or all(self.rows[row][c] in '.:' for c in cols)

        if not all(air(row, door) for row in range(r - DOOR_H, r)):
            return None
        if not (air(r - 1, far) and air(r - 2, far)):
            return None

        # A blade in a doorway is the same bargain a blade on a gate landing
        # was: two people funnelling through a two column gap one at a time
        # cannot dodge, so it is not a hazard, it is a wall with a rumour of a
        # way through.
        if not self._entity_free(r - DOOR_H, r, min(door) - 1, max(door) + 1):
            return None
        return run, up, door, near, far, approach

    def _hold_run(self, index, up, d):
        """The ledge at `index` stretched to the door, the far plate, and no more.

        It only ever grows away from the columns it is landed on, so the step
        from below stays exactly as `climb` proved it and every new column is on
        the far side of the door.

        And it stops the moment the step up on to `up` is legal, rather than
        running out under the whole of it. Floor past the far plate is floor for
        the hauler who got through to walk away down, and the rope does not let
        go at the far end: an inert partner is towed rather than left behind,
        with the crate riding the middle of the rope and propping the door open
        on the way past. Three columns is a corridor that stops where it stops
        being needed, and nobody is towed anywhere from it."""
        r, c0, c1 = self.path[index]
        if d > 0:
            return (r, c0, min(W - 3, max(c1, up[1] + MIN_OVERLAP - 1)))
        return (r, max(2, min(c0, up[2] - MIN_OVERLAP + 1)), c1)

    def _entity_free(self, r0, r1, c0, c1):
        """Is this box clear of every blade and press, over the whole stroke?

        An entity is placed at a column and a row and then given a distance to
        travel, so where one *is* is a span and not a point — and a tile of
        margin around it besides, because a blade threatens the cell next to the
        one it is in. Asking about the point is how a gate ended up with a saw
        parked on its landing."""
        for e in self.ents:
            ey1 = e['y'] + max(0, e.get('ay', 0)) + e.get('h', 1)
            ey0 = e['y'] - max(0, -e.get('ay', 0)) - 1
            ex1 = e['x'] + max(0, e.get('ax', 0)) + e.get('w', 1)
            ex0 = e['x'] - max(0, -e.get('ax', 0)) - 1
            if ey1 >= r0 and ey0 <= r1 and ex1 >= c0 and ex0 <= c1:
                return False
        return True

    def hold(self, index):
        """Put a door across the route that only two people get through.

        The leg up was the only co-operative act in the game, which is seven
        moments in a forty-five minute campaign, and every complaint about this
        game traced back to there being exactly one of them. This is the second,
        and it is deliberately a different *shape*: a leg up is vertical and
        instantaneous, a hold is horizontal and it makes you wait for each other.

        A shutter with one plate is a wall, because whoever holds it can never
        be the one who goes through. So a hold lays two, one on each side, and
        the pair leapfrog: you hold, they cross, they hold, you cross. Two
        co-operative acts in a row, and neither of them can be faked by one
        player with a passenger — a partner who presses nothing can be dragged
        on to the near plate and never on to the far one.
        `packages/core/test/hold.test.ts` is where all of that is proved.

        The crate is not a way out of the second half of it. It hangs off the
        middle of the rope, so it goes where the pair go and cannot be parked on
        a plate and left; what it does buy is the *first* crossing, which is why
        the near plate is wide enough for it to sit on.

        Called last, for the same reason `gate` is: it rewrites `self.path`.
        """
        # Which step can carry a door depends on where the serpentine happens to
        # be when it gets there, so the index is a preference rather than an
        # instruction, exactly as it is for a gate.
        for candidate in sorted(range(1, len(self.path) - 2), key=lambda i: abs(i - index)):
            plan = self._hold_columns(candidate)
            if plan is not None:
                index = candidate
                break
        else:
            self.skipped.append(f'hold near path[{index}]')
            return self
        run, up, door, near, far, approach = plan
        r, run_c0, run_c1 = run
        kr, up_c0, up_c1 = up

        # The foothold above moves out past the door, and whatever was hanging
        # off it goes with it — the same trade `gate` makes when it takes one
        # out. A spike left behind belongs to a ledge that is no longer there.
        for row in (kr - 1, kr, kr + 1):
            for c in range(2, W - 2):
                self.rows[row][c] = '.'

        # ...and the shaft on the near side of the door is emptied too.
        #
        # The foothold that used to sit three rows over the near side has gone
        # out past the door, so what is left there is six clear rows, and
        # anything standing in them is a staircase around the door: a stub of
        # scenery halfway up is one jump and then another, which one hauler can
        # do alone. Decoration is placed by eye and the door is placed by rule,
        # and the rule wins.
        for row in range(r - DOOR_H, r):
            for c in range(approach[1], approach[2] + 1):
                self.rows[row][c] = '.'

        self.put(kr, up_c0, '=' * (up_c1 - up_c0 + 1))
        self._protect(kr, up_c0, up_c1)
        self.path[index + 1] = up

        # Only the columns the ledge did not already have, so a chunk that
        # restyled it keeps its ice and its conveyors.
        _, c0, c1 = self.path[index]
        for c in range(run_c0, run_c1 + 1):
            if not c0 <= c <= c1:
                self.rows[r][c] = '='
        self._protect(r, run_c0, run_c1)
        self.path[index] = run

        for c in door:
            for row in range(r - DOOR_H, r):
                self.rows[row][c] = 'H'
        for c in near + far:
            self.rows[r][c] = '_'
        self.holds += 1
        if 'hold' not in self.tags:
            self.tags.append('hold')
        return self

    def sweep(self, index, period=200, phase=0, reach=None, side=1):
        """A blade that crosses the route, by rule rather than by eye.

        The tower's spikes have to keep clear of every column the climb is
        proved through, and once footholds overlap generously that is most of a
        foothold — so a static hazard on the route is either somewhere nobody
        goes or a tile you can land on by accident, and the second one is not
        difficulty, it is a coin flip. Three spikes a single column from a route
        cell accounted for 360 of the 366 deaths in a twenty-minute run.

        A blade is the honest way to put danger where the climb actually is,
        because it is avoidable in *time* instead of in space: the footing stays
        exactly where the gate proved it, and what you have to do is wait. Two
        people on a rope having to wait for the same gap, one of them holding
        the other back, is the game.

        It sweeps the width of the foothold at head height, so it threatens the
        pair standing on it and the crate hanging under the one above.
        """
        r, c0, c1 = self.path[index]
        span = c1 - c0 + 1
        # Half the ledge, never all of it.
        #
        # A blade that sweeps the whole foothold has no answer: there is nowhere
        # to stand while it goes past, so waiting is death and jumping is a
        # coin flip, and the pair is simply chewed up — measured at 470 to 576
        # deaths across a forty-five minute run, against 22 to 109 before the
        # blades existed. Half a ledge is the entire mechanic: the far side is a
        # refuge, the near side is a timing problem, and two people on one rope
        # have to crowd onto the same half and then go together.
        # ...and the refuge has to hold two people and a crate.
        #
        # Half a ledge sounds like enough and on a ten-column foothold it is
        # four columns, which is not: two haulers stand about a column each,
        # the rope between them wants a third, and the crate swings under
        # whichever of them moved last. Measured on the campaign at rows
        # 337-344, where a blade left exactly that — 73 deaths and 70 respawns
        # in 522 seconds, a death every seven seconds, and the pair made no
        # upward progress at all for nearly nine minutes.
        #
        # A blade that cannot leave a standable refuge is not placed. A foothold
        # with no room for one is a foothold whose danger has to be static, and
        # the caller is told rather than left to find out from a playtest.
        travel = reach if reach is not None else max(3, (span - 2) // 2)
        travel = min(travel, span - 1 - MIN_REFUGE_COLUMNS)
        if travel < 3:
            self.skipped.append(f'sweep path[{index}] row {r}: no room for a refuge')
            return self
        start = c0 + 1 if side > 0 else c1 - 1 - travel
        self.ents.append(dict(type='saw', x=start, y=r - 1, r=1,
                              ax=travel, ay=0, period=period, phase=phase))
        return self

    def crusher(self, index, drop=4, period=170, phase=0, side=1):
        """A press that slams down onto one end of a route foothold.

        Same bargain as `sweep`: the footing is untouched and the timing is the
        obstacle. Parked at an end rather than the middle so the ledge is never
        cut in two even at the bottom of the stroke."""
        r, c0, c1 = self.path[index]
        x = c1 - 4 if side > 0 else c0 + 1
        self.ents.append(dict(type='crusher', x=x, y=r - 1 - drop, w=4, h=3,
                              ax=0, ay=drop, period=period, phase=phase, smooth=1))
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
    # Every character the level parser knows. A chunk that paints anything else
    # compiles to TypeScript perfectly happily and then throws at runtime, on
    # the first tower unlucky enough to draw it — `deco` takes a string and
    # writes it through, so one typo in a decoration is a crash nobody sees
    # until a player finds the room.
    GLYPHS = set('.#=^v<>~*oxicCW!F:S_H')

    def check(self, is_start=False, is_goal=False):
        for i, r in enumerate(self.rows):
            assert len(r) == W, f'{self.id}: row {i} is {len(r)} wide'
            bad = set(r) - self.GLYPHS
            assert not bad, f'{self.id}: row {i} paints {sorted(bad)}, which the level parser has no tile for'

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

        # Consecutive footholds must be within one jump of each other — or,
        # where the route is deliberately gated, within one reel.
        for i, ((r0, a0, a1), (r1, b0, b1)) in enumerate(zip(self.path, self.path[1:])):
            up = r0 - r1
            if i + 1 in self.gates:
                assert V_STEP < up <= REEL_CLIMB, (
                    f'{self.id}: a {up} row gate at rows {r0}->{r1} is either '
                    f'jumpable alone or past what a reel can do')
                continue
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
            if i in self.gates:
                continue
            r = self.path[i][0]
            for c in self.band(i, self.BODY_MARGIN):
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

        # A shutter with a plate on only one side of it is a wall.
        #
        # Whoever holds a lone plate can never be the one who goes through, so
        # the room is impassable — and impassable in a way none of the checks
        # above notice, because every one of them is about the staircase and the
        # staircase is fine. Two plates with the door between them is the
        # leapfrog, and it is the only arrangement that is a room.
        doors = [c for row in self.rows for c, ch in enumerate(row) if ch == 'H']
        plates = [c for row in self.rows for c, ch in enumerate(row) if ch == '_']
        if doors:
            assert any(c < min(doors) for c in plates), (
                f'{self.id}: the shutter at column {min(doors)} has no plate on the near side')
            assert any(c > max(doors) for c in plates), (
                f'{self.id}: the shutter at column {max(doors)} has no plate on the far side')
            # ...and one door per room, because a room is one hold group: a
            # second shutter anywhere in the chunk is opened by the first one's
            # plates and closed by them, so neither of them is a door.
            assert max(doors) - min(doors) + 1 == len(set(doors)), (
                f'{self.id}: shutters at columns {sorted(set(doors))} share the '
                f"room's only hold group")

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
        # How many two-person moments this room was *authored* with, carried
        # into the level data so the build can check the route-finder against
        # the design rather than against a number somebody typed in a test.
        # A fill that helps itself to a leg up where there is an ordinary way
        # on shows up here as more gates found than gates painted.
        counts = ''
        if self.gates:
            counts += f"    gates: {len(self.gates)},\n"
        if self.holds:
            counts += f"    holds: {self.holds},\n"
        return (f"  {{\n    id: '{self.id}',\n    biome: {self.biome},\n    difficulty: {self.diff},\n"
                f"{tags}{counts}    rows: [\n      {rows},\n    ],\n{ents}  }}")

