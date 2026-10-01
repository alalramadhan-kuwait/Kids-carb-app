import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { deleteEvent, restoreEvent, saveEvent, type NewEvent } from '../lib/api';
import { findDuplicate, sinceText } from '../lib/now';
import { LEVEL_TEXT, describeEvent, sleepWindow } from '../lib/events';
import type { EventKind } from '../lib/types';
import { Icon } from './Icon';
import type { IconName } from '../icons/defs';
import { Alert, Btn, Field, NumInput, Sheet, cx, inputCls, toast } from './ui';

const KINDS: { kind: EventKind; label: string; icon: IconName }[] = [
  { kind: 'insulin', label: 'إنسولين', icon: 'insulin' },
  { kind: 'carbs', label: 'كارب', icon: 'carbs' },
  { kind: 'treatment', label: 'علاج انخفاض', icon: 'treatment' },
  { kind: 'note', label: 'ملاحظة', icon: 'note' },
  { kind: 'exercise', label: 'رياضة', icon: 'activity' },
  { kind: 'sleep', label: 'نوم', icon: 'moon' },
];
const KW = 3 * 3600000;
const hhmm = (t: number) => { const d = new Date(t + KW); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
// in the morning "woke up" is now; later in the day the likely entry is last night's sleep
const wakeDefault = () => (new Date(Date.now() + KW).getUTCHours() < 12 ? hhmm(Date.now()) : '06:30');
const AGO = [0, 15, 30, 60];

/** "سجّل": insulin, carbs, hypo treatment or a note — logging only, never a suggestion. */
export function LogSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { events, me, nameOf, reload } = useData();
  const [kind, setKind] = useState<EventKind | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [units, setUnits] = useState<number | null>(null);
  const [type, setType] = useState<'rapid' | 'long'>('rapid');
  const [purpose, setPurpose] = useState<'meal' | 'correction' | 'both' | null>(null);
  const [grams, setGrams] = useState<number | null>(null);
  const [treat, setTreat] = useState('عصير');
  const [note, setNote] = useState('');
  const [mins, setMins] = useState<number | null>(null);
  const [level, setLevel] = useState<'light' | 'moderate' | 'hard'>('moderate');
  const [sleepFrom, setSleepFrom] = useState('21:00');
  const [sleepTo, setSleepTo] = useState(wakeDefault);
  const [ago, setAgo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dupAck, setDupAck] = useState(false);

  const reset = () => {
    setKind(null); setClientId(crypto.randomUUID()); setUnits(null); setType('rapid'); setPurpose(null);
    setGrams(null); setTreat('عصير'); setNote(''); setAgo(0); setDupAck(false); setMins(null); setLevel('moderate'); setSleepFrom('21:00'); setSleepTo(wakeDefault());
  };
  const close = () => { reset(); onClose(); };

  const draft: NewEvent | null = useMemo(() => {
    if (!kind) return null;
    const sleep = kind === 'sleep' ? sleepWindow(sleepFrom, sleepTo) : null;
    const occurred_at = sleep ? sleep.occurred_at : new Date(Date.now() - ago * 60000).toISOString();
    return {
      client_id: clientId, kind, occurred_at,
      activity_min: kind === 'exercise' ? mins : null, activity_level: kind === 'exercise' ? level : null,
      ends_at: sleep ? sleep.ends_at : null,
      insulin_units: kind === 'insulin' ? units : null, insulin_type: kind === 'insulin' ? type : null,
      bolus_purpose: kind === 'insulin' && type === 'rapid' ? purpose : null,
      carbs_g: kind === 'carbs' || kind === 'treatment' ? grams : null,
      treatment: kind === 'treatment' ? treat : null, note: note.trim() || null,
    };
  }, [kind, clientId, units, type, purpose, grams, treat, note, ago, mins, level, sleepFrom, sleepTo]);

  const valid = !!draft && (
    (kind === 'insulin' && !!units && units > 0 && units < 100) ||
    ((kind === 'carbs' || kind === 'treatment') && grams !== null && grams >= 0 && grams < 500) ||
    (kind === 'note' && !!note.trim()) ||
    (kind === 'exercise' && !!mins && mins > 0 && mins <= 600) ||
    (kind === 'sleep' && !!draft.ends_at && sleepWindow(sleepFrom, sleepTo).minutes <= 16 * 60));
  const dup = draft && valid ? findDuplicate(events, draft) : null;

  const save = async () => {
    if (!draft || !valid) return;
    if (dup && !dupAck) return; // the question is on screen
    setBusy(true);
    try {
      const id = await saveEvent(draft);
      await reload();
      const text = describeEvent(draft);
      close();
      toast(`تم التسجيل: ${text}`, id ? { label: 'تراجع', run: async () => { await deleteEvent(id, me); await reload(); toast('أُلغي التسجيل', { label: 'إعادة', run: async () => { await restoreEvent(id); await reload(); } }); } } : undefined);
    } catch (e) { toast('تعذّر الحفظ: ' + (e as Error).message); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={close} title={kind ? KINDS.find((k) => k.kind === kind)!.label : 'سجّل'}>
      {!kind ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {KINDS.map((k) => (
              <button key={k.kind} onClick={() => setKind(k.kind)} className="flex min-h-[88px] flex-col items-center justify-center gap-2 rounded-2xl bg-brand-soft text-brand">
                <Icon name={k.icon} size={30} /><span className="font-bold">{k.label}</span>
              </button>
            ))}
          </div>
          <Link to="/meals" onClick={close} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white font-medium ring-1 ring-slate-200">
            <Icon name="meals" size={22} /> وجبة من الوصفات
          </Link>
        </div>
      ) : (
        <div className="space-y-4">
          {kind === 'insulin' && <>
            <Field label="عدد الوحدات"><NumInput value={units} onChange={setUnits} className="!min-h-[60px] !text-center !text-3xl font-bold" autoFocus /></Field>
            <Seg value={type} onChange={(v) => setType(v as 'rapid' | 'long')} options={[['rapid', 'سريع المفعول'], ['long', 'طويل المفعول']]} />
            {type === 'rapid' && <Seg value={purpose ?? ''} onChange={(v) => setPurpose((v || null) as typeof purpose)} options={[['meal', 'لوجبة'], ['correction', 'تصحيح'], ['both', 'الاثنين']]} allowNone />}
            {units !== null && units > 20 && <Alert tone="near">رقم كبير. تأكد أنه صحيح قبل الحفظ.</Alert>}
          </>}
          {(kind === 'carbs' || kind === 'treatment') && <>
            <Field label="الكارب (غرام)"><NumInput value={grams} onChange={setGrams} className="!min-h-[60px] !text-center !text-3xl font-bold" autoFocus /></Field>
            {kind === 'treatment' && <Seg value={treat} onChange={setTreat} options={[['عصير', 'عصير'], ['أقراص جلوكوز', 'أقراص'], ['أخرى', 'أخرى']]} />}
          </>}
          {kind === 'exercise' && <>
            <Field label="المدة (دقائق)"><NumInput value={mins} onChange={setMins} className="!min-h-[60px] !text-center !text-3xl font-bold" autoFocus /></Field>
            <Seg value={level} onChange={(v) => setLevel(v as typeof level)} options={(['light', 'moderate', 'hard'] as const).map((l) => [l, LEVEL_TEXT[l]])} />
          </>}
          {kind === 'sleep' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label="نامت"><input type="time" dir="ltr" className={inputCls} value={sleepFrom} onChange={(e) => setSleepFrom(e.target.value)} /></Field>
              <Field label="صحت"><input type="time" dir="ltr" className={inputCls} value={sleepTo} onChange={(e) => setSleepTo(e.target.value)} /></Field>
            </div>
          )}
          {kind === 'sleep' && draft && (valid
            ? <p className="-mt-2 text-sm text-slate-600">{describeEvent(draft)}</p>
            : <p className="-mt-2 text-sm text-near">أطول من 16 ساعة. تحقّق من الوقتين.</p>)}
          <Field label={kind === 'note' ? 'الملاحظة' : 'ملاحظة (اختياري)'}>
            <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={kind === 'note' ? 'مثلًا: مريضة، حفلة، تغيير الحساس' : ''} />
          </Field>
          {kind !== 'sleep' && <div>
            <div className="mb-1 text-sm font-medium text-slate-600">{kind === 'exercise' ? 'متى بدأت؟' : 'متى؟'}</div>
            <Seg value={String(ago)} onChange={(v) => setAgo(Number(v))} options={AGO.map((m) => [String(m), m === 0 ? 'الآن' : m === 60 ? 'قبل ساعة' : `قبل ${m} د`])} />
          </div>}
          {dup && !dupAck && (
            <Alert tone="near">
              <div className="space-y-2">
                <div><b>{nameOf(dup.created_by)}</b> سجّل {describeEvent(dup)} {sinceText(dup.occurred_at)}. هل هذا نفس التسجيل؟</div>
                <div className="grid grid-cols-2 gap-2">
                  <Btn kind="ghost" onClick={close}>نعم، لا تسجّل</Btn>
                  <Btn onClick={() => setDupAck(true)}>لا، تسجيل جديد</Btn>
                </div>
              </div>
            </Alert>
          )}
          <div className="grid grid-cols-[1fr_2fr] gap-2">
            <Btn kind="ghost" onClick={reset}>رجوع</Btn>
            <Btn kind="primary" className="min-h-[52px]" disabled={!valid || busy || (!!dup && !dupAck)} onClick={save}>حفظ</Btn>
          </div>
        </div>
      )}
    </Sheet>
  );
}

function Seg({ value, onChange, options, allowNone }: { value: string; onChange: (v: string) => void; options: [string, string][]; allowNone?: boolean }) {
  return (
    <div className="flex gap-2" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(allowNone && value === v ? '' : v)}
          className={cx('min-h-[44px] flex-1 rounded-xl px-2 text-sm font-medium', value === v ? 'bg-brand text-white' : 'bg-white ring-1 ring-slate-200')}>
          {l}
        </button>
      ))}
    </div>
  );
}
