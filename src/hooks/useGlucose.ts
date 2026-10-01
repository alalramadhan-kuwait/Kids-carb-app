import { useCallback, useEffect, useState } from 'react';
import { callGlucose } from '../lib/api';
import { mergeReading, type GlucoseState, type Reading } from '../lib/glucose';
import { supabase } from '../lib/supabase';

/** Live glucose: loads, re-checks every minute while visible, and takes pushed readings instantly (Realtime). */
export function useGlucose() {
  const [g, setG] = useState<GlucoseState | null>(null);
  const [failed, setFailed] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try { setG(await callGlucose({ action: 'read' })); setFailed(false); } catch { setFailed(true); }
  }, []);

  useEffect(() => {
    void load();
    const poll = window.setInterval(() => { if (document.visibilityState === 'visible') void load(); }, 60_000);
    const age = window.setInterval(() => tick((n) => n + 1), 20_000); // keeps "2 min ago" honest
    const vis = () => { if (document.visibilityState === 'visible') void load(); };
    document.addEventListener('visibilitychange', vis);
    const channel = supabase
      .channel('glucose-live')
      .on('postgres_changes', { event: '*', schema: 'carb', table: 'glucose_readings' }, (msg) => {
        const r = msg.new as Partial<Reading>;
        if (r?.taken_at && typeof r.mg_dl === 'number') {
          setG((cur) => (cur ? mergeReading(cur, { taken_at: r.taken_at!, mg_dl: r.mg_dl!, trend: r.trend ?? null }) : cur));
        }
      })
      .subscribe();
    return () => {
      window.clearInterval(poll); window.clearInterval(age); document.removeEventListener('visibilitychange', vis);
      void supabase.removeChannel(channel);
    };
  }, [load]);

  return { g, failed, reload: load };
}
