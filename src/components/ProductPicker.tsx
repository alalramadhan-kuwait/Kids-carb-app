import { useMemo, useState } from 'react';
import { matches } from '../lib/search';
import { useData } from '../lib/data';
import { brandsOf, sameBrand } from '../lib/brand';
import { groupOf, groupsIn, typesIn } from '../lib/productGroups';
import { fmt } from '../lib/carbs';
import type { Product } from '../lib/types';
import { Chip, Photo, cx, inputCls } from './ui';
import { t, tMaybe } from '../i18n';

/** The products catalogue as a quick list to log from: search, then brand → group → type chips (as in the products
 *  page), what is at home first. */
/** `category`: the ingredient's category, listed first (choosing a product for a recipe line). */
export function ProductPicker({ onPick, category }: { onPick: (p: Product) => void; category?: string | null }) {
  const { products } = useData();
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  const [group, setGroup] = useState<string | null>(null);
  const [cat, setCat] = useState('');
  const [home, setHome] = useState(false);
  const brands = useMemo(() => brandsOf(products), [products]);
  const ofBrand = useMemo(() => products.filter((p) => !brand || sameBrand(p.brand, brand)), [products, brand]);
  const groups = useMemo(() => groupsIn(ofBrand), [ofBrand]);
  const g = groups.some((x) => x.group.key === group) ? group : null;   // a group the brand does not have is ignored
  const types = useMemo(() => (g ? typesIn(ofBrand, g) : []), [ofBrand, g]);
  const c = types.some((x) => x.cat === cat) ? cat : '';
  const pickBrand = (b: string | null) => { setBrand(b); setGroup(null); setCat(''); };
  const rows = useMemo(() => {
    return ofBrand
      .filter((p) => (!g || groupOf(p.category).key === g) && (!c || p.category === c) && (!home || p.available) && matches([p.name, p.brand, p.category], q))
      .sort((a, b) => Number(b.category === category) - Number(a.category === category) || Number(b.available) - Number(a.available) || Number(b.approved) - Number(a.approved) || a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [ofBrand, q, g, c, home, category]);
  const u = (p: Product) => (p.unit === 'ml' ? t('مل') : t('غ'));
  return (
    <div>
      {/* search and brands stay on top while the list scrolls (one scroll: the sheet's); the keyboard opens only when asked */}
      <div className="sticky -top-2 z-10 -mx-4 space-y-2 bg-white px-4 pb-2 pt-1">
        <input className={inputCls} dir="auto" type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث عن منتج أو شركة')} />
        {brands.length > 0 && (
          <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4">
            <span className="shrink-0 text-xs font-medium text-slate-500">{t('البراند')}</span>
            <Chip active={!brand} onClick={() => pickBrand(null)}>{t('الكل')}</Chip>
            {brands.map((b) => <Chip key={b} active={sameBrand(brand, b)} onClick={() => pickBrand(b)}><bdi>{b}</bdi></Chip>)}
          </div>
        )}
        {groups.length > 1 && (
          <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4">
            <span className="shrink-0 text-xs font-medium text-slate-500">{t('المجموعة')}</span>
            <Chip active={!g} onClick={() => { setGroup(null); setCat(''); }}>{t('الكل')} <span className="num opacity-60">{ofBrand.length}</span></Chip>
            {groups.map(({ group: x, n }) => <Chip key={x.key} active={g === x.key} onClick={() => { setGroup(x.key); setCat(''); }}>{x.emoji} {tMaybe(x.label)} <span className="num opacity-60">{n}</span></Chip>)}
          </div>
        )}
        {types.length > 1 && (
          <div className="-mx-4 flex items-center gap-1.5 overflow-x-auto px-4">
            <span className="shrink-0 text-xs font-medium text-slate-500">{t('النوع')}</span>
            <Chip active={!c} onClick={() => setCat('')}>{t('الكل')}</Chip>
            {types.map((x) => <Chip key={x.cat} active={c === x.cat} onClick={() => setCat(x.cat)}>{tMaybe(x.cat)} <span className="num opacity-60">{x.n}</span></Chip>)}
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="h-5 w-5" checked={home} onChange={(e) => setHome(e.target.checked)} /> {t('الموجود بالبيت فقط')}</label>
      </div>
      <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
        {rows.map((p) => (
          <li key={p.id}>
            <button onClick={() => { (document.activeElement as HTMLElement | null)?.blur(); onPick(p); }} className="flex min-h-[56px] w-full items-center gap-3 px-3 py-1.5 text-start active:bg-slate-50">
              <Photo path={p.image_path} category={p.category} className="h-10 w-10 shrink-0 rounded-lg" />
              <span className="min-w-0 flex-1">
                <bdi className="block truncate text-sm font-medium">{tMaybe(p.name)}</bdi>
                <span className="block truncate text-xs text-slate-500">{[p.brand, tMaybe(p.category)].filter(Boolean).join(' · ')}{!p.approved ? ' · ' + t('غير معتمد') : ''}</span>
              </span>
              <span className={cx('shrink-0 text-xs text-slate-600', !p.approved && 'opacity-50')}>
                <b className="text-sm text-slate-900">{fmt(p.carbs_per_100)}</b> {p.per_item ? t('غ كارب بالحبة') : <>{t('غ')}/100{u(p)}</>}
              </span>
            </button>
          </li>
        ))}
        {!rows.length && <li className="p-3 text-sm text-slate-500">{t('لا توجد نتائج')}</li>}
      </ul>
    </div>
  );
}
