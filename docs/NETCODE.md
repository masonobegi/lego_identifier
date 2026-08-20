# Netcode

## The problem

Two players are joined by a physical constraint. Anything one player does can move the
other within the same tick — a rope going taut transfers momentum instantly. That rules
out the usual "everyone owns their own character and we interpolate the rest" approach:
there is no way to own half of a rope.

So both peers have to agree on the entire world, every tick, exactly.

## The shape of the solution

Deterministic lockstep with rollback, refereed by an authoritative server.

```
        ┌─────────┐   inputs    ┌──────────┐   inputs    ┌─────────┐
        │ client  │ ──────────► │  server  │ ◄────────── │ client  │
        │    A    │ ◄────────── │ (truth)  │ ──────────► │    B    │
        └─────────┘  confirmed  └──────────┘  confirmed  └─────────┘
                     input frames               input frames
```

The server simulates the match at a fixed 60 Hz. Every tick it takes both players' input
bytes, steps the world, and broadcasts the pair of inputs it actually used. Clients run
the same `step()` on the same state and get the same answer.

Level data never crosses the wire. Both peers derive the tower from `(mode, seed, length)`,
which arrives in the twelve-byte welcome message.

## Running ahead

If a client simulated the same tick as the server, its own input would always arrive too
late. So each client runs ahead by

```
lead = ceil(rtt / 2 / tickDuration) + 2
```

ticks, estimated from a ping every 500 ms that carries the server's current tick. The
extra two ticks absorb jitter. For the ticks it has run ahead into, the client does not
know what its partner did, so it predicts: **whatever they did last tick**. For held
inputs — which is most of them, most of the time — that prediction is right.

## Rollback

When the server's authoritative input frames arrive, the client folds them into a separate
*confirmed* world. If any of them differ from what was predicted, everything since is
wrong, so:

1. Copy the confirmed world over the display world.
2. Replay every tick since, using the player's own real inputs (always known) and a fresh
   prediction for the partner.

Presentation events generated during a replay are discarded, so a rollback never replays a
sound or a puff of dust.

This is only affordable because the state is tiny: two players, fifteen rope nodes, a
crate, and a bitfield of crumbling blocks — around a kilobyte. `copyWorldInto` reuses its
allocations, so a twelve-tick rollback is a memcpy and twelve `step()` calls.

## Determinism

Rollback works only if replaying a tick gives a bit-identical result, on every machine.

IEEE-754 guarantees `+ - * /` and `sqrt` are correctly rounded. It guarantees nothing
about `sin`, `cos`, `pow` or `atan2`, which genuinely differ between JavaScript engines
and CPU architectures. So the simulation never calls them:

- `dsin`/`dcos` in `core/math.ts` are polynomial approximations built from multiply, add
  and `abs` (max error ~1.1e-3, far below anything gameplay can express).
- Randomness is an integer xorshift32 seeded from the match seed.
- A unit test scans every simulation source file and fails the build if a banned function
  appears in executed code.

Moving parts of the level — platforms, crushers, saws — are pure functions of the tick
number rather than stored state, so they cost nothing to snapshot and cannot drift.

## Catching a desync anyway

Every 60 ticks the server broadcasts a 32-bit hash of its world. Each client hashes its
confirmed world at that tick and compares. On a mismatch the client requests a full
snapshot; the server sends a lossless dump of every simulated field, and both sides resume
from bit-identical state.

Snapshots are `Float64`, not `Float32`, on purpose. A lossy snapshot would leave the
server on the original values and the client on rounded ones — a resync that immediately
re-desyncs.

The snapshot, clone and hash routines are all driven from a single list of field names, so
adding a field to the simulation without adding it to the snapshot is a compile error.
That is the failure mode that produces desyncs which only appear after twenty minutes of
play.

## What is on the wire

| Message | Size | Rate |
|---|---|---|
| Client input run (16 ticks of redundancy) | ~24 B | 60/s |
| Server confirmed input frames | ~10 B | 30/s |
| Ping / pong | 17 / 25 B | 2/s |
| State checksum | 9 B | 1/s |
| Full snapshot | ~1.5 KB | on join and on desync |

About 2 KB/s per player. The transport is a WebSocket: reliable and ordered, which removes
reordering and loss from the problem entirely and leaves latency, which rollback already
handles.

## Failure handling

- **A player's input is late.** The server predicts it as "same as last tick", uses that,
  and broadcasts what it used. The client rolls back when it sees the correction.
- **A player disconnects.** The room pauses and holds the world for two minutes. Rejoining
  with the same code resumes from a snapshot.
- **A client stalls** (laptop lid, tab throttled). It falls behind, then catches up at up
  to ten ticks per frame; if the server has passed its local tick entirely, it snaps
  forward to the confirmed state.
- **A client is way ahead.** Frame pacing holds it at the target lead rather than letting
  it run away.

## Testing it

`packages/server/test/netcode.test.ts` runs complete matches through the real `Gateway`
and `Room` over a simulated link with configurable one-way latency, on a virtual clock —
fifteen seconds of gameplay in a few hundred milliseconds of test time. It asserts that
both clients' confirmed worlds hash identically, that rollbacks actually occur (a test
that never rolls back is not testing rollback), that their depth stays bounded, and that a
1.5 second total connection freeze recovers without a desync.

`scripts/e2e.mjs` then does it again for real: two Chromium instances, one Node server,
one match, checked for identical player positions to the last floating-point digit.
