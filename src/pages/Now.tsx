import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { glucoseStats, type GlucoseStats } from '../lib/api';
import { formatGlucose, glucoseAge, glucoseStatus, GLUCOSE_ERRORS, unitLabel, type GlucoseUnit, type Reading } from '../lib/glucose';
import { kuwaitDayStart, sinceText, statusSentence, type Tone } from '../lib/now';
import { fmt } from '../lib/carbs';
import { ICONS, STATUS, type IconName } from '../icons/defs';
import { Icon, StatusIcon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { LogSheet } from '../components/LogSheet';
import { AlertStrip } from '../components/AlertStrip';
import { useAlerts } from '../hooks/useAlerts';
import { describeEvent } from '../lib/events';
import { Card, Page, asset, cx } from '../components/ui';

const TONE_DOT: Record<Tone, string> = { ok: 'bg-ok-fill', low: 'bg-over-fill', urgent: 'bg-over', high: 'bg-near-fill', warn: 'bg-near-fill', plain: 'bg-slate-300' };
const TONE_TEXT: Record<Tone, string> = { ok: 'text-ok', low: 'text-over', urgent: 'text-over', high: 'text-near', warn: 'text-near', plain: 'text-slate-700' };
const CHIP = { urgent_low: 'bg-over-soft text-over', low: 'bg-over-soft text-over', in_range: 'bg-ok-soft text-ok', high: 'bg-near-soft text-near', very_high: 'bg-near-soft text-near' } as const;

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
  const status = latest ? glucoseStatus(latest.mg_dl, settings.glucose_low_mgdl, settings.glucose_high_mgdl) : null;
  const sentence = statusSentence({ hasReading: !!latest, age: age?.state ?? null, status, trend: latest?.trend ?? null });

  const lastMeal = history.find((h) => h.kind === 'meal');
  const lastInsulin = events.find((e) => e.kind === 'insulin');
  const lastTreatment = events.find((e) => e.kind === 'treatment' && Date.now() - new Date(e.occurred_at).getTime() < 3 * 3600000);

  // Zeigarnik: a short list of what is still unset, until it is all done
  const setup = [
    { done: !!g?.connected, label: 'ربط قراءات السكر', to: '/cgm' },
    { done: settings.glucose_low_mgdl !== null || settings.glucose_high_mgdl !== null, label: 'تحديد نطاق السكر من الطبيب', to: '/settings' },
    { done: settings.alert_low_mgdl !== null || settings.alert_urgent_low_mgdl !== null, label: 'حدود التنبيهات وتفعيلها', to: '/alerts' },
    { done: members.length >= 2, label: 'إضافة الأب أو الأم', to: '/more' },
    { done: products.some((p) => p.kind === 'commercial' && p.approved), label: 'أول منتج من الملصق', to: '/products/new' },
  ];
  const doneCount = setup.filter((s) => s.done).length;

  return (
    <main className="mx-auto max-w-2xl px-4 pb-28 pt-[max(12px,env(safe-area-inset-top))]">
      <h1 className="sr-only">الآن</h1>
      <LayanHeader alertCount={alerts.open.length} />
      <div className="space-y-3 pb-24">
        <AlertStrip alerts={alerts.open} onChange={alerts.reload} />
        {g && !g.connected ? (
          <Link to="/cgm"><Card className="flex items-center gap-3 !p-3"><img src={asset('04_objects/obj_cgm.svg')} alt="" className="h-10 w-10" /><span className="flex-1 font-medium">اربط قراءات السكر الحية</span><span className="text-slate-300">‹</span></Card></Link>
        ) : (
          <Card>
            <div className={cx('mb-1 flex items-center gap-2 text-lg font-bold', TONE_TEXT[sentence.tone])}>
              <span className={cx('h-3 w-3 shrink-0 rounded-full', TONE_DOT[sentence.tone])} />{g ? sentence.text : failed ? 'تعذّر تحميل القراءة' : '…'}
            </div>
            {latest && age?.state !== 'stale' ? (
              <div className={cx('flex flex-wrap items-center gap-x-3', age?.state === 'old' && 'opacity-50')}>
                <span className="num text-[64px] font-bold leading-none text-brand-num">{formatGlucose(latest.mg_dl, unit)}</span>
                {latest.trend && <span className="text-brand-num"><Icon name={TREND_ICON[latest.trend]} size={40} label={TREND_WORDS[latest.trend]} /></span>}
                <span className="text-sm text-slate-500">{unitLabel(unit)}</span>
                <span className="ms-auto text-sm text-slate-500">{sinceText(latest.taken_at)}</span>
              </div>
            ) : latest ? (
              <p className="text-sm text-near">آخر قراءة <span className="num font-bold">{formatGlucose(latest.mg_dl, unit)}</span> {sinceText(latest.taken_at)}. تحقق من جوال ليان والحساس.</p>
            ) : null}
            {latest && age?.state !== 'stale' && status && status !== 'in_range' && (
              <span className={cx('mt-2 inline-flex items-center gap-1.5 rounded-full py-1 pe-3 ps-2 text-sm font-semibold', CHIP[status])}>
                <StatusIcon name={status} size={18} />{STATUS[status].label}
              </span>
            )}
            {g && <Link to="/analysis" aria-label="افتح الرسم الكامل" className="block"><Graph readings={g.readings} low={settings.glucose_low_mgdl} high={settings.glucose_high_mgdl}
              meals={history.filter((h) => h.kind === 'meal').map((h) => h.eaten_at)}
              insulin={events.filter((e) => e.kind === 'insulin').map((e) => e.occurred_at)}
              carbs={events.filter((e) => e.kind === 'carbs' || e.kind === 'treatment').map((e) => e.occurred_at)} unit={unit} /></Link>}
            {g?.error && <p className="mt-1 text-sm text-over">{GLUCOSE_ERRORS[g.error] ?? g.error} <button className="underline" onClick={reload}>إعادة</button></p>}
          </Card>
        )}

        <Card className="!p-0 overflow-hidden">
          <ul className="divide-y divide-slate-100">
            <Line icon="meals" text={lastMeal ? `${lastMeal.name} · ${fmt(lastMeal.total_carbs)} غ` : 'لا توجد وجبة مسجّلة'} when={lastMeal?.eaten_at} />
            <Line icon="insulin" text={lastInsulin ? describeEvent(lastInsulin) : 'لا يوجد إنسولين مسجّل'} when={lastInsulin?.occurred_at} who={lastInsulin ? nameOf(lastInsulin.created_by) : ''} />
            {lastTreatment && <Line icon="treatment" text={describeEvent(lastTreatment)} when={lastTreatment.occurred_at} who={nameOf(lastTreatment.created_by)} />}
          </ul>
        </Card>

        {today && today.n > 0 && (
          <Link to="/analysis?mode=stats" className="flex min-h-[44px] items-center gap-3 px-1 font-medium text-brand-num">
            <span>اليوم</span>
            <span className="flex h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <i style={{ width: `${today.pct_vlow + today.pct_low}%` }} className="bg-over-fill" />
              <i style={{ width: `${today.pct_in}%` }} className="bg-ok-fill" />
              <i style={{ width: `${today.pct_high + today.pct_vhigh}%` }} className="bg-near-fill" />
            </span>
            <span>ضمن النطاق <b className="num">{Math.round(today.pct_in)}%</b></span>
            {today.coverage < 70 && <span className="text-slate-400">· بيانات <span className="num">{Math.round(today.coverage)}%</span></span>}
          </Link>
        )}

        {doneCount < setup.length && (
          <Card className="space-y-3">
            <div className="flex items-center justify-between"><h2 className="text-lg font-bold text-brand">إكمال الإعداد</h2><span className="num text-lg font-semibold text-brand-num">{doneCount}/{setup.length}</span></div>
            <div className="h-2 overflow-hidden rounded-full bg-slate-50"><div className="h-full rounded-full bg-brand-light" style={{ width: `${(doneCount / setup.length) * 100}%` }} /></div>
            <ul>
              {setup.filter((s) => !s.done).map((s) => (
                <li key={s.label}><Link to={s.to} className="flex min-h-[48px] items-center gap-3 text-slate-600"><span className="h-6 w-6 shrink-0 rounded-full border-2 border-brand-muted" />{s.label}<span className="ms-auto text-slate-400">‹</span></Link></li>
              ))}
            </ul>
          </Card>
        )}

        <p className="px-1 text-[11px] leading-relaxed text-slate-400">للعرض فقط وقد تتأخر عن الجهاز. القرارات والإنذارات من Libre أو Gluroo، وليس من هذا التطبيق.</p>
      </div>

      {/* Fitts: the main action is big and sits in the thumb zone, above the tab bar */}
      <div className="pointer-events-none fixed inset-x-0 bottom-[calc(72px+env(safe-area-inset-bottom))] z-30 px-4">
        <div className="mx-auto flex max-w-2xl justify-start">
          <button onClick={() => setLogOpen(true)} className="pointer-events-auto flex min-h-[52px] items-center gap-2 rounded-full bg-brand pe-6 ps-5 text-lg font-bold text-white shadow-[0_8px_24px_rgba(91,72,214,0.30)] active:scale-[0.98]">
            <Icon name="plus" size={22} /> سجّل
          </button>
        </div>
      </div>
      <LogSheet open={logOpen} onClose={() => setLogOpen(false)} />
    </main>
  );
}

/**
 * Layan peeks over the glucose card; a few faint hearts around her only — never around the data.
 * The bell opens alerts (dot = an open alert), the profile opens More.
 */
function LayanHeader({ alertCount }: { alertCount: number }) {
  const heart = 'M12 20.5s-7.5-4.6-7.5-10A4.3 4.3 0 0 1 12 7.6a4.3 4.3 0 0 1 7.5 2.9c0 5.4-7.5 10-7.5 10z';
  const hearts: [number, number, number, number][] = [[-100, 30, 15, -12], [-90, 72, 12, 10], [80, 14, 14, 14], [94, 56, 17, -8]]; // dx from centre, y, size, rotation
  return (
    <header className="relative z-10 -mb-1 flex h-[120px] items-start justify-between">
      <Link to="/alerts" aria-label={alertCount ? `التنبيهات: ${alertCount} مفتوح` : 'التنبيهات'} className="relative grid h-12 w-12 place-items-center rounded-full text-slate-600">
        <Icon name="bell" size={30} />
        {alertCount > 0 && <span className="absolute end-2.5 top-2 h-2.5 w-2.5 rounded-full bg-over-fill ring-2 ring-[rgb(var(--bg))]" />}
      </Link>
      <div className="pointer-events-none absolute bottom-0 left-1/2 h-[120px] w-[156px] -translate-x-1/2" aria-hidden>
        {hearts.map(([dx, y, size, rot], i) => (
          <svg key={i} viewBox="0 0 24 24" width={size} height={size} className="absolute text-[#F49AB6] opacity-50"
            style={{ left: `calc(50% + ${dx}px)`, top: y, transform: `rotate(${rot}deg)` }}>
            <path d={heart} fill="currentColor" fillOpacity="0.35" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        ))}
        <picture>
          <source srcSet={asset('09_brand/layan_peek.webp')} type="image/webp" />
          <img src={asset('09_brand/layan_peek.png')} alt="" className="absolute bottom-0 left-0 w-full select-none" draggable={false} />
        </picture>
      </div>
      <Link to="/more" aria-label="الحساب والمزيد" className="grid h-12 w-12 place-items-center rounded-full text-slate-600">
        <Icon name="user" size={32} />
      </Link>
    </header>
  );
}

function Line({ icon, text, when, who }: { icon: IconName; text: string; when?: string; who?: string }) {
  return (
    <li><Link to="/timeline" className="flex min-h-[48px] items-center gap-3 px-4 py-1.5 active:bg-slate-50">
      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-brand-muted/70 text-brand"><Icon name={icon} size={19} /></span>
      <span className="min-w-0 flex-1 truncate font-medium">{text}</span>
      {when && <span className="shrink-0 text-sm text-slate-500">{sinceText(when)}{who ? ` · ${who}` : ''}</span>}
      <span className="text-slate-400">‹</span>
    </Link></li>
  );
}

/** 3 hours, fixed window ending now. Gaps (> 20 min) are breaks, never joined. Markers show what happened. */
function Graph({ readings, low, high, meals, insulin, carbs, unit }: { readings: Reading[]; low: number | null; high: number | null; meals: string[]; insulin: string[]; carbs: string[]; unit: GlucoseUnit }) {
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
  const hourLabel = (t: number) => { const h = new Date(t + KW).getUTCHours(); return `${h % 12 || 12} ${h < 12 ? 'ص' : 'م'}`; };
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
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="آخر 3 ساعات" direction="ltr">
      <rect x="0" y={TOP - 4} width={PW} height={PH + 8} rx="10" fill="rgb(var(--surface-2))" />
      {(low !== null || high !== null) && (
        <rect x="0" y={y(high ?? hi)} width={PW} height={Math.max(0, y(low ?? lo) - y(high ?? hi))} fill="rgb(var(--st-in))" opacity="0.14" />
      )}
      {ticks.map((v) => (
        <text key={v} x={W - 2} y={y(v) + 4} textAnchor="end" fontSize="10.5" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{formatGlucose(v, unit).replace(/\.0$/, '')}</text>
      ))}
      {hours.map((t) => x(t) > 12 && x(t) < PW - 12 && (
        <text key={t} x={x(t)} y={AX + 4} textAnchor="middle" fontSize="10.5" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui" direction="rtl">{hourLabel(t)}</text>
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
