# Shipping HAULMATES on Steam

A checklist, in the order you actually have to do things. Nothing here is guesswork about
the game — every build command listed has been run — but the Steamworks steps require an
account, an App ID and a fee that only you can supply.

## 1. Before you can upload anything

- [ ] Create a Steamworks partner account and pay the App fee (US$100, refundable against
      revenue once the game earns US$1,000).
- [ ] Complete the tax and banking paperwork. Nothing can release until this clears, and
      it takes days, not minutes.
- [ ] Note your **App ID**. Everything below depends on it.

## 2. Wire the App ID into the build

```bash
HAULMATES_APP_ID=<your id> npm run steam:config
```

That regenerates `steam/achievements.json`, `steam/app_build.vdf` and the three depot
files with the correct IDs. Then set the same ID for the shell — either edit the default in
`packages/desktop/src/main.ts` or set `HAULMATES_APP_ID` in the build environment.

Steam issues depot IDs of its own; if they differ from the `AppID + 1/2/3` convention this
generator assumes, edit the numbers in the generated `.vdf` files.

## 3. Stand up a server

The game needs one matchmaking server both players can reach. It is a single Node process,
holds no database, and costs very little to run.

```bash
npm run build
PORT=8787 node packages/server/dist/cli.js
```

Put it behind TLS (`wss://`) — browsers will refuse a plain `ws://` connection from an
HTTPS page, and it is the right default regardless. Any small VM or container host works;
`GET /health` is there for the load balancer and `GET /stats` for a dashboard.

Then bake the address into the desktop build:

```bash
HAULMATES_SERVER=wss://play.yourdomain.com npm run dist:win
```

Players can still override it in Settings, and the desktop build can host a server
in-process for LAN play, so a server outage does not brick the game.

## 4. Build the depots

```bash
npm run dist:win      # packages/desktop/release/win-unpacked
npm run dist:linux    # packages/desktop/release/linux-unpacked
npm run dist:mac      # macOS builds must be produced on a Mac
```

Copy each output into `steam/content/windows`, `steam/content/linux`, `steam/content/mac`,
then:

```bash
steamcmd +login <account> +run_app_build <abs path>/steam/app_build.vdf +quit
```

Set the launch executables under *Installation → General Installation* to match
`steam/launch-options.json`: `HAULMATES.exe` on Windows, `haulmates` on Linux.

## 5. Configure the store page

- [ ] Copy the text from [STORE-PAGE.md](STORE-PAGE.md) into the store page editor.
- [ ] Upload the capsules from `steam/store/`. **These are programmer art.** They are
      correctly sized, on-brand and legal to ship, but the capsule is the single biggest
      lever on wishlist conversion in this genre. Budget a few hundred dollars for an
      illustrator before launch; keep the generated ones as a layout brief.
- [ ] Take five screenshots and one 30-second trailer from real play. The trailer only has
      to show one thing: somebody yanking their friend off a ledge.
- [ ] Set the tags. Order matters: `Co-op`, `Online Co-Op`, `Local Co-Op`, `Physics`,
      `Platformer`, `Funny`, `Multiplayer`, `2D`, `Indie`, `Casual`.
- [ ] Mark **Online Co-op** and **Shared/Split Screen Co-op** under Features, and set
      players to 2. Buyers in this genre filter on exactly these.

## 6. Achievements and stats

Enter every entry from `steam/achievements.json` on the partner site under *Stats &
Achievements*. The API names must match character for character — they are generated from
the same source the game calls, so do not retype them by hand if you can paste.

Each achievement needs a 64×64 achieved icon and a locked variant.

## 7. Before you press release

- [ ] Run `npm run verify` and confirm it passes end to end.
- [ ] Install the depot from Steam on a clean machine and play a full online match with a
      friend, on the real server, over the real internet.
- [ ] Confirm achievements actually unlock in the Steam client. This is the one thing the
      automated suite cannot check — everything else in the Steam integration is written
      to degrade to a no-op, so a missing achievement will fail silently, not loudly.
- [ ] Confirm the Steam overlay opens (`Shift+Tab`) and the friend invite dialog appears
      from the lobby's *Invite on Steam* button.
- [ ] Check the store page on a phone.

Steam requires the store page to be public for **two weeks** before you can release. Use
them: post the trailer where the audience for this genre actually lives (short-form video),
and collect wishlists.

## 8. Pricing

Price it at **US$4.99**, with a launch discount of 10–15%.

The reasoning: this is a "buy it for a laugh with one friend" purchase, and it needs two
copies to be worth anything, so the real price a pair pays is double the sticker. Under
$5 that is an impulse; over it, it becomes a decision. Steam's regional pricing defaults
are fine.

Consider a **two-pack bundle** at a discount. Games in this genre live on people buying a
copy for a friend.

## 9. After launch

- Watch `GET /stats` on the server. Concurrent rooms tell you far more than the store
  dashboard does.
- The generated soundtrack, chunk library and hat list are all data. New chunks are ASCII
  art in `tools/gen_chunks.py`; adding one costs an afternoon and gives you a patch note.
- Bump `SIM_VERSION` in `packages/core/src/constants.ts` whenever a change would make two
  builds disagree. The server refuses mismatched clients with a clear message rather than
  letting them desync ten minutes in.

## Known gaps

Stated plainly so nothing surprises you:

- **Steam achievement delivery, rich presence and friend invites are unverified.** They
  need a real App ID and a running Steam client. The code is defensive — every Steamworks
  call is wrapped and degrades to a no-op, and the game has been confirmed to run with
  Steam entirely absent — but "it does not crash without Steam" is not "it works with
  Steam". Test this first.
- **macOS builds have not been produced**, because they must be built and code-signed on a
  Mac. The configuration is in place.
- **No matchmaking beyond room codes and a simple quick-match queue.** For a two-player
  game where people arrive with a friend already, this is the right scope.
- **The capsule art is generated placeholder art.** See step 5.
