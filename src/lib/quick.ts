// Quick items: foods Layan has often (from her history or an import), logged with one tap as a meal entry
// with the carbs the family usually logs for it. The amount stays editable; nothing is estimated here.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { HistoryLine } from './types';

export interface QuickItem {
  id: string; name: string; carbs: number; fat: number | null; protein: number | null; kcal: number | null;
  kind: 'meal' | 'snack' | 'treatment'; barcode: string | null; note: string | null; source: string | null;
  uses: number; last_used: string | null;
}
const n = (v: unknown) => (v === null || v === undefined ? null : Number(v));

export function useQuickItems() {
  const [items, setItems] = useState<QuickItem[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('quick_items').select('*').order('uses', { ascending: false }).order('name');
    setItems((data ?? []).map((q: QuickItem) => ({ ...q, carbs: Number(q.carbs), fat: n(q.fat), protein: n(q.protein), kcal: n(q.kcal) })));
  }, []);
  useEffect(() => { void load(); }, [load]);
  return { items, reload: load };
}

/** Logs one serving as a meal or snack entry (with the glucose at the time if it is recent). Returns the entry id. */
export async function logQuick(q: QuickItem): Promise<string> {
  const { data: g } = await supabase.from('glucose_readings').select('taken_at,mg_dl,trend').order('taken_at', { ascending: false }).limit(1).maybeSingle();
  const fresh = g && Date.now() - new Date(g.taken_at).getTime() <= 15 * 60000;
  const line: HistoryLine = { name: q.name, product: null, quantity: 1, unit: 'serving', state: 'as_is', role: 'main', carbs: q.carbs };
  const { data, error } = await supabase.from('meal_history').insert({
    kind: q.kind === 'meal' ? 'meal' : 'snack', recipe_id: null, name: q.name, category: null,
    total_carbs: q.carbs, total_fat: q.fat, total_fiber: null, total_protein: q.protein, total_kcal: q.kcal, modified: false,
    lines: [line], notes: null,
    glucose_mgdl: fresh ? g.mg_dl : null, glucose_trend: fresh ? g.trend : null, glucose_at: fresh ? g.taken_at : null,
  }).select('id').single();
  if (error) throw new Error(error.message);
  await supabase.from('quick_items').update({ uses: q.uses + 1, last_used: new Date().toISOString() }).eq('id', q.id);
  return (data as { id: string }).id;
}

export async function saveQuick(id: string, patch: Partial<Pick<QuickItem, 'name' | 'carbs' | 'kind'>>) {
  const { error } = await supabase.from('quick_items').update(patch).eq('id', id);
  if (error) throw new Error(error.message);
}
export async function deleteQuick(id: string) {
  const { error } = await supabase.from('quick_items').delete().eq('id', id);
  if (error) throw new Error(error.message);
}
