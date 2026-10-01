import { useEffect, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { supabase, uploadPhoto } from '../lib/supabase';
import { useData } from '../lib/data';
import { computeSnack, fmt, problemText } from '../lib/carbs';
import { deleteSnack, saveSettings, saveSnack } from '../lib/api';
import { PRODUCT_CATEGORIES } from '../lib/constants';
import { VersionTag } from '../components/Version';
import { Icon } from '../components/Icon';
import type { IconName } from '../icons/defs';
import { formatGlucose, toMgdl, unitLabel } from '../lib/glucose';
import type { CategoryTarget, Settings, Snack, Unit } from '../lib/types';
import { Alert, Badge, Btn, Card, CarbBadge, Field, NumInput, Page, Photo, asset, cx, inputCls, snackArt, toast } from '../components/ui';
import { setThemePref, themePref, type ThemePref } from '../lib/theme';
import { isEn, t, tMaybe } from '../i18n';
import { LangSwitch } from '../components/LangSwitch';

/** Puts values into a translated sentence as bold numbers: rich(t('… {a} …'), { a: 5 }). */
const rich = (s: string, v: Record<string, ReactNode>) => s.split(/\{(\w+)\}/).map((x, i) => (i % 2 ? <b key={i} className="num">{v[x]}</b> : x));

/** المظهر: per phone. Automatic follows the phone's dark mode and the night window. */
function Appearance() {
  const [p, setP] = useState<ThemePref>(themePref);
  const pick = (v: ThemePref) => { setP(v); setThemePref(v); };
  const opts: [ThemePref, string][] = [['auto', t('تلقائي')], ['day', t('نهاري')], ['night', t('ليلي')]];
  return (
    <div className="space-y-1.5">
      <div className="text-sm font-medium text-slate-600">{t('المظهر')}</div>
      <div className="grid grid-cols-3 gap-1 rounded-full bg-slate-50 p-1" role="radiogroup" aria-label={t('المظهر')}>
        {opts.map(([v, l]) => (
          <button key={v} role="radio" aria-checked={p === v} onClick={() => pick(v)}
            className={cx('min-h-[44px] rounded-full text-sm font-bold', p === v ? 'bg-brand text-white' : 'text-slate-600')}>{l}</button>
        ))}
      </div>
      {p === 'auto' && <p className="text-xs text-slate-500">{t('يتبع الوضع الداكن في الجوال، وألوان الليل في وقت النوم إن كانت مفعّلة في التنبيهات.')}</p>}
    </div>
  );
}

export function More() {
  const nav = useNavigate();
  const [email, setEmail] = useState('');
  const [me, setMe] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  useEffect(() => { supabase.auth.getUser().then(({ data }) => setMe(data.user?.email ?? '')); }, []);
  const shared = me.endsWith('.local');
  const changePw = async () => {
    if (pw.length < 8) return toast(t('كلمة المرور 8 خانات على الأقل'));
    if (pw !== pw2) return toast(t('الكلمتان غير متطابقتين'));
    const { error } = await supabase.auth.updateUser({ password: pw });
    if (error) toast(error.message.includes('different') ? t('اختر كلمة مختلفة عن الحالية') : error.message); else { toast(t('تم تغيير كلمة المرور ✓')); setPw(''); setPw2(''); }
  };
  const link = (to: string, icon: IconName, label: string, hint: string) => (
    <li><Link to={to} className="flex min-h-[64px] items-center gap-3 px-4 py-3 active:bg-slate-50">
      <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name={icon} size={22} /></span>
      <span className="min-w-0 flex-1"><span className="block font-semibold">{label}</span><span className="block truncate text-sm text-slate-500">{hint}</span></span>
      <span className="text-slate-300">{isEn() ? '›' : '‹'}</span>
    </Link></li>
  );
  const group = (title: string, children: ReactNode) => (
    <section>
      <h2 className="mb-1.5 px-1 text-sm font-bold text-slate-500">{title}</h2>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">{children}</ul>
    </section>
  );
  // four groups (Miller): her care, meals, the app, the account; forms open only when asked for
  return (
    <Page title={t('المزيد')}>
      <div className="space-y-5">
        {group(t('رعاية ليان'), <>
          {link('/alerts', 'bell', t('التنبيهات'), t('المنخفض والمرتفع وانقطاع القراءة'))}
          {link('/care-plan', 'heart', t('خطة الطبيب'), t('تظهر مع كل تنبيه'))}
          {link('/cgm', 'sensor', t('قراءات السكر'), t('ربط LibreLinkUp لعرض السكر الحي'))}
          {link('/share', 'family', t('المشاركة والتقارير'), t('رابط للمدرسة أو العائلة، ملف CSV، تقرير للعيادة'))}
        </>)}
        {group(t('الوجبات'), <>
          {link('/plan', 'meals', t('خطة الأيام وقائمة الشراء'), t('وجبات لعدة أيام وعدد الأشخاص'))}
          {link('/snacks', 'carbs', t('السناكات'), t('قاعدة بيانات السناكات'))}
        </>)}
        {group(t('التطبيق'), <>
          {link('/settings', 'settings', t('الإعدادات'), t('الحد الأقصى للكارب ونطاق السكر'))}
          <li className="space-y-4 px-4 py-4">
            <div className="space-y-1.5"><div className="text-sm font-medium text-slate-600">{t('اللغة')}{!isEn() && <span className="text-slate-400"> · Language</span>}</div><LangSwitch /></div>
            <Appearance />
          </li>
        </>)}
        {group(t('الحساب'), <>
          <li className="flex min-h-[56px] items-center gap-3 px-4 py-2">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="family" size={22} /></span>
            <span dir="ltr" className="min-w-0 flex-1 truncate text-start text-sm">{me || '…'}</span>
          </li>
          <li><details className="group px-4">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between font-medium">{t('إضافة أحد الوالدين')}<span className="text-slate-300">{isEn() ? '›' : '‹'}</span></summary>
            <div className="space-y-2 pb-4">
              <p className="text-sm text-slate-600">{t('يُنشئ الأب حسابه أولًا (بالبريد وكلمة المرور)، ثم اكتب بريده هنا.')}</p>
              <input className={inputCls} dir="ltr" type="email" placeholder="email@example.com" value={email} onChange={(e) => setEmail(e.target.value)} />
              <Btn block disabled={!email} onClick={async () => {
                const { error } = await supabase.rpc('add_member_by_email', { p_email: email });
                if (error) toast(error.message.includes('no account') ? t('لا يوجد حساب بهذا البريد بعد') : error.message); else { toast(t('تمت الإضافة ✓')); setEmail(''); }
              }}>{t('إضافة')}</Btn>
            </div>
          </details></li>
          <li><details className="px-4">
            <summary className="flex min-h-[52px] cursor-pointer list-none items-center justify-between font-medium">{t('تغيير كلمة المرور')}<span className="text-slate-300">{isEn() ? '›' : '‹'}</span></summary>
            <div className="space-y-2 pb-4">
              {shared && <Alert tone="near">{t('هذا الحساب مشترك مع تطبيق المناوبات: تغيير كلمة المرور هنا يغيّرها هناك أيضًا، ولن تعمل "نسيت كلمة المرور" لأن البريد غير حقيقي. الأفضل حساب مستقل ببريد حقيقي.')}</Alert>}
              <input className={inputCls} dir="ltr" type="password" autoComplete="new-password" placeholder={t('كلمة مرور جديدة')} value={pw} onChange={(e) => setPw(e.target.value)} />
              <input className={inputCls} dir="ltr" type="password" autoComplete="new-password" placeholder={t('أعد كتابتها')} value={pw2} onChange={(e) => setPw2(e.target.value)} />
              <Btn block disabled={!pw} onClick={changePw}>{t('تغيير كلمة المرور')}</Btn>
            </div>
          </details></li>
          <li><button className="flex min-h-[52px] w-full items-center px-4 text-start font-medium text-slate-600" onClick={async () => { await supabase.auth.signOut(); nav('/'); }}>{t('تسجيل الخروج')}</button></li>
        </>)}
        <footer className="space-y-1 pt-1 text-center text-xs text-slate-400">
          <p>{t('هذا التطبيق لا يحسب ولا يقترح جرعات الإنسولين. الجرعة قرار الأهل مع الطبيب.')}</p>
          <VersionTag />
        </footer>
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
    if (!edit?.name?.trim() || !edit.quantity || (!edit.product_id && !edit.slot_category)) return toast(t('اكتب الاسم والمنتج والكمية'));
    try {
      await saveSnack({ ...edit, name: edit.name.trim(), quantity: edit.quantity, unit: edit.unit ?? 'g', state: 'as_is', qty_confirmed: true });
      await reload(); setEdit(null); toast(t('تم حفظ السناك ✓'));
    } catch (e) { toast((e as Error).message); }
  };

  return (
    <Page title={t('السناكات')} back={() => nav(-1)} action={<Btn kind="primary" onClick={() => setEdit({ unit: 'g' })}>{t('+ سناك')}</Btn>}>
      {edit && (
        <Card className="mb-4 space-y-3">
          <Field label={t('الاسم')}><input className={inputCls} value={edit.name ?? ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} /></Field>
          <Field label={t('المنتج')}>
            <select className={inputCls} value={pickValue} onChange={(e) => {
              const v = e.target.value;
              setEdit({ ...edit, product_id: v.startsWith('prod:') ? v.slice(5) : null, slot_category: v.startsWith('slot:') ? v.slice(5) : null });
            }}>
              <option value="">{t('اختر…')}</option>
              <optgroup label={t('أي منتج مسجّل من الفئة')}>{slots.map((s) => <option key={s} value={`slot:${s}`}>{tMaybe(s)}</option>)}</optgroup>
              <optgroup label={t('منتج محدد')}>{products.map((p) => <option key={p.id} value={`prod:${p.id}`}>{p.name}{p.brand ? ` — ${p.brand}` : ''}</option>)}</optgroup>
            </select>
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('الكمية')}><NumInput value={edit.quantity} onChange={(v) => setEdit({ ...edit, quantity: v ?? undefined })} /></Field>
            <Field label={t('الوحدة')}>
              <select className={inputCls} value={edit.unit ?? 'g'} onChange={(e) => setEdit({ ...edit, unit: e.target.value as Unit })}>
                <option value="g">{t('غرام')}</option><option value="ml">{t('مل')}</option><option value="serving">{t('حبة/حصة')}</option><option value="tbsp">{t('ملعقة كبيرة')}</option>
              </select>
            </Field>
          </div>
          <div className="flex items-center gap-3">
            <Photo path={edit.image_path} category={edit.name} art={snackArt(edit.name)} className="h-16 w-16 rounded-xl" />
            <label className="cursor-pointer rounded-xl bg-brand-soft px-4 py-2.5 font-medium text-brand">{t('صورة')}
              <input type="file" accept="image/*" className="hidden" onChange={async (e) => { const f = e.target.files?.[0]; if (f) try { setEdit({ ...edit, image_path: await uploadPhoto(f, 'snacks') }); } catch (er) { toast((er as Error).message); } }} />
            </label>
          </div>
          <div className="grid grid-cols-2 gap-2"><Btn kind="primary" onClick={save}>{t('حفظ')}</Btn><Btn kind="ghost" onClick={() => setEdit(null)}>{t('إلغاء')}</Btn></div>
        </Card>
      )}
      <div className="space-y-3">
        {snacks.map((s) => {
          const m = computeSnack(s, products, settings);
          return (
            <Card key={s.id} className="flex items-center gap-3 !p-3">
              <Photo path={s.image_path} category={s.name} art={snackArt(s.name)} className="h-16 w-16 shrink-0 rounded-xl" />
              <div className="min-w-0 flex-1">
                <div className="font-bold">{s.name}</div>
                <div className="truncate text-xs text-slate-500">{m.lines[0].product?.name ?? tMaybe(s.slot_category)} • <span className="num">{fmt(s.quantity)}</span> {s.unit === 'g' ? t('غ') : s.unit === 'ml' ? t('مل') : s.unit === 'tbsp' ? t('ملعقة') : t('حبة')}</div>
                {m.lines[0].problem && <div className="text-xs font-medium text-brand">{problemText(m.lines[0].problem)}</div>}
                {m.lines[0].product && !m.lines[0].product.approved && <Badge tone="near">{t('منتج غير معتمد')}</Badge>}
              </div>
              {m.complete && <CarbBadge carbs={m.total.carbs} level="normal" />}
              <div className="flex flex-col gap-1">
                <button className="text-sm text-brand" onClick={() => setEdit(s)}>{t('تعديل')}</button>
                <button className="min-h-[44px] px-2 text-sm text-slate-500" onClick={async () => { if (confirm(t('حذف السناك؟'))) { await deleteSnack(s.id); await reload(); } }}>{t('حذف')}</button>
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
  const setT = (i: number, patch: Partial<CategoryTarget>) => setS({ ...s, category_targets: s.category_targets.map((ct, n) => (n === i ? { ...ct, ...patch } : ct)) });
  const out = (v: number | null, lo: number, hi: number) => v !== null && (v < lo || v > hi);
  const iobBad = (s.iob_dia_min === null) !== (s.iob_peak_min === null) ? t('اكتبوا مدة العمل والذروة معًا.')
    : out(s.iob_dia_min, 120, 480) ? t('مدة العمل بين 120 و480 دقيقة.')
    : out(s.iob_peak_min, 35, 120) ? t('الذروة بين 35 و120 دقيقة.')
    : s.iob_dia_min !== null && s.iob_peak_min! >= s.iob_dia_min / 2 ? t('الذروة يجب أن تكون أقل من نصف مدة العمل.')
    : out(s.cob_absorb_min, 60, 360) ? t('امتصاص الكارب بين 60 و360 دقيقة.') : null;
  const bad = s.preferred_min > s.preferred_max || s.preferred_max > s.max_meal_carbs || !!iobBad;

  return (
    <Page title={t('الإعدادات')} back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="space-y-3">
          <h2 className="font-bold">{t('هامش الأمان')}</h2>
          <Field label={t('الحد الأقصى لكارب الوجبة (غ)')} hint={t('فوقه يظهر تحذير واضح ولا تُقترح الوصفة. لا نمنع التسجيل بالقوة.')}>
            <NumInput value={s.max_meal_carbs} onChange={(v) => setS({ ...s, max_meal_carbs: v ?? 0 })} />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('المدى المفضّل: من')}><NumInput value={s.preferred_min} onChange={(v) => setS({ ...s, preferred_min: v ?? 0 })} /></Field>
            <Field label={t('إلى')}><NumInput value={s.preferred_max} onChange={(v) => setS({ ...s, preferred_max: v ?? 0 })} /></Field>
          </div>
          <p className="text-sm text-slate-600">{rich(t('≤ {a} عادي • حتى {b} قريب من الحد • أعلى من ذلك تحذير.'), { a: s.preferred_max, b: s.max_meal_carbs })}</p>
          {bad && <Alert tone="near">{t('المدى المفضّل يجب أن يكون ضمن الحد الأقصى.')}</Alert>}
          <Field label={t('الملعقة الكبيرة (غ أو مل)')} hint={t('تُستخدم للكاتشب والمايونيز وغيرها.')}><NumInput value={s.tbsp_size} onChange={(v) => setS({ ...s, tbsp_size: v ?? 15 })} /></Field>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">{t('أهداف اختيار المنتجات')}</h2>
          <p className="text-sm text-slate-600">{t('تنبيه فقط عند تسجيل منتج يتجاوز الهدف.')}</p>
          {s.category_targets.map((ct, i) => (
            <div key={i} className="grid grid-cols-[1fr_1fr_5rem_2.5rem] items-end gap-2">
              <input aria-label={t('الفئة')} list="tcats" className={inputCls} value={ct.category} onChange={(e) => setT(i, { category: e.target.value })} />
              <select aria-label={t('الأساس')} className={inputCls} value={ct.basis} onChange={(e) => setT(i, { basis: e.target.value as CategoryTarget['basis'] })}>
                <option value="per100">{t('≤ لكل 100')}</option><option value="serving">{t('≤ للحبة/الحصة')}</option>
              </select>
              <NumInput aria-label={t('الحد')} value={ct.max} onChange={(v) => setT(i, { max: v ?? 0 })} />
              <button aria-label={t('حذف')} className="h-11 rounded-xl bg-slate-100 text-slate-500" onClick={() => setS({ ...s, category_targets: s.category_targets.filter((_, n) => n !== i) })}>✕</button>
            </div>
          ))}
          <datalist id="tcats">{PRODUCT_CATEGORIES.map((c) => <option key={c} value={c} />)}</datalist>
          <Btn kind="ghost" block onClick={() => setS({ ...s, category_targets: [...s.category_targets, { category: '', basis: 'per100', max: 15 }] })}>{t('+ هدف')}</Btn>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">{t('عرض السكر')}</h2>
          <Field label={t('الوحدة')}>
            <select className={inputCls} value={s.glucose_unit} onChange={(e) => setS({ ...s, glucose_unit: e.target.value as Settings['glucose_unit'] })}>
              <option value="mmol">mmol/L</option><option value="mgdl">mg/dL</option>
            </select>
          </Field>
          <p className="text-sm text-slate-600">{t('نطاق تلوين الرقم ({unit}). يكتبه الوالدان من توصية الطبيب. إن تُرك فارغًا يُلوَّن بالنطاق المرجعي 70 إلى 180 ملغ/دل ويُكتب «مرجعي»، ولا تعتمد عليه التنبيهات.', { unit: unitLabel(s.glucose_unit) })}</p>
          <div className="grid grid-cols-2 gap-3">
            <Field label={t('أقل من (أحمر)')}><NumInput value={s.glucose_low_mgdl === null ? null : Number(formatGlucose(s.glucose_low_mgdl, s.glucose_unit))} onChange={(v) => setS({ ...s, glucose_low_mgdl: v === null ? null : toMgdl(v, s.glucose_unit) })} /></Field>
            <Field label={t('أعلى من (أصفر)')}><NumInput value={s.glucose_high_mgdl === null ? null : Number(formatGlucose(s.glucose_high_mgdl, s.glucose_unit))} onChange={(v) => setS({ ...s, glucose_high_mgdl: v === null ? null : toMgdl(v, s.glucose_unit) })} /></Field>
          </div>
        </Card>

        <Card className="space-y-3">
          <h2 className="font-bold">{t('الإنسولين والكارب النشط (IOB / COB)')}</h2>
          <Alert tone="info">{t('للعرض فقط على الرسم. اكتبوا الأرقام كما أعطاكم إياها الفريق الطبي. التطبيق لا يقترح جرعات ولا كميات علاج.')}</Alert>
          <p className="text-sm text-slate-600">{t('مدة عمل الإنسولين السريع وذروته، ومدة امتصاص الكارب، بالدقائق. اتركوها فارغة ليبقى العرض مطفأً.')}</p>
          <div className="grid grid-cols-3 items-end gap-3">
            <Field label={t('مدة العمل (د)')}><NumInput value={s.iob_dia_min} onChange={(v) => setS({ ...s, iob_dia_min: v })} /></Field>
            <Field label={t('الذروة (د)')}><NumInput value={s.iob_peak_min} onChange={(v) => setS({ ...s, iob_peak_min: v })} /></Field>
            <Field label={t('الكارب (د)')}><NumInput value={s.cob_absorb_min} onChange={(v) => setS({ ...s, cob_absorb_min: v })} /></Field>
          </div>
          {iobBad && <p className="text-sm font-bold text-brand">{iobBad}</p>}
        </Card>

        <Btn kind="primary" block disabled={bad} onClick={async () => {
          try { await saveSettings({ ...s, category_targets: s.category_targets.filter((ct) => ct.category.trim()) }); await reload(); toast(t('تم حفظ الإعدادات ✓')); }
          catch (e) { toast((e as Error).message); }
        }}>{t('حفظ')}</Btn>
      </div>
    </Page>
  );
}
