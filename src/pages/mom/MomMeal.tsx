// Mom mode, building a meal from Layan's database: saved meals, recipes and products (grouped, with pictures), each
// in one of its portions. Every choice is a full page; the meal being built is kept on the phone.
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { Navigate, useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { compareOps, draftOps, saveLabelFood, saveMeal, useCompare, useDraft, usePortions, useSavedMeals } from '../../lib/mom';
import { planMeal } from '../../lib/plans';
import { COMPARE_MAX, planItems, planItemsOf, readyForMom, recipePot, type Catalog, type MomItem } from '../../engine/mom';
import { groupByKey, groupOf, groupsIn, subgroupOf, subgroupsIn } from '../../lib/productGroups';
import { matchTier, matches } from '../../lib/search';
import { fmt } from '../../lib/carbs';
import { supabase, uploadPhoto } from '../../lib/supabase';
import { Photo, asset, cx, inputCls, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { RESTAURANTS, cupsOf, menuOf, restaurantByKey, restaurantOf, type Restaurant } from '../../lib/restaurants';
import { foodName, untranslated, type Named } from '../../lib/foodName';
import { Big, Choice, MomPage, okToReplace } from './MomUI';
import type { HistoryEntry, Ingredient, PlanItem, Product, Recipe } from '../../lib/types';
import { productOf } from '../../lib/mealItems';
import { reusable } from '../../lib/entryActions';
import { mealGi } from '../../engine/gi';
import { GiBadge, MealGiLine } from '../../components/Gi';

/** The catalogue Mom mode reads, and the carbs of any item or meal (null if any part is unknown). */
export function useCatalog() {
  const { products, recipes, ingsByRecipe, settings } = useData();
  const { portions } = usePortions();
  const c: Catalog = useMemo(() => ({ products, recipes, ingsByRecipe, portions }), [products, recipes, ingsByRecipe, portions]);
  const carbsOf = (items: PlanItem[] | null) => { if (!items) return null; const m = planMeal(items, products, settings); return m.complete ? Math.round(m.total.carbs * 10) / 10 : null; };
  const itemCarbs = (it: MomItem) => carbsOf(planItemsOf(it, c));
  const mealCarbs = (items: MomItem[]) => carbsOf(planItems(items, c));
  // how fast the carbs act (information only; engine/gi.ts)
  const giOfItems = (items: PlanItem[] | null) => { if (!items) return null; const m = planMeal(items, products, settings); return m.complete ? mealGi(m.lines.map((l) => ({ carbs: l.carbs, food: l.product }))) : null; };
  const mealGiOf = (items: MomItem[]) => giOfItems(planItems(items, c));
  const recipeGi = (id: string) => giOfItems(planItemsOf({ kind: 'recipe', id, portion_id: null, amount: 1, unit: 'plate' }, c));
  const nameOf = (it: { kind: 'product' | 'recipe'; id: string }) => { const x = (it.kind === 'product' ? products : recipes).find((y) => y.id === it.id); return x ? shownName(x) : ''; };
  const photoOf = (it: { kind: 'product' | 'recipe'; id: string }): Product | Recipe | null => (it.kind === 'product' ? products : recipes).find((x) => x.id === it.id) ?? null;
  const firstPortion = (kind: 'product' | 'recipe', id: string) => c.portions.find((p) => (kind === 'product' ? p.product_id === id : p.recipe_id === id)) ?? null;
  /** A tile's carbs: «كوب = 45 غ كارب» by its first portion, else «28 غ / 100 غ» (a recipe: per plate). */
  const tileCarbs = (kind: 'product' | 'recipe', id: string): string | null => {
    const p = firstPortion(kind, id);
    if (p) { const g = itemCarbs({ kind, id, portion_id: p.id }); return g === null ? null : t('{p} = {g} غ كارب', { p: tMaybe(p.label), g: fmt(g) }); }
    if (kind === 'recipe') { const g = itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'plate' }); return g === null ? null : t('صحن = {g} غ كارب', { g: fmt(g) }); }
    const pr = products.find((x) => x.id === id);
    if (pr?.per_item) return t('الحبة = {g} غ كارب', { g: fmt(Number(pr.carbs_per_100)) });
    return pr ? t('{g} غ / 100 {u}', { g: fmt(Number(pr.carbs_per_100)), u: pr.unit === 'ml' ? t('مل') : t('غ') }) : null;
  };
  /** A recipe's parts that hold carbs and can be weighed on a plate by themselves: weighed cooked or as is in the
   *  recipe (not dry before cooking), each with its product; in the recipe's order. */
  const carbParts = (rid: string) => (ingsByRecipe.get(rid) ?? []).filter((i) => i.role !== 'snack' && i.state !== 'raw' && (i.unit === 'g' || i.unit === 'ml'))
    .map((i) => ({ i, p: i.product_id ? products.find((x) => x.id === i.product_id) ?? null : null }))
    .filter((x): x is { i: Ingredient; p: Product } => !!x.p && x.p.approved && Number(x.p.carbs_per_100) >= 5 && !x.p.per_item)
    .map(({ i, p }) => ({ product: p, name: p.name, cooked: i.state === 'cooked', q: Number(i.quantity) }));
  /** A list row's carbs: the grams for the food's first portion (or a plate, an item, 100 g), and what that is. */
  const carbsLine = (kind: 'product' | 'recipe', id: string): { g: number; per: string } | null => {
    const p = firstPortion(kind, id);
    if (p) { const g = itemCarbs({ kind, id, portion_id: p.id }); return g === null ? null : { g, per: tMaybe(p.label) }; }
    if (kind === 'recipe') { const g = itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'plate' }); return g === null ? null : { g, per: t('صحن') }; }
    const pr = products.find((x) => x.id === id);
    if (!pr) return null;
    return pr.per_item ? { g: Number(pr.carbs_per_100), per: t('الحبة') } : { g: Number(pr.carbs_per_100), per: pr.unit === 'ml' ? t('100 مل') : t('100 غ') };
  };
  return { c, carbsOf, itemCarbs, mealCarbs, mealGiOf, recipeGi, carbParts, carbsLine, nameOf, photoOf, firstPortion, tileCarbs };
}

/** What Photo needs for a product or recipe: its photo, its own emoji (generic foods), its category. */
export const pic = (x: Product | Recipe | null | undefined) => ({ path: x?.image_path, category: x?.category, emoji: x && 'emoji' in x ? x.emoji : null });

const RECENT = 'mom-recent-v1';
export const recent = (): { kind: 'product' | 'recipe'; id: string }[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]'); } catch { return []; } };
const LAST = 'mom-last-portion-v1';
type Last = { portion_id: string | null; unit?: MomItem['unit']; amount?: number };
/** The amount she last had of a food (a portion, or an amount in a unit), to suggest next time. */
export const lastPortion = (kind: 'product' | 'recipe', id: string): Last | null => {
  try { const all = JSON.parse(localStorage.getItem(LAST) ?? '{}') as Record<string, Last>; return all[`${kind}:${id}`] ?? null; } catch { return null; }
};
const rememberPortion = (it: MomItem) => {
  try {
    const all = JSON.parse(localStorage.getItem(LAST) ?? '{}') as Record<string, Last>;
    all[`${it.kind}:${it.id}`] = it.portion_id ? { portion_id: it.portion_id } : { portion_id: null, unit: it.unit, amount: it.amount };
    localStorage.setItem(LAST, JSON.stringify(all));
  } catch { /* storage blocked */ }
};
export const remember = (x: { kind: 'product' | 'recipe'; id: string }) => {
  try { localStorage.setItem(RECENT, JSON.stringify([x, ...recent().filter((r) => !(r.kind === x.kind && r.id === x.id))].slice(0, 12))); } catch { /* blocked */ }
};

/**
 * A logged meal's items as plate items: each line's product at the same amount. A line is only taken when the plate
 * gives it the same carbs as were logged (within 1 g or 10%); anything else (no product, a unit the plate does not
 * use, a cooked/raw difference) is listed as left out, so nothing is counted wrong.
 */
export function plateFromLog(h: HistoryEntry, products: Product[], itemCarbs: (it: MomItem) => number | null): { items: MomItem[]; left: string[] } {
  const items: MomItem[] = [], left: string[] = [];
  for (const l of h.lines) {
    const p = productOf(l, products);
    const unit = l.unit === 'serving' ? 'serving' : l.unit === 'g' || l.unit === 'ml' ? 'g' : null;
    const it: MomItem | null = p && unit ? { kind: 'product', id: p.id, portion_id: null, amount: l.quantity, unit } : null;
    const g = it ? itemCarbs(it) : null, want = l.carbs ?? null;
    if (it && g !== null && want !== null && Math.abs(g - want) <= Math.max(1, want * 0.1)) items.push(it);
    else left.push(tMaybe(l.name));
  }
  return { items, left };
}

/** «وجبة ليان»: what is on her plate, the carb total (small), add more, then next. */
export function MomMeal() {
  const nav = useNavigate();
  const d = useDraft();
  const { itemCarbs, mealCarbs, mealGiOf, nameOf, photoOf, c } = useCatalog();
  const { meals } = useSavedMeals();
  const { history } = useData();
  const total = mealCarbs(d.items);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const sameAsSaved = d.savedId && meals.find((m) => m.id === d.savedId && JSON.stringify(m.items) === JSON.stringify(d.items));
  const portionLabel = (it: MomItem) => it.portion_id ? tMaybe(c.portions.find((p) => p.id === it.portion_id)?.label ?? '')
    : it.unit === 'g' && c.products.find((p) => p.id === it.id)?.per_item ? `× ${fmt((it.amount ?? 0) / 100)}`
    : `${fmt(it.amount ?? 0)} ${it.unit === 'serving' ? t('حصة') : it.unit === 'plate' ? t('صحن') : it.unit === 'cup' ? t('كوب') : c.products.find((p) => p.id === it.id)?.unit === 'ml' ? t('مل') : t('غرام')}`;
  const Left = () => d.left.length ? <p className="rounded-2xl bg-over-soft px-4 py-3 text-center text-[17px] font-bold text-over">⚠️ <bdi>{d.left.join(' · ')}</bdi> {t('ما ينحسب بالإبرة · كلّمي بابا')}</p> : null;
  const title = d.mode === 'plan' ? t('خطة وجبة') : t('وجبة ليان');
  // opened from home with a plate left from before: say so, and one tap starts a new meal (nothing else is lost)
  const fromHome = useSearchParams()[0].get('from') === 'home';
  const fresh = () => { draftOps.clear(); draftOps.start(d.mode); nav('/mom/add', { replace: true }); };
  // nothing on the plate yet: straight to the search (the summary appears with the first food)
  if (!d.items.length) return <Navigate to="/mom/add" replace />;
  return (
    <MomPage compact title={d.name ?? title} back="/mom" foot={<>
      {/* the total and both buttons stay in view however long the list (a small phone with 8 foods) */}
      <div className="flex items-baseline justify-between px-1"><span className="text-[15px] text-slate-500">{t('مجموع الكارب')}</span><b className="num text-[26px] leading-none text-slate-900">{total === null ? '—' : `${gramsText(total)} ${t('غ')}`}</b></div>
      <Big tone="soft" className="!min-h-[48px] !text-[17px]" onClick={() => nav('/mom/add')}>+ {t('إضافة أكل ثاني')}</Big>
      <Big md disabled={total === null} onClick={() => nav(d.mode === 'plan' ? (d.planId ? `/mom/when?plan=${d.planId}` : '/mom/when') : '/mom/dose')}>{d.mode === 'plan' ? `${t('التالي')} · 🕐 ${t('متى؟')}` : t('التالي')}</Big>
    </>}>
      {fromHome && (
        <div className="flex items-center gap-2 rounded-2xl bg-near-soft px-3 py-2 text-near">
          <span className="min-w-0 flex-1 text-[15px] font-bold leading-snug">{t('هذي وجبة ما خلصت من قبل')}</span>
          <button onClick={fresh} className="min-h-[44px] shrink-0 rounded-full bg-white px-4 text-[15px] font-bold text-brand">{t('وجبة جديدة')}</button>
        </div>
      )}
      <ul className="divide-y divide-slate-100 rounded-3xl border border-slate-100 bg-white px-3">
        {d.items.map((it, k) => {
          const g = itemCarbs(it), p = photoOf(it);
          return (
            <li key={k} className="flex items-center gap-2 py-2">
              {/* tap to change the amount */}
              <button onClick={() => nav(`/mom/item/${it.kind}/${it.id}?k=${k}`)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                <Photo {...pic(p)} className="h-12 w-12 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1"><b className="block text-[16px] leading-snug"><bdi>{nameOf(it)}</bdi></b><span className="text-[13px] text-slate-500"><bdi>{portionLabel(it)}</bdi> · <span className="text-brand">{t('تعديل')}</span></span></span>
                <span className="shrink-0 text-[16px] font-bold">{g === null ? '—' : g === 0 ? <span className="font-normal text-slate-500">{t('بدون كارب')}</span> : <><span className="num">{gramsText(g)}</span> <span className="text-[13px] font-normal text-slate-500">{t('غ')}</span></>}</span>
              </button>
              <button aria-label={t('شيليه من الصحن')} onClick={() => draftOps.remove(k)} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-[20px] text-slate-400 active:bg-slate-100">✕</button>
            </li>
          );
        })}
      </ul>
      <Left />
      {total !== null && <MealGiLine m={mealGiOf(d.items)} big />}
      {!sameAsSaved && d.items.length > 1 && (naming ? (
        <div className="flex gap-2">
          <input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('اسم الوجبة')} maxLength={40} autoFocus />
          <button className="min-h-[48px] shrink-0 rounded-2xl bg-brand px-4 font-bold text-white disabled:opacity-40" disabled={!name.trim()} onClick={async () => {
            try { await saveMeal({ name, emoji: null, items: d.items }); toast(t('انحفظت ⭐')); setNaming(false); } catch (e) { toast((e as Error).message); }
          }}>{t('حفظ')}</button>
        </div>
      ) : <button className="min-h-[44px] text-[16px] font-bold text-brand" onClick={() => setNaming(true)}>⭐ {t('احفظيها وجبة')}</button>)}
    </MomPage>
  );
}

/** One row of the list: picture, name (wrapping), a second line, and the carbs with what they are for. */
export function FoodRow({ x, icon, title, sub, carbs, per, onClick }: { x?: Product | Recipe | null; icon?: ReactNode; title: string; sub?: string; carbs: number | null; per?: string; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-[60px] w-full items-center gap-3 rounded-2xl bg-white px-3 py-2 text-start shadow-sm active:opacity-80">
      {x ? <Photo {...pic(x)} className="h-12 w-12 shrink-0 rounded-xl" /> : <span aria-hidden className="grid h-12 w-12 shrink-0 place-items-center rounded-xl bg-brand-soft text-2xl">{icon}</span>}
      <span className="min-w-0 flex-1">
        <span className="block text-[16px] font-bold leading-snug"><bdi>{title}</bdi></span>
        {sub && <span className="block text-[13px] leading-snug text-slate-500"><bdi>{sub}</bdi></span>}
      </span>
      {carbs !== null && (
        <span className="max-w-[38%] shrink-0 text-end leading-tight">
          <span className="block whitespace-nowrap text-[16px] font-bold text-brand"><span className="num">{gramsText(carbs)}</span> {t('غ')}</span>
          {per && <span className="block text-[12px] text-slate-500"><bdi>{per}</bdi></span>}
        </span>
      )}
    </button>
  );
}

/** Grams of carbs as shown: one decimal; a little more than nothing is «‎<0.1», never 0 (0 is only for none at all). */
export const gramsText = (g: number) => (g > 0 && g < 0.05 ? '<0.1' : fmt(g));

/** A food's name in the app's language (its curated Arabic or English name), else as entered. */
export const shownName = (x: Named) => (untranslated(x) ? tMaybe(x.name) : foodName(x));

/** A search box's text kept in the address (?q=), replacing the entry as she types: Back returns to it. */
export function useUrlQuery(): [string, (v: string) => void] {
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '';
  const set = (v: string) => setSp((prev) => { const n = new URLSearchParams(prev); if (v) n.set('q', v); else n.delete('q'); return n; }, { replace: true });
  return [q, set];
}

/** Back to where she came from; to `home` when the page was opened directly (nothing to go back to). */
export function useBack(home: string): string | number {
  return useLocation().key === 'default' ? home : -1;
}

/** One food as a tile: its picture (photo or emoji), name, and carbs (per its first portion, else per 100). */
function FoodTile({ x, carbs, onClick }: { x: Product | Recipe; carbs: string | null; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 rounded-2xl border border-slate-100 bg-white p-2 active:opacity-80">
      <Photo {...pic(x)} className="h-24 w-full rounded-xl" />
      <span className="line-clamp-2 text-center text-[17px] font-bold leading-tight"><bdi>{shownName(x)}</bdi></span>
      {carbs && <span className="text-center text-[15px] font-bold leading-tight text-brand"><bdi>{carbs}</bdi></span>}
    </button>
  );
}

/** The food page's foods: approved ones, and the tile line and tap for each (browse: values; add: portions). */
function useFoods(browse: boolean) {
  const nav = useNavigate();
  const cat = useCatalog();
  const { c } = cat;
  const products = c.products.filter((p) => readyForMom('product', p.id, c));
  const recipes = c.recipes.filter((r) => readyForMom('recipe', r.id, c));
  const pick = (kind: 'product' | 'recipe', id: string) => nav(browse ? `/mom/food/${kind}/${id}` : `/mom/item/${kind}/${id}`);
  const homeFirst = (l: Product[]) => [...l].sort((a, b) => Number(b.available !== false) - Number(a.available !== false));
  // the nutrition tab browses picture tiles; adding a meal lists rows (more of them fit, carbs to the side)
  const tile = (kind: 'product' | 'recipe', x: Product | Recipe) => {
    if (browse) return <FoodTile key={kind + x.id} x={x} carbs={cat.tileCarbs(kind, x.id)} onClick={() => pick(kind, x.id)} />;
    const cl = cat.carbsLine(kind, x.id);
    return <FoodRow key={kind + x.id} x={x} title={shownName(x)} sub={kind === 'product' && 'brand' in x && x.brand ? (restaurantOf(x.brand) ? undefined : x.brand) : undefined} carbs={cl?.g ?? null} per={cl?.per} onClick={() => pick(kind, x.id)} />;
  };
  /** the foods laid out: tiles in two columns to browse, rows to add */
  const grid = (children: ReactNode) => <div className={browse ? 'grid grid-cols-2 gap-2' : 'space-y-2'}>{children}</div>;
  return { ...cat, products, recipes, homeFirst, tile, pick, grid };
}

/** «⚖️ قارني (2)»: the way to the compare page, at the bottom of the food pages while the compare list has foods. */
function useCompareBar(browse: boolean) {
  const nav = useNavigate();
  const n = useCompare().length;
  return browse && n ? <Big tone="soft" className="!min-h-[52px] !text-[18px]" onClick={() => nav('/mom/compare')}>⚖️ {t('قارني ({n})', { n })}</Big> : undefined;
}

/** «شنو بتاكل؟»: saved meals | recipes | food (its groups as big tiles; typing searches every group), most used
 *  first. Full page. */
export function MomAdd({ browse = false }: { browse?: boolean }) {
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const { meals } = useSavedMeals();
  // browse: the «التغذية» tab — the same food list, but a tap opens the item's nutrition values
  const tab = (sp.get('tab') ?? 'products') as 'saved' | 'recipes' | 'products' | 'restaurants';
  // the query lives in the address, so Back from a food comes back to the same results
  const [q, setQ] = useUrlQuery();
  const { c, mealCarbs, nameOf, products, recipes, homeFirst, tile } = useFoods(browse);
  const rec = recent().filter((r) => readyForMom(r.kind, r.id, c)).slice(0, 4);
  const find = (kind: 'product' | 'recipe', id: string) => ((kind === 'product' ? c.products : c.recipes) as (Product | Recipe)[]).find((y) => y.id === id)!;
  // searching finds every approved food in every group (restaurants, things not bought yet), what is at home first
  const found = q.trim() ? homeFirst(products.filter((p) => matches([p.name, p.name_ar, p.name_en, p.brand, p.category], q))) : [];
  const foundRecipes = q.trim() ? recipes.filter((r) => matches([r.name, r.name_ar, r.name_en, r.category], q)) : [];
  const groups = groupsIn(products.filter((p) => !restaurantOf(p.brand))); // restaurant food has its own tab
  const missing = q.trim() && !found.length && !foundRecipes.length;
  const base = browse ? '/mom/food' : '/mom/add';
  const bar = useCompareBar(browse);
  return (
    <MomPage title={browse ? t('التغذية') : t('شنو بتاكل؟')} back={browse ? null : '/mom/meal'} tabs={browse} foot={bar}>
      <div className={cx('grid gap-1 rounded-full bg-slate-100 p-1', browse ? 'grid-cols-3 text-[15px]' : 'grid-cols-4 text-[14px]')}>
        {(browse ? ['products', 'recipes', 'restaurants'] as const : ['saved', 'recipes', 'products', 'restaurants'] as const).map((k) => <button key={k} onClick={() => setSp({ tab: k }, { replace: true })} className={cx('min-h-[44px] rounded-full px-1 leading-tight', tab === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k === 'saved' ? t('وجباتها') : k === 'recipes' ? t('طبخ البيت') : k === 'restaurants' ? t('مطاعم') : t('أكل')}</button>)}
      </div>
      {tab === 'restaurants' && (
        <div className="grid grid-cols-2 gap-2">
          {RESTAURANTS.map((r) => ({ r, n: products.filter((p) => restaurantOf(p.brand)?.key === r.key).length })).filter((x) => x.n).map(({ r, n }) => (
            <button key={r.key} onClick={() => nav(`${base}/r/${r.key}`)} className="flex min-h-[150px] flex-col items-center justify-center gap-2 rounded-2xl border border-slate-100 bg-white p-3 active:opacity-80">
              <RestaurantLogo r={r} size={72} />
              <span className="text-[17px] font-bold">{tMaybe(r.label)}</span>
              <span className="num text-[14px] text-slate-500">{n}</span>
            </button>
          ))}
        </div>
      )}
      {tab === 'saved' && (meals.length ? meals.map((m) => {
        const g = mealCarbs(m.items);
        return <Choice key={m.id} icon="⭐" label={m.name} sub={m.items.map((i) => nameOf(i)).join(' · ')} onClick={() => { draftOps.load(m); nav('/mom/meal'); }} color={g === null ? '#e2e8f0' : undefined} />;
      }) : <p className="text-center text-slate-500">{t('ما في وجبات محفوظة بعد')}</p>)}
      {tab === 'recipes' && (recipes.length ? <div className="grid grid-cols-2 gap-2">{recipes.map((r) => tile('recipe', r))}</div> : <p className="text-center text-slate-500">{t('بابا ما جهّز وصفات بعد')}</p>)}
      {tab === 'products' && (
        <>
          <input className={inputCls} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحثي: رز، كورن فليكس، توبي…')} />
          {q.trim() ? (
            <div className="grid grid-cols-2 gap-2">{foundRecipes.map((r) => tile('recipe', r))}{found.map((p) => tile('product', p))}</div>
          ) : (
            <>
              {rec.length > 0 && (<><h2 className="text-[16px] font-bold text-slate-500">{t('الأكثر')}</h2><div className="grid grid-cols-2 gap-2">{rec.map((r) => tile(r.kind, find(r.kind, r.id)))}</div></>)}
              {/* the groups as big tiles: home cooking first, then every group that has foods */}
              <div className="grid grid-cols-3 gap-2">
                {recipes.length > 0 && <GroupTile emoji="🍲" label={t('أكلات كويتية')} sub={t('طبخ البيت')} n={recipes.length} onClick={() => setSp({ tab: 'recipes' }, { replace: true })} />}
                {groups.map(({ group: gr, n }) => <GroupTile key={gr.key} emoji={gr.emoji} label={tMaybe(gr.label)} n={n} onClick={() => nav(`${base}/g/${gr.key}`)} />)}
              </div>
              {!products.length && <p className="text-center text-slate-500">{t('بابا ما جهّز الكميات بعد')}</p>}
            </>
          )}
        </>
      )}
      <Big tone="ghost" className={cx('shrink-0', missing ? '' : 'mt-auto')} onClick={() => nav('/mom/new')}>{t('مو موجود؟')}</Big>
    </MomPage>
  );
}

/** A restaurant's logo; its colours and letters when there is no logo file. */
export function RestaurantLogo({ r, size = 56 }: { r: Restaurant; size?: number }) {
  if (r.logo) return <img src={asset(r.logo)} alt="" aria-hidden className={cx('shrink-0 object-contain', r.key !== 'pick' && 'rounded-2xl shadow-sm')} style={{ width: size, height: size }} />;
  return (
    <span aria-hidden className="grid shrink-0 place-items-center overflow-hidden rounded-2xl font-black leading-none shadow-sm" dir="ltr"
      style={{ width: size, height: size, background: r.bg, color: r.fg, fontSize: size * (r.mark.length > 3 ? 0.27 : r.mark.length > 2 ? 0.34 : r.mark.length > 1 ? 0.42 : 0.7), letterSpacing: r.mark.length > 1 ? '-0.02em' : undefined,
        ...(r.key === 'bk' ? { borderRadius: '50%', boxShadow: `inset 0 0 0 ${size * 0.06}px #F89D1C` } : {}) }}>
      {r.mark}
    </span>
  );
}

/** One restaurant: its menu in sections (burgers, chicken, fries, sauces, drinks, desserts). */
export function MomRestaurant({ browse = false }: { browse?: boolean }) {
  const { key } = useParams() as { key: string };
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useUrlQuery();
  const r = restaurantByKey(key);
  const { products, tile, pick, grid } = useFoods(browse);
  const items = products.filter((p) => restaurantOf(p.brand)?.key === key);
  const bar = useCompareBar(browse), menuBack = useBack(browse ? '/mom/food?tab=restaurants' : '/mom/add?browse=restaurants');
  // a section, a size or a flavour list is a step inside the menu: its back arrow steps back (never a new step to the
  // menu, which made Back loop between the menu and the section)
  const up = useBack(`${browse ? '/mom/food' : '/mom/add'}/r/${key}`);
  // frozen yogurt (and any food sold in sizes): size first, then the flavour
  const cup = sp.get('cup');
  const sections = menuOf(items, r?.lead).map((x) => ({ ...x, cups: cupsOf(x.items) }));
  const sized = sections.find((x) => x.cups.sizes.length);
  const flavour = (p: Product) => foodName(p).replace(/\s*\([^)]*\)\s*$/, '');
  if (sized && cup) {
    const size = sized.cups.sizes.find((x) => x.size.key === cup);
    return (
      <MomPage compact={!browse} title={size ? `${size.size.emoji} ${tMaybe(size.size.label)}` : t('أي حجم؟')} back={up} foot={bar}>
        {!size && sized.cups.sizes.map(({ size: z, items: xs }) => {
          const cs = xs.map((x) => Number(x.item.carbs_per_100));
          return <Choice key={z.key} icon={z.emoji} label={tMaybe(z.label)} sub={t('{a}–{b} غ كارب', { a: `\u2066${fmt(Math.min(...cs))}`, b: `${fmt(Math.max(...cs))}\u2069` })} onClick={() => setSp({ cup: z.key })} />;
        })}
        {size && <h2 className="text-[18px] font-bold">{t('أي نكهة؟')}</h2>}
        {size && size.items.map(({ item }) => <Choice key={item.id} icon="🍦" label={flavour(item)} sub={t('{g} غ كارب', { g: fmt(Number(item.carbs_per_100)) })} onClick={() => pick('product', item.id)} />)}
      </MomPage>
    );
  }
  // the menu as section tiles (burgers, drinks, fruit…); a tap opens that section only; typing searches the whole menu
  const sec = sp.get('sec');
  const open = sections.find((x) => x.section.key === sec) ?? (sections.length === 1 ? sections[0] : null);
  const found = q.trim() ? items.filter((p) => matches([p.name, p.name_ar, p.name_en, p.category], q)) : [];
  const cupRow = (cups: (typeof sections)[number]['cups']) => cups.sizes.length > 0 && (
    <Choice icon="🍦" label={t('كوب: اختاري الحجم ثم النكهة')} sub={t('{n} نكهات', { n: new Set(cups.sizes.flatMap((z) => z.items.map((x) => x.flavour))).size })} onClick={() => setSp({ cup: 'choose' })} />
  );
  return (
    <MomPage compact={!browse} title={open && sections.length > 1 ? `${open.section.emoji} ${tMaybe(open.section.label)}` : r ? tMaybe(r.label) : t('مطاعم')} back={open && sections.length > 1 ? up : menuBack} foot={bar}>
      {!open && r && <div className="flex justify-center"><RestaurantLogo r={r} size={64} /></div>}
      {!open && <input className={inputCls} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحثي في المنيو')} />}
      {q.trim() && !open ? (
        found.length ? grid(found.map((p) => tile('product', p))) : <p className="text-center text-slate-500">{t('ما في شي بهالاسم')}</p>
      ) : open ? (
        <>
          {cupRow(open.cups)}
          {grid((open.cups.sizes.length ? open.cups.rest : open.items).map((p) => tile('product', p)))}
        </>
      ) : (
        <>
          {sections.filter((x) => x.cups.sizes.length).map((x) => <div key={x.section.key}>{cupRow(x.cups)}</div>)}
          <div className="grid grid-cols-2 gap-2">
            {sections.map(({ section, items: xs, cups }) => (cups.sizes.length && !cups.rest.length ? null
              : <GroupTile dense={!browse} key={section.key} emoji={section.emoji} label={tMaybe(section.label)} n={cups.sizes.length ? cups.rest.length : xs.length} onClick={() => setSp({ sec: section.key })} />))}
          </div>
        </>
      )}
      {!items.length && <p className="text-center text-slate-500">{t('ما في شي هني بعد')}</p>}
    </MomPage>
  );
}

export function GroupTile({ emoji, label, sub, n, onClick, dense }: { emoji: string; label: string; sub?: string; n: number; onClick: () => void; dense?: boolean }) {
  return (
    <button onClick={onClick} className={cx('flex flex-col items-center justify-center gap-1 rounded-2xl border border-slate-100 bg-white p-2 active:opacity-80', dense ? 'min-h-[84px]' : 'min-h-[112px]')}>
      <span aria-hidden className={cx('leading-none', dense ? 'text-[30px]' : 'text-[40px]')}>{emoji}</span>
      <span className={cx('line-clamp-2 text-center font-bold leading-tight', dense ? 'text-[14px]' : 'text-[16px]')}>{label}</span>
      {sub && <span className="text-center text-[14px] leading-tight text-slate-500">{sub}</span>}
      <span className="num text-[14px] text-slate-500">{n}</span>
    </button>
  );
}

/** One group's page (/mom/food/g/:key, /mom/add/g/:key): its sub-groups as big tiles (chicken, meat, fish…) when
 *  it has more than one; a sub-group's page (…/g/:key/:sub) lists its foods, what is at home first. */
export function MomGroup({ browse = false }: { browse?: boolean }) {
  const nav = useNavigate();
  const { key, sub } = useParams() as { key: string; sub?: string };
  const gr = groupByKey(key);
  const { products, homeFirst, tile, grid } = useFoods(browse);
  const inGroup = products.filter((p) => groupOf(p.category).key === key);
  const subs = subgroupsIn(inGroup, key);
  const base = `${browse ? '/mom/food' : '/mom/add'}/g/${key}`;
  const one = subs.find((x) => x.sub.key === sub)?.sub ?? null;
  const list = homeFirst(one ? inGroup.filter((p) => subgroupOf(p)?.key === one.key) : inGroup);
  const bar = useCompareBar(browse), back = useBack(one || sub === 'all' ? base : browse ? '/mom/food' : '/mom/add?browse=groups');
  const title = one ? `${one.emoji} ${tMaybe(one.label)}` : gr ? `${gr.emoji} ${tMaybe(gr.label)}` : t('أكل');
  if (!one && sub !== 'all' && subs.length > 1) return (
    <MomPage compact={!browse} title={title} back={back} foot={bar}>
      <div className="grid grid-cols-2 gap-2">
        {subs.map(({ sub: x, n }) => <GroupTile dense={!browse} key={x.key} emoji={x.emoji} label={tMaybe(x.label)} n={n} onClick={() => nav(`${base}/${x.key}`)} />)}
      </div>
      <button className="min-h-[48px] text-[16px] font-bold text-brand" onClick={() => nav(`${base}/all`)}>{t('الكل')} ({inGroup.length})</button>
    </MomPage>
  );
  return (
    <MomPage compact={!browse} title={title} back={back} foot={bar}>
      {list.length ? grid(list.map((p) => tile('product', p))) : <p className="text-center text-slate-500">{t('ما في شي هني بعد')}</p>}
    </MomPage>
  );
}

/** One item: its picture and label facts, Dad's portions first, then a label serving or grams (a recipe: plates).
 *  Nothing preselected unless changing an item already on the plate. */
export function MomPortion() {
  const { kind, id } = useParams() as { kind: 'product' | 'recipe'; id: string };
  const [sp] = useSearchParams();
  // a fresh page for each food (and each item changed): a choice never carries over to another food
  return <PortionPage key={`${kind}:${id}:${sp.get('k') ?? ''}`} kind={kind} id={id} k={sp.get('k')} />;
}

function PortionPage({ kind, id, k }: { kind: 'product' | 'recipe'; id: string; k: string | null }) {
  const nav = useNavigate();
  const d = useDraft();
  const { c, itemCarbs, recipeGi, carbParts, nameOf, photoOf } = useCatalog();
  const rGi = kind === 'recipe' ? recipeGi(id) : null;
  const mine = c.portions.filter((p) => (kind === 'product' ? p.product_id === id : p.recipe_id === id));
  const prod = kind === 'product' ? c.products.find((p) => p.id === id) ?? null : null;
  const ss = prod?.serving_size ? Number(prod.serving_size) : null;
  const pack = prod?.pack_size && Number(prod.pack_size) <= 500 && Number(prod.pack_size) !== ss ? Number(prod.pack_size) : null;
  // a small pack that is one serving (a 15 g sweet): offered as «the whole pack», which is what she eats
  const packIsServing = !!prod && !prod.per_item && !!ss && Number(prod.pack_size) === ss;
  const gUnit = prod?.unit === 'ml' ? t('مل') : t('غرام');
  const cur = k !== null ? d.items[Number(k)] ?? null : null;
  const each = !!prod?.per_item; // sold by the item: a count, never grams
  // the choice: one of Dad's portions, or 'serving' / 'g' / 'plate' / 'cup' with an amount. Nothing is chosen for
  // her: a new food starts empty (her last amount is only suggested); changing one starts from what it was
  const [sel, setSel] = useState<string | null>(cur ? cur.portion_id ?? cur.unit ?? null : null);
  const [amt, setAmt] = useState<number | null>(cur && !cur.portion_id ? cur.amount ?? null : null);
  const [more, setMore] = useState(false);
  const free = sel === 'serving' || sel === 'g' || sel === 'plate' || sel === 'cup';
  const item: MomItem | null = !sel ? null : free ? (amt && amt > 0 ? { kind, id, portion_id: null, amount: amt, unit: sel as 'serving' | 'g' | 'plate' | 'cup' } : null) : { kind, id, portion_id: sel };
  const g = item ? itemCarbs(item) : null;
  const x = photoOf({ kind, id });
  const pick = (v: string, a: number | null) => { setSel(v); setAmt(a); };
  const done = () => {
    if (!item || g === null) return;
    if (k !== null) draftOps.replace(Number(k), item); else draftOps.add(item);
    remember({ kind, id });
    rememberPortion(item);
    nav('/mom/meal', { replace: true });
  };
  const carbsText = (v: number | null) => (v === null ? '' : v === 0 ? t('بدون كارب') : `${gramsText(v)} ${t('غرام كارب')}`);
  const step = sel === 'g' ? (ss && ss < 40 ? 5 : 10) : 0.5;
  // a home dish can be weighed: carbs for 100 g of what is in the pot; what is served on the side is added apart
  const plate = !prod ? itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'plate' }) : null;
  const per100 = !prod ? itemCarbs({ kind, id, portion_id: null, amount: 100, unit: 'g' }) : null;
  const per100p = prod && !each ? itemCarbs({ kind, id, portion_id: null, amount: 100, unit: 'g' }) : null;
  const serving = prod && ss ? itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'serving' }) : null;
  const rec = !prod ? c.recipes.find((r) => r.id === id) ?? null : null;
  const pot = rec ? recipePot(rec, c.ingsByRecipe.get(rec.id) ?? [], c.products) : null;
  // one cup only: Dad's own cup portion, when he made one, rather than the estimate
  const dadCup = mine.some((p) => /كوب|cup/i.test(p.label)); // i18n-ok: matches Dad's portion names
  const cups = dadCup ? null : pot?.cups ?? null;
  const cup = cups ? itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'cup' }) : null;
  // the parts that hold the carbs (the rice of a machboos), offered when they hold most of the dish's carbs
  const parts = rec ? carbParts(rec.id) : [];
  const partsCarbs = parts.reduce((a, p) => a + (itemCarbs({ kind: 'product', id: p.product.id, portion_id: null, amount: p.q, unit: 'g', ...(p.cooked ? { cooked: true } : {}) }) ?? 0), 0);
  const partsOk = parts.length > 0 && plate !== null && plate > 0 && partsCarbs / plate >= 0.6;
  const sides = !prod ? (c.ingsByRecipe.get(id) ?? []).filter((i) => i.on_side).map((i) => tMaybe(i.label ?? c.products.find((p) => p.id === i.product_id)?.name ?? '')).filter(Boolean) : [];

  // every way to say how much, each with its carbs
  type Opt = { key: string; sel: string; amount: number | null; icon: ReactNode; label: string; sub: string; dad: boolean; go?: () => void };
  const approx = (on: boolean | undefined) => (on ? ` · ${t('تقريبي')}` : '');
  // Dad's portions say it best: a ready-made amount with the same carbs as one of them is not offered again, and a
  // way to count (servings, plates, cups) that starts where one of his portions is says it is for another number
  const dadCarbs = mine.map((p) => itemCarbs({ kind, id, portion_id: p.id }));
  const likeDad = (v: number | null) => v !== null && dadCarbs.some((d) => d !== null && Math.abs(d - v) < 0.05);
  const packCarbs = prod && pack ? itemCarbs({ kind, id, portion_id: null, amount: pack, unit: 'g' }) : null;
  const opts: Opt[] = [
    ...mine.map((p) => ({ key: 'p:' + p.id, sel: p.id, amount: null, icon: p.photo_path ? <Photo path={p.photo_path} className="h-9 w-9" /> : '⭐', label: tMaybe(p.label), sub: carbsText(itemCarbs({ kind, id, portion_id: p.id })), dad: true })),
    ...(prod && ss ? [{ key: 'serving', sel: 'serving', amount: 1, icon: each ? '🔢' : packIsServing ? '📦' : '🥄',
      label: likeDad(serving) ? (each ? t('عدد ثاني من الحبات') : packIsServing ? t('عدد ثاني من العلب') : t('عدد ثاني من الحصص')) : each ? t('بالعدد') : packIsServing ? t('بالعلبة') : t('بالحصة'),
      sub: each ? t('الحبة = {g}', { g: carbsText(serving) }) : packIsServing ? t('العلبة = {s} {u} · {g}', { s: fmt(ss), u: gUnit, g: carbsText(serving) }) : t('حصة = {s} {u} · {g}', { s: fmt(ss), u: gUnit, g: carbsText(serving) }), dad: false }] : []),
    ...(prod && pack && !each && !likeDad(packCarbs) ? [{ key: 'pack', sel: 'g', amount: pack, icon: '📦', label: t('العلبة كاملة'), sub: `${fmt(pack)} ${gUnit} · ${carbsText(itemCarbs({ kind, id, portion_id: null, amount: pack, unit: 'g' }))}`, dad: false }] : []),
    ...(prod && !each ? [{ key: 'g', sel: 'g', amount: null, icon: '⚖️', label: prod.unit === 'ml' ? t('بالمل') : t('بالغرام'), sub: t('كل 100 {u} = {g}', { u: gUnit, g: carbsText(per100p) }), dad: false }] : []),
    ...(!prod && cup !== null ? [{ key: 'cup', sel: 'cup', amount: 0.5, icon: '🥣', label: likeDad(cup) ? t('عدد ثاني من الأكواب') : t('بالكوب'), sub: t('الكوب = {g}', { g: carbsText(cup) }) + approx(pot?.cupsApprox), dad: false }] : []),
    ...(!prod && per100 !== null ? [{ key: 'g', sel: 'g', amount: null, icon: '⚖️', label: t('وزنتها بالميزان'), sub: t('كل 100 غرام = {g}', { g: carbsText(per100) }) + approx(pot?.gApprox), dad: false }] : []),
    ...(!prod && partsOk ? [{ key: 'parts', sel: '', amount: null, icon: '🍚', label: t('وزنت اللي فيه كارب بروحه'), sub: parts.map((p) => shownName(p.product)).join(' · '), dad: false,
      go: () => nav(`/mom/parts/${id}${k !== null ? `?k=${k}` : ''}`, { replace: true }) }] : []),
    ...(!prod && plate !== null ? [{ key: 'plate', sel: 'plate', amount: 1, icon: '🍽️', label: likeDad(plate) ? t('عدد ثاني من الصحون') : t('بالصحون'), sub: t('الصحن = {g}', { g: carbsText(plate) }), dad: false }] : []),
  ];
  const packShown = opts.some((o) => o.key === 'pack');
  const isOn = (o: Opt) => !!sel && o.sel === sel && (o.key === 'pack' ? amt === pack : o.key === 'g' && packShown ? amt !== pack : true);
  // her last amount for this food, shown first and marked — never chosen for her
  const last = k === null ? lastPortion(kind, id) : null;
  const lastOpt = last ? opts.find((o) => (last.portion_id ? o.key === 'p:' + last.portion_id : last.unit === 'g' && pack !== null && last.amount === pack ? o.key === 'pack' : o.sel === last.unit && o.key !== 'pack')) ?? null : null;
  const lastAmount = lastOpt && !last?.portion_id && lastOpt.key !== 'pack' ? last?.amount ?? null : null;
  const lastCarbs = last ? itemCarbs({ kind, id, portion_id: last.portion_id ?? null, ...(last.portion_id ? {} : { amount: last.amount, unit: last.unit }) } as MomItem) : null;
  const dadOpts = opts.filter((o) => o.dad && o !== lastOpt), otherOpts = opts.filter((o) => !o.dad && o !== lastOpt);
  const showOthers = more || !dadOpts.length || otherOpts.some(isOn);
  const unitWord = sel === 'g' ? gUnit : sel === 'serving' ? (each ? t('حبة') : packIsServing ? t('علبة') : t('حصة')) : sel === 'cup' ? t('كوب') : t('صحن');
  const amountEditor = (
    <div className="flex items-center justify-center gap-3 rounded-2xl bg-white py-2">
      <button aria-label="+" className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-2xl font-bold text-brand" onClick={() => setAmt(Math.round(((amt ?? 0) + step) * 10) / 10)}>+</button>
      {sel === 'g'
        ? <input inputMode="decimal" dir="ltr" autoFocus={amt === null} className={cx(inputCls, '!w-28 !text-center !text-[26px] font-bold')} value={amt ?? ''} onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); setAmt(e.target.value === '' || !Number.isFinite(v) ? null : v); }} />
        : <span className="num w-20 text-center text-[34px] font-extrabold">{amt === null ? '—' : fmt(amt)}</span>}
      <button aria-label="−" className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-2xl font-bold text-brand" onClick={() => setAmt(Math.max(0, Math.round(((amt ?? 0) - step) * 10) / 10))}>−</button>
      <span className="text-[16px] text-slate-500">{unitWord}</span>
    </div>
  );
  const render = (o: Opt, mark?: boolean) => {
    const on = !o.go && isOn(o);
    const editing = on && free && o.key !== 'pack';
    return (
      <div key={o.key + (mark ? '-last' : '')} className="space-y-2">
        <Choice dense icon={o.icon} on={on} onClick={() => (o.go ? o.go() : pick(o.sel, mark && lastAmount !== null ? lastAmount : on ? amt : o.amount))}
          label={mark ? <>{o.label}{lastAmount !== null && ` · ${fmt(lastAmount)} ${o.sel === 'g' ? gUnit : o.sel === 'cup' ? t('كوب') : o.sel === 'plate' ? t('صحن') : ''}`}</> : o.label}
          sub={mark ? <><span className="me-1 rounded-full bg-near-soft px-2 py-0.5 text-[12px] font-bold text-near">{t('آخر مرة')}</span>{carbsText(lastCarbs)}</> : o.sub} />
        {editing && amountEditor}
      </div>
    );
  };
  return (
    <MomPage compact title={nameOf({ kind, id })} foot={<>
      {/* the carbs of what is chosen, always in view; nothing to add until she chooses */}
      <div className="text-center">{item && g !== null ? <span className="text-[22px] font-bold text-brand">{g === 0 ? t('بدون كارب') : <><span className="num">{gramsText(g)}</span> {t('غرام كارب')}</>}</span> : <span className="text-[16px] text-slate-500">{t('اختاري الكمية')}</span>}</div>
      <Big md disabled={!item || g === null} onClick={done}>{k !== null ? t('تم') : t('إضافة')}</Big>
    </>}>
      <div className="flex items-center gap-3 rounded-2xl bg-white p-2.5">
        <Photo {...pic(x)} className="h-16 w-16 shrink-0 rounded-xl" />
        {prod ? (
          <div className="min-w-0 space-y-0.5 text-[15px]">
            {each ? <div><b className="num">{fmt(Number(prod.carbs_per_100))}</b> {t('غرام كارب بالحبة')}</div> : <div><b className="num">{fmt(Number(prod.carbs_per_100))}</b> {t('غرام كارب بكل 100 {u}', { u: gUnit })}</div>}
            {prod.brand && <div className="text-[13px] text-slate-500"><bdi>{prod.brand}</bdi></div>}
            <GiBadge food={prod} />
          </div>
        ) : <div className="min-w-0 space-y-0.5 text-[15px]">
          {plate !== null && <div>{t('الصحن الواحد = {g}', { g: carbsText(plate) })}</div>}
          {rGi && <GiBadge food={{ gi: rGi.gi, gi_match: rGi.approx ? 'similar' : 'exact' }} />}
        </div>}
      </div>
      <h2 className="text-[17px] font-bold">{t('كم أكلت؟')}</h2>
      {lastOpt && render(lastOpt, true)}
      {dadOpts.map((o) => render(o))}
      {otherOpts.length > 0 && (showOthers ? otherOpts.map((o) => render(o))
        : <button className="min-h-[48px] rounded-2xl border border-dashed border-slate-300 text-[16px] font-bold text-brand" onClick={() => setMore(true)}>{t('كمية ثانية')} ▾</button>)}
      {(sel === 'cup' || (sel === 'g' && !prod)) && (pot?.cupsApprox || pot?.gApprox) && <p className="text-center text-[13px] text-slate-500">{t('تقريبي: من مقادير الوصفة. للدقة بابا يقيس القدر مرة وحدة.')}</p>}
      {sel === 'g' && <p className="rounded-2xl bg-brand-soft px-4 py-2.5 text-[15px] leading-relaxed text-brand">⚖️ {t('حطي الصحن فاضي على الميزان واضغطي ON لين يصير 0، بعدين حطي الأكل.')}</p>}
      {sel === 'g' && sides.length > 0 && <p className="text-center text-[14px] text-slate-600">{t('{x} على الجنب: إذا أكلته أضيفيه بروحه', { x: sides.join(' · ') })}</p>}
      {k !== null && <button className="min-h-[44px] font-bold text-over" onClick={() => { draftOps.remove(Number(k)); nav('/mom/meal', { replace: true }); }}>{t('شيليه من الصحن')}</button>}
    </MomPage>
  );
}

/** Not in Layan's list: a photo and a name go to Dad; no dose is ever worked out for it. */
export function MomNew() {
  const nav = useNavigate();
  const { reload, products } = useData();
  const [sp] = useSearchParams();
  const [name, setName] = useState(() => sp.get('name') ?? ''); // what she searched for
  // the carbs for one piece, read off the label: with its photo, the food goes on the plate and counts like any other
  const [carbsText, setCarbsText] = useState('');
  const carbs = carbsText.trim() === '' ? null : Number(carbsText.replace(',', '.'));
  const carbsBad = carbs !== null && !(carbs >= 0 && carbs <= 150);
  const withCarbs = carbs !== null && !carbsBad;
  // the same name already in the list: that one is offered, so a food is never entered twice
  const same = name.trim().length >= 2 ? products.find((p) => p.approved && matchTier([p.name, p.name_ar, p.name_en], [], name) === 0) ?? null : null;
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null), camera = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);
  const send = async () => {
    setBusy(true);
    try {
      if (withCarbs) {
        const photo = await uploadPhoto(file!, 'products');
        const { portionId, productId } = await saveLabelFood({ name, carbs: carbs!, photo });
        draftOps.add({ kind: 'product', id: productId, portion_id: portionId });
        await reload();
        toast(t('انضاف للوجبة ✓'));
        nav('/mom/meal', { replace: true });
        return;
      }
      const photo = file ? await uploadPhoto(file, 'products') : null;
      const { error } = await supabase.from('products').insert({ name: name.trim(), brand: null, category: 'أخرى', kind: 'commercial', image_path: photo, unit: 'g', carbs_per_100: 0, approved: false, available: true, // i18n-ok: stored value
        notes: 'من ماما: ينتظر بابا يكمّل الملصق والكميات' }); // i18n-ok: stored note
      if (error) throw new Error(error.message);
      await reload(); setSent(true);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  if (sent) return (
    <MomPage title={t('انرسل لبابا ✓')} back="/mom/meal">
      <p className="text-center text-[18px] text-slate-600">{t('وبالحين؟')}</p>
      <Big onClick={() => { draftOps.leaveOut(name.trim()); nav('/mom/meal', { replace: true }); }}>{t('كمّلي الوجبة بدونه')}</Big>
      <Big tone="ghost" onClick={() => nav('/mom', { replace: true })}>{t('انتظري بابا')}</Big>
      <Big tone="ghost" onClick={() => nav('/mom/out', { replace: true })}>🍽️ {t('أكل برّا · ما أعرف الكارب')}</Big>
      <p className="mt-auto text-center text-sm text-slate-500">{t('ما نحسب إبرة لشي مو مؤكد')}</p>
    </MomPage>
  );
  return (
    <MomPage title={t('مو موجود')} back="/mom/add">
      {/* a photo of the food or its label: taken now, or one already on the phone */}
      <div className="grid place-items-center rounded-3xl border-2 border-dashed border-slate-300 bg-white p-3 text-center">
        {file ? <img src={preview!} alt="" className="h-44 rounded-2xl object-cover" /> : <span className="py-3"><span className="block text-5xl">📷</span><b className="text-[18px]">{t('صورة الأكل أو الملصق')}</b></span>}
      </div>
      <div className="grid grid-cols-2 gap-2">
        <Big tone="soft" className="!min-h-[52px] !text-[17px]" onClick={() => camera.current?.click()}>📷 {file ? t('صوّري غيرها') : t('صوّري')}</Big>
        <Big tone="soft" className="!min-h-[52px] !text-[17px]" onClick={() => input.current?.click()}>🖼️ {t('من الصور')}</Big>
      </div>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />
      <input ref={input} type="file" accept="image/*" className="hidden" onChange={(e) => { const f = e.target.files?.[0]; if (f) setFile(f); e.target.value = ''; }} />
      <input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('الاسم')} maxLength={60} />
      {same && <button onClick={() => nav(`/mom/item/product/${same.id}`)} className="min-h-[48px] rounded-2xl bg-ok-soft px-4 text-[16px] font-bold text-ok">✓ {t('موجود عندنا: {n}', { n: tMaybe(same.name) })} ›</button>}
      <div className="rounded-3xl bg-white p-4">
        <div className="text-[17px] font-bold">{t('كم كارب بالحبة؟')} <span className="text-[14px] font-normal text-slate-500">({t('من الملصق · اختياري')})</span></div>
        <input className={cx(inputCls, 'num mt-2', carbsBad && 'border-over')} inputMode="decimal" dir="ltr" value={carbsText} onChange={(e) => setCarbsText(e.target.value.replace(/[^\d.,]/g, ''))} placeholder={t('مثلًا 11')} />
        <p className="mt-1.5 text-[14px] text-slate-500">{withCarbs ? (file ? t('ينضاف للوجبة وتشوفين الإبرة حسب خطة الدكتور') : t('صوّري الملصق عشان ينحسب')) : t('بدون رقم: ينرسل لبابا وما تنحسب له إبرة')}</p>
      </div>
      <Big disabled={busy || !name.trim() || carbsBad || (withCarbs && !file)} onClick={send}>{withCarbs ? `✓ ${t('أضيفيه للوجبة')}` : t('أرسليه لبابا')}</Big>
    </MomPage>
  );
}

/** «التغذية»: one food's values — carbs first, then sugar, fat, protein, fiber, calories — per 100 and per serving
 *  (a recipe: per plate), then its household portions. A value the label does not give shows «—», never 0. Then add
 *  it to a meal, or to the compare list. */
export function MomFoodItem() {
  const nav = useNavigate();
  const { kind, id } = useParams() as { kind: 'product' | 'recipe'; id: string };
  const { products, settings } = useData();
  const { c, nameOf, photoOf, itemCarbs } = useCatalog();
  const x = photoOf({ kind, id });
  const prod = kind === 'product' ? products.find((p) => p.id === id) ?? null : null;
  const back = useBack('/mom/food');
  const cmp = useCompare();
  const inCompare = cmp.some((r) => r.kind === kind && r.id === id);
  const mine = c.portions.filter((p) => (kind === 'product' ? p.product_id === id : p.recipe_id === id));
  const u = prod?.unit === 'ml' ? t('مل') : t('غرام');
  const n = (v: number | null | undefined, f = 1) => (v === null || v === undefined || Number.isNaN(Number(v)) ? null : Math.round(Number(v) * f * 10) / 10);
  type Row = { label: string; a: number | null; b: number | null; unit: string; main?: boolean };
  let head: [string, string | null], rows: Row[];
  if (prod) {
    const ss = prod.serving_size && !prod.per_item ? Number(prod.serving_size) : null, f = ss ? ss / 100 : null;
    const both = (v: number | null | undefined) => ({ a: n(v), b: f === null ? null : n(v, f) });
    head = [prod.per_item ? t('الحبة الوحدة') : t('بكل 100 {u}', { u }), ss ? t('الحصة {s} {u}', { s: fmt(ss), u }) : null];
    rows = [
      { label: t('كارب'), ...both(prod.carbs_per_100), unit: t('غرام'), main: true },
      { label: t('سكر'), ...both(prod.sugar_per_100), unit: t('غرام') },
      ...(prod.sugar_added_per_100 !== null && prod.sugar_added_per_100 !== undefined ? [{ label: t('سكر مضاف'), ...both(prod.sugar_added_per_100), unit: t('غرام') }] : []),
      { label: t('دهون'), ...both(prod.fat_per_100), unit: t('غرام') },
      { label: t('بروتين'), ...both(prod.protein_per_100), unit: t('غرام') },
      { label: t('ألياف'), ...both(prod.fiber_per_100), unit: t('غرام') },
      { label: t('سعرات'), ...both(prod.kcal_per_100), unit: '' },
    ];
  } else {
    const items = planItemsOf({ kind, id, portion_id: null, amount: 1, unit: 'plate' }, c);
    const m = items ? planMeal(items, products, settings) : null;
    const v = (k: 'carbs' | 'fat' | 'protein' | 'fiber' | 'kcal') => (!m || (k === 'carbs' ? !m.complete : m.missing[k]) ? null : n(m.total[k]));
    head = [t('الصحن الواحد'), null];
    rows = [
      { label: t('كارب'), a: v('carbs'), b: null, unit: t('غرام'), main: true },
      { label: t('دهون'), a: v('fat'), b: null, unit: t('غرام') },
      { label: t('بروتين'), a: v('protein'), b: null, unit: t('غرام') },
      { label: t('ألياف'), a: v('fiber'), b: null, unit: t('غرام') },
      { label: t('سعرات'), a: v('kcal'), b: null, unit: '' },
    ];
  }
  const cell = (v: number | null, r: Row) => (v === null ? <span className="text-slate-400">—</span> : <span className={r.main ? 'text-[22px] font-extrabold text-brand' : 'font-bold'}>{fmt(v)}{r.unit ? <span className="text-[13px] font-normal text-slate-500"> {r.unit}</span> : null}</span>);
  return (
    <MomPage title={nameOf({ kind, id })} back={back} foot={<>
      {inCompare || cmp.length >= COMPARE_MAX
        ? <Big tone="soft" onClick={() => nav('/mom/compare')}>⚖️ {t('شوفي المقارنة ({n})', { n: cmp.length })}</Big>
        : <Big tone="soft" onClick={() => compareOps.add({ kind, id })}>⚖️ {t('قارني')}</Big>}
      <Big onClick={() => { if (!okToReplace('now')) { nav('/mom/meal'); return; } draftOps.start('now'); nav(`/mom/item/${kind}/${id}`); }}>🍽️ {t('أضيفيها لوجبة')}</Big>
    </>}>
      <Photo {...pic(x)} className="mx-auto h-36 w-36 shrink-0 rounded-3xl" />
      {prod?.brand && <p className="text-center text-[15px] text-slate-500"><bdi>{prod.brand}</bdi></p>}
      <table className="w-full overflow-hidden rounded-3xl bg-white text-[17px]">
        <thead><tr className="text-[14px] text-slate-500"><th className="px-4 py-2 text-start font-normal" /><th className="px-2 py-2 font-normal">{head[0]}</th>{head[1] && <th className="px-2 py-2 font-normal">{head[1]}</th>}</tr></thead>
        <tbody className="divide-y divide-slate-100">
          {rows.map((r) => <tr key={r.label}><td className="px-4 py-2.5">{r.label}</td><td className="px-2 py-2.5 text-center">{cell(r.a, r)}</td>{head[1] && <td className="px-2 py-2.5 text-center">{cell(r.b, r)}</td>}</tr>)}
        </tbody>
      </table>
      {mine.length > 0 && (
        <section className="rounded-3xl bg-white px-4 py-2">
          <h2 className="py-1 text-[15px] text-slate-500">{t('كميات البيت')}</h2>
          <ul className="divide-y divide-slate-100 text-[17px]">
            {mine.map((p) => {
              const g = itemCarbs({ kind, id, portion_id: p.id }), gt = g === null ? '—' : fmt(g);
              return <li key={p.id} className="py-2.5"><bdi>{prod ? t('{p} ({a} {u}) = {g} غ كارب', { p: tMaybe(p.label), a: fmt(p.amount), u: prod.unit === 'ml' ? t('مل') : t('غ'), g: gt }) : t('{p} = {g} غ كارب', { p: tMaybe(p.label), g: gt })}</bdi></li>;
            })}
          </ul>
        </section>
      )}
    </MomPage>
  );
}

/** «وزنت اللي فيه كارب بروحه»: the parts of a home dish that hold its carbs (the rice of a machboos), each weighed
 *  on its own and typed in; they go on the plate as those foods. The rest of the dish (meat, sauce) adds no carbs
 *  worth counting only when it has none in the recipe, so the page says what is left out. */
export function MomParts() {
  const nav = useNavigate();
  const { id = '' } = useParams();
  const [sp] = useSearchParams();
  const k = sp.get('k');
  const { c, itemCarbs, carbParts, nameOf } = useCatalog();
  const parts = carbParts(id);
  const [g, setG] = useState<(number | null)[]>(() => parts.map(() => null));
  const items: MomItem[] = parts.flatMap((x, n) => (g[n] ? [{ kind: 'product' as const, id: x.product.id, portion_id: null, amount: g[n]!, unit: 'g' as const, ...(x.cooked ? { cooked: true } : {}) }] : []));
  const per = items.map((it) => itemCarbs(it));
  const partCarbs = (n: number) => { const i = items.findIndex((it) => it.id === parts[n].product.id); return i < 0 ? null : per[i]; };
  const total = items.length && per.every((v) => v !== null) ? Math.round(per.reduce((a, v) => a + v!, 0) * 10) / 10 : null;
  // what else in the dish has carbs and is not weighed here (a raw-weighed grain, a sauce): said, never guessed
  const rest = (c.ingsByRecipe.get(id) ?? []).filter((i) => i.role !== 'snack' && !parts.some((x) => x.product.id === i.product_id))
    .map((i) => ({ i, p: i.product_id ? c.products.find((x) => x.id === i.product_id) ?? null : null }))
    .filter(({ p }) => !p || Number(p.carbs_per_100) >= 5).map(({ i, p }) => (p ? shownName(p) : tMaybe(i.label ?? '')));
  const done = () => {
    if (k !== null) draftOps.remove(Number(k));
    items.forEach((it) => draftOps.add(it));
    nav('/mom/meal', { replace: true });
  };
  return (
    <MomPage compact title={nameOf({ kind: 'recipe', id })} foot={<>
      <div className="flex items-baseline justify-between px-1"><span className="text-[17px] text-slate-500">{t('الكارب')}</span><b className="num text-[26px]">{total === null ? '—' : `${gramsText(total)} ${t('غ كارب')}`}</b></div>
      <Big md disabled={!items.length || total === null} onClick={done}>{t('تم')}</Big>
    </>}>
      <p className="rounded-2xl bg-brand-soft px-4 py-2.5 text-center text-[16px] text-brand">⚖️ {t('صفّري الميزان قبل كل صنف')}</p>
      {parts.map((x, n) => (
        <div key={x.product.id} className="space-y-2 rounded-3xl bg-white px-4 py-3">
          <div className="flex items-center gap-2 text-[19px] font-bold"><span className="flex-1"><bdi>{shownName(x.product)}</bdi> {x.cooked && <span className="text-[14px] font-normal text-slate-500">{t('مطبوخ')}</span>}</span>
            <span className="num shrink-0 text-[18px] font-bold text-brand">{partCarbs(n) === null ? '' : `${gramsText(partCarbs(n)!)} ${t('غ')}`}</span></div>
          <div className="flex items-center justify-center gap-3" dir="ltr">
            <input inputMode="decimal" dir="ltr" placeholder="0" className={cx(inputCls, '!w-32 !text-center !text-[30px] font-bold')} value={g[n] ?? ''}
              onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); setG(g.map((o, m) => (m === n ? (e.target.value === '' || !Number.isFinite(v) || v <= 0 ? null : v) : o))); }} />
            <span className="text-[18px] text-slate-500">{t('غرام')}</span>
          </div>
        </div>
      ))}
      {rest.length > 0 && <p className="rounded-2xl bg-near-soft px-4 py-3 text-center text-[15px] font-bold text-near">⚠️ {t('ما ينحسب هنا: {x}. إذا أكلت منه أضيفيه بروحه.', { x: rest.join(' · ') })}</p>}
    </MomPage>
  );
}
