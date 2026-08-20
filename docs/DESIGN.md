# Design notes

## The pitch

Two people. One rope. One crate. A tower.

It is a co-op climbing game where the co-op is not optional and not always voluntary. Your
partner is a physics object attached to you, and so are you to them.

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

**Reel** pulls you along the rope toward your partner. It makes a braced partner into a
ladder, and it is the tool for recovering someone who has fallen past you.

**Emote** exists because "sorry" and "that was your fault" need to be sayable without a
microphone.

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

## Level design rules

Chunks are 40 tiles wide with permanent side walls, and the top and bottom three rows of
every chunk are clear across the full interior. That invariant means any chunk stacks on
any other and stays climbable, which is what makes the seeded endless tower possible
without a generator that can produce impossible geometry. The build fails if an authored
chunk breaks it.

Each chunk carries a checkpoint two rows below its top edge, directly in the path, so
progress banks automatically without asking players to detour.

Difficulty is a number on each chunk, and the endless tower ramps from 0 to 3 across the
run while refusing to place the same chunk twice in a row.

## Modes

**The Long Haul** — twenty authored chunks across four biomes: a builder's yard, a
foundry, a freezer, and a spire that combines everything. Roughly 14,000 pixels of climb.

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
