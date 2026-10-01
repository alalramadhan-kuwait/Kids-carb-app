// Pure food helpers (no network), shared by the scan screen and the tests.

export interface EstItem {
  name_ar: string; name_en: string; grams: number; carbs_g: number; protein_g: number; fat_g: number; kcal: number;
  confidence: 'low' | 'medium' | 'high'; hidden_sugar: boolean;
}
export interface Estimate { is_food: boolean; items: EstItem[]; notes_ar: string; notes_en: string }
/** An item at a different weight: everything scales with it (the estimate's own ratios). */
export function scaleItem(i: EstItem, grams: number): EstItem {
  const g = Math.max(0, grams);
  if (!i.grams) return { ...i, grams: g };
  const k = g / i.grams, r = (n: number) => Math.round(n * k * 10) / 10;
  return { ...i, grams: g, carbs_g: r(i.carbs_g), protein_g: r(i.protein_g), fat_g: r(i.fat_g), kcal: Math.round(i.kcal * k) };
}

export const totals = (items: EstItem[]) => {
  const s = (k: 'carbs_g' | 'protein_g' | 'fat_g' | 'kcal') => Math.round(items.reduce((a, i) => a + i[k], 0) * 10) / 10;
  return { carbs: s('carbs_g'), protein: s('protein_g'), fat: s('fat_g'), kcal: Math.round(s('kcal')) };
};

export interface Packaged { code: string; name: string; brand: string | null; per100: { carbs: number | null; protein: number | null; fat: number | null; kcal: number | null; fiber: number | null }; serving: number | null }

/** Open Food Facts product → the numbers we use (per 100 g/ml), or null when it has no carbohydrate value. */
export function offToPackaged(code: string, j: unknown, lang: 'ar' | 'en'): Packaged | null {
  const p = (j as { status?: number; product?: Record<string, unknown> })?.product;
  if (!p || (j as { status?: number }).status === 0) return null;
  const n = (p.nutriments ?? {}) as Record<string, unknown>;
  const v = (k: string) => { const x = Number(n[k]); return Number.isFinite(x) && x >= 0 ? Math.round(x * 10) / 10 : null; };
  const carbs = v('carbohydrates_100g');
  if (carbs === null) return null;
  const name = String((lang === 'ar' && p.product_name_ar) || p.product_name || p.product_name_en || p.product_name_ar || code).trim();
  const serving = Number(p.serving_quantity);
  return {
    code, name, brand: typeof p.brands === 'string' && p.brands ? p.brands.split(',')[0].trim() : null,
    per100: { carbs, protein: v('proteins_100g'), fat: v('fat_100g'), kcal: v('energy-kcal_100g'), fiber: v('fiber_100g') },
    serving: Number.isFinite(serving) && serving > 0 ? serving : null,
  };
}

