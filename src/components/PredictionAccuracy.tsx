import { accuracy, checkMinutes, type Check, type CheckKey } from '../engine/predict';
import type { PredictionRow } from '../lib/predictions';
import { formatGlucose, type GlucoseUnit } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import { Card, cx } from './ui';
import { locale, t, tMaybe } from '../i18n';

const MIN_N = 3;
const when = (iso: string) => new Date(iso).toLocaleString(locale(), { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const delta = (mg: number, unit: GlucoseUnit) => (mg >= 0 ? '+' : '−') + formatGlucose(Math.abs(mg), unit);

/** دقة التقدير: how far the frozen predictions landed from the sensor, at 1 h, 2 h and the end. */
export function PredictionAccuracy({ rows, unit }: { rows: PredictionRow[] | null; unit: GlucoseUnit }) {
  if (!rows) return null;
  const acc = accuracy(rows);
  const label: Record<CheckKey, string> = { '60': t('بعد ساعة'), '120': t('بعد ساعتين'), end: t('النهاية') };
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-bold">{t('دقة التقدير')}</h2>
        <p className="text-xs text-slate-500">{t('عند كل وجبة يُحفظ التقدير الأول، ثم يُقارن بالحساس. آخر 14 يومًا.')}</p>
      </div>
      <dl className="divide-y divide-slate-100">
        {acc.map((a) => (
          <div key={a.key} className="flex min-h-[44px] items-center gap-3 py-1.5">
            <dt className="w-20 shrink-0 text-sm font-medium">{label[a.key]}</dt>
            {a.n >= MIN_N ? (
              <dd className="min-w-0 flex-1 text-sm">
                <b className="num">±{formatGlucose(a.mae, unit)}</b> <span className="text-slate-600">{t('متوسط الفرق')}</span>
                <span className="block text-xs text-slate-500">
                  {Math.abs(a.bias) < 9 ? t('بلا ميل واضح') : a.bias > 0 ? t('غالبًا أعلى من التقدير ({d})', { d: delta(a.bias, unit) }) : t('غالبًا أقل من التقدير ({d})', { d: delta(a.bias, unit) })}
                  {' · '}{t('{p}% ضمن 1.0', { p: Math.round(a.within * 100) })}{' · '}{t('{n} وجبة', { n: a.n })}
                </span>
              </dd>
            ) : <dd className="flex-1 text-sm text-slate-500">{t('نحتاج {k} وجبات نظيفة على الأقل (الآن {n}).', { k: MIN_N, n: a.n })}</dd>}
          </div>
        ))}
      </dl>
      {rows.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-bold text-slate-700">{t('آخر التقديرات')}</h3>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {rows.slice(0, 6).map((r) => <Row key={r.id} r={r} unit={unit} />)}
          </ul>
        </div>
      )}
      <p className="text-xs leading-relaxed text-slate-500">{t('تُحسب الوجبة فقط إذا لم يُسجَّل بعدها أكل أو جرعة أو رياضة أو علاج حتى نقطة المقارنة. أول يوم للحساس لا يُحسب. الفرق = الحساس − التقدير.')}</p>
    </Card>
  );
}

function Row({ r, unit }: { r: PredictionRow; unit: GlucoseUnit }) {
  const what = r.name ? tMaybe(r.name) : r.carbs > 0 ? t('{g} غ كارب', { g: fmt(r.carbs) }) : t('جرعة تصحيح');
  return (
    <li className="space-y-1 px-3 py-2">
      <div className="flex items-baseline gap-2 text-sm">
        <bdi className="min-w-0 flex-1 truncate font-medium">{what}</bdi>
        <span className="shrink-0 text-xs text-slate-500">{when(r.t0)}</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {checkMinutes(r.end_min).map(([k, m]) => <Chip key={k} min={m} c={r.checks[k]} unit={unit} />)}
        {r.excluded && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{t('أول يوم للحساس')}</span>}
      </div>
    </li>
  );
}

function Chip({ min, c, unit }: { min: number; c?: Check; unit: GlucoseUnit }) {
  const h = t('{h} س', { h: Math.round((min / 60) * 10) / 10 });
  if (!c) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{h} · {t('بانتظار')}</span>;
  if ('skip' in c) return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-400">{h} · {c.skip === 'other_entry' ? t('تسجيل آخر') : t('لا قراءة')}</span>;
  const err = c.actual - c.pred;
  return (
    <span className={cx('rounded-full px-2 py-0.5 text-xs', Math.abs(err) <= 18 ? 'bg-slate-100 text-slate-700' : 'bg-slate-200 font-bold text-slate-900')}>
      {h} · <span className="num">{formatGlucose(c.pred, unit)} → {formatGlucose(c.actual, unit)}</span>{/* estimate → sensor, left to right in both languages */}
    </span>
  );
}
