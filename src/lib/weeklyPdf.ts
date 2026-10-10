// The Weekly Summary as A4 portrait pages, one page per week, laid out like LibreView's: a row per day with the
// 24-hour glucose curve (same 0–22 mmol/L scale for every day), what she ate and the low treatments above it, the
// insulin given below it, and the day's average glucose, carbs, insulin and low events at the right.
// Real text and vector drawing (jsPDF), from the same model as the screen (engine/report/weekly.ts).
import type { jsPDF as JsPdf } from 'jspdf';
import { fmt1, type PatientInfo } from '../engine/report/agpReport';
import type { WeeklyDay, WeeklySummary } from '../engine/report/weekly';
import { C, H, M, W, ageText, isoDate, pdfKit } from './reportPdf';
import { placeLabels } from './labelLayout';

const RAPID = '#1f6fa8', LONG = '#6b4fa0', CARB = '#c26a12', TREAT = '#c0392b';
const hour = (h: number) => (h % 24 === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`);
const fmtU = (u: number) => (Math.round(u * 10) / 10).toString();

export function drawWeeklyPdf(doc: JsPdf, s: WeeklySummary, p: PatientInfo, generatedAt: number, appVersion = '') {
  const { fill, stroke, text, footer } = pdfKit(doc, generatedAt, appVersion);
  const labelW = 17, statW = 13, chartX = M + labelW, chartW = W - 2 * M - labelW - 4 * statW - 2;
  const statX = (i: number) => chartX + chartW + 2 + i * statW + statW / 2;
  s.weeks.forEach((wk, wi) => {
    if (wi > 0) doc.addPage();
    // ── header ──
    text('Weekly Summary', M, M + 6, { size: 18, bold: true, c: C.blue });
    text('Continuous glucose monitoring · mmol/L', W - M, M + 6, { size: 8, c: C.muted, align: 'right' });
    text(`${p.name || '–'}${p.birthDate ? `  ·  born ${isoDate(p.birthDate)}${p.birthApprox ? ' (approx.)' : ''}, age ${ageText(p.birthDate, generatedAt)}` : ''}`, M, M + 12, { size: 8.5 });
    fill(C.soft); doc.rect(M, M + 15, W - 2 * M, 7, 'F');
    text(wk.label, M + 2, M + 19.7, { size: 9, bold: true });
    text(`Week ${wi + 1} of ${s.weeks.length}`, W - M - 2, M + 19.7, { size: 7.5, c: C.muted, align: 'right' });
    // ── legend ──
    let lx = M; const ly = M + 27;
    const key = (draw: (x: number, y: number) => void, label: string) => { draw(lx, ly - 1); text(label, lx + 4, ly, { size: 6.8, c: C.muted }); lx += 4 + doc.getTextWidth(label) + 5; };
    key((x, y) => { stroke(C.median); doc.setLineWidth(0.5); doc.line(x, y, x + 3, y); }, 'Glucose');
    key((x, y) => { fill(C.target); doc.rect(x, y - 1.2, 3, 2.4, 'F'); }, 'Target 3.9–10.0');
    key((x, y) => { fill(CARB); doc.circle(x + 1.2, y, 0.9, 'F'); }, 'Carbs eaten (g)');
    key((x, y) => { fill(TREAT); doc.circle(x + 1.2, y, 0.9, 'F'); }, 'Low treatment (g)');
    key((x, y) => { fill(RAPID); doc.triangle(x, y - 1, x + 2.4, y - 1, x + 1.2, y + 1, 'F'); }, 'Rapid insulin given (U)');
    key((x, y) => { fill(LONG); doc.rect(x, y - 1, 2.2, 2.2, 'F'); }, 'Long-acting given (U)');
    key((x, y) => { fill(C.ink); doc.lines([[1, -1], [1, 1], [-1, 1], [-1, -1]], x + 0.2, y, [1, 1], 'F', true); }, 'Finger-prick');
    // ── column heads ──
    const headY = M + 34;
    text('Day', M, headY, { size: 7, bold: true, c: C.muted });
    for (const h of [0, 6, 12, 18, 24]) text(hour(h), chartX + (h / 24) * chartW, headY, { size: 6.5, c: C.muted, align: h === 0 ? 'left' : h === 24 ? 'right' : 'center' });
    ['Average', 'Carbs', 'Insulin', 'Lows'].forEach((h, i) => text(h, statX(i), headY, { size: 7, bold: true, c: C.muted, align: 'center' }));
    stroke(C.line); doc.setLineWidth(0.25); doc.line(M, headY + 1.5, W - M, headY + 1.5);
    // ── one row per day ──
    const top = headY + 3, rowH = (H - 24 - top) / 7;
    wk.days.forEach((d, i) => drawDay(d, top + i * rowH, rowH));
    text(WEEKLY_NOTE, M, H - 20.5, { size: 6.2, c: C.muted, maxW: W - 2 * M });
    footer(wi + 1);
  });

  function drawDay(d: WeeklyDay, y: number, rowH: number) {
    const strip = 5.5, py = y + strip, ph = rowH - 2 * strip - 1.5;
    const X = (min: number) => chartX + (min / 1440) * chartW, Y = (v: number) => py + (1 - Math.min(Math.max(v, 0), 22) / 22) * ph;
    const none = d.row.cgm.pctActive === 0;
    text(d.weekday, M, y + rowH / 2 - 1, { size: 9, bold: true }); text(d.date, M, y + rowH / 2 + 3, { size: 7.5, c: C.muted });
    if (d.row.cgm.pctActive > 0 && d.row.cgm.pctActive < 70) text(`data ${Math.round(d.row.cgm.pctActive)}%`, M, y + rowH / 2 + 6.5, { size: 6, c: C.notMet });
    // plot
    if (none) { fill('#eef1f4'); doc.rect(chartX, py, chartW, ph, 'F'); text('No sensor data for this day (not filled in)', chartX + chartW / 2, py + ph / 2 + 1, { size: 7.5, c: C.muted, align: 'center' }); }
    else { fill(C.target); doc.rect(chartX, Y(10), chartW, Y(3.9) - Y(10), 'F'); }
    stroke(C.line); doc.setLineWidth(0.15); doc.rect(chartX, py, chartW, ph, 'S');
    for (let h = 3; h < 24; h += 3) doc.line(X(h * 60), py, X(h * 60), py + ph);
    text('22', chartX - 0.8, py + 1.6, { size: 5.2, c: C.muted, align: 'right' }); text('10', chartX - 0.8, Y(10) + 0.8, { size: 5.2, c: C.targetLine, align: 'right' }); text('3.9', chartX - 0.8, Y(3.9) + 0.8, { size: 5.2, c: C.targetLine, align: 'right' });
    if (!none) {
      stroke(C.median); doc.setLineWidth(0.4);
      for (let k = 1; k < d.mmol.length; k++) { const a = d.mmol[k - 1], b = d.mmol[k]; if (a !== null && b !== null) doc.line(X((k - 0.5) * 5), Y(a), X((k + 0.5) * 5), Y(b)); }
      for (let k = 0; k < d.mmol.length; k++) { const v = d.mmol[k]; if (v !== null && v < 3.9) { fill(C.low); doc.circle(X((k + 0.5) * 5), Y(v), 0.38, 'F'); } }
    }
    for (const f of d.fingerPricks) { fill(C.ink); const fx = X(f.minute), fy = Y(f.mmol); doc.lines([[0.9, -0.9], [0.9, 0.9], [-0.9, 0.9], [-0.9, -0.9]], fx - 0.9, fy, [1, 1], 'F', true); }
    // food above (meals orange, low treatments red), insulin below; labels step down a line when they would touch
    // two label lines per strip, shared layout with the screen (lib/labelLayout.ts)
    const strip0: { x: number; label: string; col: string; mark: (x: number, y: number) => void }[] = [], strip1: typeof strip0 = [];
    const put = (row: 0 | 1, x: number, label: string, col: string, mark: (x: number, y: number) => void) => (row === 0 ? strip0 : strip1).push({ x, label, col, mark });
    const flush = (items: typeof strip0, row: 0 | 1) => {
      doc.setFontSize(6.2);
      placeLabels(items.map((it) => ({ x: it.x + 1.3, w: doc.getTextWidth(it.label) + 1.6 }))).forEach((pl, k) => {
        const base = row === 0 ? y + 2.6 + pl.line * 2.6 : py + ph + 2.6 + pl.line * 2.6;
        items[k].mark(items[k].x, base - 0.9); text(items[k].label, pl.lx, base, { size: 6.2, c: items[k].col });
      });
    };
    const food = [...d.carbs.map((c) => ({ minute: c.minute, label: c.grams === null ? '? g' : `${Math.round(c.grams)}g`, col: CARB })),
      ...d.treatments.map((t) => ({ minute: t.minute, label: t.grams === null ? 'treat' : `${Math.round(t.grams)}g`, col: TREAT }))].sort((a, b) => a.minute - b.minute);
    for (const f of food) put(0, X(f.minute), f.label, f.col, (x, yy) => { fill(f.col); doc.circle(x, yy, 0.8, 'F'); });
    for (const ins of [...d.insulin].sort((a, b) => a.minute - b.minute)) put(1, X(ins.minute), `${fmtU(ins.units)}U`, ins.type === 'long' ? LONG : RAPID, (x, yy) => {
      if (ins.type === 'long') { fill(LONG); doc.rect(x - 0.9, yy - 0.9, 1.8, 1.8, 'F'); } else { fill(RAPID); doc.triangle(x - 1, yy - 0.9, x + 1, yy - 0.9, x, yy + 0.9, 'F'); }
    });
    flush(strip0, 0); flush(strip1, 1);
    // stats
    const mid = y + rowH / 2;
    const r = d.row;
    text(d.avgMmol === null ? '–' : fmt1(d.avgMmol), statX(0), mid, { size: 11, bold: true, align: 'center' });
    text('mmol/L', statX(0), mid + 3.6, { size: 5.8, c: C.muted, align: 'center' });
    text(r.meals ? `${Math.round(r.carbs)}` : '–', statX(1), mid, { size: 11, bold: true, align: 'center' });
    text(r.mealsUnknownCarbs ? `g + ${r.mealsUnknownCarbs} unknown` : 'g', statX(1), mid + 3.6, { size: 5.8, c: r.mealsUnknownCarbs ? C.notMet : C.muted, align: 'center' });
    text(r.total === null ? '–' : fmtU(r.total), statX(2), mid, { size: 11, bold: true, align: 'center' });
    text(r.total === null ? 'none logged' : `U · R ${fmtU(r.rapid)} L ${fmtU(r.long)}`, statX(2), mid + 3.6, { size: 5.8, c: C.muted, align: 'center' });
    text(String(r.lows), statX(3), mid, { size: 11, bold: true, c: r.lows ? C.low : C.ink, align: 'center' });
    text(r.veryLows ? `${r.veryLows} below 3.0` : r.treatments ? `${r.treatments} treated` : '', statX(3), mid + 3.6, { size: 5.8, c: C.muted, align: 'center' });
    stroke(C.line); doc.setLineWidth(0.15); doc.line(M, y + rowH - 0.3, W - M, y + rowH - 0.3);
  }
}

export const WEEKLY_NOTE = 'Carbs: meals confirmed as eaten (? = a meal whose carbs are not known; it is not counted as 0). Low treatments are shown apart. Insulin: doses given, not calculator suggestions (R rapid, L long-acting). Lows: events below 3.9 mmol/L lasting 15 minutes or more (separate from the live alerts).';

export async function weeklyPdf(s: WeeklySummary, p: PatientInfo, generatedAt: number, appVersion = ''): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Weekly Summary ${s.label}`, subject: 'Continuous glucose monitoring report', creator: "Layan's carb & insulin app" });
  drawWeeklyPdf(doc, s, p, generatedAt, appVersion);
  return doc.output('blob');
}
