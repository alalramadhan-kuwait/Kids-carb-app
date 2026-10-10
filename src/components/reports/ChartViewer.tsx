// Full-screen, interactive viewer for the doctor-report glucose charts (AGP, daily profiles, Weekly Summary days).
// It only DISPLAYS what the report already holds: the report model (engine/report) and the stored readings of the
// period. Nothing is recalculated here except picking the nearest stored reading under the finger; no reading is
// changed, invented or filled in (lines break where readings are more than 16 minutes apart, the report's gap rule).
//
// Gestures: one finger (or mouse) drags across the chart to read exact values; two fingers pinch to zoom and move to
// pan; the navigator strip at the bottom pans with one finger; +/− and "Whole day" buttons; mouse wheel zooms.
// The viewer is an overlay: closing it leaves the report exactly where it was (same page, same scroll).
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import type { AgpReport } from '../../engine/report/agpReport';
import type { WeeklyDay } from '../../engine/report/weekly';
import type { GlucoseEvent } from '../../engine/report/events';
import type { Reading } from '../../engine/report/cgm';
import { fmt1 } from '../../engine/report/agpReport';
import { RANGE_COLOR } from './charts';

const MIN = 60000, DAY_MIN = 1440, MIN_SPAN = 30, JOIN_MS = 16 * MIN;
const BAND95 = '#cfe0f1', BAND50 = '#8fb8e0', MEDIAN = '#1f5f91', TARGET = '#e6f2ea', TARGET_LINE = '#3a8a5c';
const CARB = '#c26a12', TREAT = '#c0392b', RAPID = '#1f6fa8', LONG = '#6b4fa0';
const mm = (mg: number) => mg / 18.016;
const MUTED = '#64748b', BTN = { background: '#f1f5f9', color: '#0f172a' };
const tick = (min: number) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); return `${h % 12 || 12}${m ? `:${String(m).padStart(2, '0')}` : ''}${h < 12 ? 'am' : 'pm'}`; };
const clock = (min: number) => { const h = Math.floor(min / 60) % 24, m = Math.round(min % 60); return `${h % 12 || 12}:${String(m).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`; };

export type ViewerContent =
  | { kind: 'agp'; report: AgpReport }
  | { kind: 'day'; days: WeeklyDay[]; index: number; readings: Reading[]; lows: GlucoseEvent[] };

/** Opens a viewer over the current report; returns the element to render and an opener. */
export function useChartViewer() {
  const [content, setContent] = useState<ViewerContent | null>(null);
  const open = useCallback((c: ViewerContent) => setContent(c), []);
  const close = useCallback(() => setContent(null), []);
  return { open, viewer: content ? <ChartViewer content={content} onClose={close} /> : null };
}

/** A chart that opens full-screen when tapped (keyboard: Enter). */
export function Expandable({ onOpen, label, children }: { onOpen: () => void; label: string; children: ReactNode }) {
  return (
    <div role="button" tabIndex={0} aria-label={`${label}: open full screen`} onClick={onOpen} onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); onOpen(); } }}
      className="relative cursor-zoom-in rounded-xl focus-visible:outline focus-visible:outline-2 focus-visible:outline-brand">
      {children}
      <span className="pointer-events-none absolute right-1.5 top-1.5 rounded-md px-1.5 py-0.5 text-[10px] font-semibold shadow-sm" style={{ background: "rgba(255,255,255,.92)", color: "#475569" }}>⤢ Expand</span>
    </div>
  );
}

function ChartViewer({ content, onClose }: { content: ViewerContent; onClose: () => void }) {
  const [idx, setIdx] = useState(content.kind === 'day' ? content.index : 0);
  const [view, setView] = useState({ a: 0, b: DAY_MIN });          // visible minutes of the day
  const [cursor, setCursor] = useState<number | null>(null);     // minute under the finger
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 360, h: 300 });
  const day = content.kind === 'day' ? content.days[idx] : null;

  // keep the page under it exactly as it was; the phone's back button closes the viewer, not the report
  const closeRef = useRef(onClose); closeRef.current = onClose;
  useEffect(() => {
    const y = window.scrollY, prev = document.body.style.overflow, prevRestore = history.scrollRestoration;
    history.scrollRestoration = 'manual';                                        // the browser must not move the report on back
    document.body.style.overflow = 'hidden';
    history.pushState({ chartViewer: true }, '');
    const onPop = () => closeRef.current();
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') history.back(); };
    window.addEventListener('popstate', onPop); window.addEventListener('keydown', onKey);
    const el = document.documentElement as HTMLElement & { requestFullscreen?: () => Promise<void> };
    el.requestFullscreen?.().then(() => (screen.orientation as ScreenOrientation & { lock?: (o: string) => Promise<void> })?.lock?.('landscape')).catch(() => { /* not available: the layout adapts */ });
    return () => {
      window.removeEventListener('popstate', onPop); window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
      const restore = () => window.scrollTo(0, y);
      // leaving full screen and rotating back re-lay the page out, so put the scroll back after each step settles
      const left = document.fullscreenElement ? document.exitFullscreen?.().catch(() => {}) : undefined;
      restore(); requestAnimationFrame(restore);
      Promise.resolve(left).then(() => { restore(); requestAnimationFrame(restore); setTimeout(restore, 120); setTimeout(() => { restore(); history.scrollRestoration = prevRestore; }, 400); });
    };
  }, []);
  const close = () => history.back();

  useEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: Math.max(240, e.contentRect.width), h: Math.max(180, e.contentRect.height) }));
    ro.observe(el); return () => ro.disconnect();
  }, []);
  useEffect(() => { setCursor(null); }, [idx]);
  useEffect(() => {
    if (content.kind !== 'day') return;
    const onKey = (e: KeyboardEvent) => { if (e.key === 'ArrowLeft') setIdx((i) => Math.max(0, i - 1)); if (e.key === 'ArrowRight') setIdx((i) => Math.min(content.days.length - 1, i + 1)); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [content]);

  // ── scales ──
  const NAV = 34, padL = 34, padR = 10, padT = 26, padB = 22;
  const W = size.w, H = size.h - NAV - 8, plotW = W - padL - padR, plotH = H - padT - padB;
  const X = (min: number) => padL + ((min - view.a) / (view.b - view.a)) * plotW;
  const Y = (v: number) => padT + (1 - Math.min(Math.max(v, 0), 22) / 22) * plotH;
  const inv = (px: number) => view.a + ((px - padL) / plotW) * (view.b - view.a);
  const clampView = (a: number, span: number) => { const s = Math.min(DAY_MIN, Math.max(MIN_SPAN, span)); const a2 = Math.min(Math.max(0, a), DAY_MIN - s); return { a: a2, b: a2 + s }; };
  const zoom = (k: number, around = (view.a + view.b) / 2) => setView((v) => { const span = (v.b - v.a) * k; return clampView(around - (around - v.a) * k, span); });

  // ── pointers: 1 = read values, 2 = pinch/pan ──
  const pts = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ d: number; cx: number; view: { a: number; b: number } } | null>(null);
  const svgX = (e: React.PointerEvent | React.WheelEvent) => { const r = (e.currentTarget as SVGSVGElement).getBoundingClientRect(); return ((e.clientX - r.left) / r.width) * W; };
  const onDown = (e: React.PointerEvent<SVGSVGElement>) => {
    try { (e.currentTarget as SVGSVGElement).setPointerCapture(e.pointerId); } catch { /* capture is a nicety */ }
    pts.current.set(e.pointerId, { x: svgX(e), y: e.clientY });
    if (pts.current.size === 2) { const [p, q] = [...pts.current.values()]; pinch.current = { d: Math.abs(p.x - q.x) || 1, cx: (p.x + q.x) / 2, view }; setCursor(null); }
    else setCursor(Math.min(DAY_MIN, Math.max(0, inv(svgX(e)))));
  };
  const onMove = (e: React.PointerEvent<SVGSVGElement>) => {
    if (!pts.current.has(e.pointerId)) { if (e.pointerType === 'mouse') setCursor(Math.min(DAY_MIN, Math.max(0, inv(svgX(e))))); return; }
    pts.current.set(e.pointerId, { x: svgX(e), y: e.clientY });
    if (pts.current.size >= 2 && pinch.current) {
      const [p, q] = [...pts.current.values()], d = Math.abs(p.x - q.x) || 1, cx = (p.x + q.x) / 2, v0 = pinch.current.view;
      const span = (v0.b - v0.a) * (pinch.current.d / d);
      const m0 = v0.a + ((pinch.current.cx - padL) / plotW) * (v0.b - v0.a);     // minute that was under the fingers
      setView(clampView(m0 - ((cx - padL) / plotW) * Math.min(DAY_MIN, Math.max(MIN_SPAN, span)), span));
    } else setCursor(Math.min(DAY_MIN, Math.max(0, inv(svgX(e)))));
  };
  const onUp = (e: React.PointerEvent<SVGSVGElement>) => { pts.current.delete(e.pointerId); if (pts.current.size < 2) pinch.current = null; };
  const onWheel = (e: React.WheelEvent<SVGSVGElement>) => { zoom(e.deltaY > 0 ? 1.25 : 0.8, inv(svgX(e))); };

  // ── what is drawn ──
  const dayStart = day?.start ?? 0;
  const dayReadings = useMemo(() => (content.kind === 'day' && day ? content.readings.filter((r) => r.t >= day.start && r.t < day.start + DAY_MIN * MIN) : []), [content, day]);
  const lines = useMemo(() => {
    const out: string[] = []; let cur = '', prev = -Infinity;
    for (const r of dayReadings) { const m = (r.t - dayStart) / MIN; const p = `${X(m).toFixed(1)},${Y(mm(r.mg)).toFixed(1)}`; cur = r.t - prev > JOIN_MS || !cur ? (cur && out.push(cur), `M${p}`) : `${cur}L${p}`; prev = r.t; }
    if (cur) out.push(cur);
    return out;
  }, [dayReadings, dayStart, view, size]); // eslint-disable-line react-hooks/exhaustive-deps

  const span = view.b - view.a;
  const step = [15, 30, 60, 120, 180, 240, 360].find((m) => (m / span) * plotW >= 64) ?? 360;
  const ticks: number[] = []; for (let t = Math.ceil(view.a / step) * step; t <= view.b; t += step) ticks.push(t);

  // ── the readout under the finger ──
  let readout: ReactNode = <span style={{ color: MUTED }}>Drag across the chart to read values · pinch to zoom</span>;
  if (cursor !== null && content.kind === 'agp') {
    const p = content.report.agp.reduce<AgpReport['agp'][number] | null>((b, q) => (!b || Math.abs(q.minute - cursor) < Math.abs(b.minute - cursor) ? q : b), null);
    readout = p && Math.abs(p.minute - cursor) <= 5
      ? <span><b>{clock(p.minute)}</b> · median <b className="num">{fmt1(p.p50)}</b> · 25–75%: <span className="num">{fmt1(p.p25)}–{fmt1(p.p75)}</span> · 5–95%: <span className="num">{fmt1(p.p5)}–{fmt1(p.p95)}</span> mmol/L · {p.days} days{p.thin ? ' (few days)' : ''}</span>
      : <span><b>{clock(cursor)}</b> · no data at this time of day</span>;
  } else if (cursor !== null && day) {
    const t = dayStart + cursor * MIN;
    let near: Reading | null = null; for (const r of dayReadings) if (!near || Math.abs(r.t - t) < Math.abs(near.t - t)) near = r;
    const ok = near && Math.abs(near.t - t) <= 8 * MIN;
    const within = (m: number) => Math.abs(m - cursor) <= 10;
    const ev: string[] = [
      ...day.carbs.filter((c) => within(c.minute)).map((c) => `${clock(c.minute)} ate ${c.grams === null ? 'carbs unknown' : `${Math.round(c.grams)} g carbs`}${c.meals > 1 ? ` (${c.meals} entries)` : ''}`),
      ...day.treatments.filter((x) => within(x.minute)).map((x) => `${clock(x.minute)} low treatment${x.grams === null ? '' : ` ${Math.round(x.grams)} g`}`),
      ...day.insulin.filter((u) => within(u.minute)).map((u) => `${clock(u.minute)} ${u.type === 'long' ? 'long-acting' : 'rapid'} ${u.units} U given`),
      ...day.fingerPricks.filter((f) => within(f.minute)).map((f) => `${clock(f.minute)} finger-prick ${fmt1(f.mmol)}`),
    ];
    const low = content.kind === 'day' ? content.lows.find((e) => e.start <= t && t <= e.end) : undefined;
    readout = (
      <span>
        {ok ? <><b>{new Date(near!.t + 3 * 3600000).toISOString().slice(11, 16)}</b> · sensor <b className="num">{fmt1(mm(near!.mg))}</b> mmol/L <span style={{ color: MUTED }}>({near!.mg} mg/dL)</span></> : <><b>{clock(cursor)}</b> · no sensor reading here (gap, not filled in)</>}
        {low && <span className="block" style={{ color: '#b91c1c' }}>In a low event {clock((low.start - dayStart) / MIN)}–{clock((low.end - dayStart) / MIN)}, lowest {fmt1(mm(low.extreme))}</span>}
        {ev.map((s) => <span key={s} className="block" style={{ color: '#334155' }}>{s}</span>)}
      </span>
    );
  }

  const title = content.kind === 'agp' ? 'Daily pattern (AGP)' : `${day!.weekday} ${day!.date}`;
  const subtitle = content.kind === 'agp' ? `${content.report.label} · all days over 24 hours` : day!.row.cgm.pctActive === 0 ? 'No sensor data for this day' : `Sensor data ${Math.round(day!.row.cgm.pctActive)}% · average ${day!.avgMmol === null ? '–' : fmt1(day!.avgMmol)} mmol/L`;

  return (
    <div dir="ltr" lang="en" role="dialog" aria-modal="true" aria-label={`${title}, full screen`}
      className="fixed inset-0 z-[70] flex flex-col" style={{ background: '#ffffff', color: '#0f172a', textAlign: 'left', paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)', paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)' }}>
      <header className="flex items-center gap-2 px-3 py-2" style={{ borderBottom: '1px solid #e2e8f0' }}>
        {content.kind === 'day' && <button aria-label="Previous day" disabled={idx === 0} onClick={() => setIdx(idx - 1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl disabled:opacity-30" style={BTN}>‹</button>}
        <div className="min-w-0 flex-1"><div className="truncate font-bold" style={{ textAlign: 'left' }}>{title}</div><div className="truncate text-xs" style={{ textAlign: 'left', color: MUTED }}>{subtitle}</div></div>
        {content.kind === 'day' && <button aria-label="Next day" disabled={idx === content.days.length - 1} onClick={() => setIdx(idx + 1)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-xl disabled:opacity-30" style={BTN}>›</button>}
        <button onClick={close} className="ms-1 min-h-[44px] shrink-0 rounded-full px-4 font-bold" style={{ background: '#0f172a', color: '#ffffff' }}>✕ Close</button>
      </header>
      <div className="flex items-start gap-2 px-3 py-1.5" style={{ borderBottom: '1px solid #f1f5f9' }}>
        <div className="min-h-[44px] min-w-0 flex-1 text-sm leading-snug" aria-live="polite">{readout}</div>
        <div className="flex shrink-0 gap-1">
          <button aria-label="Zoom out" onClick={() => zoom(1.5)} className="grid h-10 w-10 place-items-center rounded-full text-xl font-bold" style={BTN}>−</button>
          <button aria-label="Zoom in" onClick={() => zoom(1 / 1.5)} className="grid h-10 w-10 place-items-center rounded-full text-xl font-bold" style={BTN}>+</button>
          <button onClick={() => setView({ a: 0, b: DAY_MIN })} disabled={span >= DAY_MIN} className="h-10 rounded-full px-3 text-xs font-bold disabled:opacity-40" style={BTN}>Whole day</button>
        </div>
      </div>
      <div ref={box} className="relative min-h-0 flex-1">
        <svg width={W} height={size.h} viewBox={`0 0 ${W} ${size.h}`} className="block touch-none select-none" onPointerDown={onDown} onPointerMove={onMove} onPointerUp={onUp} onPointerCancel={onUp} onWheel={onWheel}>
          <defs><clipPath id="plot"><rect x={padL} y={padT} width={plotW} height={plotH} /></clipPath></defs>
          <rect x={0} y={0} width={W} height={size.h} fill="#ffffff" />
          {content.kind === 'day' && day!.row.cgm.pctActive === 0
            ? <><rect x={padL} y={padT} width={plotW} height={plotH} fill="#eef1f4" /><text x={padL + plotW / 2} y={padT + plotH / 2} textAnchor="middle" fontSize={13} fill="#64748b">No sensor data for this day (not filled in)</text></>
            : <rect x={padL} y={Y(10)} width={plotW} height={Y(3.9) - Y(10)} fill={TARGET} />}
          {ticks.map((t) => <g key={t}><line x1={X(t)} x2={X(t)} y1={padT} y2={padT + plotH} stroke="#e2e8f0" /><text x={X(t)} y={padT + plotH + 15} fontSize={11} textAnchor={X(t) > W - padR - 20 ? 'end' : 'middle'} fill="#64748b">{tick(t)}</text></g>)}
          {[0, 3.9, 10, 13.9, 22].map((v) => <text key={v} x={padL - 5} y={Y(v) + 4} fontSize={11} textAnchor="end" fill={v === 3.9 || v === 10 ? TARGET_LINE : '#64748b'}>{v}</text>)}
          <text x={2} y={padT - 10} fontSize={10} fill="#64748b">mmol/L</text>
          <g clipPath="url(#plot)">
            {content.kind === 'agp' && <AgpLayers r={content.report} X={X} Y={Y} />}
            {[3.9, 10].map((v) => <line key={v} x1={padL} x2={padL + plotW} y1={Y(v)} y2={Y(v)} stroke={TARGET_LINE} strokeDasharray="4 3" />)}
            {content.kind === 'day' && <>
              {content.lows.filter((e) => e.start < dayStart + DAY_MIN * MIN && e.end > dayStart).map((e, i) => <rect key={i} x={X((e.start - dayStart) / MIN)} y={padT} width={Math.max(1, X((e.end - dayStart) / MIN) - X((e.start - dayStart) / MIN))} height={plotH} fill={RANGE_COLOR.low} opacity={0.08} />)}
              {lines.map((d, i) => <path key={i} d={d} fill="none" stroke={MEDIAN} strokeWidth={2} />)}
              {day!.fingerPricks.map((f, i) => <rect key={i} x={X(f.minute) - 4} y={Y(f.mmol) - 4} width={8} height={8} transform={`rotate(45 ${X(f.minute)} ${Y(f.mmol)})`} fill="#15212b" />)}
              {day!.insulin.map((u, i) => <g key={`u${i}`}>{u.type === 'long' ? <rect x={X(u.minute) - 4} y={padT + plotH - 10} width={8} height={8} fill={LONG} /> : <path d={`M${X(u.minute) - 5},${padT + plotH - 10}h10l-5,8z`} fill={RAPID} />}{span <= 720 && <text x={X(u.minute) + 6} y={padT + plotH - 3} fontSize={11} fill={u.type === 'long' ? LONG : RAPID}>{u.units}U</text>}</g>)}
            </>}
          </g>
          {/* food and low treatments sit above the plot, outside the clip; only those in view */}
          {content.kind === 'day' && <>
            {day!.carbs.filter((c) => c.minute >= view.a && c.minute <= view.b).map((c, i) => <g key={`c${i}`}><circle cx={X(c.minute)} cy={padT - 14} r={4} fill={CARB} />{span <= 720 && <text x={X(c.minute) + 6} y={padT - 10} fontSize={11} fill={CARB}>{c.grams === null ? '?' : `${Math.round(c.grams)}g`}</text>}</g>)}
            {day!.treatments.filter((x) => x.minute >= view.a && x.minute <= view.b).map((x, i) => <g key={`t${i}`}><circle cx={X(x.minute)} cy={padT - 14} r={4} fill={TREAT} />{span <= 720 && x.grams !== null && <text x={X(x.minute) + 6} y={padT - 2} fontSize={10} fill={TREAT}>{Math.round(x.grams)}g</text>}</g>)}
          </>}
          {cursor !== null && cursor >= view.a && cursor <= view.b && <line x1={X(cursor)} x2={X(cursor)} y1={padT - 20} y2={padT + plotH} stroke="#0f172a" strokeWidth={1} />}
          {/* navigator: the whole day, the visible part highlighted; drag it to pan */}
          <Navigator y={H + 4} w={W} padL={padL} padR={padR} h={NAV - 6} view={view} setView={(a) => setView(clampView(a, span))} />
        </svg>
      </div>
    </div>
  );
}

function AgpLayers({ r, X, Y }: { r: AgpReport; X: (m: number) => number; Y: (v: number) => number }) {
  const runs: AgpReport['agp'][] = [];
  for (const p of r.agp) { const last = runs[runs.length - 1]; if (last && p.minute - last[last.length - 1].minute <= 5) last.push(p); else runs.push([p]); }
  const area = (run: AgpReport['agp'], lo: 'p5' | 'p25', hi: 'p95' | 'p75') => `M${run.map((p) => `${X(p.minute)},${Y(p[hi])}`).join('L')}L${run.slice().reverse().map((p) => `${X(p.minute)},${Y(p[lo])}`).join('L')}Z`;
  return <>
    {runs.map((run, i) => run.length > 1 && <path key={`a${i}`} d={area(run, 'p5', 'p95')} fill={BAND95} />)}
    {runs.map((run, i) => run.length > 1 && <path key={`b${i}`} d={area(run, 'p25', 'p75')} fill={BAND50} />)}
    {runs.map((run, i) => <path key={`m${i}`} d={`M${run.map((p) => `${X(p.minute)},${Y(p.p50)}`).join('L')}`} fill="none" stroke={MEDIAN} strokeWidth={2.4} />)}
  </>;
}

function Navigator({ y, w, padL, padR, h, view, setView }: { y: number; w: number; padL: number; padR: number; h: number; view: { a: number; b: number }; setView: (a: number) => void }) {
  const pw = w - padL - padR, x = (m: number) => padL + (m / DAY_MIN) * pw;
  const drag = useRef<{ x0: number; a0: number } | null>(null);
  return (
    <g onPointerDown={(e) => { e.stopPropagation(); try { (e.currentTarget as SVGGElement).setPointerCapture(e.pointerId); } catch { /* fine */ } drag.current = { x0: e.clientX, a0: view.a }; }}
      onPointerMove={(e) => { if (!drag.current) return; e.stopPropagation(); const r = (e.currentTarget.ownerSVGElement as SVGSVGElement).getBoundingClientRect(); setView(drag.current.a0 + ((e.clientX - drag.current.x0) / r.width) * w / pw * DAY_MIN); }}
      onPointerUp={() => { drag.current = null; }} onPointerCancel={() => { drag.current = null; }} style={{ cursor: 'grab' }}>
      <rect x={padL} y={y} width={pw} height={h} rx={6} fill="#f1f5f9" />
      <rect x={x(view.a)} y={y} width={Math.max(8, x(view.b) - x(view.a))} height={h} rx={6} fill="#cbd5e1" stroke="#64748b" />
      <text x={padL + pw / 2} y={y + h / 2 + 4} fontSize={10} textAnchor="middle" fill="#475569" pointerEvents="none">{view.b - view.a >= DAY_MIN ? 'Whole day shown · pinch or + to zoom' : 'Drag to move along the day'}</text>
    </g>
  );
}
