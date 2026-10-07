import { useCallback, useEffect, useMemo, useState } from 'react';
import { Timeline } from '../engine/Timeline';
import { useSeries } from '../engine/useSeries';
import { GraphLoadNotice } from '../components/GraphLoadNotice';
import { limitEnd, type View } from '../engine/series';
import { buildMarks, defaultLayers, type Group } from '../engine/events';
import { EventSheet } from '../components/EventSheet';
import { Link, useNavigate } from 'react-router-dom';
import { setFullModeNow } from '../lib/mom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { glucoseStats, type GlucoseStats } from '../lib/api';
import { effectiveRange, formatGlucose, glucoseAge, glucoseStatus, GLUCOSE_ERRORS, unitLabel, type Reading } from '../lib/glucose';
import { kuwaitDayStart, sinceText, statusSentence, type Tone } from '../lib/now';
import { fmt } from '../lib/carbs';
import type { IconName } from '../icons/defs';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { LogSheet } from '../components/LogSheet';
import { AlertStrip } from '../components/AlertStrip';
import { ResearchQuestion } from '../components/ResearchQuestion';
import { VersionTag } from '../components/Version';
import { isNight, schoolWindow } from '../lib/schedule';
// imported (not from /public) so every new artwork gets a new hashed file name and phones never keep an old copy
import layanWebp from '../assets/layan_peek.webp';
import layanPng from '../assets/layan_peek.png';
import { useAlerts } from '../hooks/useAlerts';
import { describeEvent } from '../lib/events';
import { Card, asset, cx } from '../components/ui';
import { dir, isEn, t, tMaybe } from '../i18n';
import { KIND_STYLE } from '../lib/kinds';
import { sensorLife } from '../engine/status';
import { syncPredictions } from '../lib/predictions';
import { nightOf } from '../lib/schedule';
import { trendFrom, libreOf } from '../engine/trend';
import { useGraphExtras } from '../hooks/useGraphExtras';
import { fmtTime } from '../lib/constants';
import { recentFatty } from '../engine/iob';
import { GraphHelp } from '../components/ForecastKey';
import { TrendArrow, TrendLine } from '../components/Trend';
import { NextDose } from '../components/NextDose';
import { OnBoardLanes } from '../components/OnBoardLanes';
import { GrowthCard } from '../components/GrowthCard';
import { PlanLines } from '../components/Plans';
import { SameMealLink, useRecentSame } from '../components/SameMeal';
import { arrowSource, shownLevel } from '../lib/arrowChoice';

const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok-fill', low: 'bg-over-fill', urgent: 'bg-over', high: 'bg-near-fill', warn: 'bg-near-fill', plain: 'bg-slate-300' };
const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', low: 'text-over', urgent: 'text-over', high: 'text-near', warn: 'text-near', plain: 'text-slate-700' };

export default function Now() {
  const { settings, history, events, nameOf, members, products } = useData();
  const { g, failed, reload } = useGlucose();
  const [logOpen, setLogOpen] = useState(false);
  const [logKind, setLogKind] = useState<'treatment' | null>(null);
  const alerts = useAlerts();
  const [today, setToday] = useState<GlucoseStats | null>(null);

  useEffect(() => {
    glucoseStats(kuwaitDayStart(), new Date(), settings.glucose_low_mgdl, settings.glucose_high_mgdl).then(setToday).catch(() => setToday(null));
  }, [g?.latest?.taken_at, settings.glucose_low_mgdl, settings.glucose_high_mgdl]);

  const unit = settings.glucose_unit;
  const latest = g?.latest ?? null;
  const age = latest ? glucoseAge(latest.taken_at) : null;
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const status = latest ? glucoseStatus(latest.mg_dl, rng.low, rng.high) : null;
  const trend = useMemo(() => (g ? trendFrom(g.readings, Date.now()) : null), [g]);
  const sentence = statusSentence({ hasReading: !!latest, age: age?.state ?? null, status, trend: (() => { const l = shownLevel(trend, latest?.trend ?? null, arrowSource()).level; return l === null ? null : libreOf(l); })() });
  const notConnected = !!g && !g.connected;
  // keep prediction tracking up to date in the background (at most every 5 minutes)
  useEffect(() => { syncPredictions(settings, history, events, g?.sensor?.started_at ? Date.parse(g.sensor.started_at) : null).catch(() => {}); },
    [settings, history, events, g?.sensor?.started_at]);
  const sensor = g?.sensor?.started_at ? sensorLife(g.sensor.started_at, settings.sensor_days ?? 14, Date.now()) : null;

  // the last thing she ate: a meal or snack, or carbs logged on their own (e.g. with a dose), whichever is newest
  const lastMeal = useMemo(() => {
    const h = history.find((x) => x.total_carbs > 0 || x.lines.length > 0) ?? null;
    const c = events.find((e) => !e.deleted_at && e.kind === 'carbs' && e.carbs_g) ?? null;
    if (c && (!h || Date.parse(c.occurred_at) > Date.parse(h.eaten_at))) return { name: c.note || t('كارب'), total_carbs: c.carbs_g!, eaten_at: c.occurred_at };
    return h ? { name: h.name, total_carbs: h.total_carbs, eaten_at: h.eaten_at } : null;
  }, [history, events]);
  const lastInsulin = events.find((e) => e.kind === 'insulin');
  const lastTreatment = events.find((e) => e.kind === 'treatment' && Date.now() - new Date(e.occurred_at).getTime() < 3 * 3600000);

  // Zeigarnik + goal gradient: one compact line naming the next step; it leaves when everything is set.
  // Connecting the sensor is not repeated here while the glucose card itself asks for it.
  const setup = [
    { done: !g || g.connected || notConnected, label: t('ربط قراءات السكر'), to: '/cgm' }, // unknown while loading: not a step to nag about
    { done: settings.glucose_low_mgdl !== null || settings.glucose_high_mgdl !== null, label: t('تحديد نطاق السكر من الطبيب'), to: '/doctor' },
    { done: settings.alert_low_mgdl !== null || settings.alert_urgent_low_mgdl !== null, label: t('حدود التنبيهات وتفعيلها'), to: '/alerts' },
    { done: members.length >= 2, label: t('إضافة الأب أو الأم'), to: '/more' },
    { done: products.some((p) => p.kind === 'commercial' && p.approved), label: t('أول منتج من الملصق'), to: '/products/new' },
  ];
  const left = setup.filter((s) => !s.done);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-28 pt-[max(8px,env(safe-area-inset-top))] lg:max-w-none lg:px-8 lg:pb-12">
      <h1 className="sr-only">{t('الآن')}</h1>
      <LayanHeader alertCount={alerts.open.length} night={isNight(settings)} />
      <div className="space-y-3 pb-24 lg:pb-0">
        {/* the only things allowed above her glucose: alerts that need someone now */}
        <AlertStrip alerts={alerts.open} onChange={alerts.reload} onTreat={() => { setLogKind('treatment'); setLogOpen(true); }} />
        {/* desktop: glucose and the graph on the wide side, the day beside it */}
        <div className="space-y-3 lg:grid lg:grid-cols-[minmax(0,1.7fr)_minmax(0,1fr)] lg:items-start lg:gap-8 lg:space-y-0">
        <div className="space-y-3">

        {/* 1 · Primary: the current glucose, its direction and a short status — or the one action that gets it */}
        {notConnected ? (
          <Card className="space-y-3 text-center">
            <img src={asset('04_objects/obj_cgm.svg')} alt="" className="mx-auto h-14 w-14" />
            <p className="text-lg font-bold">{t('اربط قراءات السكر الحية')}</p>
            <Link to="/cgm" className="flex min-h-[52px] items-center justify-center rounded-2xl bg-brand text-lg font-bold text-white">{t('ربط الآن')}</Link>
          </Card>
        ) : (
          <Card className="relative overflow-hidden !pb-2">
            {/* her corner: everything below the first line keeps clear of her */}
            <div className="relative" style={{ minHeight: GIRL_H + 30 }}>
            <div className="flex items-center gap-2">
              <span className={cx('h-3 w-3 shrink-0 rounded-full', TONE_DOT[sentence.tone])} />
              <span className={cx('text-[17px] font-bold', TONE_TEXT[sentence.tone])}>{g ? sentence.text : failed ? t('تعذّر تحميل القراءة') : '…'}</span>
              {latest && <span className="ms-auto text-[15px] text-slate-500">{sinceText(latest.taken_at)}</span>}
            </div>
            <div style={{ paddingInlineEnd: GIRL_W - 8 }}>
            {latest && age?.state !== 'stale' ? (
              <div className={cx('mt-1 flex items-center gap-3', age?.state === 'old' && 'opacity-50')}>
                <span className="num text-[60px] font-bold leading-none text-brand-num">{formatGlucose(latest.mg_dl, unit)}</span>
                <span className="text-brand-num"><TrendArrow trend={trend} libre={latest.trend} size={38} /></span>
                <span className="self-end pb-2 text-[15px] text-slate-500">{unitLabel(unit)}</span>
              </div>
            ) : null}
            {latest && age?.state === 'fresh' && <TrendLine compact trend={trend} libre={latest.trend} unit={unit} className="mt-1 text-[15px] text-slate-600" />}
            {latest && age?.state === 'stale' ? (
              <p className="mt-1 text-[15px] text-near">{t('آخر قراءة')} <span className="num font-bold">{formatGlucose(latest.mg_dl, unit)}</span> {sinceText(latest.taken_at)}. {t('تحقق من جوال ليان والحساس.')}</p>
            ) : null}
            {g?.error && <p className="mt-1 text-[15px] text-over">{GLUCOSE_ERRORS[g.error] ?? g.error} <button className="min-h-[44px] underline" onClick={reload}>{t('إعادة')}</button></p>}
            <NextDose />
            </div>
            <CardGirl className={sensor && sensor.state !== 'ok' ? 'bottom-0' : '-bottom-2'} />
            </div>
            {/* the sensor only when it is nearly done; what is still on board is told under the graph */}
            {sensor && sensor.state !== 'ok' && (
              <Link to="/status" className="-mx-1 mt-1 flex min-h-[44px] items-center gap-2 border-t border-slate-100 px-1 pt-1 text-[15px] text-slate-600">
                <b className="min-w-0 flex-1 truncate text-slate-900">{sensor.state === 'ended' ? t('انتهى الحساس') : t('الحساس ينتهي {time}', { time: sinceUntil(sensor.left) })}</b>
                <span className="shrink-0 font-bold text-brand">{t('الحالة')} {isEn() ? '›' : '‹'}</span>
              </Link>
            )}
          </Card>
        )}
        {/* the graph runs edge to edge with no box around it, so it can use the whole width and plenty of height */}
        {g?.connected && <HomeChart live={g.readings} />}
        {/* she just ate a meal she had before: one tap shows both curves over each other */}
        <RecentSame />
        {/* insulin and carbs still working, as two thin timelines: how much is left, from what, for how long */}
        {!notConnected && <OnBoardLanes statusLink={!(sensor && sensor.state !== 'ok')} />}

        </div>
        <div className="space-y-4">
        {/* 2 · Supporting: today in one line (details in Analysis), then what was last logged */}
        <section aria-label={t('اليوم')} className="space-y-1">
          {today && today.n > 0 && (
            <Link to="/analysis?mode=stats" className="flex min-h-[44px] items-center gap-3 px-1 text-sm">
              <span className="font-bold text-slate-700">{t('اليوم')}</span>
              <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
                <i style={{ width: `${today.pct_vlow + today.pct_low}%` }} className="bg-over-fill" />
                <i style={{ width: `${today.pct_in}%` }} className="bg-ok-fill" />
                <i style={{ width: `${today.pct_high + today.pct_vhigh}%` }} className="bg-near-fill" />
              </span>
              <span className="text-slate-600">{t('ضمن النطاق')} <b className="num text-slate-800">{Math.round(today.pct_in)}%</b></span>
            </Link>
          )}
          <PlanLines />
          <GrowthCard />
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
            <Line icon="meals" tone={KIND_STYLE.meal.icon} text={lastMeal ? <><span className="text-slate-500">{t('آخر أكل:')}</span> <bdi>{tMaybe(lastMeal.name)}</bdi> · {t('{g} غ', { g: fmt(lastMeal.total_carbs) })}</> : t('لا توجد وجبة مسجّلة')} when={lastMeal?.eaten_at} />
            <Line icon="insulin" tone={KIND_STYLE.insulin.icon} text={lastInsulin ? <><span className="text-slate-500">{t('آخر جرعة:')}</span> {describeEvent(lastInsulin)}</> : t('لا يوجد إنسولين مسجّل')} when={lastInsulin?.occurred_at} who={lastInsulin ? nameOf(lastInsulin.created_by) : ''} />
            <FattyLine />
            {lastTreatment && <Line icon="treatment" tone={KIND_STYLE.treatment.icon} text={describeEvent(lastTreatment)} when={lastTreatment.occurred_at} who={nameOf(lastTreatment.created_by)} />}
            <SchoolLine />
          </ul>
        </section>

        {/* 3 · Secondary: a research question only the parents can answer (at most 3 a day), then setup */}
        <ResearchQuestion unit={unit} />

        {/* setup, as a single reminder line */}
        {left.length > 0 && (
          <Link to={left[0].to} className={cx('flex min-h-[52px] items-center gap-3 rounded-2xl px-4 py-2', left.length === 1 ? 'bg-brand-soft text-brand' : 'border border-slate-100 bg-white text-slate-600')}>
            <SetupRing done={setup.length - left.length} total={setup.length} />
            <span className="min-w-0 flex-1 text-sm">
              <b className="block">{left.length === 1 ? t('بقيت خطوة واحدة') : t('بقيت {n} خطوات للإعداد', { n: left.length })}</b>
              <span className="block truncate">{left[0].label}</span>
            </span>
            <span className="opacity-60">{isEn() ? '›' : '‹'}</span>
          </Link>
        )}

        </div>
        </div>
        <footer className="space-y-1 px-1 text-center text-[11px] leading-relaxed text-slate-400">
          <p>{t('القراءات قد تتأخر عن الجهاز. راجعوا كل جرعة قبل إعطائها.')}</p>
          <VersionTag />
        </footer>
      </div>

      {/* the one primary action in the thumb zone above the tab bar: a round + that covers as little of the graph as it can */}
      <div className={cx('pointer-events-none fixed inset-x-0 bottom-[calc(74px+env(safe-area-inset-bottom))] z-30 px-4 lg:bottom-8 lg:ps-[17rem] lg:pe-8', logOpen && 'hidden')}>
        <div className="mx-auto flex max-w-2xl justify-start lg:max-w-none lg:justify-end">
          <button onClick={() => setLogOpen(true)} aria-label={t('سجّل')} className="pointer-events-auto grid h-14 w-14 place-items-center rounded-full bg-brand text-white shadow-[0_8px_24px_rgba(91,72,214,0.30)] active:scale-[0.96]">
            <Icon name="plus" size={28} />
          </button>
        </div>
      </div>
      <LogSheet open={logOpen} startKind={logKind} onClose={() => { setLogOpen(false); setLogKind(null); }} low={!!latest && Date.now() - Date.parse(latest.taken_at) < 20 * 60000 && latest.mg_dl <= (rng.low ?? 70) + 5} />
    </main>
  );
}

const sinceUntil = (ms: number) => {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? t('خلال {h} س', { h }) : t('خلال {m} د', { m });
};

/** Setup progress as a small ring (goal gradient), with the count inside. */
function SetupRing({ done, total }: { done: number; total: number }) {
  const r = 15, c = 2 * Math.PI * r;
  return (
    <svg viewBox="0 0 36 36" className="h-9 w-9 shrink-0 -rotate-90" aria-hidden>
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeOpacity="0.15" strokeWidth="4" />
      <circle cx="18" cy="18" r={r} fill="none" stroke="currentColor" strokeWidth="4" strokeLinecap="round" strokeDasharray={`${(done / total) * c} ${c}`} />
      <text x="18" y="18" transform="rotate(90 18 18)" textAnchor="middle" dominantBaseline="central" fontSize="11" fontWeight="700" fill="currentColor" fontFamily="Rubik, system-ui">{done}/{total}</text>
    </svg>
  );
}

/**
 * Layan peeks over the glucose card; a few faint hearts around her only — never around the data. Kept small so
 * the glucose stays high on the screen. Only the bell (alerts) is always here; the night screen appears at night.
 */
/** The top controls only: the alerts bell, the night screen in the evening, the simple-mode switch. Layan herself
 *  lives inside the glucose card now, so nothing above it takes height. */
function LayanHeader({ alertCount, night }: { alertCount: number; night: boolean }) {
  const nav = useNavigate();
  const evening = night || new Date().getHours() >= 19;
  return (
    <header className="flex h-11 items-center justify-between">
      <Link to="/alerts" aria-label={alertCount ? t('التنبيهات: {n} مفتوح', { n: alertCount }) : t('التنبيهات')} className="relative grid h-11 w-11 place-items-center rounded-full text-slate-500">
        <Icon name="bell" size={26} />
        {alertCount > 0 && <span className="absolute end-2 top-1.5 h-2.5 w-2.5 rounded-full bg-over-fill ring-2 ring-[rgb(var(--bg))]" />}
      </Link>
      <div className="flex items-center gap-1">
        {evening && (
          <Link to="/night" aria-label={t('شاشة الليل')} className="grid h-11 w-11 place-items-center rounded-full text-slate-500">
            <Icon name="moon" size={24} />
          </Link>
        )}
        {/* one tap to the simple screens (the same as More → «افتح الوضع البسيط») */}
        <button onClick={() => { setFullModeNow(false); nav('/mom'); }} className="min-h-[36px] rounded-full bg-brand-soft px-3 text-[15px] font-bold text-brand active:opacity-80">
          {t('البسيط')}
        </button>
      </div>
    </header>
  );
}

/** Layan, rising from the bottom corner of the glucose card and looking at the number (mirrored so she faces it in
 *  either reading direction). Decoration only: the text beside her keeps clear of her. */
const GIRL_W = 112, GIRL_H = Math.round(GIRL_W * 388 / 480);
function CardGirl({ className }: { className?: string }) {
  const heart = 'M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z';
  return (
    <div className={cx('pointer-events-none absolute end-0', className)} style={{ width: GIRL_W, height: GIRL_H }} aria-hidden>
      {([[2, 0, 11, -12], [98, 10, 10, 14]] as const).map(([x, y, size, rot], i) => (
        <svg key={i} viewBox="0 0 24 24" width={size} height={size} className="absolute text-[#F49AB6] opacity-50" style={{ insetInlineStart: x, top: y, transform: `rotate(${rot}deg)` }}>
          <path d={heart} fill="currentColor" fillOpacity="0.35" stroke="currentColor" strokeWidth="1.6" />
        </svg>
      ))}
      <picture>
        <source srcSet={layanWebp} type="image/webp" />
        {/* the artwork looks to its right; in an LTR page the number is to her left, so she is mirrored */}
        <img src={layanPng} alt="" draggable={false} className="absolute inset-x-0 bottom-0 w-full select-none" style={{ transform: isEn() ? 'scaleX(-1)' : undefined }} />
      </picture>
    </div>
  );
}

function Line({ icon, text, when, who, tone }: { icon: IconName; text: React.ReactNode; when?: string; who?: string; tone: string }) {
  return (
    <li><Link to="/timeline" className="flex min-h-[52px] items-center gap-3 px-4 py-1.5 active:bg-slate-50">
      <span className={cx('grid h-8 w-8 shrink-0 place-items-center rounded-full', tone)}><Icon name={icon} size={18} /></span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {when && <span className="shrink-0 text-sm text-slate-500">{sinceText(when)}{who ? <> · <bdi>{who}</bdi></> : ''}</span>}
    </Link></li>
  );
}

/**
 * The live graph on Now: the same engine as Analysis (dots coloured by level, gaps left as breaks, what was logged
 * on the rail, long-press to read any point), full width, three hours ending now. It can be dragged back in time;
 * «الآن» brings it back.
 */
function RecentSame() {
  const same = useRecentSame();
  return same ? <SameMealLink to={`/same/${same.target.id}`} target={same.target} matches={same.matches} /> : null;
}

function HomeChart({ live }: { live: Reading[] }) {
  const { settings, history, events } = useData();
  const SPAN = 3 * 3600000;
  const [now, setNow] = useState(Date.now());
  const [following, setFollowing] = useState(true);
  const AHEAD = 0.25; // room for what is still working and the forecast lines
  const [view, setView] = useState<View>(() => ({ span: SPAN, end: limitEnd(Infinity, Date.now(), SPAN, AHEAD) }));
  const [picked, setPicked] = useState<Group | null>(null);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(id); }, []);
  useEffect(() => { setNow(Date.now()); }, [live]);
  useEffect(() => { if (following) setView((v) => ({ span: v.span, end: limitEnd(Infinity, now, v.span, AHEAD) })); }, [now, following]);
  const onView = useCallback((v: View) => {
    // live = at (or within 2% of) the live edge, which sits AHEAD of now; measured from now instead, a slide of up to a
    // quarter of the screen counted as still live and snapped straight back, so the graph seemed stuck
    const t1 = Date.now(), isLive = v.end >= limitEnd(Infinity, t1, v.span, AHEAD) - v.span * 0.02;
    setFollowing(isLive);
    setView(isLive ? { span: v.span, end: limitEnd(Infinity, t1, v.span, AHEAD) } : v);
  }, []);
  const { series, error: loadError, retry } = useSeries(view.end - view.span, view.end, live);
  const marks = useMemo(() => buildMarks(history, events), [history, events]);
  const layers = useMemo(() => defaultLayers(), []);
  const projected30 = useMemo(() => trendFrom(live, now)?.projected30 ?? null, [live, now]);
  // IOB and COB as two thin strips under the graph, and where glucose heads from here (display only)
  // insulin and carbs on board are told under the graph in words (OnBoardLanes), so the graph keeps only glucose
  const { tracks, forecasts } = useGraphExtras({ series, now, iob: false, cob: false, act: true, forecast: true, projected30, start: view.end - view.span, end: view.end });
  const height = useMemo(() => Math.round(window.innerWidth >= 1024 ? Math.min(650, Math.max(410, window.innerHeight * 0.58)) + 48 + 52 : Math.min(500, Math.max(290, window.innerHeight * 0.43)) + 48 + 52) + (tracks?.iob || tracks?.cob ? 68 : 0), [!!(tracks?.iob || tracks?.cob)]); // eslint-disable-line react-hooks/exhaustive-deps
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  return (
    <>
    {loadError && <div className="mb-2"><GraphLoadNotice error={loadError} empty={!series.t.length} retry={retry} /></div>}
    <div className="relative -mx-4 lg:mx-0">
      <Timeline series={series} view={view} now={now} onView={onView} unit={settings.glucose_unit} height={height}
        range={rng} marks={marks} layers={layers} onSelect={setPicked} tracks={tracks} forecasts={forecasts} ahead={AHEAD} night={nightOf(settings)} />
      {!following && (
        <button onClick={() => { setFollowing(true); setView({ span: SPAN, end: limitEnd(Infinity, Date.now(), SPAN, AHEAD) }); }}
          className="absolute start-4 top-2 min-h-[40px] rounded-full bg-brand px-4 text-sm font-bold text-white shadow">{t('الآن')}</button>
      )}
      <GraphHelp tracks={!!(tracks?.iob || tracks?.cob)} act={!!tracks?.act} className="absolute right-12 top-2" />
      <EventSheet group={picked} series={series} onClose={() => setPicked(null)} />
    </div>
    </>
  );
}

/** For 5 hours after a fatty meal: its carbs arrive late, so a rise 3–5 hours after eating is expected. */
function FattyLine() {
  const { history } = useData();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 60000); return () => window.clearInterval(id); }, []);
  const f = recentFatty(history, now);
  if (!f) return null;
  return (
    <li><Link to="/timeline" className="flex min-h-[52px] items-center gap-3 px-4 py-1.5 active:bg-slate-50">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-warm-soft text-base" aria-hidden>🍕</span>
      <span className="min-w-0 flex-1 text-sm">
        <b className="block">{t('وجبة دسمة')}: <bdi>{tMaybe(f.name)}</bdi></b>
        <span className="block text-xs text-slate-600">{t('قد يرتفع السكر متأخرًا حتى {time}', { time: fmtTime(new Date(f.until)) })}</span>
      </span>
    </Link></li>
  );
}

/** After school (until 5 hours later) on a school day: how the school hours went, in one card. */
/** After school (for 5 hours): the school day in one line of the "today" list. */
function SchoolLine() {
  const { settings } = useData();
  const [st, setSt] = useState<GlucoseStats | null>(null);
  const w = schoolWindow(settings);
  const now = Date.now();
  const show = !!w && now >= w.to && now < w.to + 5 * 3600000;
  useEffect(() => {
    if (!show || !w) return;
    glucoseStats(new Date(w.from), new Date(w.to), settings.glucose_low_mgdl, settings.glucose_high_mgdl).then(setSt).catch(() => setSt(null));
  }, [show, w?.from]);
  if (!show || !w || !st || st.n === 0) return null;
  return (
    <li><Link to="/analysis?mode=day" className="flex min-h-[52px] items-center gap-3 px-4 py-1.5 active:bg-slate-50">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="school" size={18} /></span>
      <span className="min-w-0 flex-1 truncate">{t('يوم المدرسة')} · {t('ضمن النطاق')} <b className="num">{Math.round(st.pct_in)}%</b></span>
    </Link></li>
  );
}
