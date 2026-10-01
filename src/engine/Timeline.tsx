// CGM Timeline Engine — renderer and gestures (GLUCOSE_PLAN 11.4–11.7, 11.13). Canvas 2D, redrawn only when
// something changes. Time runs left → right whatever the page direction; gaps are breaks with a label.
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import { formatGlucose, type GlucoseUnit } from '../lib/glucose';
import {
  PERIODS, delta15, freshness, gapsIn, limitEnd, nearest, rateAt, runsFor, tickLabel, timeTicks, yDomain, zoomAt,
  type Series, type View,
} from './series';
import { groupLabel, groupMarks, type Group, type Layer, type Mark, type MarkKind } from './events';
import { ICONS, type IconName } from '../icons/defs';

const MARK_ICON: Record<MarkKind, IconName> = { meal: 'meals', carbs: 'carbs', insulin: 'insulin', basal: 'insulin', treatment: 'treatment', exercise: 'activity', note: 'note', sleep: 'moon' };
const iconPaths = new Map<IconName, Path2D[]>();
const pathsOf = (n: IconName) => { let p = iconPaths.get(n); if (!p) { p = (ICONS[n] as { d: string[] }).d.map((d) => new Path2D(d)); iconPaths.set(n, p); } return p; };

export interface Range { low: number | null; high: number | null } // the parents' range, mg/dL
export interface Inspect { t: number; i: number | null; x: number }

const LONG_PRESS = 350, TAP_SLOP = 8, DOUBLE_TAP = 300;
const css = (name: string, a = 1) => {
  const v = getComputedStyle(document.documentElement).getPropertyValue(name).trim();
  return a === 1 ? `rgb(${v})` : `rgb(${v} / ${a})`;
};
const KW = 3 * 3600000;
const clock = (t: number) => { const d = new Date(t + KW); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };

export function Timeline({ series, view, now, onView, range, unit, height, marks = [], layers, onSelect }: {
  series: Series; view: View; now: number; onView: (v: View, opts?: { animate?: boolean }) => void;
  range: Range; unit: GlucoseUnit; height: number;
  marks?: Mark[]; layers?: Set<Layer>; onSelect?: (g: Group) => void;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const [width, setWidth] = useState(0);
  const [inspect, setInspect] = useState<Inspect | null>(null);
  const viewRef = useRef(view); viewRef.current = view;

  useLayoutEffect(() => {
    const el = wrap.current!;
    const ro = new ResizeObserver(() => setWidth(el.clientWidth));
    ro.observe(el); setWidth(el.clientWidth);
    return () => ro.disconnect();
  }, []);

  // ── drawing ──
  const PAD_T = 10, PAD_B = 22;
  const hasRail = !!layers && layers.size > 0;
  const RAIL = hasRail ? 44 : 0;
  const groupsRef = useRef<Group[]>([]);
  const draw = useCallback(() => {
    const c = canvas.current; if (!c || !width) return;
    const dpr = Math.min(3, window.devicePixelRatio || 1);
    if (c.width !== Math.round(width * dpr) || c.height !== Math.round(height * dpr)) { c.width = Math.round(width * dpr); c.height = Math.round(height * dpr); }
    const g = c.getContext('2d')!;
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, width, height);
    const { end, span } = view, start = end - span;
    const plotH = height - PAD_T - PAD_B - RAIL;
    const railY = PAD_T + plotH + 18;
    const groups = hasRail ? groupMarks(marks, layers!, start, end, width) : [];
    groupsRef.current = groups;
    const runs = runsFor(series, start, end, width);
    let maxV: number | null = null;
    for (const r of runs) for (const v of r.v) if (maxV === null || v > maxV) maxV = v;
    const [y0, y1] = yDomain(maxV);
    const Y = (v: number) => PAD_T + plotH - ((Math.min(Math.max(v, y0), y1) - y0) / (y1 - y0)) * plotH;
    const X = (t: number) => ((t - start) / span) * width;

    // target band: the parents' range, only if they set one
    if (range.low !== null || range.high !== null) {
      const top = Y(range.high ?? y1), bot = Y(range.low ?? y0);
      g.fillStyle = css('--st-in', 0.13); g.fillRect(0, top, width, bot - top);
      g.strokeStyle = css('--st-in', 0.45); g.lineWidth = 1; g.setLineDash([]);
      for (const v of [range.low, range.high]) if (v !== null) { g.beginPath(); g.moveTo(0, Y(v) + 0.5); g.lineTo(width, Y(v) + 0.5); g.stroke(); }
    }

    // glucose grid labels (right edge), in the parents' unit
    g.font = '11px "Nunito Sans", system-ui, sans-serif'; g.fillStyle = css('--text-3'); g.textAlign = 'right'; g.textBaseline = 'middle'; g.direction = 'ltr';
    const grid = unit === 'mmol' ? [4, 8, 12, 16, 20].map((m) => m * 18.016) : [100, 200, 300];
    g.strokeStyle = css('--border'); g.lineWidth = 1;
    const gridYs: [number, string][] = [];
    for (const v of grid) if (v > y0 && v < y1) {
      const y = Math.round(Y(v)) + 0.5;
      g.beginPath(); g.moveTo(0, y); g.lineTo(width - 26, y); g.stroke();
      gridYs.push([y, formatGlucose(v, unit).replace(/\.0$/, '')]);
    }

    // time axis
    const { step, ticks } = timeTicks(start, end, width);
    g.textAlign = 'center'; g.textBaseline = 'alphabetic'; g.fillStyle = css('--text-3');
    for (const t of ticks) { const x = X(t); g.fillRect(Math.round(x), height - PAD_B, 1, 4); if (x > 16 && x < width - 16) g.fillText(tickLabel(t, step), x, height - 6); }

    // gaps: hatched, labelled with how long nothing came in
    g.direction = 'rtl'; g.textAlign = 'center';
    for (const gap of gapsIn(series, start, end, now)) {
      const a = Math.max(0, X(gap.from)), b = Math.min(width, X(gap.to));
      if (b - a < 2) continue;
      g.fillStyle = css('--text-3', 0.08); g.fillRect(a, PAD_T, b - a, plotH);
      g.fillStyle = css('--text-2'); g.font = '600 11px "Noto Sans Arabic", system-ui, sans-serif';
      if (b - a > 44) g.fillText(b - a > 110 ? `${gap.minutes} د بلا قراءة` : `${gap.minutes} د`, (a + b) / 2, PAD_T + 14);
      else if (span <= 24 * 3600000) g.fillText(`${gap.minutes} د`, Math.min(width - 16, Math.max(16, (a + b) / 2)), PAD_T + 14); // narrow: a compact tag
    }
    g.direction = 'ltr';

    // sleep: a faint band behind the trace; event times: hairlines up through the plot
    if (hasRail) {
      if (layers!.has('sleep')) for (const m of marks) if (m.kind === 'sleep' && m.end! > start && m.t < end) {
        g.fillStyle = css('--primary', 0.1); g.fillRect(X(m.t), PAD_T, X(m.end!) - X(m.t), plotH);
      }
      g.strokeStyle = css('--text-3', 0.35); g.lineWidth = 1; g.setLineDash([2, 3]);
      for (const gr of groups) { const x = Math.round(gr.x) + 0.5; g.beginPath(); g.moveTo(x, PAD_T); g.lineTo(x, PAD_T + plotH); g.stroke(); }
      g.setLineDash([]);
    }

    // the trace: one path, stroked neutral, then re-stroked in state colours clipped to each band
    const path = new Path2D();
    for (const r of runs) {
      if (r.x.length === 1) { path.moveTo(r.x[0] - 1.2, Y(r.v[0])); path.lineTo(r.x[0] + 1.2, Y(r.v[0])); continue; }
      r.x.forEach((x, k) => (k ? path.lineTo(x, Y(r.v[k])) : path.moveTo(x, Y(r.v[k]))));
    }
    // beyond 3 days the min–max columns become a range band: lighter, so it reads as spread rather than a line
    const wide = span > 3 * 86400000;
    g.lineJoin = 'round'; g.lineCap = 'round'; g.lineWidth = span <= 6 * 3600000 ? 2.6 : wide ? 1 : 2;
    g.globalAlpha = wide ? 0.55 : 1;
    g.strokeStyle = css('--primary-strong'); g.stroke(path);
    const hasRange = range.low !== null || range.high !== null;
    const band = (top: number, bottom: number, color: string) => { g.save(); g.beginPath(); g.rect(0, top, width, bottom - top); g.clip(); g.strokeStyle = color; g.stroke(path); g.restore(); };
    if (hasRange) {
      if (range.low !== null) band(Y(range.low), height, css('--st-low'));
      band(Y(54), height, css('--st-low-text'));
      if (range.high !== null) band(0, Y(range.high), css('--st-high'));
      band(0, Y(250), css('--st-high-text'));
    }
    g.globalAlpha = 1;
    // glucose labels on a chip so the trace never hides them
    g.font = '11px "Nunito Sans", system-ui, sans-serif'; g.textAlign = 'right'; g.textBaseline = 'middle';
    for (const [y, label] of gridYs) {
      const w = g.measureText(label).width + 6;
      g.fillStyle = css('--surface', 0.9); g.fillRect(width - w - 1, y - 7, w, 14);
      g.fillStyle = css('--text-3'); g.fillText(label, width - 4, y);
    }

    // dots for every reading when zoomed in
    if (span <= 3 * 3600000) {
      const cIn = css('--primary-strong'), cLow = css('--st-low'), cVLow = css('--st-low-text'), cHigh = css('--st-high'), cVHigh = css('--st-high-text');
      const dot = (v: number) => !hasRange ? cIn : v < 54 ? cVLow : range.low !== null && v < range.low ? cLow : v > 250 ? cVHigh : range.high !== null && v > range.high ? cHigh : cIn;
      for (const r of runs) if (r.raw) for (let k = 0; k < r.x.length; k++) { g.fillStyle = dot(r.v[k]); g.beginPath(); g.arc(r.x[k], Y(r.v[k]), 1.9, 0, 7); g.fill(); }
    }
    // newest reading
    const n = series.t.length;
    if (n && series.t[n - 1] >= start && series.t[n - 1] <= end) {
      const x = X(series.t[n - 1]), y = Y(series.v[n - 1]);
      g.fillStyle = css('--surface'); g.beginPath(); g.arc(x, y, 6, 0, 7); g.fill();
      g.fillStyle = css('--primary-strong'); g.beginPath(); g.arc(x, y, 4.5, 0, 7); g.fill();
    }
    // event rail: one chip per group, its icon, a count when several, and a short label when there is room
    if (hasRail) {
      g.strokeStyle = css('--border'); g.lineWidth = 1; g.beginPath(); g.moveTo(0, PAD_T + plotH + 0.5); g.lineTo(width, PAD_T + plotH + 0.5); g.stroke();
      if (layers!.has('exercise')) for (const m of marks) if (m.kind === 'exercise' && m.end! > start && m.t < end) {
        g.fillStyle = css('--primary', 0.35); g.fillRect(X(m.t), railY + 13, Math.max(3, X(m.end!) - X(m.t)), 3);
      }
      g.font = '600 10.5px "Noto Sans Arabic", "Nunito Sans", system-ui, sans-serif'; g.textAlign = 'center'; g.direction = 'rtl'; g.textBaseline = 'alphabetic';
      groups.forEach((gr, k) => {
        const x = Math.min(width - 14, Math.max(14, gr.x));
        const kind = gr.marks[0].kind;
        const tone = kind === 'treatment' ? '--st-low' : '--primary-strong';
        g.fillStyle = css('--surface'); g.strokeStyle = css(tone, 0.55); g.lineWidth = 1.5;
        g.beginPath(); g.arc(x, railY, 12.5, 0, 7); g.fill(); g.stroke();
        g.save(); g.translate(x - 8.4, railY - 8.4); g.scale(0.7, 0.7);
        g.strokeStyle = css(tone); g.lineWidth = 2.4; g.lineCap = 'round'; g.lineJoin = 'round';
        for (const p of pathsOf(MARK_ICON[kind])) g.stroke(p);
        g.restore();
        if (gr.marks.length > 1) {
          g.fillStyle = css('--primary-strong'); g.beginPath(); g.arc(x + 10, railY - 10, 7, 0, 7); g.fill();
          g.fillStyle = css('--surface'); g.direction = 'ltr'; g.fillText(String(gr.marks.length), x + 10, railY - 6.5); g.direction = 'rtl';
        }
        const label = span <= 12 * 3600000 ? groupLabel(gr) : '';
        if (label) {
          const w = g.measureText(label).width, next = groups[k + 1]?.x ?? Infinity, prev = groups[k - 1]?.x ?? -Infinity;
          if (next - x > w / 2 + 16 && x - prev > w / 2 + 16) { g.fillStyle = css('--text-2'); g.fillText(label, x, railY + 25); }
        }
      });
      g.direction = 'ltr';
    }

    // now
    if (now >= start && now <= end) {
      g.strokeStyle = css('--text-3', 0.6); g.setLineDash([3, 4]); g.beginPath(); g.moveTo(Math.round(X(now)) + 0.5, PAD_T); g.lineTo(Math.round(X(now)) + 0.5, PAD_T + plotH); g.stroke(); g.setLineDash([]);
    }
    // crosshair
    if (inspect) {
      const x = inspect.i !== null ? X(series.t[inspect.i]) : inspect.x;
      g.strokeStyle = css('--text'); g.lineWidth = 1; g.beginPath(); g.moveTo(Math.round(x) + 0.5, PAD_T); g.lineTo(Math.round(x) + 0.5, PAD_T + plotH); g.stroke();
      if (inspect.i !== null) {
        const y = Y(series.v[inspect.i]);
        g.fillStyle = css('--surface'); g.beginPath(); g.arc(x, y, 7, 0, 7); g.fill();
        g.strokeStyle = css('--text'); g.lineWidth = 2; g.beginPath(); g.arc(x, y, 5, 0, 7); g.stroke();
      }
    }
  }, [series, view, now, range.low, range.high, unit, width, height, inspect, marks, layers, hasRail, RAIL]);

  useEffect(() => { const id = requestAnimationFrame(draw); return () => cancelAnimationFrame(id); }, [draw]);
  useEffect(() => { // redraw on light/dark change
    const mq = window.matchMedia('(prefers-color-scheme: dark)');
    const f = () => requestAnimationFrame(draw); mq.addEventListener('change', f); return () => mq.removeEventListener('change', f);
  }, [draw]);

  // ── gestures ──
  const g = useRef({
    pts: new Map<number, { x: number; y: number }>(), mode: 'none' as 'none' | 'pan' | 'pinch' | 'cross' | 'pending',
    x0: 0, y0: 0, t0: 0, view0: view, dist0: 0, mid0: 0, timer: 0, lastTap: { t: 0, x: 0 }, vel: 0, lastX: 0, lastT: 0, fling: 0, wasLow: false, lastInspectT: 0,
  });
  const rect = () => wrap.current!.getBoundingClientRect();
  const inspectAt = (clientX: number) => {
    const r = rect(), x = clientX - r.left, v = viewRef.current;
    const t = v.end - v.span + (x / r.width) * v.span;
    const i = nearest(series, t, Math.max(5 * 60000, (v.span / r.width) * 12));
    const low = i !== null && range.low !== null && series.v[i] < range.low;
    if (low && !g.current.wasLow) navigator.vibrate?.(8); // Android only; iPhone web apps cannot vibrate
    g.current.wasLow = low;
    const prevT = g.current.lastInspectT;
    if (prevT && layers && marks.some((m) => layers.has(m.layer) && (m.t - prevT) * (m.t - t) < 0)) navigator.vibrate?.(6);
    g.current.lastInspectT = t;
    setInspect({ t, i, x });
  };
  const stopFling = () => { cancelAnimationFrame(g.current.fling); g.current.fling = 0; };

  const onDown = (e: React.PointerEvent) => {
    stopFling();
    (e.target as Element).setPointerCapture?.(e.pointerId);
    const s = g.current; s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (s.pts.size === 1) {
      Object.assign(s, { mode: 'pending', x0: e.clientX, y0: e.clientY, t0: performance.now(), view0: viewRef.current, vel: 0, lastX: e.clientX, lastT: performance.now() });
      window.clearTimeout(s.timer);
      s.timer = window.setTimeout(() => { if (s.mode === 'pending') { s.mode = 'cross'; inspectAt(s.x0); } }, LONG_PRESS);
    } else if (s.pts.size === 2) {
      window.clearTimeout(s.timer);
      const [a, b] = [...s.pts.values()];
      const r = rect();
      Object.assign(s, { mode: 'pinch', dist0: Math.hypot(a.x - b.x, a.y - b.y) || 1, mid0: ((a.x + b.x) / 2 - r.left) / r.width, view0: viewRef.current });
      setInspect(null);
    }
  };
  const onMove = (e: React.PointerEvent) => {
    const s = g.current; if (!s.pts.has(e.pointerId)) return;
    s.pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
    const r = rect();
    if (s.mode === 'cross') return inspectAt(e.clientX);
    if (s.mode === 'pinch' && s.pts.size >= 2) {
      const [a, b] = [...s.pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y) || 1, mid = ((a.x + b.x) / 2 - r.left) / r.width;
      let v = zoomAt(s.view0, s.dist0 / dist, s.mid0);
      v = { ...v, end: v.end - (mid - s.mid0) * v.span };
      onView({ span: v.span, end: limitEnd(v.end, now, v.span) });
      return;
    }
    if (s.mode === 'pending' && Math.abs(e.clientX - s.x0) > TAP_SLOP) { window.clearTimeout(s.timer); s.mode = 'pan'; setInspect(null); }
    if (s.mode === 'pan') {
      const t = performance.now();
      s.vel = (e.clientX - s.lastX) / Math.max(1, t - s.lastT); s.lastX = e.clientX; s.lastT = t;
      const end = s.view0.end - ((e.clientX - s.x0) / r.width) * s.view0.span;
      onView({ span: s.view0.span, end: limitEnd(end, now, s.view0.span) });
    }
  };
  const onUp = (e: React.PointerEvent) => {
    const s = g.current; s.pts.delete(e.pointerId);
    window.clearTimeout(s.timer);
    const r = rect();
    if (s.mode === 'pinch') {
      if (s.pts.size === 1) { const [p] = [...s.pts.values()]; Object.assign(s, { mode: 'pan', x0: p.x, view0: viewRef.current, lastX: p.x }); return; }
      // settle on the nearest standard period at or above the pinched span
      const v = viewRef.current, target = PERIODS.find((p) => p.ms >= v.span * 0.92)?.ms ?? v.span;
      s.mode = 'none';
      onView(zoomAt(v, target / v.span, 0.5), { animate: true });
      return;
    }
    if (s.mode === 'pending' && performance.now() - s.t0 < LONG_PRESS) {
      const now2 = performance.now();
      if (now2 - s.lastTap.t < DOUBLE_TAP && Math.abs(e.clientX - s.lastTap.x) < 30) {
        s.lastTap.t = 0; setInspect(null);
        onView(zoomAt(viewRef.current, 0.5, (e.clientX - r.left) / r.width), { animate: true });
      } else {
        s.lastTap = { t: now2, x: e.clientX };
        const y = e.clientY - r.top, x = e.clientX - r.left;
        if (hasRail && onSelect && y > height - PAD_B - RAIL) {
          let best: Group | null = null;
          for (const gr of groupsRef.current) if (Math.abs(Math.min(width - 14, Math.max(14, gr.x)) - x) <= 22 && (!best || Math.abs(gr.x - x) < Math.abs(best.x - x))) best = gr;
          if (best) { setInspect(null); onSelect(best); }
          return void (s.pts.size === 0 && (s.mode = 'none'));
        }
        if (inspect) setInspect(null); else inspectAt(e.clientX);
      }
    } else if (s.mode === 'pan' && Math.abs(s.vel) > 0.25) {
      let vel = s.vel, last = performance.now();
      const step = () => {
        const t = performance.now(), dt = t - last; last = t;
        vel *= Math.pow(0.994, dt);
        const v = viewRef.current;
        onView({ span: v.span, end: limitEnd(v.end - ((vel * dt) / r.width) * v.span, now, v.span) });
        if (Math.abs(vel) > 0.02) g.current.fling = requestAnimationFrame(step);
      };
      s.fling = requestAnimationFrame(step);
    }
    if (s.pts.size === 0) s.mode = 'none';
  };
  const onWheel = (e: React.WheelEvent) => {
    if (!e.ctrlKey && Math.abs(e.deltaX) > Math.abs(e.deltaY)) {
      const v = viewRef.current; onView({ span: v.span, end: limitEnd(v.end + (e.deltaX / width) * v.span, now, v.span) }); return;
    }
    const r = rect();
    onView(zoomAt(viewRef.current, Math.exp(e.deltaY * 0.002), (e.clientX - r.left) / r.width));
  };
  useEffect(() => () => { window.clearTimeout(g.current.timer); stopFling(); }, []);

  // ── inspector card ──
  const i = inspect?.i ?? null;
  const d15 = i !== null ? delta15(series, i) : null;
  const rate = i !== null ? rateAt(series, i) : null;
  const sign = (n: number, digits: number) => `${n > 0 ? '+' : n < 0 ? '−' : ''}${Math.abs(n).toFixed(digits)}`;
  const fmtDelta = (mg: number) => unit === 'mmol' ? sign(mg / 18.016, 1) : sign(mg, 0);
  const fmtRate = (mg: number) => unit === 'mmol' ? sign(mg / 18.016, 2) : sign(mg, 1);
  const left = inspect ? Math.min(Math.max(8, (i !== null ? ((series.t[i] - (view.end - view.span)) / view.span) * width : inspect.x) - 80), width - 168) : 0;
  const lastT = series.t.length ? series.t[series.t.length - 1] : null;

  return (
    <div ref={wrap} className="relative select-none" style={{ height }} dir="ltr">
      <canvas
        ref={canvas} style={{ width: '100%', height, touchAction: 'pan-y' }}
        onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}
        role="img" aria-label={`رسم السكر ${clock(view.end - view.span)}–${clock(view.end)}، ${freshness(lastT, now) === 'live' ? 'مباشر' : 'غير محدّث'}`}
      />
      {inspect && (
        <div className="pointer-events-none absolute top-1 w-40 rounded-xl bg-white/95 p-2 text-xs shadow-card ring-1 ring-slate-200" style={{ left }} dir="rtl">
          <div className="num font-bold text-slate-500">{clock(i !== null ? series.t[i] : inspect.t)}</div>
          {i !== null ? (
            <>
              <div><span className="num text-lg font-bold">{formatGlucose(series.v[i], unit)}</span> <span className="text-slate-500">{unit === 'mmol' ? 'mmol/L' : 'mg/dL'}</span></div>
              <div className="flex justify-between"><span className="text-slate-500">خلال 15 د</span><b className="num" dir="ltr">{d15 !== null ? fmtDelta(d15) : '—'}</b></div>
              <div className="flex justify-between"><span className="text-slate-500">لكل دقيقة</span><b className="num" dir="ltr">{rate !== null ? fmtRate(rate) : '—'}</b></div>
            </>
          ) : <div className="text-slate-500">لا توجد قراءة هنا</div>}
        </div>
      )}
    </div>
  );
}

