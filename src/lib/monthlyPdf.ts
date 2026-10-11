// The Monthly Summary as A4 landscape pages, one per month: a calendar, each day with its glucose curve (same 0–22
// mmol/L scale), its average and its low events. Days outside the report are blank; a day without sensor data is
// grey and says so. Real text and vector drawing (jsPDF), from the same model as the screen (engine/report/monthly.ts).
import type { jsPDF as JsPdf } from 'jspdf';
import { VALIDATION_NOTE, fmt1, fmtPct, kwDate, type PatientInfo } from '../engine/report/agpReport';
import type { MonthlySummary } from '../engine/report/monthly';
import { C, ageText, isoDate, pdfKit } from './reportPdf';

const LW = 297, LH = 210, LM = 10;
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

export function drawMonthlyPdf(doc: JsPdf, s: MonthlySummary, p: PatientInfo, generatedAt: number, appVersion = '') {
  const { fill, stroke, text } = pdfKit(doc, generatedAt, appVersion);
  s.months.forEach((mo, mi) => {
    if (mi > 0) doc.addPage('a4', 'landscape');
    text('Monthly Summary', LM, LM + 6, { size: 18, bold: true, c: C.blue });
    text(mo.label, LM + 68, LM + 6, { size: 14, bold: true });
    text(`${p.name || '–'}${p.birthDate ? `  ·  born ${isoDate(p.birthDate)}${p.birthApprox ? ' (approx.)' : ''}, age ${ageText(p.birthDate, generatedAt)}` : ''}  ·  mmol/L`, LW - LM, LM + 6, { size: 8, c: C.muted, align: 'right' });
    fill(C.soft); doc.rect(LM, LM + 10, LW - 2 * LM, 7, 'F');
    text(`In this report: average ${mo.avg === null ? '–' : fmt1(mo.avg)} mmol/L · in range 3.9–10.0 ${mo.tir === null ? '–' : fmtPct(mo.tir)} · sensor data ${fmtPct(mo.pctActive)} · ${mo.lows} low events · ${mo.daysWithData} days with data`, LM + 2, LM + 14.7, { size: 8.5, bold: true });
    const top = LM + 21, cw = (LW - 2 * LM) / 7, head = 5, rows = mo.weeks.length, chh = (LH - 16 - top - head) / rows;
    DOW.forEach((d, i) => text(d, LM + i * cw + cw / 2, top + 3.5, { size: 7.5, bold: true, c: C.muted, align: 'center' }));
    mo.weeks.forEach((wk, r) => wk.forEach((c, i) => {
      const x = LM + i * cw, y = top + head + r * chh;
      stroke(C.line); doc.setLineWidth(0.2); doc.rect(x, y, cw, chh, 'S');
      if (!c) return;
      text(String(c.day), x + 1.5, y + 4, { size: 8, bold: true, c: c.inPeriod ? C.ink : C.line });
      if (!c.d) return;
      const d = c.d, px = x + 1.5, py = y + 6, pw = cw - 3, ph = chh - 13;
      const X = (k: number) => px + (k / 287) * pw, Y = (v: number) => py + (1 - Math.min(Math.max(v, 0), 22) / 22) * ph;
      if (d.row.cgm.pctActive === 0) { fill('#eef1f4'); doc.rect(px, py, pw, ph, 'F'); text('No sensor data', px + pw / 2, py + ph / 2 + 1, { size: 6, c: C.muted, align: 'center' }); return; }
      fill(C.target); doc.rect(px, Y(10), pw, Y(3.9) - Y(10), 'F');
      stroke(C.median); doc.setLineWidth(0.3);
      for (let k = 1; k < d.mmol.length; k++) { const a = d.mmol[k - 1], b = d.mmol[k]; if (a !== null && b !== null) doc.line(X(k - 1), Y(a), X(k), Y(b)); }
      text(d.avgMmol === null ? '–' : fmt1(d.avgMmol), x + 1.5, y + chh - 2, { size: 7.5, bold: true });
      if (d.row.lows) text(`${d.row.lows} low${d.row.lows > 1 ? 's' : ''}`, x + cw - 1.5, y + chh - 2, { size: 6.5, bold: true, c: C.low, align: 'right' });
      else if (d.row.cgm.pctActive < 70) text(`data ${Math.round(d.row.cgm.pctActive)}%`, x + cw - 1.5, y + chh - 2, { size: 6, c: C.notMet, align: 'right' });
    }));
    text('Each day: glucose midnight to midnight (Kuwait time) on the same 0–22 mmol/L scale, green is 3.9–10.0; the number is the day\'s average; lows are events below 3.9 for 15 minutes or more. Days outside the report period are blank; missing sensor data is never filled in.', LM, LH - 11, { size: 6.2, c: C.muted, maxW: LW - 2 * LM });
    text(VALIDATION_NOTE, LM, LH - 7, { size: 6.2, c: C.notMet });
    text(`Generated ${kwDate(generatedAt)} by Layan's carb & insulin app${appVersion ? ` v${appVersion}` : ''} · Page ${mi + 1}`, LW - LM, LH - 4, { size: 6.2, c: C.muted, align: 'right' });
  });
}

export async function monthlyPdf(s: MonthlySummary, p: PatientInfo, generatedAt: number, appVersion = ''): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'landscape', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Monthly Summary ${s.label}`, subject: 'Continuous glucose monitoring report', creator: "Layan's carb & insulin app" });
  drawMonthlyPdf(doc, s, p, generatedAt, appVersion);
  return doc.output('blob');
}
