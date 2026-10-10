// Clinical report engine, part 4: glucose EVENTS for doctor reports. These are counts for a report only. The live
// hypo and high alerts on the phones have their own rules (supabase/functions/carb-glucose/alerts.ts) and are not
// changed or used here: a report event is decided afterwards, with the whole curve in view; an alert must decide now.
//
// Consensus definition (Battelino 2023, Lancet Diabetes Endocrinol 11:42):
//  • an event starts when glucose is beyond the threshold for at least 15 consecutive minutes;
//  • it ends only after at least 15 consecutive minutes back on the other side (a brief bounce does not split it);
//  • level 1 hypo: <70 mg/dL (3.9 mmol/L); level 2 hypo: <54 mg/dL (3.0); extended hypo: <70 for over 120 minutes;
//    level 1 high: >180 (10.0); level 2 high: >250 (13.9).
// Worked on the readings' own time line (cgm.ts `eventSegments`), to the minute: the 5-minute averages are for charts only,
// because averaging can stretch a 12-minute dip to 15 minutes and hides the lowest value (checked on her data,
// Oct 2026). Missing data (no reading for over 15 minutes) ends an event at its last reading beyond the threshold and
// stops a run from becoming one. The lowest (or highest) value is the reading itself, not an average.
//
// LibreView differs: its "Low glucose events" are readings below 70 mg/dL for longer than 15 minutes, counted on the
// 15-minute history data, with no published end rule. `libreViewLows` reproduces that reading of it for comparison.
import { MIN, eventSegments, type Reading, type Segment } from './cgm';

export interface GlucoseEvent { start: number; end: number; minutes: number; extreme: number }
export type Side = 'below' | 'above';
export const EVENT_MIN = 15, RECOVER_MIN = 15, EXTENDED_MIN = 120;

const beyond = (v: number, thr: number, side: Side) => (side === 'below' ? v < thr : v > thr);

/** Events on a time line. `strictlyLonger`: the run must last longer than minMin (LibreView's wording). */
export function eventsOnSegments(segs: Segment[], thr: number, side: Side, minMin = EVENT_MIN, recoverMin = RECOVER_MIN, strictlyLonger = false): GlucoseEvent[] {
  const out: GlucoseEvent[] = [];
  const worse = (a: number, b: number) => (side === 'below' ? Math.min(a, b) : Math.max(a, b));
  const long = (ms: number) => (strictlyLonger ? ms > minMin * MIN : ms >= minMin * MIN);
  let runStart: number | null = null, runExtreme = 0;          // a run beyond the threshold, not yet an event
  let ev: { start: number; lastIn: number; extreme: number } | null = null;
  let backSince: number | null = null;                          // inside an event: back on the other side since
  let prevEnd: number | null = null;
  const close = () => { if (ev) out.push({ start: ev.start, end: ev.lastIn, minutes: (ev.lastIn - ev.start) / MIN, extreme: ev.extreme }); ev = null; backSince = null; };
  for (const g of segs) {
    if (prevEnd !== null && g.a > prevEnd) { close(); runStart = null; } // missing data
    prevEnd = g.b;
    const b = beyond(g.mg, thr, side);
    if (ev) {
      if (b) { backSince = null; ev.lastIn = g.b; ev.extreme = worse(ev.extreme, g.mg); }
      else {
        if (backSince === null) backSince = g.a;
        if (g.b - backSince >= recoverMin * MIN) close();
      }
      continue;
    }
    if (b) {
      if (runStart === null) { runStart = g.a; runExtreme = g.mg; } else runExtreme = worse(runExtreme, g.mg);
      if (long(g.b - runStart)) { ev = { start: runStart, lastIn: g.b, extreme: runExtreme }; runStart = null; }
    } else runStart = null;
  }
  close();
  return out;
}

export interface EventSummary { hypo1: GlucoseEvent[]; hypo2: GlucoseEvent[]; extendedHypo: GlucoseEvent[]; high1: GlucoseEvent[]; high2: GlucoseEvent[] }

export function glucoseEvents(rs: Reading[], from: number, to: number): EventSummary {
  const segs = eventSegments(rs, from, to);
  const hypo1 = eventsOnSegments(segs, 70, 'below');
  return {
    hypo1, hypo2: eventsOnSegments(segs, 54, 'below'), extendedHypo: hypo1.filter((e) => e.minutes > EXTENDED_MIN),
    high1: eventsOnSegments(segs, 180, 'above'), high2: eventsOnSegments(segs, 250, 'above'),
  };
}

/** LibreView-style count for comparison only: below 70 mg/dL for longer than 15 minutes, ending at the first reading
 *  back at or above 70 (no 15-minute recovery rule). */
export function libreViewLows(rs: Reading[], from: number, to: number): GlucoseEvent[] {
  return eventsOnSegments(eventSegments(rs, from, to), 70, 'below', EVENT_MIN, 0, true);
}
