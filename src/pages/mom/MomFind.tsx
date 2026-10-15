// «شنو بتاكل؟» in simple mode: search first. The box sits under the title; typing lists every food she can have
// (home cooking, foods, restaurant items, her saved meals) best match first. Before typing: her saved meals, what
// she had lately, the rice-and-stew scale, eating out, and the ways to browse. The text typed is kept in the
// address, so Back from a food comes back to the same results.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { draftOps, useDraft, useSavedMeals } from '../../lib/mom';
import { readyForMom, type MomItem } from '../../engine/mom';
import { ADD_TILES, groupsIn } from '../../lib/productGroups';
import { rankFoods } from '../../lib/search';
import { RESTAURANTS, restaurantOf } from '../../lib/restaurants';
import { productOf } from '../../lib/mealItems';
import { reusable } from '../../lib/entryActions';
import { cx, inputCls } from '../../components/ui';
import { isEn, t, tMaybe } from '../../i18n';
import type { Product, Recipe, SavedMeal } from '../../lib/types';
import { Big, MomPage } from './MomUI';
import { repeatPlate } from '../../lib/repeatMeal';
import { FoodRow, GroupTile, RestaurantLogo, gramsText, recent, shownName, useCatalog, useUrlQuery } from './MomMeal';

type Food = { kind: 'product'; x: Product } | { kind: 'recipe'; x: Recipe } | { kind: 'meal'; x: SavedMeal };

export function MomFind() {
  const nav = useNavigate();
  const d = useDraft();
  const [sp] = useSearchParams();
  const [q, setQ] = useUrlQuery();
  const browse = sp.get('browse') as 'recipes' | 'restaurants' | 'groups' | 'brands' | 'all' | 'log' | null;
  const brand = sp.get('b'); // one brand's foods (browse=brands)
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

  // brands from the shop (restaurants have their own page): the biggest first; one brand's foods, most eaten first
  const brands = useMemo(() => {
    const m = new Map<string, number>();
    for (const p of products) { const b = p.brand?.trim(); if (b && !restaurantOf(b)) m.set(b, (m.get(b) ?? 0) + 1); }
    return [...m.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  }, [products]);
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

  // her favourites (saved meals, starred recipes; most eaten first) and what she had lately (foods she opened, the
  // ones she has most often, meals from the log), each once: what is a favourite is not repeated as recent
  type Pick = { key: string; title: string; sub: string; x?: Product | Recipe | null; icon?: string; carbs: number | null; per?: string; go: () => void };
  const usesOf = (key: string) => uses.get(key) ?? 0;
  const foodPick = (kind: 'product' | 'recipe', x: Product | Recipe, sub: string): Pick => {
    const cl = carbsLine(kind, x.id);
    return { key: `${kind}:${x.id}`, title: shownName(x), sub, x, carbs: cl?.g ?? null, per: cl?.per, go: () => open(kind, x.id) };
  };
  const favPicks: Pick[] = [
    ...meals.map((m) => ({ key: 'meal:' + m.id, title: m.name, sub: t('وجبة مفضلة'), icon: '⭐', carbs: mealCarbs(m.items), per: t('الوجبة'), go: () => takeMeal(m) })),
    ...recipes.filter((r) => r.favorite).sort((a, b) => usesOf('recipe:' + b.id) - usesOf('recipe:' + a.id)).map((r) => foodPick('recipe', r, t('مفضلة'))),
  ];
  const seen = new Set(favPicks.map((p) => p.key));
  const recentPicks: Pick[] = [];
  const addRecent = (p: Pick) => { if (!seen.has(p.key)) { seen.add(p.key); recentPicks.push(p); } };
  for (const r of recent()) {
    if (!readyForMom(r.kind, r.id, c)) continue;
    const x = r.kind === 'product' ? products.find((p) => p.id === r.id) : recipes.find((y) => y.id === r.id);
    if (x) addRecent(foodPick(r.kind, x, t('آخر مرة')));
  }
  for (const [key, n] of [...uses.entries()].sort((a, b) => b[1] - a[1])) {
    if (n < 2) break;
    const [kind, id] = key.split(':') as ['product' | 'recipe', string];
    const x = kind === 'product' ? products.find((p) => p.id === id) : recipes.find((y) => y.id === id);
    if (x) addRecent(foodPick(kind, x, t('أكلتها {n} مرات', { n })));
  }
  // a meal from the log that is just one food already listed would only repeat it
  const oneFood = (h: (typeof history)[number]) => { if (h.lines.length !== 1) return null; const p = productOf(h.lines[0], c.products); return p ? 'product:' + p.id : null; };
  if (d.mode === 'now' && !d.items.length) for (const h of reusable(history).filter((x) => { const k = oneFood(x); return !k || !seen.has(k); }).slice(0, 4)) addRecent({ key: 'log:' + h.id, title: tMaybe(h.name), sub: t('من السجل'), icon: '🍽️', carbs: h.total_carbs, per: t('من السجل'),
    go: () => { const r = repeatPlate(h, c.products, itemCarbs); draftOps.loadItems(r.items, r.review); nav('/mom/meal'); } });
  const pickRow = (p: Pick) => <FoodRow key={p.key} x={p.x} icon={p.icon} title={p.title} sub={p.sub} carbs={p.carbs} per={p.per} onClick={p.go} />;

  const ways: [string, string, string, () => void][] = [
    ['⚖️', t('عيش ومرق بالميزان'), t('احسبيه بالوزن'), () => nav('/mom/plate')],
    ['🍲', t('طبخ البيت'), t('وصفات البيت'), () => nav('/mom/add?browse=recipes')],
    ...(d.mode === 'now' ? [['🍽️', t('أكل برّا'), t('ما أعرف الكارب'), () => nav('/mom/out')] as [string, string, string, () => void]] : []),
    ['📷', t('مو موجود؟'), t('اكتبي الكارب من الملصق، أو أرسليه لبابا'), () => nav('/mom/new')],
  ];
  // browsing: everything she likes, home cooking, restaurants, or the food groups (Back returns to the search)
  if (browse === 'all') return (
    <MomPage compact title={t('المفضلة والأخيرة')} back={-1}>
      <h2 className="text-[14px] font-bold text-slate-500">⭐ {t('المفضلة')}</h2>
      {favPicks.length ? <div className="space-y-2">{favPicks.map(pickRow)}</div> : <p className="text-[14px] text-slate-500">{t('ما في مفضلة بعد: احفظي وجبة ⭐ من صفحة الوجبة')}</p>}
      <h2 className="pt-2 text-[14px] font-bold text-slate-500">🕘 {t('الأخيرة')}</h2>
      {recentPicks.length ? <div className="space-y-2">{recentPicks.map(pickRow)}</div> : <p className="text-[14px] text-slate-500">{t('ما في شي بعد')}</p>}
    </MomPage>
  );
  // «وجبة سابقة»: meals from the log, newest first; one tap puts the same foods on a new plate (lib/repeatMeal)
  if (browse === 'log') return (
    <MomPage compact title={t('وجبة سابقة')} back={-1}>
      <div className="space-y-2">{reusable(history).slice(0, 40).map((h) => <FoodRow key={h.id} icon="🍽️" title={tMaybe(h.name)} sub={h.lines.map((l) => tMaybe(l.name)).join(' · ')} carbs={h.total_carbs} per={t('الوجبة')}
        onClick={() => { const r = repeatPlate(h, c.products, itemCarbs); draftOps.loadItems([...d.items, ...r.items], r.review); nav('/mom/meal'); }} />)}</div>
    </MomPage>
  );
  if (browse === 'brands') {
    const mine = brand ? products.filter((p) => p.brand?.trim() === brand).sort((a, b) => (uses.get('product:' + b.id) ?? 0) - (uses.get('product:' + a.id) ?? 0) || shownName(a).localeCompare(shownName(b))) : [];
    return (
      <MomPage compact title={brand ? tMaybe(brand) : t('الماركات')} back={-1}>
        {brand ? <div className="space-y-2">{mine.map((x) => row({ kind: 'product', x }))}</div> : (
          <div className="grid grid-cols-2 gap-2">
            {brands.map(([b, n]) => (
              <button key={b} onClick={() => nav(`/mom/add?browse=brands&b=${encodeURIComponent(b)}`)} className="flex min-h-[72px] flex-col items-center justify-center gap-0.5 rounded-2xl border border-slate-100 bg-white px-2 py-2 text-center active:opacity-80">
                <bdi className="line-clamp-2 text-[16px] font-bold leading-snug">{tMaybe(b)}</bdi>
                <span className="num text-[13px] text-slate-500">{n}</span>
              </button>
            ))}
          </div>
        )}
      </MomPage>
    );
  }
  if (browse) return (
    <MomPage compact title={browse === 'recipes' ? t('طبخ البيت') : browse === 'restaurants' ? t('مطاعم وماركات') : t('المزيد')} back={-1}>
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
      {browse === 'restaurants' && brands.length > 0 && (
        <>
          <h2 className="pt-2 text-[16px] font-bold">{t('الماركات')}</h2>
          <div className="grid grid-cols-2 gap-2">
            {brands.map(([b, n]) => (
              <button key={b} onClick={() => nav(`/mom/add?browse=brands&b=${encodeURIComponent(b)}`)} className="flex min-h-[64px] flex-col items-center justify-center gap-0.5 rounded-2xl border border-slate-100 bg-white px-2 py-2 text-center active:opacity-80">
                <bdi className="line-clamp-2 text-[16px] font-bold leading-snug">{tMaybe(b)}</bdi><span className="num text-[13px] text-slate-500">{n}</span>
              </button>
            ))}
          </div>
        </>
      )}
      {browse === 'groups' && (
        <>
          <div className="grid grid-cols-3 gap-2">
            {groupsIn(products.filter((p) => !restaurantOf(p.brand))).map(({ group: gr, n }) => <GroupTile dense key={gr.key} emoji={gr.emoji} label={tMaybe(gr.label)} n={n} onClick={() => nav(`/mom/add/g/${gr.key}`)} />)}
          </div>
          <div className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm">
            {ways.map(([icon, label, sub, go]) => (
              <button key={label} onClick={go} className="flex min-h-[58px] w-full items-center gap-3 px-3 py-2 text-start active:bg-slate-50">
                <span aria-hidden className="w-8 shrink-0 text-center text-[24px] leading-none">{icon}</span>
                <span className="min-w-0 flex-1"><b className="block text-[16px] leading-snug">{label}</b><span className="block text-[13px] leading-snug text-slate-500">{sub}</span></span>
                <span aria-hidden className="shrink-0 text-[22px] leading-none text-slate-300">{isEn() ? '›' : '‹'}</span>
              </button>
            ))}
          </div>
        </>
      )}
    </MomPage>
  );

  const search = (
    <div className="relative">
      <svg aria-hidden viewBox="0 0 24 24" className="pointer-events-none absolute start-3.5 top-1/2 h-5 w-5 -translate-y-1/2 text-slate-400" fill="none" stroke="currentColor" strokeWidth={2.2} strokeLinecap="round"><circle cx="11" cy="11" r="7" /><path d="m20 20-3.5-3.5" /></svg>
      <input className={cx(inputCls, '!min-h-[48px] !ps-11 !text-[16px]')} type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)}
        placeholder={t('ابحثي: رز، معكرونة، دجاج…')} aria-label={t('ابحثي')} />
    </div>
  );
  return (
    <MomPage compact keyboard title={title} back={back} top={search}>
      {left}
      {q.trim() ? (
        found.length ? <div className="space-y-2">{found.slice(0, 60).map(row)}</div> : (
          <div className="space-y-3 py-4 text-center">
            <p className="text-[16px] text-slate-600">{t('ما لقينا «{q}»', { q: q.trim() })}</p>
            <Big tone="soft" md onClick={() => nav(`/mom/new?name=${encodeURIComponent(q.trim())}`)}>📷 {t('مو موجود؟ اكتبي كارب الملصق')}</Big>
          </div>
        )
      ) : (
        <>
          {/* her usual foods and an earlier meal, then nine groups; everything else is under «More» */}
          <div className="grid grid-cols-2 gap-2">
            <button onClick={() => nav('/mom/add?browse=all')} className="min-h-[52px] rounded-2xl bg-brand-soft text-[16px] font-bold text-brand active:opacity-80">⭐ {t('المعتاد')}</button>
            <button onClick={() => nav('/mom/add?browse=log')} className="min-h-[52px] rounded-2xl bg-brand-soft text-[16px] font-bold text-brand active:opacity-80">🔁 {t('وجبة سابقة')}</button>
          </div>
          <div className="grid grid-cols-3 gap-2.5 pt-1">
            {ADD_TILES.map((x) => (
              <button key={x.to} onClick={() => nav('/mom/add' + x.to)} className="flex min-h-[96px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-1 text-center shadow-sm active:opacity-80">
                <span aria-hidden className="text-[32px] leading-none">{x.emoji}</span>
                <span className="text-[14px] font-bold leading-tight">{t(x.label)}</span>
              </button>
            ))}
          </div>
          <div className="flex justify-center gap-2 pt-1 text-[14px] font-bold text-brand">
            {d.mode === 'now' && <button className="min-h-[44px] px-2" onClick={() => nav('/mom/out')}>🍽️ {t('أكل برّا')}</button>}
            <button className="min-h-[44px] px-2" onClick={() => nav('/mom/new')}>📷 {t('مو موجود؟')}</button>
          </div>
        </>
      )}
    </MomPage>
  );
}
