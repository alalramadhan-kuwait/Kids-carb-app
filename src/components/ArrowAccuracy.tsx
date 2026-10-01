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
        <p className="text-xs text-slate-500">{t('كل سهم يتوقع اتجاه الـ15 دقيقة التالية. قارنّاه بما حدث فعلًا: آخر {d} يومًا، لحظة كل 5 دقائق.', { d: DAYS })}</p>
      </div>
      <table className="w-full text-sm">
        <thead><tr className="text-xs text-slate-500"><th className="py-1 text-start font-medium" /><th className="w-20 text-center font-medium">{t('التطبيق')}</th><th className="w-20 text-center font-medium">Libre</th></tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map(([label, ours, libre]) => (
            <tr key={label} className="h-10">
              <td className="text-slate-600">{label}</td>
              <td className={cx('text-center', ours !== null && libre !== null && ours > libre && 'font-bold text-slate-900')}><span className="num">{pct(ours)}</span></td>
              <td className={cx('text-center', ours !== null && libre !== null && libre > ours && 'font-bold text-slate-900')}><span className="num">{pct(libre)}</span></td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-sm font-medium">
        {win === 'ours' ? t('الأدق حتى الآن: سهم التطبيق.') : win === 'libre' ? t('الأدق حتى الآن: سهم Libre.')
          : c.n < 50 ? t('نحتاج 50 لحظة على الأقل للحكم (الآن {n}).', { n: c.n }) : t('لا فرق واضح بعد ({n} لحظة).', { n: c.n })}
      </p>
      <p className="text-sm text-slate-600">{source === 'ours' ? t('الشاشات تعرض سهم التطبيق، وسهم Libre بجانبه إذا اختلف.') : t('الشاشات تعرض سهم Libre، وسهم التطبيق بجانبه إذا اختلف. تتحوّل تلقائيًا إذا صار سهم التطبيق أدق بوضوح.')}</p>
      <p className="text-xs text-slate-500">{t('المقارنة على درجات Libre الخمس؛ السهمان المزدوجان في التطبيق يُحسبان «سريعًا». الحاسبة تمنع الجرعة إذا قال أيّ من السهمين «ينزل بسرعة».')}</p>
    </Card>
  );
}
