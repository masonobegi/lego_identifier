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

## Level design rules

These were not obvious, and getting them wrong produced a tower that looked completely
reasonable and could not be climbed past the fifth platform. They are now enforced by
`tools/gen_chunks.py` at authoring time and re-derived from the built level data by
`scripts/verify-levels.mjs` on every build.

**Footholds sit exactly three rows apart.** A tile is 24px and a player is 32px tall, so a
two-row step leaves a single tile of clearance — less than the player. They clip the
underside of the platform they are jumping to and the route silently dies.

**Consecutive footholds are never vertically aligned.** You cannot rise through a
platform, so to climb onto one you must first be standing clear of it. The lower foothold
has to stick out past the upper one's edge, within two columns of it.

**The route is never made of something you cannot stand on.** Bounce pads throw you
straight back off; crumbling crates are gone a third of a second after you touch them.
Both appear all over the levels, but never as the only thing holding the route up.

**Decoration can never touch the route.** Hazards are placed by eye and the route is
placed by rule, so the painter refuses to write into a foothold or the two rows of
headroom above it. A single stray ceiling spike in the wrong place is otherwise enough to
seal a chunk.

**Every chunk carries the same two landing platforms**, one at row 1 and one at row h-2,
offset from each other horizontally. Stacked, they land three rows apart with clear rows
between, so any chunk can follow any other — which is what makes the seeded endless tower
possible without a generator that can produce impossible geometry.

The movement envelope those rules encode is measured, not guessed:
`scripts/calibrate-jump.mjs` runs the real simulation and reports how far a jump reaches
for each rise. Authoring then allows one column less than the measurement.

Each chunk carries a checkpoint two rows below its top edge, directly in the path, so
progress banks automatically without asking players to detour. Difficulty is a number on
each chunk, and the endless tower ramps from 0 to 3 across the run while refusing to place
the same chunk twice in a row.

## Modes

**The Long Haul** — twenty authored chunks across four biomes: a builder's yard, a
foundry, a freezer, and a spire that combines everything. Around 650 tiles of climb, with
a checkpoint at the top of every chunk.

**The Gauntlet** — a seeded tower of 3 to 30 floors drawn from the same chunk library. The
seed is shared, so both players build the same tower from the same twelve bytes.

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
