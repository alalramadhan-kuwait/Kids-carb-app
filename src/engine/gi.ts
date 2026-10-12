// Glycemic index (GI) and glycemic load (GL): how fast a food's carbs tend to raise glucose. Information only — the
// carbs always come from the label and nothing here changes a dose. GI is per food (glucose = 100), from the
// International GI Tables; a food without a published value is matched to the closest one (similar) or worked out
// from what is in it (estimate), and both are shown as approximate. Pure, tested in Node.

export type GiMatch = 'exact' | 'similar' | 'estimate' | 'na';
export type GiBand = 'low' | 'mid' | 'high';

/** Low ≤ 55, medium 56–69, high ≥ 70 (the usual cut-offs). */
export const giBand = (gi: number): GiBand => (gi <= 55 ? 'low' : gi < 70 ? 'mid' : 'high');
/** GL of one serving or meal: low ≤ 10, medium 11–19, high ≥ 20. */
export const glBand = (gl: number): GiBand => (gl <= 10 ? 'low' : gl < 20 ? 'mid' : 'high');
/** GL of `carbs` grams of a food with this GI. */
export const glOf = (gi: number, carbs: number) => (gi * carbs) / 100;

export interface GiFood { gi?: number | null; gi_match?: GiMatch | null }
/** What a food shows: its GI and whether that is approximate; null when it has none or too little carbohydrate. */
export function giOf(f: GiFood | null | undefined): { gi: number; band: GiBand; approx: boolean; estimate: boolean } | null {
  if (!f || f.gi === null || f.gi === undefined || f.gi_match === 'na' || !f.gi_match) return null;
  return { gi: f.gi, band: giBand(f.gi), approx: f.gi_match !== 'exact', estimate: f.gi_match === 'estimate' };
}

/** Under this share of a meal's carbs with a known GI, the meal's GI and GL are not shown. */
export const GI_COVER_MIN = 0.8;

export interface GiLine { carbs: number | null; food: GiFood | null }
export interface MealGi { gi: number; gl: number; band: GiBand; glBand: GiBand; approx: boolean }

/** A meal's GI (weighted by each food's carbs) and GL (the sum over its foods). Foods with too little carbohydrate
 *  to measure count as zero load. Null when the meal has under 1 g carbs, or under 80% of its carbs have a GI. */
export function mealGi(lines: GiLine[]): MealGi | null {
  let total = 0, known = 0, gl = 0, approx = false;
  for (const l of lines) {
    const c = l.carbs ?? 0;
    if (c <= 0) continue;
    if (l.food?.gi_match === 'na') continue; // a trace of carbs: no measurable load
    total += c;
    const g = giOf(l.food);
    if (!g) continue;
    known += c; gl += glOf(g.gi, c);
    if (g.approx) approx = true;
  }
  if (total < 1 || known / total < GI_COVER_MIN) return null;
  if (known < total) approx = true;
  const gi = Math.round(gl / known * 100);
  // the load of the carbs without a GI is taken at the meal's own GI, so a missing 10% does not shrink the GL
  const all = Math.round(gl * total / known);
  return { gi, gl: all, band: giBand(gi), glBand: glBand(all), approx };
}
