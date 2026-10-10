import { useState } from 'react';
import { useData } from '../lib/data';
import { editProblem, type EditDraft, type EditProblem } from '../lib/edit';
import { carbsToMeal, updateEvent, updateMeal } from '../lib/editSave';
import { formatGlucose, toMgdl, unitLabel } from '../lib/glucose';
import type { EventRow, HistoryEntry } from '../lib/types';
import { Alert, Btn, NumInput, Toggle, cx, toast } from './ui';
import { useQuickItems } from '../lib/quick';
import { brandsOf } from '../lib/brand';
import { nutrProblem, scaled, totalsOf, type NutrState } from '../lib/per100';
import { NutritionFields, nutrStateFrom } from './NutritionFields';
import { TimePicker } from './TimePicker';
import { isEn, t, tr } from '../i18n';

const PROBLEM: Record<EditProblem, string> = tr({ // i18n-ok: values translated when read
  time: 'اختاروا الوقت', future: 'الوقت في المستقبل', units: 'الوحدات بين 0 و100', carbs: 'الكارب بين 0 و300 غ', // i18n-ok
  bg: 'قيمة الوخز غير معقولة', minutes: 'المدة بين 1 و600 دقيقة', name: 'اكتبوا اسم الوجبة', nutrition: 'القيم الغذائية غير معقولة', // i18n-ok
});

/** Change a logged entry: time, amount and note; for a meal also its name, brand and nutrition. Recorded (who and when). */
// the part of the portion she ate
const PARTS: [number, () => string][] = [[0.25, () => '¼'], [0.5, () => '½'], [0.75, () => '¾'], [1, () => t('كلها')], [1.5, () => '1½'], [2, () => '2×']];

export function EditEntry({ e, h, onDone, onCancel, onItems }: { e?: EventRow; h?: HistoryEntry; onDone: () => void; onCancel: () => void; /** a meal with items: change them one by one instead */ onItems?: () => void }) {
  const { me, settings, reload, products } = useData();
  const quick = useQuickItems();
  const unit = settings.glucose_unit;
  // a carbs-only entry can be given a name and nutrition: it is then edited (and saved) as a food entry
  const [asMeal, setAsMeal] = useState(false);
  const kind = h || asMeal ? 'meal' : e!.kind;
  const food = !!h || asMeal;
  const [whenMs, setWhenMs] = useState(Date.parse(h ? h.eaten_at : e!.occurred_at));
  const [units, setUnits] = useState<number | null>(e?.insulin_units ?? null);
  const [carbs, setCarbs] = useState<number | null>(h ? h.total_carbs : e?.carbs_g ?? null);
  const [bg, setBg] = useState<number | null>(e?.bg_mgdl ? Number(formatGlucose(e.bg_mgdl, unit)) : null);
  const [minutes, setMinutes] = useState<number | null>(e?.activity_min ?? null);
  const [name, setName] = useState(h?.name ?? '');
  const [note, setNote] = useState((h ? h.notes : e!.note) ?? '');
  const [brand, setBrand] = useState(h?.brand ?? '');
  const [n, setN] = useState<NutrState>(() => nutrStateFrom({ carbs: h?.total_carbs ?? e?.carbs_g ?? null, fat: h?.total_fat ?? null, protein: h?.total_protein ?? null, fiber: h?.total_fiber ?? null, kcal: h?.total_kcal ?? null }));
  // how much of it she ate: the values as they were before choosing (or as last typed) times the part
  const [base, setBase] = useState<NutrState>(n);
  const [part, setPart] = useState(1);
  const typeIn = (v: NutrState) => { setN(v); setBase(v); setPart(1); };
  const eat = (f: number) => { setPart(f); setN(scaled(base, f)); };
  const tot = totalsOf(n);
  const inQuick = !!h && quick.items.some((q) => q.name === h.name);
  const [toQuick, setToQuick] = useState<boolean | null>(null);           // null: follow the default below
  // a part portion is not what the frequent food is: it is not saved there unless asked
  const keep = toQuick ?? (asMeal || part !== 1 ? false : inQuick || !!brand.trim());                    // a branded product is worth keeping one tap away
  const brands = brandsOf([...quick.items, ...products.map((p) => ({ brand: p.brand }))]);
  const [busy, setBusy] = useState(false);
  const draft: EditDraft = { t: whenMs, units, carbs, bg: bg === null ? null : toMgdl(bg, unit), minutes, name, note, ...(food ? { carbs: tot.carbs, brand, fat: tot.fat, protein: tot.protein, fiber: tot.fiber, kcal: tot.kcal, toQuick: keep, part: part !== 1 ? part : undefined,
    label: n.mode === 'per100' ? { per100: n.per100, amount: n.amount, unit: n.unit } : null } : {}) };
  // a meal eaten out with its carbs not known can keep them unknown (its time or name can still change)
  const unknownOk = !!h && h.total_carbs === null && tot.carbs === null;
  const np = food && !unknownOk ? nutrProblem(n) : null;
  const problem: EditProblem | null = np ? (np === 'carbs' ? 'carbs' : 'nutrition') : editProblem(kind, draft, Date.now(), unknownOk);

  const save = async () => {
    if (problem) return;
    setBusy(true);
    try {
      if (h) await updateMeal(h, draft, me); else if (asMeal) await carbsToMeal(e!, draft, me); else await updateEvent(e!, draft, me);
      await reload(); toast(t('تم التعديل ✓')); onDone();
    } catch (x) { toast((x as Error).message); } finally { setBusy(false); }
  };

  // compact: the whole form fits one phone screen (short labels, the five nutrition values in one row)
  const box = 'block w-full min-w-0 max-w-full appearance-none rounded-xl border border-slate-200 bg-white px-2.5 py-1.5 min-h-[40px] text-base outline-none focus:border-brand focus:ring-2 focus:ring-brand-soft';
  const num = '!min-h-[40px] !rounded-xl !px-1 !py-1.5 !text-center';
  const others = brands.filter((b) => b.toLowerCase() !== brand.trim().toLowerCase()).slice(0, 8);
  return (
    <div className="space-y-2.5">
      {onItems && <button type="button" onClick={onItems} className="flex min-h-[44px] w-full items-center justify-between rounded-xl bg-brand-soft px-3 text-sm font-bold text-brand">{t('تعديل الأصناف والكميات')}<span>{isEn() ? '›' : '‹'}</span></button>}
      <TimePicker value={whenMs} onChange={setWhenMs} />
      {kind === 'meal' && (
        <div className="grid grid-cols-[3fr_2fr] gap-2">
          <L label={t('الاسم')}><input className={box} dir="auto" value={name} maxLength={120} onChange={(x) => setName(x.target.value)} /></L>
          <L label={t('البراند')}>
            <input className={box} dir="auto" list="brand-list" value={brand} maxLength={60} onChange={(x) => setBrand(x.target.value)} />
            <datalist id="brand-list">{brands.map((b) => <option key={b} value={b} />)}</datalist>
          </L>
        </div>
      )}
      {kind === 'meal' && others.length > 0 && (
        <div className="-mx-4 -mt-1 flex gap-1.5 overflow-x-auto px-4">
          {others.map((b) => <button key={b} type="button" onClick={() => setBrand(b)} className="h-7 shrink-0 rounded-full bg-slate-50 px-2.5 text-xs text-slate-600"><bdi>{b}</bdi></button>)}
        </div>
      )}
      {kind === 'insulin' && <L label={e?.insulin_type === 'long' ? t('وحدات الإنسولين الطويل') : t('وحدات الإنسولين السريع')}><NumInput className={num} value={units} onChange={setUnits} /></L>}
      {kind === 'meal' && <NutritionFields s={n} set={typeIn} />}
      {kind === 'meal' && (
        <div className="flex items-center gap-1.5">
          <span className="shrink-0 text-sm text-slate-600">{t('أكلت:')}</span>
          <div className="flex min-w-0 flex-1 gap-1">
            {PARTS.map(([f, l]) => (
              <button key={f} type="button" onClick={() => eat(f)} aria-pressed={part === f}
                className={cx('min-h-[36px] flex-1 rounded-lg text-sm font-bold', part === f ? 'bg-brand text-white' : 'bg-slate-50 text-slate-600')}>{l()}</button>
            ))}
          </div>
        </div>
      )}
      {kind === 'meal' && (h?.lines.length ?? 0) > 1 && <p className="-mt-1 text-[11px] text-slate-500">{t('وجبة من عدة أصناف: أزرار «أكلت» تغيّر كل الأصناف، والكتابة تغيّر المجموع فقط.')}</p>}
      {(kind === 'carbs' || kind === 'treatment') && <L label={t('الكارب (غ)')}><NumInput className={num} value={carbs} onChange={setCarbs} /></L>}
      {kind === 'carbs' && (
        <button type="button" onClick={() => { setN(nutrStateFrom({ carbs, fat: null, protein: null, fiber: null, kcal: null })); setAsMeal(true); }}
          className="-mt-1 min-h-[40px] text-sm font-bold text-brand">{t('+ اسم وقيم غذائية (دهون، بروتين…)')}</button>
      )}
      {asMeal && <p className="-mt-1 text-[11px] text-slate-500">{t('يُحفظ كأكل باسمه وقيمه بدل «كارب» فقط، في نفس الوقت.')}</p>}
      {kind === 'bg_check' && <L label={t('وخز الإصبع ({unit})', { unit: unitLabel(unit) })}><NumInput className={num} value={bg} onChange={setBg} /></L>}
      {kind === 'exercise' && <L label={t('المدة (دقيقة)')}><NumInput className={num} value={minutes} onChange={setMinutes} /></L>}
      {kind !== 'note' && <L label={t('ملاحظة')}><input className={box} dir="auto" value={note} maxLength={300} onChange={(x) => setNote(x.target.value)} /></L>}
      {kind === 'note' && <L label={t('الملاحظة')}><textarea className={box} dir="auto" rows={3} value={note} maxLength={500} onChange={(x) => setNote(x.target.value)} /></L>}
      {kind === 'meal' && (
        <label className="flex min-h-[44px] items-center justify-between gap-3 rounded-xl bg-slate-50 px-3 py-1.5">
          <span className="text-sm font-medium">{inQuick ? t('حدّثه في «أكل متكرر»') : t('أضفه إلى «أكل متكرر»')}</span>
          <Toggle on={keep} onChange={setToQuick} label={t('أكل متكرر')} />
        </label>
      )}
      {problem && problem !== 'time' && <Alert tone="near">{PROBLEM[problem]}</Alert>}
      {/* always in reach: stays at the bottom of the sheet on a small phone and above the keyboard */}
      <div className="sticky bottom-0 -mx-4 grid grid-cols-2 gap-2 border-t border-slate-100 bg-white px-4 pb-1 pt-2 lg:-mx-6 lg:px-6">
        <Btn kind="ghost" onClick={onCancel} disabled={busy}>{t('إلغاء')}</Btn>
        <Btn kind="primary" onClick={save} disabled={busy || !!problem}>{busy ? t('جارٍ الحفظ…') : t('حفظ')}</Btn>
      </div>
    </div>
  );
}

const L = ({ label, children }: { label: string; children: React.ReactNode }) => (
  <label className="block min-w-0"><span className="mb-0.5 block truncate text-xs font-medium text-slate-500">{label}</span>{children}</label>
);
