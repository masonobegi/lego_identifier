/**
 * The daily's paperwork: a fortnight of it as a strip you can read at a
 * glance, and the line you paste to the person you climbed it with.
 *
 * Both are the same fourteen days in two hands, one drawn and one typed, and
 * they are built here together so they cannot drift apart. A strip that says
 * one thing on the ledger and another in a chat window is worse than no strip:
 * the whole of its value is that it is small, it is yours, and every mark on
 * it is one you put there.
 */

import { dailyLabel, dailyRef } from '@haulmates/core';
import { formatTime } from './render/hud.js';
import { DAILY_HISTORY, type DailyDay, type DailyRecord } from './settings.js';

/** How a day reads at a glance: delivered, climbed and not delivered, or nobody was here. */
export type DailyMark = 'delivered' | 'climbed' | 'missed';

export interface DailyBox {
  day: number;
  mark: DailyMark;
  /** Finish time in ticks. Zero unless the mark is `delivered`. */
  ticks: number;
  checkpoints: number;
  attempts: number;
}

/**
 * The last `span` days, oldest first, ending on today.
 *
 * The open day is laid over the filed history rather than read out of it,
 * because nothing files today until a later day rolls it over — a strip drawn
 * from the history alone is a strip with a hole in it exactly where the player
 * is looking, which is tonight.
 */
export function dailyStrip(d: DailyRecord, today: number, span = DAILY_HISTORY): DailyBox[] {
  const filed = new Map<number, DailyDay>();
  for (const e of d.history) filed.set(e.day, e);
  if (d.attempts > 0) {
    filed.set(d.day, { day: d.day, ticks: d.bestTicks, checkpoints: d.bestCheckpoints, attempts: d.attempts });
  }
  const strip: DailyBox[] = [];
  for (let day = today - span + 1; day <= today; day++) {
    const e = filed.get(day);
    strip.push({
      day,
      mark: !e || e.attempts <= 0 ? 'missed' : e.ticks > 0 ? 'delivered' : 'climbed',
      ticks: e?.ticks ?? 0,
      checkpoints: e?.checkpoints ?? 0,
      attempts: e?.attempts ?? 0,
    });
  }
  return strip;
}

/**
 * The strip as one character a day.
 *
 * Ink rather than emoji. The shape everybody copies is three coloured squares,
 * and a paste made of those reads as the game it is imitating rather than as
 * this one — and a fair share of the places it lands draw them as tofu anyway.
 * These three empty out in the same order the boxes on screen do, so a good
 * fortnight keeps its shape for somebody reading it in a chat window who has
 * never been shown the key.
 */
const MARK_INK: Record<DailyMark, string> = { delivered: '#', climbed: '+', missed: '.' };

export function stripLine(boxes: DailyBox[]): string {
  return boxes.map((b) => MARK_INK[b.mark]).join('');
}

/** One box in words, for the tooltip and for anybody reading the screen aloud. */
export function boxLabel(b: DailyBox): string {
  const date = dailyLabel(b.day);
  if (b.mark === 'delivered') return `${date} — delivered in ${formatTime(b.ticks / 60)}`;
  if (b.mark === 'climbed') {
    return `${date} — ${b.checkpoints} checkpoints in ${b.attempts} ${b.attempts === 1 ? 'try' : 'tries'}`;
  }
  return `${date} — not attempted`;
}

export interface DailyTally {
  delivered: number;
  climbed: number;
  /** Days in a row up to now, counting back from the end of the strip. */
  running: number;
}

/**
 * What the strip adds up to.
 *
 * A blank last box does not end a run of days: until midnight it means the
 * evening is young, not that it was missed. Anything older than that is a
 * streak that has already been broken and is waiting to be told.
 */
export function stripTally(boxes: DailyBox[]): DailyTally {
  let delivered = 0;
  let climbed = 0;
  for (const b of boxes) {
    if (b.mark === 'delivered') delivered++;
    else if (b.mark === 'climbed') climbed++;
  }
  let i = boxes.length - 1;
  if (i >= 0 && boxes[i].mark === 'missed') i--;
  let running = 0;
  for (; i >= 0 && boxes[i].mark !== 'missed'; i--) running++;
  return { delivered, climbed, running };
}

export interface DocketRun {
  /** True only if the crate arrived: a run that was walked away from has a time too. */
  delivered: boolean;
  ticks: number;
  checkpoints: number;
  crates: number;
  falls: number;
  /** Whoever was on the other end of the rope, or empty for the Autohauler. */
  mate: string;
}

/**
 * The daily run as something a person would actually send.
 *
 * Four lines at most, none of them wide enough to fold in a chat window, and
 * every figure on it either from the run that just ended or read off the strip
 * printed underneath — the run of days included, which is counted from the
 * marks rather than taken from the profile's own streak. This is the one thing
 * here that leaves the machine, and whoever receives it can check nothing
 * except what it shows them, so it shows them everything it claims.
 */
export function docketText(run: DocketRun, d: DailyRecord, today: number): string {
  const boxes = dailyStrip(d, today);
  const tally = stripTally(boxes);
  const damage = `${run.crates} ${plural(run.crates, 'crate', 'crates')} lost · ${run.falls} ${plural(run.falls, 'fall', 'falls')}`;
  const lines = [
    `HAULMATES — ${dailyLabel(today)} · job ${dailyRef(today)}`,
    run.delivered
      ? `Delivered in ${formatTime(run.ticks / 60)} · ${damage}`
      : `Gave up at checkpoint ${run.checkpoints} · ${damage}`,
  ];
  if (run.mate) lines.push(`With ${run.mate}`);
  const running = tally.running > 1 ? `, ${tally.running} running` : '';
  lines.push(`Last ${boxes.length} days ${stripLine(boxes)}  ${tally.delivered} delivered${running}`);
  return lines.join('\n');
}

/** `1 crates lost` is the joke that got the results card rewritten. */
function plural(n: number, one: string, many: string): string {
  return n === 1 ? one : many;
}
