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

**Couch co-op** — either mode with both players on one screen. No server involved, which
also means it works as a demo, a review build, and an offline fallback.

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
