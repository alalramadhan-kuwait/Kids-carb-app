// What Layan's own readings taught about a meal (carb.meal_learning): it dropped early, or rose late, at least twice.
// Loaded once per app start; used only for notices, never for a dose. On any error the map stays empty.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { Learned } from '../engine/iob';

type Row = { key: string; early: boolean; late: boolean; early_n: number; late_n: number };
let cache: Promise<Map<string, Learned>> | null = null;
const load = () => (cache ??= Promise.resolve(supabase.rpc('meal_learning')).then(({ data, error }) => {
  if (error) { cache = null; return new Map<string, Learned>(); }
  return new Map(((data ?? []) as Row[]).map((r) => [r.key, { early: r.early, late: r.late, earlyN: r.early_n, lateN: r.late_n }]));
}, () => { cache = null; return new Map<string, Learned>(); }));

export function useLateRise() {
  const [map, setMap] = useState<Map<string, Learned>>(() => new Map());
  useEffect(() => { let on = true; load().then((m) => { if (on) setMap(m); }); return () => { on = false; }; }, []);
  return map;
}
