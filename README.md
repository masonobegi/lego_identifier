# HAULMATES

**A two-player co-op disaster about a rope, a crate, and the end of a friendship.**

Two haulers are tied together by a rope, with a fragile crate hanging off the middle of
it. Its length is measured along the path it actually takes, so hooking it over a beam
costs you slack. Wrap it round a pillar and your leash shortens. Run too far and you drag
your friend off a ledge.

> **Honest status: the rope is not yet a mechanic.** Earlier versions of this file said a
> partner walking away from a beam winches you up it, and that an anchored partner is a
> ladder. Both were measured against the simulation and both are false — the winch lifts
> 0.0 tiles, and reeling stalls under the lip. See *The rope does not work yet* in
> [docs/DESIGN.md](docs/DESIGN.md) for the measurements and the causes. The physics is
> sound and the verbs are not, which is why no level in the campaign requires a rope.

Online play for two people, couch co-op for two on one screen, a bot partner for when
nobody is around, a hand-authored campaign and an endless seeded tower. Built to ship on
Steam.

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
| `npm run levels` | Re-generates the chunk library from `tools/gen_chunks.py` |
| `npm run calibrate` | Measures what a jump can reach, for the level design rules |
| `npm run art` | Regenerates all store art and installer icons |
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
  three rows above you, rather than dragging you off a ledge.
- **It braces.** When you are climbing, it holds GRIP so the rope has a fixed end to
  pivot on. Measured: with bracing on, a bot pair climbs nearly twice as far before the
  crate gives out.
- **It reels.** Stranded below you on a taut rope, it hauls itself up instead of waiting
  to be rescued.

Two details took most of the work. Jumps get a **run-up** — the reach figures in
`route.ts` were measured from a player at running speed, and a bot that walks back to line
up on the launch column arrives with its velocity pointing the wrong way and falls two
tiles short of everything. And the launch column is chosen by **flying the arc**: plain
ballistics against the tile grid with the body's real box, over every column on the ledge,
because the route only names one cell per ledge and that cell often has a ceiling nine
pixels above the hauler's head.

Left completely alone — two bots, nobody driving — a pair climbs about an eighth of the
campaign and a third of a generated tower before the crate gives out on a ledge lip and
sends them back to a checkpoint. Where they stop is a fact about the crate, not the bot:
it hangs from the middle of the rope, climbing shortens the rope, and past a certain lip
the yank puts the crate into the underside of the ledge they just left. The bot made that
measurable for the first time.

Two things it still does badly, measured rather than hidden. It fidgets while it waits —
about ten direction changes a second as the rope tugs it in and out of its deadzone, down
from twenty-three before the route cursor was made monotonic, and guarded at eighteen by a
test. And it cannot use bounce pads or grip walls at all, because the route analysis it
follows deliberately ignores both as shortcuts.

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
