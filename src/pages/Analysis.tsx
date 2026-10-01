import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { formatGlucose, glucoseStatus, unitLabel } from '../lib/glucose';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { Chip, Page, cx } from '../components/ui';
import { Timeline } from '../engine/Timeline';
import { useSeries } from '../engine/useSeries';
import { PERIODS, delta15, freshness, limitEnd, rateAt, type View } from '../engine/series';
import StatsPanel from './Advanced';

const MODES = [{ id: 'live', label: 'مباشر' }, { id: 'stats', label: 'الأرقام' }] as const;
const FRESH = { live: { text: 'مباشر', cls: 'bg-ok-soft text-ok' }, delayed: { text: 'متأخر', cls: 'bg-near-soft text-near' }, missing: { text: 'منقطع', cls: 'bg-over-soft text-over' } };

/** التحليل: Live (the timeline engine) and the numbers. More modes arrive stage by stage (GLUCOSE_PLAN 11.2). */
export default function Analysis() {
  const [params, setParams] = useSearchParams();
  const mode = params.get('mode') === 'stats' ? 'stats' : 'live';
  return (
    <Page title="التحليل">
      <div className="mb-3 grid grid-cols-2 gap-1 rounded-2xl bg-slate-100 p-1" role="tablist">
        {MODES.map((m) => (
          <button key={m.id} role="tab" aria-selected={mode === m.id} onClick={() => setParams(m.id === 'live' ? {} : { mode: m.id }, { replace: true })}
            className={cx('min-h-[40px] rounded-xl text-sm font-bold', mode === m.id ? 'bg-white shadow-card' : 'text-slate-500')}>{m.label}</button>
        ))}
      </div>
      {mode === 'live' ? <Live /> : <StatsPanel />}
    </Page>
  );
}

function Live() {
  const { settings } = useData();
  const { g } = useGlucose();
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
  const status = latest && fresh !== 'missing' ? glucoseStatus(latest.mg_dl, settings.glucose_low_mgdl, settings.glucose_high_mgdl) : null;
  const sign = (x: number, d: number) => `${x > 0 ? '+' : x < 0 ? '−' : ''}${Math.abs(x).toFixed(d)}`;
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
            <div className="num mt-1 text-sm text-slate-600" dir="ltr">
              {d15 !== null ? `${sign(unit === 'mmol' ? d15 / 18.016 : d15, unit === 'mmol' ? 1 : 0)} / 15 min` : ''}{d15 !== null && rate !== null ? ' · ' : ''}{rate !== null ? `${sign(unit === 'mmol' ? rate / 18.016 : rate, unit === 'mmol' ? 2 : 1)} / min` : ''}
            </div>
          </div>
        ) : <div className="text-lg font-bold text-slate-500">{g ? 'لا توجد قراءة حديثة' : '…'}</div>}
        <span className={cx('ms-auto mb-1 rounded-full px-2.5 py-1 text-xs font-bold', FRESH[fresh].cls)}>
          {FRESH[fresh].text}{lastT ? ` · ${Math.max(0, Math.round((now - lastT) / 60000))} د` : ''}
        </span>
      </div>

      <div className="relative -mx-4 bg-white py-2 shadow-card">
        <Timeline series={series} view={view} now={now} onView={onView} unit={unit} height={height}
          range={{ low: settings.glucose_low_mgdl, high: settings.glucose_high_mgdl }} />
        {loading && <div className="absolute start-3 top-3 text-xs text-slate-400">…</div>}
      </div>

      <div className="flex items-center gap-2">
        <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1" dir="ltr">
          {PERIODS.map((p) => <Chip key={p.id} active={period === p.id} onClick={() => onView({ span: p.ms, end: live ? Infinity : view.end }, { animate: true })}>{p.id}</Chip>)}
        </div>
        {!live && <button onClick={() => onView({ span: view.span, end: Infinity }, { animate: true })} className="min-h-[40px] shrink-0 rounded-full bg-brand px-4 text-sm font-bold text-white">الآن</button>}
      </div>
      <p className="px-1 text-xs text-slate-400">اسحب للتنقل · اقرص للتكبير · اضغط مطوّلًا للتفاصيل</p>
    </div>
  );
}
