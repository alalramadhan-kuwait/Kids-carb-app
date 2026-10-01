import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, uploadPhoto } from '../lib/supabase';
import { useData } from '../lib/data';
import { computeSnack, fmt, PROBLEM_TEXT } from '../lib/carbs';
import { deleteSnack, saveSettings, saveSnack } from '../lib/api';
import { PRODUCT_CATEGORIES } from '../lib/constants';
import { VersionTag } from '../components/Version';
import { formatGlucose, toMgdl, unitLabel } from '../lib/glucose';
import type { CategoryTarget, Settings, Snack, Unit } from '../lib/types';
import { Alert, Badge, Btn, Card, CarbBadge, Field, NumInput, Page, Photo, inputCls, toast } from '../components/ui';

export function More() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [me, setMe] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.email ?? '')); }, []);
  const shared = me.endsWith('.local');
  const changePw = async () => {
    if (pw.length < 8) return toast('كلمة المرور 8 خانات على الأقل');
    if (pw !== pw2) return toast('الكلمتان غير متطابقتين');
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) toast(error.message.includes('different') ? 'اختر كلمة مختلفة عن الحالية' : error.message); else { toast('تم تغيير كلمة المرور ✓'); setPw(''); setPw2(''); }
  };
  const link = (to: string, icon: string, label: string, hint: string) => (
    <Link to={to}><Card className="flex items-center gap-3 !p-4"><span className="text-2xl">{icon}</span><div className="flex-1"><div className="font-bold">{label}</div><div className="text-sm text-slate-500">{hint}</div></div><span className="text-slate-300">‹</span></Card></Link>
  );
  return (
    <Page title="المزيد">
      <div className="-mt-3 mb-3"><VersionTag /></div>
      <Card className="mb-3 flex items-center gap-3 !p-3">
        <span className="text-2xl">👤</span>
        <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-sm">{me || '…'}</span>
        <Btn kind="ghost" onClick={async () => { await supabase.auth.signOut(); nav('/'); }}>تسجيل الخروج</Btn>
      </Card>
      <div className="space-y-3">
        {link('/plan', '🗓️', 'خطة الأيام وقائمة الشراء', 'وجبات لعدة أيام وعدد الأشخاص')}
        {link('/cgm', '🩸', 'قراءات السكر', 'ربط LibreLinkUp لعرض السكر الحي')}
        {link('/snacks', '🍎', 'السناكات', 'قاعدة بيانات السناكات')}
        {link('/settings', '⚙️', 'الإعدادات', 'الحد الأقصى للكارب وأهداف المنتجات')}
        <Card className="space-y-2">
          <h2 className="font-bold">تغيير كلمة المرور</h2>
          {shared && <Alert tone="near">هذا الحساب مشترك مع تطبيق المناوبات: تغيير كلمة المرور هنا يغيّرها هناك أيضًا، ولن تعمل "نسيت كلمة المرور" لأن البريد غير حقيقي. الأفضل حساب مستقل ببريد حقيقي.</Alert>}
          <input className={inputCls} dir="ltr" type="password" autoComplete="new-password" placeholder="كلمة مرور جديدة" value={pw} onChange={(e) => setPw(e.target.value)} />
          <input className={inputCls} dir="ltr" type="password" autoComplete="new-password" placeholder="أعد كتابتها" value={pw2} onChange={(e) => setPw2(e.target.value)} />
          <Btn block disabled={!pw} onClick={changePw}>تغيير كلمة المرور</Btn>
        </Card>
        <Card className="space-y-2">
          <h2 className="font-bold">إضافة أحد الوالدين</h2>
          <p className="text-sm text-slate-600">يُنشئ الأب حسابه أولًا (بالبريد وكلمة المرور)، ثم اكتب بريده هنا.</p>
          <input className={inputCls} dir="ltr" type="email" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
          <Btn block disabled={!email} onClick={async () => {
            const { error } = await supabase.rpc('add_member_by_email', { p_email: email });
            if (error) toast(error.message.includes('no account') ? 'لا يوجد حساب بهذا البريد بعد' : error.message); else { toast('تمت الإضافة ✓'); setEmail(''); }
          }}>إضافة</Btn>
        </Card>
        <p className="pt-2 text-center text-xs text-slate-400">هذا التطبيق لا يحسب ولا يقترح جرعات الإنسولين. الجرعة قرار الأهل مع الطبيب.</p>
      </div>
    </Page>
  );
}

// ── snacks ──────────────────────────────────────────────────────────────────
export function SnacksPage() {
  const nav = useNavigate();
  const { snacks, products, settings, reload } = useData();
  const [edit, setEdit] = useState<Partial<Snack> | null>(null);
  const slots = [...new Set([...PRODUCT_CATEGORIES, ...products.map((p) => p.category)])];

  const pickValue = edit ? (edit.product_id ? `prod:${edit.product_id}` : edit.slot_category ? `slot:${edit.slot_category}` : '') : '';
  const save = async () => {
    if (!edit?.name?.trim() || !edit.quantity || (!edit.product_id && !edit.slot_category)) return toast('اكتب الاسم والمنتج والكمية');
    try {
      await saveSnack({ ...edit, name: edit.name.trim(), quantity: edit.quantity, unit: edit.unit ?? 'g', state: 'as_is', qty_confirmed: true });
      await reload(); setEdit(null); toast('تم حفظ السناك ✓');
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <Page title="السناكات" back={() => nav(-1)} action={<Btn kind="primary" onClick={() => setEdit({ unit: 'g' })}>+ سناك</Btn>}>
      {edit && (
        <Card className="mb-4 space-y-3">
          <Field label="الاسم"><input className={inputCls} value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label="المنتج">
            <select className={inputCls} value={pickValue} onChange={(e) => {
              const v = e.target.value;
              setEdit({ ...edit, product_id: v.startsWith('prod:') ? v.slice(5) : null, slot_category: v.startsWith('slot:') ? v.slice(5) : null });
            }}>
              <option value="">اختر…</option>
              <optgroup label="أي منتج مسجّل من الفئة">{slots.map((s) => <option key={s} value={`slot:${s}`}>{s}</option>)}</optgroup>
              <optgroup label="منتج محدد">{products.map((p) => <option key={p.id} value={`prod:${p.id}`}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}</optgroup>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="الكمية"><NumInput value={edit.quantity} onChange={(v) => setEdit({ ...edit, quantity: v ?? undefined })} /></Field>
            <Field label="الوحدة">
              <select className={inputCls} value={edit.unit ?? 'g'} onChange={(e) => setEdit({ ...edit, unit: e.target.value as Unit })}>
                <option value="g">غرام</option><option value="ml">مل</option><option value="serving">حبة/حصة</option><option value="tbsp">ملعقة كبيرة</option>
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Photo path={edit.image_path} category={edit.name} className="h-16 w-16 rounded-xl" />
            <label className="cursor-pointer rounded-xl bg-brand-soft px-4 py-2.5 font-medium text-brand">صورة
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) try { setEdit({ ...edit, image_path: await uploadPhoto(f, 'snacks') }); } catch (er) { toast((er as Error).message); } }} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2"><Btn kind="primary" onClick={save}>حفظ</Btn><Btn kind="ghost" onClick={() => setEdit(null)}>إلغاء</Btn></div>
        </Card>
      )}
      <div className="space-y-3">
        {snacks.map((s) => {
          const m = computeSnack(s, products, settings);
          return (
            <Card key={s.id} className="flex items-center gap-3 !p-3">
              <Photo path={s.image_path} category={s.name} className="h-16 w-16 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">{s.name}</div>
                <div className="truncate text-xs text-slate-500">{m.lines[0].product?.name ?? s.slot_category} • <span className="num">{fmt(s.quantity)}</span> {s.unit === 'g' ? 'غ' : s.unit === 'ml' ? 'مل' : s.unit === 'tbsp' ? 'ملعقة' : 'حبة'}</div>
                {m.lines[0].problem && <div className="text-xs text-over">{PROBLEM_TEXT[m.lines[0].problem]}</div>}
                {m.lines[0].product && !m.lines[0].product.approved && <Badge tone="near">منتج غير معتمد</Badge>}
              </div>
              {m.complete && <CarbBadge carbs={m.total.carbs} level="normal" />}
              <div className="flex flex-col gap-1">
                <button className="text-sm text-brand" onClick={() => setEdit(s)}>تعديل</button>
                <button className="text-sm text-over" onClick={async () => { if (confirm('حذف السناك؟')) { await deleteSnack(s.id); await reload(); } }}>حذف</button>
              </div>
            </Card>
          );
        })}
      </div>
    </Page>
  );
}

// ── settings ────────────────────────────────────────────────────────────────
export function SettingsPage() {
  const nav = useNavigate();
  const { settings, reload } = useData();
  const [s, setS] = useState<Settings>(settings);
  const setT = (i: number, patch: Partial<CategoryTarget>) => setS({ ...s, category_targets: s.category_targets.map((t, n) => (n === i ? { ...t, ...patch } : t)) });
  const bad = s.preferred_min > s.preferred_max || s.preferred_max > s.max_meal_carbs;

  return (
    <Page title="الإعدادات" back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-bold">هامش الأمان</h2>
          <Field label="الحد الأقصى لكارب الوجبة (غ)" hint="فوقه يظهر تحذير واضح ولا تُقترح الوصفة. لا نمنع التسجيل بالقوة.">
            <NumInput value={s.max_meal_carbs} onChange={(v) => setS({ ...s, max_meal_carbs: v ?? 0 })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="المدى المفضّل: من"><NumInput value={s.preferred_min} onChange={(v) => setS({ ...s, preferred_min: v ?? 0 })} /></Field>
            <Field label="إلى"><NumInput value={s.preferred_max} onChange={(v) => setS({ ...s, preferred_max: v ?? 0 })} /></Field>
          </div>
          <p className="text-sm text-slate-600">≤ <b className="num">{s.preferred_max}</b> عادي • حتى <b className="num">{s.max_meal_carbs}</b> قريب من الحد • أعلى من ذلك تحذير.</p>
          {bad && <Alert tone="near">المدى المفضّل يجب أن يكون ضمن الحد الأقصى.</Alert>}
          <Field label="الملعقة الكبيرة (غ أو مل)" hint="تُستخدم للكاتشب والمايونيز وغيرها."><NumInput value={s.tbsp_size} onChange={(v) => setS({ ...s, tbsp_size: v ?? 15 })} /></Field>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">أهداف اختيار المنتجات</h2>
          <p className="text-sm text-slate-600">تنبيه فقط عند تسجيل منتج يتجاوز الهدف.</p>
          {s.category_targets.map((t, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_5rem_2.5rem] items-end gap-2">
              <input aria-label="الفئة" list="tcats" className={inputCls} value={t.category} onChange={(e) => setT(i, { category: e.target.value })} />
              <select aria-label="الأساس" className={inputCls} value={t.basis} onChange={(e) => setT(i, { basis: e.target.value as CategoryTarget['basis'] })}>
                <option value="per100">≤ لكل 100</option><option value="serving">≤ للحبة/الحصة</option>
              </select>
              <NumInput aria-label="الحد" value={t.max} onChange={(v) => setT(i, { max: v ?? 0 })} />
              <button aria-label="حذف" className="h-11 rounded-xl bg-over-soft text-over" onClick={() => setS({ ...s, category_targets: s.category_targets.filter((_, n) => n !== i) })}>✕</button>
            </div>
          ))}
          <datalist id="tcats">{PRODUCT_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          <Btn kind="ghost" block onClick={() => setS({ ...s, category_targets: [...s.category_targets, { category: '', basis: 'per100', max: 15 }] })}>+ هدف</Btn>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">عرض السكر</h2>
          <Field label="الوحدة">
            <select className={inputCls} value={s.glucose_unit} onChange={(e) => setS({ ...s, glucose_unit: e.target.value as Settings['glucose_unit'] })}>
              <option value="mmol">mmol/L</option><option value="mgdl">mg/dL</option>
            </select>
          </Field>
          <p className="text-sm text-slate-600">نطاق تلوين الرقم ({unitLabel(s.glucose_unit)}). يكتبه الوالدان من توصية الطبيب، والتطبيق لا يفترض نطاقًا. اتركه فارغًا لعدم التلوين.</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label="أقل من (أحمر)"><NumInput value={s.glucose_low_mgdl === null ? null : Number(formatGlucose(s.glucose_low_mgdl, s.glucose_unit))} onChange={(v) => setS({ ...s, glucose_low_mgdl: v === null ? null : toMgdl(v, s.glucose_unit) })} /></Field>
            <Field label="أعلى من (أصفر)"><NumInput value={s.glucose_high_mgdl === null ? null : Number(formatGlucose(s.glucose_high_mgdl, s.glucose_unit))} onChange={(v) => setS({ ...s, glucose_high_mgdl: v === null ? null : toMgdl(v, s.glucose_unit) })} /></Field>
          </div>
        </Card>

        <Btn kind="primary" block disabled={bad} onClick={async () => {
          try { await saveSettings({ ...s, category_targets: s.category_targets.filter((t) => t.category.trim()) }); await reload(); toast('تم حفظ الإعدادات ✓'); }
          catch (e) { toast((e as Error).message); }
        }}>حفظ</Btn>
      </div>
    </Page>
  );
}
