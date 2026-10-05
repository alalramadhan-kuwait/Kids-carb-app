import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { callFood, findBarcode, logEstimated, logPhotoEntry, lookupBarcode, scaleItem, shrinkPhoto, totals, type EstItem, type Estimate, type FoodStatus, type Packaged } from '../lib/food';
import { fmt } from '../lib/carbs';
import { Alert, Btn, Card, NumInput, Page, cx, inputCls, toast } from '../components/ui';
import { uploadPhoto } from '../lib/supabase';
import { Icon } from '../components/Icon';
import { isEn, lang, t } from '../i18n';

type Step = { s: 'pick' } | { s: 'working'; url: string; what: 'photo' | 'barcode' } | { s: 'estimate'; url: string; est: Estimate; scanId: string | null }
  | { s: 'packaged'; url: string; p: Packaged } | { s: 'nofood'; url: string } | { s: 'manual'; url: string; file: File };

/** The AI photo estimate is on hold: a photo is kept with the parents' own carb count, to re-estimate later. */
const AI_ON = false;

const ERR: Record<string, string> = { // i18n-ok: shown through t()
  no_key: 'الميزة تحتاج مفتاح Anthropic في الإعدادات.', daily_limit: 'وصلتم لحد الصور اليومي. جرّبوا غدًا أو سجّلوا يدويًا.', // i18n-ok
  refused: 'لم يتمكن التقدير من قراءة هذه الصورة.', unreadable: 'لم يتمكن التقدير من قراءة هذه الصورة.', bad_image: 'تعذّر قراءة الصورة.', // i18n-ok
  busy: 'الخدمة مشغولة الآن. حاولوا بعد قليل.', bad_key: 'مفتاح Anthropic غير صالح. غيّروه من الإعدادات.', // i18n-ok
};

/**
 * صوّر الأكل: one photo. While the AI estimate is on hold (AI_ON), a photo without a barcode is saved with the
 * carbs the parents count themselves, and kept for reference. A barcode in it is looked up (Open Food Facts); otherwise the photo is estimated by AI.
 * The result is always an editable estimate: nothing is saved until the parents check it and tap save.
 */
export default function Scan() {
  const nav = useNavigate();
  const { reload, settings } = useData();
  const [step, setStep] = useState<Step>({ s: 'pick' });
  const [note, setNote] = useState('');
  const [status, setStatus] = useState<FoodStatus | null>(null);
  const [err, setErr] = useState('');
  const cam = useRef<HTMLInputElement>(null), gallery = useRef<HTMLInputElement>(null);
  useEffect(() => { if (AI_ON) callFood<FoodStatus>({ action: 'status' }).then(setStatus).catch(() => setStatus(null)); }, []);

  const onFile = async (file: File | undefined) => {
    if (!file) return;
    setErr('');
    try {
      const photo = await shrinkPhoto(file);
      setStep({ s: 'working', url: photo.url, what: 'barcode' });
      const code = await findBarcode(file);
      if (code) {
        const p = await lookupBarcode(code, lang()).catch(() => null);
        if (p) return setStep({ s: 'packaged', url: photo.url, p });
      }
      if (!AI_ON) return setStep({ s: 'manual', url: photo.url, file });
      if (!status?.configured) { setErr(t(ERR.no_key)); return setStep({ s: 'pick' }); }
      setStep({ s: 'working', url: photo.url, what: 'photo' });
      const r = await callFood<{ estimate: Estimate; scan_id: string | null }>({ action: 'photo', image: photo.data, media_type: photo.media_type, note });
      setStep(r.estimate.is_food ? { s: 'estimate', url: photo.url, est: r.estimate, scanId: r.scan_id } : { s: 'nofood', url: photo.url });
      setStatus((x) => (x ? { ...x, used: x.used + 1 } : x));
    } catch (e) {
      const code = (e as Error).message;
      setErr(ERR[code] ? t(ERR[code]) : t('تعذّر التقدير: {e}', { e: code }));
      setStep({ s: 'pick' });
    }
  };

  const save = async (name: string, items: EstItem[], kind: 'meal' | 'snack', scanId: string | null, source: string) => {
    const tot = totals(items);
    if (tot.carbs > settings.max_meal_carbs && !confirm(t('هذه الوجبة {carbs}غ كارب وتتجاوز الحد ({max}غ). هل تريدون تسجيلها رغم ذلك؟', { carbs: fmt(tot.carbs), max: settings.max_meal_carbs }))) return;
    try {
      await logEstimated({ name: name.trim() || t('وجبة مصوّرة'), kind, items, lang: lang(), notes: [source, note.trim()].filter(Boolean).join(' · '), scanId });
      await reload(); toast(t('تم التسجيل في السجل ✓')); nav('/');
    } catch (e) { toast(t('تعذّر التسجيل: {err}', { err: (e as Error).message })); }
  };

  return (
    <Page title={t('صوّر الأكل')} back={() => nav(-1)}>
      <input ref={cam} type="file" accept="image/*" capture="environment" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />
      <input ref={gallery} type="file" accept="image/*" className="hidden" onChange={(e) => { void onFile(e.target.files?.[0]); e.target.value = ''; }} />

      {step.s === 'pick' && (
        <div className="space-y-4">
          {err && <Alert tone="over">{err} {err === t(ERR.no_key) && <Link to="/settings/advanced" className="underline">{t('إعدادات متقدمة')}</Link>}</Alert>}
          <button onClick={() => cam.current?.click()} className="flex min-h-[136px] w-full flex-col items-center justify-center gap-3 rounded-3xl bg-brand text-white active:opacity-90">
            <Icon name="camera" size={44} /><span className="text-xl font-bold">{t('التقاط صورة')}</span>
            <span className="text-sm opacity-80">{AI_ON ? t('للأكل أو لباركود المنتج') : t('تُحفظ مع الكارب الذي تقدّرونه')}</span>
          </button>
          <Btn block kind="ghost" onClick={() => gallery.current?.click()}>{t('اختيار من الصور')}</Btn>
          {AI_ON && <label className="block space-y-1.5">
            <span className="text-sm font-medium text-slate-600">{t('ملاحظة تساعد التقدير (اختياري)')}</span>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلًا: شاي بملعقتين سكر، نصف الصحن')} />
          </label>}
          {!AI_ON && <Alert tone="info">{t('التقدير بالذكاء الاصطناعي متوقف حاليًا. صوّروا الأكل واكتبوا الكارب الذي تقدّرونه: تُحفظ الصورة مع التسجيل لنعيد تقدير الكارب لاحقًا إذا احتجنا. باركود المنتج ما زال يُقرأ.')}</Alert>}
          {AI_ON && <p className="text-xs leading-relaxed text-slate-500">
            {t('الصورة تُقدَّر بالذكاء الاصطناعي، والباركود يُقرأ من Open Food Facts. كل الأرقام تقدير تراجعونه قبل الحفظ.')}
            {status && status.configured && <> {t('اليوم {n} من {max} صورة.', { n: status.used, max: status.limit })}</>}
          </p>}
        </div>
      )}

      {step.s === 'working' && (
        <div className="space-y-4 text-center">
          <img src={step.url} alt="" className="mx-auto max-h-[50vh] rounded-2xl object-contain" />
          <p className="animate-pulse font-medium text-slate-600">{step.what === 'barcode' ? t('نبحث عن باركود…') : t('نقدّر ما في الصورة…')}</p>
        </div>
      )}

      {step.s === 'nofood' && (
        <div className="space-y-4">
          <img src={step.url} alt="" className="max-h-[40vh] w-full rounded-2xl object-cover" />
          <Alert tone="near">{t('لم نجد أكلًا أو شرابًا في الصورة.')}</Alert>
          <Btn block kind="primary" onClick={() => setStep({ s: 'pick' })}>{t('صورة أخرى')}</Btn>
        </div>
      )}

      {step.s === 'manual' && <PhotoEntry url={step.url} file={step.file} onRetake={() => setStep({ s: 'pick' })} onDone={async () => { await reload(); nav('/'); }} />}

      {step.s === 'estimate' && <EstimateReview url={step.url} est={step.est} onRetake={() => setStep({ s: 'pick' })}
        onSave={(name, items, kind) => save(name, items, kind, step.scanId, t('تقدير من صورة'))} />}

      {step.s === 'packaged' && <PackagedReview url={step.url} p={step.p} onRetake={() => setStep({ s: 'pick' })}
        onSave={(name, items, kind) => save(name, items, kind, null, t('من الباركود {code}', { code: step.p.code }))} />}
    </Page>
  );
}

function ItemRow({ item, onChange, onRemove }: { item: EstItem; onChange: (i: EstItem) => void; onRemove: () => void }) {
  const name = isEn() ? item.name_en : item.name_ar;
  return (
    <li className="space-y-2 px-4 py-3">
      <div className="flex items-center gap-2">
        <input className="min-h-[44px] min-w-0 flex-1 rounded-xl border border-slate-100 bg-white px-3 font-bold" dir="auto" value={name}
          onChange={(e) => onChange({ ...item, name_ar: e.target.value, name_en: e.target.value })} aria-label={t('الاسم')} />
        <button onClick={onRemove} aria-label={t('حذف')} className="grid h-11 w-11 shrink-0 place-items-center rounded-full text-slate-400">✕</button>
      </div>
      <div className="flex items-center gap-2 text-sm">
        <label className="flex items-center gap-1.5"><NumInput value={item.grams} onChange={(v) => onChange(scaleItem(item, v ?? 0))} className="!w-20 !min-h-[44px] text-center" /><span className="text-slate-500">{t('غ')}</span></label>
        <span className="text-slate-300">{isEn() ? '→' : '←'}</span>
        <label className="flex items-center gap-1.5"><NumInput value={item.carbs_g} onChange={(v) => onChange({ ...item, carbs_g: v ?? 0, confidence: 'high' })} className="!w-20 !min-h-[44px] text-center font-bold" /><span className="text-slate-500">{t('غ كارب')}</span></label>
      </div>
      {(item.confidence !== 'high' || item.hidden_sugar) && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          {item.confidence === 'low' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-700">{t('تقدير غير مؤكد')}</span>}
          {item.confidence === 'medium' && <span className="rounded-full bg-slate-100 px-2 py-0.5 text-slate-600">{t('تقدير متوسط')}</span>}
          {item.hidden_sugar && <span className="rounded-full bg-white px-2 py-0.5 text-slate-800 ring-1 ring-brand">{t('قد يكون فيه سكر غير ظاهر')}</span>}
        </div>
      )}
    </li>
  );
}

function ReviewFooter({ items, name, setName, onSave, onRetake }: { items: EstItem[]; name: string; setName: (s: string) => void; onSave: (kind: 'meal' | 'snack') => void; onRetake: () => void }) {
  const [kind, setKind] = useState<'meal' | 'snack'>('meal');
  const tot = totals(items);
  return (
    <div className="space-y-3">
      <div className="flex items-baseline justify-between px-1">
        <span className="font-bold">{t('المجموع')}</span>
        <span><b className="num text-3xl text-brand-num">{fmt(tot.carbs)}</b> <span className="text-sm text-slate-500">{t('غ كارب')}</span></span>
      </div>
      <input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('اسم الوجبة')} />
      <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-50 p-1">
        {(['meal', 'snack'] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cx('min-h-[44px] rounded-full text-sm font-bold', kind === k ? 'bg-brand text-white' : 'text-slate-600')}>{k === 'meal' ? t('وجبة') : t('سناك')}</button>
        ))}
      </div>
      <Btn block kind="primary" className="min-h-[56px] text-lg" disabled={!items.length} onClick={() => onSave(kind)}>{t('سجّل {g} غ كارب', { g: fmt(tot.carbs) })}</Btn>
      <Btn block kind="ghost" onClick={onRetake}>{t('صورة أخرى')}</Btn>
    </div>
  );
}

function EstimateReview({ url, est, onSave, onRetake }: { url: string; est: Estimate; onSave: (name: string, items: EstItem[], kind: 'meal' | 'snack') => void; onRetake: () => void }) {
  const [items, setItems] = useState<EstItem[]>(est.items);
  const [name, setName] = useState(() => est.items.map((i) => (isEn() ? i.name_en : i.name_ar)).join(' + '));
  const notes = isEn() ? est.notes_en : est.notes_ar;
  const blank: EstItem = { name_ar: '', name_en: '', grams: 0, carbs_g: 0, protein_g: 0, fat_g: 0, kcal: 0, confidence: 'high', hidden_sugar: false };
  return (
    <div className="space-y-4">
      <div className="flex items-start gap-3">
        <img src={url} alt="" className="h-20 w-20 shrink-0 rounded-2xl object-cover" />
        <Alert tone="info">{t('تقدير من صورة بالذكاء الاصطناعي. راجعوا الكميات والكارب قبل الحفظ.')}</Alert>
      </div>
      <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">
        {items.map((i, k) => <ItemRow key={k} item={i} onChange={(n) => setItems(items.map((x, j) => (j === k ? n : x)))} onRemove={() => setItems(items.filter((_, j) => j !== k))} />)}
        <li><button onClick={() => setItems([...items, blank])} className="min-h-[48px] w-full px-4 text-start text-sm font-bold text-brand">{t('+ إضافة صنف')}</button></li>
      </ul>
      {notes && <p className="px-1 text-sm text-slate-600">{notes}</p>}
      <ReviewFooter items={items} name={name} setName={setName} onSave={(kind) => onSave(name, items, kind)} onRetake={onRetake} />
    </div>
  );
}

function PackagedReview({ url, p, onSave, onRetake }: { url: string; p: Packaged; onSave: (name: string, items: EstItem[], kind: 'meal' | 'snack') => void; onRetake: () => void }) {
  const [grams, setGrams] = useState<number>(p.serving ?? 100);
  const [name, setName] = useState(p.name);
  const per = (v: number | null) => (v === null ? 0 : Math.round((v * grams) / 10) / 10);
  const item: EstItem = { name_ar: p.name, name_en: p.name, grams, carbs_g: per(p.per100.carbs), protein_g: per(p.per100.protein), fat_g: per(p.per100.fat), kcal: Math.round(per(p.per100.kcal)), confidence: 'high', hidden_sugar: false };
  return (
    <div className="space-y-4">
      <Card className="flex items-center gap-3 !p-3">
        <img src={url} alt="" className="h-16 w-16 shrink-0 rounded-xl object-cover" />
        <span className="min-w-0 flex-1">
          <span className="block truncate font-bold"><bdi>{p.name}</bdi></span>
          <span className="block truncate text-sm text-slate-500">{[p.brand, t('{c} غ كارب لكل 100', { c: fmt(p.per100.carbs ?? 0) })].filter(Boolean).join(' · ')}</span>
        </span>
      </Card>
      <label className="flex items-center justify-between gap-3 px-1">
        <span className="font-medium">{t('الكمية التي أكلتها')}</span>
        <span className="flex items-center gap-1.5"><NumInput value={grams} onChange={(v) => setGrams(v ?? 0)} className="!w-24 text-center" /><span className="text-slate-500">{t('غ أو مل')}</span></span>
      </label>
      {p.serving && <p className="px-1 text-xs text-slate-500">{t('الحصة على العبوة {g} غ.', { g: fmt(p.serving) })}</p>}
      <p className="px-1 text-xs text-slate-500">{t('البيانات من Open Food Facts وقد تختلف عن الملصق. قارنوها بالعبوة.')}</p>
      <ReviewFooter items={[item]} name={name} setName={setName} onSave={(kind) => onSave(name, [item], kind)} onRetake={onRetake} />
    </div>
  );
}

/** The photo with the parents' own count: name, carbs, meal or snack. The photo is stored with the entry. */
function PhotoEntry({ url, file, onRetake, onDone }: { url: string; file: File; onRetake: () => void; onDone: () => Promise<void> }) {
  const [name, setName] = useState('');
  const [carbs, setCarbs] = useState<number | null>(null);
  const [kind, setKind] = useState<'meal' | 'snack'>('meal');
  const [busy, setBusy] = useState(false);
  const save = async () => {
    if (carbs === null) return;
    setBusy(true);
    try {
      const path = await uploadPhoto(file, 'meals');
      await logPhotoEntry({ name: name.trim() || t('وجبة مصوّرة'), kind, carbs, photo_path: path, notes: t('مع صورة للمرجع') });
      toast(t('تم التسجيل مع الصورة ✓')); await onDone();
    } catch (e) { toast(t('تعذّر التسجيل: {err}', { err: (e as Error).message })); } finally { setBusy(false); }
  };
  return (
    <div className="space-y-4">
      <img src={url} alt="" className="max-h-[38vh] w-full rounded-2xl object-cover" />
      <input className={inputCls} dir="auto" value={name} onChange={(e) => setName(e.target.value)} placeholder={t('اسم الأكل (اختياري)')} />
      <label className="flex items-center justify-between gap-3 px-1">
        <span className="font-medium">{t('الكارب الذي تقدّرونه')}</span>
        <span className="flex items-center gap-1.5"><NumInput value={carbs} onChange={setCarbs} className="!w-24 text-center text-lg font-bold" /><span className="text-slate-500">{t('غ')}</span></span>
      </label>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-50 p-1">
        {(['meal', 'snack'] as const).map((k) => (
          <button key={k} onClick={() => setKind(k)} className={cx('min-h-[44px] rounded-full text-sm font-bold', kind === k ? 'bg-brand text-white' : 'text-slate-600')}>{k === 'meal' ? t('وجبة') : t('سناك')}</button>
        ))}
      </div>
      <Btn block kind="primary" className="min-h-[56px] text-lg" disabled={carbs === null || carbs < 0 || carbs >= 500 || busy} onClick={save}>{carbs === null ? t('اكتبوا الكارب') : t('سجّل {g} غ كارب', { g: fmt(carbs) })}</Btn>
      <Btn block kind="ghost" onClick={onRetake}>{t('صورة أخرى')}</Btn>
    </div>
  );
}
