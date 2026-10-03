import { useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { computeMeal, fmt, problemText } from '../lib/carbs';
import { deleteRecipe, saveRecipe } from '../lib/api';
import { uploadPhoto } from '../lib/supabase';
import { PRODUCT_CATEGORIES, RECIPE_CATEGORIES } from '../lib/constants';
import type { Ingredient, Role, State, Unit } from '../lib/types';
import { isEn, t, tMaybe } from '../i18n';
import { Alert, Btn, CarbBadge, Card, Chip, Field, NumInput, Page, Photo, Sheet, cx, inputCls, recipeArt, toast } from '../components/ui';
import { ProductPicker } from '../components/ProductPicker';

interface Row { key: string; role: Role; pick: string; label: string; quantity: number | null; unit: Unit; state: State; qty_confirmed: boolean; note: string }
let k = 0;
const UNIT_WORD: Record<Unit, () => string> = { g: () => t('غ'), ml: () => t('مل'), serving: () => t('حبة/حصة'), tbsp: () => t('ملعقة كبيرة') };
/** A small toggle for the ingredient card (the page's chips are too big for three rows of them). */
const Mini = ({ on, click, children }: { on: boolean; click: () => void; children: React.ReactNode }) => (
  <button type="button" onClick={click} aria-pressed={on}
    className={cx('min-h-[32px] rounded-full px-3 text-sm font-medium', on ? 'bg-brand text-white' : 'bg-white text-slate-600 ring-1 ring-slate-200')}>{children}</button>
);
const ROLE_WORD: Record<Role, () => string> = { main: () => t('الوجبة'), drink: () => t('مشروب'), snack: () => t('سناك') };
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
      : [],
  );
  const [busy, setBusy] = useState(false);
  const [picking, setPicking] = useState<string | null>(null); // a row's key, or 'new'
  const [noteOpen, setNoteOpen] = useState<string | null>(null);

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
  // a new line starts at one piece when the label says what a piece weighs (carbs show at once), otherwise in the
  // product's own unit with the amount to type; changing the product keeps the amount unless the unit no longer fits
  const choose = (pick: string) => {
    const p = pick.startsWith('prod:') ? products.find((x) => x.id === pick.slice(5)) : null;
    if (picking === 'new') {
      const r = blank();
      setRows((rs) => [...rs, { ...r, pick, ...(p?.serving_size ? { unit: 'serving' as Unit, quantity: 1 } : p ? { unit: p.unit } : {}) }]);
    } else if (picking) {
      const cur = rows.find((r) => r.key === picking);
      const fits = !p || !cur || cur.unit === 'tbsp' || (cur.unit === 'serving' ? !!p.serving_size : cur.unit === p.unit);
      set(picking, { pick, ...(fits ? {} : p?.serving_size ? { unit: 'serving' as Unit, quantity: 1 } : { unit: p!.unit }) });
    }
    setPicking(null);
  };

  const save = async () => {
    if (!name.trim()) return toast(t('اكتب اسم الوصفة'));
    if (!valid.length) return toast(t('أضف مكوّنًا واحدًا على الأقل مع كميته'));
    setBusy(true);
    try {
      const newId = await saveRecipe(
        { id: existing?.id, name: name.trim(), category: category || null, image_path: image, instructions: instructions || null, notes: notes || null,
          approved, carb_pending: pending, pending_note: pending ? pendingNote || null : null, favorite: existing?.favorite ?? false },
        valid.map((r, n) => ({ ...toIng(r), id: undefined, sort: n })), meal.complete ? Math.round(meal.total.carbs * 10) / 10 : null,
      );
      await reload();
      toast(t('تم حفظ الوصفة ✓'));
      nav(`/recipes/${newId}`, { replace: true });
    } catch (e) { toast(t('تعذّر الحفظ: {err}', { err: (e as Error).message })); } finally { setBusy(false); }
  };

  return (
    <Page title={existing ? t('تعديل الوصفة') : t('إضافة وصفة')} back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="space-y-3">
          <Field label={t('اسم الوجبة')}><input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} /></Field>
          <Field label={t('التصنيف')}>
            <input className={inputCls} list="rcats" value={category} onChange={(e) => setCategory(e.target.value)} />
            <datalist id="rcats">{RECIPE_CATEGORIES.map((c) => <option key={c} value={c}>{tMaybe(c)}</option>)}</datalist>
          </Field>
          <div className="flex items-center gap-3">
            <Photo path={image} category={category} art={recipeArt(category)} className="h-20 w-20 rounded-xl" />
            <label className="min-h-[44px] cursor-pointer rounded-xl bg-brand-soft px-4 py-2.5 font-medium text-brand">
              {image ? t('تغيير الصورة') : t('إضافة صورة')}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => {
                const f = e.target.files?.[0]; if (!f) return;
                try { setImage(await uploadPhoto(f, 'recipes')); } catch (er) { toast(t('تعذّر رفع الصورة: {err}', { err: (er as Error).message })); }
              }} />
            </label>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">{t('المكونات')}</h2>
          {rows.map((r) => {
            const line = meal.lines.find((l) => l.ing.id === r.key);
            const p = line?.product ?? (r.pick.startsWith('prod:') ? products.find((x) => x.id === r.pick.slice(5)) ?? null : null);
            const slot = r.pick.startsWith('slot:') ? r.pick.slice(5) : null;
            // only the units that make sense for this product; "piece" only when the label says what one piece weighs
            const units: Unit[] = p ? [p.unit, ...(p.serving_size ? ['serving' as Unit] : []), 'tbsp'] : ['g', 'ml', 'serving', 'tbsp'];
            if (!units.includes(r.unit)) units.push(r.unit);
            const cookable = !!p?.cooked_yield || r.state !== 'as_is';
            return (
              <div key={r.key} className="space-y-2.5 rounded-2xl border border-slate-100 bg-slate-50/60 p-2.5">
                <div className="flex items-center gap-2.5">
                  <button onClick={() => setPicking(r.key)} className="flex min-w-0 flex-1 items-center gap-2.5 text-start" aria-label={t('تغيير المكوّن')}>
                    <Photo path={p?.image_path} category={p?.category ?? slot} className="h-11 w-11 shrink-0 rounded-xl" />
                    <span className="min-w-0 flex-1">
                      <bdi className="block truncate font-medium">{p ? tMaybe(p.name) : slot ? tMaybe(slot) : t('اختر مكوّنًا')}</bdi>
                      <span className="block truncate text-xs text-slate-500">
                        {slot ? t('أي منتج من النوع') + (p ? ` · ${tMaybe(p.name)}` : '') : [p?.brand, p ? tMaybe(p.category) : null].filter(Boolean).join(' · ')}
                      </span>
                    </span>
                  </button>
                  <span className="shrink-0 text-end">
                    {line && !line.problem ? <><b className="num text-lg">{fmt(line.carbs)}</b> <span className="text-xs text-slate-500">{t('غ')}</span></> : <span className="text-slate-300">—</span>}
                  </span>
                  <button aria-label={t('حذف المكوّن')} className="grid h-9 w-9 shrink-0 place-items-center rounded-full text-slate-400 active:bg-slate-100" onClick={() => setRows((rs) => rs.filter((x) => x.key !== r.key))}>✕</button>
                </div>
                {line?.problem && <p className="rounded-lg bg-over-soft px-2 py-1 text-xs font-medium text-over">{problemText(line.problem)}</p>}
                <div className="flex items-center gap-2">
                  <div className="w-20 shrink-0"><NumInput aria-label={t('الكمية')} placeholder={t('الكمية')} value={r.quantity} onChange={(v) => set(r.key, { quantity: v, qty_confirmed: true })} /></div>
                  <div className="flex min-w-0 flex-1 flex-wrap gap-1.5">
                    {units.map((u) => <Mini key={u} on={r.unit === u} click={() => set(r.key, { unit: u })}>{UNIT_WORD[u]()}</Mini>)}
                  </div>
                </div>
                <div className="flex flex-wrap items-center gap-1.5">
                  {(['main', 'drink', 'snack'] as Role[]).map((ro) => <Mini key={ro} on={r.role === ro} click={() => set(r.key, { role: ro })}>{ROLE_WORD[ro]()}</Mini>)}
                  {cookable && <>
                    <span className="mx-0.5 h-5 w-px bg-slate-200" />
                    <Mini on={r.state !== 'cooked'} click={() => set(r.key, { state: 'as_is' })}>{t('قبل الطبخ')}</Mini>
                    <Mini on={r.state === 'cooked'} click={() => set(r.key, { state: 'cooked' })}>{t('بعد الطبخ')}</Mini>
                  </>}
                  {!r.note && noteOpen !== r.key && <button className="ms-auto min-h-[32px] px-1 text-xs text-slate-500 underline" onClick={() => setNoteOpen(r.key)}>{t('+ ملاحظة')}</button>}
                </div>
                {(r.note || noteOpen === r.key) && <input className={inputCls} autoFocus={noteOpen === r.key} placeholder={t('ملاحظة (اختياري)')} value={r.note} onChange={(e) => set(r.key, { note: e.target.value })} />}
              </div>
            );
          })}
          <Btn kind="primary" block onClick={() => setPicking('new')}>{t('+ إضافة مكوّن')}</Btn>
          {rows.some((r) => products.find((x) => `prod:${x.id}` === r.pick)?.cooked_yield) && <p className="text-xs text-slate-500">{t('الأرز والباستا: «بعد الطبخ» مع الوزن بعد الطبخ.')}</p>}
        </Card>

        <Sheet open={!!picking} onClose={() => setPicking(null)} title={picking === 'new' ? t('إضافة مكوّن') : t('تغيير المكوّن')}>
          <div className="space-y-3">
            <details className="rounded-xl bg-brand-soft/50 px-3 py-2">
              <summary className="cursor-pointer text-sm font-medium text-brand">{t('أو: أي منتج من نوع (تلقائي)')}</summary>
              <div className="mt-2 flex flex-wrap gap-1.5">
                {slots.map((c) => <Chip key={c} onClick={() => choose(`slot:${c}`)}>{tMaybe(c)}</Chip>)}
              </div>
            </details>
            <ProductPicker onPick={(p) => choose(`prod:${p.id}`)} />
          </div>
        </Sheet>

        <Card className="space-y-3">
          <Field label={t('طريقة التحضير')}><textarea className={inputCls} rows={5} value={instructions} onChange={(e) => setInstructions(e.target.value)} /></Field>
          <Field label={t('ملاحظات')}><textarea className={inputCls} rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} /></Field>
          <label className="flex items-center gap-3 py-1"><input type="checkbox" className="h-6 w-6" checked={approved} onChange={(e) => setApproved(e.target.checked)} /><span className="font-medium">{t('وصفة معتمدة (تظهر في الاقتراحات)')}</span></label>
          <label className="flex items-center gap-3 py-1"><input type="checkbox" className="h-6 w-6" checked={pending} onChange={(e) => setPending(e.target.checked)} /><span className="font-medium">{t('الكارب غير مكتمل (لا تُقترح)')}</span></label>
          {pending && <Field label={t('ما الناقص؟')}><input className={inputCls} value={pendingNote} onChange={(e) => setPendingNote(e.target.value)} /></Field>}
        </Card>

        {existing && <Btn kind="danger" block onClick={async () => { if (confirm(t('حذف الوصفة نهائيًا؟ سجل الوجبات السابقة يبقى كما هو.'))) { await deleteRecipe(existing.id); await reload(); nav('/recipes', { replace: true }); } }}>{t('حذف الوصفة')}</Btn>}
      </div>

      <div className="fixed inset-x-0 bottom-[68px] z-30 border-t border-slate-200 bg-white/95 p-3 backdrop-blur">
        <div className="mx-auto max-w-2xl space-y-2">
          {meal.complete && meal.level === 'over' && <Alert tone="over">{t('تحذير: تتجاوز {max}غ كارب. يمكنك الحفظ لكنها لن تُقترح.', { max: settings.max_meal_carbs })}</Alert>}
          {meal.complete && prev !== null && Math.abs(prev - meal.total.carbs) >= 0.05 && (
            <div className="text-center text-sm">{t('السابق:')} <b className="num">{fmt(prev)}</b> {t('غ')} {isEn() ? '→' : '←'} {t('الجديد:')} <b className="num">{fmt(meal.total.carbs)}</b> {t('غ')}</div>
          )}
          <div className="flex items-center gap-3">
            <CarbBadge carbs={meal.total.carbs} level={meal.level} unknown={!meal.complete} />
            <Btn kind="primary" className="flex-1" disabled={busy} onClick={save}>{t('حفظ')}</Btn>
          </div>
        </div>
      </div>
    </Page>
  );
}
