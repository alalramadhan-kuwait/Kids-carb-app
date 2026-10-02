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
        <p className="text-xs text-slate-500">{t('التقدير مقابل الحساس بعد كل وجبة · آخر 14 يومًا')}</p>
      </div>
      <div className="space-y-2.5">
        {acc.map((a) => {
          const pct = Math.round(a.within * 100);
          const lean = Math.abs(a.bias) < 9 ? null : a.bias > 0 ? 'up' : 'down';
          return (
            <div key={a.key} className="grid grid-cols-[4.5rem_1fr] items-center gap-x-3">
              <span className="text-sm font-medium">{label[a.key]}</span>
              {a.n >= MIN_N ? (
                <div className="min-w-0 space-y-1">
                  <div className="flex items-center gap-1.5 text-xs">
                    <b className="num text-base text-slate-900">±{formatGlucose(a.mae, unit)}</b>
                    <span className={cx('rounded-full px-1.5 py-0.5 font-medium', lean ? 'bg-slate-100 text-slate-700' : 'bg-ok-soft text-ok')}
                      title={lean === 'up' ? t('غالبًا أعلى من التقدير ({d})', { d: delta(a.bias, unit) }) : lean === 'down' ? t('غالبًا أقل من التقدير ({d})', { d: delta(a.bias, unit) }) : t('بلا ميل واضح')}>
                      {lean === 'up' ? '↑ ' : lean === 'down' ? '↓ ' : '≈'}{lean && <span className="num" dir="ltr">{delta(a.bias, unit)}</span>}
                    </span>
                    <span className="ms-auto text-slate-500">{t('{n} وجبة', { n: a.n })}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="h-2 flex-1 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={pct} aria-valuemin={0} aria-valuemax={100} aria-label={t('{p}% ضمن 1.0', { p: pct })}>
                      <div className="h-full rounded-full bg-brand-light" style={{ width: `${pct}%` }} />
                    </div>
                    <span className="num w-9 shrink-0 text-end text-xs font-medium text-slate-700">{pct}%</span>
                  </div>
                </div>
              ) : <span className="text-xs text-slate-500">{t('نحتاج {k} وجبات نظيفة على الأقل (الآن {n}).', { k: MIN_N, n: a.n })}</span>}
            </div>
          );
        })}
        {acc.some((a) => a.n >= MIN_N) && <p className="text-[11px] text-slate-500">{t('± متوسط الفرق · ↑↓ ميل الحساس عن التقدير · الشريط: نسبة ضمن 1.0')}</p>}
      </div>
      {rows.length > 0 && (
        <div className="space-y-1.5">
          <h3 className="text-sm font-bold text-slate-700">{t('آخر التقديرات')}</h3>
          <ul className="divide-y divide-slate-100 rounded-xl border border-slate-100">
            {rows.slice(0, 4).map((r) => <Row key={r.id} r={r} unit={unit} />)}
          </ul>
        </div>
      )}
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer">{t('كيف يُحسب؟')}</summary>
        <p className="mt-1 leading-relaxed">{t('تُحسب الوجبة فقط إذا لم يُسجَّل بعدها أكل أو جرعة أو رياضة أو علاج حتى نقطة المقارنة. أول يوم للحساس لا يُحسب. الفرق = الحساس − التقدير.')}</p>
      </details>
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
