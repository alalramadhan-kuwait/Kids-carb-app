// Mom mode, «صوّري الأكل»: where the food is from (optional), one photo, and the estimate per food with its carbs.
// She checks the numbers; «حطيه بالصحن» puts the meal on the plate as one food with its photo, so it goes on to
// the dose like any other plate. Nothing is logged before that, and the estimate never suggests insulin.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useData } from '../../lib/data';
import { aiStatus, estimatePhoto, shrinkPhoto, type EstItem } from '../../lib/food';
import { draftOps, saveLabelFood } from '../../lib/mom';
import { uploadPhoto } from '../../lib/supabase';
import { RESTAURANTS } from '../../lib/restaurants';
import { fmt } from '../../lib/carbs';
import { NumInput, cx, inputCls, toast } from '../../components/ui';
import { isEn, t, tMaybe } from '../../i18n';
import { Big, MomPage, okToReplace } from './MomUI';

/** Where the food is from: home, a restaurant, or a brand typed in; it goes to the estimate as the parents' note. */
export function SourcePick({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  const chips = [t('البيت'), ...RESTAURANTS.map((r) => tMaybe(r.label))];
  return (
    <div className="space-y-1.5">
      <div className="text-[15px] font-bold text-slate-500">{t('من وين؟ (اختياري)')}</div>
      <div className="-mx-4 flex gap-1.5 overflow-x-auto px-4">
        {chips.map((c) => <button key={c} onClick={() => onChange(value === c ? '' : c)} className={cx('h-9 shrink-0 rounded-full px-3 text-[14px] font-bold', value === c ? 'bg-brand text-white' : 'bg-white text-slate-700')}>{c}</button>)}
      </div>
      <input className={inputCls} dir="auto" value={chips.includes(value) ? '' : value} onChange={(e) => onChange(e.target.value)} placeholder={t('أو اكتبي الماركة أو المطعم')} maxLength={60} />
    </div>
  );
}

export function MomSnap() {
  const nav = useNavigate();
  const { reload } = useData();
  const [ready, setReady] = useState<boolean | null>(null);
  useEffect(() => { aiStatus().then((x) => setReady(x.configured)).catch(() => setReady(false)); }, []);
  const [from, setFrom] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [items, setItems] = useState<EstItem[] | null>(null);
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const cam = useRef<HTMLInputElement>(null), gallery = useRef<HTMLInputElement>(null);
  const preview = useMemo(() => (file ? URL.createObjectURL(file) : null), [file]);
  useEffect(() => () => { if (preview) URL.revokeObjectURL(preview); }, [preview]);

  const onFile = async (f: File | undefined) => {
    if (!f) return;
    setFile(f); setItems(null); setBusy(true);
    try {
      const r = await estimatePhoto(await shrinkPhoto(f), from ? `From: ${from}` : '');
      if (!r.estimate.is_food) { toast(t('ما بان أكل بالصورة. جربي مرة ثانية')); setFile(null); return; }
      setItems(r.estimate.items); setNote(isEn() ? r.estimate.notes_en : r.estimate.notes_ar);
    } catch (e) {
      toast((e as Error).message === 'daily_limit' ? t('خلصت صور اليوم') : t('ما قدرت أقدّر الحين. جربي بعد شوي'));
      setFile(null);
    } finally { setBusy(false); }
  };
  const total = items ? Math.round(items.reduce((s, i) => s + i.carbs_g, 0) * 10) / 10 : 0;
  const name = items ? items.map((i) => (isEn() ? i.name_en : i.name_ar)).join(' + ') : '';
  // the checked meal on the plate as one food with its photo (the same way as a food read off a label)
  const toPlate = async () => {
    if (!file || !items?.length) return;
    setBusy(true);
    try {
      if (!okToReplace('now')) { setBusy(false); return; }
      draftOps.start('now');
      const photo = await uploadPhoto(file, 'products');
      const { productId, portionId } = await saveLabelFood({ name: from ? `${name} · ${from}` : name, carbs: total, photo,
        note: `من صورة (تقدير): ${items.map((i) => `${i.name_ar} ${fmt(i.carbs_g)} غ`).join(' + ')}${from ? ` · ${from}` : ''} · راجعته ماما` }); // i18n-ok: stored note
      draftOps.add({ kind: 'product', id: productId, portion_id: portionId });
      await reload();
      nav('/mom/meal', { replace: true });
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };

  const pickers = <>
    <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
    <input ref={gallery} type="file" accept="image/*" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
  </>;

  if (ready === false) return (
    <MomPage title={t('صوّري الأكل')} back="/mom/actions/food">
      <p className="text-center text-[17px] text-slate-600">{t('التقدير بالصور مو مفعّل. كلّمي بابا')}</p>
    </MomPage>
  );

  // the estimate: one row per food, carbs changeable, a food removable
  if (items && file) return (
    <MomPage compact title={t('راجعي الكارب')} back="/mom/actions/food" foot={<>
      <div className="flex items-baseline justify-between px-1"><span className="text-[15px] text-slate-500">{t('المجموع')}</span><b className="num text-[26px] leading-none">{fmt(total)} {t('غ')}</b></div>
      <Big md disabled={busy || !items.length} onClick={toPlate}>✓ {t('حطيه بالصحن')}</Big>
      <Big tone="ghost" className="!min-h-[44px]" onClick={() => cam.current?.click()}>📷 {t('صورة ثانية')}</Big>
    </>}>
      {pickers}
      {preview && <img src={preview} alt="" className="max-h-[22vh] w-full rounded-2xl object-cover" />}
      <p className="text-center text-[14px] text-near">{t('تقدير · تأكدي من الأرقام')}{note ? ` · ${note}` : ''}</p>
      <div className="space-y-2">
        {items.map((it, k) => (
          <div key={k} className="flex items-center gap-2 rounded-2xl bg-white px-3 py-2">
            <span className="min-w-0 flex-1 truncate text-[17px] font-bold" dir="auto">{isEn() ? it.name_en : it.name_ar}</span>
            <NumInput value={it.carbs_g} onChange={(v) => setItems((xs) => xs!.map((x, j) => (j === k ? { ...x, carbs_g: v ?? 0, confidence: 'high' } : x)))} className="!w-20 !min-h-[44px] text-center font-bold" />
            <span className="text-[14px] text-slate-500">{t('غ')}</span>
            <button onClick={() => setItems((xs) => xs!.filter((_, j) => j !== k))} aria-label={t('حذف')} className="grid h-10 w-10 place-items-center text-slate-400">✕</button>
          </div>
        ))}
      </div>
    </MomPage>
  );

  return (
    <MomPage title={t('صوّري الأكل')} back="/mom/actions/food">
      {pickers}
      <SourcePick value={from} onChange={setFrom} />
      {busy ? (
        <div className="space-y-3 text-center">
          {preview && <img src={preview} alt="" className="mx-auto max-h-[40vh] rounded-2xl object-contain" />}
          <p className="animate-pulse text-[18px] font-bold text-slate-600">{t('يقدّر الأكل…')}</p>
        </div>
      ) : (
        <>
          <button disabled={ready === null} onClick={() => cam.current?.click()} className="flex min-h-[130px] w-full flex-col items-center justify-center gap-2 rounded-3xl bg-brand text-white active:opacity-90">
            <span className="text-[44px] leading-none">📷</span><span className="text-[20px] font-bold">{t('صوّري')}</span>
          </button>
          <Big tone="ghost" onClick={() => gallery.current?.click()}>{t('من الصور')}</Big>
        </>
      )}
    </MomPage>
  );
}
