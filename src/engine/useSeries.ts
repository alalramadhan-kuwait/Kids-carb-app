import { useCallback, useEffect, useRef, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { Reading } from '../lib/glucose';
import { emptySeries, mergeSeries, type Series } from './series';

/**
 * Readings for the timeline, loaded lazily as the view moves and kept in memory (one contiguous loaded range,
 * grown in both directions). Live readings from useGlucose are merged in as they arrive.
 */
export function useSeries(start: number, end: number, live: Reading[] | undefined) {
  const [series, setSeries] = useState<Series>(emptySeries);
  const [loading, setLoading] = useState(false);
  const loaded = useRef<{ lo: number; hi: number } | null>(null);
  const busy = useRef(false);

  const fetchRange = useCallback(async (from: number, to: number) => {
    const { data, error } = await supabase.rpc('glucose_series', { p_from: new Date(from).toISOString(), p_to: new Date(to).toISOString() });
    if (error) throw new Error(error.message);
    const d = data as { t: number[]; v: number[] };
    return { t: d.t.map((s) => s * 1000), v: d.v };
  }, []);

  useEffect(() => {
    if (busy.current) return;
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
      })
      .catch(() => { /* shown as a gap; retried on the next move */ })
      .finally(() => { busy.current = false; setLoading(false); });
  }, [start, end, fetchRange, loading]);

  useEffect(() => {
    if (!live?.length) return;
    setSeries((s) => mergeSeries(s, live.map((r) => Date.parse(r.taken_at)), live.map((r) => r.mg_dl)));
  }, [live]);

  return { series, loading };
}
