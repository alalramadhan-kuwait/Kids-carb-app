// Tests for the clinical report engine (src/engine/report): hand-worked examples for every number a doctor report
// shows. Run by `npm test`.
import assert from 'node:assert/strict';
import { DAY, MIN, eventSegments, grid, kwDayKey, kwDayStart, segments, type Reading } from '../../engine/report/cgm';
import { cgmMetrics, targetMet } from '../../engine/report/metrics';
import { agp, percentile } from '../../engine/report/agp';
import { eventsOnSegments, glucoseEvents, libreViewLows } from '../../engine/report/events';
import { dayRows, periodTotals } from '../../engine/report/days';
import { BAND_LABEL, showGlucose } from '../../engine/report/labels';
import { mapReportData } from '../reportMap';
import { buildAgpReport, fmtPct, periodLabel, reportPeriod } from '../../engine/report/agpReport';
import { buildWeeklySummary, carbMarks } from '../../engine/report/weekly';
import { placeLabels } from '../labelLayout';
import { nearestReading } from '../../engine/report/cgm';
import { buildDailyLog } from '../../engine/report/dailyLog';
import { buildSnapshot } from '../../engine/report/snapshot';
import { buildMealtime, slotOf } from '../../engine/report/mealtime';
import { buildMonthly } from '../../engine/report/monthly';
import { buildVisitModels, visitFacts } from '../visitPdf';

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('  ok', name); };
const near = (a: number | null, b: number, eps = 1e-6, msg?: string) => { assert.ok(a !== null && Math.abs(a - b) <= eps, `${msg ?? ''} expected ${b}, got ${a}`); };
console.log('clinical report engine');

const T0 = Date.UTC(2026, 8, 30, 21, 0); // 1 Oct 2026 00:00 Kuwait
/** readings every `step` minutes from `start` for `mins` minutes at value(s) */
const series = (start: number, mins: number, step: number, v: number | ((m: number) => number)): Reading[] =>
  Array.from({ length: Math.floor(mins / step) }, (_, i) => ({ t: start + i * step * MIN, mg: typeof v === 'number' ? v : v(i * step) }));

// ── time line ──
test('each reading lasts until the next one, at most 15 minutes; a longer gap is missing, never filled', () => {
  const s = segments([{ t: T0, mg: 100 }, { t: T0 + 5 * MIN, mg: 110 }, { t: T0 + 40 * MIN, mg: 120 }], T0, T0 + 60 * MIN);
  assert.deepEqual(s.map((g) => [(g.a - T0) / MIN, (g.b - T0) / MIN, g.mg]), [[0, 5, 100], [5, 20, 110], [40, 55, 120]]);
});
test('the stored readings are not changed (sorted copy, duplicate timestamps used once)', () => {
  const rs = [{ t: T0 + MIN, mg: 90 }, { t: T0, mg: 100 }, { t: T0, mg: 300 }];
  const before = JSON.stringify(rs);
  const s = segments(rs, T0, T0 + 10 * MIN);
  assert.equal(JSON.stringify(rs), before);
  assert.deepEqual(s.map((g) => g.mg), [100, 90]);
});

// ── metrics ──
test('weighted by time, not by count: an hour of minute readings and an hour of 15-minute points weigh the same', () => {
  const rs = [...series(T0, 60, 1, 100), ...series(T0 + 60 * MIN, 60, 15, 200)];
  const m = cgmMetrics(rs, T0, T0 + 120 * MIN, T0 + DAY);
  near(m.mean, 150, 1e-9, 'time-weighted mean');
  const byCount = rs.reduce((s, r) => s + r.mg, 0) / rs.length;
  assert.ok(byCount < 110, 'a count-weighted mean would be about 106');
  near(m.sd, 50, 1e-9, 'population SD'); near(m.cv, 100 / 3, 1e-9, 'CV %');
});
test('bands use the consensus cut-offs exactly (70 and 180 are in range; 69 low; 54 low; 53 very low; 251 very high)', () => {
  const vals = [53, 54, 69, 70, 180, 181, 250, 251];
  const rs = vals.map((v, i) => ({ t: T0 + i * 10 * MIN, mg: v }));
  const p = cgmMetrics(rs, T0, T0 + 80 * MIN, T0 + DAY).pct!;
  near(p.veryLow, 12.5); near(p.low, 25); near(p.inRange, 25); near(p.high, 25); near(p.veryHigh, 12.5);
  near(p.tight, 12.5, 1e-9, '70–140: only the 70');
});
test('% sensor active = measured time ÷ period; GMI only with ≥14 days and ≥70% data', () => {
  const full = series(T0, 14 * 24 * 60, 15, 154);
  const m = cgmMetrics(full, T0, T0 + 14 * DAY, T0 + 15 * DAY);
  near(m.pctActive, 100, 1e-9); near(m.gmi, 3.31 + 0.02392 * 154, 1e-9, 'GMI 6.99%'); assert.equal(m.enough.agp, true);
  const short = cgmMetrics(full, T0, T0 + 13 * DAY, T0 + 15 * DAY);
  assert.equal(short.gmi, null); assert.match(short.enough.reason!, /13 of 14 days/);
  const holes = full.filter((r) => (r.t - T0) % (4 * 15 * MIN) !== 0 || (r.t - T0) % DAY < DAY / 2); // drop readings → under 70%
  const thin = cgmMetrics(holes.filter((_, i) => i % 3 === 0), T0, T0 + 14 * DAY, T0 + 15 * DAY);
  assert.ok(thin.pctActive < 70); assert.equal(thin.gmi, null); assert.match(thin.enough.reason!, /needs 70%/);
});
test('a period still running counts only up to now', () => {
  const m = cgmMetrics(series(T0, 12 * 60, 5, 120), T0, T0 + DAY, T0 + 12 * 60 * MIN);
  near(m.pctActive, 100, 1e-9); near(m.days, 0.5);
});
test('ISPAD targets are checked against the right sums', () => {
  const p = { veryLow: 0.5, low: 3, inRange: 72, high: 20, veryHigh: 4.5, tight: 45 };
  assert.equal(targetMet(p, 'inRange'), true); assert.equal(targetMet(p, 'low+veryLow'), true);
  assert.equal(targetMet(p, 'high+veryHigh'), true); assert.equal(targetMet(p, 'tight'), false);
});

// ── 5-minute slots ──
test('a slot needs half its time measured; its value is the time-weighted mean inside it', () => {
  const g = grid([{ t: T0, mg: 100 }, { t: T0 + 2 * MIN, mg: 160 }, { t: T0 + 20 * MIN, mg: 90 }], T0, T0 + 30 * MIN);
  near(g[0].mg, (100 * 2 + 160 * 3) / 5, 1e-9, 'slot 0');
  near(g[1].mg, 160, 1e-9, 'slot 1 (held)'); near(g[2].mg, 160, 1e-9, 'slot 2 (held, 15 min from 0:02)');
  assert.equal(g[3].mg, null, 'slot 3 has 2 of 5 minutes: missing'); assert.equal(g[4].mg, 90);
});
test('the slot mean over fully measured time equals the time-weighted mean of the readings', () => {
  const rs = series(T0, 6 * 60, 1, (m) => 100 + 60 * Math.sin(m / 37));
  const g = grid(rs, T0, T0 + 6 * 60 * MIN), avg = g.reduce((s, x) => s + x.mg!, 0) / g.length;
  near(avg, cgmMetrics(rs, T0, T0 + 6 * 60 * MIN, T0 + DAY).mean!, 1e-9);
});

// ── AGP ──
test('percentiles interpolate between ranks (type 7)', () => {
  const v = Array.from({ length: 101 }, (_, i) => i);
  assert.equal(percentile(v, 5), 5); assert.equal(percentile(v, 95), 95); assert.equal(percentile([1, 2], 50), 1.5);
});
test('AGP gives 5/25/50/75/95 at every 5 minutes of the day, Kuwait clock, thin under 5 days', () => {
  const days = 6, rs: Reading[] = [];
  for (let d = 0; d < days; d++) rs.push(...series(T0 + d * DAY, 24 * 60, 5, 100 + d * 10)); // day d sits at 100 + 10d
  const a = agp(rs, T0, T0 + days * DAY);
  assert.equal(a.length, 288);
  const noon = a[144]!;
  assert.equal(noon.minute, 12 * 60); assert.equal(noon.days, 6); assert.equal(noon.thin, false);
  // 7 pooled slots × 6 days = 42 values, 7 each of 100…150: ranks 0–6 are 100, so p5 (rank 2.05) is 100
  near(noon.p50, 125, 1e-9); near(noon.p5, 100, 1e-9); near(noon.p95, 150, 1e-9); near(noon.p25, 110, 1e-9); assert.equal(noon.n, 42);
  const thin = agp(rs.filter((r) => r.t < T0 + 3 * DAY), T0, T0 + 3 * DAY)[144]!;
  assert.equal(thin.thin, true);
});
test('AGP: a day of minute readings does not outweigh a day of 15-minute points', () => {
  const rs = [...series(T0, 24 * 60, 1, 100), ...series(T0 + DAY, 24 * 60, 15, 200)];
  const p = agp(rs, T0, T0 + 2 * DAY)[100]!;
  near(p.p50, 150, 1e-9, 'median halfway: both days count equally');
});

// ── events ──
const dip = (mins: number, v = 60, base = 120) => [...series(T0, 30, 1, base), ...series(T0 + 30 * MIN, mins, 1, v), ...series(T0 + (30 + mins) * MIN, 60, 1, base)];
test('a hypo event needs 15 minutes below 70: 10 minutes is not one, 15 minutes is', () => {
  const end = T0 + 3 * 3600000;
  assert.equal(glucoseEvents(dip(10), T0, end).hypo1.length, 0);
  const e = glucoseEvents(dip(15), T0, end).hypo1;
  assert.equal(e.length, 1); assert.equal(e[0].minutes, 15); assert.equal(e[0].extreme, 60);
});
test('a short bounce back in range does not split an event; 15 minutes back does', () => {
  const two = (gap: number) => [...series(T0, 20, 1, 60), ...series(T0 + 20 * MIN, gap, 1, 90), ...series(T0 + (20 + gap) * MIN, 20, 1, 60), ...series(T0 + (40 + gap) * MIN, 30, 1, 100)];
  assert.equal(glucoseEvents(two(10), T0, T0 + DAY).hypo1.length, 1, '10 min bounce: one event');
  assert.equal(glucoseEvents(two(15), T0, T0 + DAY).hypo1.length, 2, '15 min back: two events');
});
test('level 2 (<54) and highs (>180, >250) use the same rule; LibreView-style count needs longer than 15 min', () => {
  const rs = [...series(T0, 20, 1, 50), ...series(T0 + 20 * MIN, 40, 1, 120), ...series(T0 + 60 * MIN, 30, 1, 260), ...series(T0 + 90 * MIN, 30, 1, 120)];
  const e = glucoseEvents(rs, T0, T0 + DAY);
  assert.equal(e.hypo2.length, 1); assert.equal(e.high1.length, 1); assert.equal(e.high2.length, 1);
  assert.equal(libreViewLows(dip(15), T0, T0 + DAY).length, 0, 'exactly 15 min is not "longer than 15"');
  assert.equal(libreViewLows(dip(20), T0, T0 + DAY).length, 1);
});
test('missing data (no reading for over 15 minutes) ends an event at its last reading', () => {
  // readings to 0:29, nothing until 1:30 → two events
  const rs = [...series(T0, 30, 1, 60), ...series(T0 + 90 * MIN, 30, 1, 60)];
  const e = glucoseEvents(rs, T0, T0 + 3 * 3600000).hypo1;
  assert.equal(e.length, 2); assert.equal(e[0].minutes, 30, '30 minute readings; the last lasts its own minute');
});
test('15-minute history points are continuous data, not gaps, even a few seconds late (Gluroo: 15.1 min)', () => {
  const e = glucoseEvents([...series(T0, 60, 15, 60), ...series(T0 + 60 * MIN, 60, 15, 120)], T0, T0 + 3 * 3600000).hypo1;
  assert.equal(e.length, 1); assert.equal(e[0].minutes, 60);
  // 28 Sep 2026 06:00–06:45 as imported: 60, 57, 65, then 70, each 15.1 minutes apart → one 45-minute event, lowest 57
  const st = 15.1 * MIN, real = [74, 60, 57, 65, 70, 90].map((mg, i) => ({ t: T0 + i * st, mg }));
  const one = glucoseEvents(real, T0, T0 + 3 * 3600000).hypo1;
  assert.equal(one.length, 1); assert.equal(one[0].extreme, 57); near(one[0].minutes, 3 * 15.1, 1e-9);
});
test('a gap breaks a run before it becomes an event; the lowest value is a real reading, not an average', () => {
  const segs = eventSegments([...series(T0, 10, 1, 60), ...series(T0 + 40 * MIN, 10, 1, 60)], T0, T0 + 3600000);
  assert.equal(eventsOnSegments(segs, 70, 'below').length, 0);
  const e = glucoseEvents([...series(T0, 8, 1, 65), { t: T0 + 8 * MIN, mg: 40 }, ...series(T0 + 9 * MIN, 10, 1, 65), ...series(T0 + 19 * MIN, 30, 1, 110)], T0, T0 + 3600000).hypo1;
  assert.equal(e.length, 1); assert.equal(e[0].extreme, 40); assert.equal(e[0].minutes, 19);
});

// ── days ──
test('a Kuwait day runs 21:00 to 21:00 UTC', () => {
  assert.equal(kwDayStart(T0 + 23 * 3600000), T0); assert.equal(kwDayKey(T0), '2026-10-01'); assert.equal(kwDayKey(T0 - 1), '2026-09-30');
});
test('day rows: insulin given only, unknown carbs not counted as 0, unconfirmed meals left out, treatments and finger-pricks apart', () => {
  const rows = dayRows({
    readings: series(T0, 2 * 24 * 60, 5, 120), from: T0, to: T0 + 2 * DAY, now: T0 + 3 * DAY,
    insulin: [{ at: T0 + 3600000, units: 3, type: 'rapid' }, { at: T0 + 2 * 3600000, units: 10, type: 'long' }, { at: T0 + DAY + 3600000, units: 2, type: 'rapid' }],
    meals: [{ at: T0 + 3600000, carbs: 40, unknown: false, pending: false }, { at: T0 + 5 * 3600000, carbs: null, unknown: true, pending: false }, { at: T0 + 6 * 3600000, carbs: 30, unknown: false, pending: true }],
    treatments: [{ at: T0 + 4 * 3600000, carbs: 15 }], fingerPricks: [{ at: T0 + 3600000, mg: 101 }],
  });
  assert.equal(rows.length, 2);
  const d = rows[0];
  assert.equal(d.carbs, 40); assert.equal(d.mealsUnknownCarbs, 1); assert.equal(d.meals, 2);
  assert.equal(d.treatments, 1); assert.equal(d.treatmentCarbs, 15);
  assert.equal(d.rapid, 3); assert.equal(d.long, 10); assert.equal(d.total, 13); near(d.basalPct, 1000 / 13);
  assert.equal(d.fingerPricks.length, 1); near(d.cgm.mean, 120, 1e-9, 'the finger-prick is not in the CGM mean');
  const tot = periodTotals(rows);
  near(tot.tdd, (13 + 2) / 2); assert.equal(tot.daysWithFood, 1); near(tot.carbsPerDay, 40, 1e-9, 'averaged over days with food records');
});

// ── labels and data ──
test('mmol/L band labels are written out: High is 10.1–13.9, never "10.0" (181 mg/dL rounds to 10.0)', () => {
  assert.equal(showGlucose(181, 'mmol'), '10.0');
  assert.equal(BAND_LABEL.mmol.high, '10.1–13.9'); assert.equal(BAND_LABEL.mmol.low, '3.0–3.8'); assert.equal(BAND_LABEL.mmol.inRange, '3.9–10.0');
});
test('report data: unknown carbs stay unknown, finger-pricks stay out of the CGM readings, readings kept as stored', () => {
  const j = {
    readings: { t: [1790000000, 1790000060], mg: [100, 104], src: ['gluroo', null] },
    events: [{ kind: 'bg_check', at: '2026-10-01T05:00:00Z', bg: 110 }, { kind: 'insulin', at: '2026-10-01T05:00:00Z', units: '3', type: 'rapid' }, { kind: 'carbs', at: '2026-10-01T06:00:00Z', carbs: '12' }],
    meals: [{ at: '2026-10-01T05:10:00Z', carbs: 0, unknown: true, pending: false }],
  };
  const d = mapReportData(j, 0, 1);
  assert.deepEqual(d.readings, [{ t: 1790000000000, mg: 100 }, { t: 1790000060000, mg: 104 }]); assert.deepEqual(d.sources, ['gluroo', null]);
  assert.equal(d.fingerPricks.length, 1); assert.equal(d.insulin[0].units, 3);
  assert.equal(d.meals[0].carbs, null, 'the stored 0 of an unknown meal is not carbs'); assert.equal(d.meals[1].carbs, 12);
});


// ── the exact low-event definition (docs/CLINICAL_REPORTS.md § Events), one test per rule ──
const lowFor = (mins: number, step = 1) => [...series(T0, 30, 1, 120), ...series(T0 + 30 * MIN, mins, step, 60), ...series(T0 + (30 + mins) * MIN, 60, 1, 120)];
test('definition 1 · minimum duration: 14 minutes below 3.9 is no event, 15 minutes is one', () => {
  assert.equal(glucoseEvents(lowFor(14), T0, T0 + DAY).hypo1.length, 0);
  assert.equal(glucoseEvents(lowFor(15), T0, T0 + DAY).hypo1.length, 1);
});
test('definition 2 · recovery: the event ends only after 15 minutes back at 3.9 or above (14 minutes back does not end it)', () => {
  const two = (back: number) => [...series(T0, 20, 1, 60), ...series(T0 + 20 * MIN, back, 1, 100), ...series(T0 + (20 + back) * MIN, 20, 1, 60), ...series(T0 + (40 + back) * MIN, 30, 1, 120)];
  const e14 = glucoseEvents(two(14), T0, T0 + DAY).hypo1, e15 = glucoseEvents(two(15), T0, T0 + DAY).hypo1;
  assert.equal(e14.length, 1); assert.equal(e14[0].minutes, 54, 'one event from the first low to the last');
  assert.equal(e15.length, 2);
});
test('definition 3 · missing data: no reading for over 16 minutes ends an event and is never bridged, even inside a low', () => {
  const gap = (mins: number) => [...series(T0, 20, 1, 60), ...series(T0 + (19 + mins) * MIN, 20, 1, 60)]; // last low at 0:19, next reading `mins` later
  assert.equal(glucoseEvents(gap(16), T0, T0 + DAY).hypo1.length, 1, '16 minutes apart: continuous');
  assert.equal(glucoseEvents(gap(17), T0, T0 + DAY).hypo1.length, 2, '17 minutes apart: a gap; two separate events, not merged');
});
test('definition 4 · the 16-minute allowance only absorbs late history points; it adds no glucose values', () => {
  const rs = [{ t: T0, mg: 60 }, { t: T0 + 15.1 * MIN, mg: 60 }, { t: T0 + 30.2 * MIN, mg: 120 }];
  const segsE = eventSegments(rs, T0, T0 + 3600000);
  assert.deepEqual(segsE.map((s) => s.mg), [60, 60, 120], 'only the stored values, in order');
  assert.ok(segsE.every((s, i) => i === 0 || s.a === segsE[i - 1].b), 'the 15.1-minute steps are continuous');
});
test('definition 5 · LibreView difference: exactly 15 minutes counts for the consensus, not for "longer than 15"', () => {
  assert.equal(glucoseEvents(lowFor(15), T0, T0 + DAY).hypo1.length, 1);
  assert.equal(libreViewLows(lowFor(15), T0, T0 + DAY).length, 0);
  assert.equal(libreViewLows(lowFor(16), T0, T0 + DAY).length, 1);
});
test('no interpolation anywhere: a 40-minute gap stays empty in the grid, the AGP and the daily profile', () => {
  const rs = [...series(T0, 60, 1, 100), ...series(T0 + 100 * MIN, 60, 1, 200)]; // nothing from 1:00 to 1:40 (held to 1:14)
  const g = grid(rs, T0, T0 + 3 * 3600000);
  assert.ok(g.slice(16, 20).every((s) => s.mg === null), 'slots 1:20–1:40 are empty');
  const r = buildAgpReport({ readings: rs, from: T0, to: T0 + DAY, now: T0 + 2 * DAY });
  assert.equal(r.daily[0].mmol[5], null, 'the 1:15–1:30 point of the day is empty');
  near(r.daily[0].mmol[6], 200 / 18.016, 1e-9, '1:30–1:45 holds only the real readings from 1:40');
  assert.ok(!r.agp.some((p) => p.minute >= 75 && p.minute <= 95), 'no AGP point at 1:15–1:35, where no day has data');
  assert.ok(r.agp.some((p) => p.minute === 70) && r.agp.some((p) => p.minute === 100), 'points on both sides remain');
});

// ── the AGP report model ──
test('a report period is whole Kuwait days ending at the last midnight; labels show the first and last day', () => {
  const now = Date.UTC(2026, 9, 10, 19); // 10 Oct 22:00 Kuwait
  const p = reportPeriod(14, now);
  assert.equal(p.to, Date.UTC(2026, 9, 9, 21)); assert.equal(p.from, p.to - 14 * DAY);
  assert.equal(periodLabel(p.from, p.to), '26 Sep – 9 Oct 2026');
});
test('the report model: ranges add to 100%, targets follow ISPAD, percent display never rounds a small time to 0%', () => {
  const rs = [...series(T0, 13 * 60, 5, 120), ...series(T0 + 13 * 60 * MIN, 30, 5, 60), ...series(T0 + (13 * 60 + 30) * MIN, 14 * 24 * 60, 5, 130)];
  const r = buildAgpReport({ readings: rs, from: T0, to: T0 + 14 * DAY, now: T0 + 15 * DAY });
  near(r.ranges.reduce((s, x) => s + x.pct, 0), 100, 1e-9);
  assert.equal(r.targets[1].label, 'Below 3.9'); assert.equal(r.targets[1].met, true);
  assert.equal(fmtPct(0.15), '0.2%'); assert.equal(fmtPct(72.4), '72%'); assert.equal(r.events.lows, 1);
  assert.equal(r.sufficiency.ok, true); assert.ok(r.metrics.gmi !== null);
});

test('a day without sensor data is marked as such and drawn empty, never filled', () => {
  const rs = series(T0 + DAY, 24 * 60, 5, 120); // nothing on the first day
  const r = buildAgpReport({ readings: rs, from: T0, to: T0 + 2 * DAY, now: T0 + 3 * DAY });
  assert.equal(r.daily.length, 2); assert.equal(r.daily[0].pctActive, 0); assert.ok(r.daily[0].mmol.every((v) => v === null));
  near(r.daily[1].pctActive, 100, 1e-9);
});


// ── Weekly Summary ──
test('weekly: one row per day, weeks of 7, totals from the shared day rows', () => {
  const r = buildWeeklySummary({ readings: series(T0, 14 * 24 * 60, 5, 126), from: T0, to: T0 + 14 * DAY, now: T0 + 15 * DAY,
    insulin: [{ at: T0 + 3600000, units: 3, type: 'rapid' }, { at: T0 + 2 * 3600000, units: 10, type: 'long' }], meals: [{ at: T0 + 3600000, carbs: 40, unknown: false, pending: false }], treatments: [] });
  assert.equal(r.weeks.length, 2); assert.equal(r.weeks[0].days.length, 7); assert.equal(r.weeks[0].label, '1 Oct – 7 Oct 2026');
  const d = r.weeks[0].days[0];
  assert.equal(d.row.total, 13); assert.equal(d.row.carbs, 40); near(d.avgMmol, 126 / 18.016, 1e-9);
  assert.deepEqual(d.insulin.map((i) => [i.minute, i.units, i.type]), [[60, 3, 'rapid'], [120, 10, 'long']]);
  assert.equal(d.mmol.length, 288);
});
test('weekly: meals close together share one marker; an unknown meal makes the marker unknown, never 0; unconfirmed meals are left out', () => {
  const m = (min: number, carbs: number | null, o: { unknown?: boolean; pending?: boolean } = {}) => ({ at: T0 + min * MIN, carbs, unknown: !!o.unknown, pending: !!o.pending });
  const marks = carbMarks([m(60, 30), m(75, 12), m(200, 20), m(210, null, { unknown: true }), m(400, 50, { pending: true })], T0);
  assert.deepEqual(marks, [{ minute: 60, grams: 42, meals: 2 }, { minute: 200, grams: null, meals: 2 }]);
});
test('weekly: low treatments and finger-pricks are marked apart; a day without sensor data stays empty', () => {
  const r = buildWeeklySummary({ readings: series(T0 + DAY, 24 * 60, 5, 120), from: T0, to: T0 + 2 * DAY, now: T0 + 3 * DAY,
    insulin: [], meals: [], treatments: [{ at: T0 + 5 * 3600000, carbs: 15 }], fingerPricks: [{ at: T0 + DAY + 3600000, mg: 101 }] });
  const [d0, d1] = r.weeks[0].days;
  assert.ok(d0.mmol.every((v) => v === null)); assert.equal(d0.avgMmol, null); assert.deepEqual(d0.treatments, [{ minute: 300, grams: 15 }]);
  assert.equal(d1.fingerPricks.length, 1); near(d1.avgMmol, 120 / 18.016, 1e-9, 'the finger-prick is not in the average');
});

test('labels never overlap: second line first, then moved right; the order stays the time order', () => {
  const p = placeLabels([{ x: 0, w: 10 }, { x: 4, w: 10 }, { x: 6, w: 10 }, { x: 30, w: 5 }]);
  assert.deepEqual(p, [{ line: 0, lx: 0 }, { line: 1, lx: 4 }, { line: 0, lx: 10 }, { line: 0, lx: 30 }]);
});

// ── Daily Log ──
test('daily log: the sensor value at a record is the stored reading within 8 minutes, never an estimate across a gap', () => {
  const rs = [{ t: T0, mg: 100 }, { t: T0 + 30 * MIN, mg: 200 }];
  assert.equal(nearestReading(rs, T0 + 7 * MIN)?.mg, 100);
  assert.equal(nearestReading(rs, T0 + 15 * MIN), null, 'halfway through the gap there is no value (not 150)');
  assert.equal(nearestReading(rs, T0 + 24 * MIN)?.mg, 200);
});
test('daily log: records of a day in time order, each kind kept apart; unknown carbs stay unknown; unconfirmed meals left out', () => {
  const h = 3600000;
  const log = buildDailyLog({ readings: series(T0, 24 * 60, 5, 120), from: T0, to: T0 + DAY, now: T0 + 2 * DAY,
    insulin: [{ at: T0 + 7 * h, units: 3, type: 'rapid' }, { at: T0 + 20 * h, units: 10, type: 'long' }],
    meals: [{ at: T0 + 7 * h + 10 * MIN, carbs: 45, unknown: false, pending: false, name: 'Breakfast' }, { at: T0 + 13 * h, carbs: null, unknown: true, pending: false }, { at: T0 + 18 * h, carbs: 30, unknown: false, pending: true }],
    treatments: [{ at: T0 + 3 * h, carbs: 15, name: 'Juice' }], fingerPricks: [{ at: T0 + 3 * h - 5 * MIN, mg: 70 }],
    sensors: [{ sn: 'ABC', started_at: new Date(T0 + 9 * h).toISOString(), days: 14, source: 'llu' }] });
  const d = log.days[0];
  assert.deepEqual(d.entries.map((e) => e.kind), ['finger', 'treatment', 'insulin', 'meal', 'sensor', 'meal', 'insulin']);
  const unknown = d.entries[5]; assert.ok(unknown.kind === 'meal' && unknown.carbs === null);
  near(d.entries[2].sensor, 120 / 18.016, 1e-9);
  assert.equal(d.row.carbs, 45); assert.equal(d.row.mealsUnknownCarbs, 1); assert.equal(d.row.total, 13);
});
test('daily log: a low event is listed at its start with duration and lowest reading; a day without sensor data has no sensor values', () => {
  const rs = [...series(T0, 120, 5, 120), ...series(T0 + 120 * MIN, 30, 5, 60), ...series(T0 + 150 * MIN, 60, 5, 120)];
  const log = buildDailyLog({ readings: rs, from: T0, to: T0 + 2 * DAY, now: T0 + 3 * DAY, insulin: [], meals: [{ at: T0 + DAY + 3600000, carbs: 20, unknown: false, pending: false }], treatments: [] });
  const low = log.days[0].entries.find((e) => e.kind === 'low');
  assert.ok(low && low.kind === 'low'); assert.equal(low.at, T0 + 120 * MIN); assert.equal(low.minutes, 30); near(low.lowest, 60 / 18.016, 1e-9); assert.equal(low.veryLow, false);
  assert.equal(log.days[1].entries[0].sensor, null); assert.ok(log.days[1].mmol.every((v) => v === null));
});

// ── Snapshot ──
test('snapshot: insulin and carbs averaged over the days that have them (and that count is shown); lows by time of day', () => {
  const h = 3600000;
  const s = buildSnapshot({ readings: [...series(T0, 120, 5, 120), ...series(T0 + 120 * MIN, 30, 5, 60), ...series(T0 + 150 * MIN, 2 * DAY / MIN - 150, 5, 120)], from: T0, to: T0 + 2 * DAY, now: T0 + 3 * DAY,
    insulin: [{ at: T0 + 7 * h, units: 4, type: 'rapid' }, { at: T0 + 8 * h, units: 2, type: 'rapid' }, { at: T0 + 20 * h, units: 10, type: 'long' }],
    meals: [{ at: T0 + 7 * h, carbs: 40, unknown: false, pending: false }, { at: T0 + DAY + 7 * h, carbs: 60, unknown: false, pending: false }, { at: T0 + DAY + 9 * h, carbs: null, unknown: true, pending: false }],
    treatments: [{ at: T0 + 2 * h + 10 * MIN, carbs: 15 }] });
  assert.deepEqual([s.insulin.daysWith, s.insulin.days, s.insulin.total, s.insulin.rapid, s.insulin.long, s.insulin.rapidDosesPerDay], [1, 2, 16, 6, 10, 2]);
  assert.deepEqual([s.carbs.daysWith, s.carbs.perDay, s.carbs.mealsPerDay, s.carbs.unknownMeals], [2, 50, 1.5, 1]);
  assert.deepEqual(s.lows.byBlock, [1, 0, 0, 0, 0, 0]); assert.equal(s.lows.count, 1); assert.equal(s.lows.avgMinutes, 30); assert.equal(s.lows.treatments, 1);
  assert.equal(s.report.events.lows, s.lows.count, 'the same events as the AGP report');
});

// ── Mealtime Patterns ──
test('mealtime: meals within 30 min are one sitting; its slot is its tag, else the hour; under 15 g is a snack', () => {
  const h = 3600000, day = T0 + 2 * DAY;
  assert.equal(slotOf(day + 7 * h, 30, null), 'breakfast'); assert.equal(slotOf(day + 13 * h, 30, null), 'lunch');
  assert.equal(slotOf(day + 19 * h, 30, null), 'dinner'); assert.equal(slotOf(day + 13 * h, 10, null), 'snack'); assert.equal(slotOf(day + 23 * h, 40, null), 'snack');
  assert.equal(slotOf(day + 23 * h, 40, 'dinner'), 'dinner', 'the stored slot wins');
});
test('mealtime: one sitting per meal, the curve stops at the next sitting, a gap stays empty, a meal eaten while low is a treatment', () => {
  const h = 3600000, days = 4;
  const rs: Reading[] = [];
  for (let d = 0; d < days; d++) {
    const b = T0 + d * DAY + 7 * h; // breakfast at 7: 110 before, rises to 200 at +60, back to 120 at +180
    rs.push(...series(b - 2 * h, 120, 5, 110), ...series(b, 60, 5, (m) => 110 + (90 * m) / 60), ...series(b + 60 * MIN, 120, 5, (m) => 200 - (80 * m) / 120), ...series(b + 180 * MIN, 120, 5, 120));
  }
  const meals = [] as any[];
  for (let d = 0; d < days; d++) meals.push({ at: T0 + d * DAY + 7 * h, carbs: 30, unknown: false, pending: false }, { at: T0 + d * DAY + 7 * h + 10 * MIN, carbs: 10, unknown: false, pending: false });
  meals.push({ at: T0 + 9 * h + 30 * MIN, carbs: 10, unknown: false, pending: false }); // day 0 at 9:30, a snack: cuts that breakfast's curve
  const m = buildMealtime({ readings: rs, from: T0, to: T0 + days * DAY, now: T0 + 10 * DAY, meals, insulin: [{ at: T0 + 7 * h, units: 2, type: 'rapid' }] });
  const b = m.slots.find((s) => s.slot === 'breakfast')!;
  assert.equal(b.sittings, days, 'the 10 g at +10 min joins the sitting'); assert.equal(b.carbs, 40);
  near(b.pre, 110 / 18.016, 0.05); near(b.peakMin, 60, 0.1);
  const at150 = b.curve.find((c) => c.min === 150)!; assert.equal(at150.n, days - 1, 'day 0 stops at its next sitting (9:30)');
  assert.ok(!b.curve.some((c) => c.min === 240), 'no readings at +4 h: missing, not filled');
  assert.equal(b.withInsulin, 1);
  const low = buildMealtime({ readings: series(T0, 600, 5, 60), from: T0, to: T0 + DAY, now: T0 + 2 * DAY, meals: [{ at: T0 + 3 * h, carbs: 15, unknown: false, pending: false }], insulin: [] });
  assert.equal(low.treatmentsLeftOut, 1); assert.equal(low.sittings.length, 0);
});

// ── Monthly Summary ──
test('monthly: calendar weeks from Sunday; days outside the period are empty; the month\'s numbers are the shared metrics', () => {
  const r = buildMonthly({ readings: series(T0, 2 * DAY / MIN - 30, 5, 120), from: T0, to: T0 + 3 * DAY, now: T0 + 5 * DAY, insulin: [], meals: [], treatments: [] });
  assert.equal(r.months.length, 1); const oct = r.months[0];
  assert.equal(oct.label, 'October 2026'); assert.equal(oct.weeks[0].filter((c) => c === null).length, 4, '1 Oct 2026 is a Thursday');
  assert.equal(oct.days.length, 3); assert.equal(oct.daysWithData, 2, 'the third day has no sensor data');
  near(oct.avg, 120 / 18.016, 1e-6); near(oct.tir, 100, 1e-9);
  assert.ok(oct.weeks.flat().filter((c) => c && !c.inPeriod).every((c) => c!.d === null));
});

// ── Visit report ──
test('visit report: one load builds every section; each low is listed once, a very low as very low; night is midnight to 6', () => {
  const now = T0 + 20 * DAY, { from } = reportPeriod(14, now);
  const lvl = (t: number) => {
    const k = Math.floor((t - from) / MIN);                 // minutes into the period
    if (k >= 2 * 1440 + 120 && k < 2 * 1440 + 150) return 60;   // day 2, 2:00 Kuwait… (period starts at a Kuwait midnight)
    if (k >= 4 * 1440 + 600 && k < 4 * 1440 + 640) return k < 4 * 1440 + 615 ? 62 : 48; // day 4, 10:00: low, then below 3.0
    if (k >= 6 * 1440 + 900 && k < 6 * 1440 + 940) return 270; // day 6, 15:00: very high
    return 120;
  };
  const rs = series(from, (now - from) / MIN, 1, (m) => lvl(from + m * MIN));
  const data = { from, to: now, readings: rs, sources: [], insulin: [], meals: [], treatments: [], fingerPricks: [], sensors: [] };
  const m = buildVisitModels(data, 14, now);
  assert.ok(m.weekly && !m.monthly, '14 days: weekly pages');
  assert.deepEqual(m.events.map((e) => [e.kind, e.night]), [['low', true], ['veryLow', false], ['veryHigh', false]]);
  const f = visitFacts(m); assert.equal(f.lows, 2); assert.equal(f.nightLows, 1); assert.equal(f.veryHighs, 1);
  near(f.tir! + f.tbr! + f.tar!, 100, 1e-6);
  const m30 = buildVisitModels(data, 30, now);
  assert.ok(m30.monthly && !m30.weekly, '30 days: the monthly calendar');
});

console.log(`\n${n} report engine tests passed`);
