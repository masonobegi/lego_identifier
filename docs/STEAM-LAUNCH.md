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
npm run dist:mac      # packages/desktop/release/mac-universal, on a Mac
```

The mac bundle is **universal** — arm64 and x64 in one binary — because both kinds of Mac
download the same depot and there is nowhere in Steam's layout to branch on architecture.

It also has to be signed and notarized, or current macOS will not launch it at all: the
customer is told the app is damaged and should be moved to the Bin. The packaging script
does both when the credentials are in the environment, and prints a loud warning naming
what is missing when they are not, so an unsigned bundle can never leave quietly.

```bash
export CSC_LINK=~/certs/developer-id.p12      # or CSC_NAME='Developer ID Application: …'
export CSC_KEY_PASSWORD=…
export APPLE_API_KEY=~/keys/AuthKey_XXXX.p8   # App Store Connect key, best for CI
export APPLE_API_KEY_ID=XXXXXXXXXX
export APPLE_API_ISSUER=xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx
npm run dist:mac
```

`APPLE_ID` + `APPLE_APP_SPECIFIC_PASSWORD` + `APPLE_TEAM_ID` work in place of the API key.
Notarization is a round trip to Apple and takes a few minutes; the script waits for it,
staples the ticket into the bundle so the game launches offline, and then asks Gatekeeper
what it thinks. All of it needs a Mac; run off one, the script builds the bundle and then
names what it could not do to it, so the warning is the last thing on the screen.

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

Each achievement needs a 64×64 achieved icon and a locked variant. Both are generated —
`npm run art` renders all of them into `steam/store/achievements/`, named after the API
names, and `steam/achievements.json` points at them. The generator warns if one is
missing, which is worth reading: Steamworks rejects an achievement without an icon.

## 7. Switch on Steam Cloud

Under *Application → Cloud*, enable Steam Cloud and set the quota from
`steam/launch-options.json` (1 MiB, 32 files — the saves are a few kilobytes of JSON).
No Auto-Cloud paths: the game reads and writes through the Cloud API, so the files never
touch a path Steam has to be told about.

With it off, everything still works — the shell falls back to the save file in the user
data directory — but a player who reinstalls or plays on a second machine starts again
from nothing, unlocked hats, records, daily streak and all.

## 8. Before you press release

- [ ] Run `npm run verify` and confirm it passes end to end.
- [ ] Install the depot from Steam on a clean machine and play a full online match with a
      friend, on the real server, over the real internet.
- [ ] Confirm achievements actually unlock in the Steam client. No automated suite can
      check this: it needs a live Steam client attached to the real App ID, and an
      achievement Steam declines to award looks exactly like one the player has not
      earned yet.
- [ ] Confirm the Steam overlay opens (`Shift+Tab`) and the friend invite dialog appears
      from the lobby's *Invite on Steam* button. The button says out loud whether Steam
      took it, so a silent failure here is a visible one.
- [ ] Accept an invite from a friend both ways round — with the game already running and
      with it closed. The two arrive differently: a running game is handed the Steam lobby
      the code is stored on, a cold start is handed `+connect_lobby` on its command line.
- [ ] Play on one machine, then install on a second and check the unlocks and the daily
      streak came with you. That is the Steam Cloud path, and it is invisible when it
      works.
- [ ] Check the store page on a phone.

Steam requires the store page to be public for **two weeks** before you can release. Use
them: post the trailer where the audience for this genre actually lives (short-form video),
and collect wishlists.

## 9. Pricing

Price it at **US$4.99**, with a launch discount of 10–15%.

The reasoning: this is a "buy it for a laugh with one friend" purchase, and it needs two
copies to be worth anything, so the real price a pair pays is double the sticker. Under
$5 that is an impulse; over it, it becomes a decision. Steam's regional pricing defaults
are fine.

Consider a **two-pack bundle** at a discount. Games in this genre live on people buying a
copy for a friend.

## 10. After launch

- Watch `GET /stats` on the server. Concurrent rooms tell you far more than the store
  dashboard does.
- The generated soundtrack, chunk library and hat list are all data. New chunks are ASCII
  art in `tools/gen_chunks.py`; adding one costs an afternoon and gives you a patch note.
- Bump `SIM_VERSION` in `packages/core/src/constants.ts` whenever a change would make two
  builds disagree. The server refuses mismatched clients with a clear message rather than
  letting them desync ten minutes in.

## Known gaps

Stated plainly so nothing surprises you:

- **Steam achievement delivery, rich presence, cloud saves and friend invites are
  unverified.** They need a real App ID and a running Steam client. The integration is
  written against the exact surface `steamworks.js` exposes and reports whether each call
  landed rather than assuming, and the STEAM badge on the title screen only appears once
  Steam has actually answered — so a broken integration shows up as a missing badge rather
  than as nothing at all. But "the code is honest about failing" is not "it works". Test
  this first.
- **macOS builds have not been produced**, because they must be built, signed and
  notarized on a Mac with a Developer ID. The configuration and the packaging steps are in
  place and take their credentials from the environment.
- **No matchmaking beyond room codes and a simple quick-match queue.** For a two-player
  game where people arrive with a friend already, this is the right scope.
- **The capsule art is generated placeholder art.** See step 5.
