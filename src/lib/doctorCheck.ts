// Loads what "The doctor's numbers vs reality" needs: the frozen predictions of the last 30 days (the ones the app
// already made at each dose), the readings, and the finger-prick comparisons. Read only: nothing is written here.
import { useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { useData } from './data';
import { fetchSeries } from '../engine/useSeries';
import { entriesFrom } from '../engine/predict';
import { doctorCheck, type DoctorCheck, type PredIn } from '../engine/doctorCheck';
import { effectiveRange } from './glucose';
import type { Series } from '../engine/series';

const DAY = 86400000;
interface Raw { preds: PredIn[]; series: Series; comparisons: { t: number; diff: number | null; cause: string }[] }

export function useDoctorCheck(sensorStartedAt: number | null): { check: DoctorCheck | null; error: string | null } {
  const { settings, history, events } = useData();
  const [raw, setRaw] = useState<Raw | null>(null);
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    let live = true;
    const now = Date.now();
    Promise.all([
      supabase.from('predictions').select('key,t0,name,carbs,units,start_mg,params,curve,end_min,checks,excluded').gte('t0', new Date(now - 31 * DAY).toISOString()),
      fetchSeries(now - 32 * DAY, now),
      supabase.from('bg_comparisons').select('taken_at,diff_mgdl,cause').gte('taken_at', new Date(now - 34 * DAY).toISOString()),
    ]).then(([p, series, c]) => {
      if (!live) return;
      if (p.error) throw new Error(p.error.message);
      const preds = (p.data ?? []).map((r: any): PredIn => ({ ...r, t0: Date.parse(r.t0), carbs: Number(r.carbs), units: Number(r.units), start_mg: Number(r.start_mg) }));
      const comparisons = (c.data ?? []).map((r: any) => ({ t: Date.parse(r.taken_at), diff: r.diff_mgdl == null ? null : Number(r.diff_mgdl), cause: String(r.cause ?? '') }));
      setRaw({ preds, series, comparisons });
    }).catch((e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, []);
  const check = useMemo(() => {
    if (!raw) return null;
    const now = Date.now();
    const makeup = new Map(history.map((h) => ['h:' + h.id, { fat: h.total_fat == null ? null : Number(h.total_fat), protein: h.total_protein == null ? null : Number(h.total_protein) }]));
    const long = events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_type === 'long').map((e) => ({ t: Date.parse(e.occurred_at), units: e.insulin_units }));
    const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
    return doctorCheck({
      preds: raw.preds, entries: entriesFrom(history, events), makeup, long, series: raw.series, comparisons: raw.comparisons,
      sensor: sensorStartedAt ? { startedAt: sensorStartedAt, days: settings.sensor_days ?? 14 } : null, lowMg: rng.low ?? 70, now,
    });
  }, [raw, history, events, settings, sensorStartedAt]);
  return { check, error };
}
