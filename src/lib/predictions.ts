// Keeps carb.predictions up to date from the app: freezes a prediction for each new meal or dose (15 minutes after
// it, so a dose given just after the meal is part of it), and fills the 1 h / 2 h / end checks as they pass.
// Runs when Now or Status opens; the database's unique key stops two phones from making the same one twice.
import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from './supabase';
import { useData } from './data';
import { fetchSeries } from '../engine/useSeries';
import { entriesFrom, fillChecks, predict, readingNear, triggers, PLAN_AFTER, type Check, type CheckKey } from '../engine/predict';
import type { Settings } from './types';

const DAY = 86400000, BACK = 14 * DAY;
export interface PredictionRow {
  id: string; key: string; t0: string; name: string | null; recipe_id: string | null;
  carbs: number; units: number; start_mg: number;
  params: { cr: number; isf: number; dia: number; peak: number; absorb: number; onboard_iob: number; onboard_cob: number };
  curve: number[]; end_min: number; checks: Partial<Record<CheckKey, Check>>; excluded: string | null; done: boolean;
}

let lastRun = 0;

export async function syncPredictions(s: Settings, history: Parameters<typeof entriesFrom>[0], events: Parameters<typeof entriesFrom>[1], sensorStartedAt: number | null, force = false) {
  const now = Date.now();
  if (!force && now - lastRun < 5 * 60000) return;
  lastRun = now;
  if (!s.iob_dia_min || !s.iob_peak_min || !s.cob_absorb_min || !(s.ratios ?? []).length) return;
  const model = { iob: { dia: s.iob_dia_min, peak: s.iob_peak_min }, absorb: s.cob_absorb_min, ratios: s.ratios };
  const [{ data: rows }, series] = await Promise.all([
    supabase.from('predictions').select('*').gte('t0', new Date(now - BACK - DAY).toISOString()),
    fetchSeries(now - BACK - DAY, now),
  ]);
  const t = Array.from(series.t), v = Array.from(series.v);
  const have = new Map(((rows ?? []) as PredictionRow[]).map((r) => [r.key, r]));
  const entries = entriesFrom(history, events);

  const fresh = [];
  for (const tr of triggers(entries)) {
    if (have.has(tr.key) || tr.t < now - BACK || tr.t > now - PLAN_AFTER) continue;
    const start = readingNear(t, v, tr.t);
    if (start === null) continue;
    const p = predict(tr, entries, start, model);
    if (!p) continue;
    const day1 = sensorStartedAt !== null && tr.t >= sensorStartedAt && tr.t - sensorStartedAt < DAY;
    const { checks, done } = fillChecks({ ...p, checks: {} }, entries, t, v, now);
    fresh.push({ ...p, t0: new Date(p.t0).toISOString(), checks, done, excluded: day1 ? 'sensor_day1' : null });
  }
  if (fresh.length) await supabase.from('predictions').upsert(fresh, { onConflict: 'key', ignoreDuplicates: true });

  for (const r of have.values()) {
    if (r.done) continue;
    const { checks, done } = fillChecks({ ...r, t0: Date.parse(r.t0) }, entries, t, v, now);
    if (done || JSON.stringify(checks) !== JSON.stringify(r.checks)) await supabase.from('predictions').update({ checks, done }).eq('id', r.id);
  }
}

/** Predictions of the last two weeks, newest first, brought up to date when the screen opens. */
export function usePredictions(sensorStartedAt: number | null) {
  const { settings, history, events } = useData();
  const [rows, setRows] = useState<PredictionRow[] | null>(null);
  const first = useRef(true);
  const load = useCallback(async () => {
    const { data } = await supabase.from('predictions').select('*').gte('t0', new Date(Date.now() - BACK).toISOString()).order('t0', { ascending: false });
    setRows(((data ?? []) as PredictionRow[]).map((r) => ({ ...r, carbs: Number(r.carbs), units: Number(r.units) })));
  }, []);
  useEffect(() => {
    let live = true;
    const force = first.current; first.current = false; // a full check when the screen opens, then at most every 5 min
    syncPredictions(settings, history, events, sensorStartedAt, force).catch(() => {}).finally(() => { if (live) void load(); });
    return () => { live = false; };
  }, [settings, history, events, sensorStartedAt, load]);
  return rows;
}
