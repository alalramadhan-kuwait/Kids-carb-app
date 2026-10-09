import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { blocker, suggest } from '../lib/suggest';
import { problemText, type Problem } from '../lib/carbs';
import { sameDay } from '../lib/constants';
import { Alert, Btn, Page, CarbBadge, Photo, cx, inputCls, recipeArt, toast } from '../components/ui';
import { matches } from '../lib/search';
import { logQuick, rankQuick, useQuickItems, type QuickItem } from '../lib/quick';
import { ProductSheet } from '../components/ProductSheet';
import { deleteHistory } from '../lib/api';
import { fmt } from '../lib/carbs';
import type { Product } from '../lib/types';
import { MealCard } from '../components/meal';
import { PlannedSection } from '../components/Plans';
import { Icon } from '../components/Icon';
import { isEn, t, tMaybe } from '../i18n';
import { KIND_STYLE } from '../lib/kinds';
import { QuickItemsSection } from '../components/QuickItems';

const SHUFFLE_KEY = 'kc-shuffle';
const readShuffle = () => { try { const v = JSON.parse(localStorage.getItem(SHUFFLE_KEY) ?? 'null'); return v?.day === new Date().toDateString() ? Number(v.n) : 0; } catch { return 0; } };

export default function Today() {
  const { candidates, history, settings, products, recipes, reload } = useData();
  const [q, setQ] = useState('');
  const [shuffle, setShuffle] = useState(readShuffle);
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
        {[['/recipes', t('الوصفات')], ['/products', t('المنتجات')]].map(([to, l]) => (
          <Link key={to} to={to} className="shrink-0 rounded-full bg-white px-4 py-2 text-sm font-medium ring-1 ring-slate-200">{l}</Link>
        ))}
      </div>

      <PlannedSection />
      <input type="search" enterKeyHint="search" dir="auto" className={cx(inputCls, 'mb-4')} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={t('ابحث: وصفة، منتج، أكل متكرر')} aria-label={t('بحث')} />
      {q.trim() ? <SearchResults q={q} /> : <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
      <div>
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

      </div>
      <div>
      <QuickItemsSection />
      {recipes.length === 0 && <div className="mt-4"><Alert tone="info">{t('لا توجد وصفات بعد.')}</Alert></div>}
      </div>
      </div>}
    </Page>
  );
}

/** A snack's picture; tapping it takes or picks a new photo and saves it with the snack. */
/** One search over recipes, products and frequent foods, each with its picture, carbs and its own action. */
function SearchResults({ q }: { q: string }) {
  const { recipes, products, candidates, settings, history, reload } = useData();
  const quick = useQuickItems();
  const [picked, setPicked] = useState<Product | null>(null);
  const recipeCarbs = useMemo(() => new Map(candidates.map((c) => [c.recipe.id, c.meal])), [candidates]);
  const r = recipes.filter((x) => matches([x.name, x.category], q)).slice(0, 15);
  const pr = products.filter((x) => matches([x.name, x.brand, x.category], q)).slice(0, 25);
  const qi = rankQuick(quick.items, history).filter((x) => matches([x.name, x.brand], q)).slice(0, 15);
  const logQ = async (x: QuickItem) => {
    try {
      const id = await logQuick(x); await reload(); void quick.reload();
      toast(t('تم التسجيل: {x}', { x: `${tMaybe(x.name)} · ${t('{g} غ', { g: fmt(x.carbs) })}` }), { label: t('تراجع'), run: async () => { await deleteHistory(id); await reload(); } });
    } catch (e) { toast((e as Error).message); }
  };
  const row = 'flex items-center gap-3 px-3 py-2';
  const section = (title: string, n: number, body: React.ReactNode) => n > 0 && (
    <section className="mb-4"><h2 className="mb-1.5 text-sm font-bold text-slate-600">{title} <span className="font-normal text-slate-400">{n}</span></h2>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">{body}</ul></section>
  );
  const none = !r.length && !pr.length && !qi.length;
  return (
    <div>
      {none && <Alert tone="info">{t('لا توجد نتائج. أضيفوا منتجًا جديدًا من «المنتجات».')}</Alert>}
      {section(t('أكل متكرر'), qi.length, qi.map((x) => (
        <li key={x.id} className={row}>
          <span className="min-w-0 flex-1"><bdi className="block truncate font-bold">{tMaybe(x.name)}</bdi><span className="text-xs text-slate-500">{x.brand && <><bdi>{x.brand}</bdi> · </>}{t('{g} غ كارب', { g: fmt(x.carbs) })}</span></span>
          <Btn kind="soft" className={cx('min-h-[44px] shrink-0 !px-4', KIND_STYLE.meal.soft)} onClick={() => logQ(x)}>{t('سجّل')}</Btn>
        </li>
      )))}
      {section(t('الوصفات'), r.length, r.map((x) => {
        const meal = recipeCarbs.get(x.id);
        return (
          <li key={x.id}><Link to={`/recipes/${x.id}`} className={row}>
            <Photo path={x.image_path} category={x.category} art={recipeArt(x.category)} className="h-12 w-12 shrink-0 rounded-xl" />
            <span className="min-w-0 flex-1"><span className="block truncate font-bold">{x.name}</span>
              {meal ? <CarbBadge carbs={meal.total.carbs} level="normal" size="sm" unknown={!meal.complete} /> : <span className="text-xs text-slate-500">{tMaybe(x.category)}</span>}</span>
            <span className="text-slate-300">{isEn() ? '›' : '‹'}</span>
          </Link></li>
        );
      }))}
      {section(t('المنتجات'), pr.length, pr.map((x) => (
        <li key={x.id}><button onClick={() => setPicked(x)} className={cx(row, 'w-full text-start')}>
          <Photo path={x.image_path} category={x.category} className="h-12 w-12 shrink-0 rounded-xl" />
          <span className="min-w-0 flex-1"><bdi className="block truncate font-bold">{tMaybe(x.name)}</bdi>
            <span className="block truncate text-xs text-slate-500">{[x.brand, tMaybe(x.category)].filter(Boolean).join(' · ')} · {t('{g} غ لكل 100', { g: fmt(x.carbs_per_100) })}</span></span>
          <span className="text-slate-300">{isEn() ? '›' : '‹'}</span>
        </button></li>
      )))}
      <ProductSheet p={picked} onClose={() => setPicked(null)} />
    </div>
  );
}
