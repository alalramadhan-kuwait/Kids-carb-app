import { useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { logQuick, useQuickItems, type QuickItem } from '../lib/quick';
import { ProductForm } from './ProductForm';
import { deleteHistory } from '../lib/api';
import { fmt } from '../lib/carbs';
import { Btn, Chip, Sheet, cx, toast } from './ui';
import { brandsOf, sameBrand } from '../lib/brand';
import { KIND_STYLE } from '../lib/kinds';
import { t, tMaybe } from '../i18n';

/** أكل متكرر on the Meals tab: log with one tap; tap the name to correct it or remove it. */
export function QuickItemsSection() {
  const { reload } = useData();
  const { items, reload: reloadQuick } = useQuickItems();
  const [edit, setEdit] = useState<QuickItem | 'new' | null>(null);
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState<string | null>(null);
  const brands = useMemo(() => brandsOf(items), [items]);
  const shown = brand ? items.filter((q) => sameBrand(q.brand, brand)) : items;

  const log = async (q: QuickItem) => {
    setBusy(true);
    try {
      const id = await logQuick(q); await reload(); void reloadQuick();
      toast(t('تم التسجيل: {x}', { x: `${tMaybe(q.name)} · ${t('{g} غ', { g: fmt(q.carbs) })}` }), { label: t('تراجع'), run: async () => { await deleteHistory(id); await reload(); } });
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <>
      <div className="mb-2 mt-6 flex items-baseline justify-between gap-2">
        <h2 className="text-lg font-bold">{t('أكل متكرر')}</h2>
        <button className="min-h-[40px] text-sm font-bold text-brand" onClick={() => setEdit('new')}>{t('+ منتج جديد')}</button>
      </div>
      {brands.length > 0 && (
        <div className="-mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4">
          <Chip active={!brand} onClick={() => setBrand(null)}>{t('الكل')}</Chip>
          {brands.map((b) => <Chip key={b} active={sameBrand(brand, b)} onClick={() => setBrand(b)}><bdi>{b}</bdi></Chip>)}
        </div>
      )}
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
        {shown.map((q) => (
          <li key={q.id} className="flex items-center gap-3 px-4 py-2">
            <button className="min-w-0 flex-1 text-start" onClick={() => setEdit(q)}>
              <bdi className="block truncate font-bold">{tMaybe(q.name)}</bdi>
              <span className="block text-xs text-slate-500">{q.brand && <><bdi>{q.brand}</bdi> · </>}<span className="num">{fmt(q.carbs)}</span> {t('غ كارب')} · {t('{n} مرة', { n: q.uses })}</span>
            </button>
            <Btn kind="soft" className={cx('min-h-[44px] shrink-0 !px-4', KIND_STYLE.meal.soft)} disabled={busy} onClick={() => log(q)}>{t('سجّل')}</Btn>
          </li>
        ))}
      </ul>
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit === 'new' ? t('منتج جديد') : edit ? tMaybe(edit.name) : ''}>
        {edit && <ProductForm key={edit === 'new' ? 'new' : edit.id} q={edit === 'new' ? null : edit} brands={brands} onLog={log} onDone={async () => { setEdit(null); await reloadQuick(); }} />}
      </Sheet>
    </>
  );
}
