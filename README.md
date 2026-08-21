# HAULMATES

**A two-player co-op disaster about a rope, a crate, and the end of a friendship.**

Two haulers are tied together by a rope, with a fragile crate hanging off the middle of
it. Its length is measured along the path it actually takes, so hooking it over a beam
costs you slack. Wrap it round a pillar and your leash shortens. Run too far and you drag
your friend off a ledge.

**A pit deeper than a jump is a two-person problem.** Fall in and you are stuck; with
your partner up top you climb the rope, walk your feet up the wall, and mantle over the
lip. If you *both* go in, you are both stuck — a partner standing on the edge is what you
haul against.

> Both of those sentences were false until recently, and were measured false rather than
> noticed. See *The rope does not work yet* in [docs/DESIGN.md](docs/DESIGN.md) for what
> was broken, what the fix was, and the two plausible-sounding fixes that made it worse.

> So was a third one. The crate — the thing the game is named after hauling — spawned two
> rows *inside* the floor, on every spawn, in every level. A body inside geometry cannot be
> swept anywhere, so it never moved again: the pair could climb forty-four rows and leave
> it sitting at the spawn point, and the rope stretched to seven times its own length
> trying to drag it. Nothing failed, nothing went red, and it rendered perfectly well
> sitting in the rock. It is now on the ground, it weighs something, and a run does not
> finish until it is at the top with you. See *The crate was in the floor*.

> And a fourth, which was the biggest of them. The tower was provably climbable and
> nobody could climb it. Every gate in the repo answered "could a perfect player finish
> this", and the answer was yes; the question that decides whether anyone keeps playing is
> how often an *ordinary* attempt succeeds, and nothing here could ask it. Measured, once
> something could: 23.4% of plausible casual jump attempts landed, and five different
> two-player policies each climbed between three and nine rows of a 651-row tower in three
> minutes, reaching none of the twenty checkpoints. It is 70% and roughly 380 rows now, and
> the thing that changed is a single line in the level generator. See *Level design rules*.

Online play for two people, couch co-op for two on one screen, a bot partner for when
nobody is around, a hand-authored campaign, an endless seeded tower, and a daily haul —
one procedurally assembled tower per calendar day, the same one for everybody, gone at
midnight. Built to ship on Steam.

![Gameplay](docs/screenshots/gameplay.png)

---

## Quick start

```bash
npm install
npm run dev
```

Open <http://localhost:5173> in **two browser tabs**. In the first: *Play online → Host a
haul*. In the second: *Play online → Join with a code*, and type the five-letter code from
the first tab. Both press Ready.

To play on one screen instead, pick *Play on this machine* — no server needed. There you
choose your second hauler: **a friend** on the other half of the keyboard, or **a bot**.

### Playing alone

```bash
npm run web
```

That writes `dist/haulmates.html` — the entire game in one self-contained file, no server,
no install, no network. Open it in a browser, choose *Play on this machine → A bot →
Start*, and the Autohauler takes the other end of the rope. See [The bot](#the-bot).

## The four verbs

| Action | Default key | Gamepad | What it is for |
|---|---|---|---|
| Move / jump | `A` `D` / `SPACE` | Stick / `A` | Ordinary, generous platforming. |
| **Grip** | `L-SHIFT` | Right trigger | Lock yourself in place on ground or wall. You become an anchor your partner can swing from. Drains, except on yellow rebar. |
| **Reel** | `F` | Left trigger | Haul yourself along the rope toward your partner. It beats gravity, so an anchored partner above you is a ladder. Costs grip stamina. |
| Emote | `T` | `Y` | Apologise. Or don't. |

The fourth thing you can do isn't a button. Feet on solid ground resist a sideways pull
but nothing resists being lifted, so whoever is standing is the anchor and whoever is
hanging gets moved — which is why walking away from a ledge the rope runs over hauls your
partner up it.

Both players must hold `R` to reset to the last checkpoint.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Matchmaking server + hot-reloading client |
| `npm test` | 60+ unit and integration tests (simulation, netcode, protocol, levels) |
| `npm run e2e` | Drives two real browsers through a real match and screenshots it |
| `npm run web` | Bundles the whole game into one self-contained HTML file, then plays it |
| `npm run verify:server` | Starts the server the way a container does and plays a match against it |
| `npm run verify:docker` | Builds the image, runs it, plays a match against it (needs Docker) |
| `npm run build` | Builds core, server and web client |
| `npm run verify` | Everything above, plus the packaged desktop self-test |
| `npm run verify:levels` | Proves every tower can actually be climbed |
| `npm run playtest` | Measures how often ordinary attempts succeed, which is a different question |
| `npm run levels` | Re-generates the chunk library from `tools/gen_chunks.py` |
| `npm run calibrate` | Measures what a jump can reach, for the level design rules |
| `npm run art` | Regenerates all store art and installer icons |
| `npm run shots` | Re-photographs the game for the README and the store page |
| `npm run steam:config` | Regenerates the Steamworks achievement/stat/depot config |
| `npm run dist:win` / `dist:linux` / `dist:mac` | Builds the Steam-ready desktop app |

## The bot

The game needs two people, which is also the reason nobody can try it alone. The
**Autohauler** fixes that: pick *Play on this machine → A bot*.

It is not a neural network and it does not search the state space. It reads the same
flood fill that gates the build — `packages/core/src/route.ts`, the one `npm run
verify:levels` uses to prove a tower is climbable — and walks the route that analysis
hands back. Sharing that code is the point: a bot with its own idea of what a jump can
reach is a bot that disagrees with the level designer.

On top of the route it runs three rules about the rope, which are the co-operative half
of the game played back at you:

- **It waits.** The hauler in front stops when the rope goes tight or it gets more than
  three rows above you, rather than dragging you off a ledge. Its patience is bounded, and
  that bound is load-bearing: two haulers who are both being considerate deadlock, each
  correctly concluding that the polite thing is to stand still. Measured at four minutes of
  no progress, no deaths and no reset before the timeout was added.
- **It braces.** When you are climbing, it holds GRIP so the rope has a fixed end to
  pivot on.
- **It reels.** Stranded below you on a taut rope, it hauls itself up instead of waiting
  to be rescued. How often that happens is a fact about the level, not the bot: over two
  minutes each, the same bot reeled 107 times on two towers and twice on the other three.

The launch column is chosen by **flying the arc**: plain ballistics against the tile grid
with the body's real box, over every column on the ledge, because the route only names one
cell per ledge and that cell often has a ceiling nine pixels above the hauler's head.

It also has run-up machinery it rarely uses, which looked for a while like the single
biggest thing wrong with it and measurably is not — see below.

Left completely alone — two bots, nobody driving — a pair reaches about a sixth of the
campaign route in two and a half minutes, and then stops making progress. That figure used
to be explained by the crate giving out on a ledge lip; it is not that any more, because
the crate now shuffles out from under lips and breaks nought to two times in three minutes.
The real reason took three parallel attempts to find, and refuted the obvious one.

**It runs out of moments when taking off is legal at all.** Over the 7,309 ticks a stalled
campaign pair spent declining to jump, they were in a state where they could legally take
off on **10.5%** of them. The rope past its rest length accounted for 77%, holding the
leash 46%, the partner being airborne 44%. Those are the co-operative rules working exactly
as written — and two haulers running identical courtesy starve each other, because each
correctly defers and both are right. One of them now consistently yields, which is worth
about a point of route and cuts crate breaks by a third; the rest of that budget is still
spent.

Three candidate fixes for this were built in isolation and measured, and the one that won
the benchmark is not in the game. It scored by *abandoning the crate* — the longest spell
the load spent more than twelve rows behind the pair went from 5 seconds to 126, and the
crate-break count improved only because a crate that has been left behind stops taking
damage. That is the benchmark's fault rather than the candidate's: route progress plus
breakages can be maximised by leaving the thing you are supposed to be carrying. The
measurement now carries worst-abandonment alongside.

One thing it used to do badly and no longer does: it fidgeted while it waited, about
twenty-six direction changes a second as the rope tugged it in and out of its deadzone. Two
earlier attempts to fix that by widening the deadzone each halved how far the pair climbed.
Hysteresis fixed it properly — stopping still happens at the old threshold, so it lands on
its mark as precisely as before, and only *starting* is harder. Reversals went from 25.9 a
second to **0.5**, and the climb went *up*, from 32 rows to 44.

It still cannot use bounce pads or grip walls at all, because the route analysis it follows
deliberately ignores both as shortcuts.

It is a partner, not a speedrunner, and it will not save you from yourself.

## The rope

The rope is a verlet chain whose nodes cannot enter geometry, so it drapes over ledges and
catches on corners. The part that matters is that the **length limit is measured along
that path**, not along the straight line between the two players: a string-pulling pass
finds the taut route around whatever the rope is resting on, and each player is hauled
along *their own end* of it rather than toward their partner.

Three things fall out of that, none of them scripted:

- **The winch.** Rope over a lip, one player in the pit below, the other walks away from
  the lip: the one below goes up. Measured at about a tile of lift per tile walked.
- **Wrapping costs slack.** Going round a pillar spends rope, so your effective leash
  shrinks until you unwind it.
- **Traction decides who moves.** Standing on the ground resists a sideways haul; nothing
  resists a lift. Whoever has their feet down is the anchor, without pressing anything.

## How it is put together

```
packages/
  core/     Deterministic simulation, level format, wire protocol, netcode client
  server/   Authoritative matchmaking + tick server (Node, ws)
  client/   Renderer, procedural audio, menus, input (Vite, canvas)
  desktop/  Electron shell with Steamworks integration
tools/      Level authoring script
scripts/    Dev runner, packaging, art and config generation, end-to-end tests
steam/      Generated Steamworks configuration and store art
docs/       Design, netcode, launch checklist, store copy
```

**`core` is the contract.** It holds the entire simulation and nothing else — no DOM, no
Node APIs, no rendering. Both clients and the server run the identical `step()` function,
which is what makes rollback netcode possible. It never calls `Math.random`, `Math.sin`,
or any other function whose result is allowed to differ between platforms; there is a
test that enforces this by scanning the source.

**Nothing is loaded from disk at runtime.** Levels are ASCII art compiled into the bundle,
every sprite is drawn with canvas paths, and every sound — including the soundtrack — is
synthesised live in the Web Audio API. The whole game is a 44 KB gzipped download with no
asset licensing attached to it.

## Netcode in one paragraph

The server is authoritative and simulates the match at a fixed 60 Hz. Each client runs
*ahead* of the server by roughly half its round-trip time, predicting the partner's input
as "whatever they did last tick". When the server confirms what actually happened, any
tick where the prediction was wrong triggers a rollback: the last confirmed world is
copied forward and every tick since is replayed. The state is small enough (two players,
a fifteen-node rope, a crate, some crumbling blocks) that a worst-case rollback costs well
under a millisecond. The server also broadcasts a state checksum every second; a mismatch
pulls a full snapshot. See [docs/NETCODE.md](docs/NETCODE.md).

## Running a server

The game needs one server that both players connect to. It is a single Node process with
no database and no state worth backing up.

**This is the part that is easy to skip and expensive to get wrong.** With no server
configured, the client falls back to `ws://127.0.0.1:8787` — so a customer who installs
the game and presses *Play online* is pointed at a matchmaking server on their own machine
that nobody started. Deploy something, then bake its address into the build.

```bash
docker compose up --build          # server + web client on http://localhost:8787
```

or, on a managed host:

```bash
fly launch --no-deploy --copy-config && fly deploy      # fly.toml is in the repo
HAULMATES_SERVER=wss://<your-app>.fly.dev npm run dist:win
```

That second line is the one people forget. `scripts/package-desktop.mjs` writes it into
`packages/desktop/server.json`, which the shipped app reads on launch; the packaging step
prints a loud warning if you build a release without it. `HAULMATES_SERVER` in the
player's own environment still overrides it, so a self-hoster can redirect an installed
copy.

Without Docker:

```bash
npm run build
node packages/server/dist/cli.js                                 # ws://0.0.0.0:8787
node packages/server/dist/cli.js --static packages/client/dist   # also serves the web build
```

Environment variables: `PORT`, `HOST`, `HAULMATES_STATIC`, `HAULMATES_MAX_ROOMS`,
`HAULMATES_MAX_CONN_PER_IP`, `HAULMATES_ROOM_GRACE`, `HAULMATES_LOG`. `GET /health` and
`GET /stats` are available for monitoring; `/health` is what the container and the Fly
config wait on.

Anything public must be `wss://` — browsers refuse a plaintext socket from an `https://`
page. Every host in `fly.toml`'s comment terminates TLS for you.

A single small VM handles a few thousand concurrent rooms: each is two sockets and a 60 Hz
tick over about a kilobyte of state. Players can also point the game at their own server
from the Settings screen, and the desktop build can host one in-process — *Play online →
Host from this machine* runs the bundled server inside the game, which covers LAN play and
outages — though over the internet that means port forwarding, since it binds a plain
port with no relay and no UPnP.

`npm run verify:server` starts the server the way the container does — separate process,
configuration from the environment only — then waits on `/health`, plays a real two-player
match against it, checks the client is served from the same origin, and requires a clean
exit on `SIGTERM`. `npm run verify:docker` additionally builds and runs the image; it needs
a Docker daemon, so it is not part of `npm run verify`.

## Shipping to Steam

The full checklist is in [docs/STEAM-LAUNCH.md](docs/STEAM-LAUNCH.md). The short version:

1. Buy the App ID, then `HAULMATES_APP_ID=<id> npm run steam:config`.
2. Set the same ID in `packages/desktop/src/main.ts` (or the `HAULMATES_APP_ID` env var).
3. `npm run dist:win` and `npm run dist:linux`; copy the output into `steam/content/`.
4. Upload with `steamcmd +run_app_build steam/app_build.vdf`.
5. Enter the achievements from `steam/achievements.json` on the partner site.
6. Replace the placeholder capsules in `steam/store/` with real art before launch.

## What is verified, and how

Running `npm run verify` exercises, in order:

- **90 unit and integration tests** — simulation determinism over thousands of ticks,
  rollback convergence, snapshot round-tripping, physics invariants, protocol encoding,
  and full online matches against the real server under 25–130 ms latency, jitter, and a
  simulated connection freeze.
- **Proof that the towers can be climbed.** A flood fill over every foothold, using a
  movement envelope measured from the simulation, finds a route from the spawn to the
  goal; then every step of that route is re-attempted in the real simulation — both
  players, the rope, the crate, the moving hazards — by searching launch positions and
  input timings. This is the check that caught a campaign which was, for its first five
  chunks, genuinely impossible. Read it for what it is: each step is attempted from a
  fresh world with the pair replaced on the ledge, so it certifies two hundred-odd
  isolated hops and a flood fill, not one continuous run with an accumulating crate.
- **A deployment check.** `npm run verify:server` starts the server as a container would
  — separate process, configuration from the environment only, no command line flags —
  waits on `/health` like an orchestrator, plays a real two-player match against it,
  confirms the client is served from the same origin, and requires a clean exit on
  `SIGTERM`. The in-process tests cannot catch a broken entrypoint; this can.
- **A browser end-to-end run** — two real Chromium clients connect to a real server, host
  and join a room, play a match, and are checked for byte-identical simulation state.
  Screenshots land in `test-results/`.
- **A single-file web bundle that is actually opened.** `npm run web` inlines the whole
  game into one HTML file, then launches it from `file://` and plays a few seconds of a
  bot match, because a self-contained bundle that does not boot is worse than none — it
  looks finished.
- **A packaged desktop self-test** — the built Electron binary is launched headlessly and
  checked for a working renderer, preload bridge and save file.

What is **not** verified here, stated plainly:

- **Steamworks itself.** Achievement delivery, rich presence and the friend-invite flow
  need a Steam client and a real App ID. Every Steamworks call is wrapped and degrades to
  a no-op, and the game has been confirmed to run with Steam entirely absent — but "does
  not crash without Steam" is not "works with Steam". Test it first.
- **How it feels.** The automated checks prove the tower can be climbed and that both
  players see the same world. They cannot tell you whether the jump arc is satisfying or
  whether the third biome drags. Play it with someone before you price it.
- **Whether the bot is any fun.** Its progress is measured; its company is not. See
  *The bot* for what it demonstrably cannot do.
- **Audio output.** The synth is exercised by the tests and throws no errors, but nothing
  here listens to it.
- **The container image.** `Dockerfile`, `docker-compose.yml` and `fly.toml` are written
  and their contents check out, but they were authored on a machine with no Docker daemon,
  so the image has never been built. `npm run verify:docker` builds it, runs it, plays a
  match against it and checks it is not running as root — run that once before you publish
  an image, and treat the deployment as unproven until you have.

## Licence

All code and art in this repository is original. No third-party assets are bundled.
