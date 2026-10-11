// The Snapshot as one A4 portrait page (LibreView's layout): glucose and time in ranges, low events and when they
// started, the daily pattern, insulin given and carbohydrates, side by side. Real text and vector drawing (jsPDF),
// from the same model as the screen (engine/report/snapshot.ts); the chart is the AGP report's own.
import type { jsPDF as JsPdf } from 'jspdf';
import { fmt1, fmtPct, type PatientInfo } from '../engine/report/agpReport';
import { LOW_BLOCKS, type Snapshot } from '../engine/report/snapshot';
import { C, H, M, W, ageText, drawAgpPlot, isoDate, pdfKit } from './reportPdf';

const n1 = (x: number | null, unit = '') => (x === null ? '–' : `${fmt1(x)}${unit}`);
export const SNAPSHOT_NOTE = 'Insulin: doses given, not calculator suggestions. Insulin and carb averages are over the days that have such records (shown as "N of M days"), so a day with nothing logged does not lower them unnoticed. Carbs: meals confirmed as eaten; low treatments are counted apart. Finger-pricks are kept out of every sensor number.';

export function drawSnapshotPdf(doc: JsPdf, s: Snapshot, p: PatientInfo, appVersion = '') {
  const r = s.report, m = r.metrics;
  const { fill, stroke, text, box, footer } = pdfKit(doc, r.generatedAt, appVersion);
  // ── header ──
  text('Snapshot', M, M + 6, { size: 18, bold: true, c: C.blue });
  text('Continuous glucose monitoring · mmol/L', W - M, M + 6, { size: 8, c: C.muted, align: 'right' });
  const info: [string, string][] = [
    ['Patient', p.name || '–'], ['Date of birth', p.birthDate ? `${isoDate(p.birthDate)}${p.birthApprox ? ' (approx.)' : ''} · age ${ageText(p.birthDate, r.generatedAt)}` : '–'],
    ['Diagnosed', isoDate(p.diagnosisDate)], ['Clinic', p.clinic || '–'],
  ];
  let y = M + 12;
  info.forEach(([k, v], i) => { const x = M + (i % 2) * 93; const yy = y + Math.floor(i / 2) * 4.6; text(k, x, yy, { size: 7.5, c: C.muted }); text(v, x + 22, yy, { size: 8.5, bold: i === 0 }); });
  y += 10.5;
  fill(C.soft); doc.rect(M, y, W - 2 * M, 7, 'F');
  text(`${r.label}  (${r.days} days)`, M + 2, y + 4.7, { size: 9, bold: true });
  text(r.sufficiency.ok ? `Sensor data ${fmtPct(m.pctActive)} of the time` : `Sensor data ${fmtPct(m.pctActive)}: ${r.sufficiency.reason}`, W - M - 2, y + 4.7, { size: 7.5, c: r.sufficiency.ok ? C.met : C.notMet, align: 'right' });
  y += 10;

  // ── glucose (left) and low events (right) ──
  const half = (W - 2 * M - 4) / 2, rx = M + half + 4, topH = 74;
  box(M, y, half, topH, 'Glucose');
  text(fmtPct(r.ranges[2].pct), M + 3, y + 17, { size: 22, bold: true, c: C.inRange });
  text('in target range 3.9–10.0', M + 3, y + 21.5, { size: 7.5 }); text('goal: more than 70%', M + 3, y + 25, { size: 6.8, c: C.muted });
  // stacked bar, very high on the left as LibreView reads top to bottom
  const bx = M + 3, bw = half - 6, by = y + 29;
  let x = bx;
  for (const g of r.ranges) { const w = (g.pct / 100) * bw; fill(C[g.key]); if (w > 0) doc.rect(x, by, w, 4, 'F'); x += w; }
  const rows: [string, string][] = [
    ['Very high  >13.9', fmtPct(r.ranges[0].pct)], ['High  10.1–13.9', fmtPct(r.ranges[1].pct)], ['Low  3.0–3.8', fmtPct(r.ranges[3].pct)], ['Very low  <3.0', fmtPct(r.ranges[4].pct)],
    ['Average glucose', m.mean === null ? '–' : `${fmt1(m.mean / 18.016)} mmol/L`], ['GMI', m.gmi === null ? 'needs 14 days, 70% data' : `${fmt1(m.gmi)}%`], ['Variability (CV)', m.cv === null ? '–' : `${fmt1(m.cv)}%${r.cvStable ? ' (stable)' : ''}`],
  ];
  rows.forEach(([k, v], i) => { const yy = y + 39 + i * 4.8; text(k, M + 3, yy, { size: 7.8 }); text(v, M + half - 3, yy, { size: 7.8, bold: true, align: 'right' }); });

  box(rx, y, half, topH, 'Low glucose events');
  text(String(s.lows.count), rx + 3, y + 17, { size: 22, bold: true, c: s.lows.count ? C.low : C.ink });
  text(`low events (below 3.9) · ${fmt1(s.lows.perWeek)} per week`, rx + 3, y + 21.5, { size: 7.5 });
  text(`average ${s.lows.avgMinutes === null ? '–' : `${Math.round(s.lows.avgMinutes)} min`} · ${s.lows.veryLows} below 3.0 · ${s.lows.treatments} treatments logged`, rx + 3, y + 25, { size: 6.8, c: C.muted });
  text('When the lows started', rx + 3, y + 31, { size: 7, bold: true, c: C.muted });
  const max = Math.max(1, ...s.lows.byBlock), gx = rx + 4, gw = (half - 8) / 6, gTop = y + 35, gH = 26;
  s.lows.byBlock.forEach((c, i) => {
    const h = (c / max) * gH, bx2 = gx + i * gw + 1.2;
    fill(c ? C.low : C.soft); doc.rect(bx2, gTop + gH - Math.max(h, 0.6), gw - 2.4, Math.max(h, 0.6), 'F');
    text(String(c), bx2 + (gw - 2.4) / 2, gTop + gH - h - 1.2, { size: 7, bold: true, align: 'center' });
    text(LOW_BLOCKS[i], bx2 + (gw - 2.4) / 2, gTop + gH + 3.4, { size: 5.6, c: C.muted, align: 'center' });
  });
  text('Report definition: 15 minutes or more below 3.9; separate from the live alerts.', rx + 3, y + topH - 2.5, { size: 6, c: C.muted });
  y += topH + 4;

  // ── daily pattern ──
  const agpH = 82;
  box(M, y, W - 2 * M, agpH, 'Daily pattern (AGP)');
  text('Median (line), 25–75% and 5–95% of readings at each time of day. The full AGP report has the details.', M + 2, y + 10, { size: 7, c: C.muted });
  drawAgpPlot(doc, r, M + 12, y + 13, W - 2 * M - 26, agpH - 22);
  y += agpH + 4;

  // ── insulin and carbs ──
  const lowH = H - 17 - y - 13;
  const ins = s.insulin, cb = s.carbs;
  box(M, y, half, lowH, 'Insulin given');
  text(ins.total === null ? '–' : `${fmt1(ins.total)} U`, M + 3, y + 15, { size: 16, bold: true });
  text('average a day', M + 3, y + 19.5, { size: 7.5 }); text(`over ${ins.daysWith} of ${ins.days} days with insulin logged`, M + 3, y + 23, { size: 6.8, c: ins.daysWith < ins.days ? C.notMet : C.muted });
  ([['Rapid a day', n1(ins.rapid, ' U')], ['Long-acting a day', n1(ins.long, ' U')], ['Long-acting share', ins.basalPct === null ? '–' : fmtPct(ins.basalPct)], ['Rapid doses a day', n1(ins.rapidDosesPerDay)]] as const)
    .forEach(([k, v], i) => { const yy = y + 29 + i * 4.6; text(k, M + 3, yy, { size: 7.8 }); text(v, M + half - 3, yy, { size: 7.8, bold: true, align: 'right' }); });
  box(rx, y, half, lowH, 'Carbohydrates');
  text(cb.perDay === null ? '–' : `${Math.round(cb.perDay)} g`, rx + 3, y + 15, { size: 16, bold: true });
  text('average a day', rx + 3, y + 19.5, { size: 7.5 }); text(`over ${cb.daysWith} of ${cb.days} days with meals logged`, rx + 3, y + 23, { size: 6.8, c: cb.daysWith < cb.days ? C.notMet : C.muted });
  ([['Meals a day', n1(cb.mealsPerDay)], ['Meals with carbs not known', String(cb.unknownMeals)], ['Low treatments (apart)', String(s.lows.treatments)], ['Finger-pricks', `${s.fingerPricks.total} (${fmt1(s.fingerPricks.perDay)} a day)`]] as const)
    .forEach(([k, v], i) => { const yy = y + 29 + i * 4.6; text(k, rx + 3, yy, { size: 7.8 }); text(v, rx + half - 3, yy, { size: 7.8, bold: true, align: 'right', c: k.startsWith('Meals with') && cb.unknownMeals ? C.notMet : C.ink }); });
  stroke(C.line);
  text(SNAPSHOT_NOTE, M, y + lowH + 4, { size: 6.2, c: C.muted, maxW: W - 2 * M });
  footer(1);
}

export async function snapshotPdf(s: Snapshot, p: PatientInfo, appVersion = ''): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Snapshot ${s.report.label}`, subject: 'Continuous glucose monitoring report', creator: "Layan's carb & insulin app" });
  drawSnapshotPdf(doc, s, p, appVersion);
  return doc.output('blob');
}
