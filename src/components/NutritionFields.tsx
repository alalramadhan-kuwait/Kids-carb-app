import { fromPer100, type Nutr, type NutrState } from '../lib/per100';
import { fmt } from '../lib/carbs';
import { NumInput, cx } from './ui';
import { t } from '../i18n';

const KEYS: (keyof Nutr)[] = ['carbs', 'fat', 'protein', 'fiber', 'kcal'];
const label = (k: keyof Nutr) => ({ carbs: t('كارب'), fat: t('دهون'), protein: t('بروتين'), fiber: t('ألياف'), kcal: t('سعرات') })[k];
const num = '!min-h-[40px] !rounded-xl !px-1 !py-1.5 !text-center';

/**
 * The five nutrition values in one row, either for the serving or as printed on the label (per 100 ml / g)
 * with the amount, in which case the serving is worked out and shown underneath.
 */
export function NutritionFields({ s, set }: { s: NutrState; set: (s: NutrState) => void }) {
  const per = s.mode === 'per100';
  const vals = per ? s.per100 : s.serving;
  const put = (k: keyof Nutr, v: number | null) => set(per ? { ...s, per100: { ...s.per100, [k]: v } } : { ...s, serving: { ...s.serving, [k]: v } });
  // switching keeps what is known: a serving becomes per-100 values once an amount is given, and back
  const switchTo = (mode: NutrState['mode']) => {
    if (mode === s.mode) return;
    if (mode === 'serving') set({ ...s, mode, serving: s.amount ? fromPer100(s.per100, s.amount) : s.serving });
    else set({ ...s, mode });
  };
  const tot = fromPer100(s.per100, s.amount);
  return (
    <div className="space-y-1.5">
      <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-50 p-1 text-sm">
        {(['serving', 'per100'] as const).map((m) => (
          <button key={m} type="button" onClick={() => switchTo(m)} className={cx('min-h-[34px] rounded-lg font-medium', s.mode === m ? 'bg-white text-brand shadow-sm' : 'text-slate-500')}>
            {m === 'serving' ? t('للحصة') : t('لكل 100 من الملصق')}
          </button>
        ))}
      </div>
      <div className="grid grid-cols-5 gap-1.5">
        {KEYS.map((k) => (
          <label key={k} className="block min-w-0">
            <span className="mb-0.5 block truncate text-xs font-medium text-slate-500">{label(k)}</span>
            <NumInput className={num} value={vals[k]} onChange={(v) => put(k, v)} />
          </label>
        ))}
      </div>
      {per && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-sm text-slate-600">{t('الكمية')}</span>
          <NumInput className={cx(num, '!w-24')} value={s.amount} onChange={(v) => set({ ...s, amount: v })} />
          <div className="flex shrink-0 gap-1">
            {(['ml', 'g'] as const).map((u) => (
              <button key={u} type="button" onClick={() => set({ ...s, unit: u })} className={cx('min-h-[34px] rounded-lg px-3 text-sm font-medium', s.unit === u ? 'bg-brand text-white' : 'bg-slate-50 text-slate-600')}>{u === 'ml' ? t('مل') : t('غ')}</button>
            ))}
          </div>
        </div>
      )}
      {per && s.amount !== null && s.per100.carbs !== null && (
        <p className="rounded-xl bg-brand-soft px-3 py-1.5 text-sm text-brand">
          {t('للحصة ({a} {u}):', { a: fmt(s.amount), u: s.unit === 'ml' ? t('مل') : t('غ') })} <b className="num">{fmt(tot.carbs)}</b> {t('غ كارب')}
          {tot.kcal !== null && <> · <span className="num">{tot.kcal}</span> {t('سعرة')}</>}
        </p>
      )}
    </div>
  );
}

/** Initial state from stored values (a frequent food that kept its label, or plain serving values). */
export function nutrStateFrom(serving: Nutr, per100?: Nutr | null, amount?: number | null, unit?: 'ml' | 'g' | null): NutrState {
  return per100 && amount ? { mode: 'per100', serving, per100, amount, unit: unit ?? 'ml' }
    : { mode: 'serving', serving, per100: { carbs: null, fat: null, protein: null, fiber: null, kcal: null }, amount: null, unit: 'ml' };
}
