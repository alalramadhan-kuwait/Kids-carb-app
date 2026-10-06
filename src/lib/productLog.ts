// Logging a catalogue product directly (an amount of it at a time): pure portion maths, then the save.
import { supabase } from './supabase';
import type { HistoryLine, Product } from './types';
import { portion } from './portion';
import { MICRO_FIELD, type Micro } from './carbs';
export { amountChoices, portion } from './portion';

/** The glucose reading nearest to `at`, within 10 minutes (the time she ate, not the time it was saved). */
export async function glucoseAt(at: number): Promise<{ taken_at: string; mg_dl: number; trend: number | null } | null> {
  const { data: near } = await supabase.from('glucose_readings').select('taken_at,mg_dl,trend')
    .gte('taken_at', new Date(at - 10 * 60000).toISOString()).lte('taken_at', new Date(at + 10 * 60000).toISOString());
  return ((near ?? []) as { taken_at: string; mg_dl: number; trend: number | null }[]).sort((a, b) => Math.abs(Date.parse(a.taken_at) - at) - Math.abs(Date.parse(b.taken_at) - at))[0] ?? null;
}
/** The three glucose columns of a meal entry for a time. */
export const glucoseCols = (g: Awaited<ReturnType<typeof glucoseAt>>) => ({ glucose_mgdl: g?.mg_dl ?? null, glucose_trend: g?.trend ?? null, glucose_at: g?.taken_at ?? null });

/** Saves the portion as a snack (or meal) at `at`, with the glucose reading within 10 minutes of then. Returns the id. */
export async function logProduct(p: Product, amount: number, at: number, kind: 'meal' | 'snack'): Promise<string> {
  const x = portion(p, amount);
  const g = await glucoseAt(at);
  // a per-item food is recorded as items (servings), not as its 100 storage units
  const line: HistoryLine = { name: p.name, product: [p.name, p.brand].filter(Boolean).join(' — '), quantity: p.per_item ? amount / 100 : amount, unit: p.per_item ? 'serving' : p.unit, state: 'as_is', role: 'main', carbs: x.carbs };
  // the other label nutrients for this amount (null when the label does not give them)
  const micro = Object.fromEntries((Object.keys(MICRO_FIELD) as Micro[]).map((m) => {
    const v = p[MICRO_FIELD[m]] as number | null | undefined;
    return [`total_${m}`, v == null ? null : Math.round(((v * amount) / 100) * 10) / 10];
  }));
  const { data, error } = await supabase.from('meal_history').insert({
    ...micro,
    kind, recipe_id: null, name: p.name, category: p.category, brand: p.brand, eaten_at: new Date(at).toISOString(),
    total_carbs: x.carbs, total_fat: x.fat, total_fiber: x.fiber, total_protein: x.protein, total_kcal: x.kcal, modified: false, lines: [line], notes: null,
    glucose_mgdl: g?.mg_dl ?? null, glucose_trend: g?.trend ?? null, glucose_at: g?.taken_at ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
