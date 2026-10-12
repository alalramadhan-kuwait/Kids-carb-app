// «شنو بتاكل؟» in simple mode: search first. The box sits under the title; typing lists every food she can have
// (home cooking, foods, restaurant items, her saved meals) best match first. Before typing: her saved meals, what
// she had lately, the rice-and-stew scale, eating out, and the ways to browse. The text typed is kept in the
// address, so Back from a food comes back to the same results.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { draftOps, useDraft, useSavedMeals } from '../../lib/mom';
import { readyForMom, type MomItem } from '../../engine/mom';
import { groupsIn } from '../../lib/productGroups';
import { rankFoods } from '../../lib/search';
import { RESTAURANTS, restaurantOf } from '../../lib/restaurants';
import { productOf } from '../../lib/mealItems';
import { reusable } from '../../lib/entryActions';
import { cx, inputCls } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import type { Product, Recipe, SavedMeal } from '../../lib/types';
import { Big, MomPage } from './MomUI';
import { FoodRow, GroupTile, RestaurantLogo, plateFromLog, recent, shownName, useCatalog, useUrlQuery } from './MomMeal';

type Food = { kind: 'product'; x: Product } | { kind: 'recipe'; x: Recipe } | { kind: 'meal'; x: SavedMeal };

export function MomFind() {
  const nav = useNavigate();
  const d = useDraft();
  const [sp] = useSearchParams();
  const [q, setQ] = useUrlQuery();
  const browse = sp.get('browse') as 'recipes' | 'restaurants' | 'groups' | null;
  const { meals } = useSavedMeals();
  const { history } = useData();
  const { c, mealCarbs, carbsLine, itemCarbs, nameOf } = useCatalog();
  const products = useMemo(() => c.products.filter((p) => readyForMom('product', p.id, c)), [c]);
  const recipes = useMemo(() => c.recipes.filter((r) => readyForMom('recipe', r.id, c)), [c]);
  // how often she had each food, and what is in her saved meals (her favourites, with the recipes Dad starred)
  const uses = useMemo(() => {
    const m = new Map<string, number>();
    for (const h of history) {
      if (h.recipe_id) m.set('recipe:' + h.recipe_id, (m.get('recipe:' + h.recipe_id) ?? 0) + 1);
      else for (const l of h.lines) { const p = productOf(l, c.products); if (p) m.set('product:' + p.id, (m.get('product:' + p.id) ?? 0) + 1); }
    }
    return m;
  }, [history, c.products]);
  const inMeals = useMemo(() => new Set(meals.flatMap((m) => m.items.map((i) => `${i.kind}:${i.id}`))), [meals]);
  const fav = (kind: 'product' | 'recipe', id: string) => inMeals.has(`${kind}:${id}`) || (kind === 'recipe' && !!c.recipes.find((r) => r.id === id)?.favorite);

  const all: Food[] = useMemo(() => [
    ...meals.map((x) => ({ kind: 'meal' as const, x })), ...recipes.map((x) => ({ kind: 'recipe' as const, x })), ...products.map((x) => ({ kind: 'product' as const, x })),
  ], [meals, recipes, products]);
  const found = q.trim() ? rankFoods(all, q, (f) => f.kind === 'meal'
    ? { names: [f.x.name], fav: true, label: f.x.name }
    : { names: [f.x.name, f.x.name_ar, f.x.name_en], others: f.kind === 'product' ? [f.x.brand, f.x.category] : [f.x.category],
      fav: fav(f.kind, f.x.id), uses: uses.get(`${f.kind}:${f.x.id}`) ?? 0, home: f.kind === 'product' ? f.x.available !== false : true, label: shownName(f.x) }) : [];

  const open = (kind: 'product' | 'recipe', id: string) => nav(`/mom/item/${kind}/${id}`);
  const takeMeal = (m: SavedMeal) => { if (d.items.length) m.items.forEach((i) => draftOps.add({ ...i } as MomItem)); else draftOps.load(m); nav('/mom/meal'); };
  const row = (f: Food) => {
    if (f.kind === 'meal') return <FoodRow key={'m' + f.x.id} icon="⭐" title={f.x.name} sub={f.x.items.map((i) => nameOf(i)).join(' · ')} carbs={mealCarbs(f.x.items)} per={t('الوجبة')} onClick={() => takeMeal(f.x)} />;
    const cl = carbsLine(f.kind, f.x.id);
    const where = f.kind === 'recipe' ? t('طبخ البيت') : (() => { const r = restaurantOf(f.x.brand); return r ? tMaybe(r.label) : f.x.brand ?? undefined; })();
    return <FoodRow key={f.kind + f.x.id} x={f.x} title={shownName(f.x)} sub={where} carbs={cl?.g ?? null} per={cl?.per} onClick={() => open(f.kind, f.x.id)} />;
  };
  const back = d.items.length ? '/mom/meal' : '/mom';
  const title = d.mode === 'plan' ? t('خطة وجبة') : t('شنو بتاكل؟');
  const left = d.left.length ? <p className="rounded-2xl bg-over-soft px-4 py-3 text-center text-[16px] font-bold text-over">⚠️ <bdi>{d.left.join(' · ')}</bdi> {t('ما ينحسب بالإبرة · كلّمي بابا')}</p> : null;

  // browsing: home cooking, restaurants, or the food groups (Back returns to the search)
  if (browse) return (
    <MomPage compact title={browse === 'recipes' ? t('طبخ البيت') : browse === 'restaurants' ? t('مطاعم') : t('أقسام الأكل')} back={-1}>
      {browse === 'recipes' && (recipes.length ? [...recipes].sort((a, b) => Number(fav('recipe', b.id)) - Number(fav('recipe', a.id)) || (uses.get('recipe:' + b.id) ?? 0) - (uses.get('recipe:' + a.id) ?? 0)).map((r) => row({ kind: 'recipe', x: r }))
        : <p className="text-center text-slate-500">{t('بابا ما جهّز وصفات بعد')}</p>)}
      {browse === 'restaurants' && (
        <div className="grid grid-cols-2 gap-2">
          {RESTAURANTS.map((r) => ({ r, n: products.filter((p) => restaurantOf(p.brand)?.key === r.key).length })).filter((x) => x.n).map(({ r, n }) => (
            <button key={r.key} onClick={() => nav(`/mom/add/r/${r.key}`)} className="flex min-h-[120px] flex-col items-center justify-center gap-1.5 rounded-2xl border border-slate-100 bg-white p-3 active:opacity-80">
              <RestaurantLogo r={r} size={60} />
              <span className="text-[16px] font-bold">{tMaybe(r.label)}</span>
              <span className="num text-[13px] text-slate-500">{n}</span>
            </button>
          ))}
        </div>
      )}
      {browse === 'groups' && (
        <div className="grid grid-cols-3 gap-2">
          {groupsIn(products.filter((p) => !restaurantOf(p.brand))).map(({ group: gr, n }) => <GroupTile dense key={gr.key} emoji={gr.emoji} label={tMaybe(gr.label)} n={n} onClick={() => nav(`/mom/add/g/${gr.key}`)} />)}
        </div>
      )}
    </MomPage>
  );

  const lately = recent().filter((r) => readyForMom(r.kind, r.id, c)).slice(0, 5)
    .map((r) => (r.kind === 'product' ? { kind: 'product' as const, x: c.products.find((p) => p.id === r.id)! } : { kind: 'recipe' as const, x: c.recipes.find((y) => y.id === r.id)! }));
  const pastMeals = d.mode === 'now' && !d.items.length ? reusable(history).slice(0, 2) : [];
  const search = (
    <input className={cx(inputCls, '!min-h-[48px] !text-[16px]')} type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)}
      placeholder={t('ابحثي: رز، هريس، توست، ماكدونالدز…')} aria-label={t('ابحثي')} />
  );
  return (
    <MomPage compact title={title} back={back} top={search}>
      {left}
      {q.trim() ? (
        found.length ? <div className="space-y-2">{found.slice(0, 60).map(row)}</div> : (
          <div className="space-y-3 py-4 text-center">
            <p className="text-[16px] text-slate-600">{t('ما لقينا «{q}»', { q: q.trim() })}</p>
            <Big tone="soft" md onClick={() => nav('/mom/new')}>📷 {t('مو موجود؟ أرسليه لبابا')}</Big>
          </div>
        )
      ) : (
        <>
          {meals.length > 0 && (
            <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1">
              {meals.map((m) => <button key={m.id} onClick={() => takeMeal(m)} className="flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full bg-white px-3.5 text-[15px] font-bold shadow-sm active:opacity-80">⭐ <bdi>{m.name}</bdi></button>)}
            </div>
          )}
          {(lately.length > 0 || pastMeals.length > 0) && <h2 className="text-[14px] font-bold text-slate-500">🕘 {t('الأخيرة')}</h2>}
          {lately.length > 0 && <div className="space-y-2">{lately.map(row)}</div>}
          {pastMeals.map((h) => <FoodRow key={h.id} icon="🍽️" title={tMaybe(h.name)} sub={h.lines.map((l) => tMaybe(l.name)).join(' · ')} carbs={h.total_carbs} per={t('من السجل')}
            onClick={() => { const r = plateFromLog(h, c.products, itemCarbs); draftOps.loadItems(r.items, r.left); nav('/mom/meal'); }} />)}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => nav('/mom/plate')} className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-2xl bg-brand-soft px-2 text-[15px] font-bold text-brand active:opacity-80">⚖️ {t('عيش ومرق بالميزان')}</button>
            {d.mode === 'now' && <button onClick={() => nav('/mom/out')} className="flex min-h-[52px] items-center justify-center gap-1.5 rounded-2xl bg-white px-2 text-[15px] font-bold shadow-sm active:opacity-80">🍽️ {t('أكل برّا')}</button>}
          </div>
          <h2 className="text-[14px] font-bold text-slate-500">{t('تصفّحي')}</h2>
          <div className="grid grid-cols-3 gap-2">
            {([['recipes', '🍲', t('طبخ البيت'), recipes.length], ['restaurants', '🍔', t('مطاعم'), products.filter((p) => restaurantOf(p.brand)).length], ['groups', '🗂️', t('أقسام الأكل'), products.filter((p) => !restaurantOf(p.brand)).length]] as const)
              .map(([k, e, l, n]) => (
                <button key={k} onClick={() => nav(`/mom/add?browse=${k}`)} className="flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-2xl bg-white p-2 shadow-sm active:opacity-80">
                  <span aria-hidden className="text-[28px] leading-none">{e}</span>
                  <span className="text-center text-[14px] font-bold leading-tight">{l}</span>
                  <span className="num text-[12px] text-slate-500">{n}</span>
                </button>
              ))}
          </div>
          <button onClick={() => nav('/mom/new')} className="min-h-[44px] text-[15px] font-bold text-brand">{t('مو موجود؟')}</button>
        </>
      )}
    </MomPage>
  );
}
