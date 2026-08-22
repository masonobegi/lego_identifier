# Where this is up to

Working note, not documentation. Branch `claude/multiplayer-steam-game-z0za7y`, everything
below is committed and pushed unless it says otherwise.

## The goal

A scoring panel of three independent judges put the game at **5.0/10** ("would I spend three
months on this: ONLY IF", unanimously). The target is **8/10 on the same rubric**, which is
not negotiable down — the rubric ties 8 to "would break out" and the score has to be earned.

All three judges failed the same gate — *"at least a week of reasons to come back"* — and all
three traced every other weakness to one root cause: **the leg up was the only mandatory
two-player move**, about seven moments in a forty-five minute campaign, roughly 2% of the
climb.

## What has been done since that verdict

- **A second co-op verb, the hold.** A floor plate holds a shutter open only while something
  stands on it; a plate on each side so the pair leapfrog through. Wired through the
  reachability fill, the build gate, eight rooms, the drawing, two sound cues, the controls
  screen and the Autohauler.
- Three exploits the tests found before the design did: the crate can never be parked on a
  plate (it hangs off the rope's middle and follows you); a shutter that waits for anyone
  inside it lets one player drag a motionless partner straight through, so it **ejects**
  instead; and **dying was a key to every door** — the revival rule was about height, so a
  horizontal door never triggered it.
- **The Gauntlet escalates** instead of reshuffling: named floor conditions (NO CHECKPOINT,
  CROSSWIND, CRACKED CRATE) arriving as the tower gets taller. Level data only — no sim
  change, no state, nothing on the wire — and forty seeded towers are checked to prove no
  condition can make a room unclimbable.
- **A fortnight of dailies** rather than one day, with a strip told apart in ink rather than
  hue, a paste-able docket measured to sixty columns where nothing on it is unverifiable by
  the person receiving it, and the crew you last hauled with on the title screen.
- **The run names its own worst moment** — ranked in metres across a destroyed crate, a
  betrayal and a fatal fall — on the results card, in the red used for damage.
- **Sixteen achievement pictograms** replacing two-letter monograms (two of which were
  identical), after five rounds of rendering and looking; and real layouts for three Steam
  assets that were one picture stretched three ways.
- Earlier in the same push: the solo grip-jump exploit that let **one player clear every
  gate**; the ring-buffer bug that made **every online match fast-forward into garbage after
  34 seconds**; the campaign no longer being the entire chunk library.

## In flight when this was written

Three background workflows. Each owns a disjoint set of files; do not edit their files while
they run.

| lane | run id | owns |
|---|---|---|
| co-op density | `wf_05173c55-2d4` | `tools/chunklib.py`, `tools/gen_chunks.py`, `packages/core/src/chunks.ts` |
| jank: what you see | `wf_12c5e145-e4c` | `packages/client/src/**`, `packages/client/test/**` |
| jank: what is proved | `wf_12c5e145-e4c` | `packages/core/src/**` except `chunks.ts`, `packages/core/test/**`, `scripts/verify-levels.mjs`, `scripts/e2e.mjs` |

Journals live under
`/root/.claude/projects/-home-user-lego-identifier/<session>/subagents/workflows/<run id>/journal.jsonl`;
one `{"type":"result"}` line per finished agent.

**Density** is the important one. The measured baseline it has to move, printed by
`npm run playtest` under `CO-OP`:

```
campaign       11 moments (7 leg-ups, 4 doors) in 384 steps — one every 34.9 steps
gauntlet 33     1 moments (1 leg-ups, 0 doors) in 127 steps — one every 127.0 steps
gauntlet 101    2 moments (1 leg-ups, 1 doors) in 146 steps — one every 73.0 steps
```

Target is roughly one every five to eight steps. It is slow because `npm run verify:levels`
replays every gate and hold room in the real simulation and then attacks each with a solo
search, and more co-op moments means a longer gate.

## What is left

1. **Land the three lanes**, review each report, then run the whole pipeline:
   `npx tsc -b packages/core packages/server packages/client` · `npx vitest run` ·
   `npm run verify:levels` · `npm run verify:server` · `npm run build && npm run web` ·
   `npm run e2e` · `npm run shots` · `npm run desktop:payload && npm run desktop:verify`.
2. **Update `docs/STORE-PAGE.md`.** It claims "There is one of these on every floor", which
   is what the density lane is making true. It also does not yet mention the hold, the floor
   conditions or the daily strip.
3. **Re-audit.** The brief is written and ready at
   `<scratchpad>/audit3/reaudit3.js` — same six lenses and the same rubric as the 5.0 run, so
   the number is directly comparable. Launch with the Workflow tool by `scriptPath`.
4. **Deliver the verdict**, and iterate again if it is below 8.

## Ideas not started

- **A photograph of the worst moment.** The client already knows the tick; snapshotting a
  downscaled frame at that instant and printing it on the results card as a polaroid with the
  caption would be the most shareable thing in the game. Client-side, blocked only by the jank
  lane owning those files.
- **A third verb, the lift**: a plate that raises a platform, chaining into the rope verbs —
  you hold, they ride up, they brace, you reel. Deferred because mover positions are pure
  functions of the tick and would need threading through `world`, which is invasive to do
  while other lanes are in the same files. Task #36.

## Things worth not forgetting

- `world.open` (which shutters stand open) is **derived, not remembered** — recomputed at the
  top of every tick before anything moves, deliberately absent from the snapshot and from
  `WORLD_KEYS`. Do not add it.
- Any new numeric world/cargo/player field **must** go in `WORLD_KEYS` / `CARGO_KEYS` /
  `PLAYER_KEYS` in `state.ts`, or online play desyncs silently. There is a test for this.
- Bump `SIM_VERSION` on any simulation change.
- No transcendental maths in the simulation modules — `Math.hypot` cost a test once. There is
  a test for that too.
- `npm run e2e` and `npm run shots` refuse to run against a build older than the sources; that
  guard exists because both had silently reported on stale builds.
