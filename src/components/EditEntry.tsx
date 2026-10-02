import { useState } from 'react';
import { useData } from '../lib/data';
import { editProblem, fromLocalInput, toLocalInput, type EditDraft, type EditProblem } from '../lib/edit';
import { updateEvent, updateMeal } from '../lib/editSave';
import { formatGlucose, toMgdl, unitLabel } from '../lib/glucose';
import type { EventRow, HistoryEntry } from '../lib/types';
import { Alert, Btn, Field, NumInput, Toggle, inputCls, toast } from './ui';
import { useQuickItems } from '../lib/quick';
import { brandsOf } from '../lib/brand';
import { t, tr } from '../i18n';

const PROBLEM: Record<EditProblem, string> = tr({ // i18n-ok: values translated when read
  time: 'اختاروا الوقت', future: 'الوقت في المستقبل', units: 'الوحدات بين 0 و100', carbs: 'الكارب بين 0 و300 غ', // i18n-ok
  bg: 'قيمة الوخز غير معقولة', minutes: 'المدة بين 1 و600 دقيقة', name: 'اكتبوا اسم الوجبة', nutrition: 'القيم الغذائية غير معقولة', // i18n-ok
});

/** Change a logged entry: time, amount and note; for a meal also its name, brand and nutrition. Recorded (who and when). */
export function EditEntry({ e, h, onDone, onCancel }: { e?: EventRow; h?: HistoryEntry; onDone: () => void; onCancel: () => void }) {
  const { me, settings, reload, products } = useData();
  const quick = useQuickItems();
  const unit = settings.glucose_unit;
  const kind = h ? 'meal' : e!.kind;
  const [when, setWhen] = useState(toLocalInput(Date.parse(h ? h.eaten_at : e!.occurred_at)));
  const [units, setUnits] = useState<number | null>(e?.insulin_units ?? null);
  const [carbs, setCarbs] = useState<number | null>(h ? h.total_carbs : e?.carbs_g ?? null);
  const [bg, setBg] = useState<number | null>(e?.bg_mgdl ? Number(formatGlucose(e.bg_mgdl, unit)) : null);
  const [minutes, setMinutes] = useState<number | null>(e?.activity_min ?? null);
  const [name, setName] = useState(h?.name ?? '');
  const [note, setNote] = useState((h ? h.notes : e!.note) ?? '');
  const [brand, setBrand] = useState(h?.brand ?? '');
  const [fat, setFat] = useState<number | null>(h?.total_fat ?? null);
  const [protein, setProtein] = useState<number | null>(h?.total_protein ?? null);
  const [fiber, setFiber] = useState<number | null>(h?.total_fiber ?? null);
  const [kcal, setKcal] = useState<number | null>(h?.total_kcal ?? null);
  const inQuick = !!h && quick.items.some((q) => q.name === h.name);
  const [toQuick, setToQuick] = useState<boolean | null>(null);           // null: follow the default below
  const keep = toQuick ?? (inQuick || !!brand.trim());                    // a branded product is worth keeping one tap away
  const brands = brandsOf([...quick.items, ...products.map((p) => ({ brand: p.brand }))]);
  const [busy, setBusy] = useState(false);
  const draft: EditDraft = { t: fromLocalInput(when), units, carbs, bg: bg === null ? null : toMgdl(bg, unit), minutes, name, note, ...(h ? { brand, fat, protein, fiber, kcal, toQuick: keep } : {}) };
  const problem = editProblem(kind, draft, Date.now());

  const save = async () => {
    if (problem) return;
    setBusy(true);
    try {
      if (h) await updateMeal(h, draft, me); else await updateEvent(e!, draft, me);
      await reload(); toast(t('تم التعديل ✓')); onDone();
    } catch (x) { toast((x as Error).message); } finally { setBusy(false); }
  };

  return (
    <div className="space-y-3">
      <Field label={t('الوقت')}>
        <input type="datetime-local" className={inputCls} dir="ltr" value={when} max={toLocalInput(Date.now() + 5 * 60000)} onChange={(x) => setWhen(x.target.value)} />
      </Field>
      {kind === 'meal' && <Field label={t('الاسم')}><input className={inputCls} dir="auto" value={name} maxLength={120} onChange={(x) => setName(x.target.value)} /></Field>}
      {kind === 'meal' && (
        <Field label={t('البراند (اختياري)')} hint={t('مثل KDD أو Almarai: تظهر منتجات البراند معًا في «أكل متكرر».')}>
          <input className={inputCls} dir="auto" list="brand-list" value={brand} maxLength={60} onChange={(x) => setBrand(x.target.value)} />
          <datalist id="brand-list">{brands.map((b) => <option key={b} value={b} />)}</datalist>
          {brands.length > 0 && (
            <div className="-mx-1 mt-2 flex flex-wrap gap-1.5">
              {brands.slice(0, 8).map((b) => <button key={b} type="button" onClick={() => setBrand(b)} className="min-h-[32px] rounded-full bg-slate-50 px-3 text-sm text-slate-600"><bdi>{b}</bdi></button>)}
            </div>
          )}
        </Field>
      )}
      {kind === 'insulin' && <Field label={e?.insulin_type === 'long' ? t('وحدات الإنسولين الطويل') : t('وحدات الإنسولين السريع')}><NumInput value={units} onChange={setUnits} /></Field>}
      {(kind === 'meal' || kind === 'carbs' || kind === 'treatment') && (
        <Field label={t('الكارب (غ)')} hint={kind === 'meal' && (h?.lines.length ?? 0) > 1 ? t('هذه وجبة من عدة أصناف: يتغير المجموع فقط وتُعلَّم «معدّلة».') : undefined}>
          <NumInput value={carbs} onChange={setCarbs} />
        </Field>
      )}
      {kind === 'meal' && (
        <div className="grid grid-cols-2 gap-2">
          <Field label={t('دهون (غ)')}><NumInput value={fat} onChange={setFat} /></Field>
          <Field label={t('بروتين (غ)')}><NumInput value={protein} onChange={setProtein} /></Field>
          <Field label={t('ألياف (غ)')}><NumInput value={fiber} onChange={setFiber} /></Field>
          <Field label={t('سعرات')}><NumInput value={kcal} onChange={setKcal} /></Field>
        </div>
      )}
      {kind === 'bg_check' && <Field label={t('وخز الإصبع ({unit})', { unit: unitLabel(unit) })}><NumInput value={bg} onChange={setBg} /></Field>}
      {kind === 'exercise' && <Field label={t('المدة (دقيقة)')}><NumInput value={minutes} onChange={setMinutes} /></Field>}
      {kind !== 'note' && <Field label={t('ملاحظة')}><input className={inputCls} dir="auto" value={note} maxLength={300} onChange={(x) => setNote(x.target.value)} /></Field>}
      {kind === 'note' && <Field label={t('الملاحظة')}><textarea className={inputCls} dir="auto" rows={3} value={note} maxLength={500} onChange={(x) => setNote(x.target.value)} /></Field>}
      {kind === 'meal' && (
        <label className="flex items-center justify-between gap-3 rounded-2xl bg-slate-50 px-3 py-2.5">
          <span className="text-sm"><b className="block">{inQuick ? t('حدّثه في «أكل متكرر»') : t('أضفه إلى «أكل متكرر»')}</b><span className="text-xs text-slate-500">{t('لتسجيله بلمسة في المرة القادمة')}</span></span>
          <Toggle on={keep} onChange={setToQuick} label={t('أكل متكرر')} />
        </label>
      )}
      {problem && problem !== 'time' && <Alert tone="near">{PROBLEM[problem]}</Alert>}
      {(h?.source || e?.source) && <p className="text-xs text-slate-500">{t('مستورد من Gluroo: بعد التعديل يبقى كما عدّلتموه ولا تغيّره أي مزامنة لاحقة.')}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Btn kind="ghost" onClick={onCancel} disabled={busy}>{t('إلغاء')}</Btn>
        <Btn kind="primary" onClick={save} disabled={busy || !!problem}>{busy ? t('جارٍ الحفظ…') : t('حفظ')}</Btn>
      </div>
    </div>
  );
}
