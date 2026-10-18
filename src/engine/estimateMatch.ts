// A food photo estimate made «ingredient-aware»: each food the photo shows is looked up in our own food list (the
// same names search uses); when it is there, its carbs come from our checked value per 100 g times the estimated
// grams, and she adjusts the grams. Only foods with no match keep the photo's own carb guess. Either way the number
// stays «تقريبي» (the amount is still a guess), and nothing here touches the dose calculation.
import { matchTier } from '../lib/search';

export interface ListFood { id: string; name: string; brand?: string | null; name_ar?: string | null; name_en?: string | null; carbs_per_100: number | string | null; per_item?: boolean; approved?: boolean; available?: boolean }

/** Our food for a photo item: an exact name first, then a name that begins with it (Arabic or English). Only plain
 *  foods: not a brand's or restaurant's product (a home plate of fries is not McDonald's fries), not foods sold by the
 *  piece, unapproved ones or ones with no carb value (grams cannot be turned into their carbs). */
export function listMatch<P extends ListFood>(item: { name_ar: string; name_en: string }, products: P[]): P | null {
  let best: { p: P; tier: number } | null = null;
  for (const p of products) {
    if (!p.approved || p.per_item || p.brand?.trim() || p.carbs_per_100 === null || p.carbs_per_100 === '' || !Number.isFinite(Number(p.carbs_per_100))) continue;
    const names = [p.name, p.name_ar, p.name_en];
    const tier = Math.min(...[item.name_ar, item.name_en].filter(Boolean).map((q) => matchTier(names, [], q) ?? 9));
    if (tier > 1) continue;
    if (!best || tier < best.tier || (tier === best.tier && p.name.length < best.p.name.length)) best = { p, tier };
  }
  return best?.p ?? null;
}

export const carbsFromList = (grams: number, per100: number | string | null) => Math.round(((grams * Number(per100 ?? 0)) / 100) * 10) / 10;
