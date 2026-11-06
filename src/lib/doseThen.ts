// What the doctor's settings gave at a moment in the past: her reading then and the insulin still working then
// (engine/doseAt, the same rules as the calculator). Shown beside a dose logged later, never as a verdict.
import { useEffect, useState } from 'react';
import { useData } from './data';
import { fetchSeries } from '../engine/useSeries';
import { doseAt, type DoseAt } from '../engine/doseAt';
import { dosesFrom } from '../engine/iob';

const MIN = 60000;
export function useDoseThen(at: number | null, carbs: number, enabled = true): DoseAt | null {
  const { events, settings: s } = useData();
  const [then, setThen] = useState<DoseAt | null>(null);
  useEffect(() => {
    if (!enabled || at === null || !Number.isFinite(at) || at > Date.now() + MIN) { setThen(null); return; }
    let on = true;
    void fetchSeries(at - 40 * MIN, at + MIN).then((sr) => {
      if (!on) return;
      setThen(doseAt({ at, carbs, t: sr.t, v: sr.v, doses: dosesFrom(events), ratios: s.ratios ?? [],
        target: s.target_mgdl !== null && s.target_high_mgdl !== null ? { low: s.target_mgdl, high: s.target_high_mgdl } : null,
        lowMg: s.alert_low_mgdl ?? s.glucose_low_mgdl, dia: s.iob_dia_min, peak: s.iob_peak_min, gapMin: s.dose_gap_min ?? 120,
        step: s.pen_step ?? 1, sensorStartedAt: null }));
    }).catch(() => on && setThen(null));
    return () => { on = false; };
  }, [enabled, at === null ? null : Math.floor(at / MIN), carbs, events]); // eslint-disable-line react-hooks/exhaustive-deps
  return then;
}
