// How a meal's carbs are absorbed over time, for display only (the graph's food strip and the widget): nothing here
// changes a dose, IOB or COB. Each entry follows a curve that peaks at τ minutes and whose area is its carbs.
// A fatty meal is split in two (the parents' choice, 2026-10-23, from Layan's own meals: with 8 g of fat or more her
// rise peaked about 2 hours after eating and lasted 4 to 5 hours, against 1 h 20 and 2 hours without):
// a fast part like any meal, and a slow part that peaks at 2 hours; the slow share grows with the fat
// (fat ÷ 50, up to 60 %). A drink or a juice treatment is a quick pulse. Re-check against her meals as more are logged.

import type { EventRow, HistoryEntry } from '../lib/types';
import type { OnBoardLane } from './iob';

const MIN = 60000;
export const FAST_MIN = 40, SLOW_MIN = 120, DRINK_MIN = 12;

/** The share of a meal's carbs taken as slow, from its fat in grams: none under 8 g, then fat ÷ 50, at most 60 %. */
export const slowShare = (fat: number | null | undefined): number => (fat == null || !(fat >= 8) ? 0 : Math.min(0.6, fat / 50));

/** A drink by its name (juice, nectar, a cocktail drink…), absorbed as a quick pulse. */
export const isDrink = (name: string | null | undefined) => !!name && /(عصير|كوكتيل|مشروب|نكتار|juice|drink|nectar|smoothie)/i.test(name); // i18n-ok: matched against stored names

export interface FoodIn { t: number; carbs: number; fat?: number | null; drink?: boolean }

/** Grams per hour absorbed at minute m after eating, for a curve peaking at τ. */
const rate = (m: number, tau: number) => (m > 0 ? (m / (tau * tau)) * Math.exp(-m / tau) * 60 : 0);
/** The share still to be absorbed at minute m. */
const left = (m: number, tau: number) => (m > 0 ? (1 + m / tau) * Math.exp(-m / tau) : 1);

/** Grams per hour being absorbed at `at`: the fast part (drinks and the quick part of meals) and the slow part. */
export function absorbing(foods: FoodIn[], at: number): { fast: number; slow: number } {
  let fast = 0, slow = 0;
  for (const f of foods) {
    const m = (at - f.t) / MIN;
    if (m <= 0 || m > 12 * 60 || !(f.carbs > 0)) continue;
    if (f.drink) { fast += f.carbs * rate(m, DRINK_MIN); continue; }
    const s = slowShare(f.fat);
    fast += f.carbs * (1 - s) * rate(m, FAST_MIN);
    slow += f.carbs * s * rate(m, SLOW_MIN);
  }
  return { fast, slow };
}

/** Grams still to be absorbed at `at` (eaten before it). */
export function stillToAbsorb(foods: FoodIn[], at: number): number {
  let g = 0;
  for (const f of foods) {
    const m = (at - f.t) / MIN;
    if (m < 0 || m > 12 * 60 || !(f.carbs > 0)) continue;
    if (f.drink) { g += f.carbs * left(m, DRINK_MIN); continue; }
    const s = slowShare(f.fat);
    g += f.carbs * ((1 - s) * left(m, FAST_MIN) + s * left(m, SLOW_MIN));
  }
  return g;
}

/** The log as food to absorb: meals with known carbs (a pending one is not eaten yet), juice treatments as a quick
 *  pulse, carbs-only entries as an ordinary meal. The one source for the strip, «active carbs» and COB. */
export const foodsFrom = (history: HistoryEntry[], events: EventRow[]): FoodIn[] => [
  ...history.filter((h) => h.total_carbs !== null && !h.deleted_at && h.intake !== 'pending')
    .map((h) => ({ t: Date.parse(h.eaten_at), carbs: Number(h.total_carbs), fat: h.total_fat, drink: isDrink(h.name) })),
  ...events.filter((e) => !e.deleted_at && (e.kind === 'carbs' || e.kind === 'treatment') && e.carbs_g)
    .map((e) => ({ t: Date.parse(e.occurred_at), carbs: Number(e.carbs_g), drink: e.kind === 'treatment' })),
];

/** When one entry is down to `rest` of its carbs (0.1: 90 % absorbed), in minutes after eating. */
function doneMin(f: FoodIn, rest = 0.1): number {
  const share = (m: number) => (f.drink ? left(m, DRINK_MIN) : (1 - slowShare(f.fat)) * left(m, FAST_MIN) + slowShare(f.fat) * left(m, SLOW_MIN));
  let m = 0;
  while (share(m) > rest && m < 12 * 60) m += 5;
  return m;
}

/** About when the food eaten up to `now` is absorbed (90 % of each entry), or null when nothing is left. */
export function foodEnd(foods: FoodIn[], now: number): number | null {
  let end: number | null = null;
  for (const f of foods) {
    if (f.t > now || !(f.carbs > 0)) continue;
    const e = f.t + doneMin(f) * MIN;
    if (e > now) end = Math.max(end ?? 0, e);
  }
  return end;
}

/** About when absorption ends, as a range (an estimate, not a clock): from 85 % to 95 % of the food eaten up to `now`
 *  absorbed, the latest entry deciding; null when nothing is left. */
export function foodEndRange(foods: FoodIn[], now: number): { from: number; to: number } | null {
  let from: number | null = null, to: number | null = null;
  for (const f of foods) {
    if (f.t > now || !(f.carbs > 0)) continue;
    const b = f.t + doneMin(f, 0.05) * MIN;
    if (b <= now) continue;
    from = Math.max(from ?? 0, f.t + doneMin(f, 0.15) * MIN); to = Math.max(to ?? 0, b);
  }
  return from === null || to === null ? null : { from: Math.max(from, now), to };
}

/** «Active carbs» for the cards, from the same curves as the strip: grams left now (the same number as the strip and
 *  COB), from the first entry still being absorbed to its estimated end. */
export function foodLane(foods: FoodIn[], now: number): OnBoardLane | null {
  const end = foodEnd(foods, now);
  const act = foods.filter((f) => f.t <= now && f.carbs > 0 && f.t + doneMin(f) * MIN > now);
  const l = stillToAbsorb(foods, now);
  if (end === null || !act.length || l < 0.5) return null;
  const ts = act.map((f) => f.t);
  return { left: l, total: act.reduce((s, f) => s + f.carbs, 0), n: act.length, first: Math.min(...ts), last: Math.max(...ts), end };
}
