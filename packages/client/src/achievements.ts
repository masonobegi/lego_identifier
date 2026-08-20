import { ACHIEVEMENT_DEFS, HAT_UNLOCKS, type AchievementDefinition, type World } from '@haulmates/core';
import type { Profile } from './settings.js';
import { setStat, unlockAchievement } from './steam.js';

/**
 * Achievements.
 *
 * The definitions here are the single source of truth: the Steamworks partner
 * site is configured from `steam/achievements.json`, which is generated from
 * this list, so the API names can never drift apart.
 */
export interface AchievementDef extends AchievementDefinition {
  /** Returns true when the achievement should fire. */
  test(ctx: AchievementContext): boolean;
}

export interface AchievementContext {
  profile: Profile;
  world: World | null;
  finished: boolean;
  mode: number;
  towerFloors: number;
  runDeaths: number;
  runCargoBreaks: number;
  runBetrayals: number;
  runBonds: number;
  runSeconds: number;
  metresThisRun: number;
}

/**
 * The unlock conditions, keyed by the shared definition ids. Splitting the
 * rules from the copy keeps the Steamworks configuration generated from a
 * single list while the logic stays here, next to the game state it reads.
 */
const TESTS: Record<string, (c: AchievementContext) => boolean> = {
  FIRST_STEPS: (c) => (c.world?.checkpoint ?? -1) >= 0,
  FIRST_HAUL: (c) => c.finished && c.mode === 0,
  FLAWLESS_CRATE: (c) => c.finished && c.runCargoBreaks === 0,
  BUTTERFINGERS: (c) => c.profile.cargoBreaks >= 25,
  HUNDRED_DEATHS: (c) => c.profile.deaths >= 100,
  BETRAYAL: (c) => c.profile.betrayals >= 1,
  BETRAYAL_100: (c) => c.profile.betrayals >= 100,
  ANCHOR_500: (c) => c.profile.bonds >= 500,
  GAUNTLET_10: (c) => c.finished && c.mode === 1 && c.towerFloors >= 10,
  GAUNTLET_20: (c) => c.finished && c.mode === 1 && c.towerFloors >= 20,
  SPEEDRUN: (c) => c.finished && c.mode === 0 && c.runSeconds > 0 && c.runSeconds < 720,
  NO_DEATHS: (c) => c.finished && c.runDeaths === 0,
  ONE_KILOMETRE: (c) => c.profile.metres >= 1000,
  MARATHON: (c) => c.profile.runs >= 25,
};

export const ACHIEVEMENTS: AchievementDef[] = ACHIEVEMENT_DEFS.map((def) => ({
  ...def,
  test: TESTS[def.id] ?? (() => false),
}));

export class Achievements {
  private unlocked = new Set<string>();

  constructor(private notify: (def: AchievementDef) => void) {}

  /** Evaluate every achievement. Cheap enough to run once a second. */
  evaluate(ctx: AchievementContext): number[] {
    const newHats: number[] = [];
    for (const def of ACHIEVEMENTS) {
      if (this.unlocked.has(def.id)) continue;
      let passed = false;
      try {
        passed = def.test(ctx);
      } catch {
        passed = false;
      }
      if (!passed) continue;
      this.unlocked.add(def.id);
      unlockAchievement(def.id);
      this.notify(def);
      const hat = HAT_UNLOCKS[def.id];
      if (hat !== undefined) newHats.push(hat);
    }
    return newHats;
  }

  /** Seed from a saved profile so notifications do not repeat every launch. */
  hydrate(ids: string[]): void {
    for (const id of ids) this.unlocked.add(id);
  }

  get earned(): string[] {
    return [...this.unlocked];
  }

  pushStats(profile: Profile): void {
    setStat('total_runs', profile.runs);
    setStat('total_deaths', profile.deaths);
    setStat('total_metres', Math.round(profile.metres));
    setStat('crates_broken', profile.cargoBreaks);
    setStat('betrayals', profile.betrayals);
  }
}
