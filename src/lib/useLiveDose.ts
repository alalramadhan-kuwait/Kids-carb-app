// The dose calculator's live inputs, shared by «سجّل ← إنسولين سريع» and the planned-meal check so both always agree:
// the latest reading (refreshed every minute), the arrow (the lower of the app's and Libre's), insulin still working,
// the last rapid dose, and the doctor's plan from Settings. The answer is engine/dose.ts's.
import { useEffect, useMemo, useState } from 'react';
import { useData } from './data';
import { callGlucose } from './api';
import type { GlucoseState } from './glucose';
import { kuwaitClock } from './schedule';
import { dosesFrom, iobAt, iobParamsOk } from '../engine/iob';
import { ratioAt } from '../engine/status';
import { suggestDose } from '../engine/dose';
import { levelFromLibre, trendFrom } from '../engine/trend';
import type { DoseCalc } from './types';

const MIN = 60000;
/** Of the app's arrow and Libre's, the one pointing lower: no dose if either says falling fast. */
const cautious = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));

export function useLiveDose(carbs: number) {
  const { settings: s, events } = useData();
  const [g, setG] = useState<GlucoseState | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => { setNow(Date.now()); callGlucose({ action: 'status' }).then(setG).catch(() => setG(null)); };
    load();
    const id = setInterval(load, MIN);
    return () => clearInterval(id);
  }, []);
  const doses = useMemo(() => dosesFrom(events), [events]);
  const lastRapidAt = doses.reduce<number | null>((m, d) => (d.t <= now && (m === null || d.t > m) ? d.t : m), null);
  const iobP = s.iob_dia_min && s.iob_peak_min ? { dia: s.iob_dia_min, peak: s.iob_peak_min } : null;
  const iob = iobParamsOk(iobP) ? iobAt(now, doses, iobP) : null;
  const ratio = ratioAt(s.ratios ?? [], kuwaitClock(now).min);
  const target = s.target_mgdl !== null && s.target_high_mgdl !== null ? { low: s.target_mgdl, high: s.target_high_mgdl } : null;
  const latest = g?.latest ?? null;
  const level = latest ? cautious((g ? trendFrom(g.readings, now) : null)?.level ?? null, levelFromLibre(latest.trend)) : null;
  const r = suggestDose({
    now, carbs, ratio, target, lowMg: s.alert_low_mgdl ?? s.glucose_low_mgdl,
    glucose: latest ? { mg: latest.mg_dl, at: Date.parse(latest.taken_at), level } : null,
    sensorStartedAt: g?.sensor?.started_at ? Date.parse(g.sensor.started_at) : null,
    iob, lastRapidAt, gapMin: s.dose_gap_min ?? 120, step: s.pen_step ?? 1,
  });
  /** What the calculator showed, kept with the logged dose. */
  const calc = (): DoseCalc | null => (r.block || !latest || !ratio || !target ? null : {
    suggested: r.dose, carbs, glucose: latest.mg_dl, iob: Math.round((iob ?? 0) * 100) / 100, cr: ratio.cr, isf: ratio.isf,
    target: [target.low, target.high], food: Math.round(r.food * 100) / 100, correction: Math.round(r.correction * 100) / 100,
  });
  const purpose: 'meal' | 'correction' | 'both' = r.food > 0 && r.correction > 0 ? 'both' : r.food > 0 ? 'meal' : 'correction';
  return { ready: g !== null, g, now, latest, level, iob, ratio, target, r, calc, purpose };
}
