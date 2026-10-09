import { useMemo, useState } from 'react';
import { useData } from '../lib/data';
import { addRow, carbsOfRow, recompute, rowsOf, type ItemRow } from '../lib/mealItems';
import { updateMealItems } from '../lib/editSave';
import { fmt } from '../lib/carbs';
import type { HistoryEntry } from '../lib/types';
import { ProductPicker } from './ProductPicker';
import { Btn, NumInput, cx, toast } from './ui';
import { t, tMaybe } from '../i18n';

const UNIT: Record<string, () => string> = { g: () => t('غ'), ml: () => t('مل'), serving: () => t('حصة'), tbsp: () => t('ملعقة') };

/**
 * The items of THIS logged meal: change an amount, remove one, add a product. Carbs and nutrition are recalculated
 * from each product's label; the recipe itself is not changed.
 */
export function EditItems({ h, onCancel, onDone, onSave, saveLabel, note, extra }: {
  h: HistoryEntry; onCancel: () => void; onDone: () => void;
  /** a new meal from this one: the edited items go here instead of changing this entry */
  onSave?: (r: ReturnType<typeof recompute>) => Promise<void>; saveLabel?: string; note?: string; extra?: React.ReactNode;
}) {
  const { products, settings, me, reload } = useData();
  const [rows, setRows] = useState<ItemRow[]>(() => rowsOf(h, products));
  const [picking, setPicking] = useState(false);
  const [busy, setBusy] = useState(false);
  const r = useMemo(() => recompute(h, rows, settings), [h, rows, settings]);
  const setQty = (i: number, q: number | null) => setRows((xs) => xs.map((x, k) => (k === i ? { ...x, line: { ...x.line, quantity: q ?? 0 } } : x)));
  const changed = !!onSave || rows.some((x) => x.added || x.line.quantity !== x.q0);
  const save = async () => {
    if (!r.lines.length) return toast(t('أبقوا صنفًا واحدًا على الأقل، أو احذفوا التسجيل كله'));
    setBusy(true);
    try { if (onSave) await onSave(r); else { await updateMealItems(h, r, me); await reload(); toast(t('تم التعديل ✓')); } onDone(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  if (picking) return (
    <div className="space-y-2">
      <ProductPicker onPick={(p) => { setRows((xs) => [...xs, addRow(p)]); setPicking(false); }} />
      <Btn block kind="ghost" onClick={() => setPicking(false)}>{t('رجوع')}</Btn>
    </div>
  );

  return (
    <div className="space-y-3">
      <ul className="divide-y divide-slate-100">
        {rows.map((x, i) => {
          const gone = x.line.quantity <= 0;
          return (
            <li key={i} className={cx('flex items-center gap-2 py-2', gone && 'opacity-50')}>
              <span className="min-w-0 flex-1">
                <span className={cx('block truncate text-sm font-medium', gone && 'line-through')}><bdi>{tMaybe(x.line.name)}</bdi></span>
                <span className="block text-xs text-slate-500">{gone ? t('محذوف') : <><span className="num">{fmt(carbsOfRow(x, settings))}</span> {t('غ كارب')}</>}{!x.product && !gone && <> · {t('بدون منتج: الكارب بالنسبة')}</>}</span>
              </span>
              <span className="w-20 shrink-0"><NumInput className="!min-h-[40px] !px-1 !text-center" value={x.line.quantity} onChange={(v) => setQty(i, v)} /></span>
              <span className="w-10 shrink-0 text-xs text-slate-500">{UNIT[x.line.unit]?.() ?? x.line.unit}</span>
              <button onClick={() => setQty(i, gone ? (x.q0 || 1) : 0)} aria-label={gone ? t('إرجاع') : t('حذف')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500 active:bg-slate-50">{gone ? '↺' : '✕'}</button>
            </li>
          );
        })}
      </ul>
      <button onClick={() => setPicking(true)} className="min-h-[44px] text-sm font-bold text-brand">{t('+ صنف من المنتجات')}</button>
      <div className="flex items-baseline justify-between rounded-xl bg-slate-50 px-3 py-2">
        <span className="text-sm text-slate-600">{t('المجموع')}</span>
        <span><b className="num text-xl text-brand-num">{fmt(r.carbs)}</b> <span className="text-sm text-slate-500">{t('غ كارب')}</span>{r.carbs !== h.total_carbs && <span className="text-xs text-slate-500"> ({t('كان {g}', { g: fmt(h.total_carbs) })})</span>}</span>
      </div>
      {extra}
      <p className="text-[11px] text-slate-500">{note ?? t('يتغيّر هذا التسجيل فقط، والوصفة كما هي. الإنسولين المعطى لا يتغير.')}</p>
      <div className="sticky bottom-0 -mx-4 grid grid-cols-2 gap-2 border-t border-slate-100 bg-white px-4 pb-1 pt-2 lg:-mx-6 lg:px-6">
        <Btn kind="ghost" onClick={onCancel} disabled={busy}>{t('إلغاء')}</Btn>
        <Btn kind="primary" onClick={save} disabled={busy || !changed}>{busy ? t('جارٍ الحفظ…') : saveLabel ?? t('حفظ')}</Btn>
      </div>
    </div>
  );
}
