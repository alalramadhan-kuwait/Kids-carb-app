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
import { groupsIn } from '../lib/productGroups';
import { RESTAURANTS, restaurantOf } from '../lib/restaurants';
import { RestaurantLogo } from './mom/MomMeal';

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
      <input type="search" enterKeyHint="search" dir="auto" className={cx(inputCls, 'mb-4')} value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={t('ابحث: وصفة، منتج، مطعم')} aria-label={t('بحث')} />
      {q.trim() ? <SearchResults q={q} /> : <>
      <Browse />
      <PlannedSection />
      <div className="lg:grid lg:grid-cols-2 lg:items-start lg:gap-8">
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
      </div></>}
    </Page>
  );
}

/** The way in, on one screen: recipes, products and a photo; the food groups; the restaurants with their logos. Every
 *  label is one short line. Each opens its list already narrowed to it. */
// short one-word names for this page (the full names stay elsewhere)
const SHORT: Record<string, string> = { protein: 'لحوم', bread: 'خبز', grains: 'بقوليات', drinks: 'مشروبات', sauces: 'صلصات', sweets: 'حلويات' }; // i18n-ok: shown through t()
const SHORT_REST: Record<string, string> = { mcd: 'ماكدونالدز', bk: 'برجر كنج', kfc: 'كنتاكي', canes: 'كينز', elevation: 'إليفيشن', pick: 'بيك', baskin: 'باسكن' }; // i18n-ok: shown through t()
function Browse() {
  const { products, recipes } = useData();
  const home = products.filter((p) => !restaurantOf(p.brand));
  const groups = groupsIn(home);
  const rests = RESTAURANTS.map((r) => ({ r, n: products.filter((p) => restaurantOf(p.brand)?.key === r.key).length })).filter((x) => x.n);
  const pill = 'flex min-h-[52px] items-center justify-center gap-1.5 rounded-2xl px-2 active:opacity-80';
  const tile = 'relative flex h-[60px] flex-col items-center justify-center gap-0.5 rounded-xl bg-white ring-1 ring-slate-100 active:bg-slate-50';
  const count = (n: number) => <span className="num absolute end-1 top-0.5 text-[10px] text-slate-400">{n}</span>;
  return (
    <div className="mb-4 space-y-3">
      <div className="grid grid-cols-3 gap-2">
        <Link to="/recipes" className={cx(pill, 'bg-white ring-1 ring-slate-100')}><span className="text-xl" aria-hidden>🍲</span><b className="truncate text-[14px]">{t('الوصفات')}</b></Link>
        <Link to="/products" className={cx(pill, 'bg-white ring-1 ring-slate-100')}><span className="text-xl" aria-hidden>🛒</span><b className="truncate text-[14px]">{t('المنتجات')}</b></Link>
        <Link to="/scan" className={cx(pill, 'bg-brand text-white')}><Icon name="camera" size={20} /><b className="truncate text-[14px]">{t('صوّر')}</b></Link>
      </div>
      {groups.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-[15px] font-bold text-slate-600">{t('أقسام الأكل')}</h2>
          <div className="grid grid-cols-5 gap-1.5">
            {groups.map(({ group: g, n }) => (
              <Link key={g.key} to={`/products?group=${encodeURIComponent(g.key)}`} className={tile} aria-label={`${tMaybe(g.label)} ${n}`}>
                {count(n)}
                <span className="text-[22px] leading-none" aria-hidden>{g.emoji}</span>
                <span className="w-full truncate px-0.5 text-center text-[12px] font-bold">{SHORT[g.key] ? t(SHORT[g.key]) : tMaybe(g.label)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
      {rests.length > 0 && (
        <section>
          <h2 className="mb-1.5 text-[15px] font-bold text-slate-600">{t('المطاعم')}</h2>
          <div className="grid grid-cols-4 gap-1.5">
            {rests.map(({ r, n }) => (
              <Link key={r.key} to={`/products?brand=${encodeURIComponent(r.brand)}`} className={cx(tile, 'h-[76px]')} aria-label={`${tMaybe(r.label)} ${n}`}>
                {count(n)}
                <RestaurantLogo r={r} size={40} />
                <span className="w-full truncate px-0.5 text-center text-[12px] font-bold">{SHORT_REST[r.key] ? t(SHORT_REST[r.key]) : tMaybe(r.label)}</span>
              </Link>
            ))}
          </div>
        </section>
      )}
    </div>
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
  const pr = products.filter((x) => matches([x.name, x.name_ar, x.name_en, x.brand, x.category], q)).slice(0, 25);
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
