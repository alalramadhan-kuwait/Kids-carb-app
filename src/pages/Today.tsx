import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { blocker, suggest } from '../lib/suggest';
import { computeSnack, fmt, PROBLEM_TEXT } from '../lib/carbs';
import { dayName, fmtDate, fmtTime, relDay, sameDay } from '../lib/constants';
import { Alert, Btn, Card, Page, Photo, CarbBadge } from '../components/ui';
import { MealCard, useChoose } from '../components/meal';

const SHUFFLE_KEY = 'kc-shuffle';
const readShuffle = () => { try { const v = JSON.parse(localStorage.getItem(SHUFFLE_KEY) ?? 'null'); return v?.day === new Date().toDateString() ? Number(v.n) : 0; } catch { return 0; } };

export default function Today() {
  const { candidates, history, settings, snacks, products, recipes } = useData();
  const [shuffle, setShuffle] = useState(readShuffle);
  const { choose, busy } = useChoose();
  const today = new Date();

  const picks = useMemo(() => suggest({ candidates, history, settings, today: new Date(), shuffle }), [candidates, history, settings, shuffle]);
  const chosenToday = new Set(history.filter((h) => h.kind === 'meal' && sameDay(new Date(h.eaten_at), today)).map((h) => h.recipe_id));
  const last = history.find((h) => h.kind === 'meal');

  // what is standing between the parents and more suggestions
  const missing = useMemo(() => {
    const m = new Map<string, number>();
    const pending: string[] = [];
    for (const c of candidates) {
      if (!c.recipe.approved) continue;
      if (c.recipe.carb_pending) pending.push(c.recipe.name);
      for (const l of c.meal.lines) if (l.problem) {
        const key = `${l.ing.slot_category ?? l.ing.label ?? l.product?.name}|${l.problem}`;
        m.set(key, (m.get(key) ?? 0) + 1);
      }
    }
    return { items: [...m].sort((a, b) => b[1] - a[1]), pending };
  }, [candidates]);

  const more = () => {
    const n = shuffle + 1; setShuffle(n);
    try { localStorage.setItem(SHUFFLE_KEY, JSON.stringify({ day: new Date().toDateString(), n })); } catch { /* private mode */ }
  };
  const eligible = candidates.filter((c) => blocker(c, settings) === null).length;

  return (
    <Page title="اليوم">
      <p className="-mt-2 mb-4 text-slate-500">{dayName(today)} {fmtDate(today)}</p>

      <h2 className="mb-2 text-lg font-bold">وجبات اليوم</h2>
      <div className="space-y-4">
        {picks.map((c) => <MealCard key={c.recipe.id} recipe={c.recipe} meal={c.meal} chosenToday={chosenToday.has(c.recipe.id)} />)}
      </div>
      {eligible > 3 && <Btn block kind="ghost" className="mt-3" onClick={more}>اقتراحات أخرى</Btn>}

      {picks.length < 3 && (
        <Card className="mt-4 space-y-3">
          <h3 className="font-bold">{picks.length === 0 ? 'لا توجد وجبات جاهزة للاقتراح بعد' : 'وجبات ناقصة'}</h3>
          <p className="text-sm text-slate-600">التطبيق لا يخمّن الكارب. أي وصفة تنقصها بيانات لا تُقترح حتى تُستكمل:</p>
          {missing.items.length > 0 && (
            <ul className="space-y-1.5 text-sm">
              {missing.items.slice(0, 8).map(([key, n]) => {
                const [what, problem] = key.split('|');
                return (
                  <li key={key} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                    <span><b>{what}</b> — {PROBLEM_TEXT[problem as keyof typeof PROBLEM_TEXT]}</span>
                    {(problem === 'no_product') && <Link className="shrink-0 text-brand underline" to={`/products/new?category=${encodeURIComponent(what)}`}>إضافة</Link>}
                    <span className="shrink-0 text-xs text-slate-400">{n} وصفة</span>
                  </li>
                );
              })}
            </ul>
          )}
          {missing.pending.length > 0 && (
            <Alert tone="near">
              الكارب غير مكتمل في: {missing.pending.join('، ')}. افتح الوصفة، أكمل حساب القدر، ثم أزل علامة "الكارب غير مكتمل".
            </Alert>
          )}
        </Card>
      )}

      <h2 className="mb-2 mt-8 text-lg font-bold">السناكات</h2>
      <div className="grid grid-cols-2 gap-3">
        {snacks.map((s) => {
          const meal = computeSnack(s, products, settings);
          return (
            <Card key={s.id} className="space-y-2 !p-3">
              <Photo path={s.image_path} category={s.name} className="h-20 w-full rounded-xl" />
              <div className="font-bold">{s.name}</div>
              <div className="text-xs text-slate-500"><span className="num">{fmt(s.quantity)}</span> {s.unit === 'g' ? 'غ' : s.unit === 'ml' ? 'مل' : s.unit === 'tbsp' ? 'ملعقة' : 'حبة'}</div>
              {meal.complete ? <CarbBadge carbs={meal.total.carbs} level="normal" /> : <span className="text-xs text-slate-500">{PROBLEM_TEXT[meal.lines[0].problem ?? 'no_product']}</span>}
              <Btn block disabled={busy || !meal.complete}
                onClick={() => choose({ kind: 'snack', recipe_id: null, name: s.name, category: 'سناك', meal, modified: false })}>اخترناه</Btn>
            </Card>
          );
        })}
      </div>
      <Link to="/snacks" className="mt-2 block text-center text-sm text-brand underline">إدارة السناكات</Link>

      <h2 className="mb-2 mt-8 text-lg font-bold">آخر وجبة اخترناها</h2>
      {last ? (
        <Card>
          <div className="text-sm text-slate-500">{relDay(new Date(last.eaten_at))} {fmtTime(new Date(last.eaten_at))}</div>
          <div className="text-lg font-bold">{last.name}</div>
          <div className="num text-xl font-bold text-brand">{fmt(last.total_carbs)}g carbs</div>
        </Card>
      ) : <Card><p className="text-slate-500">لم تُسجَّل وجبات بعد.</p></Card>}

      <Link to="/plan" className="mt-6 grid min-h-[48px] place-items-center rounded-xl bg-brand-soft font-medium text-brand">تخطيط عدة أيام وقائمة الشراء</Link>
      {recipes.length === 0 && <Alert tone="info">لا توجد وصفات بعد. ابدأ من تبويب الوصفات.</Alert>}
    </Page>
  );
}
