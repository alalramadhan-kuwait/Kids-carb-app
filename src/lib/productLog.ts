// Logging a catalogue product directly (an amount of it at a time): pure portion maths, then the save.
import { supabase } from './supabase';
import type { HistoryLine, Product } from './types';
import { portion } from './portion';
export { amountChoices, portion } from './portion';

/** Saves the portion as a snack (or meal) at `at`, with the glucose reading within 10 minutes of then. Returns the id. */
export async function logProduct(p: Product, amount: number, at: number, kind: 'meal' | 'snack'): Promise<string> {
  const x = portion(p, amount);
  const { data: near } = await supabase.from('glucose_readings').select('taken_at,mg_dl,trend')
    .gte('taken_at', new Date(at - 10 * 60000).toISOString()).lte('taken_at', new Date(at + 10 * 60000).toISOString());
  const g = (near ?? []).sort((a: { taken_at: string }, b: { taken_at: string }) => Math.abs(Date.parse(a.taken_at) - at) - Math.abs(Date.parse(b.taken_at) - at))[0] as { taken_at: string; mg_dl: number; trend: number | null } | undefined;
  const line: HistoryLine = { name: p.name, product: [p.name, p.brand].filter(Boolean).join(' — '), quantity: amount, unit: p.unit, state: 'as_is', role: 'main', carbs: x.carbs };
  const { data, error } = await supabase.from('meal_history').insert({
    kind, recipe_id: null, name: p.name, category: p.category, brand: p.brand, eaten_at: new Date(at).toISOString(),
    total_carbs: x.carbs, total_fat: x.fat, total_fiber: x.fiber, total_protein: x.protein, total_kcal: x.kcal, modified: false, lines: [line], notes: null,
    glucose_mgdl: g?.mg_dl ?? null, glucose_trend: g?.trend ?? null, glucose_at: g?.taken_at ?? null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
