import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { computeMeal, fmt, PROBLEM_TEXT } from '../lib/carbs';
import { deleteRecipe, saveRecipe } from '../lib/api';
import { uploadPhoto } from '../lib/supabase';
import { PRODUCT_CATEGORIES, RECIPE_CATEGORIES } from '../lib/constants';
import type { Ingredient, Role, State, Unit } from '../lib/types';
import { Alert, Btn, CarbBadge, Card, Field, NumInput, Page, Photo, inputCls, toast } from '../components/ui';

interface Row { key: string; role: Role; pick: string; label: string; quantity: number | null; unit: Unit; state: State; qty_confirmed: boolean; note: string }
let k = 0;
const blank = (): Row => ({ key: `n${++k}`, role: 'main', pick: '', label: '', quantity: null, unit: 'g', state: 'as_is', qty_confirmed: true, note: '' });

export default function RecipeEdit() {
  const { id } = useParams();
  const nav = useNavigate();
  const { recipes, ingsByRecipe, products, settings, reload } = useData();
  const existing = recipes.find((r) => r.id === id);

  const [name, setName] = useState(existing?.name ?? '');
  const [category, setCategory] = useState(existing?.category ?? '');
  const [image, setImage] = useState(existing?.image_path ?? null);
  const [instructions, setInstructions] = useState(existing?.instructions ?? '');
  const [notes, setNotes] = useState(existing?.notes ?? '');
  const [approved, setApproved] = useState(existing?.approved ?? false);
  const [pending, setPending] = useState(existing?.carb_pending ?? false);
  const [pendingNote, setPendingNote] = useState(existing?.pending_note ?? '');
  const [rows, setRows] = useState<Row[]>(() =>
    existing
      ? (ingsByRecipe.get(existing.id) ?? []).map((i) => ({
          key: i.id, role: i.role, pick: i.product_id ? `prod:${i.product_id}` : `slot:${i.slot_category}`,
          label: i.label ?? '', quantity: i.quantity, unit: i.unit, state: i.state, qty_confirmed: i.qty_confirmed, note: i.note ?? '',
        }))
      : [blank()],
  );
  const [busy, setBusy] = useState(false);

  const slots = useMemo(() => [...new Set([...PRODUCT_CATEGORIES, ...products.map((p) => p.category)])], [products]);

  const toIng = (r: Row): Ingredient => ({
    id: r.key, role: r.role, product_id: r.pick.startsWith('prod:') ? r.pick.slice(5) : null,
    slot_category: r.pick.startsWith('slot:') ? r.pick.slice(5) : null,
    label: r.label || null, quantity: r.quantity ?? 0, unit: r.unit, state: r.state, qty_confirmed: r.qty_confirmed, note: r.note || null, sort: 0,
  });
  const valid = rows.filter((r) => r.pick && r.quantity);
  const meal = useMemo(() => computeMeal(valid.map(toIng), products, settings), [rows, products, settings]); // eslint-disable-line react-hooks/exhaustive-deps
  const prev = existing?.saved_total_carbs ?? null;

  const set = (key: string, patch: Partial<Row>) => setRows((rs) => rs.map((r) => (r.key === key ? { ...r, ...patch } : r)));
  const pickProduct = (key: string, pick: string) => {
    const p = pick.startsWith('prod:') ? products.find((x) => x.id === pick.slice(5)) : null;
    set(key, { pick, ...(p && (['g', 'ml'] as string[]).includes(rows.find((r) => r.key === key)!.unit) ? { unit: p.unit } : {}) });
  };

  const save = async () => {
    if (!name.trim()) return toast('اكتب اسم الوصفة');
    if (!valid.length) return toast('أضف مكوّنًا واحدًا على الأقل مع كميته');
    setBusy(true);
    try {
      const newId = await saveRecipe(
        { id: existing?.id, name: name.trim(), category: category || null, image_path: image, instructions: instructions || null, notes: notes || null,
          approved, carb_pending: pending, pending_note: pending ? pendingNote || null : null, favorite: existing?.favorite ?? false },
        valid.map((r, n) => ({ ...toIng(r), id: undefined, sort: n })), meal.complete ? Math.round(meal.total.carbs * 10) / 10 : null,
      );
      await reload();
      toast('تم حفظ الوصفة ✓');
      nav(`/recipes/${newId}`, { replace: true });
    } catch (e) { toast('تعذّر الحفظ: ' + (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Page title={existing ? 'تعديل الوصفة' : 'إضافة وصفة'} back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="space-y-3">
          <Field label="اسم الوجبة"><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="التصنيف">
            <input className={inputCls} list="rcats" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="rcats">{RECIPE_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          </Field>
          <div className="flex items-center gap-3">
            <Photo path={image} category={category} className="h-20 w-20 rounded-xl" />
            <label className="min-h-[44px] cursor-pointer rounded-xl bg-brand-soft px-4 py-2.5 font-medium text-brand">
              {image ? 'تغيير الصورة' : 'إضافة صورة'}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try { setImage(await uploadPhoto(f, 'recipes')); } catch (er) { toast('تعذّر رفع الصورة: ' + (er as Error).message); }
              }} />
            </label>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">المكونات</h2>
          {rows.map((r, idx) => {
            const line = meal.lines.find((l) => l.ing.id === r.key);
            return (
              <div key={r.key} className="space-y-2 rounded-xl bg-slate-50 p-3">
                <div className="flex gap-2">
                  <select aria-label="المكوّن" className={inputCls} value={r.pick} onChange={(e) => pickProduct(r.key, e.target.value)}>
                    <option value="">اختر مكوّنًا…</option>
                    <optgroup label="أي منتج مسجّل من الفئة (يفضّل الموجود بالبيت)">
                      {slots.map((s) => <option key={s} value={`slot:${s}`}>{s}</option>)}
                    </optgroup>
                    <optgroup label="منتج محدد">
                      {products.map((p) => <option key={p.id} value={`prod:${p.id}`}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}
                    </optgroup>
                  </select>
                  <button aria-label="حذف المكوّن" className="w-11 shrink-0 rounded-xl bg-over-soft text-over" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>✕</button>
                </div>
                <div className="grid grid-cols-[1fr_1fr_1fr] gap-2">
                  <NumInput aria-label="الكمية" placeholder="الكمية" value={r.quantity} onChange={(v) => set(r.key, { quantity: v, qty_confirmed: true })} />
                  <select aria-label="الوحدة" className={inputCls} value={r.unit} onChange={(e) => set(r.key, { unit: e.target.value as Unit })}>
                    <option value="g">غرام</option><option value="ml">مل</option><option value="serving">حبة/حصة</option><option value="tbsp">ملعقة كبيرة</option>
                  </select>
                  <select aria-label="الوزن قبل أو بعد الطبخ" className={inputCls} value={r.state} onChange={(e) => set(r.key, { state: e.target.value as State })}>
                    <option value="as_is">كما في العبوة</option><option value="raw">قبل الطبخ</option><option value="cooked">بعد الطبخ</option>
                  </select>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select aria-label="النوع" className={inputCls} value={r.role} onChange={(e) => set(r.key, { role: e.target.value as Role })}>
                    <option value="main">الوجبة</option><option value="drink">مشروب</option><option value="snack">سناك</option>
                  </select>
                  <input className={inputCls} placeholder="ملاحظة (اختياري)" value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} />
                </div>
                {line && (
                  <div className="flex items-center justify-between text-sm">
                    <span className="text-slate-500">{line.product?.name ?? ''}</span>
                    {line.problem ? <span className="text-over">{PROBLEM_TEXT[line.problem]}</span> : <span className="num font-bold">{fmt(line.carbs)}غ كارب</span>}
                  </div>
                )}
                {idx === rows.length - 1 && null}
              </div>
            );
          })}
          <Btn kind="ghost" block onClick={() => setRows((rs) => [...rs, blank()])}>+ إضافة مكوّن</Btn>
          <p className="text-xs text-slate-500">الأرز والباستا: اختر "بعد الطبخ" واكتب الوزن بعد الطبخ. لا يوجد كارب مخمَّن: المنتج غير المسجّل لا يُحسب.</p>
        </Card>

        <Card className="space-y-3">
          <Field label="طريقة التحضير"><textarea className={inputCls} rows={5} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field>
          <Field label="ملاحظات"><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <label className="flex items-center gap-3 py-1"><input type="checkbox" className="h-6 w-6" checked={approved} onChange={(e) => setApproved(e.target.checked)} /><span className="font-medium">وصفة معتمدة (تظهر في الاقتراحات)</span></label>
          <label className="flex items-center gap-3 py-1"><input type="checkbox" className="h-6 w-6" checked={pending} onChange={(e) => setPending(e.target.checked)} /><span className="font-medium">الكارب غير مكتمل (لا تُقترح)</span></label>
          {pending && <Field label="ما الناقص؟"><input className={inputCls} value={pendingNote} onChange={(e) => setPendingNote(e.target.value)} /></Field>}
        </Card>

        {existing && <Btn kind="danger" block onClick={async () => { if (confirm('حذف الوصفة نهائيًا؟ سجل الوجبات السابقة يبقى كما هو.')) { await deleteRecipe(existing.id); await reload(); nav('/recipes', { replace: true }); } }}>حذف الوصفة</Btn>}
      </div>

      <div className="fixed inset-x-0 bottom-[68px] z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-2xl space-y-2">
          {meal.complete && meal.level === 'over' && <Alert tone="over">تحذير: تتجاوز {settings.max_meal_carbs}غ كارب. يمكنك الحفظ لكنها لن تُقترح.</Alert>}
          {meal.complete && prev !== null && Math.abs(prev - meal.total.carbs) >= 0.05 && (
            <div className="text-center text-sm">Previous: <b className="num">{fmt(prev)}g</b> carbs → New: <b className="num">{fmt(meal.total.carbs)}g</b> carbs</div>
          )}
          <div className="flex items-center gap-3">
            <CarbBadge carbs={meal.total.carbs} level={meal.level} unknown={!meal.complete} />
            <Btn kind="primary" className="flex-1" disabled={busy} onClick={save}>حفظ</Btn>
          </div>
        </div>
      </div>
    </Page>
  );
}
