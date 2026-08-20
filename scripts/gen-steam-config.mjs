/**
 * Generate the Steamworks configuration from the game's own definitions.
 *
 * Achievement API names, stat names and depot layout all have to match exactly
 * between the partner site and the shipped binary. Generating them from the
 * same source the game reads removes the whole class of "the achievement never
 * fires in the release build" bug.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { ACHIEVEMENT_DEFS, STAT_DEFS } from '../packages/core/dist/index.js';

const OUT = 'steam';
const APP_ID = process.env.HAULMATES_APP_ID ?? '480';
const WIN_DEPOT = String(Number(APP_ID) + 1);
const LINUX_DEPOT = String(Number(APP_ID) + 2);
const MAC_DEPOT = String(Number(APP_ID) + 3);

mkdirSync(OUT, { recursive: true });

writeFileSync(
  join(OUT, 'achievements.json'),
  JSON.stringify(
    {
      appId: APP_ID,
      note: 'Enter these on the Steamworks partner site under Stats & Achievements. API names must match exactly.',
      achievements: ACHIEVEMENT_DEFS.map((a, index) => ({
        order: index + 1,
        apiName: a.id,
        displayName: a.name,
        description: a.description,
        hidden: Boolean(a.hidden),
        iconAchieved: `achievements/${a.id.toLowerCase()}.jpg`,
        iconUnachieved: `achievements/${a.id.toLowerCase()}_locked.jpg`,
      })),
      stats: STAT_DEFS.map((s, index) => ({
        order: index + 1,
        apiName: s.id,
        displayName: s.name,
        type: s.type,
        min: s.min,
        max: s.max,
        default: 0,
        incrementOnly: true,
      })),
    },
    null,
    2,
  ) + '\n',
);

const appBuild = `"AppBuild"
{
  "AppID" "${APP_ID}"
  "Desc" "HAULMATES build"

  // Relative to this file. Point ContentRoot at the folder holding the
  // per-platform builds produced by scripts/package-desktop.mjs.
  "ContentRoot" "./content/"
  "BuildOutput" "./output/"

  "Depots"
  {
    "${WIN_DEPOT}" "depot_windows.vdf"
    "${LINUX_DEPOT}" "depot_linux.vdf"
    "${MAC_DEPOT}" "depot_mac.vdf"
  }
}
`;
writeFileSync(join(OUT, 'app_build.vdf'), appBuild);

function depot(id, folder) {
  return `"DepotBuild"
{
  "DepotID" "${id}"
  "ContentRoot" "../content/${folder}/"

  "FileMapping"
  {
    "LocalPath" "*"
    "DepotPath" "."
    "recursive" "1"
  }

  "FileExclusion" "*.pdb"
  "FileExclusion" "*.map"
  "FileExclusion" "**/*.log"
}
`;
}

writeFileSync(join(OUT, 'depot_windows.vdf'), depot(WIN_DEPOT, 'windows'));
writeFileSync(join(OUT, 'depot_linux.vdf'), depot(LINUX_DEPOT, 'linux'));
writeFileSync(join(OUT, 'depot_mac.vdf'), depot(MAC_DEPOT, 'mac'));

writeFileSync(
  join(OUT, 'launch-options.json'),
  JSON.stringify(
    {
      note: 'Mirror these under Steamworks > Installation > General Installation.',
      launchOptions: [
        { os: 'windows', executable: 'HAULMATES.exe', description: 'Play HAULMATES' },
        { os: 'linux', executable: 'haulmates', description: 'Play HAULMATES' },
        { os: 'macos', executable: 'HAULMATES.app', description: 'Play HAULMATES' },
      ],
      richPresenceTokens: {
        '#Status_Generic': '%status%',
      },
      note2: 'The game writes a "connect" rich-presence key of the form "+haulmates_join CODE"; Steam passes it to the client as launch arguments when a friend clicks Join Game.',
    },
    null,
    2,
  ) + '\n',
);

console.log(`Wrote Steamworks configuration to ${OUT}/`);
console.log(`  ${ACHIEVEMENT_DEFS.length} achievements, ${STAT_DEFS.length} stats`);
console.log(`  app ${APP_ID}, depots ${WIN_DEPOT} / ${LINUX_DEPOT} / ${MAC_DEPOT}`);
console.log('  Set HAULMATES_APP_ID once Steam issues your real App ID and re-run.');
