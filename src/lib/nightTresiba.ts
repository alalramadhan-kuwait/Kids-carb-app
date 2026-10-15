// Loads what Analysis → Night needs: the readings of the last month, with the log the app already holds. Read only:
// nothing is written. Worked out again every time the page or the visit report opens, so it follows each new night.
import { useEffect, useMemo, useState } from 'react';
import { useData } from './data';
import { fetchSeries } from '../engine/useSeries';
import { nightReport, type NightReport } from '../engine/nightTresiba';
import type { Series } from '../engine/series';
import { lastNight, type LastNight } from '../engine/nightGrid';
import { dayStartOf } from '../engine/day';

const DAY = 86400000, HOUR = 3600000;
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

/** Last night's 00:00–07:00 for the home screens, from 07:00 to 13:00: its own readings, fetched once. */
export function useLastNight(): LastNight | null {
  const { events } = useData();
  const [now, setNow] = useState(() => Date.now());
  const [series, setSeries] = useState<Series | null>(null);
  const from = dayStartOf(now), show = now >= from + 7 * HOUR && now < from + 13 * HOUR;
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 5 * 60000); return () => window.clearInterval(id); }, []);
  useEffect(() => {
    if (!show) return;
    let live = true;
    fetchSeries(from, from + 7 * HOUR).then((s) => { if (live) setSeries(s); }, () => undefined);
    return () => { live = false; };
  }, [from, show]);
  return useMemo(() => (show && series ? lastNight(series, events, now) : null), [show, series, events, now]);
}
