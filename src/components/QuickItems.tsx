import { useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { deleteQuick, logQuick, saveQuick, useQuickItems, type QuickItem } from '../lib/quick';
import { deleteHistory } from '../lib/api';
import { fmt } from '../lib/carbs';
import { Btn, Chip, Field, NumInput, Sheet, cx, inputCls, toast } from './ui';
import { brandsOf, normBrand, sameBrand } from '../lib/brand';
import { KIND_STYLE } from '../lib/kinds';
import { t, tMaybe } from '../i18n';

/** أكل متكرر on the Meals tab: log with one tap; tap the name to correct it or remove it. */
export function QuickItemsSection() {
  const { reload } = useData();
  const { items, reload: reloadQuick } = useQuickItems();
  const [edit, setEdit] = useState<QuickItem | null>(null);
  const [busy, setBusy] = useState(false);
  const [brand, setBrand] = useState<string | null>(null);
  const brands = useMemo(() => brandsOf(items), [items]);
  if (!items.length) return null;
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
      <h2 className="mb-2 mt-6 text-lg font-bold">{t('أكل متكرر')}</h2>
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
      <Sheet open={!!edit} onClose={() => setEdit(null)} title={edit ? tMaybe(edit.name) : ''}>
        {edit && <QuickEdit q={edit} brands={brands} onDone={async () => { setEdit(null); await reloadQuick(); }} />}
      </Sheet>
    </>
  );
}

function QuickEdit({ q, brands, onDone }: { q: QuickItem; brands: string[]; onDone: () => void }) {
  const [name, setName] = useState(q.name);
  const [brand, setBrand] = useState(q.brand ?? '');
  const [carbs, setCarbs] = useState<number | null>(q.carbs);
  const [fat, setFat] = useState<number | null>(q.fat);
  const [protein, setProtein] = useState<number | null>(q.protein);
  const [fiber, setFiber] = useState<number | null>(q.fiber);
  const [kcal, setKcal] = useState<number | null>(q.kcal);
  const g = (v: number | null) => v === null || (v >= 0 && v <= 300);
  const ok = !!name.trim() && carbs !== null && carbs >= 0 && carbs < 300 && g(fat) && g(protein) && g(fiber) && (kcal === null || (kcal >= 0 && kcal <= 3000));
  return (
    <div className="space-y-3">
      <Field label={t('الاسم')}><input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} /></Field>
      <Field label={t('البراند')}>
        <input className={inputCls} dir="auto" list="quick-brands" value={brand} maxLength={60} onChange={(e) => setBrand(e.target.value)} />
        <datalist id="quick-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
      </Field>
      <div className="grid grid-cols-5 gap-1.5">
        {([[t('كارب'), carbs, setCarbs], [t('دهون'), fat, setFat], [t('بروتين'), protein, setProtein], [t('ألياف'), fiber, setFiber], [t('سعرات'), kcal, setKcal]] as [string, number | null, (v: number | null) => void][]).map(([l, v, set]) => (
          <label key={l} className="block min-w-0"><span className="mb-0.5 block truncate text-xs font-medium text-slate-500">{l}</span><NumInput className="!min-h-[40px] !rounded-xl !px-1 !py-1.5 !text-center" value={v} onChange={set} /></label>
        ))}
      </div>
      {q.note && <p className="text-xs text-slate-500" dir="auto">{q.note}</p>}
      <div className="grid grid-cols-[1fr_2fr] gap-2">
        <Btn kind="danger" onClick={async () => { if (confirm(t('حذف من الأكل المتكرر؟'))) { await deleteQuick(q.id); onDone(); } }}>{t('حذف')}</Btn>
        <Btn kind="primary" disabled={!ok} onClick={async () => { try { await saveQuick(q.id, { name: name.trim(), brand: normBrand(brand), carbs: carbs!, fat, protein, fiber, kcal }); toast(t('تم الحفظ ✓')); onDone(); } catch (e) { toast((e as Error).message); } }}>{t('حفظ')}</Btn>
      </div>
    </div>
  );
}
