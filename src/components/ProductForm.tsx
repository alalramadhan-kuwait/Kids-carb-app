import { useState } from 'react';
import { createQuick, deleteQuick, saveQuick, type QuickFields, type QuickItem } from '../lib/quick';
import { normBrand } from '../lib/brand';
import { nutrProblem, totalsOf, type NutrState } from '../lib/per100';
import { NutritionFields, nutrStateFrom } from './NutritionFields';
import { Alert, Btn, toast } from './ui';
import { lang, t, tMaybe, tr } from '../i18n';
import { PRODUCT_CATEGORIES } from '../lib/constants';
import type { Label } from '../lib/food';
import { readLabelLocal } from '../lib/labelOcr';

const PROBLEM: Record<string, string> = tr({ // i18n-ok: values translated when read
  name: 'اكتبوا اسم المنتج', carbs: 'اكتبوا الكارب', per100: 'لكل 100 لا يمكن أن يزيد عن 100 غ: هل كتبتم قيم الحصة؟', amount: 'اكتبوا الكمية (مل أو غ)', values: 'القيم الغذائية غير معقولة', // i18n-ok
});
const READ_ERR: Record<string, string> = tr({ // i18n-ok: values translated when read
  not_label: 'ما قدرت أقرأ الكارب. صوّروا الجدول أوضح ومستقيم', server: 'ما قدرت أقرأ الملصق. حاولوا مرة ثانية أو اكتبوا القيم', // i18n-ok
});
const FIELD_AR: Record<string, string> = tr({ // i18n-ok: values translated when read
  name: 'الاسم', brand: 'البراند', barcode: 'الباركود', serving: 'الحصة', pack: 'العبوة', carbs: 'الكارب', sugar: 'السكريات', fiber: 'الألياف', fat: 'الدهون', protein: 'البروتين', kcal: 'السعرات' }); // i18n-ok
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
  const [kind] = useState<'meal' | 'snack'>(q?.kind === 'snack' ? 'snack' : 'meal'); // kept as saved; no longer asked
  const [category, setCategory] = useState('');
  const [n, setN] = useState<NutrState>(() => nutrStateFrom(
    { carbs: q?.carbs ?? null, fat: q?.fat ?? null, protein: q?.protein ?? null, fiber: q?.fiber ?? null, kcal: q?.kcal ?? null }, q?.per100, q?.amount, q?.amount_unit));
  const [busy, setBusy] = useState(false);
  const [shots, setShots] = useState<(File | undefined)[]>([]);
  const [reading, setReading] = useState(false);
  const [read, setRead] = useState<Label | null>(null);
  const [readErr, setReadErr] = useState('');
  const fill = (l: Label) => {
    if (l.name) setName(l.name);
    if (l.brand) setBrand(l.brand);
    if (l.barcode) setBarcode(l.barcode);
    if (l.category) setCategory(l.category);
    const p = l.per100;
    const amount = l.serving ?? l.pack ?? 100;
    setN({ mode: 'per100', serving: { carbs: null, fat: null, protein: null, fiber: null, kcal: null },
      per100: { carbs: p.carbs, fat: p.fat, protein: p.protein, fiber: p.fiber, kcal: p.kcal }, amount, unit: l.unit });
  };
  const runRead = async () => {
    setReading(true); setReadErr('');
    try { const l = await readLabelLocal(shots[0], shots[1] ?? shots[0], lang()); setRead(l); if (l.is_label) fill(l); else setReadErr('not_label'); }
    catch (e) { setReadErr((e as Error).message); } finally { setReading(false); }
  };
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
      if (q) { await saveQuick(q.id, fields(), q.product_id); toast(t('تم الحفظ ✓')); }
      else { const made = await createQuick(fields(), category); if (andLog && onLog) await onLog(made); else toast(t('أُضيف إلى المنتجات و«أكل متكرر» ✓')); }
      onDone();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-2.5">
      {!q && (
        <div className="rounded-2xl border border-dashed border-slate-300 p-2.5">
          <div className="grid grid-cols-2 gap-2">
            {[t('صورة العبوة'), t('جدول القيم الغذائية')].map((lbl, i) => (
              <label key={i} className={`flex min-h-[64px] cursor-pointer flex-col items-center justify-center rounded-xl text-center text-sm ${shots[i] ? 'bg-emerald-50 text-emerald-700' : 'bg-slate-50 text-slate-600'}`}>
                <span>{shots[i] ? '✓' : '📷'} {lbl}</span>
                <input type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => {
                  const f = e.target.files?.[0]; if (!f) return;
                  setShots((s) => { const x = [...s]; x[i] = f; return x; }); setRead(null); setReadErr('');
                }} />
              </label>
            ))}
          </div>
          <Btn kind="primary" className="mt-2 w-full" disabled={!shots.some(Boolean) || reading} onClick={runRead}>{reading ? t('يقرأ الملصق…') : t('📷 اقرأ الملصق')}</Btn>
          {readErr && <Alert tone="near">{READ_ERR[readErr] ?? READ_ERR.server}</Alert>}
          {read?.is_label && (
            <div className="mt-2 space-y-1 text-xs text-slate-600">
              <p>{t('انقرأ لكل 100. راجعوا كل رقم قبل الحفظ: ما ينحفظ شي قبل ما تضغطون.')}</p>
              {read.label_style === 'eu_fibre_excluded' && <p className="text-amber-700">{t('⚠ ملصق أوروبي: الكارب بدون الألياف')}</p>}
              {read.label_style === 'fibre_included' && <p className="text-amber-700">{t('⚠ الكارب يشمل الألياف')}</p>}
              {read.uncertain.length > 0 && <Alert tone="near">{`${t('تأكدوا من:')} ${read.uncertain.map((f) => FIELD_AR[f] ?? f).join(' · ')}`}</Alert>}
            </div>
          )}
        </div>
      )}
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
      </div>
      {!q && (
        <L label={t('المجموعة في المنتجات')}>
          <input className={box} dir="auto" list="product-categories" value={category} maxLength={40} placeholder={kind === 'snack' ? tMaybe('سناكات') : tMaybe('أخرى')} onChange={(e) => setCategory(e.target.value)} />
          <datalist id="product-categories">{PRODUCT_CATEGORIES.map((c) => <option key={c} value={c}>{tMaybe(c)}</option>)}</datalist>
        </L>
      )}
      {!q && <p className="text-xs text-slate-500">{t('يُحفظ في «المنتجات» ويظهر هنا كاختصار بضغطة واحدة.')}</p>}
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
