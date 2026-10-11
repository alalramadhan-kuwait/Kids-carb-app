// Mealtime Patterns as one A4 portrait page: the four meal periods as boxes, each with its glucose curve around the
// meal (median and middle half, fixed 0–22 mmol/L scale) and its numbers. Real text and vector drawing (jsPDF), from
// the same model as the screen (engine/report/mealtime.ts).
import type { jsPDF as JsPdf } from 'jspdf';
import { fmt1, periodLabel, type PatientInfo } from '../engine/report/agpReport';
import { MEALTIME_NOTE, SLOT_LABEL, type Mealtime } from '../engine/report/mealtime';
import { C, H, M, W, ageText, isoDate, pdfKit } from './reportPdf';

const n1 = (x: number | null, unit = '') => (x === null ? '–' : `${fmt1(x)}${unit}`);

export function drawMealtimePdf(doc: JsPdf, mt: Mealtime, p: PatientInfo, generatedAt: number, appVersion = '') {
  const { fill, stroke, text, box, footer } = pdfKit(doc, generatedAt, appVersion);
  text('Mealtime Patterns', M, M + 6, { size: 18, bold: true, c: C.blue });
  text('Continuous glucose monitoring · mmol/L', W - M, M + 6, { size: 8, c: C.muted, align: 'right' });
  text(`${p.name || '–'}${p.birthDate ? `  ·  born ${isoDate(p.birthDate)}${p.birthApprox ? ' (approx.)' : ''}, age ${ageText(p.birthDate, generatedAt)}` : ''}`, M, M + 12, { size: 8.5 });
  fill(C.soft); doc.rect(M, M + 15, W - 2 * M, 7, 'F');
  text(`${periodLabel(mt.from, mt.to)}  ·  ${mt.sittings.length} sittings${mt.treatmentsLeftOut ? `  ·  ${mt.treatmentsLeftOut} low treatments left out` : ''}`, M + 2, M + 19.7, { size: 9, bold: true });
  const top = M + 26, gap = 4, bw = (W - 2 * M - gap) / 2, bh = (H - 32 - top - gap) / 2;
  mt.slots.forEach((s, i) => {
    const x = M + (i % 2) * (bw + gap), y = top + Math.floor(i / 2) * (bh + gap);
    box(x, y, bw, bh, `${SLOT_LABEL[s.slot]} · ${s.sittings} sitting${s.sittings === 1 ? '' : 's'}`);
    // the curve
    const cx = x + 9, cy = y + 10, cw = bw - 13, ch = bh * 0.52;
    const X = (m: number) => cx + ((m + 60) / 300) * cw, Y = (v: number) => cy + (1 - Math.min(Math.max(v, 0), 22) / 22) * ch;
    fill(C.target); doc.rect(cx, Y(10), cw, Y(3.9) - Y(10), 'F');
    stroke(C.line); doc.setLineWidth(0.15); doc.rect(cx, cy, cw, ch, 'S');
    for (const m of [-60, 0, 60, 120, 180, 240]) {
      stroke(m === 0 ? C.muted : C.line); doc.setLineWidth(m === 0 ? 0.3 : 0.15); doc.line(X(m), cy, X(m), cy + ch);
      text(m === 0 ? 'meal' : `${m > 0 ? '+' : ''}${m / 60} h`, X(m), cy + ch + 3.2, { size: 6, c: C.muted, align: 'center' });
    }
    for (const v of [3.9, 10, 22]) text(String(v), cx - 1, Y(v) + 1, { size: 5.8, c: v === 22 ? C.muted : C.targetLine, align: 'right' });
    const runs: Mealtime['slots'][number]['curve'][] = [];
    for (const pt of s.curve) { const last = runs[runs.length - 1]; if (last && pt.min - last[last.length - 1].min <= 15) last.push(pt); else runs.push([pt]); }
    fill(C.band50);
    for (const r of runs) {
      if (r.length < 2) continue;
      const pts = [...r.map((q) => [X(q.min), Y(q.p75)]), ...r.slice().reverse().map((q) => [X(q.min), Y(q.p25)])];
      doc.lines(pts.slice(1).map((q, k) => [q[0] - pts[k][0], q[1] - pts[k][1]]), pts[0][0], pts[0][1], [1, 1], 'F', true);
    }
    stroke(C.median); doc.setLineWidth(0.6);
    for (const r of runs) for (let k = 1; k < r.length; k++) doc.line(X(r[k - 1].min), Y(r[k - 1].p50), X(r[k].min), Y(r[k].p50));
    if (!s.curve.length) text('Not enough meals in this period', cx + cw / 2, cy + ch / 2, { size: 7.5, c: C.muted, align: 'center' });
    // the numbers
    const rows: [string, string][] = [
      ['Before the meal (median)', n1(s.pre, ' mmol/L')], ['Rise to the peak', n1(s.rise, ' mmol/L')], ['Peak after', s.peakMin === null ? '–' : `${Math.round(s.peakMin)} min`],
      ['2 hours after', n1(s.at2h, ' mmol/L')], ['Carbs (median)', s.carbs === null ? '–' : `${Math.round(s.carbs)} g${s.unknownCarbs ? ` · ${s.unknownCarbs} not known` : ''}`],
      ['Rapid insulin (median)', s.insulin === null ? '–' : `${fmt1(s.insulin)} U · ${s.withInsulin} of ${s.sittings} with a dose`], ['Followed by a low (4 h)', `${s.lowsAfter} of ${s.sittings}`],
    ];
    rows.forEach(([k, v], j) => { const yy = cy + ch + 8 + j * 4.2; text(k, x + 3, yy, { size: 7.2 }); text(v, x + bw - 3, yy, { size: 7.2, bold: true, align: 'right', c: k.startsWith('Followed') && s.lowsAfter ? C.low : C.ink }); });
  });
  text(MEALTIME_NOTE, M, H - 26.5, { size: 6.2, c: C.muted, maxW: W - 2 * M });
  footer(1);
}

export async function mealtimePdf(mt: Mealtime, p: PatientInfo, generatedAt: number, appVersion = ''): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `Mealtime Patterns ${periodLabel(mt.from, mt.to)}`, subject: 'Continuous glucose monitoring report', creator: "Layan's carb & insulin app" });
  drawMealtimePdf(doc, mt, p, generatedAt, appVersion);
  return doc.output('blob');
}
