// IOB / COB tracks and forecast lines for a glucose graph (Now and Analysis). Display only.
import { useMemo } from 'react';
import { useData } from '../lib/data';
import { activityAt, activityFraction, activityPeaks, carbsFrom, cobAt, dosesFrom, iobAt, iobParamsOk } from '../engine/iob';
import { onboardForecast, pastForecasts, trendForecast, type Forecast } from '../engine/forecast';
import { ratioAt } from '../engine/status';
import { kuwaitClock } from '../lib/schedule';
import type { Tracks } from '../engine/Timeline';
import type { Series } from '../engine/series';
import type { PredictionRow } from '../lib/predictions';

export function useGraphExtras({ series, now, iob, cob, act = false, forecast, projected30, past, start, end }: {
  series: Series; now: number; iob: boolean; cob: boolean; act?: boolean; forecast: boolean; projected30: number | null;
  past?: PredictionRow[] | null; start: number; end: number;
}) {
  const { settings: s, history, events } = useData();
  const iobP = s.iob_dia_min && s.iob_peak_min ? { dia: s.iob_dia_min, peak: s.iob_peak_min } : null;
  const iobOk = iobParamsOk(iobP), cobOk = !!s.cob_absorb_min;
  const doses = useMemo(() => dosesFrom(events), [events]);
  const carbs = useMemo(() => carbsFrom(history, events), [history, events]);

  const tracks = useMemo<Tracks | undefined>(() => {
    const t: Tracks = {};
    if (iob && iobOk) t.iob = (x) => iobAt(x, doses, iobP!);
    if (cob && cobOk) t.cob = (x) => cobAt(x, carbs, s.cob_absorb_min!);
    // activity: peaks found once per view (minute by minute); scaled so 1 unit at its peak fills the band
    if (act && iobOk) t.act = { at: (x) => activityAt(x, doses, iobP!), peaks: activityPeaks(doses, iobP!, start - iobP!.dia * 60000, Math.max(end, now) + iobP!.dia * 60000), ref: 60 * activityFraction(iobP!.peak, iobP!) };
    return t.iob || t.cob || t.act ? t : undefined;
  }, [iob, cob, act, Math.floor(start / 600000), Math.floor(end / 600000), iobOk, cobOk, doses, carbs, s.iob_dia_min, s.iob_peak_min, s.cob_absorb_min]); // eslint-disable-line react-hooks/exhaustive-deps

  const n = series.t.length;
  const last = n ? { t: series.t[n - 1], v: series.v[n - 1] } : null;
  const lastKey = last ? `${last.t}:${last.v}` : '';
  const live = useMemo(() => {
    if (!forecast) return [] as Forecast[];
    const ratio = ratioAt(s.ratios ?? [], kuwaitClock(now).min);
    return [onboardForecast(last, now, doses, carbs, iobOk ? iobP : null, s.cob_absorb_min, ratio), trendForecast(last, projected30, now)]
      .filter((f): f is Forecast => !!f);
  }, [forecast, lastKey, Math.floor(now / 60000), doses, carbs, projected30, s.ratios, s.cob_absorb_min, iobOk]); // eslint-disable-line react-hooks/exhaustive-deps
  const old = useMemo(() => (forecast && past ? pastForecasts(past, start, end) : []), [forecast, past, start, end]);
  const forecasts = useMemo(() => [...old, ...live], [old, live]);
  // room ahead of now for the lines: up to 40 minutes, never more than a quarter of the view
  const ahead = forecast ? 0.25 : tracks ? 0.12 : 0.04;
  return { tracks, forecasts, ahead };
}
