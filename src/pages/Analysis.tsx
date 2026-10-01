import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { effectiveRange, formatGlucose, glucoseStatus, unitLabel } from '../lib/glucose';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { Chip, Page, cx } from '../components/ui';
import { Timeline } from '../engine/Timeline';
import { useSeries } from '../engine/useSeries';
import { PERIODS, delta15, freshness, limitEnd, rateAt, type View } from '../engine/series';
import StatsPanel from './Advanced';
import { DayView } from './Day';
import { Patterns } from './Patterns';
import { EventSheet } from '../components/EventSheet';
import { Sheet, Toggle } from '../components/ui';
import { LAYERS, buildMarks, defaultLayers, type Group, type Layer } from '../engine/events';

const loadLayers = (): Set<Layer> => {
  try { const v = localStorage.getItem('layers'); if (v) return new Set(JSON.parse(v) as Layer[]); } catch { /* private mode */ }
  return defaultLayers();
};

const MODES = [{ id: 'live', label: 'مباشر' }, { id: 'day', label: 'اليوم' }, { id: 'patterns', label: 'الأنماط' }, { id: 'stats', label: 'الأرقام' }] as const;
const FRESH = { live: { text: 'مباشر', cls: 'bg-ok-soft text-ok' }, delayed: { text: 'متأخر', cls: 'bg-near-soft text-near' }, missing: { text: 'منقطع', cls: 'bg-over-soft text-over' } };

/** التحليل: Live (the timeline engine) and the numbers. More modes arrive stage by stage (GLUCOSE_PLAN 11.2). */
export default function Analysis() {
  const [params, setParams] = useSearchParams();
  const mode = (['day', 'patterns', 'stats'] as const).find((m) => m === params.get('mode')) ?? 'live';
  return (
    <Page title="التحليل">
      <div className="mb-3 grid grid-cols-4 gap-1 rounded-2xl bg-slate-100 p-1" role="tablist">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => setParams(m.id === 'live' ? {} : { mode: m.id }, { replace: true })}
            className={cx('min-h-[40px] rounded-xl text-sm font-bold', mode === m.id ? 'bg-white shadow-card' : 'text-slate-500')}>{m.label}</button>
        ))}
      </div>
      {mode === 'live' ? <Live /> : mode === 'day' ? <DayView /> : mode === 'patterns' ? <Patterns /> : <StatsPanel />}
    </Page>
  );
}

function Live() {
  const { settings, history, events } = useData();
  const { g } = useGlucose();
  const [layers, setLayers] = useState<Set<Layer>>(loadLayers);
  const [layersOpen, setLayersOpen] = useState(false);
  const [picked, setPicked] = useState<Group | null>(null);
  const marks = useMemo(() => buildMarks(history, events), [history, events]);
  const toggle = (id: Layer, on: boolean) => {
    const next = new Set(layers); if (on) next.add(id); else next.delete(id);
    setLayers(next); try { localStorage.setItem('layers', JSON.stringify([...next])); } catch { /* ignore */ }
  };
  const unit = settings.glucose_unit;
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState<View>(() => ({ span: PERIODS[0].ms, end: limitEnd(Infinity, Date.now(), PERIODS[0].ms) }));
  const [live, setLive] = useState(true);
  const anim = useRef(0);
  const viewRef = useRef(view); viewRef.current = view;
  const height = useMemo(() => Math.round(Math.min(520, Math.max(260, window.innerHeight * 0.5))), []);

  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(id); }, []);
  useEffect(() => { if (g?.latest) setNow(Date.now()); }, [g?.latest?.taken_at]);
  useEffect(() => { if (live) setView((v) => ({ span: v.span, end: limitEnd(Infinity, now, v.span) })); }, [now, live]);

  const onView = useCallback((v: View, o?: { animate?: boolean }) => {
    cancelAnimationFrame(anim.current);
    const t = Date.now();
    const isLive = v.end >= t + v.span * 0.02;
    setLive(isLive);
    const target = isLive ? { span: v.span, end: limitEnd(Infinity, t, v.span) } : v;
    if (!o?.animate || matchMedia('(prefers-reduced-motion: reduce)').matches) { setView(target); return; }
    const from = viewRef.current, t0 = performance.now();
    const step = () => {
      const k = Math.min(1, (performance.now() - t0) / 220), e = 1 - Math.pow(1 - k, 3);
      setView({ span: from.span + (target.span - from.span) * e, end: from.end + (target.end - from.end) * e });
      if (k < 1) anim.current = requestAnimationFrame(step);
    };
    anim.current = requestAnimationFrame(step);
  }, []);

  const { series, loading } = useSeries(view.end - view.span, view.end, g?.readings);
  const n = series.t.length;
  const lastT = n ? series.t[n - 1] : null;
  const fresh = freshness(lastT, now);
  const d15 = n ? delta15(series, n - 1) : null;
  const rate = n ? rateAt(series, n - 1) : null;
  const latest = g?.latest;
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const status = latest && fresh !== 'missing' ? glucoseStatus(latest.mg_dl, rng.low, rng.high) : null;
  const period = PERIODS.find((p) => Math.abs(p.ms - view.span) / p.ms < 0.03)?.id;

  return (
    <div className="space-y-3 pb-4">
      <div className="flex items-end gap-3 px-1">
        {latest && fresh !== 'missing' ? (
          <div className={cx(fresh === 'delayed' && 'opacity-60')}>
            <div className="flex items-center gap-2">
              <span className={cx('num text-5xl font-bold leading-none', status === 'low' || status === 'urgent_low' ? 'text-over' : status === 'high' || status === 'very_high' ? 'text-near' : '')}>{formatGlucose(latest.mg_dl, unit)}</span>
              {latest.trend && <span aria-label={TREND_WORDS[latest.trend]}><Icon name={TREND_ICON[latest.trend]} size={30} /></span>}
              <span className="text-sm text-slate-500">{unitLabel(unit)}</span>
            </div>
            <div className="mt-1 text-sm text-slate-600">{change(d15, rate, unit)}</div>
          </div>
        ) : <div className="text-lg font-bold text-slate-500">{g ? 'لا توجد قراءة حديثة' : '…'}</div>}
        <span className={cx('ms-auto mb-1 rounded-full px-2.5 py-1 text-xs font-bold', FRESH[fresh].cls)}>
          {FRESH[fresh].text}{lastT ? ` · ${Math.max(0, Math.round((now - lastT) / 60000))} د` : ''}
        </span>
      </div>

      <div className="relative -mx-4 bg-white py-2 shadow-card">
        <Timeline series={series} view={view} now={now} onView={onView} unit={unit} height={height}
          range={rng}
          marks={marks} layers={layers} onSelect={setPicked} />
        {loading && <div className="absolute start-3 top-3 text-xs text-slate-400">…</div>}
      </div>

      <div className="flex items-center gap-2">
        <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1" dir="ltr">
          {PERIODS.map((p) => <Chip key={p.id} active={period === p.id} onClick={() => onView({ span: p.ms, end: live ? Infinity : view.end }, { animate: true })}>{p.id}</Chip>)}
        </div>
        <button onClick={() => setLayersOpen(true)} className="min-h-[40px] shrink-0 rounded-full bg-white px-3 text-sm font-bold ring-1 ring-slate-200">الطبقات</button>
        {!live && <button onClick={() => onView({ span: view.span, end: Infinity }, { animate: true })} className="min-h-[40px] shrink-0 rounded-full bg-brand px-4 text-sm font-bold text-white">الآن</button>}
      </div>
      <p className="px-1 text-xs text-slate-400">اسحب للتنقل · اقرص للتكبير · اضغط مطوّلًا للتفاصيل · اضغط أيقونة لما سُجّل</p>
      <EventSheet group={picked} series={series} onClose={() => setPicked(null)} />
      <Sheet open={layersOpen} onClose={() => setLayersOpen(false)} title="الطبقات">
        <ul className="space-y-1">
          <li className="flex min-h-[48px] items-center justify-between text-slate-500"><span>السكر</span><span className="text-xs">دائمًا</span></li>
          {LAYERS.map((l) => (
            <li key={l.id} className="flex min-h-[48px] items-center justify-between"><span>{l.label}</span><Toggle on={layers.has(l.id)} onChange={(v) => toggle(l.id, v)} label={l.label} /></li>
          ))}
        </ul>
      </Sheet>
    </div>
  );
}

/** "نزل 0.7 خلال 15 د · 0.05 بالدقيقة": words instead of +/− signs, which read ambiguously inside Arabic text. */
function change(d15: number | null, rate: number | null, unit: 'mmol' | 'mgdl') {
  const f = (mg: number, d: number) => (unit === 'mmol' ? Math.abs(mg / 18.016) : Math.abs(mg)).toFixed(unit === 'mmol' ? d : d === 2 ? 1 : 0);
  const word = (x: number) => (Math.abs(x) < (unit === 'mmol' ? 1.8 : 2) ? 'ثابت' : x < 0 ? 'نزل' : 'صعد');
  const parts: string[] = [];
  if (d15 !== null) parts.push(word(d15) === 'ثابت' ? 'ثابت خلال 15 د' : `${word(d15)} ${f(d15, 1)} خلال 15 د`);
  if (rate !== null && (d15 === null || word(d15) !== 'ثابت')) parts.push(`${d15 === null ? (rate < 0 ? 'ينزل ' : 'يصعد ') : ''}${f(rate, 2)} بالدقيقة`);
  return parts.join(' · ');
}
