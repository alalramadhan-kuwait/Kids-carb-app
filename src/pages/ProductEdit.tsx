import { useMemo, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { deriveLabel, fmt, labelMismatch, targetMiss } from '../lib/carbs';
import { deleteProduct, saveProduct } from '../lib/api';
import { uploadPhoto } from '../lib/supabase';
import { PRODUCT_CATEGORIES } from '../lib/constants';
import { Alert, Btn, Card, Field, NumInput, Page, Photo, inputCls, toast } from '../components/ui';

export default function ProductEdit() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const nav = useNavigate();
  const { products, settings, reload, recipes, ingsByRecipe } = useData();
  const p = products.find((x) => x.id === id);

  const [name, setName] = useState(p?.name ?? '');
  const [brand, setBrand] = useState(p?.brand ?? '');
  const [category, setCategory] = useState(p?.category ?? sp.get('category') ?? '');
  const [kind, setKind] = useState<'natural' | 'commercial'>(p?.kind ?? 'commercial');
  const [image, setImage] = useState(p?.image_path ?? null);
  const [unit, setUnit] = useState<'g' | 'ml'>(p?.unit ?? 'g');
  const [packSize, setPackSize] = useState<number | null>(p?.pack_size ?? null);
  const [per100, setPer100] = useState<number | null>(p?.carbs_per_100 ?? null);
  const [serving, setServing] = useState<number | null>(p?.serving_size ?? null);
  const [perServing, setPerServing] = useState<number | null>(p?.carbs_per_serving ?? null);
  const [fat, setFat] = useState<number | null>(p?.fat_per_100 ?? null);
  const [fiber, setFiber] = useState<number | null>(p?.fiber_per_100 ?? null);
  const [protein, setProtein] = useState<number | null>(p?.protein_per_100 ?? null);
  const [kcal, setKcal] = useState<number | null>(p?.kcal_per_100 ?? null);
  const [basis, setBasis] = useState<'as_sold' | 'cooked'>(p?.label_basis ?? 'as_sold');
  const [cookedYield, setCookedYield] = useState<number | null>(p?.cooked_yield ?? null);
  const [approved, setApproved] = useState(p?.approved ?? true);
  const [available, setAvailableState] = useState(p?.available ?? true);
  const [notes, setNotes] = useState(p?.notes ?? '');
  const [busy, setBusy] = useState(false);

  const derived = deriveLabel({ per100, serving, perServing });
  const mismatch = labelMismatch(per100, serving, perServing);
  const miss = derived.per100 !== null ? targetMiss({ category, carbs_per_100: derived.per100, serving_size: serving, carbs_per_serving: derived.perServing }, settings) : null;
  const usedBy = useMemo(() => p ? recipes.filter((r) => (ingsByRecipe.get(r.id) ?? []).some((i) => i.product_id === p.id)).map((r) => r.name) : [], [p, recipes, ingsByRecipe]);

  const save = async () => {
    if (!name.trim() || !category.trim()) return toast('اكتب اسم المنتج وفئته');
    if (derived.per100 === null) return toast('أدخل Total Carbohydrate: لكل 100 أو للحصة مع وزنها');
    setBusy(true);
    try {
      await saveProduct({
        id: p?.id, name: name.trim(), brand: brand.trim() || null, category: category.trim(), kind, image_path: image, unit,
        pack_size: packSize, carbs_per_100: derived.per100, serving_size: serving, carbs_per_serving: derived.perServing,
        fat_per_100: fat, fiber_per_100: fiber, protein_per_100: protein, kcal_per_100: kcal,
        label_basis: basis, cooked_yield: cookedYield, approved, available, notes: notes.trim() || null,
        label_updated_at: new Date().toISOString().slice(0, 10),
      });
      await reload();
      toast('تم حفظ المنتج ✓');
      nav('/products', { replace: true });
    } catch (e) { toast('تعذّر الحفظ: ' + (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title={p ? 'تعديل منتج' : 'إضافة منتج'} back={() => nav(-1)}>
      {!p && <div className="mb-3"><Alert tone="info">أدخل بيانات الملصق الغذائي كما هي. التطبيق يحسب دائمًا من <b>Total Carbohydrate</b> وليس من السكر فقط.</Alert></div>}
      <div className="space-y-4">
        <Card className="space-y-3">
          <Field label="اسم المنتج"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="الشركة"><input className={inputCls} value={brand} onChange={(e) => setBrand(e.target.value)} placeholder="مثل: المطاحن، KDD، Americana" /></Field>
          <Field label="الفئة">
            <input className={inputCls} list="pcats" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="pcats">{PRODUCT_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <div className="flex gap-2">
            {(['commercial', 'natural'] as const).map((k) => (
              <button key={k} onClick={() => setKind(k)} className={`min-h-[44px] flex-1 rounded-xl px-3 text-sm font-medium ${kind === k ? 'bg-brand text-white' : 'bg-white ring-1 ring-slate-200'}`}>
                {k === 'commercial' ? 'منتج تجاري (من الملصق)' : 'مكوّن طبيعي (قيمة مرجعية)'}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-3">
            <Photo path={image} category={category} className="h-20 w-20 rounded-xl" />
            <label className="min-h-[44px] cursor-pointer rounded-xl bg-brand-soft px-4 py-2.5 font-medium text-brand">
              {image ? 'تغيير الصورة' : 'صورة المنتج'}
              <input type="file" accept="image/*" capture="environment" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try { setImage(await uploadPhoto(f, 'products')); } catch (er) { toast('تعذّر رفع الصورة: ' + (er as Error).message); }
              }} />
            </label>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">الملصق الغذائي — Total Carbohydrate</h2>
          <div className="grid grid-cols-2 gap-3">
            <Field label="وحدة القياس">
              <select className={inputCls} value={unit} onChange={(e) => setUnit(e.target.value as 'g' | 'ml')}><option value="g">غرام (غ)</option><option value="ml">مل</option></select>
            </Field>
            <Field label={`حجم العبوة (${unit === 'g' ? 'غ' : 'مل'})`}><NumInput value={packSize} onChange={setPackSize} /></Field>
            <Field label={`كارب لكل 100${unit === 'g' ? 'غ' : 'مل'}`}><NumInput value={per100} onChange={setPer100} placeholder={derived.per100 !== null && per100 === null ? String(derived.per100) : ''} /></Field>
            <Field label="وزن الحصة / الحبة"><NumInput value={serving} onChange={setServing} /></Field>
            <Field label="كارب للحصة"><NumInput value={perServing} onChange={setPerServing} placeholder={derived.perServing !== null && perServing === null ? String(derived.perServing) : ''} /></Field>
          </div>
          <p className="text-sm text-slate-600">إن أدخلت أحد الرقمين (لكل 100 أو للحصة مع وزنها) يُحسب الآخر تلقائيًا:
            {derived.per100 !== null ? <> لكل 100: <b className="num">{fmt(derived.per100)}</b></> : ' —'}
            {derived.perServing !== null ? <> • للحصة: <b className="num">{fmt(derived.perServing)}</b></> : ''}</p>
          {mismatch !== null && <Alert tone="near">الرقمان لا يتطابقان: حسب الكارب لكل 100 يجب أن تكون الحصة ≈ {fmt(mismatch)}غ. راجع الملصق.</Alert>}
          {miss && <Alert tone="near">هذا المنتج فوق هدف الفئة "{miss.category}" ({miss.basis === 'per100' ? `≤${miss.max}غ لكل 100` : `≤${miss.max}غ للحصة`}). قيمته {fmt(miss.actual)}.</Alert>}
          <div className="grid grid-cols-2 gap-3">
            <Field label="دهون / 100"><NumInput value={fat} onChange={setFat} /></Field>
            <Field label="ألياف / 100"><NumInput value={fiber} onChange={setFiber} /></Field>
            <Field label="بروتين / 100"><NumInput value={protein} onChange={setProtein} /></Field>
            <Field label="سعرات / 100"><NumInput value={kcal} onChange={setKcal} /></Field>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">الطبخ</h2>
          <Field label="الأرقام أعلاه تخص الطعام…">
            <select className={inputCls} value={basis} onChange={(e) => setBasis(e.target.value as 'as_sold' | 'cooked')}>
              <option value="as_sold">كما في العبوة (نيء / جاف / مجمد)</option><option value="cooked">بعد الطبخ</option>
            </select>
          </Field>
          {basis === 'as_sold' && (
            <Field label="معامل الطبخ (اختياري)" hint="كم غرامًا مطبوخًا يخرج من كل 1غ من العبوة؟ مثال: باستا 100غ جافة تصبح 240غ مطبوخة = 2.4. مطلوب فقط إذا وُزن المنتج بعد الطبخ في وصفة.">
              <NumInput value={cookedYield} onChange={setCookedYield} />
            </Field>
          )}
        </Card>

        <Card className="space-y-3">
          <label className="flex items-center gap-3 py-1"><input type="checkbox" className="h-6 w-6" checked={approved} onChange={(e) => setApproved(e.target.checked)} /><span className="font-medium">معتمد (أدخلته من الملصق وراجعته)</span></label>
          <label className="flex items-center gap-3 py-1"><input type="checkbox" className="h-6 w-6" checked={available} onChange={(e) => setAvailableState(e.target.checked)} /><span className="font-medium">موجود بالبيت الآن</span></label>
          <Field label="ملاحظات"><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          {p && <p className="text-xs text-slate-500">آخر تحديث للملصق: {p.label_updated_at}</p>}
        </Card>

        <Btn kind="primary" block disabled={busy} onClick={save}>حفظ</Btn>
        {p && <Btn kind="danger" block onClick={async () => {
          if (usedBy.length && !confirm(`المنتج مستخدم في: ${usedBy.join('، ')}. سيتوقف حسابها حتى تختاروا منتجًا آخر. حذفه؟`)) return;
          if (!usedBy.length && !confirm('حذف المنتج؟')) return;
          await deleteProduct(p.id); await reload(); nav('/products', { replace: true });
        }}>حذف المنتج</Btn>}
      </div>
    </Page>
  );
}
