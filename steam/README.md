# Steam configuration

Everything in this folder is **generated**. Do not hand-edit it; change the source and
re-run the generator, or your changes will vanish on the next build.

| File | Generated from | Command |
|---|---|---|
| `achievements.json` | `packages/core/src/achievements.ts` | `npm run steam:config` |
| `app_build.vdf`, `depot_*.vdf` | the same generator | `npm run steam:config` |
| `launch-options.json` | the same generator | `npm run steam:config` |
| `store/*.png` | `scripts/gen-art.mjs` | `npm run art` |

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
