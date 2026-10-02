import { useState } from 'react';
import { useData } from '../lib/data';
import { editProblem, fromLocalInput, toLocalInput, type EditDraft, type EditProblem } from '../lib/edit';
import { updateEvent, updateMeal } from '../lib/editSave';
import { formatGlucose, toMgdl, unitLabel } from '../lib/glucose';
import type { EventRow, HistoryEntry } from '../lib/types';
import { Alert, Btn, Field, NumInput, inputCls, toast } from './ui';
import { t, tr } from '../i18n';

const PROBLEM: Record<EditProblem, string> = tr({ // i18n-ok: values translated when read
  time: 'اختاروا الوقت', future: 'الوقت في المستقبل', units: 'الوحدات بين 0 و100', carbs: 'الكارب بين 0 و300 غ', // i18n-ok
  bg: 'قيمة الوخز غير معقولة', minutes: 'المدة بين 1 و600 دقيقة', name: 'اكتبوا اسم الوجبة', // i18n-ok
});

/** Change a logged entry: its time, amount and note. The change is recorded (who and when). */
export function EditEntry({ e, h, onDone, onCancel }: { e?: EventRow; h?: HistoryEntry; onDone: () => void; onCancel: () => void }) {
  const { me, settings, reload } = useData();
  const unit = settings.glucose_unit;
  const kind = h ? 'meal' : e!.kind;
  const [when, setWhen] = useState(toLocalInput(Date.parse(h ? h.eaten_at : e!.occurred_at)));
  const [units, setUnits] = useState<number | null>(e?.insulin_units ?? null);
  const [carbs, setCarbs] = useState<number | null>(h ? h.total_carbs : e?.carbs_g ?? null);
  const [bg, setBg] = useState<number | null>(e?.bg_mgdl ? Number(formatGlucose(e.bg_mgdl, unit)) : null);
  const [minutes, setMinutes] = useState<number | null>(e?.activity_min ?? null);
  const [name, setName] = useState(h?.name ?? '');
  const [note, setNote] = useState((h ? h.notes : e!.note) ?? '');
  const [busy, setBusy] = useState(false);
  const draft: EditDraft = { t: fromLocalInput(when), units, carbs, bg: bg === null ? null : toMgdl(bg, unit), minutes, name, note };
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
      {kind === 'insulin' && <Field label={e?.insulin_type === 'long' ? t('وحدات الإنسولين الطويل') : t('وحدات الإنسولين السريع')}><NumInput value={units} onChange={setUnits} /></Field>}
      {(kind === 'meal' || kind === 'carbs' || kind === 'treatment') && (
        <Field label={t('الكارب (غ)')} hint={kind === 'meal' && (h?.lines.length ?? 0) > 1 ? t('هذه وجبة من عدة أصناف: يتغير المجموع فقط وتُعلَّم «معدّلة».') : undefined}>
          <NumInput value={carbs} onChange={setCarbs} />
        </Field>
      )}
      {kind === 'bg_check' && <Field label={t('وخز الإصبع ({unit})', { unit: unitLabel(unit) })}><NumInput value={bg} onChange={setBg} /></Field>}
      {kind === 'exercise' && <Field label={t('المدة (دقيقة)')}><NumInput value={minutes} onChange={setMinutes} /></Field>}
      {kind !== 'note' && <Field label={t('ملاحظة')}><input className={inputCls} dir="auto" value={note} maxLength={300} onChange={(x) => setNote(x.target.value)} /></Field>}
      {kind === 'note' && <Field label={t('الملاحظة')}><textarea className={inputCls} dir="auto" rows={3} value={note} maxLength={500} onChange={(x) => setNote(x.target.value)} /></Field>}
      {problem && problem !== 'time' && <Alert tone="near">{PROBLEM[problem]}</Alert>}
      {(h?.source || e?.source) && <p className="text-xs text-slate-500">{t('مستورد من Gluroo: بعد التعديل يبقى كما عدّلتموه ولا تغيّره أي مزامنة لاحقة.')}</p>}
      <div className="grid grid-cols-2 gap-2">
        <Btn kind="ghost" onClick={onCancel} disabled={busy}>{t('إلغاء')}</Btn>
        <Btn kind="primary" onClick={save} disabled={busy || !!problem}>{busy ? t('جارٍ الحفظ…') : t('حفظ')}</Btn>
      </div>
    </div>
  );
}
