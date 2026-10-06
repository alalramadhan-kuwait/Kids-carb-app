// Alarms in the Log (the doctor's request): which alarms are shown, how alarms that follow each other become one
// episode ("low expected → low → urgent low → back in range"), and which entries belong to each episode, so the
// timeline reads from the alarm, through what was given, to when it ended. Pure, so it is tested.
import type { AlertKind, AlertRow } from '../lib/types';

const MIN = 60000;
export const AFTER_MIN = 30;   // an entry up to this long after the episode ends still belongs to it (the juice, the recheck)
export const JOIN_MIN = 15;    // alarms of the same direction this close together are one episode

export type Direction = 'low' | 'high' | 'data';
export const DIRECTION: Record<AlertKind, Direction> = {
  urgent_low: 'low', low: 'low', predicted_low: 'low', rapid_fall: 'low', high: 'high', rapid_rise: 'high', no_data: 'data',
};
/** Shown by default; the early warnings (rising or falling fast, low expected) only with «all alarms». */
export const MAIN_KINDS: AlertKind[] = ['urgent_low', 'low', 'high', 'no_data'];
const SEVERITY: Record<AlertKind, number> = { urgent_low: 5, low: 4, high: 4, no_data: 3, predicted_low: 2, rapid_fall: 1, rapid_rise: 1 };

/** Only alarms that actually alarmed (a pending one that cleared before its delay never reached anyone). */
export const alarmed = (a: AlertRow) => a.active_at !== null;
export const startOf = (a: AlertRow) => Date.parse(a.started_at);
export const endOf = (a: AlertRow, now: number) => (a.resolved_at ? Date.parse(a.resolved_at) : now);

export interface Episode {
  id: string; dir: Direction; start: number; end: number; open: boolean;
  alarms: AlertRow[];      // in order of start
  main: AlertKind;         // the most serious kind in it
  worst: number | null;    // lowest (low) or highest (high) value in mg/dL
  ack: AlertRow | null;    // the first alarm someone acknowledged
}

export function episodes(alerts: AlertRow[], o: { all?: boolean; now?: number } = {}): Episode[] {
  const now = o.now ?? Date.now();
  const list = alerts.filter((a) => alarmed(a) && (o.all || MAIN_KINDS.includes(a.kind))).sort((a, b) => startOf(a) - startOf(b));
  const out: Episode[] = [];
  for (const a of list) {
    const dir = DIRECTION[a.kind];
    const last = [...out].reverse().find((e) => e.dir === dir);
    if (last && startOf(a) <= last.end + JOIN_MIN * MIN) {
      last.alarms.push(a); last.end = Math.max(last.end, endOf(a, now)); last.open = last.open || !a.resolved_at;
      if (SEVERITY[a.kind] > SEVERITY[last.main]) last.main = a.kind;
    } else out.push({ id: a.id, dir, start: startOf(a), end: endOf(a, now), open: !a.resolved_at, alarms: [a], main: a.kind, worst: null, ack: null });
  }
  for (const e of out) {
    const vs = e.alarms.map((a) => a.worst_mgdl ?? a.value_mgdl).filter((v): v is number => v !== null);
    e.worst = !vs.length || e.dir === 'data' ? null : e.dir === 'low' ? Math.min(...vs) : Math.max(...vs);
    e.ack = e.alarms.find((a) => a.acknowledged_at) ?? null;
  }
  return out.sort((a, b) => b.start - a.start); // newest first, like the Log
}

/** The timeline: each episode with the entries that happened during it (up to AFTER_MIN after), and the entries
 *  outside any episode on their own, newest first. An entry belongs to at most one episode (the latest that holds it). */
export type TimelineItem<T> = { kind: 'episode'; t: number; ep: Episode; entries: T[] } | { kind: 'entry'; t: number; entry: T };
export function timeline<T extends { t: number }>(eps: Episode[], entries: T[]): TimelineItem<T>[] {
  const taken = new Set<T>();
  const items: TimelineItem<T>[] = eps.map((ep) => {
    const mine = entries.filter((x) => !taken.has(x) && x.t >= ep.start - MIN && x.t <= ep.end + AFTER_MIN * MIN).sort((a, b) => a.t - b.t);
    mine.forEach((x) => taken.add(x));
    return { kind: 'episode' as const, t: ep.start, ep, entries: mine };
  });
  for (const x of entries) if (!taken.has(x)) items.push({ kind: 'entry', t: x.t, entry: x });
  return items.sort((a, b) => b.t - a.t);
}
