// Charts for the doctor reports, drawn from the report model (engine/report/agpReport.ts). SVG, mmol/L, the
// standard clinical colours for the five ranges. The same model draws the PDF (lib/reportPdf.ts).
import { useState } from 'react';
import type { AgpReport, DailyProfile } from '../../engine/report/agpReport';
import { fmt1, fmtPct } from '../../engine/report/agpReport';

export const RANGE_COLOR = { veryHigh: '#e8833a', high: '#f2c744', inRange: '#3aa66a', low: '#e04848', veryLow: '#9b1c1c' } as const;
const BAND95 = '#cfe0f1', BAND50 = '#8fb8e0', MEDIAN = '#1f5f91', TARGET = '#e6f2ea', TARGET_LINE = '#3a8a5c';

/** The five ranges as one horizontal bar, very low on the left. */
export function TirBar({ r, height = 14 }: { r: AgpReport; height?: number }) {
  const order = [...r.ranges].reverse();
  return (
    <div className="flex w-full overflow-hidden rounded-md" style={{ height }} role="img" aria-label={r.ranges.map((x) => `${x.name} ${fmtPct(x.pct)}`).join(', ')}>
      {order.map((x) => x.pct > 0 && <span key={x.key} style={{ width: `${Math.max(x.pct, 0.8)}%`, background: RANGE_COLOR[x.key] }} />)}
    </div>
  );
}

const hourLabel = (h: number) => (h % 24 === 0 ? '12am' : h === 12 ? '12pm' : h < 12 ? `${h}am` : `${h - 12}pm`);

/** The AGP: 5–95% and 25–75% bands with the median, target 3.9–10.0 shaded; tap or hover for the values. */
export function AgpChart({ r, compact = false }: { r: AgpReport; compact?: boolean }) {
  const W = 360, H = compact ? 90 : 220, L = compact ? 2 : 26, R = compact ? 2 : 8, T = compact ? 2 : 8, B = compact ? 2 : 20, ymax = 22;
  const x = (m: number) => L + (m / 1440) * (W - L - R), y = (v: number) => T + (1 - Math.min(Math.max(v, 0), ymax) / ymax) * (H - T - B);
  const runs: AgpReport['agp'][] = [];
  for (const p of r.agp) { const last = runs[runs.length - 1]; if (last && p.minute - last[last.length - 1].minute <= 5) last.push(p); else runs.push([p]); }
  const area = (run: AgpReport['agp'], lo: 'p5' | 'p25', hi: 'p95' | 'p75') => `M${run.map((p) => `${x(p.minute)},${y(p[hi])}`).join('L')}L${run.slice().reverse().map((p) => `${x(p.minute)},${y(p[lo])}`).join('L')}Z`;
  const [hover, setHover] = useState<AgpReport['agp'][number] | null>(null);
  const pick = (clientX: number, el: SVGSVGElement) => {
    const b = el.getBoundingClientRect(), m = ((clientX - b.left) / b.width * W - L) / (W - L - R) * 1440;
    let best: AgpReport['agp'][number] | null = null;
    for (const p of r.agp) if (!best || Math.abs(p.minute - m) < Math.abs(best.minute - m)) best = p;
    setHover(best);
  };
  return (
    <div className="relative rounded-xl p-1" style={{ background: '#ffffff' }}>
      <svg viewBox={`0 0 ${W} ${H}`} className="block h-auto w-full touch-pan-y" role="img" aria-label="Ambulatory glucose profile: median and percentile bands over 24 hours, mmol/L"
        onPointerMove={compact ? undefined : (e) => pick(e.clientX, e.currentTarget)} onPointerDown={compact ? undefined : (e) => pick(e.clientX, e.currentTarget)} onPointerLeave={() => setHover(null)}>
        <rect x={L} y={y(10)} width={W - L - R} height={y(3.9) - y(10)} fill={TARGET} />
        {!compact && [0, 6, 12, 18, 24].map((h) => <g key={h}><line x1={x(h * 60)} x2={x(h * 60)} y1={T} y2={H - B} stroke="#e2e8f0" strokeWidth={0.6} /><text x={x(h * 60)} y={H - 6} fontSize={9} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'} fill="#64748b">{hourLabel(h)}</text></g>)}
        {runs.map((run, i) => run.length > 1 && <path key={`a${i}`} d={area(run, 'p5', 'p95')} fill={BAND95} />)}
        {runs.map((run, i) => run.length > 1 && <path key={`b${i}`} d={area(run, 'p25', 'p75')} fill={BAND50} />)}
        {[3.9, 10].map((v) => <line key={v} x1={L} x2={W - R} y1={y(v)} y2={y(v)} stroke={TARGET_LINE} strokeWidth={0.8} strokeDasharray="3 2.5" />)}
        {runs.map((run, i) => <path key={`m${i}`} d={`M${run.map((p) => `${x(p.minute)},${y(p.p50)}`).join('L')}`} fill="none" stroke={MEDIAN} strokeWidth={compact ? 1.4 : 2} />)}
        {!compact && [3.9, 10, 13.9].map((v) => <text key={v} x={L - 3} y={y(v) + 3} fontSize={9} textAnchor="end" fill={v === 13.9 ? '#64748b' : TARGET_LINE}>{v}</text>)}
        {hover && <><line x1={x(hover.minute)} x2={x(hover.minute)} y1={T} y2={H - B} stroke="#64748b" strokeWidth={0.8} /><circle cx={x(hover.minute)} cy={y(hover.p50)} r={3.5} fill={MEDIAN} stroke="#fff" strokeWidth={1.5} /></>}
      </svg>
      {hover && !compact && (
        <div className="pointer-events-none absolute left-2 top-1 rounded-lg border border-slate-200 bg-white/95 px-2 py-1 text-xs shadow-sm">
          <b>{String(Math.floor(hover.minute / 60)).padStart(2, '0')}:{String(hover.minute % 60).padStart(2, '0')}</b> · median <b className="num">{fmt1(hover.p50)}</b>
          <div className="num text-slate-600">25–75%: {fmt1(hover.p25)}–{fmt1(hover.p75)} · 5–95%: {fmt1(hover.p5)}–{fmt1(hover.p95)} · {hover.days} days</div>
        </div>
      )}
    </div>
  );
}

/** One day, midnight to midnight, 0–22 mmol/L; gaps stay gaps; readings under 3.9 marked red. */
export function DayProfile({ d }: { d: DailyProfile }) {
  const W = 100, H = 46, y = (v: number) => 2 + (1 - Math.min(v, 22) / 22) * (H - 4), x = (k: number) => (k / 95) * W;
  const segs: string[] = []; let cur = '';
  d.mmol.forEach((v, k) => { if (v === null) { if (cur) segs.push(cur); cur = ''; } else cur += `${cur ? 'L' : 'M'}${x(k)},${y(v)}`; });
  if (cur) segs.push(cur);
  return (
    <div className="min-w-0">
      <div className="flex items-baseline justify-between text-[11px]"><b>{d.weekday} {d.date}</b>{d.pctActive < 70 && <span className="text-red-700">{Math.round(d.pctActive)}% data</span>}</div>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block h-12 w-full rounded border border-slate-200" style={{ background: '#ffffff' }} role="img" aria-label={`${d.weekday} ${d.date} glucose`}>
        <rect x={0} y={y(10)} width={W} height={y(3.9) - y(10)} fill={TARGET} />
        {segs.map((s, i) => <path key={i} d={s} fill="none" stroke={MEDIAN} strokeWidth={1.2} vectorEffect="non-scaling-stroke" />)}
        {d.mmol.map((v, k) => v !== null && v < 3.9 && <circle key={k} cx={x(k)} cy={y(v)} r={1.6} fill={RANGE_COLOR.low} />)}
      </svg>
    </div>
  );
}
