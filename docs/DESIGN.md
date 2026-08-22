# Design notes

## The pitch

Two people. One rope. One crate. A tower.

The rope is the game. Not as a tether — as a **mechanism**. Its length is measured along
the path it physically takes, so it wraps, hooks and pulleys against the level geometry,
and your partner's weight and movement become forces you can use. A co-op climbing game
where the co-op is mechanical rather than thematic.

## Why this design

The genre this sits in — the co-op game a pair of friends buys for the price of a coffee
and plays for one hilarious evening — lives or dies on a single question: **is failure
funny?** Not "is it fair", not "is it deep". Funny.

Failure is funny when it is *caused by someone*, *visibly*, and *instantly*. So the design
puts a physical link between the two players and hangs everything off it:

- You cannot fail alone. The rope means every mistake is at least partly theirs.
- You cannot succeed alone either. The best routes require one player to anchor.
- The failure is always legible. You can see the rope go taut, see it turn red, and see
  exactly who ran off the ledge first.

The crate is the escalation. It is heavy, it dangles from the middle of the rope, it takes
damage from impacts, and losing it costs a checkpoint. It converts "we are climbing" into
"we are climbing *and carrying something*", which is the difference between a platformer
and a comedy.

## The four verbs

**Move and jump** are deliberately generous — coyote time, jump buffering, variable
height, momentum preserved through a rope yank. The game should never feel like it is
fighting you. The rope provides all the difficulty required.

**Grip** is the co-op verb. Holding it pins you in place on any ground or wall. Suddenly
you are a fixed point, and your partner is on a pendulum. It costs stamina on bare rock but
nothing on yellow rebar, which is how level design controls where anchoring is allowed.

**Reel** hauls you along the rope toward your partner. It has to beat gravity or the verb
is a lie — it shipped at 1450 px/s² against gravity of 2000, which meant a player hauling
straight up climbed a sixth of a tile in five seconds while every menu told them the
fastest way up was the other person. It is now 3100 and costs grip stamina, so a braced
partner really is a ladder and climbing one is a resource decision.

**Emote** exists because "sorry" and "that was your fault" need to be sayable without a
microphone.

## The two moves that need two people

Everything above can be done alone with a passenger. These cannot, and the game is
named after them.

**The leg up.** A hauler braced on solid ground is a platform. Jumping off one multiplies
your jump by 1.5 — 4.5 tiles becomes about 7.7 — and costs the brace a fifth of their grip
bar, so it is a resource rather than a free verb. It is the only move in the game that
gains height nobody could gain alone, and the levels are cut against it: a gate is the
middle foothold of three simply removed, leaving six clear rows, which is one row past the
highest shelf any single player can reach.

**The hold.** A floor plate holds a shutter open only while something is standing on it.
A shutter always has a plate on each side, because with one the holder can never get
through themselves and the room is a wall with extra steps. With two, the pair leapfrog:
you hold, they cross, they hold, you cross.

What makes the hold a two-person problem rather than an errand is the rope. It is a fixed
232 pixels, a shade under ten tiles, so a plate further than that from the far side of its
shutter is somewhere one player cannot be while also being through the door. Below that
threshold one hauler walks to the plate, walks back through the door, and the room is
decoration; above it, somebody has to choose to stay. The test sweeps both sides of the
threshold rather than asserting it.

Two things fell out of building it that the design had assumed the other way round. The
crate hangs off the middle of the rope and therefore always follows the pair — it cannot be
parked on a plate and left, which killed the idea of crate-on-plate as the escape hatch for
a fumbled room. And a shutter must never close on somebody standing inside it, so anyone
inside holds it open regardless of the plate; a door that shuts on the person walking
through it is not a puzzle, it is a player embedded in a wall.

Neither of these is remembered between ticks. Which shutters stand open is recomputed at
the top of every tick from where everybody is, before anything moves, which keeps it out of
the rollback snapshot entirely: replaying a tick recomputes it, and both peers read the same
doors for the whole tick.

**Why a second one was needed at all.** With only the leg up, the co-operation in a
forty-five minute campaign was seven moments — about two per cent of the climb. Every other
weakness traced back to that one number: fifty-two authored rooms only yielded four to six
hours because there was one verb to build them out of, the difficulty walls were ordinary
platforming rather than problems two people solve, and there was no reason to open the game
on a fourth evening. The hold also brings a shape the tower had none of: every room in the
game was a vertical serpentine, and a door partway along a long run is horizontal and about
timing.

## The rope as a mechanism

The original design was a leash: the rope drew as a draping chain but its length limit was
measured along the straight line between the two players. It looked like it hooked over
beams and behaved as though it went through them. Everything distinctive about the game
came from fixing that.

The taut path is now computed by string-pulling over the rope's own nodes — walk forward,
and from each contact jump as far along the rope as still has clear line of sight. With
nothing in the way it collapses to the straight line, so ordinary play is unchanged. With
a beam in the way there is a bend, and each player is hauled along *their own end* of the
rope rather than toward their partner.

That one change produces the winch (a partner walking away from a lip hauls you up it),
makes wrapping the rope cost slack, and turns the level's architecture into rope hardware.

Two supporting decisions:

**Hauling goes through collision, not teleportation.** The correction used to move players
directly. Once the rope could pull sideways, that shoved the hauled player into the wall
they were being lifted up, where every subsequent pull just re-collided. Routing it
through the collider lets them slide up the face instead.

**Traction decides who moves.** Feet on solid ground resist a sideways or downward haul at
about a third strength; nothing resists a lift. That is what makes the standing player the
anchor and the hanging player the load, with no button involved — and it is what allows a
winch to work at all, since with equal resistance the pair simply deadlocks.

## Tuning decisions worth recording

**The rope spring is soft (3.2 px/s² per pixel of stretch).** It started ten times
stiffer, which felt physical and played terribly: the spring overpowered the runner's own
acceleration, so trying to drag a partner just bounced you backwards. Load transfer only
works when the puller can win.

**The hard length clamp cancels radial velocity, not tangential.** That single choice is
what turns a fall into a pendulum swing instead of a dead stop, and it is where most of
the game's best moments come from.

**A dead player is dead weight, not an anchor.** They keep full mobility in the rope
solver, so their partner can drag the corpse — badly, slowly, and while destroying the
crate on the ground. Death is a penalty measured in comedy, not in progress.

**Solo death does not reset the checkpoint.** You ragdoll on the rope for about a second
and pop back next to your partner. Only a double death or a destroyed crate costs a
checkpoint. Rolling back progress every time one person mistimes a jump would make an
already-punishing rope unbearable.

**Death hitboxes are inset five pixels.** Spikes are smaller than their tile. The rope
supplies the difficulty; the hazards should not add unfairness on top.

**The crate only cares about real falls.** It originally took damage from any impact above
340 px/s, which meant ordinary jumping chipped it away and destroyed it roughly every ten
seconds — a bug that reads as a broken game, not a tense one. The threshold is now 560
px/s, so a jump costs nothing and a twenty-tile fall costs half the crate, and it slowly
repairs itself after a stretch of careful handling.

**The crate is still the ceiling, and now we can measure it.** Building the bot turned a
vague feeling into a number: an unattended pair climbs about a quarter of the campaign and
then loses the crate at the same kind of place every time — the lip of a ledge wide enough
that the crate ends up hanging under it. Climbing shortens the rope, the rope yanks the
crate, and the crate goes into the underside of the ledge at around a thousand pixels per
second. Players route around this by walking the rope over the corner first, which is
exactly the taut-path mechanic doing its job; the open question is whether the tower should
teach that before it demands it. Recorded here rather than patched, because the honest fix
is level design, not another number in `constants.ts`.

## What the levels actually are

Worth stating plainly, because the chunk names do not: the campaign is two mirrored
switchbacks. Every chunk calls `climb()` with the same width and step, and the anchor
platform is forced to sit beside the top landing, so the only thing distinguishing one
chunk's route from another's is which way it zig-zags.

There was a `start=` argument that appeared to vary this, and every chunk passed a
different value. It was never read. Rewriting all twenty-one call sites to the same number
regenerated a byte-identical `chunks.ts`, which is how it was caught; the argument has
been deleted rather than left implying variety that was not there.

So the verification is honest about a narrower thing than it sounds like: the towers are
provably climbable, and what is provably climbable is the same hop, roughly two hundred
times. `width`, `step` and `direction` do work and are where real variety has to start,
alongside geometry that actually requires the rope.

## The rope does not work yet

This is the most important thing in this document, and it was found by trying to
build levels that require the rope and discovering none could be built.

Every rope verb was measured against the real simulation. All three fail:

| What the design claims | What the simulation does |
|---|---|
| A partner walking away from a corner winches you up it | **0.0 tiles of lift.** You are dragged sideways instead. |
| An anchored partner above you is a ladder | Reeling climbs 3.6 tiles of a 6-tile pit, then stalls under the lip. |
| Anchor and swing across a gap | The pendulum returns **seven rows lower** than it started. |

The causes are each specific, and none of them is a tuning number:

**The winch does nothing because sliding is cheaper than lifting.** The taut-path
constraint removes excess rope length, and it does not care *how*. A grounded
partner dragged toward the anchor shortens the path just as effectively as being
lifted, and the floor is the path of least resistance — so they slide until the
rope is slack again and everything stops. `GROUND_HAUL_RESISTANCE` was meant to
prevent exactly this, but it resists a sideways *pull*, not a sideways *slide*
produced by the length clamp.

**The swing dies because the rope is heavily damped.** `ROPE_DAMPING` is 0.86 per
tick and a crate hangs off the middle of it. That damping is what keeps the
verlet chain stable and the netcode well-behaved, and it also means a pendulum
loses nearly all of its energy in a single arc.

**Reeling cannot mantle.** It hauls you along the rope toward your partner, which
gets you to just under the lip they are standing on, and there is no verb that
gets you over it.

One fix is in: bracing on solid ground no longer drains stamina, so an anchor
lasts as long as it is needed rather than five seconds. That was necessary and
is not sufficient — the anchor now holds, and the partner still cannot climb.

> That rule has since been narrowed. Bracing with a *slack* rope is still free;
> bracing while your partner dangles on a taut one now bills you at 35% of the
> drain rate, which is about fourteen seconds on a full bar. Free-for-ever
> turned out to be its own failure: a mutual hold is a position two haulers can
> keep until the heat death of the universe, and they did. See *The crate was in
> the floor* below.

### What the fix turned out to be

**The winch was mostly a wrong expectation.** A rope hooked over a beam, with
your partner standing on a floor, *should* drag them across that floor — a real
rope does. The winch only lifts when there is nothing to slide on, and with the
partner hanging free it now measures 1.8 tiles of lift. What was genuinely
broken is that the length clamp applied one mobility scalar to the whole pull
vector, so a steeply upward pull freed the *horizontal* component too and the
hauler skidded sideways at full speed until they were under an overhang and
could not be lifted at all. Traction is now applied per axis: boots resist a
skid, nothing resists a lift.

**Reeling was one move short.** It hauled you along the rope to just under the
lip your partner stood on and abandoned you there — measured, 3.6 tiles of a
six-tile pit. It now climbs a wall while the rope pulls upward, and mantles over
the lip once there is clear air beside your head. Pits five, seven and ten tiles
deep all go from dead ends to two-person puzzles.

Two things were tried and reverted, and both are worth recording because they
sound right:

*Traction on the spring.* The soft spring was damped on the ground for the same
reason as the clamp. It stalled a bot pair permanently at eight tiles: the
spring's entire job is closing the distance between two people, and a damped one
means they drift apart and never come back.

*The spring following the taut path.* More faithful — a rope over a pulley does
pull you at the pulley — and it makes the game worse. With geometry between the
pair, and in this tower there almost always is, each is pulled at a corner
rather than at their partner and the rope stops being a tether. The pulley
belongs in the hard length clamp; the spring is a soft reminder that your friend
exists and should read as one.

### Why there is no such thing as a rope-locked door

A great deal of effort went into building geometry a lone player provably could
not pass, gated by a flood fill that models the rope climb (`analyseLevel` with
`coop: true`, and `scripts/verify-coop.mjs` to prove the crossing in the real
simulation). A pit thirteen tiles wide and six deep does register correctly:
solo unreachable, co-op reachable, eleven cells that only the rope opens.

Then it fails in play, for a reason worth writing down.

**Reeling pulls you toward your partner, and your partner is on the side you
came from.** A hauler who drops into a pit climbs back out the way they entered,
every time, because the anchor they are hauling against is behind them. To climb
the *far* wall somebody must already be standing on it — and with two players of
identical ability, whatever route gets the first one up there gets the second
one up too.

That generalises, and it is the honest conclusion: **two identical players and
static geometry cannot produce a co-operative lock.** Any route one can walk, so
can the other. A co-op requirement in this game can only come from one of two
places:

- **The tether.** They cannot be more than 9.7 tiles apart, so a route that
  demands separation is impossible for the pair even though it is trivial for
  one, and a route that demands one stand still while the other moves is
  mandatory. This is the real constraint and it is under-used.
- **Asymmetric state.** One of them holding something, standing somewhere, or
  having done something the other has not.

So the rope is not a key. It is a **rescue**: fall into a pit and your partner
hauls you out instead of the run resetting. That is a genuinely good mechanic,
it now works, and it is worth building levels around — but it belongs in the
column marked "recovers a mistake", not "opens a door", and the levels should
stop pretending otherwise.

**The rule the geometry now enforces is not "one of you must brace" but "do not
both go in".** A partner merely standing on the lip is enough to reel against;
gripping only makes them immovable. That is a better rule than the one that was
designed, and it was found by testing rather than chosen.

## The crate was in the floor

The game is named after hauling a crate up a tower. It had never hauled one.

`placeAtSpawn` put the crate twenty-two pixels below the rope's mid node. The
rope rests in a slack arc, so that node hangs about forty pixels below the
haulers — which in the campaign is two rows *into* the floor. Measured: the
crate spawned at row 649.5 with rows 648, 649 and 650 all solid.

A body inside geometry cannot be swept anywhere, because every direction is
blocked. So it never moved again, on any spawn, on any respawn, in any level.

| | before | after |
|---|---|---|
| Rows the crate climbed while the pair climbed 32 | **0** | 26 |
| Average rows the crate trailed the pair | 8.8 | 3.7 |
| Worst | 42.3 | 16.0 |
| Longest unbroken spell more than 12 rows behind | **80.7s of 90** | 5.0s |

Nothing caught it. It rendered perfectly well sitting in the rock; no test
asserted anything about where it was; and the two systems that could have
noticed were both looking somewhere else. That is the part worth keeping:

**The rope's length constraint measures hauler to hauler.** So a rope stretched
to seven times its maximum — 1727 pixels against a 232-pixel limit — reported a
comfortable 165, because `tautPathLength` string-pulls between the two players
and never sees the sag down to the crate. The crate was forty-six tiles below a
pair who had no way to find out.

**The completability gate had the same bug in its own fixture.** It placed the
crate at `cy + 16`, half sunk into the ledge, where it sat weightless for the
whole attempt. So the gate proving every tower climbable was proving it with a
crate that did not weigh anything.

**And the crate was not part of winning.** `checkGoal` asked only that both
haulers were touching the goal tile. A pair could sprint to the top, leave the
load three ledges down, and be congratulated. That is the deepest reason nothing
in the game ever made anybody care where the crate was: nothing in the game ever
required it.

### What else fell out of fixing it

Once the crate was a physical object with weight on the end of a rope, four
things that had been invisible became measurable.

**The crate had no terminal velocity.** Both haulers have had a fall cap since
the beginning; nothing ever bounded the load. Worse, the tether that keeps the
crate under the rope moves it by writing a position, in a Verlet integrator that
infers velocity from `x - px` — so a hundred-pixel correction when the rope goes
taut reads back as six thousand pixels a second on the following tick, and the
next surface it touches is charged for that. Measured: 5904 px/s, and 312 points
of impact damage against a hundred-point crate. It was not falling; it was being
thrown by its own leash.

The textbook fix — carry `px` along with the correction — makes the crate inert,
because that velocity transfer is exactly how a rope hauls something. Measured
with it in: the pair climbed five rows instead of forty-one and the crate broke
nine times in ninety seconds, bouncing on the spot. So the transfer stays and the
speed is bounded instead. No single impact can now exceed the whole bar, which
is the property worth protecting: losing the crate should always be an
accumulation the pair can see coming, never one frame of physics they had no way
to read.

**A crate pulled straight up jams under the ledge you just climbed.** The tether
pulls in a straight line toward the rope, and straight up is the wrong direction
when the thing above you is a twelve-wide platform. It was pinned for twenty
seconds, fifteen rows below a pair who could not have reached it. It now shuffles
sideways toward whichever side has headroom, the way a person would walk it out
from under a lip.

**Two haulers who are both being considerate deadlock.** Each correctly concludes
that the polite thing to do is stand still and wait for the other. Both are right.
The pair then sits there — measured at four minutes with no progress, no deaths
and no reset, because the braced one was holding the dangling one up for free.
Nothing in either hauler's *position* distinguishes that from a rescue going well,
so it cannot be detected, only timed out. Patience is now bounded, holding weight
now costs stamina, and the bot's stuck-check watches route progress rather than
pixels moved — a bot alternating LEFT and RIGHT sixty times a second passes a
check on pixels with room to spare.

**Bracing is the *harder* thing a partner can do.** This one is genuinely
counterintuitive and it changed how the gate is read. A hauler jumping past a
braced partner clears one empty column at rise 1-3; one dragging an *idle*
partner clears two. The anchor pulls you back to it, and dead weight pays out
slack. So a gate that braces the partner — which the completability gate now does
— is proving the levels under the worse of the two realistic cases.

That number came out of `scripts/calibrate-jump.mjs`, which had been driving both
haulers off the same runway with the same inputs, each fighting the other for the
whole arc. Every authoring rule in `tools/gen_chunks.py` is derived from what
that script reports.

### The gate now asks what the game asks

The completability gate had three holes, and every one of them made it easier
than the game.

1. It returned on the **first** hauler to touch down — proving a step one of them
   can make while the other hangs off the rope below it.
2. It drove **both haulers with the same inputs**, which is not a situation any
   level puts a player in. They have separate controllers and they take turns.
3. It placed the crate **inside the floor**, as above.

Fixed, it said all thirteen levels were unclimbable. Two of those three failures
were the gate's fault. One was not:

**A seven-wide foothold sitting one column across from the seven-wide foothold
three rows below it.** Column ten is clear of a target starting at column eleven
and within reach of its edge, so the authoring rule allowed it — and it is a
frame-perfect move: rise to the very top of the jump without drifting into the
shelf beside you, then step one column sideways onto a single tile of toehold. It
was in the campaign and in eleven of the thirteen towers. Requiring two launch
columns rather than one turns it back into a jump.

The gate's own remaining fault was that it could only test a **standing** jump.
Nobody plays a standing jump — you back off and take a run at it — and the chunk
seam is makeable only with a run-up. With one in the search space, all thirteen
pass: both haulers, taking turns, braced partner, real crate. That took the gate
from six minutes to eleven, which is a fair price for it meaning what it says.

## The second player was cargo with opinions

The most expensive thing this project got wrong was not a bug. Every gate was green, the
tower was climbable, the rope had physics, and the game was called *a two-player co-op
disaster about a rope*. It was not a two-player game.

`analyseLevel` can answer "could ONE player reach this cell", and it has a second mode
that adds what a pair can do. The difference between the two fills is exactly the set of
places you cannot go alone. On the finished campaign that set was **empty**: 2787 cells
solo, 2787 together. Not "small". Empty.

Measured directly rather than inferred, with a full input sweep against the real
simulation — every launch column, run-up, hold and reel it could try:

| | one hauler | with a partner braced |
| --- | --- | --- |
| widest chasm crossed | 6 tiles | 6 tiles |
| highest shelf reached | 5 rows | 5 rows |

The rope gave the pair *nothing*. And it could not have: **reeling drags you toward your
partner**, so it can never take you anywhere they could not already stand, and a taut rope
against an anchor is a leash whichever way you run. No arrangement of geometry gates two
identical players who share a rope, because whatever one of them can do, the other can do
by repeating it. The wall-climb the README described is a *rescue* — how you get somebody
out of a hole — not a way up a tower. It was removed from the fill for exactly that
reason, having spent a while inventing steps the verifier then could not replay.

What two people have that one does not is a second pair of hands to stand on. So the fix
was a verb, not a shape: **brace, and your partner goes up half again as high as they can
alone.** Measured on the same sweep — five rows solo, ten off a brace — and the levels are
cut to six-row gates, one per biome, which leaves a row of margin over what one player
manages and four under what two do.

That turns a gate into a set piece that uses both co-op verbs in order: one of you braces,
the other goes up off your shoulders, then braces on the lip while you haul yourself up
the rope. `scripts/verify-levels.mjs` replays exactly that sequence, both ways round, and
fails the build if a pair cannot do it. The campaign is now unfinishable alone — 783 cells
solo against 2739 together — which is the first time that sentence has been true.

Three things had to change to keep the rest of the game honest about it:

**The fill defers co-op edges.** A breadth-first fill takes the shortest path in edges and
a boost skips a whole foothold, so the moment boosting became an edge the route used one
wherever it could: 98 of the campaign's steps came back as two-person moves when four had
been authored. Ordinary climbing now runs to exhaustion first, and the co-op moves are
cashed in only when nothing else is left — which makes the fill answer the question the
levels are asking rather than the question of what a pair could theoretically do.

**The bot plans off the pair's route.** `planRoute` used the solo fill, which stops
reaching the goal the moment there is a gate, so the Autohauler was handed a route that
ended a few ledges up and walked off the bottom of it with its cursor stuck at zero.

**Gates are painted.** A missing foothold looks exactly like a level that has run out, and
the move that clears it is the one move a pair cannot stumble into, because it needs both
of them standing still in the right place at once. So they carry a stencil, and the hint
that explains the move fires when somebody is standing under one rather than at fifteen
seconds next to nothing.

## What a death is worth

Adding a co-op verb is only half of making a game need two people. The other half is
making sure nothing cheaper already does the job — and something did.

Respawn put the dead hauler next to their partner, unconditionally. Measured against the
built core: with one player moved eight tiles up, killing the other returned them 8.48
tiles higher on the next eligible tick, crate at full health, checkpoint unchanged,
nothing debited. Set that beside what the game actually asks for:

| | speed | cost | how far |
| --- | --- | --- | --- |
| Reel along the rope | 430 px/s | grip | one rope length, 232px |
| Boost off a brace | one jump | a fifth of the brace's bar | six rows |
| Walk into a spike | instant | nothing | wherever your partner has got |

So the optimal play at a gate was for one hauler to go up and the other to die. Faster than
the reel, free, unlimited, and it would have taken a pair about an hour to find. Every gate
in the tower would have become scenery.

The rule is now: **a rescue, not a lift.** If your partner is more than a jump above where
you died, you go back to the checkpoint; level with them or below, you still come back
beside them. That keeps the forgiving thing (falling into a pit is your partner's problem
to solve, not a run-ender) and removes the exploit, without adding a punishment that would
have started a death spiral — a per-death crate debit was the obvious alternative and, at
the twenty to thirty deaths a sloppy pair racks up in three minutes, would have destroyed
the crate faster than the spikes do.

The general lesson, which cost a day: when you add a verb to make something required, go
and look for what was already doing it for free. The reachability fill cannot see this
class of bug at all, because respawning is not an edge in the graph.

## What the rope is actually doing

Worth measuring, because "the rope is the game" is the sort of claim that is easy to make
and easy to be wrong about. Over three minutes of the campaign, climbed by two policies
that follow the same route a beat apart:

| Rope length | Two haulers in step | One hauler lagging |
| --- | --- | --- |
| Under its 118px rest length (slack) | 93% of ticks | 29% |
| Past 90% of its 232px limit | 0.8% | 24% |
| Yanks hard enough to fire a sound | once | constantly |

That is the design working rather than the rope being decoration: a pair who stay level
with each other never feel it, and a pair who do not feel it all the time. The same
asymmetry shows up in the crate — the reckless policy that climbs together loses half a
crate in three minutes, and the cautious policy that takes turns loses four, because
taking turns leaves the load hanging low where the spikes are.

Nothing in the game says any of this out loud. It is taught by the rope.

## How much game there is

Counted from the built data rather than remembered, because the two drift:

| | |
| --- | --- |
| Hand-authored chunks | 60, across four biomes; 24 of them held back from the campaign |
| The Long Haul | 36 rooms, 1179 rows — a kilometre of tower — with a checkpoint in every one |
| Two-person moments on the campaign route | 71 — 62 leg-ups and 9 doorways — one every 4.6 climbing steps, and at least one in every seeded tower |
| Steps with something lethal on them | 70 of 329 |
| Blades and presses on the campaign | 27 saws, 13 movers |
| Achievements | 16, unlocking 9 hats |
| The Gauntlet | any height from the same 60-chunk pool, on a shared seed, with named conditions on the floors as it gets taller |
| The Daily Haul | one procedurally assembled tower per calendar day, and a fortnight of them remembered |

The Gauntlet and the campaign draw on the same pool, so a chunk written for one
lengthens both — which is the only reason the content budget is affordable at
all. `npm run playtest` measures what that means in minutes: a sloppy pair
climbs about 180 rows in three, so the campaign is a couple of evenings and the
Gauntlet is as long as you set it.

## Level design rules

These were not obvious, and getting them wrong produced a tower that looked completely
reasonable and could not be climbed past the fifth platform. They are now enforced by
`tools/gen_chunks.py` at authoring time and re-derived from the built level data by
`scripts/verify-levels.mjs` on every build.

**Footholds sit exactly three rows apart.** Enough clearance for a 32px player between
24px tiles, and inside the measured jump envelope with room to spare.

**Consecutive footholds overlap by at least three columns.** This is the rule the tower
is built on, and it is the reverse of the rule it used to be built on.

Footholds used to be rock, and you cannot rise through rock, so to climb onto one you had
to be standing *clear* of it — which meant `climb()` placed every platform one column past
the one below, the maximum spread that is still legal. Every gate was green. The tower was
also unplayable, and nothing in the repo could tell the difference: `scripts/playtest.mjs`
measured 23.4% of plausible casual jump attempts landing, and five different two-player
policies each climbing between three and nine rows of 651 in three minutes, reaching none
of the twenty checkpoints.

Footholds are one-way platforms now — you pass up through them and land on them coming
down — so standing underneath one went from useless to being the easiest launch in the
game, a jump with no sideways component to get wrong. Overlapping them rather than
gapping them took the same measurement to 69.7% and the same policies to between 185 and
352 rows, reaching four to eight checkpoints. The geometry is the only thing that changed.

The corollary is that **a solid material may never cover the overlap band, plus a column
of margin either side**. A hauler is 20px wide in a 24px tile, so a body centred on the
last column of the band has a shoulder in the next one along, and if that column is solid
the jump is a head-butt. Ice and
conveyors are solid, and a solid tile three rows above you blocks your head, so painting
one across the columns a step is proved through does not make that step harder, it deletes
it. `restyle()` keeps the band as a one-way platform and gives the rest of the foothold
the material; `check()` re-derives it and fails the build if it ever stops being true.

**Hazards go on the route, not around it.** For a long time every hazard in the game was
painted through `deco()`, which by construction refuses to touch the route, so the tower
was 92.7% plain concrete and you could climb the entire campaign without passing within a
tile of anything that could hurt you.

Putting them back took three goes, and the first two are worth writing down.

*Spikes on a foothold* have to keep clear of every column the climb is proved through —
both the launch band for the step above and the landing band from the step below. The
first version allowed a hazard to eat into that as long as four columns survived, which
sounds generous and is not: the columns it ate were the ones next to the route. Three
spikes ended up one column from a route cell, and 360 of the 366 deaths in a twenty-minute
run were on those three tiles. The rule is now absolute, and once footholds overlap
generously there is often nowhere left for a static hazard at all — so the generator says
out loud which ones it could not place rather than dropping them silently.

*Blades* are the honest way to put danger where the climb is, because they are avoidable
in **time** rather than in space: the footing stays exactly where the gate proved it, and
what you have to do is wait. But a blade that sweeps a whole foothold has no answer —
waiting is death and jumping is a coin flip, measured at 470 to 576 deaths across a
forty-five-minute run. `sweep()` covers at most half a ledge, so the far side is always a
refuge, and two people on one rope have to crowd onto the same half and then go together.
Density matters as much as shape: at 28% of route ledges the tower was exhausting, and it
is tuned to 20%.

*Underhangs* hang over open air, never over the foothold below. Keeping clear of that
foothold's launch columns was the first rule and it was subtly wrong — it let an underhang
land in the middle of the platform below and cut it in two, turning an eleven-column ledge
into a two-column island. Air cannot be split. What they threaten is the crate, which
rides a rope's length under the pair, which is where the teeth belong in a game about
carrying something fragile.

*Conveyors* pick their direction from where they end up, not from the author. `restyle()`
paints a material on the columns the route does not need, which for a conveyor means the
outside of a foothold — so a right-pusher landed on a right-hand end and carried anybody
who stepped on it straight off. Now a belt outside the band on the left pushes right and
one on the right pushes left, so it always herds you back toward the columns you have to
launch from.

**Every chunk carries the same two landing platforms**, one at row 1 and one at row h-2,
overlapping each other by four columns. Stacked, they land three rows apart with clear
rows between, so any chunk can follow any other — which is what makes the seeded endless tower
possible without a generator that can produce impossible geometry.

The movement envelope those rules encode is measured, not guessed:
`scripts/calibrate-jump.mjs` runs the real simulation and reports how far a jump reaches
for each rise. Authoring then allows one column less than the measurement.

Each chunk carries a checkpoint two rows below its top edge, directly in the path, so
progress banks automatically without asking players to detour. Difficulty is a number on
each chunk, and the endless tower ramps from 0 to 3 across the run while refusing to place
the same chunk twice in a row.

## Modes

**The Long Haul** — the authored tower, across four biomes: a builder's yard, a foundry, a
freezer, and a spire that combines everything, with a checkpoint at the top of every
chunk. It is deliberately *not* the whole chunk library. It used to be — the two were
byte-identical in the same order — which meant finishing it once showed a player every
room in the game and left the other modes reshuffling floors they had already climbed.
Twenty of the sixty rooms are held back for them.

**The Gauntlet** — a seeded tower of 3 to 30 floors drawn from the same library. The seed
is shared, so both players build the same tower from the same twelve bytes.

Floors in it can be handed a named condition, which arrives as the tower gets taller and
never on the ground floor or the roof: **NO CHECKPOINT** adds nothing to the room but means
you cannot bank it, **CROSSWIND** blows through the empty shaft and reaches the crate as
well as the pair, and **CRACKED CRATE** starts the run's cargo already hurt — dealt once,
and never below the halfway mark, because a cracked crate on floor two is a run that was
over before it began.

This exists because "a different tower every time" was delivering a different *order*, and
sixty rooms dealt in a new sequence is sixty rooms however you cut it. All of it is level
data applied when the tower is assembled: no simulation change, no state, nothing over the
wire, and nothing that moves a foothold — a condition that could make a room unclimbable
would be a condition that shipped a tower nobody can finish, and forty seeded towers are
checked for exactly that.

**The daily haul** — one tower everybody gets, from the date. The profile keeps a fortnight
of them rather than only today, because the point of a daily is the row of evenings behind
it; day seven being day one with a different platform order and a personal-best clock is
not a reason to come back.

**Local play** — either mode with both haulers on one machine. No server involved, which
also means it works as a demo, a review build, and an offline fallback. The second hauler
is either a friend on the other half of the keyboard or the **Autohauler**, a bot that
follows the same verified route the build gate uses.

The bot exists for a specific commercial reason as well as a kind one. A co-op game that
cannot be tried alone is a co-op game most people bounce off before they ever find someone
to play it with: the store page asks them to arrange a friend before they know whether
they want to. A partner that waits, braces and reels turns "come back when you have a
friend" into "here is what it feels like". It is not meant to replace the friend — it
never argues, and arguing is most of the game — but it is meant to sell the idea of one.

Design notes are in the README under *The bot*; the implementation is
`packages/core/src/bot.ts`, and it shares its route analysis with `route.ts` so a bot can
never believe in a jump the level verifier would reject.

## Presentation

Everything is drawn in code. Characters are built from circles and rounded rectangles with
expressions that respond to state — wide eyes and an open mouth when falling fast,
squinting when gripping, crosses when dead. Squash and stretch reads velocity before any
number could. The rope shifts amber to red as it approaches breaking tension and shivers at
the limit, which is the game's most important piece of communication: *someone is about to
get launched*.

The soundtrack is generated live. Each biome owns a tempo, a scale and a chord loop, and a
sequencer improvises bass, arpeggio and percussion over a sixteen-step grid, with intensity
driven by how much danger the crate is in.

## What was deliberately left out

- **Competitive modes.** The game is about a shared fate; scoring one player against the
  other undermines it.
- **More than two players.** One rope, two ends. Three players is a different game.
- **Unlockable abilities.** The four verbs are the whole vocabulary. Depth comes from level
  design and from the other person, not from a skill tree.
