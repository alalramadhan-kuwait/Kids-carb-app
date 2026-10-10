// Simple mode: she ate out and nobody knows the grams. What she ate (kinds of food, no weights), a photo, where, how
// big the plate was, how much of it she ate and when. The carbs are kept as unknown: no number is guessed, and no dose
// is worked out for it. After saving, a dose that was given is recorded on its own page (a record, not a calculation).
import { useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { saveOutMeal } from '../../lib/outMeal';
import { uploadPhoto } from '../../lib/supabase';
import { useSubmitId } from '../../lib/useSubmitId';
import { TimePicker } from '../../components/TimePicker';
import { toast, cx } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import type { AtePart, MealSlot, PlateSize } from '../../lib/types';
import { Big, Choice, MomPage } from './MomUI';
import { SLOT_CHOICES } from './MomMealEntry';

/** Kinds of food most often eaten out. Stored in Arabic (data), shown through tMaybe. */
export const OUT_FOODS: [string, string][] = [
  ['دجاج', '🍗'], ['لحم', '🥩'], ['سمك', '🐟'], ['رز', '🍚'], ['نودلز', '🍜'], ['معكرونة', '🍝'], ['خبز', '🥖'], ['ساندويش', '🥪'], // i18n-ok: data, shown via tMaybe
  ['برغر', '🍔'], ['بيتزا', '🍕'], ['بطاط', '🍟'], ['شوربة', '🥣'], ['سلطة', '🥗'], ['عصير', '🧃'], ['مشروب غازي', '🥤'], ['حلى', '🍰'], ['آيس كريم', '🍨'], ['فواكه', '🍎'], // i18n-ok: data
];
const PLATES: [PlateSize, string][] = [['small', 'صغير'], ['medium', 'وسط'], ['large', 'كبير']]; // i18n-ok: shown via t()
const PARTS: [AtePart, string][] = [['all', 'كله'], ['half', 'نصه'], ['little', 'شوي']]; // i18n-ok: shown via t()
const inputCls = 'min-h-[56px] w-full rounded-2xl border border-slate-200 bg-white px-4 text-[18px]';

export function MomOut() {
  const nav = useNavigate();
  const { history, reload } = useData();
  const [foods, setFoods] = useState<string[]>([]);
  const [other, setOther] = useState('');
  const [place, setPlace] = useState('');
  const [plate, setPlate] = useState<PlateSize | null>(null);
  const [ate, setAte] = useState<AtePart | null>(null);
  const [slot, setSlot] = useState<MealSlot | null>(null);
  const [at, setAt] = useState(() => Date.now());
  const [guess, setGuess] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [savedId, setSavedId] = useState<string | null>(null);
  const [cid] = useSubmitId();
  const camera = useRef<HTMLInputElement>(null);
  // places used before, newest first: one tap next time
  const places = useMemo(() => [...new Set(history.map((h) => h.place?.trim()).filter((p): p is string => !!p))].slice(0, 6), [history]);
  const all = [...foods, ...(other.trim() ? [other.trim()] : [])];
  const toggle = (f: string) => setFoods((xs) => (xs.includes(f) ? xs.filter((x) => x !== f) : [...xs, f]));
  const g = guess.trim() === '' ? null : Number(guess);
  const guessBad = g !== null && !(g >= 0 && g <= 300);

  const save = async () => {
    if (!all.length || guessBad) return;
    setBusy(true);
    try {
      const photo = file ? await uploadPhoto(file, 'meals') : null;
      const id = await saveOutMeal({ foods: all, place: place.trim() || null, plate, ate, at, guess: g, photo, slot, note: null }, cid);
      await reload();
      setSavedId(id);
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };

  if (savedId) return (
    <MomPage title={t('انحفظت ✓')} back="/mom">
      <p className="rounded-3xl bg-white px-4 py-3 text-center text-[17px] text-slate-600">{t('الكارب مسجّل «غير معروف». بابا يقدر يكمّله بعدين من منيو المطعم.')}</p>
      <div className="text-center text-[19px] font-bold">{t('عطيتيها إبرة لهالأكل؟')}</div>
      <Big onClick={() => nav('/mom/record?purpose=meal', { replace: true })}>💉 {t('إيه · سجّلي الإبرة اللي انعطت')}</Big>
      <Big tone="ghost" onClick={() => nav('/mom', { replace: true })}>{t('لا · خلاص')}</Big>
      <button className="min-h-[48px] text-[16px] font-bold text-brand" onClick={() => nav(`/mom/meal-entry/${savedId}`, { replace: true })}>{t('شوفي الأكل')}</button>
    </MomPage>
  );

  return (
    <MomPage title={t('أكل برّا')} back="/mom/meal" foot={<Big disabled={busy || !all.length || guessBad} onClick={save}>✓ {t('احفظي')}</Big>}>
      <p className="rounded-2xl bg-brand-soft px-4 py-3 text-center text-[16px] text-brand">{t('ما نعرف الكارب؟ عادي. نسجّل شنو أكلت عشان نفهم السكر بعدين. ما تنحسب له إبرة.')}</p>

      <div className="text-[17px] font-bold">{t('شنو أكلت؟')}</div>
      <div className="grid grid-cols-3 gap-2">
        {OUT_FOODS.map(([f, icon]) => (
          <button key={f} onClick={() => toggle(f)} aria-pressed={foods.includes(f)}
            className={cx('flex min-h-[68px] flex-col items-center justify-center rounded-2xl border-2 bg-white px-1 text-[15px] font-bold leading-tight', foods.includes(f) ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200')}>
            <span className="text-2xl">{icon}</span><bdi>{tMaybe(f)}</bdi>
          </button>
        ))}
      </div>
      <input className={inputCls} dir="auto" value={other} onChange={(e) => setOther(e.target.value)} placeholder={t('شي ثاني؟ اكتبيه')} maxLength={40} />

      <button onClick={() => camera.current?.click()} className="grid min-h-[96px] place-items-center rounded-3xl border-2 border-dashed border-slate-300 bg-white text-center">
        {file ? <img src={URL.createObjectURL(file)} alt="" className="h-32 rounded-2xl object-cover" /> : <span><span className="block text-3xl">📷</span><b className="text-[17px]">{t('صوّري الصحن أو المنيو')}</b> <span className="text-[14px] text-slate-500">({t('اختياري')})</span></span>}
      </button>
      <input ref={camera} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />

      <div className="text-[17px] font-bold">{t('وين؟')} <span className="text-[14px] font-normal text-slate-500">({t('اختياري')})</span></div>
      {places.length > 0 && <div className="flex flex-wrap gap-2">{places.map((p) => (
        <button key={p} onClick={() => setPlace(p)} className={cx('min-h-[44px] rounded-full border-2 px-4 text-[16px] font-bold', place === p ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 bg-white')}><bdi>{p}</bdi></button>
      ))}</div>}
      <input className={inputCls} dir="auto" value={place} onChange={(e) => setPlace(e.target.value)} placeholder={t('اسم المطعم')} maxLength={60} />

      <div className="text-[17px] font-bold">{t('حجم الصحن')}</div>
      <div className="grid grid-cols-3 gap-2">{PLATES.map(([k, w]) => <Choice key={k} compact label={t(w)} on={plate === k} onClick={() => setPlate(plate === k ? null : k)} />)}</div>

      <div className="text-[17px] font-bold">{t('كم أكلت منه؟')}</div>
      <div className="grid grid-cols-3 gap-2">{PARTS.map(([k, w]) => <Choice key={k} compact label={t(w)} on={ate === k} onClick={() => setAte(ate === k ? null : k)} />)}</div>

      <div className="text-[17px] font-bold">{t('شنو هذي؟')}</div>
      <div className="grid grid-cols-2 gap-2">{SLOT_CHOICES.map(([k, w, icon]) => <Choice key={k} compact icon={icon} label={t(w)} on={slot === k} onClick={() => setSlot(slot === k ? null : k)} />)}</div>

      <div className="text-[17px] font-bold">{t('متى أكلت؟')}</div>
      <TimePicker value={at} onChange={setAt} />

      <div className="text-[17px] font-bold">{t('تخمينك للكارب')} <span className="text-[14px] font-normal text-slate-500">({t('اختياري')})</span></div>
      <input className={cx(inputCls, 'num', guessBad && 'border-over')} inputMode="decimal" value={guess} onChange={(e) => setGuess(e.target.value.replace(/[^\d.]/g, ''))} placeholder={t('مثلًا 60')} />
      <p className="text-[14px] text-slate-500">{t('يبقى تخمين: ينحفظ لحاله وما يدخل بأي حساب.')}</p>
    </MomPage>
  );
}
