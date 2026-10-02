import { useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { useComparisons, type ComparisonRow } from '../lib/fingerprick';
import { MIN_BIAS_TESTS, sensorProfile, type FpCause, type Group } from '../engine/fingerprick';
import { formatGlucose, type GlucoseUnit } from '../lib/glucose';
import { Card, Chip, Page, cx } from '../components/ui';
import { locale, t, tr } from '../i18n';

const CAUSE: Record<FpCause, string> = tr({ // i18n-ok: values translated when read
  agrees: 'متفقان', sensor_bias: 'فرق والسكر ثابت (قد يكون انحراف الحساس)', cgm_lag: 'تأخر الحساس عن الدم', // i18n-ok
  rapid_change: 'السكر يتغير بسرعة', compression: 'احتمال ضغط على الحساس (ليلًا)', insufficient: 'معلومات غير كافية', // i18n-ok
});
const QUALITY: Record<string, string> = tr({ good: 'جيدة', fair: 'متوسطة', poor: 'ضعيفة' }); // i18n-ok
const STATE: Record<string, string> = tr({ stable: 'ثابت', rising: 'يصعد', falling: 'ينزل', unknown: 'غير معروف' }); // i18n-ok
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const signed = (mg: number | null, unit: GlucoseUnit) => (mg === null ? '—' : (mg >= 0 ? '+' : '−') + formatGlucose(Math.abs(mg), unit));

/**
 * دقة الحساس: finger-pricks against Libre, per sensor. Not a calibration: nothing here changes a displayed
 * reading or a dose. It shows how far the sensor tends to be from blood, and when a difference was more likely
 * the sensor lagging behind a moving glucose than an error.
 */
export default function SensorAccuracy() {
  const nav = useNavigate();
  const { events, history, settings } = useData();
  const { rows, sensors } = useComparisons(events, history);
  const unit = settings.glucose_unit;
  const [sn, setSn] = useState<string | null>(null);
  const current = sn ?? sensors[0]?.sn ?? null;
  const mine = useMemo(() => (rows ?? []).filter((r) => r.sensor_sn === current), [rows, current]);
  const other = useMemo(() => (rows ?? []).filter((r) => !r.sensor_sn), [rows]);
  const prof = useMemo(() => sensorProfile(mine.map((r) => ({ ...r, bg: r.bg_mgdl }))), [mine]);
  const sensor = sensors.find((s) => s.sn === current);

  return (
    <Page title={t('دقة الحساس')} back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="space-y-2">
          <p className="text-sm text-slate-600">{t('وخز الإصبع يقيس سكر الدم، والحساس يقيس السائل تحت الجلد الذي يتأخر عن الدم بضع دقائق، أكثر عندما يتحرك السكر. لذلك نقارن كل وخز بقراءة Libre وقتها وبعد 5 و10 دقائق. هذا ليس معايرة: لا يغيّر الأرقام المعروضة ولا حاسبة الجرعة.')}</p>
        </Card>

        {sensors.length > 1 && (
          <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
            {sensors.map((s, i) => <Chip key={s.sn} active={s.sn === current} onClick={() => setSn(s.sn)}>{i === 0 ? t('الحالي') : new Date(s.started_at).toLocaleDateString(locale(), { day: 'numeric', month: 'short' })} · <span dir="ltr">{s.sn.slice(-4)}</span></Chip>)}
          </div>
        )}

        <Card className="space-y-3">
          <div className="flex items-baseline justify-between gap-2">
            <h2 className="font-bold">{t('الحساس')} <span dir="ltr" className="text-sm font-medium text-slate-500">{current ?? '—'}</span></h2>
            {sensor && <span className="text-xs text-slate-500">{t('بدأ {when}', { when: when(sensor.started_at) })}</span>}
          </div>
          <dl className="space-y-1.5 text-sm">
            <Fact label={t('عدد المقارنات')} value={String(prof.n)} />
            <Fact label={t('متوسط الفرق (Libre − الوخز)')} value={signed(prof.all.mean, unit)} />
            <Fact label={t('متوسط الفرق المطلق')} value={prof.all.mad === null ? '—' : formatGlucose(prof.all.mad, unit)} />
            <Fact label={t('متوسط الخطأ النسبي')} value={prof.all.mard === null ? '—' : `${Math.round(prof.all.mard)}%`} />
          </dl>
          <div className="rounded-xl bg-slate-50 p-3 text-sm">
            {prof.bias ? (
              <p><b>{prof.bias.mgdl < 0 ? t('يقرأ أقل من الوخز بنحو {v} والسكر ثابت', { v: formatGlucose(Math.abs(prof.bias.mgdl), unit) }) : t('يقرأ أعلى من الوخز بنحو {v} والسكر ثابت', { v: formatGlucose(prof.bias.mgdl, unit) })}</b>
                <span className="block text-xs text-slate-500">{t('من {n} مقارنات جيدة أثناء ثبات السكر، تشتت ±{sd}. تقدير أولي للبحث فقط.', { n: prof.bias.n, sd: formatGlucose(prof.bias.sd, unit) })}</span></p>
            ) : <p className="text-slate-600">{t('لا تقدير للانحراف بعد: نحتاج {k} مقارنات جيدة على الأقل أثناء ثبات السكر (الآن {n}).', { k: MIN_BIAS_TESTS, n: prof.goodStable.n })}</p>}
          </div>
          <h3 className="pt-1 text-sm font-bold">{t('حسب حالة السكر')}</h3>
          <GroupTable unit={unit} rows={[[t('ثابت'), prof.byState.stable], [t('يصعد'), prof.byState.rising], [t('ينزل'), prof.byState.falling]]} />
          {prof.byDay.length > 0 && <><h3 className="pt-1 text-sm font-bold">{t('حسب يوم الحساس')}</h3>
            <GroupTable unit={unit} rows={prof.byDay.map((d) => [t('اليوم {d}', { d: d.day }), d.g])} /></>}
        </Card>

        <Card className="space-y-2">
          <h2 className="font-bold">{t('كل المقارنات')}</h2>
          {mine.length === 0 && <p className="text-sm text-slate-500">{t('لا يوجد وخز لهذا الحساس بعد. سجّلوه من «سجّل ← وخز إصبع».')}</p>}
          <ul className="divide-y divide-slate-100">{[...mine, ...(current === sensors[0]?.sn ? other : [])].map((r) => <Test key={r.event_id} r={r} unit={unit} />)}</ul>
        </Card>
      </div>
    </Page>
  );
}

function Test({ r, unit }: { r: ComparisonRow; unit: GlucoseUnit }) {
  const g = (v: number | null) => (v === null ? '—' : formatGlucose(v, unit));
  return (
    <li className="space-y-1 py-2.5 text-sm">
      <div className="flex items-baseline justify-between gap-2">
        <span className="font-medium">{when(r.taken_at)}</span>
        <span className={cx('rounded-full px-2 py-0.5 text-xs', r.quality === 'good' ? 'bg-slate-100 text-slate-700' : 'bg-slate-100 text-slate-500')}>{t('جودة {q}', { q: QUALITY[r.quality] })}</span>
      </div>
      <div className="grid grid-cols-4 gap-1 text-center">
        {([[t('الوخز'), r.bg_mgdl], [t('Libre الآن'), r.libre_now], [t('+5 د'), r.libre_5], [t('+10 د'), r.libre_10]] as [string, number | null][]).map(([l, v], i) => (
          <span key={i} className={cx('rounded-lg py-1', i === 0 ? 'bg-slate-100 font-bold' : 'bg-slate-50')}><span className="block text-[11px] text-slate-500">{l}</span><span className="num">{g(v)}</span></span>
        ))}
      </div>
      <p className="text-xs text-slate-600">
        {t('الفرق {d}', { d: signed(r.diff_mgdl, unit) })}{r.diff_pct !== null ? ` (${r.diff_pct > 0 ? '+' : ''}${Math.round(r.diff_pct)}%)` : ''} · {STATE[r.state]}
        {r.rate !== null && <> · <span className="num" dir="ltr">{signed(r.rate * 15, unit)}</span>{t('/15 د')}</>}
        {r.sensor_day !== null && ` · ${t('اليوم {d}', { d: r.sensor_day })}`}
        {r.since_meal_min !== null && ` · ${t('أكل قبل {m} د', { m: r.since_meal_min })}`}
        {r.since_insulin_min !== null && ` · ${t('إنسولين قبل {m} د', { m: r.since_insulin_min })}`}
      </p>
      <p className="text-xs font-medium">{CAUSE[r.cause]}{!r.complete ? ` · ${t('بانتظار قراءات +10 د')}` : ''}</p>
    </li>
  );
}

const Fact = ({ label, value }: { label: string; value: string }) => (
  <div className="flex justify-between gap-3"><dt className="text-slate-600">{label}</dt><dd className="num font-medium">{value}</dd></div>
);
function GroupTable({ rows, unit }: { rows: [string, Group][]; unit: GlucoseUnit }) {
  return (
    <table className="w-full text-sm">
      <thead><tr className="text-xs text-slate-500"><th className="text-start font-medium" /><th className="font-medium">{t('العدد')}</th><th className="font-medium">{t('المتوسط')}</th><th className="font-medium">{t('الفرق المطلق')}</th></tr></thead>
      <tbody>{rows.map(([l, g]) => (
        <tr key={l} className="h-8"><td className="text-slate-600">{l}</td><td className="text-center"><span className="num">{g.n}</span></td>
          <td className="text-center"><span className="num">{signed(g.mean, unit)}</span></td><td className="text-center"><span className="num">{g.mad === null ? '—' : formatGlucose(g.mad, unit)}</span></td></tr>
      ))}</tbody>
    </table>
  );
}
