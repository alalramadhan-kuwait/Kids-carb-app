// A food entered in the Log sheet as a catalogue product. Pure, so it is tested.
import type { QuickFields } from './quick';

/** The catalogue product for a food entered in the Log sheet. Labelled per 100 g or ml: the label as printed and the
 *  pack amount as the serving. Given straight per serving: one item (per_item; its values are per item, as the
 *  catalogue keeps them). Entered from the label in hand, so it is approved, like a new product on the Products page. */
export function productFromQuick(f: QuickFields, category?: string | null) {
  const per = f.per100 && f.amount_unit ? f.per100 : null;
  const v = per ?? { carbs: f.carbs, fat: f.fat, protein: f.protein, fiber: f.fiber, kcal: f.kcal };
  return {
    name: f.name, brand: f.brand, category: category?.trim() || (f.kind === 'snack' ? 'سناكات' : 'أخرى'), kind: 'commercial' as const, // i18n-ok: stored value
    unit: per ? f.amount_unit! : 'g' as const, per_item: !per,
    carbs_per_100: v.carbs, fat_per_100: v.fat, protein_per_100: v.protein, fiber_per_100: v.fiber, kcal_per_100: v.kcal,
    serving_size: per ? f.amount : 100, carbs_per_serving: f.carbs, label_basis: 'as_sold' as const,
    available: true, approved: true, notes: 'أُضيف من السجل («منتج جديد ليس في القائمة»).', // i18n-ok: stored note
  };
}
