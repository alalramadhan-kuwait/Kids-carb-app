import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useData } from '../lib/data';
import { decide, existingFrom, importGluroo, loadEntries, preview, readGlurooFile, type ImportResult, type Preview, type StoredEntry } from '../lib/importGluroo';
import { GLUROO_SENDERS, derive, type EntryStatus, type ImportEntry } from '../lib/gluroo';
import { fmt } from '../lib/carbs';
import { Alert, Btn, Card, Chip, Page, Sheet, cx, toast } from '../components/ui';
import { locale, t, tMaybe, tr } from '../i18n';

const when = (ms: number) => new Date(ms).toLocaleString(locale(), { weekday: 'short', day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
const STATUS: Record<EntryStatus, string> = tr({ // i18n-ok: values translated when read
  accepted: 'مقبول', probable_duplicate: 'مكرر غالبًا', replaced: 'استُبدل بتقدير لاحق', low_treatment: 'علاج انخفاض', uncertain: 'غير مؤكد', info: 'معلومة فقط', // i18n-ok
});
const REASON: Record<string, string> = tr({ // i18n-ok: values translated when read
  identical_repeat: 'نفس النص والكمية مرة ثانية خلال 10 دقائق', // i18n-ok
  later_estimate: 'نفس الأكل بكمية مختلفة خلال 30 دقيقة (تقدير مصحَّح)', // i18n-ok
  same_food_again: 'نفس الأكل والكمية بعد 10–30 دقيقة: مكرر أم حصة ثانية؟', // i18n-ok
  other_parent_same_food: 'نفس الأكل من الوالد الآخر خلال ساعة: نفس الطبق أم أكل منفصل؟', // i18n-ok
  second_basal: 'تريسيبا مرة ثانية خلال ساعتين من شخص آخر: جرعة واحدة أم جرعتان؟', // i18n-ok
  already_in_app: 'مسجّل في التطبيق', // i18n-ok
  juice_while_low: 'عصير 20 غ أو أقل والسكر تحت 4.4', // i18n-ok
  intervention: 'علاج من Gluroo', // i18n-ok
});
const TONE: Record<EntryStatus, string> = {
  accepted: 'bg-slate-100 text-slate-700', probable_duplicate: 'bg-slate-100 text-slate-500', replaced: 'bg-slate-100 text-slate-500',
  low_treatment: 'bg-over-soft text-over', uncertain: 'bg-near-soft text-near', info: 'bg-slate-100 text-slate-400',
};
const label = (e: ImportEntry) =>
  e.food_name ? `${tMaybe(e.food_name)} · ${fmt(e.carbs)} ${t('غ')}`
  : e.type === 'DOSE_INSULIN' ? t('{u} وحدة سريع', { u: fmt(e.units) })
  : e.type.startsWith('DOSE_BASAL') ? t('تريسيبا {u} وحدة', { u: fmt(e.units) })
  : e.type === 'BGL_FP_READING' ? t('وخز إصبع {v}', { v: e.raw.text?.replace(/^Fingerprick of /, '') ?? '' })
  : e.raw.text?.slice(0, 60) || e.type;

/**
 * استيراد من Gluroo. Every exported entry is kept with the importer's decision; nothing is thrown away. Undecided
 * entries come first for the parents; any decision can be changed later, and the cleaned meals follow at once.
 */
export default function ImportPage() {
  const nav = useNavigate();
  const { events, history, reload } = useData();
  const file = useRef<HTMLInputElement>(null);
  const [plan, setPlan] = useState<Preview | null>(null);
  const [err, setErr] = useState('');
  const [step, setStep] = useState<string | null>(null);
  const [done, setDone] = useState<ImportResult | null>(null);
  const [stored, setStored] = useState<StoredEntry[] | null>(null);
  const refresh = () => loadEntries().then(setStored).catch(() => setStored([]));
  useEffect(() => { void refresh(); }, []);

  const pick = async (f: File | undefined) => {
    if (!f) return;
    setErr(''); setPlan(null); setDone(null);
    try { setPlan(preview(await readGlurooFile(f), existingFrom(events, history))); }
    catch (e) { setErr((e as Error).message === 'not_gluroo' || (e as Error).message === 'no_csv' ? t('هذا ليس ملف تصدير من Gluroo.') : (e as Error).message); }
  };
  const run = async () => {
    if (!plan) return;
    try { const r = await importGluroo(plan, setStep); setDone(r); setPlan(null); await reload(); await refresh(); toast(t('تم الاستيراد ✓')); }
    catch (e) { setErr((e as Error).message); } finally { setStep(null); }
  };

  return (
    <Page title={t('استيراد من Gluroo')} back={() => nav(-1)}>
      <div className="space-y-4">
        <Card className="space-y-3">
          <p className="text-sm text-slate-600">{t('في Gluroo: القائمة ← تصدير البيانات. اختاروا الملف هنا (zip أو csv). يُحفظ كل سطر كما هو، ومع كل سطر قرار يمكنكم تغييره. الاستيراد مرة ثانية لا يكرر شيئًا ويحتفظ بقراراتكم.')}</p>
          <input ref={file} type="file" accept=".zip,.csv,text/csv,application/zip" className="hidden" onChange={(e) => pick(e.target.files?.[0])} />
          <Btn kind={plan ? 'ghost' : 'primary'} block onClick={() => file.current?.click()}>{plan ? t('اختيار ملف آخر') : t('اختيار ملف التصدير')}</Btn>
          {err && <Alert tone="near">{err}</Alert>}
        </Card>

        {plan && <PlanCard plan={plan} busy={!!step} onImport={run} />}

        {done && (
          <Card className="space-y-1.5">
            <h2 className="font-bold">{t('تم الاستيراد')}</h2>
            <Row label={t('قراءات السكر الجديدة')} value={String(done.readings)} />
            <Row label={t('سطور محفوظة كما هي')} value={String(done.entries)} />
            <Row label={t('وجبات وسناكات')} value={String(done.meals)} />
            <Row label={t('إنسولين ووخز وعلاج')} value={String(done.events)} />
            <Row label={t('أكل متكرر جديد')} value={String(done.quick)} />
            <Link to="/timeline" className="flex min-h-[44px] items-center font-bold text-brand">{t('فتح السجل')}</Link>
          </Card>
        )}

        {stored && stored.length > 0 && <Review entries={stored} onChange={async () => { await refresh(); await reload(); }} />}
      </div>
    </Page>
  );
}

function PlanCard({ plan, busy, onImport }: { plan: Preview; busy: boolean; onImport: () => void }) {
  const d = useMemo(() => derive(plan.entries, plan.readings), [plan]);
  const by = (s: EntryStatus) => plan.entries.filter((e) => e.status === s).length;
  return (
    <>
      <Card className="space-y-2">
        <h2 className="font-bold">{t('في الملف')}</h2>
        <Row label={t('قراءات السكر')} value={String(plan.readings.length)} hint={plan.readings.length ? `${when(plan.readings[0].t)} – ${when(plan.readings[plan.readings.length - 1].t)} · ${t('تُضاف فقط الأوقات التي ليس فيها قراءة')}` : undefined} />
        <Row label={t('سطور التسجيل')} value={String(plan.entries.length)} hint={t('كلها تُحفظ كما هي')} />
        {(['accepted', 'low_treatment', 'replaced', 'probable_duplicate', 'uncertain', 'info'] as EntryStatus[]).map((s) => <Row key={s} label={`· ${STATUS[s]}`} value={String(by(s))} />)}
        <Row label={t('الوجبات بعد التنظيف')} value={String(d.meals.length)} hint={t('ما سُجّل خلال 20 دقيقة يصبح وجبة واحدة')} />
      </Card>
      {by('uncertain') > 0 && <Alert tone="near">{t('{n} سطور غير مؤكدة ستنتظر قراركم بعد الاستيراد، ولا تدخل في الحسابات ولا في البحث حتى تقرروا.', { n: by('uncertain') })}</Alert>}
      <Btn kind="primary" block disabled={busy} onClick={onImport}>{busy ? t('جارٍ الاستيراد…') : t('استيراد')}</Btn>
    </>
  );
}

function Review({ entries, onChange }: { entries: StoredEntry[]; onChange: () => Promise<void> }) {
  const [filter, setFilter] = useState<EntryStatus | 'all'>('uncertain');
  const [open, setOpen] = useState<StoredEntry | null>(null);
  const [busy, setBusy] = useState(false);
  const byKey = useMemo(() => new Map(entries.map((e) => [e.key, e])), [entries]);
  const count = (s: EntryStatus) => entries.filter((e) => e.status === s).length;
  const shown = entries.filter((e) => (filter === 'all' ? e.status !== 'info' : e.status === filter));
  const set = async (e: StoredEntry, s: EntryStatus) => {
    setBusy(true);
    try { await decide(e.id, s); await onChange(); toast(t('تم الحفظ ✓')); setOpen(null); } catch (x) { toast((x as Error).message); } finally { setBusy(false); }
  };
  const chips: (EntryStatus | 'all')[] = ['uncertain', 'all', 'accepted', 'low_treatment', 'replaced', 'probable_duplicate', 'info'];
  return (
    <Card className="space-y-3">
      <h2 className="font-bold">{t('السطور المستوردة')}</h2>
      {count('uncertain') > 0 ? <p className="text-sm font-medium">{t('{n} تحتاج قراركم.', { n: count('uncertain') })}</p> : <p className="text-sm text-slate-600">{t('لا شيء ينتظر قراركم. يمكن تغيير أي قرار من القائمة.')}</p>}
      <div className="-mx-4 flex gap-2 overflow-x-auto px-4">
        {chips.map((c) => <Chip key={c} active={filter === c} onClick={() => setFilter(c)}>{c === 'all' ? t('الكل') : `${STATUS[c]} (${count(c)})`}</Chip>)}
      </div>
      <ul className="divide-y divide-slate-100">
        {shown.map((e) => {
          const rel = e.related_key ? byKey.get(e.related_key) : null;
          return (
            <li key={e.id} className="space-y-1.5 py-2.5">
              <button className="w-full text-start" onClick={() => setOpen(e)}>
                <div className="flex items-baseline justify-between gap-2">
                  <bdi className="min-w-0 truncate font-medium">{label(e)}</bdi>
                  <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs', TONE[e.status])}>{STATUS[e.status]}{e.decided_by === 'parent' ? ' ✓' : ''}</span>
                </div>
                <div className="text-xs text-slate-500">{when(e.t)} · <bdi>{GLUROO_SENDERS[e.sender] ?? e.sender}</bdi>{e.reason && REASON[e.reason] ? ` · ${REASON[e.reason]}` : ''}</div>
                {rel && <div className="text-xs text-slate-500">{t('مقابل: {x} · {when}', { x: label(rel), when: when(rel.t) })}</div>}
              </button>
              {e.status === 'uncertain' && (
                <div className="grid grid-cols-2 gap-2">
                  <Btn kind="ghost" disabled={busy} onClick={() => set(e, 'probable_duplicate')}>{e.reason === 'second_basal' ? t('جرعة واحدة (مكرر)') : t('نفس الأكل (مكرر)')}</Btn>
                  <Btn disabled={busy} onClick={() => set(e, 'accepted')}>{e.reason === 'second_basal' ? t('جرعتان') : t('أكل منفصل (يُضاف)')}</Btn>
                </div>
              )}
            </li>
          );
        })}
      </ul>
      <Sheet open={!!open} onClose={() => setOpen(null)} title={open ? label(open) : ''}>
        {open && (
          <div className="space-y-3">
            <p className="text-sm text-slate-600">{when(open.t)} · <bdi>{GLUROO_SENDERS[open.sender] ?? open.sender}</bdi></p>
            {open.raw.text && <p className="rounded-xl bg-slate-50 p-2.5 text-sm" dir="auto">{open.raw.text}</p>}
            <p className="text-xs text-slate-500">{t('كما في الملف: كارب {g} · دهون {f} · بروتين {p} · {k} سعرة', { g: open.raw.foodG || '—', f: open.raw.foodFat || '—', p: open.raw.foodProtein || '—', k: open.raw.foodCal || '—' })}</p>
            <div className="text-sm font-medium">{t('القرار')}</div>
            <div className="grid grid-cols-2 gap-2">
              {(['accepted', 'probable_duplicate', 'replaced', 'low_treatment', 'uncertain'] as EntryStatus[]).map((s) => (
                <Btn key={s} kind={open.status === s ? 'primary' : 'ghost'} disabled={busy || open.status === s} onClick={() => set(open, s)}>{STATUS[s]}</Btn>
              ))}
            </div>
          </div>
        )}
      </Sheet>
    </Card>
  );
}

function Row({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="min-w-0"><span className="block font-medium">{label}</span>{hint && <span className="block text-xs text-slate-500">{hint}</span>}</span>
      <b className="num shrink-0 text-end">{value}</b>
    </div>
  );
}
