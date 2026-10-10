// Shown on every dose screen when she ate food whose carbs are not known in the last few hours: the number on the
// screen does not include it. A warning, not a block: what to do is the parents' and the doctor's decision.
import { fmtTime } from '../lib/constants';
import { t } from '../i18n';
import { mealTitle } from '../lib/unknownMeal';
import type { HistoryEntry } from '../lib/types';

export function UnknownMealNote({ meal, big }: { meal: Pick<HistoryEntry, 'name' | 'eaten_at' | 'foods'> | null; big?: boolean }) {
  if (!meal) return null;
  return (
    <p role="note" className={big ? 'rounded-2xl bg-near-soft px-4 py-3 text-center text-[17px] font-bold text-near' : 'rounded-xl bg-near-soft px-3 py-2 text-sm font-bold text-near'}>
      ⚠️ {t('أكلت {what} الساعة {at} والكارب غير معروف: هذا الحساب ما يشمله.', { what: mealTitle(meal), at: fmtTime(new Date(Date.parse(meal.eaten_at))) })}
    </p>
  );
}
