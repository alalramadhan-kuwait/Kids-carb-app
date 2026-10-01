// Which arrow the screens show: Libre's, unless the running comparison (Status → «أي سهم أدق؟») shows the
// app's own arrow clearly more accurate. The comparison is redone at most every 6 hours and kept on the phone.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { arrowWinner, compareArrows, levelFromLibre, type ArrowComparison, type Level, type Trend } from '../engine/trend';

const KEY = 'carb-arrow-choice-v1', DAYS = 14, STALE = 6 * 3600000;
export type ArrowSource = 'ours' | 'libre';
interface Stored { source: ArrowSource; at: number; c: ArrowComparison | null }

function read(): Stored {
  try { const j = JSON.parse(localStorage.getItem(KEY) ?? 'null'); if (j && (j.source === 'ours' || j.source === 'libre')) return j; } catch { /* none */ }
  return { source: 'libre', at: 0, c: null };
}
export const arrowSource = (): ArrowSource => read().source;

let running: Promise<Stored> | null = null;
export function refreshArrowChoice(force = false): Promise<Stored> {
  const s = read();
  if (!force && Date.now() - s.at < STALE) return Promise.resolve(s);
  running ??= (async () => {
    const now = Date.now();
    const { data, error } = await supabase.rpc('glucose_series_arrows', { p_from: new Date(now - DAYS * 86400000).toISOString(), p_to: new Date(now).toISOString() });
    if (error || !data) return s;
    const d = data as { t: number[]; v: number[]; a: (number | null)[] };
    const c = compareArrows(d.t.map((x) => x * 1000), d.v, d.a, now);
    const next: Stored = { source: arrowWinner(c) === 'ours' ? 'ours' : 'libre', at: now, c };
    try { localStorage.setItem(KEY, JSON.stringify(next)); } catch { /* the choice is just recomputed next time */ }
    return next;
  })().finally(() => { running = null; });
  return running;
}

/** The current choice, refreshed in the background when it is older than 6 hours. */
export function useArrowChoice() {
  const [s, setS] = useState<Stored>(read);
  useEffect(() => { let live = true; refreshArrowChoice().then((x) => { if (live) setS(x); }).catch(() => {}); return () => { live = false; }; }, []);
  return s;
}

/** The step to show, and the other arrow when it says something different. */
export function shownLevel(trend: Trend | null, libre: number | null, source: ArrowSource): { level: Level | null; from: ArrowSource; other: { from: ArrowSource; level: Level } | null } {
  const lib = levelFromLibre(libre), ours = trend?.level ?? null;
  const pick: ArrowSource = source === 'ours' ? (ours !== null ? 'ours' : 'libre') : lib !== null ? 'libre' : 'ours';
  const level = pick === 'ours' ? ours : lib;
  const otherLevel = pick === 'ours' ? lib : ours;
  const same = level !== null && otherLevel !== null && Math.max(-2, Math.min(2, level)) === Math.max(-2, Math.min(2, otherLevel));
  return { level, from: pick, other: otherLevel !== null && !same ? { from: pick === 'ours' ? 'libre' : 'ours', level: otherLevel } : null };
}
