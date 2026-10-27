// The visit report: everything the doctor and the dietitian need in one PDF. The clinical sections are the doctor
// reports themselves, drawn by the same code from the same models (English, mmol/L), so the visit report never shows
// a number the separate reports would not. The family's sections (cover, meal plans, growth, the dietitian's daily
// sheets, notes) are pictured from the screen in the language chosen (see VisitReport.tsx).
import type { jsPDF as JsPdf } from 'jspdf';
import { buildAgpReport, fmt1, kwDate, kwWeekday, mmol, periodLabel, reportPeriod, type AgpReport, type PatientInfo } from '../engine/report/agpReport';
import { buildSnapshot, type Snapshot } from '../engine/report/snapshot';
import { buildWeeklySummary, type WeeklySummary } from '../engine/report/weekly';
import { buildMonthly, type MonthlySummary } from '../engine/report/monthly';
import { buildMealtime, type Mealtime } from '../engine/report/mealtime';
import { glucoseEvents, type GlucoseEvent } from '../engine/report/events';
import { kwMinuteOfDay } from '../engine/report/cgm';
import type { ReportData } from './reportData';
import { C, H, M, W, pdfKit } from './reportPdf';
import { drawAgpPdf } from './reportPdf';
import { drawSnapshotPdf } from './snapshotPdf';
import { drawWeeklyPdf } from './weeklyPdf';
import { drawMonthlyPdf } from './monthlyPdf';
import { drawMealtimePdf } from './mealtimePdf';

export const VISIT_PERIODS = [14, 30, 90] as const;
export type VisitDays = (typeof VISIT_PERIODS)[number];

export interface VisitEvent { kind: 'low' | 'veryLow' | 'veryHigh'; start: number; end: number; minutes: number; extreme: number; night: boolean }
export interface VisitModels {
  days: VisitDays; from: number; to: number; now: number;
  agp: AgpReport; snapshot: Snapshot; weekly: WeeklySummary | null; monthly: MonthlySummary | null; mealtime: Mealtime;
  events: VisitEvent[];
}

/** Night for the events list: midnight to 6 am, Kuwait time. */
const isNight = (t: number) => kwMinuteOfDay(t) < 6 * 60;

/** Every model from one load of the period. Weekly pages for 14 days; the monthly calendar for 30 and 90. */
export function buildVisitModels(data: ReportData, days: VisitDays, now: number): VisitModels {
  const { from, to } = reportPeriod(days, now);
  const o = { ...data, from, to, now };
  const ev = glucoseEvents(data.readings, from, Math.min(to, now));
  const pick = (list: GlucoseEvent[], kind: VisitEvent['kind']) => list.map((e) => ({ kind, start: e.start, end: e.end, minutes: e.minutes, extreme: e.extreme, night: isNight(e.start) }));
  // a low that went below 3.0 is listed once, as a very low
  const lows = ev.hypo1.filter((e) => !ev.hypo2.some((v) => v.start < e.end && v.end > e.start));
  const events = [...pick(lows, 'low'), ...pick(ev.hypo2, 'veryLow'), ...pick(ev.high2, 'veryHigh')]
    .sort((a, b) => a.start - b.start);
  return {
    days, from, to, now,
    agp: buildAgpReport({ readings: data.readings, from, to, now, fingerPricks: data.fingerPricks.length }),
    snapshot: buildSnapshot(o),
    weekly: days <= 14 ? buildWeeklySummary(o) : null,
    monthly: days > 14 ? buildMonthly(o) : null,
    mealtime: buildMealtime(o),
    events,
  };
}

const clock = (t: number) => { const m = kwMinuteOfDay(t), h = Math.floor(m / 60); return `${h % 12 || 12}:${String(m % 60).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };
const dur = (min: number) => (min >= 60 ? `${Math.floor(min / 60)} h ${String(Math.round(min % 60)).padStart(2, '0')} min` : `${Math.round(min)} min`);
const KIND = { low: 'Low (<3.9)', veryLow: 'Very low (<3.0)', veryHigh: 'Very high (>13.9)' } as const;
const KIND_C = { low: C.low, veryLow: C.veryLow, veryHigh: C.veryHigh } as const;
export const EVENTS_NOTE = 'Events from the stored sensor readings: low = below 3.9 mmol/L for 15 minutes or more; very low = below 3.0 for 15 minutes or more (listed once, as very low); very high = above 13.9 for 15 minutes or more. Night = starting between midnight and 6 am. Separate from the live alerts; gaps are never filled in.';

/** Every low, very low and very high episode of the period, one row each, continuing over pages as needed. */
export function drawEventsPdf(doc: JsPdf, m: VisitModels, p: PatientInfo, appVersion = '') {
  const { fill, stroke, text, footer } = pdfKit(doc, m.now, appVersion);
  const cols = [M + 2, M + 34, M + 62, M + 84, M + 106, M + 136, M + 160];
  let page = 1, y = 0;
  const head = () => {
    text('Glucose Events', M, M + 6, { size: 18, bold: true, c: C.blue });
    text('Lows and very highs · mmol/L', W - M, M + 6, { size: 8, c: C.muted, align: 'right' });
    text(`${p.name || '–'}  ·  ${periodLabel(m.from, m.to)} (${m.days} days)`, M, M + 12, { size: 8.5 });
    const n = (k: VisitEvent['kind']) => m.events.filter((e) => e.kind === k).length;
    const nightLows = m.events.filter((e) => e.kind !== 'veryHigh' && e.night).length;
    fill(C.soft); doc.rect(M, M + 15, W - 2 * M, 9, 'F');
    text(`Lows ${n('low')}  ·  Very lows ${n('veryLow')}  ·  of them at night ${nightLows}  ·  Very highs ${n('veryHigh')}`, M + 2, M + 21, { size: 9, bold: true });
    y = M + 32;
    ['Date', 'Start', 'End', 'Duration', 'Lowest / highest', 'Type', 'Night'].forEach((h, i) => text(h, cols[i], y, { size: 7.5, bold: true, c: C.muted }));
    stroke(C.line); doc.setLineWidth(0.25); doc.line(M, y + 1.5, W - M, y + 1.5);
    y += 6;
  };
  head();
  if (!m.events.length) text('No low, very low or very high episodes in this period.', M + 2, y + 2, { size: 9 });
  for (const e of m.events) {
    if (y > H - 24) { footer(page); doc.addPage('a4', 'portrait'); page++; head(); }
    text(`${kwWeekday(e.start)} ${kwDate(e.start, false)}`, cols[0], y, { size: 8 });
    text(clock(e.start), cols[1], y, { size: 8 });
    text(clock(e.end), cols[2], y, { size: 8 });
    text(dur(e.minutes), cols[3], y, { size: 8 });
    text(fmt1(mmol(e.extreme)), cols[4], y, { size: 8, bold: true, c: KIND_C[e.kind] });
    text(KIND[e.kind], cols[5], y, { size: 8, c: KIND_C[e.kind] });
    text(e.night ? 'Night' : '', cols[6], y, { size: 8 });
    y += 5;
  }
  text(EVENTS_NOTE, M, Math.min(y + 4, H - 20), { size: 6.5, c: C.muted, maxW: W - 2 * M });
  footer(page);
}

/** The doctor's sections, each starting on its own page of `doc`: AGP, overview, weekly or monthly, mealtime, events. */
/** short: the visit's essentials only (AGP, overview, mealtimes, lows and highs), without the weeks or the month. */
export function drawVisitDoctor(doc: JsPdf, m: VisitModels, p: PatientInfo, appVersion = '', short = false) {
  doc.addPage('a4', 'portrait'); drawAgpPdf(doc, m.agp, p, appVersion);
  doc.addPage('a4', 'portrait'); drawSnapshotPdf(doc, m.snapshot, p, appVersion);
  if (m.weekly && !short) { doc.addPage('a4', 'portrait'); drawWeeklyPdf(doc, m.weekly, p, m.now, appVersion); }
  if (m.monthly && !short) { doc.addPage('a4', 'landscape'); drawMonthlyPdf(doc, m.monthly, p, m.now, appVersion); }
  doc.addPage('a4', 'portrait'); drawMealtimePdf(doc, m.mealtime, p, m.now, appVersion);
  doc.addPage('a4', 'portrait'); drawEventsPdf(doc, m, p, appVersion);
}

/** Facts for the visit notes, never advice: what the data shows, for the family to raise. */
export interface VisitFacts {
  tir: number | null; tbr: number | null; tar: number | null; gmi: number | null; cv: number | null; active: number;
  meals: { slot: string; sittings: number; pre: number | null; at2h: number | null; lowsAfter: number }[];
  lows: number; nightLows: number; veryHighs: number;
}
export function visitFacts(m: VisitModels): VisitFacts {
  const r = m.agp.ranges, pct = (k: string) => r.find((x) => x.key === k)?.pct ?? 0;
  return {
    tir: pct('inRange'), tbr: pct('low') + pct('veryLow'), tar: pct('high') + pct('veryHigh'),
    gmi: m.agp.metrics.gmi, cv: m.agp.metrics.cv, active: m.agp.metrics.pctActive,
    meals: m.mealtime.slots.filter((s) => s.sittings > 0).map((s) => ({ slot: s.slot, sittings: s.sittings, pre: s.pre, at2h: s.at2h, lowsAfter: s.lowsAfter })),
    lows: m.events.filter((e) => e.kind !== 'veryHigh').length, nightLows: m.events.filter((e) => e.kind !== 'veryHigh' && e.night).length,
    veryHighs: m.events.filter((e) => e.kind === 'veryHigh').length,
  };
}
