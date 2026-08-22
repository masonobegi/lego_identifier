# Steam configuration

Everything in this folder is **generated**. Do not hand-edit it; change the source and
re-run the generator, or your changes will vanish on the next build.

| File | Generated from | Command |
|---|---|---|
| `achievements.json` | `packages/core/src/achievements.ts` | `npm run steam:config` |
| `app_build.vdf`, `depot_*.vdf` | the same generator | `npm run steam:config` |
| `launch-options.json` | the same generator | `npm run steam:config` |
| `store/*.png` | `scripts/gen-art.mjs` | `npm run art` |
| `store/achievements/*.jpg` | `packages/core/src/achievements.ts`, via the same generator | `npm run art` |

The App ID defaults to `480` (Steam's public test app) so that everything is runnable
before you own one. Set the real one and regenerate:

```bash
HAULMATES_APP_ID=1234567 npm run steam:config
```

`content/` and `output/` are where `steamcmd` expects the built depots and its logs. Both
are ignored by git — copy the output of `npm run dist:*` into `content/<platform>/`.

The capsule art in `store/` is generated placeholder art: correctly sized, on-brand and
free of any licensing, but not a substitute for an illustrator. See
`docs/STEAM-LAUNCH.md`.

The achievement icons in `store/achievements/` are a drawing apiece, an achieved and a
locked variant for each, at the 64x64 Steam renders them at. They are rendered against the
achievement list itself, so a new achievement cannot be missed — but it comes out as a
plate of its initials until a pictogram for it is added to `PICTOS` in
`scripts/gen-art.mjs`, which is the point at which two badges start looking alike.
