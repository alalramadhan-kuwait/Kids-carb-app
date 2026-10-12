// The glycemic index of a food, and the glycemic load of a meal, as a small coloured word. Information only: the
// carbs still come from the label and the dose never changes with it (engine/gi.ts).
import { giOf, type GiBand, type GiFood, type MealGi } from '../engine/gi';
import { t } from '../i18n';
import { cx } from './ui';

const TONE: Record<GiBand, string> = { low: 'bg-ok-soft text-ok', mid: 'bg-near-soft text-near', high: 'bg-over-soft text-over' };
const WORD: Record<GiBand, () => string> = { low: () => t('منخفض'), mid: () => t('متوسط'), high: () => t('عالي') };

/** «GI منخفض 36 · تقريبي» for one food; nothing when it has no GI or too little carbohydrate to have one. */
export function GiBadge({ food, big }: { food: GiFood | null | undefined; big?: boolean }) {
  const g = giOf(food);
  if (!g) return null;
  return (
    <span className={cx('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 font-bold', TONE[g.band], big ? 'text-[15px]' : 'text-xs')}>
      {t('مؤشر جلايسيمي {w}', { w: WORD[g.band]() })} <span className="num" dir="ltr">{g.gi}</span>
      {g.approx && <span className="font-normal opacity-80">· {g.estimate ? t('تقديري') : t('تقريبي')}</span>}
    </span>
  );
}

/** A meal: how fast its carbs act overall (its GI, weighted by carbs), and the load as a plain number. The load's
 *  low/high words are for one serving, so a whole meal is not judged by them. */
export function MealGiLine({ m, big }: { m: MealGi | null; big?: boolean }) {
  if (!m) return null;
  return (
    <div className={cx('space-y-0.5 px-1', big ? 'text-[16px]' : 'text-sm')}>
      <div className="flex items-center justify-between gap-2">
        <span className="text-slate-500">{t('سرعة الكارب في الوجبة')}</span>
        <GiBadge food={{ gi: m.gi, gi_match: m.approx ? 'similar' : 'exact' }} big={big} />
      </div>
      <div className={cx('text-slate-400', big ? 'text-[14px]' : 'text-xs')}>{t('الحمل الجلايسيمي {gl}', { gl: m.gl })}</div>
    </div>
  );
}
