/**
 * The daily haul.
 *
 * This game has two modes and, until now, no reason to open it a second
 * evening: the campaign is the same tower every time, and a Gauntlet on a
 * random seed is a tower nobody else will ever see, so there is nothing to
 * compare and nothing to come back for. A run you can talk about needs two
 * things — that your friend can play the exact same one, and that it stops
 * being available tomorrow.
 *
 * So: one procedurally assembled tower per calendar day, derived from the
 * date, identical for everybody, gone at midnight. It costs almost nothing to
 * build — the Gauntlet already takes a seed — and it turns "want to play
 * again?" into a question with a specific answer.
 *
 * UTC, deliberately. Two friends on different sides of a date line comparing
 * two different towers is worse than one of them getting the new tower at a
 * strange hour.
 */

/** Floors in a daily tower: long enough to be a session, short enough to finish. */
export const DAILY_FLOORS = 12;

import { hashSeed } from './rng.js';

const DAY_MS = 86400000;

/** The UTC day number for a timestamp. Day 0 is 1 January 1970. */
export function dailyDay(nowMs: number): number {
  return Math.floor(nowMs / DAY_MS);
}

/**
 * The seed for a given day.
 *
 * Consecutive days must not produce similar towers, and `day` increments by
 * one, so it goes through the same hash the room codes do rather than being
 * used raw. There was a `dailySeed(dateIso)` in `level.ts` doing exactly this
 * and nothing ever called it — a daily mode that got as far as a seed function
 * and stopped — so this is that idea finished rather than a second one.
 */
export function dailySeed(day: number): number {
  return hashSeed(`haulmates-daily-${day}`) & 0x7fffffff;
}

/** The date a day number names, as `21 August 2026`, for the menus. */
export function dailyLabel(day: number): string {
  const d = new Date(day * DAY_MS);
  const months = [
    'January', 'February', 'March', 'April', 'May', 'June',
    'July', 'August', 'September', 'October', 'November', 'December',
  ];
  return `${d.getUTCDate()} ${months[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}
