// Reads a Gluroo export (the .zip as downloaded, or the .csv inside it), keeps every entry as exported in
// carb.import_entries, and rebuilds the cleaned meals and events from the entries' current statuses.
import { unzipSync, strFromU8 } from 'fflate';
import { supabase } from './supabase';
import { fetchSeries } from '../engine/useSeries';
import { GLUROO_SENDERS, classify, derive, readingsFrom, uuid5, type EntryStatus, type Existing, type ImportEntry, type Reading } from './gluroo';
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
  const { parseCsv } = await import('./gluroo');
  const rows = parseCsv(text);
  if (!rows.length || !('eventType' in rows[0]) || !('bgl' in rows[0])) throw new Error('not_gluroo');
  return rows;
}

/** What was logged in the app itself (not imported), so the same entries are not added twice. */
export function existingFrom(events: EventRow[], history: HistoryEntry[]): Existing[] {
  const own = (x: { source?: string | null }) => !x.source;
  return [
    ...events.filter((e) => own(e) && !e.deleted_at && e.kind === 'insulin' && e.insulin_units).map((e) => ({ kind: 'insulin' as const, amount: e.insulin_units!, t: Date.parse(e.occurred_at) })),
    ...events.filter((e) => own(e) && !e.deleted_at && (e.kind === 'carbs' || e.kind === 'treatment') && e.carbs_g !== null).map((e) => ({ kind: e.kind as 'carbs' | 'treatment', amount: e.carbs_g!, t: Date.parse(e.occurred_at) })),
    ...history.filter((h) => own(h as { source?: string | null }) && h.total_carbs !== null).map((h) => ({ kind: 'carbs' as const, amount: h.total_carbs!, t: Date.parse(h.eaten_at) })),
  ];
}

export interface Preview { readings: Reading[]; entries: ImportEntry[] }
export const preview = (rows: Record<string, string>[], existing: Existing[]): Preview => {
  const readings = readingsFrom(rows);
  return { readings, entries: classify(rows, readings, existing) };
};

export interface ImportResult { readings: number; entries: number; meals: number; events: number; quick: number }

/** Saves the readings and every entry (a re-import keeps the parents' earlier decisions), then rebuilds. */
export async function importGluroo(p: Preview, onStep: (s: string) => void): Promise<ImportResult> {
  const res: ImportResult = { readings: 0, entries: 0, meals: 0, events: 0, quick: 0 };
  onStep('readings');
  for (let i = 0; i < p.readings.length; i += 3000) {
    const part = p.readings.slice(i, i + 3000);
    const { data, error } = await supabase.rpc('import_readings', {
      p_t: part.map((r) => Math.round(r.t / 1000)), p_mg: part.map((r) => Math.round(r.mg)), p_tr: part.map((r) => r.tr), p_source: 'gluroo',
    });
    if (error) throw new Error(error.message);
    res.readings += Number(data) || 0;
  }
  onStep('entries');
  const rows = p.entries.map((e) => ({
    source: 'gluroo', source_key: e.key, occurred_at: new Date(e.t).toISOString(), entry_type: e.type, sender: e.sender, raw: e.raw,
    food_key: e.food_key, food_name: e.food_name, carbs: e.carbs, units: e.units, status: e.status, reason: e.reason, related_key: e.related_key, decided_by: 'importer',
  }));
  for (let i = 0; i < rows.length; i += 500) {
    const { data, error } = await supabase.from('import_entries').upsert(rows.slice(i, i + 500), { onConflict: 'source,source_key', ignoreDuplicates: true }).select('id');
    if (error) throw new Error(error.message);
    res.entries += data?.length ?? 0;
  }
  onStep('rebuild');
  const r = await rebuildGluroo();
  return { ...res, meals: r.meals, events: r.events, quick: r.quick };
}

export interface StoredEntry extends ImportEntry { id: string; decided_by: 'importer' | 'parent' }
export async function loadEntries(): Promise<StoredEntry[]> {
  const out: StoredEntry[] = [];
  for (let from = 0; ; from += 1000) {
    const { data, error } = await supabase.from('import_entries').select('*').eq('source', 'gluroo').order('occurred_at').range(from, from + 999);
    if (error) throw new Error(error.message);
    for (const x of data ?? []) out.push({ id: x.id, key: x.source_key, t: Date.parse(x.occurred_at), type: x.entry_type, sender: x.sender ?? '', raw: x.raw,
      food_key: x.food_key, food_name: x.food_name, carbs: x.carbs === null ? null : Number(x.carbs), units: x.units === null ? null : Number(x.units),
      status: x.status, reason: x.reason, related_key: x.related_key, decided_by: x.decided_by });
    if (!data || data.length < 1000) break;
  }
  return out;
}

/** A parent's decision on one entry; the cleaned data is rebuilt straight away. */
export async function decide(id: string, status: EntryStatus) {
  const { error } = await supabase.from('import_entries').update({ status, decided_by: 'parent', decided_at: new Date().toISOString() }).eq('id', id);
  if (error) throw new Error(error.message);
  await rebuildGluroo();
}

/** Rebuilds the cleaned meals and events from the stored entries (adds, updates, and removes what no longer follows). */
export async function rebuildGluroo(): Promise<{ meals: number; events: number; quick: number }> {
  const entries = await loadEntries();
  if (!entries.length) return { meals: 0, events: 0, quick: 0 };
  const first = entries[0].t - 3600000, last = entries[entries.length - 1].t + 3600000;
  const s = await fetchSeries(first, last);
  const readings: Reading[] = Array.from(s.t, (t, i) => ({ t, mg: s.v[i], tr: null }));
  const d = derive(entries, readings);
  // the sensors named in the export (a new serial starts a new accuracy profile)
  for (const e of entries) {
    const sn = e.type === 'NEW_SENSOR' ? /sn:(\S+)/.exec(e.raw.text ?? '')?.[1] : null;
    if (sn) await supabase.from('sensors').upsert({ sn, started_at: new Date(e.t).toISOString(), days: null, source: 'gluroo' }, { onConflict: 'sn', ignoreDuplicates: true });
  }

  // events: stable ids from the entry key
  const evRows = await Promise.all(d.events.map(async (e) => ({
    client_id: await uuid5(e.key), kind: e.kind, occurred_at: new Date(e.t).toISOString(), source: 'gluroo',
    note: `Gluroo · ${GLUROO_SENDERS[e.sender] ?? e.sender}`,
    insulin_units: e.insulin_units ?? null, insulin_type: e.insulin_type ?? null, bolus_purpose: e.bolus_purpose ?? null,
    carbs_g: e.carbs_g ?? null, treatment: e.treatment ?? null, bg_mgdl: e.bg_mgdl ?? null,
  })));
  // an entry a parent edited by hand is theirs now: never overwritten or removed by a re-sync
  const { data: oldEv } = await supabase.from('events').select('id,client_id,edited_at').eq('source', 'gluroo');
  const editedEv = new Set((oldEv ?? []).filter((e: { edited_at: string | null }) => e.edited_at).map((e: { client_id: string }) => e.client_id));
  const evPut = evRows.filter((e) => !editedEv.has(e.client_id));
  if (evPut.length) { const { error } = await supabase.from('events').upsert(evPut, { onConflict: 'client_id' }); if (error) throw new Error(error.message); }
  const keepEv = new Set([...evRows.map((e) => e.client_id), ...editedEv]);
  const dropEv = (oldEv ?? []).filter((e: { client_id: string }) => !keepEv.has(e.client_id)).map((e: { id: string }) => e.id);
  if (dropEv.length) await supabase.from('events').delete().in('id', dropEv);

  // meals: one row per group, keyed by its first entry
  const meals = d.meals.map((m) => ({
    kind: m.kind, recipe_id: null, name: m.name, category: 'Gluroo', eaten_at: new Date(m.t).toISOString(),
    total_carbs: m.carbs, total_fat: m.fat, total_fiber: null, total_protein: m.protein, total_kcal: m.kcal, modified: true,
    lines: m.items.map((i): HistoryLine => ({ name: i.food_name ?? '', product: null, quantity: 1, unit: 'serving', state: 'as_is', role: 'main', carbs: i.carbs })),
    notes: `Gluroo · ${m.senders.join(', ')}`, needs_review: m.uncertain,
    glucose_mgdl: m.glucose?.mg ?? null, glucose_trend: null, glucose_at: m.glucose ? new Date(m.glucose.t).toISOString() : null,
    source: 'gluroo', source_key: m.key,
  }));
  const { data: oldMeals } = await supabase.from('meal_history').select('id,source_key,edited_at').eq('source', 'gluroo');
  const editedM = new Set((oldMeals ?? []).filter((m: { edited_at: string | null }) => m.edited_at).map((m: { source_key: string }) => m.source_key));
  const mealPut = meals.filter((m) => !editedM.has(m.source_key));
  if (mealPut.length) { const { error } = await supabase.from('meal_history').upsert(mealPut, { onConflict: 'source_key' }); if (error) throw new Error(error.message); }
  const keepM = new Set([...meals.map((m) => m.source_key), ...editedM]);
  const dropM = (oldMeals ?? []).filter((m: { source_key: string }) => !keepM.has(m.source_key)).map((m: { id: string }) => m.id);
  if (dropM.length) await supabase.from('meal_history').delete().in('id', dropM);

  // quick items: only names the family does not have yet (their edits are kept)
  const { data: have } = await supabase.from('quick_items').select('name');
  const known = new Set((have ?? []).map((q: { name: string }) => q.name));
  const fresh = d.quick.filter((q) => !known.has(q.name)).map((q) => ({
    name: q.name, carbs: q.carbs, fat: q.fat, protein: q.protein, kcal: q.kcal, kind: q.kind, barcode: q.barcode,
    note: `Gluroo: ${q.values.join(' / ')}`, source: 'gluroo', uses: q.uses, last_used: new Date(q.last).toISOString(),
  }));
  if (fresh.length) { const { error } = await supabase.from('quick_items').insert(fresh); if (error) throw new Error(error.message); }
  return { meals: meals.length, events: evRows.length, quick: fresh.length };
}
