import { useState } from 'react';
import { Link } from 'react-router-dom';
import { fmt, type Line, type MealResult } from '../lib/carbs';
import { logMeal } from '../lib/api';
import { useData } from '../lib/data';
import type { Recipe } from '../lib/types';
import { Btn, CarbBadge, Card, Photo, toast } from './ui';

export const lineName = (l: Line) => l.ing.label ?? l.product?.name ?? l.ing.slot_category ?? '؟';

export const mainNames = (meal: MealResult, n = 4) =>
  [...meal.lines].filter((l) => l.ing.role === 'main').sort((a, b) => (b.carbs ?? 0) - (a.carbs ?? 0)).slice(0, n).map(lineName).join(' • ');

/** Log a meal, with the warning the parents asked for instead of a hard block. */
export function useChoose() {
  const { settings, reload } = useData();
  const [busy, setBusy] = useState(false);
  return {
    busy,
    async choose(input: { kind: 'meal' | 'snack'; recipe_id: string | null; name: string; category: string | null; meal: MealResult; modified: boolean }) {
      if (!input.meal.complete) { toast('لا يمكن التسجيل: الكارب غير مكتمل'); return false; }
      if (input.meal.total.carbs > settings.max_meal_carbs &&
        !confirm(`هذه الوجبة ${fmt(input.meal.total.carbs)}غ كارب وتتجاوز الحد (${settings.max_meal_carbs}غ). هل تريدون تسجيلها رغم ذلك؟`)) return false;
      setBusy(true);
      try {
        await logMeal(input);
        await reload();
        toast('تم التسجيل في السجل ✓');
        return true;
      } catch (e) {
        toast('تعذّر التسجيل: ' + (e as Error).message);
        return false;
      } finally { setBusy(false); }
    },
  };
}

export function MealCard({ recipe, meal, chosenToday }: { recipe: Recipe; meal: MealResult; chosenToday?: boolean }) {
  const { choose, busy } = useChoose();
  return (
    <Card className="overflow-hidden !p-0">
      <Link to={`/recipes/${recipe.id}`}>
        <Photo path={recipe.image_path} category={recipe.category} className="h-40 w-full" />
      </Link>
      <div className="space-y-3 p-4">
        <div className="flex items-start justify-between gap-3">
          <h3 className="text-xl font-bold leading-snug">{recipe.name}</h3>
          <CarbBadge carbs={meal.total.carbs} level={meal.level} unknown={!meal.complete} />
        </div>
        <p className="text-sm text-slate-500">{mainNames(meal)}</p>
        <div className="grid grid-cols-2 gap-2">
          <Link to={`/recipes/${recipe.id}`} className="grid min-h-[44px] place-items-center rounded-xl bg-white text-base font-medium text-slate-700 ring-1 ring-slate-200">عرض الوصفة</Link>
          <Btn kind="primary" disabled={busy || chosenToday}
            onClick={() => choose({ kind: 'meal', recipe_id: recipe.id, name: recipe.name, category: recipe.category, meal, modified: false })}>
            {chosenToday ? 'اخترناها ✓' : 'اخترناها اليوم'}
          </Btn>
        </div>
      </div>
    </Card>
  );
}
