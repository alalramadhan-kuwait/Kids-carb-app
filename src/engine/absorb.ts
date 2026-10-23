// How a meal's carbs are absorbed over time, for display only (the graph's food strip and the widget): nothing here
// changes a dose, IOB or COB. Each entry follows a curve that peaks at τ minutes and whose area is its carbs.
// A fatty meal is split in two (the parents' choice, 2026-10-23, from Layan's own meals: with 8 g of fat or more her
// rise peaked about 2 hours after eating and lasted 4 to 5 hours, against 1 h 20 and 2 hours without):
// a fast part like any meal, and a slow part that peaks at 2 hours; the slow share grows with the fat
// (fat ÷ 50, up to 60 %). A drink or a juice treatment is a quick pulse. Re-check against her meals as more are logged.

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
