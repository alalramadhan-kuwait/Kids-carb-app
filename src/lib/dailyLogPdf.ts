// The Daily Log as A4 portrait pages, one day per page (LibreView's layout): the day's numbers, its glucose curve with
// food, low treatments and insulin given marked at their times (the Weekly Summary's day chart, larger), then every
// record of the day as a timed list with the sensor glucose at that moment. Real text and vector drawing (jsPDF),
// from the same model as the screen (engine/report/dailyLog.ts).
import type { jsPDF as JsPdf } from 'jspdf';
import { fmt1, fmtPct, kwDate, type PatientInfo } from '../engine/report/agpReport';
import type { DailyLog, DailyLogDay } from '../engine/report/dailyLog';
import { C, H, M, W, ageText, isoDate, pdfKit } from './reportPdf';
import { drawDayPlot } from './weeklyPdf';
import { TONE, entryText, kwClock, printable } from './dailyLogText';

export const DAILY_NOTE_SCREEN = 'Sensor glucose: the stored reading within 8 minutes of the record; "–" means there was none (a gap, never filled in). Insulin: doses given, not calculator suggestions. Low events: below 3.9 mmol/L for 15 minutes or more (report definition, separate from the live alerts).';
export const DAILY_NOTE = `${DAILY_NOTE_SCREEN} Meal names written in Arabic are shown in the app only.`;

const fmtU = (u: number) => (Math.round(u * 10) / 10).toString();

export function drawDailyLogPdf(doc: JsPdf, log: DailyLog, p: PatientInfo, generatedAt: number, appVersion = '') {
  const { fill, stroke, text, footer } = pdfKit(doc, generatedAt, appVersion);
  let page = 0;
  const head = (d: DailyLogDay, i: number, cont: boolean) => {
    if (page > 0) doc.addPage('a4', 'portrait');
    page++;
    text('Daily Log', M, M + 6, { size: 18, bold: true, c: C.blue });
    text('Continuous glucose monitoring · mmol/L', W - M, M + 6, { size: 8, c: C.muted, align: 'right' });
    text(`${p.name || '–'}${p.birthDate ? `  ·  born ${isoDate(p.birthDate)}${p.birthApprox ? ' (approx.)' : ''}, age ${ageText(p.birthDate, generatedAt)}` : ''}`, M, M + 12, { size: 8.5 });
    fill(C.soft); doc.rect(M, M + 15, W - 2 * M, 7, 'F');
    text(`${d.weekday} ${kwDate(d.start)}${cont ? '  (continued)' : ''}`, M + 2, M + 19.7, { size: 9.5, bold: true });
    const act = d.row.cgm.pctActive;
    text(`Day ${i + 1} of ${log.days.length} · ${act === 0 ? 'no sensor data' : `sensor data ${Math.round(act)}% of the day`}`, W - M - 2, M + 19.7, { size: 7.5, c: act < 70 ? C.notMet : C.muted, align: 'right' });
    return M + 26;
  };

  log.days.forEach((d, i) => {
    let y = head(d, i, false);
    // ── the day's numbers ──
    const r = d.row, pct = r.cgm.pct;
    const cells: [string, string, string?][] = [
      ['Average', d.avgMmol === null ? '–' : fmt1(d.avgMmol), 'mmol/L'],
      ['In range 3.9–10.0', pct ? fmtPct(pct.inRange) : '–', 'of sensor time'],
      ['Below 3.9', pct ? fmtPct(pct.low + pct.veryLow) : '–', 'of sensor time'],
      ['Carbs eaten', r.meals ? `${Math.round(r.carbs)} g` : '–', r.mealsUnknownCarbs ? `+ ${r.mealsUnknownCarbs} meal${r.mealsUnknownCarbs > 1 ? 's' : ''} not known` : `${r.meals} meal${r.meals === 1 ? '' : 's'}`],
      ['Insulin given', r.total === null ? '–' : `${fmtU(r.total)} U`, r.total === null ? 'none logged' : `rapid ${fmtU(r.rapid)} · long ${fmtU(r.long)}`],
      ['Low events', String(r.lows), r.treatments ? `${r.treatments} treatment${r.treatments > 1 ? 's' : ''}` : 'no treatments'],
    ];
    const cw = (W - 2 * M) / cells.length;
    cells.forEach(([l, v, s], k) => {
      const x = M + k * cw + cw / 2;
      text(v, x, y + 5.5, { size: 12, bold: true, align: 'center', c: l === 'Low events' && r.lows ? C.low : C.ink });
      text(l, x, y + 9.5, { size: 6.8, bold: true, align: 'center' });
      if (s) text(s, x, y + 12.6, { size: 6, c: C.muted, align: 'center' });
    });
    stroke(C.line); doc.setLineWidth(0.25); doc.line(M, y + 15, W - M, y + 15);
    y += 18;
    // ── the day's chart ──
    let lx = M; const ly = y + 1;
    const key = (draw: (x: number, yy: number) => void, label: string) => { draw(lx, ly - 1); text(label, lx + 4, ly, { size: 6.8, c: C.muted }); lx += 4 + doc.getTextWidth(label) + 5; };
    key((x, yy) => { stroke(C.median); doc.setLineWidth(0.5); doc.line(x, yy, x + 3, yy); }, 'Sensor glucose');
    key((x, yy) => { fill(C.target); doc.rect(x, yy - 1.2, 3, 2.4, 'F'); }, 'Target 3.9–10.0');
    key((x, yy) => { fill(TONE.food); doc.circle(x + 1.2, yy, 0.9, 'F'); }, 'Carbs (g)');
    key((x, yy) => { fill(TONE.treat); doc.circle(x + 1.2, yy, 0.9, 'F'); }, 'Low treatment (g)');
    key((x, yy) => { fill(TONE.rapid); doc.triangle(x, yy - 1, x + 2.4, yy - 1, x + 1.2, yy + 1, 'F'); }, 'Rapid (U)');
    key((x, yy) => { fill(TONE.long); doc.rect(x, yy - 1, 2.2, 2.2, 'F'); }, 'Long-acting (U)');
    key((x, yy) => { fill(C.ink); doc.lines([[1, -1], [1, 1], [-1, 1], [-1, -1]], x + 0.2, yy, [1, 1], 'F', true); }, 'Finger-prick');
    y += 3;
    const chartX = M + 7, chartW = W - 2 * M - 7, chartH = 74;
    drawDayPlot(doc, d, chartX, chartW, y, chartH, generatedAt, { hours: true });
    y += chartH + 5;
    // ── the records, by time ──
    const col = { time: M, what: M + 17, amount: M + 70, sensor: M + 122, detail: M + 140 };
    const tableHead = () => {
      for (const [k, l] of [['time', 'Time'], ['what', 'Record'], ['amount', 'Amount'], ['sensor', 'Sensor'], ['detail', 'Details']] as const) text(l, col[k], y, { size: 7, bold: true, c: C.muted });
      stroke(C.line); doc.setLineWidth(0.25); doc.line(M, y + 1.5, W - M, y + 1.5); y += 5.5;
    };
    tableHead();
    if (!d.entries.length) { text('Nothing was recorded on this day.', M, y, { size: 8, c: C.muted }); y += 5; }
    const bottom = H - 26, rowH = 4.9;
    for (const e of d.entries) {
      if (y > bottom) { text(DAILY_NOTE, M, H - 20.5, { size: 6.2, c: C.muted, maxW: W - 2 * M }); footer(page); y = head(d, i, true) + 2; tableHead(); }
      const t = entryText(e);
      fill(TONE[t.tone]); doc.circle(col.what - 2.2, y - 1, 0.9, 'F');
      text(kwClock(e.at), col.time, y, { size: 7.8 });
      text(t.what, col.what, y, { size: 7.8, bold: e.kind === 'low' });
      text(t.amount, col.amount, y, { size: 7.8, c: e.kind === 'meal' && e.carbs === null ? C.notMet : C.ink });
      text(e.kind === 'low' || e.kind === 'sensor' ? '' : e.sensor === null ? '–' : fmt1(e.sensor), col.sensor, y, { size: 7.8, c: e.sensor !== null && e.sensor < 3.9 ? C.low : C.ink });
      const det = printable(t.detail) ? t.detail : '';  // Arabic names: in the app only (see the note)
      doc.setFontSize(7); const lines: string[] = doc.splitTextToSize(det, W - M - col.detail);
      text(lines.length > 1 ? `${lines[0].replace(/\s+\S*$/, '')}…` : lines[0] ?? '', col.detail, y, { size: 7, c: C.muted });
      stroke('#eef1f4'); doc.setLineWidth(0.15); doc.line(M, y + 1.4, W - M, y + 1.4);
      y += rowH;
    }
    text(DAILY_NOTE, M, H - 20.5, { size: 6.2, c: C.muted, maxW: W - 2 * M });
    footer(page);
  });
}

export async function dailyLogPdf(log: DailyLog, p: PatientInfo, generatedAt: number, appVersion = ''): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Daily Log ${log.label}`, subject: 'Continuous glucose monitoring report', creator: "Layan's carb & insulin app" });
  drawDailyLogPdf(doc, log, p, generatedAt, appVersion);
  return doc.output('blob');
}
