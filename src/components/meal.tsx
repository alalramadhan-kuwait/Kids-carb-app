import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, type Line, type MealResult } from '../lib/carbs';
import { logMeal } from '../lib/api';
import { useData } from '../lib/data';
import type { Recipe } from '../lib/types';
import { t, tMaybe } from '../i18n';
import { Btn, CarbBadge, Photo, cx, recipeArt, toast } from './ui';
import { KIND_STYLE } from '../lib/kinds';

export const lineName = (l: Line) => l.ing.label ?? l.product?.name ?? (l.ing.slot_category ? tMaybe(l.ing.slot_category) : t('؟'));

/** Log a meal, with the warning the parents asked for instead of a hard block. */
export function useChoose() {
  const { settings, reload } = useData();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async choose(input: { kind: 'meal' | 'snack'; recipe_id: string | null; name: string; category: string | null; meal: MealResult; modified: boolean }) {
      if (!input.meal.complete) { toast(t('لا يمكن التسجيل: الكارب غير مكتمل')); return false; }
      if (input.meal.total.carbs > settings.max_meal_carbs &&
        !confirm(t('هذه الوجبة {carbs}غ كارب وتتجاوز الحد ({max}غ). هل تريدون تسجيلها رغم ذلك؟', { carbs: fmt(input.meal.total.carbs), max: settings.max_meal_carbs }))) return false;
      setBusy(true);
      try {
        await logMeal(input);
        await reload();
        toast(t('تم التسجيل في السجل ✓'));
        return true;
      } catch (e) {
        toast(t('تعذّر التسجيل: {err}', { err: (e as Error).message }));
        return false;
      } finally { setBusy(false); }
    },
  };
}

/** One row per suggestion inside a shared list: photo, name, carbs, and a quiet pick button. The row opens the recipe. */
export function MealCard({ recipe, meal, chosenToday }: { recipe: Recipe; meal: MealResult; chosenToday?: boolean }) {
  const { choose, busy } = useChoose();
  return (
    <li className="flex items-center gap-3 px-3 py-2.5">
      <Link to={`/recipes/${recipe.id}`} className="flex min-w-0 flex-1 items-center gap-3">
        <Photo path={recipe.image_path} category={recipe.category} art={recipeArt(recipe.category)} className="h-12 w-12 shrink-0 rounded-xl" />
        <span className="min-w-0">
          <span className="block truncate font-bold">{recipe.name}</span>
          <span className="mt-1 block"><CarbBadge carbs={meal.total.carbs} level={meal.level} unknown={!meal.complete} size="sm" /></span>
        </span>
      </Link>
      <Btn kind="soft" className={cx('min-h-[44px] shrink-0 !px-4', KIND_STYLE.meal.soft)} disabled={busy || chosenToday}
        onClick={() => choose({ kind: 'meal', recipe_id: recipe.id, name: recipe.name, category: recipe.category, meal, modified: false })}>
        {chosenToday ? t('✓ اخترناها') : t('اخترناها')}
      </Btn>
    </li>
  );
}
