// «كرري الوجبة» in simple mode: a logged meal's foods as a new plate. Each line becomes the same product at the same
// amount (a cooked weight stays cooked) when the plate gives it the carbs that were logged (within 1 g or 10%). A line
// that cannot be matched is never dropped quietly: it is put up for review on the plate, and the plate cannot go on to
// the dose until each one is found again or removed. Nothing is saved here; the logged meal and its insulin are not
// read or touched, and the new meal's dose is worked out afresh. Pure, tested in Node.
import type { MomItem } from '../engine/mom';
import type { HistoryEntry, HistoryLine, Product } from './types';
import { productOf } from './mealItems';

/** A logged food the plate could not take as it was: shown flagged until found again or removed. */
export interface ReviewItem { name: string; quantity: number; unit: HistoryLine['unit']; carbs: number | null; why: 'no_product' | 'unit' | 'carbs' }

export function repeatPlate(h: HistoryEntry, products: Product[], itemCarbs: (it: MomItem) => number | null): { items: MomItem[]; review: ReviewItem[] } {
  const items: MomItem[] = [], review: ReviewItem[] = [];
  for (const l of h.lines) {
    const flag = (why: ReviewItem['why']) => review.push({ name: l.name, quantity: l.quantity, unit: l.unit, carbs: l.carbs ?? null, why });
    const p = productOf(l, products);
    if (!p) { flag('no_product'); continue; }
    const unit = l.unit === 'serving' ? 'serving' : l.unit === 'g' || l.unit === 'ml' ? 'g' : null;
    if (!unit) { flag('unit'); continue; }
    // weighed cooked from a dry label (pasta, rice sold dry): keep it a cooked weight, as it was logged
    const it: MomItem = { kind: 'product', id: p.id, portion_id: null, amount: l.quantity, unit, ...(unit === 'g' && l.state === 'cooked' && p.label_basis === 'as_sold' ? { cooked: true } : {}) };
    const g = itemCarbs(it), want = l.carbs ?? null;
    if (g !== null && want !== null && Math.abs(g - want) <= Math.max(1, want * 0.1)) items.push(it);
    else flag('carbs');
  }
  return { items, review };
}
