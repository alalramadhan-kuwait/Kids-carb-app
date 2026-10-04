import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { effectiveRange, formatGlucose, glucoseStatus, unitLabel } from '../lib/glucose';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { Chip, Page, cx } from '../components/ui';
import { Timeline } from '../engine/Timeline';
import { useLandscape } from '../hooks/useLandscape';
import { useSeries } from '../engine/useSeries';
import { PERIODS, delta15, freshness, limitEnd, rateAt, type View } from '../engine/series';
import StatsPanel from './Advanced';
import { ResearchPanel } from './Research';
import { DayView } from './Day';
import { Patterns } from './Patterns';
import { MealResponse } from './MealResponse';
import { Compare } from './Compare';
import { EventSheet } from '../components/EventSheet';
import { Sheet, Toggle } from '../components/ui';
import { iobParamsOk, modelLine } from '../engine/iob';
import { usePredictions } from '../lib/predictions';
import { nightOf } from '../lib/schedule';
import { trendFrom } from '../engine/trend';
import { useGraphExtras } from '../hooks/useGraphExtras';
import { GraphHelp } from '../components/ForecastKey';
import { LAYERS, buildMarks, defaultLayers, type Group, type Layer } from '../engine/events';
import { isEn, t } from '../i18n';

const loadLayers = (): Set<Layer> => {
  try {
    const v = localStorage.getItem('layers');
    if (v) {
      const set = new Set(JSON.parse(v) as Layer[]);
      // forecasts arrived after the choice was saved: on once, then the parents' choice stands
      if (!localStorage.getItem('layers_forecast')) { set.add('forecast'); localStorage.setItem('layers_forecast', '1'); localStorage.setItem('layers', JSON.stringify([...set])); }
      return set;
    }
  } catch { /* private mode */ }
  return defaultLayers();
};

// labels stay Arabic here and are shown with t()
// four tabs; the prediction lab is an icon in the header's corner (rarely used, so it gives the tabs the room);
// meal response and compare open from inside الأنماط, which stays selected while they are shown
const MODES = [{ id: 'live', label: 'مباشر' }, { id: 'day', label: 'اليوم' }, { id: 'patterns', label: 'الأنماط' }, { id: 'stats', label: 'الأرقام' }] as const; // i18n-ok
const SUB = { meals: 'استجابة الوجبات', compare: 'مقارنة فترتين' } as const; // i18n-ok
const FRESH = { live: { text: 'مباشر', cls: 'bg-brand-soft text-brand' }, delayed: { text: 'متأخر', cls: 'bg-near-soft text-near' }, missing: { text: 'منقطع', cls: 'bg-over-soft text-over' } }; // i18n-ok

/** التحليل: Live (the timeline engine) and the numbers. More modes arrive stage by stage (GLUCOSE_PLAN 11.2). */
export default function Analysis() {
  const [params, setParams] = useSearchParams();
  const mode = (['day', 'patterns', 'meals', 'compare', 'stats', 'lab'] as const).find((m) => m === params.get('mode')) ?? 'live';
  return (
    <Page title={t('التحليل')} action={
      <button onClick={() => setParams(mode === 'lab' ? {} : { mode: 'lab' }, { replace: true })} aria-label={t('مختبر التوقعات')} aria-pressed={mode === 'lab'}
        className={cx('grid h-11 w-11 place-items-center rounded-full', mode === 'lab' ? 'bg-brand text-white' : 'bg-white text-slate-500 shadow-sm')}>
        <Icon name="lab" size={22} />
      </button>
    }>
      <div className="mb-3 grid grid-cols-4 gap-1 rounded-full bg-slate-50 p-1" role="tablist">
        {MODES.map((m) => {
          const on = mode === m.id || (m.id === 'patterns' && (mode === 'meals' || mode === 'compare'));
          return (
            <button key={m.id} role="tab" aria-selected={on} onClick={() => setParams(m.id === 'live' ? {} : { mode: m.id }, { replace: true })}
              className={cx('min-h-[44px] truncate rounded-full px-1 text-center text-sm font-bold', on ? 'bg-brand text-white' : 'text-slate-600')}>{t(m.label)}</button>
          );
        })}
      </div>
      {(mode === 'meals' || mode === 'compare') && (
        <button onClick={() => setParams({ mode: 'patterns' }, { replace: true })} className="mb-2 flex min-h-[44px] items-center gap-2 px-1 font-bold">
          <span className="text-slate-400">{isEn() ? '‹' : '›'}</span>{t(SUB[mode])}
        </button>
      )}
      {mode === 'lab' && <h2 className="mb-2 px-1 text-lg font-bold">{t('مختبر التوقعات')}</h2>}
      {mode === 'live' ? <Live /> : mode === 'day' ? <DayView /> : mode === 'patterns' ? <Patterns /> : mode === 'meals' ? <MealResponse /> : mode === 'compare' ? <Compare /> : mode === 'lab' ? <ResearchPanel /> : <StatsPanel />}
    </Page>
  );
}

/** The gesture hint shows on the first few visits only (progressive disclosure). */
function useFirstVisits(key: string, n = 3) {
  const [show] = useState(() => {
    try { const c = Number(localStorage.getItem(key) ?? 0); localStorage.setItem(key, String(c + 1)); return c < n; } catch { return true; }
  });
  return show;
}

function Live() {
  const firstVisits = useFirstVisits('hint_live');
  const { settings, history, events } = useData();
  const { g } = useGlucose();
  const land = useLandscape();
  const [layers, setLayers] = useState<Set<Layer>>(loadLayers);
  const [layersOpen, setLayersOpen] = useState(false);
  const [picked, setPicked] = useState<Group | null>(null);
  const marks = useMemo(() => buildMarks(history, events), [history, events]);
  const toggle = (id: Layer, on: boolean) => {
    const next = new Set(layers); if (on) next.add(id); else next.delete(id);
    setLayers(next); try { localStorage.setItem('layers', JSON.stringify([...next])); } catch { /* ignore */ }
  };
  const unit = settings.glucose_unit;
  // IOB / COB: only with the care team's parameters, only when the parents turn the layer on; display only
  const iobP = settings.iob_dia_min && settings.iob_peak_min ? { dia: settings.iob_dia_min, peak: settings.iob_peak_min } : null;
  const iobOk = iobParamsOk(iobP), cobOk = !!settings.cob_absorb_min;
  const [now, setNow] = useState(Date.now());
  const [view, setView] = useState<View>(() => ({ span: PERIODS[0].ms, end: limitEnd(Infinity, Date.now(), PERIODS[0].ms) }));
  const [live, setLive] = useState(true);
  const anim = useRef(0);
  const viewRef = useRef(view); viewRef.current = view;
  const height = useMemo(() => Math.round(Math.min(520, Math.max(260, window.innerHeight * 0.5)) + 48), []); // + the readout strip

  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(id); }, []);
  useEffect(() => { if (g?.latest) setNow(Date.now()); }, [g?.latest?.taken_at]);
  const aheadRef = useRef(0.04);
  useEffect(() => { if (live) setView((v) => ({ span: v.span, end: limitEnd(Infinity, now, v.span, aheadRef.current) })); }, [now, live]);

  const onView = useCallback((v: View, o?: { animate?: boolean }) => {
    cancelAnimationFrame(anim.current);
    const t = Date.now();
    const isLive = v.end >= t + v.span * 0.02;
    setLive(isLive);
    const target = isLive ? { span: v.span, end: limitEnd(Infinity, t, v.span, aheadRef.current) } : v;
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
  const past = usePredictions(g?.sensor?.started_at ? Date.parse(g.sensor.started_at) : null);
  const projected30 = useMemo(() => (g?.readings ? trendFrom(g.readings, now)?.projected30 ?? null : null), [g?.readings, now]);
  const { tracks, forecasts, ahead } = useGraphExtras({ series, now, iob: layers.has('iob'), cob: layers.has('cob'), forecast: layers.has('forecast'),
    projected30, past: view.span <= 24 * 3600000 ? past : null, start: view.end - view.span, end: view.end });
  const model = tracks ? modelLine(tracks.iob ? iobP : null, tracks.cob ? settings.cob_absorb_min : null) : null;
  aheadRef.current = ahead;
  const n = series.t.length;
  const lastT = n ? series.t[n - 1] : null;
  const fresh = freshness(lastT, now);
  const d15 = n ? delta15(series, n - 1) : null;
  const rate = n ? rateAt(series, n - 1) : null;
  const latest = g?.latest;
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const status = latest && fresh !== 'missing' ? glucoseStatus(latest.mg_dl, rng.low, rng.high) : null;
  const period = PERIODS.find((p) => Math.abs(p.ms - view.span) / p.ms < 0.03)?.id;

  if (land.landscape) return (
    <div className="fixed inset-0 z-[46] flex flex-col bg-[rgb(var(--bg))] pe-[env(safe-area-inset-right)] ps-[env(safe-area-inset-left)]">
      <div className="flex h-12 items-center gap-3 px-3">
        {latest && <span className="num text-2xl font-bold text-brand-num">{formatGlucose(latest.mg_dl, unit)}</span>}
        <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold', FRESH[fresh].cls)}>{t(FRESH[fresh].text)}</span>
        <div className="ms-auto flex gap-1.5" dir="ltr">
          {PERIODS.slice(0, 6).map((pp) => <Chip key={pp.id} active={period === pp.id} onClick={() => onView({ span: pp.ms, end: live ? Infinity : view.end }, { animate: true })}>{pp.id}</Chip>)}
          {!live && <button onClick={() => onView({ span: view.span, end: Infinity }, { animate: true })} className="min-h-[36px] rounded-full bg-brand px-3 text-sm font-bold text-white">{t('الآن')}</button>}
        </div>
      </div>
      <div className="flex-1 bg-white">
        <Timeline series={series} view={view} now={now} onView={onView} unit={unit} height={Math.max(160, land.height - 48)}
          range={rng} marks={marks} layers={layers} onSelect={setPicked} tracks={tracks} forecasts={forecasts} ahead={ahead} night={nightOf(settings)} />
      </div>
      <EventSheet group={picked} series={series} onClose={() => setPicked(null)} />
    </div>
  );

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
        ) : <div className="text-lg font-bold text-slate-500">{g ? t('لا توجد قراءة حديثة') : '…'}</div>}
        <span className={cx('ms-auto mb-1 rounded-full px-2.5 py-1 text-xs font-bold', FRESH[fresh].cls)}>
          {t(FRESH[fresh].text)}{lastT ? ' · ' + t('{n} د', { n: Math.max(0, Math.round((now - lastT) / 60000)) }) : ''}
        </span>
      </div>

      <div className="relative -mx-4 bg-white py-2 shadow-card">
        <Timeline series={series} view={view} now={now} onView={onView} unit={unit} height={height}
          range={rng}
          marks={marks} layers={layers} onSelect={setPicked} tracks={tracks} forecasts={forecasts} ahead={ahead} night={nightOf(settings)} />
        {loading && <div className="absolute start-3 top-3 text-xs text-slate-400">…</div>}
        <GraphHelp past={forecasts.some((f) => f.kind === 'past')} tracks={!!tracks} className="absolute right-12 top-3" />
      </div>

      <div className="flex items-center gap-2">
        <div className="-mx-1 flex flex-1 gap-1.5 overflow-x-auto px-1" dir="ltr">
          {PERIODS.map((p) => <Chip key={p.id} active={period === p.id} onClick={() => onView({ span: p.ms, end: live ? Infinity : view.end }, { animate: true })}>{p.id}</Chip>)}
        </div>
        <button onClick={() => setLayersOpen(true)} className="min-h-[40px] shrink-0 rounded-full bg-white px-3 text-sm font-bold ring-1 ring-slate-200">{t('الطبقات')}</button>
        {!live && <button onClick={() => onView({ span: view.span, end: Infinity }, { animate: true })} className="min-h-[40px] shrink-0 rounded-full bg-brand px-4 text-sm font-bold text-white">{t('الآن')}</button>}
      </div>
      {model && <p className="px-1 text-xs text-slate-500">{model}</p>}
      {firstVisits && <p className="px-1 text-xs text-slate-400">{t('اسحب للتنقل · اقرص للتكبير · اضغط مطوّلًا للتفاصيل · اضغط أيقونة لما سُجّل')}</p>}
      <EventSheet group={picked} series={series} onClose={() => setPicked(null)} />
      <Sheet open={layersOpen} onClose={() => setLayersOpen(false)} title={t('الطبقات')}>
        <ul className="space-y-1">
          <li className="flex min-h-[48px] items-center justify-between text-slate-500"><span>{t('السكر')}</span><span className="text-xs">{t('دائمًا')}</span></li>
          {LAYERS.map((l) => {
            const locked = (l.id === 'iob' && !iobOk) || (l.id === 'cob' && !cobOk);
            return (
              <li key={l.id} className="flex min-h-[48px] items-center justify-between gap-3">
                <span>{t(l.label)}{locked && <span className="block text-xs text-slate-500">{t('يحتاج أرقام الفريق الطبي في الإعدادات')}</span>}</span>
                {locked ? <span className="text-xs text-slate-400">{t('مطفأ')}</span> : <Toggle on={layers.has(l.id)} onChange={(v) => toggle(l.id, v)} label={t(l.label)} />}
              </li>
            );
          })}
        </ul>
      </Sheet>
    </div>
  );
}

/** "نزل 0.7 خلال 15 د · 0.05 بالدقيقة": words instead of +/− signs, which read ambiguously inside Arabic text. */
function change(d15: number | null, rate: number | null, unit: 'mmol' | 'mgdl') {
  const f = (mg: number, d: number) => (unit === 'mmol' ? Math.abs(mg / 18.016) : Math.abs(mg)).toFixed(unit === 'mmol' ? d : d === 2 ? 1 : 0);
  const word = (x: number) => (Math.abs(x) < (unit === 'mmol' ? 1.8 : 2) ? 'steady' : x < 0 ? 'down' : 'up');
  const parts: string[] = [];
  if (d15 !== null) {
    const w = word(d15), v = f(d15, 1);
    parts.push(w === 'steady' ? t('ثابت خلال 15 د') : w === 'down' ? t('نزل {v} خلال 15 د', { v }) : t('صعد {v} خلال 15 د', { v }));
  }
  if (rate !== null && (d15 === null || word(d15) !== 'steady')) {
    const v = f(rate, 2);
    parts.push(d15 !== null ? t('{v} بالدقيقة', { v }) : rate < 0 ? t('ينزل {v} بالدقيقة', { v }) : t('يصعد {v} بالدقيقة', { v }));
  }
  return parts.join(' · ');
}
