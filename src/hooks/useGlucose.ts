import { useCallback, useEffect, useState } from 'react';
import { callGlucose } from '../lib/api';
import { mergeReading, type GlucoseState, type Reading } from '../lib/glucose';
import { supabase } from '../lib/supabase';

// The last answer is kept on the phone, so opening the app shows the glucose and the graph at once instead of
// waiting for the server. Its age is on screen like any reading's, so an old copy never passes for a live one.
const CACHE = 'carb-glucose-v1';
let memory: GlucoseState | null = null;
function cached(): GlucoseState | null {
  if (memory) return memory;
  try { const j = JSON.parse(localStorage.getItem(CACHE) ?? 'null'); return j && Array.isArray(j.readings) ? (memory = j) : null; } catch { return null; }
}
// signing out leaves no readings behind on the phone
supabase.auth.onAuthStateChange((event) => {
  if (event === 'SIGNED_OUT') { memory = null; try { localStorage.removeItem(CACHE); } catch { /* nothing stored */ } }
});
function remember(g: GlucoseState) {
  memory = g;
  try { localStorage.setItem(CACHE, JSON.stringify({ ...g, error: undefined })); } catch { /* storage full or blocked: only the cache is lost */ }
}

/** Live glucose: shown from the last copy at once, refreshed now and every minute while visible, pushed readings instantly (Realtime). */
export function useGlucose() {
  const [g, setG] = useState<GlucoseState | null>(cached);
  const [failed, setFailed] = useState(false);
  const [, tick] = useState(0);

  const load = useCallback(async () => {
    try { const r = await callGlucose({ action: 'read' }); remember(r); setG(r); setFailed(false); } catch { setFailed(true); }
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
          setG((cur) => { if (!cur) return cur; const next = mergeReading(cur, { taken_at: r.taken_at!, mg_dl: r.mg_dl!, trend: r.trend ?? null }); remember(next); return next; });
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
