import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { glucoseStats, type GlucoseStats } from '../lib/api';
import { formatGlucose, glucoseAge, glucoseStatus, GLUCOSE_ERRORS, unitLabel, type Reading } from '../lib/glucose';
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
    <Page title="الآن">
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
                <span className="num text-[64px] font-bold leading-none">{formatGlucose(latest.mg_dl, unit)}</span>
                {latest.trend && <Icon name={TREND_ICON[latest.trend]} size={40} label={TREND_WORDS[latest.trend]} />}
                <span className="text-sm text-slate-500">{unitLabel(unit)}</span>
                <span className="ms-auto text-sm text-slate-500">{sinceText(latest.taken_at)}</span>
              </div>
            ) : latest ? (
              <p className="text-sm text-near">آخر قراءة <span className="num font-bold">{formatGlucose(latest.mg_dl, unit)}</span> {sinceText(latest.taken_at)}. تحقق من جوال ليان والحساس.</p>
            ) : null}
            {latest && age?.state !== 'stale' && status && (
              <span className={cx('mt-2 inline-flex items-center gap-1.5 rounded-full py-1 pe-3 ps-2 text-sm font-semibold', CHIP[status])}>
                <StatusIcon name={status} size={18} />{STATUS[status].label}
              </span>
            )}
            {g && <Graph readings={g.readings} low={settings.glucose_low_mgdl} high={settings.glucose_high_mgdl}
              meals={history.filter((h) => h.kind === 'meal').map((h) => h.eaten_at)}
              insulin={events.filter((e) => e.kind === 'insulin').map((e) => e.occurred_at)}
              carbs={events.filter((e) => e.kind === 'carbs' || e.kind === 'treatment').map((e) => e.occurred_at)} />}
            {g?.error && <p className="mt-1 text-sm text-over">{GLUCOSE_ERRORS[g.error] ?? g.error} <button className="underline" onClick={reload}>إعادة</button></p>}
          </Card>
        )}

        <Card className="space-y-2.5 !py-3">
          <Line icon="meals" text={lastMeal ? `${lastMeal.name} · ${fmt(lastMeal.total_carbs)}غ` : 'لا توجد وجبة مسجّلة'} when={lastMeal?.eaten_at} />
          <Line icon="insulin" text={lastInsulin ? describeEvent(lastInsulin) : 'لا يوجد إنسولين مسجّل'} when={lastInsulin?.occurred_at} who={lastInsulin ? nameOf(lastInsulin.created_by) : ''} />
          {lastTreatment && <Line icon="treatment" text={describeEvent(lastTreatment)} when={lastTreatment.occurred_at} who={nameOf(lastTreatment.created_by)} />}
        </Card>

        {today && today.n > 0 && (
          <Link to="/advanced" className="flex items-center gap-2 px-1 text-sm text-slate-600">
            <span>اليوم</span>
            <span className="flex h-2 flex-1 overflow-hidden rounded-full bg-slate-100" aria-hidden>
              <i style={{ width: `${today.pct_vlow + today.pct_low}%` }} className="bg-over-fill" />
              <i style={{ width: `${today.pct_in}%` }} className="bg-ok-fill" />
              <i style={{ width: `${today.pct_high + today.pct_vhigh}%` }} className="bg-near-fill" />
            </span>
            <span>ضمن النطاق <b className="num">{Math.round(today.pct_in)}%</b></span>
            {today.coverage < 70 && <span className="text-slate-400">· بيانات <span className="num">{Math.round(today.coverage)}%</span></span>}
          </Link>
        )}

        {doneCount < setup.length && (
          <Card className="space-y-2 !py-3">
            <div className="flex items-center justify-between text-sm font-bold"><span>إكمال الإعداد</span><span className="num text-slate-500">{doneCount}/{setup.length}</span></div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-brand" style={{ width: `${(doneCount / setup.length) * 100}%` }} /></div>
            <ul className="space-y-1">
              {setup.filter((s) => !s.done).map((s) => (
                <li key={s.label}><Link to={s.to} className="flex min-h-[40px] items-center gap-2 text-sm"><span className="h-4 w-4 rounded-full border-2 border-slate-300" />{s.label}<span className="ms-auto text-slate-300">‹</span></Link></li>
              ))}
            </ul>
          </Card>
        )}

        <p className="px-1 text-[11px] leading-relaxed text-slate-400">للعرض فقط وقد تتأخر عن الجهاز. القرارات والإنذارات من Libre أو Gluroo، وليس من هذا التطبيق.</p>
      </div>

      {/* Fitts: the main action is big and sits in the thumb zone, above the tab bar */}
      <div className="fixed inset-x-0 bottom-[calc(64px+env(safe-area-inset-bottom))] z-30 px-4 pb-3">
        <button onClick={() => setLogOpen(true)} className="mx-auto flex min-h-[56px] w-full max-w-2xl items-center justify-center gap-2 rounded-2xl bg-brand text-lg font-bold text-white shadow-lg">
          <Icon name="plus" size={24} /> سجّل
        </button>
      </div>
      <LogSheet open={logOpen} onClose={() => setLogOpen(false)} />
    </Page>
  );
}

function Line({ icon, text, when, who }: { icon: IconName; text: string; when?: string; who?: string }) {
  return (
    <div className="flex items-center gap-2.5">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={icon} size={18} /></span>
      <span className="min-w-0 flex-1 truncate font-medium">{text}</span>
      {when && <span className="shrink-0 text-sm text-slate-500">{sinceText(when)}{who ? ` · ${who}` : ''}</span>}
    </div>
  );
}

/** 3 hours, fixed window ending now. Gaps (> 20 min) are breaks, never joined. Markers show what happened. */
function Graph({ readings, low, high, meals, insulin, carbs }: { readings: Reading[]; low: number | null; high: number | null; meals: string[]; insulin: string[]; carbs: string[] }) {
  const W = 320, H = 110, PAD = 18;
  const t1 = Date.now(), t0 = t1 - 3 * 3600000;
  const pts = readings.map((r) => ({ t: new Date(r.taken_at).getTime(), v: r.mg_dl })).filter((p) => p.t >= t0);
  const bandLo = low ?? 70, bandHi = high ?? 180;
  const vals = pts.map((p) => p.v);
  const lo = Math.min(bandLo - 15, ...vals) - 5, hi = Math.max(bandHi + 15, ...vals) + 5;
  const x = (t: number) => ((t - t0) / (t1 - t0)) * W;
  const y = (v: number) => (H - PAD) - ((v - lo) / (hi - lo)) * (H - PAD - 4);
  const segs: string[][] = [];
  pts.forEach((p, i) => {
    if (i === 0 || p.t - pts[i - 1].t > 20 * 60000) segs.push([]);
    segs[segs.length - 1].push(`${x(p.t).toFixed(1)},${y(p.v).toFixed(1)}`);
  });
  const marks = (list: string[], icon: IconName) => list.map((iso) => new Date(iso).getTime()).filter((t) => t >= t0 && t <= t1).map((t) => (
    <g key={icon + t} transform={`translate(${x(t) - 7},${H - 15})`}>
      <circle cx="7" cy="7" r="8" fill="rgb(var(--surface))" stroke="rgb(var(--border-strong))" />
      <g transform="translate(1.6,1.6) scale(0.45)" fill="none" stroke="rgb(var(--text-2))" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round">
        {ICONS[icon].d.map((d) => <path key={d} d={d} />)}
      </g>
    </g>
  ));
  const last = pts[pts.length - 1];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="mt-3 w-full" role="img" aria-label="آخر 3 ساعات">
      <rect x="0" y={y(bandHi)} width={W} height={Math.max(0, y(bandLo) - y(bandHi))} fill="rgb(var(--st-in))" opacity="0.12" rx="4" />
      {segs.map((s, i) => s.length > 1
        ? <polyline key={i} points={s.join(' ')} fill="none" stroke="rgb(var(--primary-strong))" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" />
        : <circle key={i} cx={s[0].split(',')[0]} cy={s[0].split(',')[1]} r="2" fill="rgb(var(--primary-strong))" />)}
      {last && <circle cx={x(last.t)} cy={y(last.v)} r="4.5" fill="rgb(var(--primary-strong))" />}
      {marks(meals, 'meals')}{marks(insulin, 'insulin')}{marks(carbs, 'carbs')}
    </svg>
  );
}
