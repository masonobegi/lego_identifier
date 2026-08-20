/**
 * Achievement and stat definitions.
 *
 * These live in core, not in the client, because two very different consumers
 * need them: the running game (which evaluates the unlock conditions) and the
 * Steamworks configuration generator (which turns them into the exact API
 * names configured on the partner site). Keeping one definition means the two
 * can never drift apart, which is the usual cause of an achievement that
 * quietly never fires in the shipped build.
 */

export interface AchievementDefinition {
  /** The Steam API name. Never change one after release. */
  id: string;
  name: string;
  description: string;
  /** Hidden achievements show as "???" until earned. */
  hidden?: boolean;
  /** The cosmetic hat this achievement unlocks, if any. */
  hat?: number;
}

export const ACHIEVEMENT_DEFS: AchievementDefinition[] = [
  { id: 'FIRST_STEPS', name: 'Rope Learner', description: 'Reach your first checkpoint.', hat: 1 },
  { id: 'FIRST_HAUL', name: 'Delivered', description: 'Finish The Long Haul with a friend.', hat: 3 },
  { id: 'FLAWLESS_CRATE', name: 'Handle With Care', description: 'Finish a run without ever breaking the crate.', hat: 4 },
  { id: 'BUTTERFINGERS', name: 'Butterfingers', description: 'Break twenty five crates. Across your whole life.', hat: 2 },
  { id: 'HUNDRED_DEATHS', name: 'Statistically Inevitable', description: 'Die one hundred times.', hat: 5 },
  { id: 'BETRAYAL', name: 'It Was An Accident', description: 'Yank your partner off solid ground for the first time.' },
  { id: 'BETRAYAL_100', name: 'It Keeps Happening', description: 'Yank your partner off solid ground one hundred times.' },
  { id: 'ANCHOR_500', name: 'Load Bearing Friend', description: 'Spend five hundred moments braced while your partner swings.', hat: 7 },
  { id: 'GAUNTLET_10', name: 'Ten Floors Up', description: 'Clear a Gauntlet of ten floors.' },
  { id: 'GAUNTLET_20', name: 'Twenty Floors Up', description: 'Clear a Gauntlet of twenty floors.', hat: 6 },
  { id: 'SPEEDRUN', name: 'Express Delivery', description: 'Finish The Long Haul in under twelve minutes.', hidden: true },
  { id: 'NO_DEATHS', name: 'Suspiciously Competent', description: 'Finish a run without either of you dying.', hidden: true },
  { id: 'ONE_KILOMETRE', name: 'A Kilometre Of Regret', description: 'Climb one thousand metres in total.' },
  { id: 'MARATHON', name: 'Still Friends', description: 'Play twenty five runs.' },
];

export interface StatDefinition {
  id: string;
  name: string;
  /** Steam stat type; all of ours are lifetime integer counters. */
  type: 'int';
  min: number;
  max: number;
}

export const STAT_DEFS: StatDefinition[] = [
  { id: 'total_runs', name: 'Runs started', type: 'int', min: 0, max: 1000000 },
  { id: 'total_deaths', name: 'Deaths', type: 'int', min: 0, max: 10000000 },
  { id: 'total_metres', name: 'Metres climbed', type: 'int', min: 0, max: 100000000 },
  { id: 'crates_broken', name: 'Crates destroyed', type: 'int', min: 0, max: 10000000 },
  { id: 'betrayals', name: 'Partners yanked off ledges', type: 'int', min: 0, max: 10000000 },
];

/** Map of achievement id to the hat it unlocks. */
export const HAT_UNLOCKS: Record<string, number> = Object.fromEntries(
  ACHIEVEMENT_DEFS.filter((a) => a.hat !== undefined).map((a) => [a.id, a.hat as number]),
);
