// Full mode's «أكل» (from ＋): the same way in as simple mode, on full pages. Search; ⭐ usual foods and 🔁 an earlier
// meal; nine fixed group tiles (lib/productGroups ADD_TILES). A group lists its foods at once with its sub-groups as one
// row of chips; restaurants and brands share one page; everything else (all groups, carbs only, photo, recipes, a new
// product) is under More. A food opens its own page (?p=) to choose the amount and log it. Where the page is
// (search, group, sub-group, brand) lives in the address, so Back always returns to the same place.
import { useMemo } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { ADD_TILES, GROUP_TITLE, groupByKey, groupOf, groupsIn, subgroupOf, subgroupsIn } from '../lib/productGroups';
import { restaurantOf } from '../lib/restaurants';
import { brandsOf, sameBrand } from '../lib/brand';
import { matches } from '../lib/search';
import { fmt } from '../lib/carbs';
import { deleteHistory } from '../lib/api';
import { logQuick, rankQuick, useQuickItems, type QuickItem } from '../lib/quick';
import type { Product } from '../lib/types';
import { Page, Photo, cx, inputCls, toast } from '../components/ui';
import { ProductLog } from '../components/ProductSheet';
import { ProductForm } from '../components/ProductForm';
import { isEn, t, tMaybe } from '../i18n';

/** a tile's target (written for simple mode's /mom/add) as this page's address */
const target = (to: string) => to.startsWith('?browse=restaurants') ? '?v=brands' : to.startsWith('?browse=groups') ? '?v=more'
  : (() => { const [, , g, s] = to.split('/'); return `?g=${g}${s ? `&s=${s}` : ''}`; })();

export default function AddFood() {
  const nav = useNavigate();
  const { products, history, reload } = useData();
  const quick = useQuickItems();
  const [sp, setSp] = useSearchParams();
  const q = sp.get('q') ?? '', g = sp.get('g'), s = sp.get('s'), b = sp.get('b'), v = sp.get('v');
  const setQ = (x: string) => setSp((p) => { const n = new URLSearchParams(p); if (x) n.set('q', x); else n.delete('q'); return n; }, { replace: true });
  const back = () => nav(-1);
  const go = (to: string) => nav('/add' + to);

  const row = (p: Product) => (
    <li key={p.id}>
      <button onClick={() => go(`?p=${p.id}`)} className="flex min-h-[60px] w-full items-center gap-3 px-3 py-1.5 text-start active:bg-slate-50">
        <Photo path={p.image_path} category={p.category} className="h-11 w-11 shrink-0 rounded-xl" />
        <span className="min-w-0 flex-1">
          <bdi className="block truncate text-[15px] font-semibold">{tMaybe(p.name)}</bdi>
          {p.brand && <span className="block truncate text-xs text-slate-500"><bdi>{p.brand}</bdi></span>}
        </span>
        <span className="shrink-0 text-end text-xs text-slate-500">
          {p.serving_size && p.carbs_per_serving != null
            ? <><b className="num block text-[15px] text-slate-900">{fmt(p.carbs_per_serving)} {t('غ')}</b>{p.per_item ? t('الحبة') : t('الحصة')}</>
            : <><b className="num block text-[15px] text-slate-900">{fmt(p.carbs_per_100)} {t('غ')}</b>/100{p.unit === 'ml' ? t('مل') : t('غ')}</>}
        </span>
      </button>
    </li>
  );
  const list = (ps: Product[]) => ps.length
    ? <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm">{ps.map(row)}</ul>
    : <p className="py-6 text-center text-slate-500">{t('لا توجد نتائج')}</p>;
  // what is at home first, then by name; restaurant food after the rest
  const order = (ps: Product[]) => [...ps].sort((x, y) => Number(!!restaurantOf(x.brand)) - Number(!!restaurantOf(y.brand)) || Number(y.available) - Number(x.available) || x.name.localeCompare(y.name));
  const logged = async (qi: QuickItem) => {
    const id = await logQuick(qi); await reload(); void quick.reload();
    toast(t('تم التسجيل: {x}', { x: `${tMaybe(qi.name)} · ${t('{g} غ', { g: fmt(qi.carbs) })}` }), { label: t('تراجع'), run: async () => { await deleteHistory(id); await reload(); } });
    nav('/', { replace: true });
  };

  // a food: choose the amount and time on its own page; logging returns to Now
  const pid = sp.get('p'), food = pid ? products.find((x) => x.id === pid) : null;
  if (pid) return (
    <Page title={food ? tMaybe(food.name) : t('أكل')} back={back}>
      {food ? <ProductLog p={food} onBack={back} onDone={() => nav('/', { replace: true })} /> : <p className="py-6 text-center text-slate-500">{t('لا توجد نتائج')}</p>}
    </Page>
  );

  // a group (or groups joined with +), its sub-groups as one row of chips; each chip replaces the page
  if (g) {
    const keys = g.split('+'), gr = groupByKey(keys[0]);
    const inGroup = products.filter((p) => keys.includes(groupOf(p.category).key));
    const subs = keys.flatMap((k) => subgroupsIn(inGroup.filter((p) => groupOf(p.category).key === k), k));
    const one = subs.find((x) => x.sub.key === s)?.sub ?? null;
    const chip = (on: boolean, label: string, to: string) => <button key={to} onClick={() => nav('/add' + to, { replace: true })} className={cx('min-h-[40px] shrink-0 rounded-full px-4 text-sm font-bold', on ? 'bg-brand text-white' : 'bg-white text-slate-600 shadow-sm')}>{label}</button>;
    return (
      <Page title={one ? `${one.emoji} ${tMaybe(one.label)}` : gr ? `${gr.emoji} ${tMaybe(GROUP_TITLE[g] ?? gr.label)}` : t('أكل')} back={back}>
        {subs.length > 1 && <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4 pb-1">{chip(!one, t('الكل'), `?g=${g}`)}{subs.map(({ sub: x }) => chip(one?.key === x.key, tMaybe(x.label), `?g=${g}&s=${x.key}`))}</div>}
        {list(order(one ? inGroup.filter((p) => subgroupOf(p)?.key === one.key) : inGroup))}
      </Page>
    );
  }
  // one restaurant's or brand's foods
  if (b) return <Page title={b} back={back}>{list(order(products.filter((p) => sameBrand(p.brand, b))))}</Page>;
  if (v === 'brands') {
    const names = brandsOf(products);
    const rest = names.filter((x) => restaurantOf(x)), shop = names.filter((x) => !restaurantOf(x));
    const tiles = (xs: string[]) => <div className="grid grid-cols-2 gap-2">{xs.map((x) => (
      <button key={x} onClick={() => go(`?b=${encodeURIComponent(x)}`)} className="flex min-h-[64px] flex-col items-center justify-center rounded-2xl bg-white px-2 text-center shadow-sm active:opacity-80">
        <bdi className="line-clamp-2 text-[15px] font-bold leading-snug">{tMaybe(x)}</bdi><span className="num text-xs text-slate-500">{products.filter((p) => sameBrand(p.brand, x)).length}</span>
      </button>))}</div>;
    return (
      <Page title={t('مطاعم وماركات')} back={back}>
        {rest.length > 0 && <><h2 className="mb-2 text-sm font-bold text-slate-500">{t('المطاعم')}</h2>{tiles(rest)}</>}
        {shop.length > 0 && <><h2 className="mb-2 mt-4 text-sm font-bold text-slate-500">{t('الماركات')}</h2>{tiles(shop)}</>}
      </Page>
    );
  }
  if (v === 'usual') {
    const ranked = rankQuick(quick.items, history);
    return (
      <Page title={t('المعتاد')} back={back}>
        <p className="mb-2 text-sm text-slate-500">{t('ضغطة وحدة تسجّلها بكميتها المعتادة.')}</p>
        {ranked.length ? <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm">{ranked.slice(0, 30).map((qi) => (
          <li key={qi.id}><button onClick={() => void logged(qi).catch((e) => toast((e as Error).message))} className="flex min-h-[56px] w-full items-center gap-3 px-3 text-start active:bg-slate-50">
            <bdi className="min-w-0 flex-1 truncate text-[15px] font-semibold">{tMaybe(qi.name)}</bdi><b className="num shrink-0">{fmt(qi.carbs)} {t('غ')}</b>
          </button></li>))}</ul> : <p className="py-6 text-center text-slate-500">{t('ما في شي بعد')}</p>}
      </Page>
    );
  }
  if (v === 'new') return (
    <Page title={t('منتج جديد')} back={back}>
      <ProductForm q={null} brands={brandsOf(quick.items)} onDone={() => { void quick.reload(); back(); }} onLog={logged} />
    </Page>
  );
  if (v === 'more') {
    const more: [string, string, () => void][] = [
      ['🍚', t('كارب فقط'), () => nav('/?log=carbs')],
      ['📷', t('صورة + كارب'), () => nav('/scan')],
      ['🍲', t('من الوصفات'), () => nav('/meals')],
      ['➕', t('+ منتج جديد ليس في القائمة'), () => go('?v=new')],
    ];
    return (
      <Page title={t('المزيد')} back={back}>
        <div className="grid grid-cols-3 gap-2">
          {groupsIn(products).map(({ group: x }) => (
            <button key={x.key} onClick={() => go(`?g=${x.key}`)} className="flex min-h-[84px] flex-col items-center justify-center gap-1 rounded-2xl bg-white px-1 text-center shadow-sm active:opacity-80">
              <span aria-hidden className="text-[28px] leading-none">{x.emoji}</span><span className="text-[13px] font-bold leading-tight">{tMaybe(x.label)}</span>
            </button>
          ))}
        </div>
        <ul className="mt-4 divide-y divide-slate-100 overflow-hidden rounded-2xl bg-white shadow-sm">{more.map(([i, l, f]) => (
          <li key={l}><button onClick={f} className="flex min-h-[52px] w-full items-center gap-3 px-3 text-start font-semibold active:bg-slate-50"><span aria-hidden className="text-xl">{i}</span><span className="flex-1">{l}</span><span aria-hidden className="text-slate-300">{isEn() ? '›' : '‹'}</span></button></li>))}</ul>
      </Page>
    );
  }
  // the first page: search, usual, an earlier meal, nine tiles
  const found = q.trim() ? order(products.filter((p) => matches([p.name, p.name_ar, p.name_en, p.brand, restaurantOf(p.brand)?.label, p.category], q))).slice(0, 60) : [];
  return (
    <Page title={t('أكل')} back={back}>
      <input className={cx(inputCls, 'mb-3')} type="search" enterKeyHint="search" dir="auto" value={q} onChange={(e) => setQ(e.target.value)} placeholder={`🔍 ${t('ابحث عن منتج أو شركة')}`} aria-label={t('ابحث عن منتج أو شركة')} />
      {q.trim() ? list(found) : (
        <>
          <div className="mb-3 grid grid-cols-2 gap-2">
            <button onClick={() => go('?v=usual')} className="min-h-[52px] rounded-2xl bg-brand-soft font-bold text-brand active:opacity-80">⭐ {t('المعتاد')}</button>
            <button onClick={() => nav('/reuse')} className="min-h-[52px] rounded-2xl bg-brand-soft font-bold text-brand active:opacity-80">🔁 {t('وجبة سابقة')}</button>
          </div>
          <div className="grid grid-cols-3 gap-2.5">
            {ADD_TILES.map((x) => (
              <button key={x.to} onClick={() => go(target(x.to))} className="flex min-h-[96px] flex-col items-center justify-center gap-1.5 rounded-2xl bg-white px-1 text-center shadow-sm active:opacity-80">
                <span aria-hidden className="text-[32px] leading-none">{x.emoji}</span><span className="text-sm font-bold leading-tight">{t(x.label)}</span>
              </button>
            ))}
          </div>
          <div className="mt-3 flex justify-center gap-4 text-sm font-bold text-brand">
            <button className="min-h-[44px]" onClick={() => nav('/?log=carbs')}>🍚 {t('كارب فقط')}</button>
            <button className="min-h-[44px]" onClick={() => nav('/scan')}>📷 {t('صورة + كارب')}</button>
          </div>
        </>
      )}
    </Page>
  );
}
