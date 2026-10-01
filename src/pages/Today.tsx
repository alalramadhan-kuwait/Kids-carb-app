import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { blocker, suggest } from '../lib/suggest';
import { computeSnack, fmt, PROBLEM_TEXT } from '../lib/carbs';
import { dayName, fmtDate, fmtTime, relDay, sameDay } from '../lib/constants';
import { Alert, Btn, Card, Page, Photo, CarbBadge, snackArt } from '../components/ui';
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
    <Page title="الوجبات">
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        {[['/recipes', 'الوصفات'], ['/products', 'المنتجات'], ['/plan', 'خطة الأيام'], ['/snacks', 'السناكات']].map(([to, l]) => (
          <Link key={to} to={to} className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-medium ring-1 ring-slate-200">{l}</Link>
        ))}
      </div>

      <h2 className="mb-2 text-lg font-bold">اقتراحات اليوم</h2>
      <div className="space-y-2.5">
        {picks.map((c) => <MealCard key={c.recipe.id} recipe={c.recipe} meal={c.meal} chosenToday={chosenToday.has(c.recipe.id)} />)}
      </div>
      {eligible > 3 && <Btn block kind="ghost" className="mt-3" onClick={more}>اقتراحات أخرى</Btn>}

      {picks.length < 3 && (missing.items.length > 0 || missing.pending.length > 0) && (
        <details className="mt-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
          <summary className="flex min-h-[32px] cursor-pointer list-none items-center justify-between text-sm font-medium text-near">
            <span>{missing.items.length + missing.pending.length} وصفات تنقصها بيانات</span><span className="text-slate-400">‹</span>
          </summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {missing.items.slice(0, 8).map(([key, n]) => {
              const [what, problem] = key.split('|');
              return (
                <li key={key} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <span><b>{what}</b> · {PROBLEM_TEXT[problem as keyof typeof PROBLEM_TEXT]}</span>
                  {problem === 'no_product' ? <Link className="shrink-0 text-brand underline" to={`/products/new?category=${encodeURIComponent(what)}`}>إضافة</Link>
                    : <span className="shrink-0 text-xs text-slate-400">{n}</span>}
                </li>
              );
            })}
            {missing.pending.map((name) => <li key={name} className="rounded-xl bg-slate-50 px-3 py-2"><b>{name}</b> · الكارب غير مكتمل</li>)}
          </ul>
        </details>
      )}

      <h2 className="mb-2 mt-8 text-lg font-bold">السناكات</h2>
      <div className="grid grid-cols-2 gap-3">
        {snacks.map((s) => {
          const meal = computeSnack(s, products, settings);
          return (
            <Card key={s.id} className="space-y-2 !p-3">
              <Photo path={s.image_path} category={s.name} art={snackArt(s.name)} className="h-20 w-full rounded-xl" />
              <div className="truncate font-bold">{s.name}</div>
              <CarbBadge carbs={meal.total.carbs} level="normal" size="sm" unknown={!meal.complete} />
              <Btn block disabled={busy || !meal.complete}
                onClick={() => choose({ kind: 'snack', recipe_id: null, name: s.name, category: 'سناك', meal, modified: false })}>اخترناه</Btn>
            </Card>
          );
        })}
      </div>
      {recipes.length === 0 && <div className="mt-4"><Alert tone="info">لا توجد وصفات بعد.</Alert></div>}
    </Page>
  );
}
