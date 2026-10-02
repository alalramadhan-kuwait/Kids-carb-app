import { useState } from 'react';
import { createQuick, deleteQuick, saveQuick, type QuickFields, type QuickItem } from '../lib/quick';
import { normBrand } from '../lib/brand';
import { nutrProblem, totalsOf, type NutrState } from '../lib/per100';
import { NutritionFields, nutrStateFrom } from './NutritionFields';
import { Alert, Btn, toast } from './ui';
import { t, tr } from '../i18n';

const PROBLEM: Record<string, string> = tr({ // i18n-ok: values translated when read
  name: 'اكتبوا اسم المنتج', carbs: 'اكتبوا الكارب', per100: 'لكل 100 لا يمكن أن يزيد عن 100 غ: هل كتبتم قيم الحصة؟', amount: 'اكتبوا الكمية (مل أو غ)', values: 'القيم الغذائية غير معقولة', // i18n-ok
});
const box = 'block w-full min-w-0 appearance-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 min-h-[40px] text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft';
const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block min-w-0"><span className="mb-0.5 block truncate text-xs font-medium text-slate-500">{label}</span>{children}</label>
);

/**
 * A frequent food: new (from the box in hand) or an existing one. Nutrition as printed per 100 ml/g with the
 * pack size, or straight per serving. A new one can be saved and logged in the same tap.
 */
export function ProductForm({ q, brands, onDone, onLog }: { q: QuickItem | null; brands: string[]; onDone: () => void; onLog?: (q: QuickItem) => Promise<void> }) {
  const [name, setName] = useState(q?.name ?? '');
  const [brand, setBrand] = useState(q?.brand ?? '');
  const [barcode, setBarcode] = useState(q?.barcode ?? '');
  const [kind, setKind] = useState<'meal' | 'snack'>(q?.kind === 'meal' ? 'meal' : 'snack');
  const [n, setN] = useState<NutrState>(() => nutrStateFrom(
    { carbs: q?.carbs ?? null, fat: q?.fat ?? null, protein: q?.protein ?? null, fiber: q?.fiber ?? null, kcal: q?.kcal ?? null }, q?.per100, q?.amount, q?.amount_unit));
  const [busy, setBusy] = useState(false);
  const problem = !name.trim() ? 'name' : nutrProblem(n);
  const others = brands.filter((b) => b.toLowerCase() !== brand.trim().toLowerCase()).slice(0, 8);

  const fields = (): QuickFields => {
    const tot = totalsOf(n), per = n.mode === 'per100';
    return {
      name: name.trim(), brand: normBrand(brand), kind, barcode: barcode.trim() || null,
      carbs: tot.carbs!, fat: tot.fat, protein: tot.protein, fiber: tot.fiber, kcal: tot.kcal,
      per100: per ? n.per100 : null, amount: per ? n.amount : null, amount_unit: per ? n.unit : null,
    };
  };
  const save = async (andLog: boolean) => {
    if (problem) return;
    setBusy(true);
    try {
      if (q) { await saveQuick(q.id, fields()); toast(t('تم الحفظ ✓')); }
      else { const made = await createQuick(fields()); if (andLog && onLog) await onLog(made); else toast(t('أُضيف إلى «أكل متكرر» ✓')); }
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2.5">
      <div className="grid grid-cols-[3fr_2fr] gap-2">
        <L label={t('الاسم')}><input className={box} dir="auto" value={name} maxLength={120} onChange={(e) => setName(e.target.value)} /></L>
        <L label={t('البراند')}>
          <input className={box} dir="auto" list="product-brands" value={brand} maxLength={60} onChange={(e) => setBrand(e.target.value)} />
          <datalist id="product-brands">{brands.map((b) => <option key={b} value={b} />)}</datalist>
        </L>
      </div>
      {others.length > 0 && (
        <div className="-mx-4 -mt-1 flex gap-1.5 overflow-x-auto px-4">
          {others.map((b) => <button key={b} type="button" onClick={() => setBrand(b)} className="h-7 shrink-0 rounded-full bg-slate-50 px-2.5 text-xs text-slate-600"><bdi>{b}</bdi></button>)}
        </div>
      )}
      <NutritionFields s={n} set={setN} />
      <div className="grid grid-cols-[3fr_2fr] gap-2">
        <L label={t('الباركود (اختياري)')}><input className={box} dir="ltr" inputMode="numeric" value={barcode} maxLength={20} onChange={(e) => setBarcode(e.target.value.replace(/\D/g, ''))} /></L>
        <L label={t('النوع')}>
          <div className="grid h-[40px] grid-cols-2 gap-1 rounded-xl bg-slate-50 p-1 text-sm">
            {(['snack', 'meal'] as const).map((k) => <button key={k} type="button" onClick={() => setKind(k)} className={kind === k ? 'rounded-lg bg-white font-medium text-brand shadow-sm' : 'text-slate-500'}>{k === 'snack' ? t('سناك') : t('وجبة')}</button>)}
          </div>
        </L>
      </div>
      {q?.note && <p className="text-xs text-slate-500" dir="auto">{q.note}</p>}
      {problem && (name.trim() || problem !== 'name') && problem !== 'carbs' && <Alert tone="near">{PROBLEM[problem]}</Alert>}
      {q ? (
        <div className="grid grid-cols-[1fr_2fr] gap-2">
          <Btn kind="danger" disabled={busy} onClick={async () => { if (confirm(t('حذف من الأكل المتكرر؟'))) { await deleteQuick(q.id); onDone(); } }}>{t('حذف')}</Btn>
          <Btn kind="primary" disabled={busy || !!problem} onClick={() => save(false)}>{t('حفظ')}</Btn>
        </div>
      ) : (
        <div className="grid grid-cols-2 gap-2">
          <Btn kind="ghost" disabled={busy || !!problem} onClick={() => save(false)}>{t('حفظ فقط')}</Btn>
          <Btn kind="primary" disabled={busy || !!problem || !onLog} onClick={() => save(true)}>{t('حفظ وسجّل الآن')}</Btn>
        </div>
      )}
    </div>
  );
}
