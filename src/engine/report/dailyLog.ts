// Clinical report engine, part 9: the Daily Log (LibreView's layout): one day at a time, its glucose curve with
// everything recorded that day, then the same records as a timed list. Each record shows the sensor glucose at that
// moment only when a stored reading lies within 8 minutes of it (the reading itself, never an estimate); otherwise
// it says there was none. Insulin is what was GIVEN. Low events are the report definition (events.ts), not the
// live alerts. Built on the Weekly Summary's day model, so the curves and totals are the same everywhere.
import { DAY, MIN, clean, nearestReading, type Reading } from './cgm';
import { glucoseEvents, type GlucoseEvent } from './events';
import { mmol } from './agpReport';
import { buildWeeklySummary, type WeeklyDay } from './weekly';
import type { FingerPrick, ReportInsulin, ReportMeal, ReportTreatment } from './days';

export interface ReportSensor { sn: string; started_at: string; days: number | null; source: string | null }

export type LogEntry = { at: number; minute: number; sensor: number | null /* mmol/L, stored reading within 8 min */ } & (
  | { kind: 'meal'; name: string | null; slot: string | null; carbs: number | null /* null: not known */ }
  | { kind: 'treatment'; name: string | null; carbs: number | null }
  | { kind: 'insulin'; units: number; type: 'rapid' | 'long'; purpose: string | null }
  | { kind: 'finger'; mmol: number }
  | { kind: 'low'; end: number; minutes: number; lowest: number /* mmol/L */; veryLow: boolean; ongoing: boolean }
  | { kind: 'sensor'; sn: string }
);

export interface DailyLogDay extends WeeklyDay { entries: LogEntry[]; lows: GlucoseEvent[] }
export interface DailyLog { from: number; to: number; label: string; days: DailyLogDay[] }

const ORDER: Record<LogEntry['kind'], number> = { sensor: 0, low: 1, finger: 2, treatment: 3, insulin: 4, meal: 5 };

export function buildDailyLog(o: { readings: Reading[]; from: number; to: number; now: number; insulin: ReportInsulin[]; meals: ReportMeal[]; treatments: ReportTreatment[]; fingerPricks?: FingerPrick[]; sensors?: ReportSensor[] }): DailyLog {
  const s = buildWeeklySummary(o);
  const rs = clean(o.readings), end = Math.min(o.to, o.now);
  const ev = glucoseEvents(rs, o.from, end);
  const near = (t: number) => { const r = nearestReading(rs, t); return r ? mmol(r.mg) : null; };
  const days = s.weeks.flatMap((w) => w.days).map((d): DailyLogDay => {
    const a = d.start, b = d.start + DAY, inDay = (t: number) => t >= a && t < b;
    const base = (at: number) => ({ at, minute: Math.floor((at - a) / MIN), sensor: near(at) });
    const lows = ev.hypo1.filter((e) => inDay(e.start));
    const entries: LogEntry[] = [
      ...o.meals.filter((m) => !m.pending && inDay(m.at)).map((m): LogEntry => ({ ...base(m.at), kind: 'meal', name: m.name ?? null, slot: m.slot ?? null, carbs: m.unknown ? null : m.carbs })),
      ...o.treatments.filter((t) => inDay(t.at)).map((t): LogEntry => ({ ...base(t.at), kind: 'treatment', name: t.name ?? null, carbs: t.carbs })),
      ...o.insulin.filter((i) => inDay(i.at)).map((i): LogEntry => ({ ...base(i.at), kind: 'insulin', units: i.units, type: i.type, purpose: i.purpose ?? null })),
      ...(o.fingerPricks ?? []).filter((f) => inDay(f.at)).map((f): LogEntry => ({ ...base(f.at), kind: 'finger', mmol: mmol(f.mg) })),
      ...lows.map((e): LogEntry => ({ at: e.start, minute: Math.floor((e.start - a) / MIN), sensor: null, kind: 'low', end: e.end, minutes: Math.round(e.minutes),
        lowest: mmol(e.extreme), veryLow: ev.hypo2.some((v) => v.start < e.end && v.end > e.start), ongoing: e.end >= end - 16 * MIN })),
      ...(o.sensors ?? []).map((x) => ({ x, at: Date.parse(x.started_at) })).filter(({ at }) => inDay(at)).map(({ x, at }): LogEntry => ({ ...base(at), sensor: null, kind: 'sensor', sn: x.sn })),
    ].sort((p, q) => p.at - q.at || ORDER[p.kind] - ORDER[q.kind]);
    return { ...d, entries, lows };
  });
  return { from: o.from, to: o.to, label: s.label, days };
}
