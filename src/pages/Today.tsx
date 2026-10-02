import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { blocker, suggest } from '../lib/suggest';
import { computeSnack, problemText, type Problem } from '../lib/carbs';
import { sameDay } from '../lib/constants';
import { Alert, Btn, Page, CarbBadge, cx } from '../components/ui';
import { MealCard, useChoose } from '../components/meal';
import { Icon } from '../components/Icon';
import { isEn, t, tMaybe } from '../i18n';
import { KIND_STYLE } from '../lib/kinds';
import { QuickItemsSection } from '../components/QuickItems';

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
    <Page title={t('الوجبات')}>
      <div className="-mx-4 mb-4 flex gap-2 overflow-x-auto px-4">
        <Link to="/scan" className="flex shrink-0 items-center gap-1.5 rounded-full bg-brand px-4 py-2 text-sm font-bold text-white"><Icon name="camera" size={16} /> {t('صوّر الأكل')}</Link>
        {[['/recipes', t('الوصفات')], ['/products', t('المنتجات')], ['/plan', t('خطة الأيام')], ['/snacks', t('السناكات')]].map(([to, l]) => (
          <Link key={to} to={to} className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-medium ring-1 ring-slate-200">{l}</Link>
        ))}
      </div>

      <h2 className="mb-2 text-lg font-bold">{t('اقتراحات اليوم')}</h2>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
        {picks.map((c) => <MealCard key={c.recipe.id} recipe={c.recipe} meal={c.meal} chosenToday={chosenToday.has(c.recipe.id)} />)}
      </ul>
      {eligible > 3 && <Btn block kind="ghost" className="mt-3" onClick={more}>{t('اقتراحات أخرى')}</Btn>}

      {picks.length < 3 && (missing.items.length > 0 || missing.pending.length > 0) && (
        <details className="mt-3 rounded-2xl border border-slate-100 bg-white px-4 py-3">
          <summary className="flex min-h-[32px] cursor-pointer list-none items-center justify-between text-sm font-medium text-brand">
            <span>{t('{n} وصفات تنقصها بيانات', { n: missing.items.length + missing.pending.length })}</span><span className="text-slate-400">{isEn() ? '›' : '‹'}</span>
          </summary>
          <ul className="mt-2 space-y-1.5 text-sm">
            {missing.items.slice(0, 8).map(([key, n]) => {
              const [what, problem] = key.split('|');
              return (
                <li key={key} className="flex items-center justify-between gap-2 rounded-xl bg-slate-50 px-3 py-2">
                  <span><b>{tMaybe(what)}</b> · {problemText(problem as Problem)}</span>
                  {problem === 'no_product' ? <Link className="shrink-0 text-brand underline" to={`/products/new?category=${encodeURIComponent(what)}`}>{t('إضافة')}</Link>
                    : <span className="shrink-0 text-xs text-slate-400">{n}</span>}
                </li>
              );
            })}
            {missing.pending.map((name) => <li key={name} className="rounded-xl bg-slate-50 px-3 py-2"><b>{name}</b> · {t('الكارب غير مكتمل')}</li>)}
          </ul>
        </details>
      )}

      <h2 className="mb-2 mt-6 text-lg font-bold">{t('السناكات')}</h2>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
        {snacks.map((s) => {
          const meal = computeSnack(s, products, settings);
          return (
            <li key={s.id} className="flex items-center gap-3 px-4 py-2.5">
              <span className="min-w-0 flex-1">
                <span className="block truncate font-bold">{s.name}</span>
                <span className="mt-1 block"><CarbBadge carbs={meal.total.carbs} level="normal" size="sm" unknown={!meal.complete} /></span>
              </span>
              <Btn kind="soft" className={cx('min-h-[44px] shrink-0 !px-4', KIND_STYLE.meal.soft)} disabled={busy || !meal.complete}
                onClick={() => choose({ kind: 'snack', recipe_id: null, name: s.name,
                  category: 'سناك', // i18n-ok: stored category name
                  meal, modified: false })}>{t('اخترناه')}</Btn>
            </li>
          );
        })}
      </ul>
      <QuickItemsSection />
      {recipes.length === 0 && <div className="mt-4"><Alert tone="info">{t('لا توجد وصفات بعد.')}</Alert></div>}
    </Page>
  );
}
