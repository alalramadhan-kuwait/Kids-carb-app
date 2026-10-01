import { useEffect, useMemo, useRef, useState } from 'react';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { glucoseStats, type GlucoseStats } from '../lib/api';
import { effectiveRange, formatGlucose, unitLabel } from '../lib/glucose';
import { describeEvent } from '../lib/events';
import { fmt } from '../lib/carbs';
import { Icon } from '../components/Icon';
import { EventSheet } from '../components/EventSheet';
import { Card, cx } from '../components/ui';
import { Timeline } from '../engine/Timeline';
import { useLandscape } from '../hooks/useLandscape';
import { useSeries } from '../engine/useSeries';
import { buildMarks, defaultLayers, type Group, type Mark, type MarkKind } from '../engine/events';
import { dayStartOf, dayTitle, dayTotals, lowEpisodes, type Episode } from '../engine/day';
import type { View } from '../engine/series';
import type { IconName } from '../icons/defs';

const H = 3600000, DAY = 24 * H, KW = 3 * H;
const clock = (t: number) => { const d = new Date(t + KW); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
const ICON: Record<MarkKind, IconName> = { meal: 'meals', carbs: 'carbs', insulin: 'insulin', basal: 'insulin', treatment: 'treatment', exercise: 'activity', note: 'note', sleep: 'moon' };
type Row = { t: number; key: string; mark?: Mark; low?: Episode };

/** اليوم: what happened on one day — four numbers, the 24-hour graph, and the day's entries linked both ways. */
export function DayView() {
  const { settings, history, events } = useData();
  const { g } = useGlucose();
  const land = useLandscape();
  const unit = settings.glucose_unit;
  const today = dayStartOf(Date.now());
  const [day, setDay] = useState(today);
  const [view, setView] = useState<View>({ end: today + DAY, span: DAY });
  const [focus, setFocus] = useState<number | null>(null);
  const [picked, setPicked] = useState<Group | null>(null);
  const [more, setMore] = useState(false);
  const [stats, setStats] = useState<GlucoseStats | null>(null);
  const anim = useRef(0);
  const viewRef = useRef(view); viewRef.current = view;
  const graphRef = useRef<HTMLDivElement>(null);
  const height = useMemo(() => Math.round(Math.min(440, Math.max(250, window.innerHeight * 0.4))), []);
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);

  useEffect(() => { setView({ end: day + DAY, span: DAY }); setFocus(null); }, [day]);
  useEffect(() => {
    setStats(null);
    glucoseStats(new Date(day), new Date(Math.min(day + DAY, Date.now())), settings.glucose_low_mgdl, settings.glucose_high_mgdl).then(setStats).catch(() => setStats(null));
  }, [day, g?.latest?.taken_at, settings.glucose_low_mgdl, settings.glucose_high_mgdl]);

  // the view stays inside the chosen day
  const clamp = (v: View): View => { const span = Math.min(DAY, Math.max(30 * 60000, v.span)); return { span, end: Math.min(day + DAY, Math.max(day + span, v.end)) }; };
  const animateTo = (target: View) => {
    cancelAnimationFrame(anim.current);
    const from = viewRef.current, t0 = performance.now();
    if (matchMedia('(prefers-reduced-motion: reduce)').matches) return setView(target);
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 240), e = 1 - Math.pow(1 - k, 3);
      setView({ span: from.span + (target.span - from.span) * e, end: from.end + (target.end - from.end) * e });
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  };
  const onView = (v: View, o?: { animate?: boolean }) => (o?.animate ? animateTo(clamp(v)) : setView(clamp(v)));
  const goTo = (t: number) => {
    setFocus(t);
    animateTo(clamp({ span: 3 * H, end: t + 1.5 * H }));
    graphRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
  };

  const { series } = useSeries(view.end - view.span, view.end, day === today ? g?.readings : undefined);
  const marks = useMemo(() => buildMarks(history, events), [history, events]);
  const totals = useMemo(() => dayTotals(history, events, day, day + DAY), [history, events, day]);
  const rows: Row[] = useMemo(() => {
    const r: Row[] = marks.filter((m) => m.t >= day && m.t < day + DAY).map((m) => ({ t: m.t, key: m.key, mark: m }));
    for (const e of lowEpisodes(series, day, day + DAY, rng.low ?? 70)) r.push({ t: e.t, key: 'low' + e.t, low: e });
    return r.sort((a, b) => a.t - b.t);
  }, [marks, series, day, rng.low]);

  const pct = (v: number | null | undefined) => (v === null || v === undefined ? '—' : `${Math.round(v)}%`);
  const low = stats ? stats.pct_vlow + stats.pct_low : null, high = stats ? stats.pct_high + stats.pct_vhigh : null;
  const cv = stats?.mean && stats.sd !== null ? (stats.sd / stats.mean) * 100 : null;
  const zoomed = view.span < DAY - 60000;

  if (land.landscape) return (
    <div className="fixed inset-0 z-[46] flex flex-col bg-[rgb(var(--bg))] pe-[env(safe-area-inset-right)] ps-[env(safe-area-inset-left)]">
      <div className="flex h-12 items-center gap-3 px-3">
        <span className="font-bold">{dayTitle(day)}</span>
        <span className="text-sm text-slate-500">ضمن النطاق <b className="num text-ok">{pct(stats?.pct_in)}</b></span>
        {zoomed && <button onClick={() => { setFocus(null); animateTo({ end: day + DAY, span: DAY }); }} className="ms-auto min-h-[36px] rounded-full bg-brand-soft px-3 text-sm font-bold text-brand">اليوم كاملًا</button>}
      </div>
      <div className="flex-1 bg-white">
        <Timeline series={series} view={view} now={Date.now()} onView={onView} unit={unit} height={Math.max(160, land.height - 48)} range={rng}
          marks={marks} layers={defaultLayers()} onSelect={setPicked} dayParts highlight={focus} />
      </div>
      <EventSheet group={picked} series={series} onClose={() => setPicked(null)} />
    </div>
  );

  return (
    <div className="space-y-3 pb-4">
      {/* day picker: previous (→) · title, tap for a date · next (←) */}
      <div className="flex items-center gap-2">
        <button aria-label="اليوم السابق" onClick={() => setDay(day - DAY)} className="grid h-11 w-11 place-items-center rounded-full bg-white text-xl shadow-sm">→</button>
        <label className="relative flex-1 text-center font-bold">
          {dayTitle(day)}
          <input type="date" aria-label="اختر يومًا" className="absolute inset-0 opacity-0" max={new Date(today + KW).toISOString().slice(0, 10)}
            value={new Date(day + KW).toISOString().slice(0, 10)} onChange={(e) => e.target.value && setDay(Date.parse(e.target.value + 'T00:00:00Z') - KW)} />
        </label>
        <button aria-label="اليوم التالي" disabled={day >= today} onClick={() => setDay(day + DAY)} className="grid h-11 w-11 place-items-center rounded-full bg-white text-xl shadow-sm disabled:opacity-30">←</button>
      </div>

      <div className="grid grid-cols-4 gap-2">
        <Kpi label="المتوسط" value={stats?.mean != null ? formatGlucose(stats.mean, unit) : '—'} />
        <Kpi label="ضمن النطاق" value={pct(stats?.pct_in)} tone="ok" />
        <Kpi label="منخفض" value={pct(low)} tone="over" />
        <Kpi label="مرتفع" value={pct(high)} tone="near" />
      </div>
      {stats && stats.n > 0 && stats.coverage < 70 && <p className="px-1 text-xs text-near">البيانات تغطي <span className="num">{Math.round(stats.coverage)}%</span> من اليوم فقط.</p>}

      <div ref={graphRef} className="relative -mx-4 bg-white py-2 shadow-card">
        <Timeline series={series} view={view} now={Date.now()} onView={onView} unit={unit} height={height} range={rng}
          marks={marks} layers={defaultLayers()} onSelect={setPicked} dayParts highlight={focus} />
        {zoomed && (
          <button onClick={() => { setFocus(null); animateTo({ end: day + DAY, span: DAY }); }}
            className="absolute end-3 top-3 min-h-[36px] rounded-full bg-brand-soft px-3 text-sm font-bold text-brand">اليوم كاملًا</button>
        )}
      </div>

      <button onClick={() => setMore(!more)} aria-expanded={more} className="flex min-h-[44px] w-full items-center justify-between px-1 text-sm font-medium text-brand">
        <span>أرقام أكثر</span><span>{more ? '−' : '+'}</span>
      </button>
      {more && (
        <Card className="grid grid-cols-3 gap-x-3 gap-y-2 !py-3 text-sm">
          <Small label="الانحراف" value={stats?.sd != null ? formatGlucose(stats.sd, unit) : '—'} />
          <Small label="التذبذب CV" value={cv !== null ? `${cv.toFixed(0)}%` : '—'} />
          <Small label="التغطية" value={pct(stats?.coverage)} />
          <Small label="أقل قراءة" value={stats?.min != null ? formatGlucose(stats.min, unit) : '—'} />
          <Small label="أعلى قراءة" value={stats?.max != null ? formatGlucose(stats.max, unit) : '—'} />
          <Small label="الكارب" value={`${fmt(totals.carbs)} غ`} />
          <Small label="علاج انخفاض" value={totals.treatment ? `${fmt(totals.treatment)} غ` : '—'} />
          <Small label="إنسولين سريع" value={totals.rapid ? `${fmt(totals.rapid)} و` : '—'} />
          <Small label="إنسولين طويل" value={totals.long ? `${fmt(totals.long)} و` : '—'} />
          <p className="col-span-3 text-[11px] text-slate-400">القيم بـ{unitLabel(unit)}. النسب بالنطاقات الدولية للتقارير.</p>
        </Card>
      )}

      <h2 className="px-1 pt-1 font-bold">تسجيلات اليوم</h2>
      {rows.length === 0 ? <Card><p className="text-sm text-slate-500">لا توجد تسجيلات في هذا اليوم.</p></Card> : (
        <Card className="!p-0 overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {rows.map((r) => (
              <li key={r.key}>
                <button onClick={() => goTo(r.t)} className={cx('flex min-h-[52px] w-full items-center gap-3 px-4 py-2 text-start active:bg-slate-50', focus === r.t && 'bg-brand-soft/60')}>
                  <span className="num w-12 shrink-0 text-sm text-slate-500">{clock(r.t)}</span>
                  {r.low ? (
                    <>
                      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-over-soft text-over"><Icon name="glucose" size={17} /></span>
                      <span className="min-w-0 flex-1 truncate font-medium text-over">منخفض <span className="num">{formatGlucose(r.low.nadir, unit)}</span><span className="text-sm font-normal text-slate-500"> · {r.low.minutes} د</span></span>
                    </>
                  ) : (
                    <>
                      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full', r.mark!.kind === 'treatment' ? 'bg-over-soft text-over' : 'bg-brand-muted/70 text-brand')}><Icon name={ICON[r.mark!.kind]} size={17} /></span>
                      <span className="min-w-0 flex-1 truncate font-medium">{r.mark!.meal ? `${r.mark!.meal.name} · ${fmt(r.mark!.meal.total_carbs)} غ` : r.mark!.event!.kind === 'note' ? r.mark!.event!.note : describeEvent(r.mark!.event!)}</span>
                    </>
                  )}
                  <span className="text-slate-400">‹</span>
                </button>
              </li>
            ))}
          </ul>
        </Card>
      )}
      <EventSheet group={picked} series={series} onClose={() => setPicked(null)} />
    </div>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone?: 'ok' | 'over' | 'near' }) {
  return (
    <div className="rounded-2xl border border-slate-100 bg-white px-1 py-2.5 text-center">
      <div className={cx('num text-xl font-bold', tone === 'ok' ? 'text-ok' : tone === 'over' ? 'text-over' : tone === 'near' ? 'text-near' : 'text-brand-num')}>{value}</div>
      <div className="mt-0.5 text-[11px] text-slate-500">{label}</div>
    </div>
  );
}
const Small = ({ label, value }: { label: string; value: string }) => (
  <div><div className="text-[11px] text-slate-500">{label}</div><div className="num font-bold" dir="auto">{value}</div></div>
);
