import { useEffect, useState } from 'react';
import { arrowWinner, type ArrowComparison } from '../engine/trend';
import { arrowSource, refreshArrowChoice, type ArrowSource } from '../lib/arrowChoice';
import { Card, cx } from './ui';
import { t } from '../i18n';

const DAYS = 14;

/** أي سهم أدق؟ Libre's arrow and the app's, each scored against what the next 15 minutes actually did. */
export function ArrowAccuracy() {
  const [c, setC] = useState<ArrowComparison | null>(null);
  const [source, setSource] = useState<ArrowSource>(arrowSource);
  useEffect(() => {
    let live = true;
    refreshArrowChoice(true).then((x) => { if (live) { setC(x.c); setSource(x.source); } }).catch(() => {});
    return () => { live = false; };
  }, []);
  if (!c) return null;
  const win = arrowWinner(c);
  const pct = (x: number | null) => (x === null ? '—' : `${Math.round(x * 100)}%`);
  const rows: [string, number | null, number | null][] = [
    [t('مطابق تمامًا'), c.ours.exact, c.libre.exact],
    [t('ضمن درجة واحدة'), c.ours.within1, c.libre.within1],
    [t('التقط التغيّر السريع ({n})', { n: c.fastN }), c.ours.fastCaught, c.libre.fastCaught],
  ];
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="font-bold">{t('أي سهم أدق؟')}</h2>
        <p className="text-xs text-slate-500">{t('السهم مقابل ما حدث في الـ15 دقيقة التالية · آخر {d} يومًا', { d: DAYS })}</p>
      </div>
      <div className="flex items-center gap-3 text-xs text-slate-600">
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-brand" />{t('التطبيق')}</span>
        <span className="flex items-center gap-1"><span className="h-2.5 w-2.5 rounded-sm bg-slate-400" />Libre</span>
      </div>
      <div className="space-y-3">
        {rows.map(([label, ours, libre]) => (
          <div key={label} className="space-y-1">
            <div className="text-xs text-slate-600">{label}</div>
            {([['ours', ours, 'bg-brand', t('التطبيق')], ['libre', libre, 'bg-slate-400', 'Libre']] as const).map(([k, v, cls, name]) => (
              <div key={k} className="flex items-center gap-2" title={`${name} ${pct(v)}`}>
                <div className="h-2.5 flex-1 overflow-hidden rounded-full bg-slate-100">
                  <div className={cx('h-full rounded-full', cls)} style={{ width: `${(v ?? 0) * 100}%` }} />
                </div>
                <span className={cx('num w-10 shrink-0 text-end text-xs', ours !== null && libre !== null && (k === 'ours' ? ours > libre : libre > ours) ? 'font-bold text-slate-900' : 'text-slate-600')}>{pct(v)}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="text-sm font-medium">
        {win === 'ours' ? t('الأدق حتى الآن: سهم التطبيق.') : win === 'libre' ? t('الأدق حتى الآن: سهم Libre.')
          : c.n < 50 ? t('نحتاج 50 لحظة على الأقل للحكم (الآن {n}).', { n: c.n }) : t('لا فرق واضح بعد ({n} لحظة).', { n: c.n })}
      </p>
      <p className="text-sm text-slate-600">{source === 'ours' ? t('الشاشات تعرض سهم التطبيق، وسهم Libre بجانبه إذا اختلف.') : t('الشاشات تعرض سهم Libre، وسهم التطبيق بجانبه إذا اختلف. تتحوّل تلقائيًا إذا صار سهم التطبيق أدق بوضوح.')}</p>
      <details className="text-xs text-slate-500">
        <summary className="cursor-pointer">{t('كيف يُحسب؟')}</summary>
        <p className="mt-1 leading-relaxed">{t('المقارنة على درجات Libre الخمس؛ السهمان المزدوجان في التطبيق يُحسبان «سريعًا». الحاسبة تمنع الجرعة إذا قال أيّ من السهمين «ينزل بسرعة».')}</p>
      </details>
    </Card>
  );
}
