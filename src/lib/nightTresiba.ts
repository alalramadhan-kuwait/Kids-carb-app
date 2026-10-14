// Loads what Analysis → Night needs: the readings of the last month, with the log the app already holds. Read only:
// nothing is written. Worked out again every time the page or the visit report opens, so it follows each new night.
import { useEffect, useMemo, useState } from 'react';
import { useData } from './data';
import { fetchSeries } from '../engine/useSeries';
import { nightReport, type NightReport } from '../engine/nightTresiba';
import type { Series } from '../engine/series';

const DAY = 86400000;
export const NIGHT_DAYS = 30;

export function useNightReport(): { report: NightReport | null; series: Series | null; error: string | null } {
  const { history, events } = useData();
  const [series, setSeries] = useState<Series | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [now] = useState(() => Date.now());
  useEffect(() => {
    let live = true;
    fetchSeries(now - (NIGHT_DAYS + 2) * DAY, now).then((s) => { if (live) setSeries(s); }, (e) => { if (live) setError((e as Error).message); });
    return () => { live = false; };
  }, [now]);
  const report = useMemo(() => (series ? nightReport({ series, history, events, from: now - NIGHT_DAYS * DAY, now }) : null), [series, history, events, now]);
  return { report, series, error };
}
