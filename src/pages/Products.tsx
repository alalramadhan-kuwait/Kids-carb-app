import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { fmt, targetMiss } from '../lib/carbs';
import { setAvailable } from '../lib/api';
import { groupOf, groupsIn, typesIn } from '../lib/productGroups';
import { t, tMaybe } from '../i18n';
import { Badge, Card, Chip, Page, Photo, Toggle, toast } from '../components/ui';
import { brandsOf, sameBrand } from '../lib/brand';
import { ProductSheet } from '../components/ProductSheet';
import type { Product } from '../lib/types';

export function ProductList() {
  const { products, settings, reload } = useData();
  const [group, setGroup] = useState<string | null>(null);   // dairy, drinks… (within the brand, when one is picked)
  const [cat, setCat] = useState('');                         // a type inside the group: milk, laban…
  const [q, setQ] = useState('');
  const [onlyHome, setOnlyHome] = useState(false);
  const [brand, setBrand] = useState<string | null>(null);
  const [picked, setPicked] = useState<Product | null>(null);
  const brands = brandsOf(products.map((p) => ({ brand: p.brand })));
  const ofBrand = products.filter((p) => !brand || sameBrand(p.brand, brand));
  const groups = groupsIn(ofBrand);
  const g = groups.some((x) => x.group.key === group) ? group : null;   // a group the brand does not have is ignored
  const types = g ? typesIn(ofBrand, g) : [];
  const c = types.some((x) => x.cat === cat) ? cat : '';
  const pickBrand = (b: string | null) => { setBrand(b); setGroup(null); setCat(''); };
  const rows = ofBrand.filter((p) => (!g || groupOf(p.category).key === g) && (!c || p.category === c) && (!onlyHome || p.available) && (p.name + (p.brand ?? '')).toLowerCase().includes(q.toLowerCase()));

  return (
    <Page title={t('دليل المنتجات')} action={<Link to="/products/new" className="grid min-h-[44px] place-items-center rounded-xl bg-brand px-4 font-medium text-white">{t('+ منتج')}</Link>}>
      <input className="mb-3 min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-3" placeholder={t('ابحث عن منتج أو شركة')} value={q} onChange={(e) => setQ(e.target.value)} />
      {/* brand first, then its groups (only the ones it has, with counts), then the types inside the chosen group */}
      {brands.length > 0 && (
        <div className="-mx-4 mb-2 flex items-center gap-1.5 overflow-x-auto px-4">
          <span className="shrink-0 text-xs font-medium text-slate-500">{t('البراند')}</span>
          <Chip active={!brand} onClick={() => pickBrand(null)}>{t('الكل')}</Chip>
          {brands.map((b) => <Chip key={b} active={sameBrand(brand, b)} onClick={() => pickBrand(b)}><bdi>{b}</bdi></Chip>)}
        </div>
      )}
      {groups.length > 1 && (
        <div className="-mx-4 mb-2 flex items-center gap-1.5 overflow-x-auto px-4">
          <span className="shrink-0 text-xs font-medium text-slate-500">{t('المجموعة')}</span>
          <Chip active={!g} onClick={() => { setGroup(null); setCat(''); }}>{t('الكل')} <span className="num opacity-60">{ofBrand.length}</span></Chip>
          {groups.map(({ group: x, n }) => <Chip key={x.key} active={g === x.key} onClick={() => { setGroup(x.key); setCat(''); }}>{x.emoji} {tMaybe(x.label)} <span className="num opacity-60">{n}</span></Chip>)}
        </div>
      )}
      {types.length > 1 && (
        <div className="-mx-4 mb-2 flex items-center gap-1.5 overflow-x-auto px-4">
          <span className="shrink-0 text-xs font-medium text-slate-500">{t('النوع')}</span>
          <Chip active={!c} onClick={() => setCat('')}>{t('الكل')}</Chip>
          {types.map((x) => <Chip key={x.cat} active={c === x.cat} onClick={() => setCat(x.cat)}>{tMaybe(x.cat)} <span className="num opacity-60">{x.n}</span></Chip>)}
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
