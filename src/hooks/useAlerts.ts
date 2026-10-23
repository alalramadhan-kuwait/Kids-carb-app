import { useCallback, useEffect, useState } from 'react';
import { supabase } from '../lib/supabase';
import type { AlertRow } from '../lib/types';

/** Open alerts (active or acknowledged), live through Realtime, plus a reload for after an action. */
export function useAlerts() {
  const [open, setOpen] = useState<AlertRow[]>([]);
  const load = useCallback(async () => {
    const { data } = await supabase.from('alerts').select('*').in('state', ['active', 'acknowledged']).order('started_at', { ascending: false });
    setOpen((data ?? []) as AlertRow[]);
  }, []);
  useEffect(() => {
    load();
    const ch = supabase.channel('alerts-live').on('postgres_changes', { event: '*', schema: 'carb', table: 'alerts' }, () => load()).subscribe();
    const t = setInterval(load, 60000);
    const vis = () => document.visibilityState === 'visible' && load();
    document.addEventListener('visibilitychange', vis);
    return () => { supabase.removeChannel(ch); clearInterval(t); document.removeEventListener('visibilitychange', vis); };
  }, [load]);
  return { open, reload: load };
}
