import { Link } from 'react-router-dom';
import { useGrowthNutrition, weighInDue, type CardTone } from '../lib/growth';
import { BALANCE_ISSUE, ENERGY_CHIP, GROWTH_REASON_SHORT } from './growthText';
import { cx } from './ui';
import { isEn, t } from '../i18n';

const TONE: Record<CardTone, string> = { ok: 'bg-ok-soft text-ok', attention: 'bg-near-soft text-near', neutral: 'bg-slate-100 text-slate-700', pending: 'bg-slate-100 text-slate-500' };

/**
 * On Now: "is anything about her growth and eating worth a look?" in at most three words-long chips. Green is one
 * word; amber names the thing; grey says what is still missing. Everything else is one tap away.
 */
export function GrowthCard() {
  const g = useGrowthNutrition();
  if (!g.ready) return null;
  const growth = g.growth.state === 'no_data' ? t('أضف الوزن والطول')
    : g.growth.state === 'attention' ? GROWTH_REASON_SHORT[g.growth.reasons[0]]
      : t('النمو ضمن المتوقع');
  const energy = ENERGY_CHIP[g.energy.d3];
  const bal = g.bal.d3.state === 'balanced' ? t('التوازن جيد') : g.bal.d3.state === 'attention' ? BALANCE_ISSUE[g.bal.d3.issues[0]] : t('التوازن: بيانات غير كافية');
  const due = g.measurements.length > 0 && weighInDue(g.measurements);
  return (
    <Link to="/growth" className="block rounded-2xl border border-slate-100 bg-white px-3 py-2.5 active:bg-slate-50">
      <span className="flex items-center justify-between text-sm font-bold text-slate-700">
        {t('النمو والتغذية')}
        <span className="flex items-center gap-2 text-xs font-normal text-slate-500">{due && t('موعد الوزن')}<span className="opacity-60">{isEn() ? '›' : '‹'}</span></span>
      </span>
      <span className="mt-1.5 flex flex-wrap gap-1.5 text-xs">
        <span className={cx('rounded-full px-2 py-0.5', TONE[g.card.growth])}>{growth}</span>
        <span className={cx('rounded-full px-2 py-0.5', TONE[g.card.energy])}>{energy}</span>
        <span className={cx('rounded-full px-2 py-0.5', TONE[g.card.balance])}>{bal}</span>
      </span>
    </Link>
  );
}
