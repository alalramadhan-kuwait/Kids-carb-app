import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { deleteEvent, restoreEvent, saveEvent, type NewEvent } from '../lib/api';
import { findDuplicate, sinceText } from '../lib/now';
import { LEVEL_TEXT, describeEvent, sleepWindow } from '../lib/events';
import type { EventKind } from '../lib/types';
import { Icon } from './Icon';
import type { IconName } from '../icons/defs';
import { Alert, Btn, Chip, Field, NumInput, Sheet, cx, inputCls, toast } from './ui';
import { t, tMaybe } from '../i18n';
import { KIND_STYLE } from '../lib/kinds';
import { DoseCalculator } from './DoseCalculator';
import { logQuick, useQuickItems } from '../lib/quick';
import { brandsOf, sameBrand } from '../lib/brand';
import { ProductForm } from './ProductForm';
import type { QuickItem } from '../lib/quick';
import { deleteHistory } from '../lib/api';
import { startComparison, syncComparisons } from '../lib/fingerprick';
import { toMgdl, unitLabel } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import type { DoseCalc } from '../lib/types';

const KINDS: { kind: EventKind; label: string; icon: IconName }[] = [
  { kind: 'insulin', label: 'إنسولين', icon: 'insulin' }, // i18n-ok
  { kind: 'carbs', label: 'كارب', icon: 'carbs' }, // i18n-ok
  { kind: 'treatment', label: 'علاج انخفاض', icon: 'treatment' }, // i18n-ok
  { kind: 'note', label: 'ملاحظة', icon: 'note' }, // i18n-ok
  { kind: 'exercise', label: 'رياضة', icon: 'activity' }, // i18n-ok
  { kind: 'sleep', label: 'نوم', icon: 'moon' }, // i18n-ok
  { kind: 'bg_check', label: 'وخز إصبع', icon: 'glucose' }, // i18n-ok
];
const KW = 3 * 3600000;
const hhmm = (t: number) => { const d = new Date(t + KW); return `${String(d.getUTCHours()).padStart(2, '0')}:${String(d.getUTCMinutes()).padStart(2, '0')}`; };
// in the morning "woke up" is now; later in the day the likely entry is last night's sleep
const wakeDefault = () => (new Date(Date.now() + KW).getUTCHours() < 12 ? hhmm(Date.now()) : '06:30');
const AGO = [0, 15, 30, 60];

/** "سجّل": insulin, carbs, hypo treatment or a note. Rapid insulin shows the dose calculator (doctor's plan); the parent confirms. */
export function LogSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { events, me, nameOf, reload, settings, history } = useData();
  const [kind, setKind] = useState<EventKind | null>(null);
  const [clientId, setClientId] = useState(() => crypto.randomUUID());
  const [units, setUnits] = useState<number | null>(null);
  const [type, setType] = useState<'rapid' | 'long'>('rapid');
  const [purpose, setPurpose] = useState<'meal' | 'correction' | 'both' | null>(null);
  const [grams, setGrams] = useState<number | null>(null);
  const [treat, setTreat] = useState('عصير'); // i18n-ok: stored value
  const [note, setNote] = useState('');
  const [mins, setMins] = useState<number | null>(null);
  const [level, setLevel] = useState<'light' | 'moderate' | 'hard'>('moderate');
  const [sleepFrom, setSleepFrom] = useState('21:00');
  const [sleepTo, setSleepTo] = useState(wakeDefault);
  const [ago, setAgo] = useState(0);
  const [busy, setBusy] = useState(false);
  const [dupAck, setDupAck] = useState(false);
  const [calc, setCalc] = useState<DoseCalc | null>(null);
  const [bg, setBg] = useState<number | null>(null);          // finger-prick, in the family's unit
  const [clean, setClean] = useState(true);                     // hands washed and dried
  const quick = useQuickItems();
  const [brandPick, setBrandPick] = useState<string | null>(null);
  const [newProduct, setNewProduct] = useState(false);              // entering a product from the box in hand   // frequent foods of one brand only
  const brands = useMemo(() => brandsOf(quick.items), [quick.items]);
  const quickShown = brandPick ? quick.items.filter((q) => sameBrand(q.brand, brandPick)) : quick.items.slice(0, 10);

  const reset = () => {
    setKind(null); setClientId(crypto.randomUUID()); setUnits(null); setType('rapid'); setPurpose(null);
    setGrams(null); setTreat('عصير'); /* i18n-ok */ setNote(''); setAgo(0); setDupAck(false); setMins(null); setLevel('moderate'); setSleepFrom('21:00'); setSleepTo(wakeDefault()); setCalc(null); setBg(null); setClean(true);
  };
  const close = () => { reset(); setBrandPick(null); setNewProduct(false); onClose(); };

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
      dose_calc: kind === 'insulin' && type === 'rapid' ? calc : null,
      bg_mgdl: kind === 'bg_check' && bg !== null ? toMgdl(bg, settings.glucose_unit) : null,
    };
  }, [kind, clientId, units, type, purpose, grams, treat, note, ago, mins, level, sleepFrom, sleepTo, calc, bg, settings.glucose_unit]);

  const valid = !!draft && (
    (kind === 'insulin' && !!units && units > 0 && units < 100) ||
    ((kind === 'carbs' || kind === 'treatment') && grams !== null && grams >= 0 && grams < 500) ||
    (kind === 'note' && !!note.trim()) ||
    (kind === 'bg_check' && !!draft.bg_mgdl && draft.bg_mgdl >= 20 && draft.bg_mgdl <= 600) ||
    (kind === 'exercise' && !!mins && mins > 0 && mins <= 600) ||
    (kind === 'sleep' && !!draft.ends_at && sleepWindow(sleepFrom, sleepTo).minutes <= 16 * 60));
  const dup = draft && valid ? findDuplicate(events, draft) : null;

  const save = async () => {
    if (!draft || !valid) return;
    if (dup && !dupAck) return; // the question is on screen
    setBusy(true);
    try {
      const id = await saveEvent(draft);
      // a finger-prick starts its comparison with Libre now; the +5 and +10 min readings complete it later
      if (id && draft.kind === 'bg_check' && draft.bg_mgdl) { await startComparison(id, Date.parse(draft.occurred_at), draft.bg_mgdl, ago, clean); void syncComparisons(events, history); }
      await reload();
      const text = describeEvent(draft);
      close();
      toast(t('تم التسجيل: {x}', { x: text }), id ? { label: t('تراجع'), run: async () => { await deleteEvent(id, me); await reload(); toast(t('أُلغي التسجيل'), { label: t('إعادة'), run: async () => { await restoreEvent(id); await reload(); } }); } } : undefined);
    } catch (e) { toast(t('تعذّر الحفظ: {e}', { e: (e as Error).message })); } finally { setBusy(false); }
  };

  return (
    <Sheet open={open} onClose={close} title={newProduct ? t('منتج جديد') : kind ? t(KINDS.find((k) => k.kind === kind)!.label) : t('سجّل')}>
      {newProduct ? (
        <ProductForm q={null} brands={brands} onDone={() => { setNewProduct(false); void quick.reload(); }} onLog={async (q: QuickItem) => {
          const id = await logQuick(q); await reload(); void quick.reload(); close();
          toast(t('تم التسجيل: {x}', { x: `${tMaybe(q.name)} · ${t('{g} غ', { g: fmt(q.carbs) })}` }), { label: t('تراجع'), run: async () => { await deleteHistory(id); await reload(); } });
        }} />
      ) : !kind ? (
        <div className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            {KINDS.map((k) => (
              <button key={k.kind} onClick={() => setKind(k.kind)} className={cx('flex min-h-[80px] flex-col items-center justify-center gap-1.5 rounded-2xl', KIND_STYLE[k.kind].soft)}>
                <Icon name={k.icon} size={26} /><span className="text-sm font-bold">{t(k.label)}</span>
              </button>
            ))}
          </div>
          {/* foods she has often: one tap logs the usual amount (undo in the toast) */}
          {(
            <div>
              <div className="mb-1 flex items-center justify-between gap-2">
                <span className="text-sm font-medium text-slate-600">{t('أكل متكرر')}</span>
                <button onClick={() => setNewProduct(true)} className="min-h-[36px] text-sm font-bold text-brand">{t('+ منتج جديد')}</button>
              </div>
              {brands.length > 0 && (
                <div className="-mx-4 mb-2 flex gap-1.5 overflow-x-auto px-4">
                  <Chip active={!brandPick} onClick={() => setBrandPick(null)}>{t('الأكثر')}</Chip>
                  {brands.map((b) => <Chip key={b} active={sameBrand(brandPick, b)} onClick={() => setBrandPick(b)}><bdi>{b}</bdi></Chip>)}
                </div>
              )}
              <div className={cx('-mx-4 flex gap-2 px-4 pb-1', brandPick ? 'flex-wrap' : 'overflow-x-auto')}>
                {quickShown.map((q) => (
                  <button key={q.id} disabled={busy} className={cx('flex min-h-[44px] shrink-0 items-center gap-1.5 rounded-full px-3.5 text-sm font-medium', KIND_STYLE.meal.soft)}
                    onClick={async () => {
                      setBusy(true);
                      try {
                        const id = await logQuick(q); await reload(); void quick.reload(); close();
                        toast(t('تم التسجيل: {x}', { x: `${tMaybe(q.name)} · ${t('{g} غ', { g: fmt(q.carbs) })}` }), { label: t('تراجع'), run: async () => { await deleteHistory(id); await reload(); } });
                      } catch (e) { toast(t('تعذّر الحفظ: {e}', { e: (e as Error).message })); } finally { setBusy(false); }
                    }}>
                    <bdi>{tMaybe(q.name)}</bdi><span className="num opacity-70">{fmt(q.carbs)}</span>
                  </button>
                ))}
              </div>
            </div>
          )}
          <div className="grid grid-cols-2 gap-2">
            <Link to="/scan" onClick={close} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white font-medium ring-1 ring-slate-200">
              <Icon name="camera" size={22} /> {t('صوّر الأكل')}
            </Link>
            <Link to="/meals" onClick={close} className="flex min-h-[52px] items-center justify-center gap-2 rounded-2xl bg-white font-medium ring-1 ring-slate-200">
              <Icon name="meals" size={22} /> {t('من الوصفات')}
            </Link>
          </div>
        </div>
      ) : (
        <div className="space-y-3">
          {/* the value and its save button share one row, so saving never hides under the keyboard */}
          {kind !== 'sleep' && (
            <div className="flex items-end gap-2">
              <div className="min-w-0 flex-1">
                <div className="mb-1 text-sm font-medium text-slate-600">{kind === 'insulin' ? t('عدد الوحدات') : kind === 'exercise' ? t('المدة (دقائق)') : kind === 'note' ? t('الملاحظة') : kind === 'bg_check' ? t('السكر بالوخز ({unit})', { unit: unitLabel(settings.glucose_unit) }) : t('الكارب (غرام)')}</div>
                {kind === 'note'
                  ? <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلًا: مريضة، حفلة، تغيير الحساس')} autoFocus />
                  : <NumInput value={kind === 'insulin' ? units : kind === 'exercise' ? mins : kind === 'bg_check' ? bg : grams} onChange={kind === 'insulin' ? setUnits : kind === 'exercise' ? setMins : kind === 'bg_check' ? setBg : setGrams}
                      className="!min-h-[56px] !text-center !text-3xl font-bold" autoFocus={kind !== 'insulin'} />}
              </div>
              <Btn kind="primary" className={cx('min-h-[56px] shrink-0 !px-5', KIND_STYLE[kind].solid)} disabled={!valid || busy || (!!dup && !dupAck)} onClick={save}>{t('حفظ')}</Btn>
            </div>
          )}
          {kind === 'bg_check' && (
            <div>
              <div className="mb-1 text-sm font-medium text-slate-600">{t('اليدان مغسولتان وجافتان؟')}</div>
              <Seg on={KIND_STYLE.bg_check.solid} value={clean ? 'y' : 'n'} onChange={(v) => setClean(v === 'y')} options={[['y', t('نعم')], ['n', t('لم تُغسل')]]} />
              <p className="mt-1.5 text-xs text-slate-500">{t('للمقارنة مع الحساس فقط: لا يغيّر قراءة Libre ولا الجرعة.')}</p>
            </div>
          )}
          {kind !== 'sleep' && kind !== 'note' && kind !== 'bg_check' && (
            <Steps tone={KIND_STYLE[kind].soft} steps={kind === 'insulin' ? (settings.pen_step === 1 ? [2, 1] : [1, 0.5]) : kind === 'exercise' ? [15, 5] : [5, 1]}
              value={kind === 'insulin' ? units : kind === 'exercise' ? mins : grams} onChange={kind === 'insulin' ? setUnits : kind === 'exercise' ? setMins : setGrams} />
          )}
          {kind === 'insulin' && <>
            <Seg on={KIND_STYLE[kind!].solid} value={type} onChange={(v) => setType(v as 'rapid' | 'long')} options={[['rapid', t('سريع المفعول')], ['long', t('طويل المفعول')]]} />
            {type === 'rapid' && <Seg on={KIND_STYLE[kind!].solid} value={purpose ?? ''} onChange={(v) => setPurpose((v || null) as typeof purpose)} options={[['meal', t('لوجبة')], ['correction', t('تصحيح')], ['both', t('الاثنين')]]} allowNone />}
            {type === 'rapid' && ago === 0 && <DoseCalculator onUse={(u, p, c) => { setUnits(u); setPurpose(p); setCalc(c); }} />}
            {units !== null && units > 20 && <Alert tone="near">{t('رقم كبير. تأكد أنه صحيح قبل الحفظ.')}</Alert>}
          </>}
          {kind === 'treatment' && <Seg on={KIND_STYLE[kind!].solid} value={treat} onChange={setTreat} options={[['عصير', t('عصير')], ['أقراص جلوكوز', t('أقراص')], ['أخرى', t('أخرى')]]} /* i18n-ok: stored values */ />}
          {kind === 'exercise' && <Seg on={KIND_STYLE[kind!].solid} value={level} onChange={(v) => setLevel(v as typeof level)} options={(['light', 'moderate', 'hard'] as const).map((l) => [l, LEVEL_TEXT[l]])} />}
          {kind === 'sleep' && (
            <div className="grid grid-cols-2 gap-3">
              <Field label={t('نامت')}><input type="time" dir="ltr" className={inputCls} value={sleepFrom} onChange={(e) => setSleepFrom(e.target.value)} /></Field>
              <Field label={t('صحت')}><input type="time" dir="ltr" className={inputCls} value={sleepTo} onChange={(e) => setSleepTo(e.target.value)} /></Field>
            </div>
          )}
          {kind === 'sleep' && draft && (valid
            ? <p className="text-sm text-slate-600">{describeEvent(draft)}</p>
            : <p className="text-sm font-medium text-brand">{t('أطول من 16 ساعة. تحقّق من الوقتين.')}</p>)}
          {kind !== 'note' && <input className={inputCls} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('ملاحظة (اختياري)')} />}
          {kind !== 'sleep' && <div>
            <div className="mb-1 text-sm font-medium text-slate-600">{kind === 'exercise' ? t('متى بدأت؟') : t('متى؟')}</div>
            <Seg on={KIND_STYLE[kind!].solid} value={String(ago)} onChange={(v) => setAgo(Number(v))} options={AGO.map((m) => [String(m), m === 0 ? t('الآن') : m === 60 ? t('قبل ساعة') : t('قبل {m} د', { m })])} />
          </div>}
          {dup && !dupAck && (
            <Alert tone="near">
              <div className="space-y-2">
                <div>{t('{who} سجّل {what} {when}. هل هذا نفس التسجيل؟', { who: nameOf(dup.created_by), what: describeEvent(dup), when: sinceText(dup.occurred_at) })}</div>
                <div className="grid grid-cols-2 gap-2">
                  <Btn kind="ghost" onClick={close}>{t('نعم، لا تسجّل')}</Btn>
                  <Btn onClick={() => setDupAck(true)}>{t('لا، تسجيل جديد')}</Btn>
                </div>
              </div>
            </Alert>
          )}
          {kind === 'sleep'
            ? <div className="grid grid-cols-[1fr_2fr] gap-2"><Btn kind="ghost" onClick={reset}>{t('رجوع')}</Btn><Btn kind="primary" className="min-h-[52px]" disabled={!valid || busy} onClick={save}>{t('حفظ')}</Btn></div>
            : <button onClick={reset} className="min-h-[44px] text-sm font-medium text-slate-500">{t('رجوع')}</button>}
        </div>
      )}
    </Sheet>
  );
}

/** Quick adjustments, as in other diabetes apps: − big, − small | + small, + big. Never below zero. */
function Steps({ steps, value, onChange, tone }: { steps: [number, number]; value: number | null; onChange: (v: number | null) => void; tone: string }) {
  const [big, small] = steps;
  const add = (d: number) => onChange(Math.max(0, Math.round(((value ?? 0) + d) * 100) / 100));
  const b = (d: number) => (
    <button key={d} onPointerDown={(e) => e.preventDefault()} onClick={() => add(d)} className={cx('min-h-[44px] flex-1 rounded-xl text-sm font-bold active:opacity-80', tone)} dir="ltr">
      <span className="num">{d > 0 ? '+' : '−'}{Math.abs(d)}</span>
    </button>
  );
  return <div className="flex gap-1.5" dir="ltr">{b(-big)}{b(-small)}{b(small)}{b(big)}</div>;
}

function Seg({ value, onChange, options, allowNone, on }: { value: string; onChange: (v: string) => void; options: [string, string][]; allowNone?: boolean; on?: string }) {
  return (
    <div className="flex gap-2" role="radiogroup">
      {options.map(([v, l]) => (
        <button key={v} role="radio" aria-checked={value === v} onClick={() => onChange(allowNone && value === v ? '' : v)}
          className={cx('min-h-[44px] flex-1 rounded-xl px-2 text-sm font-medium', value === v ? (on ?? 'bg-brand text-white') : 'bg-white ring-1 ring-slate-200')}>
          {l}
        </button>
      ))}
    </div>
  );
}
