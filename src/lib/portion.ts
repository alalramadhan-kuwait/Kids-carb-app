// Portions of a catalogue product from its label per 100. Pure, tested in Node.
import type { Product } from './types';

const r1 = (x: number) => Math.round(x * 10) / 10;
/** What `amount` (in the product's unit, g or ml) of it contains, from the label per 100. */
export function portion(p: Pick<Product, 'carbs_per_100' | 'fat_per_100' | 'protein_per_100' | 'fiber_per_100' | 'kcal_per_100'>, amount: number) {
  const f = amount / 100, g = (v: number | null) => (v === null || v === undefined ? null : r1(Number(v) * f));
  return { carbs: r1(Number(p.carbs_per_100) * f), fat: g(p.fat_per_100), protein: g(p.protein_per_100), fiber: g(p.fiber_per_100), kcal: p.kcal_per_100 === null ? null : Math.round(Number(p.kcal_per_100) * f) };
}
/** The amounts worth one tap: the whole pack, a serving from the label, and 100. */
export function amountChoices(p: Pick<Product, 'pack_size' | 'serving_size' | 'per_item'>): { key: 'pack' | 'serving' | 'hundred' | 'item'; amount: number }[] {
  if (p.per_item) return [1, 2].map((n) => ({ key: 'item' as const, amount: n * 100 })); // one item = 100 units
  const out: { key: 'pack' | 'serving' | 'hundred' | 'item'; amount: number }[] = [];
  if (p.pack_size && p.pack_size > 0 && p.pack_size <= 500) out.push({ key: 'pack', amount: Number(p.pack_size) });
  if (p.serving_size && p.serving_size > 0 && !out.some((o) => o.amount === Number(p.serving_size))) out.push({ key: 'serving', amount: Number(p.serving_size) });
  if (!out.some((o) => o.amount === 100)) out.push({ key: 'hundred', amount: 100 });
  return out;
}
