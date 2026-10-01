import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { useGlucose } from '../hooks/useGlucose';
import { formatGlucose, glucoseAge, GLUCOSE_ERRORS, unitLabel, type GlucoseUnit, type Reading } from '../lib/glucose';
import { sinceText } from '../lib/now';
import { fmt } from '../lib/carbs';
import { kuwaitClock } from '../lib/schedule';
import { onBoard, sensorLife, type OnBoard } from '../engine/status';
import { Icon, TREND_ICON, TREND_WORDS } from '../components/Icon';
import { Card, Page, cx } from '../components/ui';
import { isEn, locale, t } from '../i18n';
import type { Settings } from '../lib/types';
import { usePredictions } from '../lib/predictions';
import { PredictionAccuracy } from '../components/PredictionAccuracy';

const MIN = 60000;
export const units2 = (u: number) => String(Math.round(u * 100) / 100);
const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const dayClock = (ms: number) => new Date(ms).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
/** an estimate is shown inside what the sensor can read, never as an exact low or high */
const shown = (mg: number, unit: GlucoseUnit) => (mg < 40 ? `< ${formatGlucose(40, unit)}` : mg > 400 ? `> ${formatGlucose(400, unit)}` : formatGlucose(mg, unit));

/** What is on board right now, recomputed each minute. Shared with the line on Now. */
export function useOnBoard(latest: Reading | null): OnBoard & { ready: boolean } {
  const { settings: s, history, events } = useData();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), MIN); return () => clearInterval(id); }, []);
  const o = onBoard({
    now, kuwaitMin: kuwaitClock(now).min,
    glucose: latest ? { mg: latest.mg_dl, at: Date.parse(latest.taken_at) } : null,
    history, events,
    iob: s.iob_dia_min && s.iob_peak_min ? { dia: s.iob_dia_min, peak: s.iob_peak_min } : null,
    absorbMin: s.cob_absorb_min, ratios: s.ratios ?? [],
  });
  return { ...o, ready: o.iob !== null || o.cob !== null };
}

/**
 * الحالة: Gluroo's status page, for Layan. The glucose now, what is still on board, a rough estimate once it is
 * used up (only with the doctor's ratios), the sensor's life and the connection. Every number here describes what
 * was logged; none is an amount to give.
 */
export default function Status() {
  const nav = useNavigate();
  const { settings: s, history, events } = useData();
  const { g, reload } = useGlucose();
  const latest = g?.latest ?? null;
  const o = useOnBoard(latest);
  const unit = s.glucose_unit;
  const predictions = usePredictions(g?.sensor?.started_at ? Date.parse(g.sensor.started_at) : null);
  const age = latest ? glucoseAge(latest.taken_at) : null;
  const lastMeal = history[0] ?? null;
  const lastDose = events.find((e) => e.kind === 'insulin' && e.insulin_type !== 'long') ?? null;
  const effect = (mg: number) => (unit === 'mmol' ? (Math.round((mg / 18.016) * 10) / 10).toFixed(1) : String(Math.round(mg)));
  const signed = (mg: number) => (mg >= 0 ? '+' : '−') + effect(Math.abs(mg));

  return (
    <Page title={t('الحالة')} back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="space-y-1">
          <h2 className="mb-1 font-bold">{t('في الجسم الآن')}</h2>
          <Row label={t('السكر الآن')} sub={latest ? sinceText(latest.taken_at) : ''}>
            {latest ? (
              <span className={cx('flex items-center gap-1', age?.state !== 'fresh' && 'opacity-50')}>
                <b className="num text-2xl text-brand-num">{formatGlucose(latest.mg_dl, unit)}</b>
                {latest.trend && <Icon name={TREND_ICON[latest.trend]} size={20} label={TREND_WORDS[latest.trend]} />}
              </span>
            ) : <span className="text-slate-500">—</span>}
          </Row>
          <Row sign="+" label={t('كارب ما زال يُمتص')} sub={lastMeal ? t('آخر أكل {when}', { when: sinceText(lastMeal.eaten_at) }) : ''}
            effect={o.est !== null && o.ratio && o.cob ? signed((o.cob / o.ratio.cr) * o.ratio.isf) : undefined}>
            {o.cob !== null ? <b className="num text-lg">{t('{g} غ', { g: fmt(o.cob) })}</b> : <Missing />}
          </Row>
          <Row sign="−" label={t('إنسولين سريع ما زال يعمل')} sub={lastDose ? t('آخر جرعة {when}', { when: sinceText(lastDose.occurred_at) }) : ''}
            effect={o.est !== null && o.ratio && o.iob ? signed(-o.iob * o.ratio.isf) : undefined}>
            {o.iob !== null ? <b className="num text-lg">{t('{u} وحدة', { u: units2(o.iob) })}</b> : <Missing />}
          </Row>
          <div className="!mt-2 border-t border-slate-200 pt-2">
            <Row sign="=" label={t('تقدير تقريبي بعد انتهائها')} sub={o.est !== null && o.estBy ? (o.estBy - Date.now() < MIN ? t('لا شيء نشط الآن') : t('حوالي {time}', { time: clock(o.estBy) })) : ''}>
              {o.est !== null ? <b className="num text-2xl text-slate-800">{shown(o.est, unit)}</b> : <span className="text-sm text-slate-500">—</span>}
            </Row>
          </div>
          <EstimateNote s={s} o={o} fresh={age?.state === 'fresh'} />
          <p className="!mt-3 rounded-xl bg-slate-50 p-2.5 text-xs leading-relaxed text-slate-600">
            {t('تقدير تقريبي من المسجّل فقط، ولا يعرف الرياضة ولا المرض ولا الأكل غير المسجّل. للجرعة استخدموا الحاسبة في «سجّل ← إنسولين».')}
          </p>
        </Card>

        <PredictionAccuracy rows={predictions} unit={unit} />

        <SensorCard startedAt={g?.sensor?.started_at ?? null} days={s.sensor_days ?? 14} connected={!!g?.connected} />

        <Card className="space-y-2">
          <h2 className="font-bold">{t('الاتصال')}</h2>
          <Fact label={t('آخر قراءة')}>{latest ? <><bdi>{clock(Date.parse(latest.taken_at))}</bdi> · <bdi>{sinceText(latest.taken_at)}</bdi></> : '—'}</Fact>
          <Fact label={t('آخر جلب ناجح من LibreLinkUp')}>{g?.last_ok_at ? sinceText(g.last_ok_at) : '—'}</Fact>
          {(g?.last_error || g?.error) && <p className="text-sm text-over">{GLUCOSE_ERRORS[(g.error ?? g.last_error)!] ?? g.error ?? g.last_error} <button className="min-h-[44px] underline" onClick={reload}>{t('إعادة')}</button></p>}
          <Link to="/cgm" className="flex min-h-[44px] items-center justify-between text-sm font-bold text-brand">{t('إعدادات الربط')}<span>{isEn() ? '›' : '‹'}</span></Link>
        </Card>
      </div>
    </Page>
  );
}

function Row({ sign, label, sub, effect, children }: { sign?: string; label: string; sub?: string; effect?: string; children: React.ReactNode }) {
  return (
    <div className="flex min-h-[48px] items-center gap-2">
      <span className="num w-4 shrink-0 text-center text-lg font-bold text-slate-400">{sign}</span>
      <span className="min-w-0 flex-1">
        <span className="block text-sm font-medium">{label}</span>
        {sub && <span className="block text-xs text-slate-500">{sub}</span>}
      </span>
      {effect && <span className="num shrink-0 text-xs text-slate-500" dir="ltr">{effect}</span>}
      <span className="shrink-0">{children}</span>
    </div>
  );
}
const Missing = () => <Link to="/settings" className="text-sm text-brand underline">{t('أضف من الإعدادات')}</Link>;
const Fact = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <p className="flex justify-between gap-3 text-sm"><span className="text-slate-600">{label}</span><span className="num text-end font-medium">{children}</span></p>
);

/** Why there is no estimate, or which of the doctor's numbers it used. */
function EstimateNote({ s, o, fresh }: { s: Settings; o: OnBoard; fresh: boolean }) {
  const unit = s.glucose_unit;
  if (o.ratio && o.est !== null)
    return (
      <p className="text-xs text-slate-500">
        {t('خطة الطبيب الآن (من {from}): كارب {cr} غ لكل وحدة · تصحيح {isf} {unit} لكل وحدة', { from: o.ratio.from, cr: fmt(o.ratio.cr), isf: formatGlucose(o.ratio.isf, unit), unit: unitLabel(unit) })}
      </p>
    );
  const why = !o.ratio ? t('أضيفوا نسبة الكارب ومعامل التصحيح من الطبيب في الإعدادات ليظهر التقدير.')
    : o.iob === null || o.cob === null ? t('أضيفوا مدة عمل الإنسولين وامتصاص الكارب في الإعدادات ليظهر التقدير.')
    : !fresh ? t('لا تقدير: آخر قراءة أقدم من 15 دقيقة.') : '';
  return why ? <p className="text-xs text-slate-500">{why}</p> : null;
}

function SensorCard({ startedAt, days, connected }: { startedAt: string | null; days: number; connected: boolean }) {
  const name = days === 15 ? 'Libre 2 Plus' : 'Libre 2';
  if (!startedAt)
    return (
      <Card className="space-y-1">
        <h2 className="font-bold">{t('الحساس')} · <span dir="ltr">{name}</span></h2>
        <p className="text-sm text-slate-500">{connected ? t('يظهر تاريخ البدء والانتهاء بعد الجلب التالي من LibreLinkUp.') : t('اربطوا قراءات السكر ليظهر عمر الحساس.')}</p>
      </Card>
    );
  const l = sensorLife(startedAt, days, Date.now());
  const d = Math.floor(l.left / 86400000), h = Math.floor((l.left % 86400000) / 3600000), m = Math.floor((l.left % 3600000) / 60000);
  const left = l.state === 'ended' ? t('انتهى الحساس') : d > 0 ? t('باقي {d} يوم و{h} س', { d, h }) : h > 0 ? t('باقي {h} س و{m} د', { h, m }) : t('باقي {m} د', { m });
  return (
    <Card className="space-y-2">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold">{t('الحساس')} · <span dir="ltr">{name}</span></h2>
        <span className={cx('text-sm font-bold', l.state === 'ok' ? 'text-slate-600' : 'text-slate-900')}>{left}</span>
      </div>
      <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(l.fraction * 100)} aria-valuemin={0} aria-valuemax={100}>
        <div className={cx('h-full rounded-full', l.state === 'ok' ? 'bg-brand' : 'bg-slate-700')} style={{ width: `${l.fraction * 100}%` }} />
      </div>
      <Fact label={t('بدأ')}>{dayClock(l.start)}</Fact>
      <Fact label={t('ينتهي')}>{dayClock(l.end)}</Fact>
      {l.warmup && <p className="text-xs text-slate-500">{t('الساعة الأولى تسخين: القراءات تبدأ بعدها وقد تكون أقل دقة في اليوم الأول.')}</p>}
      {l.state !== 'ok' && l.state !== 'ended' && <p className="text-sm font-medium">{t('جهّزوا حساسًا جديدًا. يصل تذكير للجوالات قبل يوم وقبل ساعتين.')}</p>}
      <p className="text-xs text-slate-500">{t('من LibreLinkUp. نوع الحساس (14 أو 15 يومًا) من الإعدادات.')}</p>
    </Card>
  );
}
