import { useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { brandsOf, sameBrand } from '../lib/brand';
import { fmt } from '../lib/carbs';
import type { Product } from '../lib/types';
import { Chip, Photo, cx, inputCls } from './ui';
import { t, tMaybe } from '../i18n';

/** The products catalogue as a quick list to log from: search, brand chips, what is at home first. */
export function ProductPicker({ onPick }: { onPick: (p: Product) => void }) {
  const { products } = useData();
  const [q, setQ] = useState('');
  const [brand, setBrand] = useState<string | null>(null);
  const brands = useMemo(() => brandsOf(products), [products]);
  const rows = useMemo(() => {
    const s = q.trim().toLowerCase();
    return products
      .filter((p) => (!brand || sameBrand(p.brand, brand)) && (!s || (p.name + ' ' + (p.brand ?? '') + ' ' + (p.category ?? '')).toLowerCase().includes(s)))
      .sort((a, b) => Number(b.available) - Number(a.available) || Number(b.approved) - Number(a.approved) || a.name.localeCompare(b.name))
      .slice(0, 60);
  }, [products, q, brand]);
  const u = (p: Product) => (p.unit === 'ml' ? t('مل') : t('غ'));
  return (
    <div>
      {/* search and brands stay on top while the list scrolls (one scroll: the sheet's); the keyboard opens only when asked */}
      <div className="sticky -top-2 z-10 -mx-4 space-y-2 bg-white px-4 pb-2 pt-1">
        <input className={inputCls} dir="auto" type="search" enterKeyHint="search" value={q} onChange={(e) => setQ(e.target.value)} placeholder={t('ابحث عن منتج أو شركة')} />
        {brands.length > 0 && (
          <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
            <Chip active={!brand} onClick={() => setBrand(null)}>{t('الكل')}</Chip>
            {brands.map((b) => <Chip key={b} active={sameBrand(brand, b)} onClick={() => setBrand(b)}><bdi>{b}</bdi></Chip>)}
          </div>
        )}
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
                <b className="text-sm text-slate-900">{fmt(p.carbs_per_100)}</b> {t('غ')}/100{u(p)}
              </span>
            </button>
          </li>
        ))}
        {!rows.length && <li className="p-3 text-sm text-slate-500">{t('لا توجد نتائج')}</li>}
      </ul>
    </div>
  );
}
