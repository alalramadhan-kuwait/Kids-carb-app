import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { fmt, targetMiss } from '../lib/carbs';
import { setAvailable } from '../lib/api';
import { PRODUCT_CATEGORIES } from '../lib/constants';
import { t, tMaybe } from '../i18n';
import { Badge, Card, Chip, Page, Photo, Toggle, toast } from '../components/ui';
import { brandsOf, sameBrand } from '../lib/brand';
import { ProductSheet } from '../components/ProductSheet';
import type { Product } from '../lib/types';

export function ProductList() {
  const { products, settings, reload } = useData();
  const [cat, setCat] = useState('');
  const [q, setQ] = useState('');
  const [onlyHome, setOnlyHome] = useState(false);
  const [brand, setBrand] = useState<string | null>(null);
  const [picked, setPicked] = useState<Product | null>(null);
  const brands = brandsOf(products.map((p) => ({ brand: p.brand })));
  const cats = [...new Set([...PRODUCT_CATEGORIES.filter((c) => products.some((p) => p.category === c)), ...products.map((p) => p.category)])];
  const rows = products.filter((p) => (!cat || p.category === cat) && (!brand || sameBrand(p.brand, brand)) && (!onlyHome || p.available) && (p.name + (p.brand ?? '')).toLowerCase().includes(q.toLowerCase()));

  return (
    <Page title={t('دليل المنتجات')} action={<Link to="/products/new" className="grid min-h-[44px] place-items-center rounded-xl bg-brand px-4 font-medium text-white">{t('+ منتج')}</Link>}>
      <input className="mb-3 min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3" placeholder={t('ابحث عن منتج أو شركة')} value={q} onChange={(e) => setQ(e.target.value)} />
      <div className="-mx-4 mb-3 flex gap-2 overflow-x-auto px-4">
        <Chip active={!cat} onClick={() => setCat('')}>{t('الكل')}</Chip>
        {cats.map((c) => <Chip key={c} active={cat === c} onClick={() => setCat(c)}>{tMaybe(c)}</Chip>)}
      </div>
      {brands.length > 0 && (
        <div className="-mx-4 mb-3 flex items-center gap-1.5 overflow-x-auto px-4">
          <span className="shrink-0 text-xs font-medium text-slate-500">{t('البراند')}</span>
          <Chip active={!brand} onClick={() => setBrand(null)}>{t('الكل')}</Chip>
          {brands.map((b) => <Chip key={b} active={sameBrand(brand, b)} onClick={() => setBrand(b)}><bdi>{b}</bdi></Chip>)}
        </div>
      )}
      <label className="mb-3 flex items-center gap-2 text-sm text-slate-600"><input type="checkbox" className="h-5 w-5" checked={onlyHome} onChange={(e) => setOnlyHome(e.target.checked)} /> {t('الموجود بالبيت فقط')}</label>
      <div className="space-y-3">
        {rows.map((p) => {
          const miss = targetMiss(p, settings);
          return (
            <Card key={p.id} className="flex items-center gap-3 !p-3">
              <button onClick={() => setPicked(p)} className="flex min-w-0 flex-1 items-center gap-3 text-start">
                <Photo path={p.image_path} category={p.category} className="h-16 w-16 shrink-0 rounded-xl" />
                <div className="min-w-0">
                  <div className="truncate font-bold">{p.name}</div>
                  <div className="truncate text-xs text-slate-500">{p.brand ?? (p.kind === 'natural' ? t('مرجعي') : '—')} • {tMaybe(p.category)}</div>
                  <div className="text-sm"><span className="num font-bold">{fmt(p.carbs_per_100)}</span> {p.unit === 'g' ? t('غ/100غ') : t('غ/100مل')}
                    {p.carbs_per_serving !== null && <> • {t('حصة')} <span className="num font-bold">{fmt(p.carbs_per_serving)}</span></>}</div>
                  <div className="mt-0.5 flex flex-wrap gap-1">
                    {p.approved ? <Badge tone="ok">{t('معتمد')}</Badge> : <Badge tone="near">{t('غير معتمد')}</Badge>}
                    {miss && <Badge tone="over">{t('فوق الهدف ({max})', { max: miss.max })}</Badge>}
                  </div>
                </div>
              </button>
              <div className="flex shrink-0 flex-col items-center gap-1">
                <Toggle on={p.available} label={t('{name} موجود بالبيت', { name: p.name })} onChange={async (v) => { try { await setAvailable(p.id, v); await reload(); } catch (e) { toast((e as Error).message); } }} />
                <span className="text-[11px] text-slate-500">{p.available ? t('موجود') : t('غير موجود')}</span>
              </div>
            </Card>
          );
        })}
        {rows.length === 0 && <Card><p className="text-slate-500">{t('لا توجد منتجات. أضف منتجًا من ملصقه الغذائي.')}</p></Card>}
      </div>
      <ProductSheet p={picked} onClose={() => setPicked(null)} />
    </Page>
  );
}
