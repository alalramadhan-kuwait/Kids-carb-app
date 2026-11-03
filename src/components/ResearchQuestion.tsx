import { useState } from 'react';
import { useData } from '../lib/data';
import { answerQuestion, skipQuestion, useQuestions, type OpenQuestion } from '../lib/lab';
import { GLUROO_SENDERS } from '../lib/gluroo';
import { formatGlucose, type GlucoseUnit } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import { Btn, cx, inputCls, toast } from './ui';
import { locale, t, tMaybe, tr } from '../i18n';

const when = (ms: number) => new Date(ms).toLocaleString(locale(), { weekday: 'short', hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
export const ANSWERS: Record<string, string> = tr({ // i18n-ok: values translated when read
  food: 'أكلت أو شربت شيئًا لم يُسجَّل', insulin_rise: 'جرعة فاتت أو لم تدخل كاملة', illness: 'مريضة أو متضايقة', sensor_rise: 'الحساس انضغط أو انصدم', // i18n-ok
  activity: 'لعب أو نشاط', insulin_fall: 'إنسولين لم يُسجَّل', not_eaten: 'لم تُكمل الأكل المسجّل', sensor_fall: 'نامت على الحساس أو انضغط', // i18n-ok
  unknown: 'لا أعرف', other: 'شيء آخر', same: 'نفس الطبق (مكرر)', separate: 'أكل منفصل', unsure: 'لا أعرف', // i18n-ok
});
const RISE = ['food', 'insulin_rise', 'illness', 'sensor_rise'], FALL = ['activity', 'insulin_fall', 'not_eaten', 'sensor_fall'];
/** the stored choice (insulin / sensor) from the button's key */
const choiceOf = (k: string) => k.replace(/_(rise|fall)$/, '');
/** the words for a stored answer */
export const answerText = (choice: string, dir?: 'rise' | 'fall') => ANSWERS[dir && (choice === 'insulin' || choice === 'sensor') ? `${choice}_${dir}` : choice] ?? choice;

/**
 * سؤال سريع: only what the data cannot tell (an unexplained movement, or two entries that may be one plate).
 * At most 3 a day, chosen by how much the answer would help; skipping is always fine. Always folded to one teal line
 * («🔬 n research questions»): it opens in place on a tap and folds again with «Hide».
 */
export function ResearchQuestion({ unit }: { unit: GlucoseUnit }) {
  const { me } = useData();
  const { list, reload } = useQuestions();
  const [busy, setBusy] = useState(false);
  const [other, setOther] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const cur = list[0];
  if (!cur) return null;
  const TEAL = 'rounded-2xl border border-teal-500/70 bg-teal-500/10';
  if (!open) return (
    <button onClick={() => setOpen(true)} className={cx(TEAL, 'flex min-h-[48px] w-full items-center gap-2.5 px-3.5 text-start text-sm font-bold text-teal-500')}>
      <span aria-hidden>🔬</span>
      <span className="flex-1">{list.length > 1 ? t('{n} أسئلة للبحث', { n: list.length }) : t('سؤال للبحث')}</span>
      <span className="num rounded-full bg-teal-500 px-2 text-xs font-extrabold text-white">{list.length}</span>
      <span aria-hidden>›</span>
    </button>
  );
  const send = async (choice: string, note = '') => {
    setBusy(true);
    try { await answerQuestion(cur.q, choice, note, me); toast(t('شكرًا، سُجّل للبحث ✓')); setOther(null); await reload(); }
    catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const skip = async () => { setBusy(true); try { await skipQuestion(cur.q); setOther(null); await reload(); } finally { setBusy(false); } };
  const choices = cur.event ? (cur.event.direction === 'rise' ? RISE : FALL) : ['same', 'separate'];

  return (
    <div className={cx(TEAL, 'space-y-3 p-3.5')}>
      <div className="flex items-baseline justify-between gap-2">
        <h2 className="font-bold text-teal-500">🔬 {t('للبحث')}{list.length > 1 ? ` · ${t('{a} من {b}', { a: 1, b: list.length })}` : ''}</h2>
        <button className="min-h-[36px] text-sm font-bold text-teal-500" onClick={() => setOpen(false)}>⌃ {t('إخفاء')}</button>
      </div>
      <Body item={cur} unit={unit} />
      {other === null ? (
        <>
          <div className="grid grid-cols-2 gap-2">
            {choices.map((k) => <Btn key={k} kind="ghost" disabled={busy} onClick={() => send(choiceOf(k))} className="!h-auto min-h-[44px] !border-teal-500/40 py-1.5 text-[13px]">{ANSWERS[k]}</Btn>)}
          </div>
          <div className="grid grid-cols-3 gap-2">
            <Btn kind="ghost" disabled={busy} onClick={() => send(cur.event ? 'unknown' : 'unsure')} className="text-sm">{t('لا أعرف')}</Btn>
            {cur.event && <Btn kind="ghost" disabled={busy} onClick={() => setOther('')} className="text-sm">{t('شيء آخر')}</Btn>}
            <Btn kind="ghost" disabled={busy} onClick={skip} className="text-sm text-slate-500">{t('تخطٍّ')}</Btn>
          </div>
        </>
      ) : (
        <div className="space-y-2">
          <input className={inputCls} value={other} onChange={(e) => setOther(e.target.value)} placeholder={t('ماذا حدث؟')} maxLength={200} autoFocus />
          <div className="grid grid-cols-2 gap-2">
            <Btn kind="ghost" onClick={() => setOther(null)}>{t('رجوع')}</Btn>
            <Btn kind="primary" disabled={busy || !other.trim()} onClick={() => send('other', other.trim())}>{t('حفظ')}</Btn>
          </div>
        </div>
      )}
      <p className="text-xs text-slate-500">{t('يُستخدم الجواب في البحث فقط، ولا يغيّر الجرعات ولا القراءات.')}</p>
    </div>
  );
}

function Body({ item, unit }: { item: OpenQuestion; unit: GlucoseUnit }) {
  const e = item.event, d = item.dup;
  if (e) {
    const v = { from: formatGlucose(e.g_from, unit), to: formatGlucose(e.g_to, unit), x: formatGlucose(Math.abs(e.resid_mgdl), unit), when: when(Date.parse(e.start_at)) };
    return (
      <p className="text-sm">
        {e.direction === 'rise' ? t('{when}: ارتفع السكر من {from} إلى {to}، أكثر بـ {x} مما يفسّره الأكل والإنسولين المسجّلان. هل تعرفون السبب؟', v)
          : t('{when}: نزل السكر من {from} إلى {to}، أكثر بـ {x} مما يفسّره الأكل والإنسولين المسجّلان. هل تعرفون السبب؟', v)}
      </p>
    );
  }
  if (!d) return null;
  const who = (s: string) => GLUROO_SENDERS[s] ?? s;
  return (
    <p className="text-sm">
      {d.other
        ? t('في Gluroo سُجّل «{food}» {g} غ مرتين: {a} ({wa}) و{b} ({wb}). هل هو نفس الطبق أم أكل منفصل؟', { food: tMaybe(d.food_name), g: fmt(d.carbs), a: who(d.sender), wa: when(d.t), b: who(d.other.sender), wb: when(d.other.t) })
        : t('في Gluroo سُجّل «{food}» {g} غ ({when}) قريبًا من مثله. هل هو نفس الطبق أم أكل منفصل؟', { food: tMaybe(d.food_name), g: fmt(d.carbs), when: when(d.t) })}
      <span className="block text-xs text-slate-500">{t('الجواب يعيد ساعات من البيانات إلى البحث. يمكن تغييره من صفحة الاستيراد.')}</span>
    </p>
  );
}
