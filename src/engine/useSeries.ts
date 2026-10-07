import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Reading } from '../lib/glucose';
import { emptySeries, mergeSeries, type Series } from './series';

/** One fetch of readings in [from, to) as a Series (epoch ms, mg/dL). */
export async function fetchSeries(from: number, to: number): Promise<Series> {
  const { data, error } = await supabase.rpc('glucose_series', { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
  if (error) throw new Error(error.message);
  const d = data as { t: number[]; v: number[] };
  return { t: Float64Array.from(d.t, (s) => s * 1000), v: Float64Array.from(d.v) };
}

/**
 * Readings for the timeline, loaded lazily as the view moves and kept in memory (one contiguous loaded range,
 * grown in both directions). Live readings from useGlucose are merged in as they arrive.
 */
export function useSeries(start: number, end: number, live: Reading[] | undefined) {
  const [series, setSeries] = useState<Series>(emptySeries);
  const [loading, setLoading] = useState(false);
  const loaded = useRef<{ lo: number; hi: number } | null>(null);
  const busy = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [kick, setKick] = useState(0);              // bumped to try again (after a wait, a tap, or the phone waking up)
  const fails = useRef(0), notBefore = useRef(0);

  const fetchRange = useCallback(async (from: number, to: number) => {
    const { data, error } = await supabase.rpc('glucose_series', { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
    if (error) throw new Error(error.message);
    const d = data as { t: number[]; v: number[] };
    return { t: d.t.map((s) => s * 1000), v: d.v };
  }, []);

  useEffect(() => {
    if (busy.current || Date.now() < notBefore.current) return;
    const span = end - start, now = Date.now();
    const L = loaded.current;
    let want: [number, number] | null = null;
    if (!L) want = [start - span, now + 60000];
    else if (start < L.lo) want = [Math.max(start - span, L.lo - 99 * 86400000), L.lo];
    if (!want) return;
    busy.current = true; setLoading(true);
    fetchRange(want[0], want[1])
      .then((r) => {
        setSeries((s) => mergeSeries(s, r.t, r.v));
        loaded.current = { lo: Math.min(want![0], L?.lo ?? Infinity), hi: Math.max(want![1], L?.hi ?? 0) };
        fails.current = 0; notBefore.current = 0; setError(null);
      })
      .catch((e) => {
        // not silent, not a tight loop: say why, wait 3 s, 6 s, 12 s… (at most a minute) and try again
        fails.current += 1; setError((e as Error).message || 'error');
        const wait = Math.min(60000, 3000 * 2 ** (fails.current - 1));
        notBefore.current = Date.now() + wait; window.setTimeout(() => setKick((k) => k + 1), wait + 50);
      })
      .finally(() => { busy.current = false; setLoading(false); });
  }, [start, end, fetchRange, loading, kick]);

  const retry = useCallback(() => { fails.current = 0; notBefore.current = 0; loaded.current = null; setKick((k) => k + 1); }, []);

  // a phone that has been asleep, or just got its network back, loads the readings again (merging never duplicates)
  useEffect(() => {
    const again = () => { if (document.visibilityState === 'visible') retry(); };
    document.addEventListener('visibilitychange', again); window.addEventListener('online', again);
    return () => { document.removeEventListener('visibilitychange', again); window.removeEventListener('online', again); };
  }, [retry]);

  useEffect(() => {
    if (!live?.length) return;
    setSeries((s) => mergeSeries(s, live.map((r) => Date.parse(r.taken_at)), live.map((r) => r.mg_dl)));
  }, [live]);

  return { series, loading, error, retry };
}
