// Mom mode, building a meal from Layan's database: saved meals, recipes and products (grouped, with pictures), each
// in one of its portions. Every choice is a full page; the meal being built is kept on the phone.
import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { compareOps, draftOps, saveMeal, useCompare, useDraft, usePortions, useSavedMeals } from '../../lib/mom';
import { planMeal } from '../../lib/plans';
import { COMPARE_MAX, planItems, planItemsOf, readyForMom, type Catalog, type MomItem } from '../../engine/mom';
import { groupByKey, groupOf, groupsIn, subgroupOf, subgroupsIn } from '../../lib/productGroups';
import { matches } from '../../lib/search';
import { fmt } from '../../lib/carbs';
import { supabase, uploadPhoto } from '../../lib/supabase';
import { Photo, asset, cx, inputCls, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import { RESTAURANTS, cupsOf, menuOf, restaurantByKey, restaurantOf, type Restaurant } from '../../lib/restaurants';
import { foodName } from '../../lib/foodName';
import { Big, Choice, MomPage } from './MomUI';
import type { PlanItem, Product, Recipe } from '../../lib/types';

/** The catalogue Mom mode reads, and the carbs of any item or meal (null if any part is unknown). */
export function useCatalog() {
  const { products, recipes, ingsByRecipe, settings } = useData();
  const { portions } = usePortions();
  const c: Catalog = useMemo(() => ({ products, recipes, ingsByRecipe, portions }), [products, recipes, ingsByRecipe, portions]);
  const carbsOf = (items: PlanItem[] | null) => { if (!items) return null; const m = planMeal(items, products, settings); return m.complete ? Math.round(m.total.carbs * 10) / 10 : null; };
  const itemCarbs = (it: MomItem) => carbsOf(planItemsOf(it, c));
  const mealCarbs = (items: MomItem[]) => carbsOf(planItems(items, c));
  const nameOf = (it: { kind: 'product' | 'recipe'; id: string }) => tMaybe((it.kind === 'product' ? products : recipes).find((x) => x.id === it.id)?.name ?? '');
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
  return { c, carbsOf, itemCarbs, mealCarbs, nameOf, photoOf, firstPortion, tileCarbs };
}

/** What Photo needs for a product or recipe: its photo, its own emoji (generic foods), its category. */
export const pic = (x: Product | Recipe | null | undefined) => ({ path: x?.image_path, category: x?.category, emoji: x && 'emoji' in x ? x.emoji : null });

const RECENT = 'mom-recent-v1';
const recent = (): { kind: 'product' | 'recipe'; id: string }[] => { try { return JSON.parse(localStorage.getItem(RECENT) ?? '[]'); } catch { return []; } };
const remember = (x: { kind: 'product' | 'recipe'; id: string }) => {
  try { localStorage.setItem(RECENT, JSON.stringify([x, ...recent().filter((r) => !(r.kind === x.kind && r.id === x.id))].slice(0, 12))); } catch { /* blocked */ }
};

/** «وجبة ليان»: what is on her plate, the carb total (small), add more, then next. */
export function MomMeal() {
  const nav = useNavigate();
  const d = useDraft();
  const { itemCarbs, mealCarbs, nameOf, photoOf, c } = useCatalog();
  const { meals } = useSavedMeals();
  const total = mealCarbs(d.items);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const sameAsSaved = d.savedId && meals.find((m) => m.id === d.savedId && JSON.stringify(m.items) === JSON.stringify(d.items));
  const portionLabel = (it: MomItem) => it.portion_id ? tMaybe(c.portions.find((p) => p.id === it.portion_id)?.label ?? '')
    : `${fmt(it.amount ?? 0)} ${it.unit === 'serving' ? t('حصة') : it.unit === 'plate' ? t('صحن') : c.products.find((p) => p.id === it.id)?.unit === 'ml' ? t('مل') : t('غرام')}`;
  const Left = () => d.left.length ? <p className="rounded-2xl bg-over-soft px-4 py-3 text-center text-[17px] font-bold text-over">⚠️ <bdi>{d.left.join(' · ')}</bdi> {t('ما ينحسب بالإبرة · كلّمي بابا')}</p> : null;
  const title = d.mode === 'plan' ? t('خطة وجبة') : t('وجبة ليان');
  if (!d.items.length) return (
    <MomPage title={title} back="/mom">
      <Left />
      {meals.length > 0 && <h2 className="text-[17px] font-bold text-slate-500">⭐ {t('وجباتها')}</h2>}
      {meals.slice(0, 6).map((m) => <Choice key={m.id} icon="⭐" label={m.name} sub={m.items.map((i) => nameOf(i)).join(' · ')} onClick={() => draftOps.load(m)} />)}
      <Big tone={meals.length ? 'soft' : 'primary'} onClick={() => nav(meals.length ? '/mom/add?tab=recipes' : '/mom/add')}>+ {t('شي ثاني')}</Big>
    </MomPage>
  );
  return (
    <MomPage title={d.name ?? title} back="/mom" foot={<Big disabled={total === null} onClick={() => nav(d.mode === 'plan' ? '/mom/when' : '/mom/dose')}>{d.mode === 'plan' ? `${t('التالي')} · 🕐 ${t('متى؟')}` : t('التالي')}</Big>}>
      <ul className="divide-y divide-slate-100 rounded-3xl border border-slate-100 bg-white px-3">
        {d.items.map((it, k) => {
          const g = itemCarbs(it), p = photoOf(it);
          return (
            <li key={k} className="flex items-center gap-3 py-2.5">
              <button onClick={() => nav(`/mom/item/${it.kind}/${it.id}?k=${k}`)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                <Photo {...pic(p)} className="h-14 w-14 shrink-0 rounded-xl" />
                <span className="min-w-0 flex-1"><b className="block truncate text-[18px]"><bdi>{nameOf(it)}</bdi></b><span className="text-[15px] text-slate-500"><bdi>{portionLabel(it)}</bdi></span></span>
                <span className="text-[15px] text-slate-500">{g === null ? '—' : g < 1 ? t('بدون كارب') : `${fmt(g)} ${t('غرام')}`}</span>
              </button>
            </li>
          );
        })}
      </ul>
      <Left />
      <div className="flex items-baseline justify-between px-1 text-slate-500"><span>{t('الكارب')}</span><b className="num text-[22px] text-slate-900">{total === null ? '—' : `${fmt(total)} ${t('غرام')}`}</b></div>
      <Big tone="soft" onClick={() => nav('/mom/add')}>+ {t('إضافة شي')}</Big>
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

/** Back to where she came from; to `home` when the page was opened directly (nothing to go back to). */
export function useBack(home: string): string | number {
  return useLocation().key === 'default' ? home : -1;
}

/** One food as a tile: its picture (photo or emoji), name, and carbs (per its first portion, else per 100). */
function FoodTile({ x, carbs, onClick }: { x: Product | Recipe; carbs: string | null; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1 rounded-2xl border border-slate-100 bg-white p-2 active:opacity-80">
      <Photo {...pic(x)} className="h-24 w-full rounded-xl" />
      <span className="line-clamp-2 text-center text-[17px] font-bold leading-tight"><bdi>{tMaybe(x.name)}</bdi></span>
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
  const tile = (kind: 'product' | 'recipe', x: Product | Recipe) => <FoodTile key={kind + x.id} x={x} carbs={cat.tileCarbs(kind, x.id)} onClick={() => pick(kind, x.id)} />;
  return { ...cat, products, recipes, homeFirst, tile, pick };
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
  const tab = (sp.get('tab') ?? (meals.length && !browse ? 'saved' : 'products')) as 'saved' | 'recipes' | 'products' | 'restaurants';
  const [q, setQ] = useState('');
  const { c, mealCarbs, nameOf, products, recipes, homeFirst, tile } = useFoods(browse);
  const rec = recent().filter((r) => readyForMom(r.kind, r.id, c)).slice(0, 4);
  const find = (kind: 'product' | 'recipe', id: string) => ((kind === 'product' ? c.products : c.recipes) as (Product | Recipe)[]).find((y) => y.id === id)!;
  // searching finds every approved food in every group (restaurants, things not bought yet), what is at home first
  const found = q.trim() ? homeFirst(products.filter((p) => matches([p.name, p.brand, p.category], q))) : [];
  const foundRecipes = q.trim() ? recipes.filter((r) => matches([r.name, r.category], q)) : [];
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

/** A restaurant's badge: its colours and letters, standing in for the logo. */
export function RestaurantLogo({ r, size = 56 }: { r: Restaurant; size?: number }) {
  if (r.logo) return <img src={asset(r.logo)} alt="" aria-hidden className="shrink-0 object-contain" style={{ width: size, height: size }} />;
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
  const [q, setQ] = useState('');
  const r = restaurantByKey(key);
  const { products, tile, pick } = useFoods(browse);
  const items = products.filter((p) => restaurantOf(p.brand)?.key === key);
  const bar = useCompareBar(browse), menuBack = useBack(`${browse ? '/mom/food' : '/mom/add'}?tab=restaurants`);
  // frozen yogurt (and any food sold in sizes): size first, then the flavour
  const cup = sp.get('cup');
  const sections = menuOf(items, r?.lead).map((x) => ({ ...x, cups: cupsOf(x.items) }));
  const sized = sections.find((x) => x.cups.sizes.length);
  const flavour = (p: Product) => foodName(p).replace(/\s*\([^)]*\)\s*$/, '');
  if (sized && cup) {
    const size = sized.cups.sizes.find((x) => x.size.key === cup);
    const here = `${browse ? '/mom/food' : '/mom/add'}/r/${key}`, back = size ? `${here}?cup=choose` : here;
    return (
      <MomPage title={size ? `${size.size.emoji} ${tMaybe(size.size.label)}` : t('أي حجم؟')} back={back} foot={bar}>
        {!size && sized.cups.sizes.map(({ size: z, items: xs }) => {
          const cs = xs.map((x) => Number(x.item.carbs_per_100));
          return <Choice key={z.key} icon={z.emoji} label={tMaybe(z.label)} sub={t('{a}–{b} غ كارب', { a: `\u2066${fmt(Math.min(...cs))}`, b: `${fmt(Math.max(...cs))}\u2069` })} onClick={() => setSp({ cup: z.key }, { replace: true })} />;
        })}
        {size && <h2 className="text-[18px] font-bold">{t('أي نكهة؟')}</h2>}
        {size && size.items.map(({ item }) => <Choice key={item.id} icon="🍦" label={flavour(item)} sub={t('{g} غ كارب', { g: fmt(Number(item.carbs_per_100)) })} onClick={() => pick('product', item.id)} />)}
      </MomPage>
    );
  }
  // the menu as section tiles (burgers, drinks, fruit…); a tap opens that section only; typing searches the whole menu
  const sec = sp.get('sec');
  const open = sections.find((x) => x.section.key === sec) ?? (sections.length === 1 ? sections[0] : null);
  const found = q.trim() ? items.filter((p) => matches([p.name, p.name_ar ?? '', p.category], q)) : [];
  const cupRow = (cups: (typeof sections)[number]['cups']) => cups.sizes.length > 0 && (
    <Choice icon="🍦" label={t('كوب: اختاري الحجم ثم النكهة')} sub={t('{n} نكهات', { n: new Set(cups.sizes.flatMap((z) => z.items.map((x) => x.flavour))).size })} onClick={() => setSp({ cup: 'choose' })} />
  );
  const here = `${browse ? '/mom/food' : '/mom/add'}/r/${key}`;
  return (
    <MomPage title={open && sections.length > 1 ? `${open.section.emoji} ${tMaybe(open.section.label)}` : r ? tMaybe(r.label) : t('مطاعم')} back={open && sections.length > 1 ? here : menuBack} foot={bar}>
      {!open && r && <div className="flex justify-center"><RestaurantLogo r={r} size={64} /></div>}
      {!open && <input className={inputCls} type="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحثي في المنيو')} />}
      {q.trim() && !open ? (
        found.length ? <div className="grid grid-cols-2 gap-2">{found.map((p) => tile('product', p))}</div> : <p className="text-center text-slate-500">{t('ما في شي بهالاسم')}</p>
      ) : open ? (
        <>
          {cupRow(open.cups)}
          <div className="grid grid-cols-2 gap-2">{(open.cups.sizes.length ? open.cups.rest : open.items).map((p) => tile('product', p))}</div>
        </>
      ) : (
        <>
          {sections.filter((x) => x.cups.sizes.length).map((x) => <div key={x.section.key}>{cupRow(x.cups)}</div>)}
          <div className="grid grid-cols-2 gap-2">
            {sections.map(({ section, items: xs, cups }) => (cups.sizes.length && !cups.rest.length ? null
              : <GroupTile key={section.key} emoji={section.emoji} label={tMaybe(section.label)} n={cups.sizes.length ? cups.rest.length : xs.length} onClick={() => setSp({ sec: section.key })} />))}
          </div>
        </>
      )}
      {!items.length && <p className="text-center text-slate-500">{t('ما في شي هني بعد')}</p>}
    </MomPage>
  );
}

function GroupTile({ emoji, label, sub, n, onClick }: { emoji: string; label: string; sub?: string; n: number; onClick: () => void }) {
  return (
    <button onClick={onClick} className="flex min-h-[112px] flex-col items-center justify-center gap-1 rounded-2xl border border-slate-100 bg-white p-2 active:opacity-80">
      <span aria-hidden className="text-[40px] leading-none">{emoji}</span>
      <span className="line-clamp-2 text-center text-[16px] font-bold leading-tight">{label}</span>
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
  const { products, homeFirst, tile } = useFoods(browse);
  const inGroup = products.filter((p) => groupOf(p.category).key === key);
  const subs = subgroupsIn(inGroup, key);
  const base = `${browse ? '/mom/food' : '/mom/add'}/g/${key}`;
  const one = subs.find((x) => x.sub.key === sub)?.sub ?? null;
  const list = homeFirst(one ? inGroup.filter((p) => subgroupOf(p)?.key === one.key) : inGroup);
  const bar = useCompareBar(browse), back = useBack(one || sub === 'all' ? base : browse ? '/mom/food' : '/mom/add?tab=products');
  const title = one ? `${one.emoji} ${tMaybe(one.label)}` : gr ? `${gr.emoji} ${tMaybe(gr.label)}` : t('أكل');
  if (!one && sub !== 'all' && subs.length > 1) return (
    <MomPage title={title} back={back} foot={bar}>
      <div className="grid grid-cols-2 gap-2">
        {subs.map(({ sub: x, n }) => <GroupTile key={x.key} emoji={x.emoji} label={tMaybe(x.label)} n={n} onClick={() => nav(`${base}/${x.key}`)} />)}
      </div>
      <button className="min-h-[48px] text-[16px] font-bold text-brand" onClick={() => nav(`${base}/all`)}>{t('الكل')} ({inGroup.length})</button>
    </MomPage>
  );
  return (
    <MomPage title={title} back={back} foot={bar}>
      {list.length ? <div className="grid grid-cols-2 gap-2">{list.map((p) => tile('product', p))}</div> : <p className="text-center text-slate-500">{t('ما في شي هني بعد')}</p>}
    </MomPage>
  );
}

/** One item: its picture and label facts, Dad's portions first, then a label serving or grams (a recipe: plates).
 *  Nothing preselected unless changing an item already on the plate. */
export function MomPortion() {
  const nav = useNavigate();
  const { kind, id } = useParams() as { kind: 'product' | 'recipe'; id: string };
  const [sp] = useSearchParams();
  const k = sp.get('k');
  const d = useDraft();
  const { c, itemCarbs, nameOf, photoOf } = useCatalog();
  const mine = c.portions.filter((p) => (kind === 'product' ? p.product_id === id : p.recipe_id === id));
  const prod = kind === 'product' ? c.products.find((p) => p.id === id) ?? null : null;
  const ss = prod?.serving_size ? Number(prod.serving_size) : null;
  const pack = prod?.pack_size && Number(prod.pack_size) <= 500 && Number(prod.pack_size) !== ss ? Number(prod.pack_size) : null;
  const gUnit = prod?.unit === 'ml' ? t('مل') : t('غرام');
  const cur = k !== null ? d.items[Number(k)] ?? null : null;
  // the choice: one of Dad's portions, or 'serving' / 'g' / 'plate' with an amount
  const each = !!prod?.per_item; // sold by the item: a count, never grams
  const [sel, setSel] = useState<string | null>(cur ? cur.portion_id ?? cur.unit ?? null : each ? 'serving' : null);
  const [amt, setAmt] = useState<number | null>(cur && !cur.portion_id ? cur.amount ?? null : each ? 1 : null);
  const free = sel === 'serving' || sel === 'g' || sel === 'plate';
  const showAmt = free && !(sel === 'g' && pack !== null && amt === pack);
  const item: MomItem | null = !sel ? null : free ? (amt && amt > 0 ? { kind, id, portion_id: null, amount: amt, unit: sel as 'serving' | 'g' | 'plate' } : null) : { kind, id, portion_id: sel };
  const g = item ? itemCarbs(item) : null;
  const x = photoOf({ kind, id });
  const pick = (v: string, a: number | null) => { setSel(v); setAmt(a); };
  const done = () => {
    if (!item || g === null) return;
    if (k !== null) draftOps.replace(Number(k), item); else draftOps.add(item);
    remember({ kind, id });
    nav('/mom/meal', { replace: true });
  };
  const carbsText = (v: number | null) => (v === null ? '' : v < 1 ? t('بدون كارب') : `${fmt(v)} ${t('غرام كارب')}`);
  const step = sel === 'g' ? (ss && ss < 40 ? 5 : 10) : 0.5;
  // a home dish can be weighed: carbs for 100 g of what is in the pot; what is served on the side is added apart
  const plate = !prod ? itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'plate' }) : null;
  const per100 = !prod ? itemCarbs({ kind, id, portion_id: null, amount: 100, unit: 'g' }) : null;
  const sides = !prod ? (c.ingsByRecipe.get(id) ?? []).filter((i) => i.on_side).map((i) => tMaybe(i.label ?? c.products.find((p) => p.id === i.product_id)?.name ?? '')).filter(Boolean) : [];
  return (
    <MomPage title={nameOf({ kind, id })} foot={<>
      {item && g !== null && <div className="text-center text-[18px] font-bold text-brand">{carbsText(g)}</div>}
      <Big disabled={!item || g === null} onClick={done}>{k !== null ? t('تم') : t('إضافة')}</Big>
    </>}>
      <div className="flex items-center gap-3 rounded-3xl bg-white p-3">
        <Photo {...pic(x)} className="h-24 w-24 shrink-0 rounded-2xl" />
        {prod ? (
          <div className="space-y-0.5 text-[16px]">
            {each ? <div><b className="num">{fmt(Number(prod.carbs_per_100))}</b> {t('غرام كارب بالحبة')}</div> : <div><b className="num">{fmt(Number(prod.carbs_per_100))}</b> {t('غرام كارب بكل 100 {u}', { u: gUnit })}</div>}
            {ss && !each && <div className="text-slate-600">{t('الحصة {s} {u} = {g}', { s: fmt(ss), u: gUnit, g: carbsText(itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'serving' })) })}</div>}
            {prod.brand && <div className="text-sm text-slate-500"><bdi>{prod.brand}</bdi></div>}
          </div>
        ) : <div className="space-y-0.5 text-[16px]">
          {per100 !== null && <div>{t('كل 100 غرام = {g}', { g: carbsText(per100) })}</div>}
          {plate !== null && <div className={per100 !== null ? 'text-slate-600' : ''}>{t('الصحن الواحد = {g}', { g: carbsText(plate) })}</div>}
        </div>}
      </div>
      <h2 className="text-[18px] font-bold">{t('كم؟')}</h2>
      {mine.map((p) => <Choice key={p.id} icon={p.photo_path ? <Photo path={p.photo_path} className="h-11 w-11" /> : '⭐'} label={tMaybe(p.label)} sub={carbsText(itemCarbs({ kind, id, portion_id: p.id }))} on={sel === p.id} onClick={() => pick(p.id, null)} />)}
      {prod && ss && <Choice icon={each ? '🔢' : '🥄'} label={each ? t('بالعدد') : t('بالحصة')} sub={each ? undefined : t('حصة = {s} {u}', { s: fmt(ss), u: gUnit })} on={sel === 'serving'} onClick={() => pick('serving', sel === 'serving' ? amt : 1)} />}
      {prod && pack && !each && <Choice icon="📦" label={t('العلبة كاملة')} sub={`${fmt(pack)} ${gUnit} · ${carbsText(itemCarbs({ kind, id, portion_id: null, amount: pack, unit: 'g' }))}`} on={sel === 'g' && amt === pack} onClick={() => pick('g', pack)} />}
      {prod && !each && <Choice icon="⚖️" label={prod.unit === 'ml' ? t('بالمل') : t('بالغرام')} on={sel === 'g' && amt !== pack} onClick={() => pick('g', sel === 'g' && amt !== pack ? amt : ss ?? null)} />}
      {!prod && per100 !== null && <Choice icon="⚖️" label={t('وزنتها بالميزان')} sub={t('اكتبي الرقم اللي طلع')} on={sel === 'g'} onClick={() => pick('g', sel === 'g' ? amt : null)} />}
      {!prod && <Choice icon="🍽️" label={t('بالصحون')} on={sel === 'plate'} onClick={() => pick('plate', sel === 'plate' ? amt : 1)} />}
      {showAmt && (
        <div className="flex items-center justify-center gap-4">
          <button aria-label="+" className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => setAmt(Math.round(((amt ?? 0) + step) * 10) / 10)}>+</button>
          {sel === 'g'
            ? <input inputMode="decimal" dir="ltr" className={cx(inputCls, '!w-28 !text-center !text-[28px] font-bold')} value={amt ?? ''} onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); setAmt(e.target.value === '' || !Number.isFinite(v) ? null : v); }} />
            : <span className="num w-24 text-center text-[40px] font-extrabold">{amt === null ? '—' : fmt(amt)}</span>}
          <button aria-label="−" className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => setAmt(Math.max(0, Math.round(((amt ?? 0) - step) * 10) / 10))}>−</button>
          <span className="text-[18px] text-slate-500">{sel === 'g' ? gUnit : sel === 'serving' ? (each ? t('حبة') : t('حصة')) : t('صحن')}</span>
        </div>
      )}
      {sel === 'g' && <p className="rounded-2xl bg-brand-soft px-4 py-3 text-[16px] leading-relaxed text-brand">⚖️ {t('حطي الصحن فاضي على الميزان واضغطي ON لين يصير 0، بعدين حطي الأكل.')}</p>}
      {sel === 'g' && sides.length > 0 && <p className="text-center text-[15px] text-slate-600">{t('{x} على الجنب: إذا أكلته أضيفيه بروحه', { x: sides.join(' · ') })}</p>}
      {k !== null && <button className="min-h-[44px] font-bold text-over" onClick={() => { draftOps.remove(Number(k)); nav('/mom/meal', { replace: true }); }}>{t('شيليه من الصحن')}</button>}
    </MomPage>
  );
}

/** Not in Layan's list: a photo and a name go to Dad; no dose is ever worked out for it. */
export function MomNew() {
  const nav = useNavigate();
  const { reload } = useData();
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [sent, setSent] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const send = async () => {
    setBusy(true);
    try {
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
      <p className="mt-auto text-center text-sm text-slate-500">{t('ما نحسب إبرة لشي مو مؤكد')}</p>
    </MomPage>
  );
  return (
    <MomPage title={t('مو موجود')} back="/mom/add">
      <button onClick={() => input.current?.click()} className="grid h-48 place-items-center rounded-3xl border-2 border-dashed border-slate-300 bg-white text-center">
        {file ? <img src={URL.createObjectURL(file)} alt="" className="h-44 rounded-2xl object-cover" /> : <span><span className="block text-5xl">📷</span><b className="text-[18px]">{t('صوّري الأكل أو الملصق')}</b></span>}
      </button>
      <input ref={input} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
      <input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('الاسم')} maxLength={60} />
      <Big disabled={busy || !name.trim()} onClick={send}>{t('أرسليه لبابا')}</Big>
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
      <Big onClick={() => { draftOps.start('now'); nav(`/mom/item/${kind}/${id}`); }}>🍽️ {t('أضيفيها لوجبة')}</Big>
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
