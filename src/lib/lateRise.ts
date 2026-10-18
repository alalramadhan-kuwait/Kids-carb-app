// Meal names that rose late in Layan's own readings (carb.late_rise_meals), loaded once per app start. Used only to
// show «ممكن تأثير متأخر» on more meals; it never changes a dose. On any error the set stays empty.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { mealKey } from '../engine/iob';

let cache: Promise<Set<string>> | null = null;
const load = () => (cache ??= Promise.resolve(supabase.rpc('late_rise_meals')).then(({ data, error }) => {
  if (error) { cache = null; return new Set<string>(); }
  return new Set(((data ?? []) as { name: string }[]).map((r) => mealKey(r.name)));
}, () => { cache = null; return new Set<string>(); }));

export function useLateRise() {
  const [set, setSet] = useState<Set<string>>(() => new Set());
  useEffect(() => { let on = true; load().then((s) => { if (on) setSet(s); }); return () => { on = false; }; }, []);
  return set;
}
