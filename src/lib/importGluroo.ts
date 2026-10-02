// Reads a Gluroo export (the .zip as downloaded, or the .csv inside it) and writes a plan from lib/gluroo.
import { unzipSync, strFromU8 } from 'fflate';
import { supabase } from './supabase';
import { GLUROO_SENDERS, parseCsv, planGluroo, uuid5, type Existing, type GlurooPlan } from './gluroo';
import type { EventRow, HistoryEntry, HistoryLine } from './types';

export async function readGlurooFile(file: File): Promise<Record<string, string>[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  let text: string;
  if (buf[0] === 0x50 && buf[1] === 0x4b) { // "PK": a zip
    const files = unzipSync(buf, { filter: (f) => f.name.toLowerCase().endsWith('.csv') });
    const first = Object.values(files)[0];
    if (!first) throw new Error('no_csv');
    text = strFromU8(first);
  } else text = new TextDecoder().decode(buf);
  const rows = parseCsv(text);
  if (!rows.length || !('eventType' in rows[0]) || !('bgl' in rows[0])) throw new Error('not_gluroo');
  return rows;
}

/** What the app already has, so the same entries are not added twice. */
export function existingFrom(events: EventRow[], history: HistoryEntry[]): Existing[] {
  return [
    ...events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_units).map((e) => ({ kind: 'insulin' as const, amount: e.insulin_units!, t: Date.parse(e.occurred_at) })),
    ...events.filter((e) => !e.deleted_at && (e.kind === 'carbs' || e.kind === 'treatment') && e.carbs_g !== null).map((e) => ({ kind: e.kind as 'carbs' | 'treatment', amount: e.carbs_g!, t: Date.parse(e.occurred_at) })),
    ...history.map((h) => ({ kind: 'carbs' as const, amount: h.total_carbs, t: Date.parse(h.eaten_at) })),
  ];
}

export const planFrom = planGluroo;

export interface ImportResult { readings: number; events: number; meals: number; quick: number }

export async function applyGluroo(plan: GlurooPlan, onStep: (s: string) => void): Promise<ImportResult> {
  const res: ImportResult = { readings: 0, events: 0, meals: 0, quick: 0 };
  // 1. readings, through the one function allowed to add them
  onStep('readings');
  for (let i = 0; i < plan.readings.length; i += 3000) {
    const part = plan.readings.slice(i, i + 3000);
    const { data, error } = await supabase.rpc('import_readings', {
      p_t: part.map((r) => Math.round(r.t / 1000)), p_mg: part.map((r) => Math.round(r.mg)), p_tr: part.map((r) => r.tr), p_source: 'gluroo',
    });
    if (error) throw new Error(error.message);
    res.readings += Number(data) || 0;
  }
  // 2. insulin, finger-pricks, treatments (stable client ids: importing again adds nothing)
  onStep('events');
  const rows = await Promise.all(plan.events.map(async (e) => ({
    client_id: await uuid5(e.key), kind: e.kind, occurred_at: new Date(e.t).toISOString(), source: 'gluroo',
    note: `Gluroo · ${GLUROO_SENDERS[e.sender] ?? e.sender}`,
    insulin_units: e.insulin_units ?? null, insulin_type: e.insulin_type ?? null, bolus_purpose: e.bolus_purpose ?? null,
    carbs_g: e.carbs_g ?? null, treatment: e.treatment ?? null, bg_mgdl: e.bg_mgdl ?? null,
  })));
  if (rows.length) {
    const { data, error } = await supabase.from('events').upsert(rows, { onConflict: 'client_id', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(error.message);
    res.events = data?.length ?? 0;
  }
  // 3. meals
  onStep('meals');
  const meals = plan.meals.map((m) => ({
    kind: m.kind, recipe_id: null, name: m.name, category: 'Gluroo', eaten_at: new Date(m.t).toISOString(),
    total_carbs: m.carbs, total_fat: m.fat, total_fiber: null, total_protein: m.protein, total_kcal: m.kcal, modified: true,
    lines: m.items.map((i): HistoryLine => ({ name: i.name, product: null, quantity: 1, unit: 'serving', state: 'as_is', role: 'main', carbs: i.g })),
    notes: `Gluroo · ${m.senders.join(', ')}`,
    glucose_mgdl: m.glucose?.mg ?? null, glucose_trend: m.glucose?.trend ?? null, glucose_at: m.glucose ? new Date(m.glucose.t).toISOString() : null,
    source: 'gluroo', source_key: m.key,
  }));
  if (meals.length) {
    const { data, error } = await supabase.from('meal_history').upsert(meals, { onConflict: 'source_key', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(error.message);
    res.meals = data?.length ?? 0;
  }
  // 4. quick items: new ones added; ones the family already has keep their name and carbs
  onStep('quick');
  const { data: have } = await supabase.from('quick_items').select('name');
  const known = new Set((have ?? []).map((q: { name: string }) => q.name));
  const fresh = plan.quick.filter((q) => !known.has(q.name)).map((q) => ({
    name: q.name, carbs: q.carbs, fat: q.fat, protein: q.protein, kcal: q.kcal, kind: q.kind, barcode: q.barcode,
    note: `Gluroo: ${q.values.join(' / ')}`, source: 'gluroo', uses: q.uses, last_used: new Date(q.last).toISOString(),
  }));
  if (fresh.length) {
    const { error } = await supabase.from('quick_items').insert(fresh);
    if (error) throw new Error(error.message);
    res.quick = fresh.length;
  }
  return res;
}
