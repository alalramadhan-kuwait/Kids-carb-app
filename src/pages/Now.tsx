import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { glucoseStats, type GlucoseStats } from '../lib/api';
import { effectiveRange, formatGlucose, glucoseAge, glucoseStatus, GLUCOSE_ERRORS, unitLabel, type GlucoseUnit, type Reading } from '../lib/glucose';
import { kuwaitDayStart, sinceText, statusSentence, type Tone } from '../lib/now';
import { fmt } from '../lib/carbs';
import { ICONS, type IconName } from '../icons/defs';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { LogSheet } from '../components/LogSheet';
import { AlertStrip } from '../components/AlertStrip';
import { VersionTag } from '../components/Version';
import { isNight, schoolWindow } from '../lib/schedule';
// imported (not from /public) so every new artwork gets a new hashed file name and phones never keep an old copy
import layanWebp from '../assets/layan_peek.webp';
import layanPng from '../assets/layan_peek.png';
import { useAlerts } from '../hooks/useAlerts';
import { describeEvent } from '../lib/events';
import { Card, asset, cx } from '../components/ui';
import { dir, isEn, t } from '../i18n';

const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok-fill', low: 'bg-over-fill', urgent: 'bg-over', high: 'bg-near-fill', warn: 'bg-near-fill', plain: 'bg-slate-300' };
const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', low: 'text-over', urgent: 'text-over', high: 'text-near', warn: 'text-near', plain: 'text-slate-700' };

export default function Now() {
  const { settings, history, events, nameOf, members, products } = useData();
  const { g, failed, reload } = useGlucose();
  const [logOpen, setLogOpen] = useState(false);
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
  const sentence = statusSentence({ hasReading: !!latest, age: age?.state ?? null, status, trend: latest?.trend ?? null });
  const notConnected = !!g && !g.connected;

  const lastMeal = history.find((h) => h.kind === 'meal');
  const lastInsulin = events.find((e) => e.kind === 'insulin');
  const lastTreatment = events.find((e) => e.kind === 'treatment' && Date.now() - new Date(e.occurred_at).getTime() < 3 * 3600000);

  // Zeigarnik + goal gradient: one compact line naming the next step; it leaves when everything is set.
  // Connecting the sensor is not repeated here while the glucose card itself asks for it.
  const setup = [
    { done: !!g?.connected || notConnected, label: t('ربط قراءات السكر'), to: '/cgm' },
    { done: settings.glucose_low_mgdl !== null || settings.glucose_high_mgdl !== null, label: t('تحديد نطاق السكر من الطبيب'), to: '/settings' },
    { done: settings.alert_low_mgdl !== null || settings.alert_urgent_low_mgdl !== null, label: t('حدود التنبيهات وتفعيلها'), to: '/alerts' },
    { done: members.length >= 2, label: t('إضافة الأب أو الأم'), to: '/more' },
    { done: products.some((p) => p.kind === 'commercial' && p.approved), label: t('أول منتج من الملصق'), to: '/products/new' },
  ];
  const left = setup.filter((s) => !s.done);

  return (
    <main className="mx-auto max-w-2xl px-4 pb-28 pt-[max(8px,env(safe-area-inset-top))]">
      <h1 className="sr-only">{t('الآن')}</h1>
      <LayanHeader alertCount={alerts.open.length} night={isNight(settings)} />
      <div className="space-y-4 pb-24">
        {/* the only things allowed above her glucose: alerts that need someone now */}
        <AlertStrip alerts={alerts.open} onChange={alerts.reload} />

        {/* 1 · Primary: the current glucose, its direction and a short status — or the one action that gets it */}
        {notConnected ? (
          <Card className="space-y-3 text-center">
            <img src={asset('04_objects/obj_cgm.svg')} alt="" className="mx-auto h-14 w-14" />
            <p className="text-lg font-bold">{t('اربط قراءات السكر الحية')}</p>
            <Link to="/cgm" className="flex min-h-[52px] items-center justify-center rounded-2xl bg-brand text-lg font-bold text-white">{t('ربط الآن')}</Link>
          </Card>
        ) : (
          <Card className="!pb-2">
            <div className="flex items-center gap-2">
              <span className={cx('h-3 w-3 shrink-0 rounded-full', TONE_DOT[sentence.tone])} />
              <span className={cx('text-lg font-bold', TONE_TEXT[sentence.tone])}>{g ? sentence.text : failed ? t('تعذّر تحميل القراءة') : '…'}</span>
              {latest && <span className="ms-auto text-sm text-slate-500">{sinceText(latest.taken_at)}</span>}
            </div>
            {latest && age?.state !== 'stale' ? (
              <div className={cx('mt-1 flex items-center gap-3', age?.state === 'old' && 'opacity-50')}>
                <span className="num text-[72px] font-bold leading-none text-brand-num">{formatGlucose(latest.mg_dl, unit)}</span>
                {latest.trend && <span className="text-brand-num"><Icon name={TREND_ICON[latest.trend]} size={44} label={TREND_WORDS[latest.trend]} /></span>}
                <span className="self-end pb-2 text-sm text-slate-500">{unitLabel(unit)}</span>
              </div>
            ) : latest ? (
              <p className="mt-1 text-sm text-near">{t('آخر قراءة')} <span className="num font-bold">{formatGlucose(latest.mg_dl, unit)}</span> {sinceText(latest.taken_at)}. {t('تحقق من جوال ليان والحساس.')}</p>
            ) : null}
            {g && <Link to="/analysis" aria-label={t('افتح الرسم الكامل')} className="block"><Graph readings={g.readings} low={rng.low} high={rng.high} reference={rng.reference}
              meals={history.filter((h) => h.kind === 'meal').map((h) => h.eaten_at)}
              insulin={events.filter((e) => e.kind === 'insulin').map((e) => e.occurred_at)}
              carbs={events.filter((e) => e.kind === 'carbs' || e.kind === 'treatment').map((e) => e.occurred_at)} unit={unit} /></Link>}
            {g?.error && <p className="mt-1 text-sm text-over">{GLUCOSE_ERRORS[g.error] ?? g.error} <button className="min-h-[44px] underline" onClick={reload}>{t('إعادة')}</button></p>}
          </Card>
        )}

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
          <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
            <Line icon="meals" text={lastMeal ? <><bdi>{lastMeal.name}</bdi> · {t('{g} غ', { g: fmt(lastMeal.total_carbs) })}</> : t('لا توجد وجبة مسجّلة')} when={lastMeal?.eaten_at} />
            <Line icon="insulin" text={lastInsulin ? describeEvent(lastInsulin) : t('لا يوجد إنسولين مسجّل')} when={lastInsulin?.occurred_at} who={lastInsulin ? nameOf(lastInsulin.created_by) : ''} />
            {lastTreatment && <Line icon="treatment" text={describeEvent(lastTreatment)} when={lastTreatment.occurred_at} who={nameOf(lastTreatment.created_by)} />}
            <SchoolLine />
          </ul>
        </section>

        {/* 3 · Secondary: setup, as a single reminder line */}
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

        <footer className="space-y-1 px-1 text-center text-[11px] leading-relaxed text-slate-400">
          <p>{t('للعرض فقط وقد تتأخر عن الجهاز. القرارات والإنذارات من Libre أو Gluroo، وليس من هذا التطبيق.')}</p>
          <VersionTag />
        </footer>
      </div>

      {/* Fitts: the one primary action, big, in the thumb zone above the tab bar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 px-4">
        <div className="mx-auto flex max-w-2xl justify-start">
          <button onClick={() => setLogOpen(true)} className="pointer-events-auto flex min-h-[56px] items-center gap-2 rounded-full bg-brand pe-6 ps-5 text-lg font-bold text-white shadow-[0_8px_24px_rgba(91,72,214,0.30)] active:scale-[0.98]">
            <Icon name="plus" size={24} /> {t('سجّل')}
          </button>
        </div>
      </div>
      <LogSheet open={logOpen} onClose={() => setLogOpen(false)} />
    </main>
  );
}

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
function LayanHeader({ alertCount, night }: { alertCount: number; night: boolean }) {
  const heart = 'M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z';
  const W = 116, H = 92; // artwork box
  const hearts: [number, number, number, number][] = [[-78, 24, 12, -12], [64, 10, 12, 14], [74, 46, 14, -8]]; // dx from centre, y, size, rotation
  const evening = night || new Date().getHours() >= 19;
  return (
    <header className="relative z-10 flex items-start justify-between" style={{ height: H }}>
      <Link to="/alerts" aria-label={alertCount ? t('التنبيهات: {n} مفتوح', { n: alertCount }) : t('التنبيهات')} className="relative grid h-11 w-11 place-items-center rounded-full text-slate-500">
        <Icon name="bell" size={26} />
        {alertCount > 0 && <span className="absolute end-2 top-1.5 h-2.5 w-2.5 rounded-full bg-over-fill ring-2 ring-[rgb(var(--bg))]" />}
      </Link>
      <div className="pointer-events-none absolute bottom-0 left-1/2 -translate-x-1/2" style={{ width: W, height: H }} aria-hidden>
        {hearts.map(([dx, y, size, rot], i) => (
          <svg key={i} viewBox="0 0 24 24" width={size} height={size} className="absolute text-[#F49AB6] opacity-50"
            style={{ left: `calc(50% + ${dx}px)`, top: y, transform: `rotate(${rot}deg)` }}>
            <path d={heart} fill="currentColor" fillOpacity="0.35" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        ))}
        <picture>
          <source srcSet={layanWebp} type="image/webp" />
          {/* the artwork's card edge sits at 95.5% of its height: her fingers hang over the card's top border */}
          <img src={layanPng} alt="" className="absolute left-0 w-full select-none" style={{ bottom: `calc(-0.0454 * ${W}px * 388 / 480)` }} draggable={false} />
        </picture>
      </div>
      {evening ? (
        <Link to="/night" aria-label={t('شاشة الليل')} className="grid h-11 w-11 place-items-center rounded-full text-slate-500">
          <Icon name="moon" size={24} />
        </Link>
      ) : <span className="h-11 w-11" />}
    </header>
  );
}

function Line({ icon, text, when, who }: { icon: IconName; text: React.ReactNode; when?: string; who?: string }) {
  return (
    <li><Link to="/timeline" className="flex min-h-[52px] items-center gap-3 px-4 py-1.5 active:bg-slate-50">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={icon} size={18} /></span>
      <span className="min-w-0 flex-1 truncate">{text}</span>
      {when && <span className="shrink-0 text-sm text-slate-500">{sinceText(when)}{who ? <> · <bdi>{who}</bdi></> : ''}</span>}
    </Link></li>
  );
}

/** 3 hours, fixed window ending now. Gaps (> 20 min) are breaks, never joined. Markers show what happened. */
function Graph({ readings, low, high, reference, meals, insulin, carbs, unit }: { readings: Reading[]; low: number | null; high: number | null; reference: boolean; meals: string[]; insulin: string[]; carbs: string[]; unit: GlucoseUnit }) {
  const W = 320, PW = 292, TOP = 6, PH = 62, AX = TOP + PH + 14, H = AX + 24; // plot width leaves a column for glucose labels
  const t1 = Date.now(), t0 = t1 - 3 * 3600000;
  const pts = readings.map((r) => ({ t: new Date(r.taken_at).getTime(), v: r.mg_dl })).filter((p) => p.t >= t0);
  const ticks = unit === 'mmol' ? [4, 10, 16].map((m) => m * 18.016) : [70, 180, 300];
  const lo = Math.min(ticks[0] - 10, ...pts.map((p) => p.v)), hi = Math.max(ticks[2] + 10, ...pts.map((p) => p.v));
  const x = (t: number) => ((t - t0) / (t1 - t0)) * PW;
  const y = (v: number) => TOP + PH - ((v - lo) / (hi - lo)) * PH;
  const segs: string[][] = [];
  pts.forEach((p, i) => {
    if (i === 0 || p.t - pts[i - 1].t > 20 * 60000) segs.push([]);
    segs[segs.length - 1].push(`${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
  });
  // hour labels in Kuwait time: 12 م, 1 م …
  const KW = 3 * 3600000, H1 = 3600000;
  const hours: number[] = []; for (let t = Math.ceil((t0 + KW) / H1) * H1 - KW; t <= t1; t += H1) hours.push(t);
  const hourLabel = (ts: number) => { const h = new Date(ts + KW).getUTCHours(); return `${h % 12 || 12} ${h < 12 ? t('ص') : t('م')}`; };
  const marks = (list: string[], icon: IconName) => list.map((iso) => new Date(iso).getTime()).filter((t) => t >= t0 && t <= t1).map((t) => (
    <g key={icon + t} transform={`translate(${x(t) - 7},${TOP + PH - 16})`}>
      <circle cx="7" cy="7" r="8" fill="rgb(var(--surface))" stroke="rgb(var(--primary-muted))" />
      <g transform="translate(1.6,1.6) scale(0.45)" fill="none" stroke="rgb(var(--primary-strong))" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[icon].d.map((d) => <path key={d} d={d} />)}
      </g>
    </g>
  ));
  const last = pts[pts.length - 1];
  const sparse = pts.length <= 24; // dots only when they are few enough to read as points
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label={t('آخر 3 ساعات')} direction="ltr">
      <rect x="0" y={TOP - 4} width={PW} height={PH + 8} rx="10" fill="rgb(var(--surface-2))" />
      {!reference ? (
        <rect x="0" y={y(high ?? hi)} width={PW} height={Math.max(0, y(low ?? lo) - y(high ?? hi))} fill="rgb(var(--st-in))" opacity="0.14" />
      ) : (
        // the reference range in use until the parents set hers: dashed and labelled so it is never taken for her own
        <g>
          <rect x="0" y={y(high!)} width={PW} height={y(low!) - y(high!)} fill="rgb(var(--st-in))" opacity="0.08" />
          <line x1="0" x2={PW} y1={y(high!)} y2={y(high!)} stroke="rgb(var(--st-in))" strokeOpacity="0.55" strokeDasharray="4 4" />
          <line x1="0" x2={PW} y1={y(low!)} y2={y(low!)} stroke="rgb(var(--st-in))" strokeOpacity="0.55" strokeDasharray="4 4" />
          <text x="4" y={y(high!) - 3} fontSize="9.5" fill="rgb(var(--st-in-text))" fillOpacity="0.85" fontFamily="Rubik, system-ui" direction={dir()} textAnchor={isEn() ? 'start' : 'end'}>{t('مرجعي {a} إلى {b}', { a: formatGlucose(low!, unit), b: formatGlucose(high!, unit) })}</text>
        </g>
      )}
      {ticks.map((v) => (
        <text key={v} x={W - 2} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{formatGlucose(v, unit).replace(/\.0$/, '')}</text>
      ))}
      {hours.map((ts) => x(ts) > 12 && x(ts) < PW - 12 && (
        <text key={ts} x={x(ts)} y={AX + 4} textAnchor="middle" fontSize="10.5" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui" direction={dir()}>{hourLabel(ts)}</text>
      ))}
      {segs.map((sg, i) => sg.length > 1
        ? <polyline key={i} points={sg.join(' ')} fill="none" stroke="rgb(var(--primary))" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        : <circle key={i} cx={sg[0].split(',')[0]} cy={sg[0].split(',')[1]} r="2.4" fill="rgb(var(--primary))" />)}
      {sparse && pts.map((p) => <circle key={p.t} cx={x(p.t)} cy={y(p.v)} r="2.6" fill="rgb(var(--surface))" stroke="rgb(var(--primary))" strokeWidth="1.8" />)}
      {last && <circle cx={x(last.t)} cy={y(last.v)} r="4.5" fill="rgb(var(--primary-strong))" stroke="rgb(var(--surface))" strokeWidth="1.5" />}
      {marks(meals, 'meals')}{marks(insulin, 'insulin')}{marks(carbs, 'carbs')}
    </svg>
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
