// Finger-prick comparisons in the database: started when a test is logged, completed once the readings 5 and 10
// minutes later are in, kept per sensor. Nothing here changes a displayed reading or a dose.
import { useCallback, useEffect, useState } from 'react';
import { supabase } from './supabase';
import { compareFingerprick, type FpResult } from '../engine/fingerprick';
import type { EventRow, HistoryEntry } from './types';

const MIN = 60000, DAY = 86400000;
export interface SensorRow { sn: string; started_at: string; days: number | null; source: string | null }
export interface ComparisonRow extends FpResult { event_id: string; taken_at: string; bg_mgdl: number; entered_late_min: number | null; hands_clean: boolean | null }

/** Keeps the sensor list current (from LibreLinkUp or an import); a new serial starts a new accuracy profile. */
export async function rememberSensor(sn: string, startedAt: string, days: number | null, source: string) {
  await supabase.from('sensors').upsert({ sn, started_at: startedAt, days, source }, { onConflict: 'sn', ignoreDuplicates: true });
}

/** Called right after a finger-prick is logged: what only the parent knows at that moment. */
export async function startComparison(eventId: string, takenAt: number, bg: number, enteredLateMin: number, handsClean: boolean) {
  await supabase.from('bg_comparisons').upsert({ event_id: eventId, taken_at: new Date(takenAt).toISOString(), bg_mgdl: bg, entered_late_min: enteredLateMin, hands_clean: handsClean, complete: false });
}

let running = false;
/** Fills or completes the comparison for every finger-prick of the last 31 days that is not complete yet. */
export async function syncComparisons(events: EventRow[], history: HistoryEntry[]) {
  if (running) return; running = true;
  try {
    const now = Date.now();
    const tests = events.filter((e) => e.kind === 'bg_check' && !e.deleted_at && e.bg_mgdl && now - Date.parse(e.occurred_at) < 31 * DAY);
    if (!tests.length) return;
    const [{ data: have }, { data: sensors }] = await Promise.all([
      supabase.from('bg_comparisons').select('event_id,complete,entered_late_min,hands_clean').in('event_id', tests.map((e) => e.id)),
      supabase.from('sensors').select('*').order('started_at'),
    ]);
    const known = new Map((have ?? []).map((h: { event_id: string; complete: boolean; entered_late_min: number | null; hands_clean: boolean | null }) => [h.event_id, h]));
    const todo = tests.filter((e) => !known.get(e.id)?.complete);
    if (!todo.length) return;
    const times = todo.map((e) => Date.parse(e.occurred_at));
    const from = Math.min(...times) - 25 * MIN, to = Math.min(now, Math.max(...times) + 15 * MIN);
    const { data, error } = await supabase.rpc('glucose_series_arrows', { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
    if (error || !data) return;
    const d = data as { t: number[]; v: number[]; a: (number | null)[] };
    const readings = d.t.map((s, i) => ({ t: s * 1000, v: d.v[i], a: d.a[i] }));
    const meals = [...history.map((h) => Date.parse(h.eaten_at)), ...events.filter((e) => !e.deleted_at && (e.kind === 'carbs' || e.kind === 'treatment')).map((e) => Date.parse(e.occurred_at))].sort((a, b) => a - b);
    const doses = events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_type !== 'long').map((e) => Date.parse(e.occurred_at)).sort((a, b) => a - b);
    const last = (list: number[], t: number) => { let x: number | null = null; for (const v of list) if (v <= t) x = v; return x; };
    const rows = todo.map((e) => {
      const t = Date.parse(e.occurred_at), k = known.get(e.id);
      const s = ((sensors ?? []) as SensorRow[]).filter((x) => Date.parse(x.started_at) <= t).pop();
      const r = compareFingerprick({
        t, bg: e.bg_mgdl!, enteredLateMin: k?.entered_late_min ?? null, handsClean: k?.hands_clean ?? null, readings,
        sensor: s && t - Date.parse(s.started_at) < 16 * DAY ? { sn: s.sn, startedAt: Date.parse(s.started_at) } : null,
        lastMeal: last(meals, t), lastInsulin: last(doses, t), now,
      });
      return {
        event_id: e.id, taken_at: e.occurred_at, bg_mgdl: e.bg_mgdl!, entered_late_min: k?.entered_late_min ?? null, hands_clean: k?.hands_clean ?? null,
        ...r, libre_now_at: r.libre_now_at ? new Date(r.libre_now_at).toISOString() : null, computed_at: new Date().toISOString(),
      };
    });
    await supabase.from('bg_comparisons').upsert(rows, { onConflict: 'event_id' });
  } finally { running = false; }
}

export function useComparisons(events: EventRow[], history: HistoryEntry[]) {
  const [rows, setRows] = useState<ComparisonRow[] | null>(null);
  const [sensors, setSensors] = useState<SensorRow[]>([]);
  const load = useCallback(async () => {
    const [{ data: c }, { data: s }] = await Promise.all([
      supabase.from('bg_comparisons').select('*').order('taken_at', { ascending: false }),
      supabase.from('sensors').select('*').order('started_at', { ascending: false }),
    ]);
    setRows(((c ?? []) as ComparisonRow[]).map((r) => ({ ...r, rate: r.rate === null ? null : Number(r.rate), diff_pct: r.diff_pct === null ? null : Number(r.diff_pct), libre_now_at: r.libre_now_at ? Date.parse(r.libre_now_at as unknown as string) : null })));
    setSensors((s ?? []) as SensorRow[]);
  }, []);
  useEffect(() => { syncComparisons(events, history).catch(() => {}).finally(() => void load()); }, [events, history, load]);
  return { rows, sensors, reload: load };
}
