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
  reachability fill, the build gate, the drawing, two sound cues, the controls screen and
  the Autohauler.
- **Co-op is the texture now, not a garnish.** The campaign carries **62 leg-ups and 9
  doorways in 329 climbing steps — one every 4.6** — against 11 moments in 384 steps when
  the judges scored it. A lone player's reachability fill gets **62 of 4146 footholds**;
  a pair gets all 4146.
- **The Gauntlet escalates** instead of reshuffling: named floor conditions (NO CHECKPOINT,
  CROSSWIND, CRACKED CRATE) arriving as the tower gets taller.
- **A fortnight of dailies**, a strip told apart in ink rather than hue, a paste-able
  docket, and the crew you last hauled with on the title screen.
- **The run names its own worst moment** on the results card — and now shows a
  **photograph of it**, taken at the instant it happened, pinned to the card as a print.
- Earlier in the same push: the solo grip-jump exploit that let one player clear every
  gate; the ring-buffer bug that made every online match fast-forward into garbage after
  34 seconds; the campaign no longer being the entire chunk library.

## What this session found and fixed

Three of these were silent content losses caused by the density push itself — the gates
were eating what the rooms were painted with:

1. **The rope was inside the floor for the whole run.** `placeAtSpawn` sagged it 41px, and
   `solveRope` has no rule for walking a node back out of rock. 11 of 15 nodes buried at
   tick 0 and still buried at tick 2400. Fixed at both ends; measured 0 of 15. SIM_VERSION 24.
2. **69 hazards were being deleted by the gates on top of them** — a gate wipes its gap and
   slides its landing sideways, and it took the spikes with the floor and orphaned the ones
   standing on the platform it moved (freeze_crumble shipped with two spikes hanging in
   mid-air five columns off the ledge). Seven campaign rooms had no danger anywhere. They
   are re-laid on a step that can hold them now: 70 of 329 steps have teeth, up from 48.
3. **40 saws and presses were being deleted the same way.** They slide sideways out of the
   landing band instead: the campaign has 27 saws and 13 movers, up from 8 and 5.
4. **19 of the 60 rooms had lost their checkpoint** to the same wipe.
5. **The route-finder is now held to the design.** Every room writes down how many leg-ups
   and shutters it was painted with; the campaign's fill has to come back with exactly
   those numbers (62 and 9). The old check was a ceiling of eight.
6. **The build gate runs on every core**, as (level, slice) pairs, and reports each level as
   its last slice lands. The solo search came out of the unit suite — three towers of it ran
   for over an hour inside vitest, single-threaded, in a runner that cannot interrupt a
   synchronous body.

## What is left

1. **Run the whole pipeline**: `npx tsc -b packages/core packages/server packages/client` ·
   `npx vitest run` · `npm run verify:levels` · `npm run verify:server` ·
   `npm run build && npm run web` · `npm run e2e` · `npm run shots` ·
   `npm run desktop:payload && npm run desktop:verify` · `npm run playtest`.
2. **`npm run shots`** — the screenshots are stale for the title, the HUD, the nameplates
   and every room in the tower.
3. **Re-audit.** The brief is written and ready at `<scratchpad>/audit3/reaudit3.js` — same
   six lenses and the same rubric as the 5.0 run, so the number is directly comparable.
   Launch with the Workflow tool by `scriptPath`.
4. **Deliver the verdict**, and iterate again if it is below 8.

## Watch out for

- **`npm run verify:levels` is slow** — the solo search is 7000 scripted attempts and 1500
  random ones per gate, in the real simulation, and there are 62 gates in the campaign
  alone. About 22 seconds a gate on this machine. It is the one claim the whole design
  rests on, so it has not been thinned; it has been spread across cores.
- **The Autohauler against 62 gates** has not been re-measured since the density went up.
  It crossed 77 of 92 in the last measurement, and the 15 it missed were the reel after the
  boost rather than the boost itself. Worth `npm run playtest`.
- `world.open` (which shutters stand open) is **derived, not remembered** — recomputed at
  the top of every tick, deliberately absent from the snapshot and from `WORLD_KEYS`.
- Any new numeric world/cargo/player field **must** go in `WORLD_KEYS` / `CARGO_KEYS` /
  `PLAYER_KEYS` in `state.ts`, or online play desyncs silently. There is a test for this.
- Bump `SIM_VERSION` on any simulation change.
- No transcendental maths in the simulation modules — `Math.hypot` cost a test once.
- `npm run e2e` and `npm run shots` refuse to run against a build older than the sources.
- **Never edit `packages/core/src/chunks.ts` by hand.** It is generated:
  `python3 tools/gen_chunks.py packages/core/src/chunks.ts`, and the generator fails the
  build if a hazard it was asked for has nowhere to go.

## Ideas not started

- **A third verb, the lift**: a plate that raises a platform, chaining into the rope verbs —
  you hold, they ride up, they brace, you reel. Deferred because mover positions are pure
  functions of the tick and would need threading through `world`. Task #36.
- **Gates with a different texture**: the launch ledge is always plain floor. Bracing on ice
  or on a conveyor while your partner jumps off you is the same verb and a different
  problem, and both tiles already exist.
