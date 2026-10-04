// Mom mode, building a meal from Layan's database: saved meals, recipes and products (grouped, with pictures), each
// in one of its portions. Every choice is a full page; the meal being built is kept on the phone.
import { useMemo, useRef, useState } from 'react';
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { compareOps, draftOps, saveMeal, useCompare, useDraft, usePortions, useSavedMeals } from '../../lib/mom';
import { planMeal } from '../../lib/plans';
import { COMPARE_MAX, planItems, planItemsOf, readyForMom, type Catalog, type MomItem } from '../../engine/mom';
import { groupByKey, groupOf, groupsIn } from '../../lib/productGroups';
import { matches } from '../../lib/search';
import { fmt } from '../../lib/carbs';
import { supabase, uploadPhoto } from '../../lib/supabase';
import { Photo, cx, inputCls, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
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
  return { ...cat, products, recipes, homeFirst, tile };
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
  const tab = (sp.get('tab') ?? (meals.length && !browse ? 'saved' : 'products')) as 'saved' | 'recipes' | 'products';
  const [q, setQ] = useState('');
  const { c, mealCarbs, nameOf, products, recipes, homeFirst, tile } = useFoods(browse);
  const rec = recent().filter((r) => readyForMom(r.kind, r.id, c)).slice(0, 4);
  const find = (kind: 'product' | 'recipe', id: string) => ((kind === 'product' ? c.products : c.recipes) as (Product | Recipe)[]).find((y) => y.id === id)!;
  // searching finds every approved food in every group (restaurants, things not bought yet), what is at home first
  const found = q.trim() ? homeFirst(products.filter((p) => matches([p.name, p.brand, p.category], q))) : [];
  const foundRecipes = q.trim() ? recipes.filter((r) => matches([r.name, r.category], q)) : [];
  const groups = groupsIn(products);
  const missing = q.trim() && !found.length && !foundRecipes.length;
  const base = browse ? '/mom/food' : '/mom/add';
  const bar = useCompareBar(browse);
  return (
    <MomPage title={browse ? t('التغذية') : t('شنو بتاكل؟')} back={browse ? null : '/mom/meal'} tabs={browse} foot={bar}>
      <div className={cx('grid gap-1 rounded-full bg-slate-100 p-1 text-[15px]', browse ? 'grid-cols-2' : 'grid-cols-3')}>
        {(browse ? ['products', 'recipes'] as const : ['saved', 'recipes', 'products'] as const).map((k) => <button key={k} onClick={() => setSp({ tab: k }, { replace: true })} className={cx('min-h-[44px] rounded-full', tab === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k === 'saved' ? t('وجباتها') : k === 'recipes' ? t('طبخ البيت') : t('أكل')}</button>)}
      </div>
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

/** One group's page (/mom/food/g/:key, /mom/add/g/:key): every approved food in it, what is at home first. */
export function MomGroup({ browse = false }: { browse?: boolean }) {
  const { key } = useParams() as { key: string };
  const gr = groupByKey(key);
  const { products, homeFirst, tile } = useFoods(browse);
  const list = homeFirst(products.filter((p) => groupOf(p.category).key === key));
  const bar = useCompareBar(browse), back = useBack(browse ? '/mom/food' : '/mom/add?tab=products');
  return (
    <MomPage title={gr ? `${gr.emoji} ${tMaybe(gr.label)}` : t('أكل')} back={back} foot={bar}>
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
  const [sel, setSel] = useState<string | null>(cur ? cur.portion_id ?? cur.unit ?? null : null);
  const [amt, setAmt] = useState<number | null>(cur && !cur.portion_id ? cur.amount ?? null : null);
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
  return (
    <MomPage title={nameOf({ kind, id })} foot={<>
      {item && g !== null && <div className="text-center text-[18px] font-bold text-brand">{carbsText(g)}</div>}
      <Big disabled={!item || g === null} onClick={done}>{k !== null ? t('تم') : t('إضافة')}</Big>
    </>}>
      <div className="flex items-center gap-3 rounded-3xl bg-white p-3">
        <Photo {...pic(x)} className="h-24 w-24 shrink-0 rounded-2xl" />
        {prod ? (
          <div className="space-y-0.5 text-[16px]">
            <div><b className="num">{fmt(Number(prod.carbs_per_100))}</b> {t('غرام كارب بكل 100 {u}', { u: gUnit })}</div>
            {ss && <div className="text-slate-600">{t('الحصة {s} {u} = {g}', { s: fmt(ss), u: gUnit, g: carbsText(itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'serving' })) })}</div>}
            {prod.brand && <div className="text-sm text-slate-500"><bdi>{prod.brand}</bdi></div>}
          </div>
        ) : <div className="text-[16px]">{t('الصحن الواحد = {g}', { g: carbsText(itemCarbs({ kind, id, portion_id: null, amount: 1, unit: 'plate' })) })}</div>}
      </div>
      <h2 className="text-[18px] font-bold">{t('كم؟')}</h2>
      {mine.map((p) => <Choice key={p.id} icon={p.photo_path ? <Photo path={p.photo_path} className="h-11 w-11" /> : '⭐'} label={tMaybe(p.label)} sub={carbsText(itemCarbs({ kind, id, portion_id: p.id }))} on={sel === p.id} onClick={() => pick(p.id, null)} />)}
      {prod && ss && <Choice icon="🥄" label={t('بالحصة')} sub={t('حصة = {s} {u}', { s: fmt(ss), u: gUnit })} on={sel === 'serving'} onClick={() => pick('serving', sel === 'serving' ? amt : 1)} />}
      {prod && pack && <Choice icon="📦" label={t('العلبة كاملة')} sub={`${fmt(pack)} ${gUnit} · ${carbsText(itemCarbs({ kind, id, portion_id: null, amount: pack, unit: 'g' }))}`} on={sel === 'g' && amt === pack} onClick={() => pick('g', pack)} />}
      {prod && <Choice icon="⚖️" label={prod.unit === 'ml' ? t('بالمل') : t('بالغرام')} on={sel === 'g' && amt !== pack} onClick={() => pick('g', sel === 'g' && amt !== pack ? amt : ss ?? null)} />}
      {!prod && <Choice icon="🍽️" label={t('بالصحون')} on={sel === 'plate'} onClick={() => pick('plate', sel === 'plate' ? amt : 1)} />}
      {showAmt && (
        <div className="flex items-center justify-center gap-4">
          <button aria-label="+" className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => setAmt(Math.round(((amt ?? 0) + step) * 10) / 10)}>+</button>
          {sel === 'g'
            ? <input inputMode="decimal" dir="ltr" className={cx(inputCls, '!w-28 !text-center !text-[28px] font-bold')} value={amt ?? ''} onChange={(e) => { const v = Number(e.target.value.replace(',', '.')); setAmt(e.target.value === '' || !Number.isFinite(v) ? null : v); }} />
            : <span className="num w-24 text-center text-[40px] font-extrabold">{amt === null ? '—' : fmt(amt)}</span>}
          <button aria-label="−" className="grid h-14 w-14 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => setAmt(Math.max(0, Math.round(((amt ?? 0) - step) * 10) / 10))}>−</button>
          <span className="text-[18px] text-slate-500">{sel === 'g' ? gUnit : sel === 'serving' ? t('حصة') : t('صحن')}</span>
        </div>
      )}
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
    const ss = prod.serving_size ? Number(prod.serving_size) : null, f = ss ? ss / 100 : null;
    const both = (v: number | null | undefined) => ({ a: n(v), b: f === null ? null : n(v, f) });
    head = [t('بكل 100 {u}', { u }), ss ? t('الحصة {s} {u}', { s: fmt(ss), u }) : null];
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
