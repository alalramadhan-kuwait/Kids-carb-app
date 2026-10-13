import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { Timeline } from '../engine/Timeline';
import { useSeries } from '../engine/useSeries';
import { GraphLoadNotice } from '../components/GraphLoadNotice';
import { limitEnd, type View } from '../engine/series';
import { buildMarks, defaultLayers, type Group } from '../engine/events';
import { EventSheet } from '../components/EventSheet';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { setFullModeNow } from '../lib/mom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { effectiveRange, formatGlucose, glucoseAge, glucoseStatus, GLUCOSE_ERRORS, unitLabel, type Reading } from '../lib/glucose';
import { sinceText, statusSentence, type Tone } from '../lib/now';
import { fmt } from '../lib/carbs';
import type { IconName } from '../icons/defs';
import { Icon } from '../components/Icon';
import { LogSheet } from '../components/LogSheet';
import { isNight } from '../lib/schedule';
// imported (not from /public) so every new artwork gets a new hashed file name and phones never keep an old copy
import layanWebp from '../assets/layan_peek.webp';
import layanPng from '../assets/layan_peek.png';
import { useAlerts } from '../hooks/useAlerts';
import { unitsWord } from '../lib/events';
import { Card, asset, cx } from '../components/ui';
import { isEn, t, tMaybe } from '../i18n';
import { sensorLife } from '../engine/status';
import { syncPredictions } from '../lib/predictions';
import { nightOf } from '../lib/schedule';
import { trendFrom, libreOf } from '../engine/trend';
import { useGraphExtras } from '../hooks/useGraphExtras';
import { fmtTime } from '../lib/constants';
import { carbLane, carbsFrom, dosesFrom, insulinLane, iobParamsOk, recentFatty, type OnBoardLane } from '../engine/iob';
import { GraphHelp } from '../components/ForecastKey';
import { TrendArrow, TrendLine } from '../components/Trend';
import { dur } from '../components/OnBoardLanes';
import { PlanLines, phaseLine } from '../components/Plans';
import { useRecentSame } from '../components/SameMeal';
import { ALERT_NAME } from '../components/AlertStrip';
import { doseGap } from '../engine/dose';
import { phase, upcoming } from '../engine/mealPlan';
import { usePlans } from '../lib/plans';
import type { AlertRow as AlertRowT } from '../lib/types';
import { arrowSource, shownLevel } from '../lib/arrowChoice';

const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok-fill', low: 'bg-over-fill', urgent: 'bg-over', high: 'bg-near-fill', warn: 'bg-near-fill', plain: 'bg-slate-300' };
const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', low: 'text-over', urgent: 'text-over', high: 'text-near', warn: 'text-near', plain: 'text-slate-700' };

export default function Now() {
  const { settings, history, events, nameOf } = useData();
  const { g, failed, reload } = useGlucose();
  const [logOpen, setLogOpen] = useState(false);
  const [logKind, setLogKind] = useState<'treatment' | 'insulin' | null>(null);
  // arriving from "a new meal from an earlier one" (?log=insulin): the insulin entry opens, its calculator taking the new meal's carbs
  const [params, setParams] = useSearchParams();
  useEffect(() => {
    if (params.get('log') !== 'insulin') return;
    setLogKind('insulin'); setLogOpen(true); setParams({}, { replace: true });
  }, [params, setParams]);
  const alerts = useAlerts();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 30000); return () => window.clearInterval(id); }, []);

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
  const sensor = g?.sensor?.started_at ? sensorLife(g.sensor.started_at, settings.sensor_days ?? 14, now) : null;

  // the last thing she ate: a meal or snack, or carbs logged on their own (e.g. with a dose), whichever is newest
  const lastMeal = useMemo(() => {
    const h = history.find((x) => x.total_carbs === null || x.total_carbs > 0 || x.lines.length > 0) ?? null;
    const c = events.find((e) => !e.deleted_at && e.kind === 'carbs' && e.carbs_g) ?? null;
    if (c && (!h || Date.parse(c.occurred_at) > Date.parse(h.eaten_at))) return { key: 'e' + c.id, name: c.note || t('كارب'), total_carbs: c.carbs_g!, eaten_at: c.occurred_at };
    return h ? { key: 'h' + h.id, name: h.name, total_carbs: h.total_carbs, eaten_at: h.eaten_at } : null;
  }, [history, events]);
  const lastInsulin = events.find((e) => e.kind === 'insulin' && !e.deleted_at) ?? null;

  // the page is one screen on a phone: the document itself does not scroll under it
  useEffect(() => {
    const lock = () => document.documentElement.classList.toggle('now-lock', window.innerWidth < 1024);
    lock(); window.addEventListener('resize', lock);
    return () => { window.removeEventListener('resize', lock); document.documentElement.classList.remove('now-lock'); };
  }, []);

  return (
    <main className="mx-auto flex h-[calc(100dvh-57px-env(safe-area-inset-bottom))] max-w-2xl flex-col gap-2 overflow-y-auto px-4 pb-2 pt-[max(4px,env(safe-area-inset-top))] lg:h-[100dvh] lg:max-w-3xl lg:px-8 lg:pb-6">
      <h1 className="sr-only">{t('الآن')}</h1>
      <TopBar alertCount={alerts.open.length} night={isNight(settings)} />

      {/* 1 · the current glucose, its direction, the change in 15 minutes and where it may head */}
      {notConnected ? (
        <Card className="flex shrink-0 items-center gap-3 !py-3">
          <img src={asset('04_objects/obj_cgm.svg')} alt="" className="h-10 w-10" />
          <p className="min-w-0 flex-1 font-bold">{t('اربط قراءات السكر الحية')}</p>
          <Link to="/cgm" className="flex min-h-[44px] items-center rounded-2xl bg-brand px-4 font-bold text-white">{t('ربط الآن')}</Link>
        </Card>
      ) : (
        <Card className="relative shrink-0 overflow-hidden !px-3.5 !py-2.5">
          <div className="flex items-center gap-2" style={{ paddingInlineEnd: GIRL_W - 14 }}>
            <span className={cx('h-2.5 w-2.5 shrink-0 rounded-full', TONE_DOT[sentence.tone])} />
            <span className={cx('min-w-0 flex-1 truncate text-[15.5px] font-bold', TONE_TEXT[sentence.tone])}>{g ? sentence.text : failed ? t('تعذّر تحميل القراءة') : '…'}</span>
          </div>
          <div style={{ paddingInlineEnd: GIRL_W - 8 }}>
            {latest && age?.state !== 'stale' ? (
              <div className={cx('flex items-center gap-2', age?.state === 'old' && 'opacity-50')}>
                <span className="num text-[46px] font-bold leading-[1.05] text-brand-num">{formatGlucose(latest.mg_dl, unit)}</span>
                <span className="text-brand-num"><TrendArrow trend={trend} libre={latest.trend} size={30} /></span>
                <span className="flex flex-col self-end pb-1 text-[13px] leading-tight text-slate-500"><span>{unitLabel(unit)}</span><span>{sinceText(latest.taken_at, now)}</span></span>
              </div>
            ) : latest ? (
              <p className="mt-1 text-[15px] text-near">{t('آخر قراءة')} <span className="num font-bold">{formatGlucose(latest.mg_dl, unit)}</span> {sinceText(latest.taken_at, now)}. {t('تحقق من جوال ليان والحساس.')}</p>
            ) : <div className="h-12" />}
            {latest && age?.state === 'fresh' && <TrendLine compact trend={trend} libre={latest.trend} unit={unit} className="truncate text-[13.5px] text-slate-600" />}
          </div>
          <CardGirl className="-bottom-1" />
        </Card>
      )}

      {/* 2 · the graph takes all the height that is left, and never less than about half the screen: on a short phone
          the cards below scroll instead of the graph shrinking */}
      {g?.connected ? <HomeChart live={g.readings} /> : <div className="min-h-0 flex-1" />}

      {/* 3 · what is still working, side by side */}
      {!notConnected && <ActiveCards now={now} />}

      {/* 4 · what was logged last; each opens that entry in the Log. The + sits beside them, covering nothing */}
      <div className="flex shrink-0 items-stretch gap-2">
        <LastCard to={lastMeal ? `/timeline?open=${lastMeal.key}` : '/timeline'} tone="carb" icon="meals" label={t('آخر أكل')}
          main={lastMeal ? <bdi>{tMaybe(lastMeal.name)}</bdi> : t('لا توجد وجبة مسجّلة')}
          sub={lastMeal ? <>{lastMeal.total_carbs === null ? t('الكارب غير معروف') : <b className="num">{t('{g} غ', { g: fmt(lastMeal.total_carbs) })}</b>} · {sinceText(lastMeal.eaten_at, now)}</> : null} />
        <LastCard to={lastInsulin ? `/timeline?open=e${lastInsulin.id}` : '/timeline'} tone="ins" icon="insulin" label={t('آخر جرعة')}
          main={lastInsulin ? <><span className="num">{fmt(lastInsulin.insulin_units ?? 0)}</span> {unitsWord(lastInsulin.insulin_units ?? 0)} · <span className="font-medium">{lastInsulin.insulin_type === 'long' ? t('طويل المفعول') : t('سريع')}</span></> : t('لا يوجد إنسولين مسجّل')}
          sub={lastInsulin ? <>{sinceText(lastInsulin.occurred_at, now)}{nameOf(lastInsulin.created_by) ? <> · <bdi>{nameOf(lastInsulin.created_by)}</bdi></> : null}</> : null} />
        <button onClick={() => setLogOpen(true)} aria-label={t('سجّل')} className={cx('grid h-12 w-12 shrink-0 self-center place-items-center rounded-full bg-brand text-white shadow-[0_6px_18px_rgba(91,72,214,0.30)] active:scale-[0.96]', logOpen && 'invisible')}>
          <Icon name="plus" size={24} />
        </button>
      </div>

      {/* 5 · one notice at most, the most important; the rest one tap away */}
      <NoticeRow now={now} open={alerts.open} sensor={sensor} error={g?.error ?? null} onRetry={reload} />
      {/* planned meals are told in the notice row; the sheets stay so a reminder's ?plan= link still opens its check */}
      <PlanLines sheetsOnly />

      <LogSheet open={logOpen} startKind={logKind} onClose={() => { setLogOpen(false); setLogKind(null); }} low={!!latest && Date.now() - Date.parse(latest.taken_at) < 20 * 60000 && latest.mg_dl <= (rng.low ?? 70) + 5} />
    </main>
  );
}

/** Insulin and carbs still on board, as two cards: how much, how long until the model says it is done, and a bar.
 *  Carbs on board are a model estimate and say so. Display only: nothing here is an amount to give. */
function ActiveCards({ now }: { now: number }) {
  const { settings: s, history, events } = useData();
  const doses = useMemo(() => dosesFrom(events), [events]);
  const carbs = useMemo(() => carbsFrom(history, events), [history, events]);
  const p = s.iob_dia_min && s.iob_peak_min ? { dia: s.iob_dia_min, peak: s.iob_peak_min } : null;
  const insOn = iobParamsOk(p), carbOn = !!s.cob_absorb_min;
  const ins = insOn ? insulinLane(doses, now, p!) : null;
  const cob = carbOn ? carbLane(carbs, now, s.cob_absorb_min!) : null;
  return (
    <div className="grid shrink-0 grid-cols-2 gap-2">
      <ActiveCard tone="ins" icon="insulin" label={t('الإنسولين النشط')} lane={ins} now={now} off={!insOn}
        num={ins ? ins.left.toFixed(2) : '0'} unit={t('وحدة')} empty={t('لا يوجد إنسولين نشط')} />
      <ActiveCard tone="carb" icon="meals" label={t('الكارب النشط')} tag={t('تقدير')} lane={cob} now={now} off={!carbOn}
        num={cob ? fmt(Math.round(cob.left)) : '0'} unit={t('غ')} empty={t('لا يوجد كارب نشط')} />
    </div>
  );
}

const TONES = {
  ins: { text: 'text-kins', bar: 'bg-kins', soft: 'bg-kins-soft', edge: 'border-kins/25' },
  carb: { text: 'text-kcarb', bar: 'bg-kcarb', soft: 'bg-kcarb-soft', edge: 'border-kcarb/25' },
} as const;

function ActiveCard({ tone, icon, label, tag, lane, now, num, unit, empty, off }: { tone: 'ins' | 'carb'; icon: IconName; label: string; tag?: string; lane: OnBoardLane | null; now: number; num: string; unit: string; empty: string; off: boolean }) {
  const c = TONES[tone];
  const frac = lane ? Math.min(1, Math.max(0, (lane.end - now) / (lane.end - lane.first))) : 0;
  return (
    <Link to="/status" className="min-w-0 rounded-2xl border border-slate-100 bg-white px-3 py-2 active:bg-slate-50">
      <span className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
        <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full', c.soft, c.text)}><Icon name={icon} size={12} /></span>
        <span className="min-w-0 truncate">{label}</span>
      </span>
      {lane ? (
        <>
          <span className="mt-0.5 flex items-baseline gap-1 truncate">
            <b className={cx('num text-[21px] leading-tight', c.text)} dir="ltr">{num}</b> <span className="text-[13px] text-slate-600">{unit}</span>
            {tag && <span className="ms-auto shrink-0 rounded-full bg-slate-100 px-1.5 text-[11px] font-medium text-slate-600">{tag}</span>}
          </span>
          <span dir="ltr" className={cx('mt-1 block h-1.5 overflow-hidden rounded-full', c.soft)} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label={label}>
            <span className={cx('block h-full rounded-full', c.bar)} style={{ width: `${frac * 100}%` }} />
          </span>
          <span className="mt-0.5 block truncate text-[12px] text-slate-500">{t('باقي {d}', { d: dur(lane.end - now) })}</span>
        </>
      ) : (
        <span className="mt-1 block truncate pb-3 text-[13.5px] text-slate-500">{off ? t('غير مفعّل في خطة الرعاية') : empty}</span>
      )}
    </Link>
  );
}

function LastCard({ to, tone, icon, label, main, sub }: { to: string; tone: 'ins' | 'carb'; icon: IconName; label: string; main: React.ReactNode; sub: React.ReactNode }) {
  const c = TONES[tone];
  return (
    <Link to={to} className={cx('min-w-0 flex-1 rounded-2xl border bg-white px-3 py-2 active:bg-slate-50', c.edge)}>
      <span className="flex items-center gap-1.5 text-[12.5px] text-slate-500">
        <span className={cx('grid h-5 w-5 shrink-0 place-items-center rounded-full', c.soft, c.text)}><Icon name={icon} size={12} /></span>
        <span className="min-w-0 truncate">{label}</span>
      </span>
      <span className="mt-0.5 block truncate text-[15px] font-bold">{main}</span>
      {sub && <span className="block truncate text-[12.5px] text-slate-600">{sub}</span>}
    </Link>
  );
}

type Notice = { key: string; tone: 'over' | 'near' | 'plain' | 'warm' | 'brand'; icon: IconName | null; emoji?: string; text: React.ReactNode; to?: string; onClick?: () => void; action?: string };
const NOTICE_TONE: Record<Notice['tone'], string> = {
  over: 'bg-over-soft text-over', near: 'bg-near-soft text-near', plain: 'bg-white text-slate-700 border border-slate-100',
  warm: 'bg-warm-soft text-slate-800', brand: 'bg-brand-soft text-brand',
};

/**
 * The notice row: only when there is something, only the most important one, the others behind «+N».
 * Order: a low (or one expected) → the sensor or missing readings → a high → the care plan's gap between doses →
 * planned meals → a fatty meal's late rise → the rest (the same meal before, setup). Nothing is decided here: every
 * alert still sounds and notifies as before; this row only tells what is open.
 */
function NoticeRow({ now, open, sensor, error, onRetry }: { now: number; open: AlertRowT[]; sensor: ReturnType<typeof sensorLife> | null; error: string | null; onRetry: () => void }) {
  const { settings: s, history, events, members, products } = useData();
  const { plans } = usePlans();
  const same = useRecentSame();
  const sp = useSearchParams()[1];
  const [more, setMore] = useState(false);
  const doses = useMemo(() => dosesFrom(events), [events]);

  const list: Notice[] = [];
  const lows = open.filter((a) => a.kind === 'urgent_low' || a.kind === 'low' || a.kind === 'predicted_low' || a.kind === 'rapid_fall');
  const rank = (k: string) => ['urgent_low', 'low', 'predicted_low', 'rapid_fall'].indexOf(k);
  for (const a of [...lows].sort((x, y) => rank(x.kind) - rank(y.kind))) list.push({ key: a.id, tone: 'over', icon: 'bell', text: <b>{ALERT_NAME[a.kind]}</b>, to: '/alerts' });
  if (error) list.push({ key: 'err', tone: 'over', icon: null, emoji: '📡', text: GLUCOSE_ERRORS[error] ?? error, onClick: onRetry, action: t('إعادة') });
  for (const a of open) if (a.kind === 'no_data' && s.alert_nodata_on !== false) list.push({ key: a.id, tone: 'near', icon: 'bell', text: <b>{ALERT_NAME[a.kind]}</b>, to: '/alerts' });
  if (sensor && sensor.state !== 'ok') list.push({ key: 'sensor', tone: sensor.state === 'ended' ? 'over' : 'near', icon: null, emoji: '🩹', text: sensor.state === 'ended' ? t('انتهى الحساس') : t('الحساس ينتهي {time}', { time: sinceUntil(sensor.left) }), to: '/status' });
  for (const a of open) if (a.kind === 'high' || a.kind === 'rapid_rise') list.push({ key: a.id, tone: 'near', icon: 'bell', text: <b>{ALERT_NAME[a.kind]}</b>, to: '/alerts' });
  const gap = doseGap(doses, now, s.dose_gap_min ?? 120);
  if (gap && gap.left > 0) list.push({ key: 'gap', tone: 'plain', icon: 'clock', text: t('فاصل الجرعات حسب الخطة: باقي {time}', { time: dur(gap.left) }) });
  for (const p of upcoming(plans, now)) {
    const l = phaseLine(p, phase(p, now), now);
    list.push({ key: 'plan' + p.id, tone: 'brand', icon: 'clock', text: <><bdi className="font-bold">{p.name}</bdi> · {l.text}</>, onClick: () => sp({ plan: p.id }, { replace: true }) });
  }
  const fat = recentFatty(history, now);
  if (fat) list.push({ key: 'fat', tone: 'warm', icon: null, emoji: '🍕', text: <>{t('وجبة دسمة')}: <bdi>{tMaybe(fat.name)}</bdi> · {t('قد يرتفع السكر متأخرًا حتى {time}', { time: fmtTime(new Date(fat.until)) })}</>, to: '/timeline' });
  if (same) list.push({ key: 'same', tone: 'brand', icon: null, emoji: '🔁', text: t('نفس وجبة سابقة'), to: `/same/${same.target.id}`, action: t('قارن') });
  const setup = [
    { done: settings_has(s.glucose_low_mgdl, s.glucose_high_mgdl), label: t('تحديد نطاق السكر من الطبيب'), to: '/doctor' },
    { done: settings_has(s.alert_low_mgdl, s.alert_urgent_low_mgdl), label: t('حدود التنبيهات وتفعيلها'), to: '/alerts' },
    { done: members.length >= 2, label: t('إضافة الأب أو الأم'), to: '/more' },
    { done: products.some((p) => p.kind === 'commercial' && p.approved), label: t('أول منتج من الملصق'), to: '/products/new' },
  ].filter((x) => !x.done);
  if (setup.length) list.push({ key: 'setup', tone: 'plain', icon: 'settings', text: <>{t('بقيت {n} خطوات للإعداد', { n: setup.length })} · {setup[0].label}</>, to: setup[0].to });

  if (!list.length) return null;
  const row = (n: Notice, first: boolean) => (
    <div key={n.key} className={cx('flex min-h-[44px] items-center gap-2 rounded-2xl px-3 text-[14px]', NOTICE_TONE[n.tone])}>
      {n.icon ? <Icon name={n.icon} size={16} className="shrink-0" /> : <span aria-hidden className="shrink-0">{n.emoji}</span>}
      {n.to ? <Link to={n.to} className="flex min-h-[44px] min-w-0 flex-1 items-center truncate">{n.text}</Link>
        : n.onClick && !n.action ? <button onClick={() => { setMore(false); n.onClick!(); }} className="flex min-h-[44px] min-w-0 flex-1 items-center truncate text-start">{n.text}</button>
          : <span className="min-w-0 flex-1 truncate">{n.text}</span>}
      {n.action && (n.onClick ? <button onClick={n.onClick} className="min-h-[44px] shrink-0 px-1 font-bold underline">{n.action}</button> : <span className="shrink-0 font-bold">{n.action}</span>)}
      {first && list.length > 1 && (
        <button onClick={() => setMore((m) => !m)} aria-expanded={more} aria-label={more ? t('إخفاء') : t('{n} تنبيهات أخرى', { n: list.length - 1 })}
          className="grid min-h-[44px] min-w-[44px] shrink-0 place-items-center"><span className="rounded-full bg-black/10 px-2 py-0.5 text-[12.5px] font-bold">{more ? '×' : `+${list.length - 1}`}</span></button>
      )}
    </div>
  );
  return (
    <section aria-label={t('تنبيهات')} className="relative shrink-0">
      {/* the rest open above the first, over the graph, so nothing else moves */}
      {more && (
        <div className="absolute inset-x-0 bottom-full z-30 mb-1.5 max-h-[50dvh] space-y-1.5 overflow-y-auto rounded-3xl bg-[rgb(var(--bg))] p-1.5 shadow-[0_-8px_24px_rgba(0,0,0,0.12)]">
          {list.slice(1).map((n) => row(n, false))}
        </div>
      )}
      {row(list[0], true)}
    </section>
  );
}
const settings_has = (a: number | null, b: number | null) => a !== null || b !== null;

const sinceUntil = (ms: number) => {
  const h = Math.floor(ms / 3600000), m = Math.floor((ms % 3600000) / 60000);
  return h > 0 ? t('خلال {h} س', { h }) : t('خلال {m} د', { m });
};

/** The top controls: the alerts bell, Simple | Advanced (this is Advanced), and the night screen in the evening. */
function TopBar({ alertCount, night }: { alertCount: number; night: boolean }) {
  const nav = useNavigate();
  const evening = night || new Date().getHours() >= 19;
  return (
    <header className="flex h-11 shrink-0 items-center justify-between">
      <Link to="/alerts" aria-label={alertCount ? t('التنبيهات: {n} مفتوح', { n: alertCount }) : t('التنبيهات')} className="relative grid h-11 w-11 place-items-center rounded-full text-slate-500">
        <Icon name="bell" size={24} />
        {alertCount > 0 && <span className="absolute end-2 top-1.5 h-2.5 w-2.5 rounded-full bg-over-fill ring-2 ring-[rgb(var(--bg))]" />}
      </Link>
      {/* the same switch as More → «افتح الوضع البسيط» */}
      <div role="group" aria-label={t('الوضع')} className="flex rounded-full bg-slate-100 p-0.5 text-[13.5px] font-bold">
        <button onClick={() => { setFullModeNow(false); nav('/mom'); }} className="min-h-[36px] rounded-full px-3 text-slate-500 active:opacity-80">{t('البسيط')}</button>
        <span aria-current="true" className="flex min-h-[36px] items-center rounded-full bg-white px-3 text-brand shadow-sm">{t('المتقدم')}</span>
      </div>
      {evening ? (
        <Link to="/night" aria-label={t('شاشة الليل')} className="grid h-11 w-11 place-items-center rounded-full text-slate-500"><Icon name="moon" size={22} /></Link>
      ) : <span className="w-11" />}
    </header>
  );
}

/** Layan, rising from the bottom corner of the glucose card and looking at the number (mirrored so she faces it in
 *  either reading direction). Decoration only: the text beside her keeps clear of her. */
const GIRL_W = 78, GIRL_H = Math.round(GIRL_W * 388 / 480);
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

const RANGES = [3, 6, 12, 24] as const;
/**
 * The live graph on Now: the same engine as Analysis (dots coloured by level, gaps left as breaks, the target band, the
 * insulin's working curve, what was logged on one row of icons, the dashed forecast ahead of now), as tall as the
 * screen leaves. Drag it back in time; tap a point or an icon to read it; «الآن» comes back; ⤢ opens it full size.
 */
function HomeChart({ live }: { live: Reading[] }) {
  const { settings, history, events } = useData();
  const nav = useNavigate();
  const [now, setNow] = useState(Date.now());
  const [following, setFollowing] = useState(true);
  const AHEAD = 0.25; // room for what is still working and the forecast lines
  const [view, setView] = useState<View>(() => ({ span: 3 * 3600000, end: limitEnd(Infinity, Date.now(), 3 * 3600000, AHEAD) }));
  const [picked, setPicked] = useState<Group | null>(null);
  const box = useRef<HTMLDivElement>(null);
  const [h, setH] = useState(0);
  useLayoutEffect(() => {
    const el = box.current!;
    const ro = new ResizeObserver(() => setH(el.clientHeight));
    ro.observe(el); setH(el.clientHeight);
    return () => ro.disconnect();
  }, []);
  useEffect(() => { const id = window.setInterval(() => setNow(Date.now()), 15000); return () => window.clearInterval(id); }, []);
  useEffect(() => { setNow(Date.now()); }, [live]);
  useEffect(() => { if (following) setView((v) => ({ span: v.span, end: limitEnd(Infinity, now, v.span, AHEAD) })); }, [now, following]);
  const onView = useCallback((v: View) => {
    // live = at (or within 2% of) the live edge, which sits AHEAD of now
    const t1 = Date.now(), isLive = v.end >= limitEnd(Infinity, t1, v.span, AHEAD) - v.span * 0.02;
    setFollowing(isLive);
    setView(isLive ? { span: v.span, end: limitEnd(Infinity, t1, v.span, AHEAD) } : v);
  }, []);
  const pick = (hours: number) => { const span = hours * 3600000; setFollowing(true); setView({ span, end: limitEnd(Infinity, Date.now(), span, AHEAD) }); };
  const { series, error: loadError, retry } = useSeries(view.end - view.span, view.end, live);
  const marks = useMemo(() => buildMarks(history, events), [history, events]);
  const layers = useMemo(() => defaultLayers(), []);
  const projected30 = useMemo(() => trendFrom(live, now)?.projected30 ?? null, [live, now]);
  // a forecast only from a fresh reading: from an old one it would read as more than it is
  const fresh = live.some((r) => now - Date.parse(r.taken_at) < 15 * 60000);
  const { tracks, forecasts } = useGraphExtras({ series, now, iob: false, cob: false, act: true, forecast: fresh, projected30: fresh ? projected30 : null, start: view.end - view.span, end: view.end });
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const hours = Math.round(view.span / 3600000);
  return (
    <section aria-label={t('رسم السكر')} className="relative -mx-4 flex min-h-[max(300px,42dvh)] flex-1 flex-col lg:mx-0">
      {loadError && <div className="mx-4 mb-1"><GraphLoadNotice error={loadError} empty={!series.t.length} retry={retry} /></div>}
      {/* range and full screen, in one row above the plot so nothing covers the data */}
      <div className="flex shrink-0 items-center gap-1 px-4">
        <div role="group" aria-label={t('المدة')} className="flex rounded-full bg-slate-100 p-0.5">
          {RANGES.map((r) => (
            <button key={r} onClick={() => pick(r)} aria-pressed={hours === r} className={cx('min-h-[32px] min-w-[44px] rounded-full px-2 text-[13px] font-bold', hours === r ? 'bg-white text-brand shadow-sm' : 'text-slate-500')}>
              {t('{n}س', { n: r })}
            </button>
          ))}
        </div>
        {!following && <button onClick={() => pick(hours || 3)} className="min-h-[32px] rounded-full bg-brand px-3 text-[13px] font-bold text-white">{t('الآن')}</button>}
        <span className="flex-1" />
        <GraphHelp tracks={false} act={!!tracks?.act} />
        <button onClick={() => nav('/analysis?wide=1')} aria-label={t('ملء الشاشة')} className="grid h-11 w-11 place-items-center rounded-full text-slate-500">
          <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" /></svg>
        </button>
      </div>
      <div ref={box} className="relative min-h-0 flex-1">
        {h > 60 && <Timeline series={series} view={view} now={now} onView={onView} unit={settings.glucose_unit} height={h + 48} compact
          range={rng} marks={marks} layers={layers} onSelect={setPicked} tracks={tracks} forecasts={forecasts} ahead={AHEAD} night={nightOf(settings)} />}
      </div>
      <EventSheet group={picked} series={series} onClose={() => setPicked(null)} />
    </section>
  );
}
