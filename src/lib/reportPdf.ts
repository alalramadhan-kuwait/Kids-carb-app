// The AGP report as an A4 portrait PDF: real text (selectable, searchable) and vector charts drawn with jsPDF, so it
// stays sharp when zoomed or printed. Laid out like LibreView's AGP report (statistics and targets, time in ranges,
// the AGP, daily glucose profiles) so a clinician finds everything where they expect it. English, mmol/L.
// Drawn from the same model as the screen (engine/report/agpReport.ts).
import type { jsPDF as JsPdf } from 'jspdf';
import { VALIDATION_NOTE, fmt1, fmtPct, kwDate, type AgpReport, type PatientInfo } from '../engine/report/agpReport';

const C = {
  ink: '#15212b', muted: '#5a6976', line: '#d5dde4', soft: '#f1f5f8', blue: '#1f6fa8',
  band95: '#cfe0f1', band50: '#8fb8e0', median: '#1f5f91', target: '#e6f2ea', targetLine: '#3a8a5c',
  veryHigh: '#e8833a', high: '#f2c744', inRange: '#3aa66a', low: '#e04848', veryLow: '#9b1c1c', met: '#1d7a4c', notMet: '#b3261e',
};
const W = 210, H = 297, M = 12;
const rgb = (hex: string): [number, number, number] => [parseInt(hex.slice(1, 3), 16), parseInt(hex.slice(3, 5), 16), parseInt(hex.slice(5, 7), 16)];

export function ageText(birth: string | null, at: number) {
  if (!birth) return null;
  const b = new Date(birth + 'T00:00:00Z'), n = new Date(at + 3 * 3600000);
  let y = n.getUTCFullYear() - b.getUTCFullYear(), mo = n.getUTCMonth() - b.getUTCMonth();
  if (n.getUTCDate() < b.getUTCDate()) mo--;
  if (mo < 0) { y--; mo += 12; }
  return `${y} y ${mo} m`;
}
const isoDate = (s: string | null) => (s ? kwDate(Date.parse(s + 'T00:00:00+03:00')) : '–');

export function drawAgpPdf(doc: JsPdf, r: AgpReport, p: PatientInfo, appVersion = '') {
  const fill = (hex: string) => doc.setFillColor(...rgb(hex));
  const stroke = (hex: string) => doc.setDrawColor(...rgb(hex));
  const color = (hex: string) => doc.setTextColor(...rgb(hex));
  const text = (s: string, x: number, y: number, o: { size?: number; bold?: boolean; c?: string; align?: 'left' | 'right' | 'center'; maxW?: number } = {}) => {
    doc.setFont('helvetica', o.bold ? 'bold' : 'normal'); doc.setFontSize(o.size ?? 8.5); color(o.c ?? C.ink);
    const lines: string[] = o.maxW ? doc.splitTextToSize(s, o.maxW) : [s];
    doc.text(lines, x, y, { align: o.align ?? 'left', baseline: 'alphabetic', lineHeightFactor: 1.25 });
    return lines.length;
  };
  const box = (x: number, y: number, w: number, h: number, title: string) => {
    fill(C.blue); doc.rect(x, y, w, 6, 'F');
    text(title.toUpperCase(), x + 2, y + 4.2, { size: 7.5, bold: true, c: '#ffffff' });
    stroke(C.line); doc.setLineWidth(0.25); doc.rect(x, y, w, h, 'S');
  };
  let page = 1;
  const footer = () => {
    stroke(C.line); doc.setLineWidth(0.25); doc.line(M, H - 14, W - M, H - 14);
    text('Ranges and targets: international consensus on time in range (2019) and ISPAD 2024 targets for children. GMI = 3.31 + 0.02392 × mean (mg/dL).', M, H - 10.5, { size: 6.2, c: C.muted });
    text(VALIDATION_NOTE, M, H - 7.5, { size: 6.2, c: C.notMet });
    text(`Generated ${kwDate(r.generatedAt)} by Layan's carb & insulin app${appVersion ? ` v${appVersion}` : ''} · Page ${page}`, W - M, H - 4.5, { size: 6.2, c: C.muted, align: 'right' });
  };

  // ── header ──
  text('AGP Report', M, M + 6, { size: 18, bold: true, c: C.blue });
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
  text(r.sufficiency.ok ? 'Enough data for a standard AGP' : `Not enough data for a standard AGP: ${r.sufficiency.reason}`, W - M - 2, y + 4.7, { size: 7.5, c: r.sufficiency.ok ? C.met : C.notMet, align: 'right' });
  y += 10;

  // ── statistics and targets (left) ──
  const colW = 108, rightX = M + colW + 4, rightW = W - M - rightX;
  box(M, y, colW, 78, 'Glucose statistics and targets');
  const m = r.metrics;
  const stats: [string, string][] = [
    ['% time sensor active', fmtPct(m.pctActive)],
    ['Average glucose', m.mean === null ? '–' : `${fmt1(m.mean / 18.016)} mmol/L`],
    ['Glucose management indicator (GMI)', m.gmi === null ? 'needs 14 days, 70% data' : `${fmt1(m.gmi)}%`],
    ['Glucose variability (CV)', m.cv === null ? '–' : `${fmt1(m.cv)}% (goal 36% or less)`],
    ['Standard deviation', m.sd === null ? '–' : `${fmt1(m.sd / 18.016)} mmol/L`],
    ['Time in tight range 3.9–7.8', m.pct ? fmtPct(m.pct.tight) : '–'],
  ];
  let yy = y + 11;
  for (const [k, v] of stats) { text(k, M + 2, yy, { size: 8.5 }); text(v, M + colW - 2, yy, { size: 8.5, bold: true, align: 'right' }); yy += 5; }
  yy += 1.5; stroke(C.line); doc.line(M + 2, yy - 3, M + colW - 2, yy - 3);
  text('Targets (ISPAD 2024)', M + 2, yy + 1, { size: 7.5, bold: true, c: C.muted }); text('Goal', M + 66, yy + 1, { size: 7.5, bold: true, c: C.muted }); text('Result', M + colW - 2, yy + 1, { size: 7.5, bold: true, c: C.muted, align: 'right' });
  yy += 5.5;
  for (const t of r.targets) {
    text(t.label, M + 2, yy, { size: 8 }); text(t.goal, M + 66, yy, { size: 8, c: C.muted });
    text(`${fmtPct(t.value)} ${t.met ? 'met' : 'not met'}`, M + colW - 2, yy, { size: 8, bold: true, c: t.met ? C.met : C.notMet, align: 'right' });
    yy += 4.6;
  }

  // ── time in ranges (right) ──
  box(rightX, y, rightW, 78, 'Time in ranges');
  const barX = rightX + 4, barY = y + 10, barW = 9, barH = 62;
  const shown = r.ranges.map((x) => ({ ...x, h: Math.max(x.pct > 0 ? 1.2 : 0, (x.pct / 100) * barH) }));
  const scale = barH / shown.reduce((s, x) => s + x.h, 0);
  let by = barY;
  const mids: number[] = [];
  for (const x of shown) { const h = x.h * scale; fill(C[x.key]); if (h > 0) doc.rect(barX, by, barW, h, 'F'); mids.push(by + h / 2); by += h; }
  // labels at fixed, evenly spaced rows (as LibreView), each joined to its segment
  const ly = r.ranges.map((_, i) => barY + 4 + (i * (barH - 6)) / 4);
  r.ranges.forEach((x, i) => {
    stroke(C.line); doc.line(barX + barW + 1, mids[i], barX + barW + 4, ly[i]);
    text(x.name, barX + barW + 6, ly[i] - 0.5, { size: 8.5, bold: x.key === 'inRange' });
    text(x.range, barX + barW + 6, ly[i] + 3.2, { size: 6.8, c: C.muted });
    text(fmtPct(x.pct), rightX + rightW - 3, ly[i] - 0.5, { size: 10, bold: true, align: 'right' });
    text(x.minutesPerDay >= 60 ? `${Math.floor(x.minutesPerDay / 60)} h ${x.minutesPerDay % 60} min/day` : `${x.minutesPerDay} min/day`, rightX + rightW - 3, ly[i] + 3.2, { size: 6.8, c: C.muted, align: 'right' });
  });
  y += 82;

  // ── AGP (the largest part of page 1) ──
  const agpH = 116;
  box(M, y, W - 2 * M, agpH, 'Ambulatory glucose profile (AGP)');
  text('Median (line), 25–75% and 5–95% of readings at each time of day, all days laid over 24 hours.', M + 2, y + 10, { size: 7, c: C.muted });
  const cx = M + 12, cy = y + 13, cw = W - 2 * M - 26, ch = agpH - 25, ymax = 22;
  const X = (min: number) => cx + (min / 1440) * cw, Y = (v: number) => cy + (1 - Math.min(Math.max(v, 0), ymax) / ymax) * ch;
  fill(C.target); doc.rect(cx, Y(10), cw, Y(3.9) - Y(10), 'F');
  stroke(C.line); doc.setLineWidth(0.15);
  for (let h = 0; h <= 24; h += 3) { doc.line(X(h * 60), cy, X(h * 60), cy + ch); text(h % 24 === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`, X(h * 60), cy + ch + 4, { size: 7, c: C.muted, align: 'center' }); }
  for (const v of [0, 3.9, 10, 13.9, 22]) text(v === 0 ? '0' : String(v), cx - 1.5, Y(v) + 1, { size: 7, c: v === 3.9 || v === 10 ? C.targetLine : C.muted, align: 'right' });
  // bands as polygons over runs without gaps (a time of day with no data stays empty)
  const runs: AgpReport['agp'][] = [];
  for (const pt of r.agp) { const last = runs[runs.length - 1]; if (last && pt.minute - last[last.length - 1].minute <= 5) last.push(pt); else runs.push([pt]); }
  const band = (lo: 'p5' | 'p25', hi: 'p95' | 'p75', col: string) => {
    fill(col);
    for (const run of runs) {
      if (run.length < 2) continue;
      const pts = [...run.map((q) => [X(q.minute), Y(q[hi])]), ...run.slice().reverse().map((q) => [X(q.minute), Y(q[lo])])];
      doc.lines(pts.slice(1).map((q, i) => [q[0] - pts[i][0], q[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], 'F', true);
    }
  };
  band('p5', 'p95', C.band95); band('p25', 'p75', C.band50);
  stroke(C.targetLine); doc.setLineWidth(0.3); doc.setLineDashPattern([1, 0.8], 0); doc.line(cx, Y(3.9), cx + cw, Y(3.9)); doc.line(cx, Y(10), cx + cw, Y(10)); doc.setLineDashPattern([], 0);
  stroke(C.median); doc.setLineWidth(0.7);
  for (const run of runs) for (let i = 1; i < run.length; i++) doc.line(X(run[i - 1].minute), Y(run[i - 1].p50), X(run[i].minute), Y(run[i].p50));
  const lx = cx + cw + 1.5;
  const last = r.agp[r.agp.length - 1];
  if (last) {
    // percentile labels at the right edge, spread so they never overlap
    const labs = (['p95', 'p75', 'p50', 'p25', 'p5'] as const).map((k) => ({ k, y: Y(last[k]) + 1 }));
    for (let i = 1; i < labs.length; i++) labs[i].y = Math.max(labs[i].y, labs[i - 1].y + 2.8);
    for (const l of labs) text(l.k === 'p50' ? '50%' : `${l.k.slice(1)}%`, lx, l.y, { size: 6, c: l.k === 'p50' ? C.median : C.muted });
  }
  if (r.agp.some((q) => q.thin)) text('Fewer than 5 days of data at some times of day: read those parts with care.', M + 2, y + agpH - 2, { size: 6.5, c: C.notMet });
  y += agpH + 4;

  // ── events: the key numbers first, definitions in small print ──
  const e = r.events, evH = H - 17 - y;
  box(M, y, W - 2 * M, evH, 'Glucose events');
  const big: [string, string, string][] = [
    [String(e.lows), 'Low events', `below 3.9 · ${fmt1(e.lowsPerWeek)} per week`],
    [String(e.veryLows), 'Very low events', 'below 3.0'],
    [String(e.highs), 'High events', 'above 10.0'],
    [String(e.veryHighs), 'Very high events', 'above 13.9'],
  ];
  const bw = (W - 2 * M) / 4;
  big.forEach(([v, l, sub], i) => {
    const bx = M + i * bw + 3;
    text(v, bx, y + 16, { size: 16, bold: true, c: i === 0 || i === 1 ? C.low : C.ink });
    text(l, bx, y + 21, { size: 8, bold: true }); text(sub, bx, y + 24.5, { size: 6.8, c: C.muted });
  });
  text(`Each event lasts at least 15 minutes beyond the limit and ends after 15 minutes back on the other side; no sensor data for over 16 minutes ends it (international consensus, Battelino 2023). Lows over 2 hours: ${e.extendedLows}. LibreView's rule (below 3.9 for longer than 15 minutes) gives ${e.libreViewLows} lows. These counts are for this report only and are separate from the live alerts.`,
    M + 3, y + 29.5, { size: 6.4, c: C.muted, maxW: W - 2 * M - 6 });
  footer();

  // ── daily profiles: 2 per row, 7 rows per page, all on the same 0–22 mmol/L scale ──
  const days = r.daily, PER = 14, cols = 2, gap = 6;
  const top = M + 17, rowH = (H - 18 - top) / 7, gw = (W - 2 * M - gap) / cols;
  for (let start = 0; start < days.length; start += PER) {
    doc.addPage(); page++;
    text('AGP Report · Daily glucose profiles', M, M + 6, { size: 13, bold: true, c: C.blue });
    text(`${p.name || ''}  ·  ${r.label}`, W - M, M + 6, { size: 8, c: C.muted, align: 'right' });
    text('One chart per day, midnight to midnight (Kuwait time). Every chart uses the same scale, 0–22 mmol/L; green is the target range 3.9–10.0; red dots are readings below 3.9. Gaps are missing sensor data and are never filled in.', M, M + 10.5, { size: 6.8, c: C.muted, maxW: W - 2 * M });
    days.slice(start, start + PER).forEach((d, i) => {
      const gx = M + (i % cols) * (gw + gap), gy = top + Math.floor(i / cols) * rowH;
      const px = gx + 7, py = gy + 5, pw = gw - 8, ph = rowH - 11, dy = (v: number) => py + (1 - Math.min(Math.max(v, 0), 22) / 22) * ph, dx = (k: number) => px + (k / 96) * pw;
      const none = d.pctActive === 0;
      text(`${d.weekday} ${d.date}`, gx, gy + 3, { size: 8, bold: true });
      text(none ? 'No sensor data' : d.pctActive < 70 ? `Sensor data ${Math.round(d.pctActive)}% of the day` : `Sensor data ${Math.round(d.pctActive)}%`, gx + gw, gy + 3, { size: 6.5, c: d.pctActive < 70 ? C.notMet : C.muted, align: 'right' });
      if (none) { fill('#eef1f4'); doc.rect(px, py, pw, ph, 'F'); }
      else { fill(C.target); doc.rect(px, dy(10), pw, dy(3.9) - dy(10), 'F'); }
      stroke(C.line); doc.setLineWidth(0.15); doc.rect(px, py, pw, ph, 'S');
      for (let h = 3; h < 24; h += 3) doc.line(px + (h / 24) * pw, py, px + (h / 24) * pw, py + ph);
      for (const v of [3.9, 10, 22]) text(String(v), px - 1, dy(v) + 1, { size: 5.8, c: v === 22 ? C.muted : C.targetLine, align: 'right' });
      for (const h of [0, 6, 12, 18, 24]) text(h % 24 === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`, px + (h / 24) * pw, py + ph + 3.2, { size: 5.8, c: C.muted, align: h === 0 ? 'left' : h === 24 ? 'right' : 'center' });
      if (none) { text('No sensor data for this day (not filled in)', px + pw / 2, py + ph / 2 + 1, { size: 7.5, c: C.muted, align: 'center' }); return; }
      stroke(C.median); doc.setLineWidth(0.45);
      for (let k = 1; k < d.mmol.length; k++) { const a = d.mmol[k - 1], b = d.mmol[k]; if (a !== null && b !== null) doc.line(dx(k - 0.5), dy(a), dx(k + 0.5), dy(b)); }
      for (let k = 0; k < d.mmol.length; k++) { const v = d.mmol[k]; if (v !== null && v < 3.9) { fill(C.low); doc.circle(dx(k + 0.5), dy(v), 0.55, 'F'); } }
    });
    footer();
  }
}

export async function agpPdf(r: AgpReport, p: PatientInfo, appVersion = ''): Promise<Blob> {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });
  doc.setProperties({ title: `AGP Report ${r.label}`, subject: 'Continuous glucose monitoring report', creator: "Layan's carb & insulin app" });
  drawAgpPdf(doc, r, p, appVersion);
  return doc.output('blob');
}
