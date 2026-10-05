// Meals → Planned → History, and one plan's permanent record: Plan → What happened → Early result → Final review →
// What we learned. Every completed plan has its own review; nothing here proposes a dose, a ratio or a timing.
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { fetchPlan, planMeal, savePlanNote, saveReviewNote, usePlanHistory, usePlans } from '../lib/plans';
import { eatingOf, usePlanReview } from '../lib/planReview';
import { effectiveRange, formatGlucose, unitLabel } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import { fmtTime, relDay } from '../lib/constants';
import type { Contributor, Other, Review, Window } from '../engine/planReview';
import type { Series } from '../engine/series';
import type { DoseSnapshot, PlannedMeal } from '../lib/types';
import { doseSteps } from '../engine/dose';
import { Btn, Card, cx, inputCls, toast } from '../components/ui';
import { isEn, t, tMaybe, tr } from '../i18n';

const MIN = 60000;
const SLOT = tr({ breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء', snack: 'سناك' }) as Record<string, string>; // i18n-ok: values translated when read
const clock = (ms: number) => fmtTime(new Date(ms));
export const dur = (min: number) => { const m = Math.max(0, Math.round(min)); return m >= 60 ? (m % 60 ? t('{h} س {m} د', { h: Math.floor(m / 60), m: m % 60 }) : t('{h} س', { h: m / 60 })) : t('{m} د', { m }); };
const PART: Record<string, string> = { '1': t('كلها'), '0.75': '¾', '0.5': '½', '0.25': '¼' };
export const partTxt = (p: number | null | undefined) => (p == null ? '—' : PART[String(p)] ?? String(p));

/* ------------------------------------------------------------ outcome words */

export type OutcomeKey = 'in_target' | 'high' | 'low' | 'unclear';
export const OUTCOME: Record<OutcomeKey, { icon: string; tone: string; label: () => string }> = {
  in_target: { icon: '✅', tone: 'bg-ok-soft text-ok', label: () => t('ضمن النطاق') },
  high: { icon: '🟠', tone: 'bg-near-soft text-near', label: () => t('ارتفع') },
  low: { icon: '🔴', tone: 'bg-over-soft text-over', label: () => t('انخفض') },
  unclear: { icon: '⚪', tone: 'bg-slate-100 text-slate-600', label: () => t('غير واضح · لا يصلح للمقارنة') },
};
/** The chip for a plan in lists: its result, or where its review stands. */
export function PlanChip({ p }: { p: PlannedMeal }) {
  const r = p.review as { stage?: string; outcome?: OutcomeKey } | null | undefined;
  if (p.status === 'skipped') return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{t('أُلغيت')}</span>;
  if (r?.stage === 'final' && r.outcome) { const o = OUTCOME[r.outcome]; return <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold', o.tone)}>{o.icon} {o.label()}</span>; }
  if (r?.stage === 'early') return <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand">{t('نتيجة أولية')}</span>;
  const e = eatingOf(p);
  if (e !== null && Date.now() >= e + 120 * MIN) return <span className="rounded-full bg-brand-soft px-2 py-0.5 text-xs font-bold text-brand">{t('النتيجة جاهزة')}</span>;
  return <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs text-slate-500">{t('بانتظار القراءات')}</span>;
}

const contributorText = (c: Contributor, g: (mg: number) => string) => ({
  early_rise_interval: c.m !== undefined ? t('ارتفع {n} خلال أول 30 د من الأكل، والجرعة أُعطيت قبل الأكل بـ {m} د.', { n: g(c.n ?? 0), m: c.m }) : t('ارتفع {n} خلال أول 30 د من الأكل؛ وقت الجرعة غير مسجّل.', { n: g(c.n ?? 0) }),
  fast_carbs: t('مشروب سكري كان {n}% من الكارب.', { n: c.n ?? 0 }),
  dose_lower: t('الجرعة المعطاة {n} و، والمحسوبة {m} و.', { n: fmt(c.n ?? 0), m: fmt(c.m ?? 0) }),
  dose_higher: t('الجرعة المعطاة {n} و، والمحسوبة {m} و.', { n: fmt(c.n ?? 0), m: fmt(c.m ?? 0) }),
  ate_less: t('أكلت {p} من الوجبة.', { p: partTxt(c.n) }),
  fatty_late: t('وجبة دسمة: ارتفع السكر مرة أخرى بعد 3 ساعات.'),
  carbs_estimated: t('كارب تقديري (بدون ملصق): {x}.', { x: c.text ?? '' }),
  started_low: t('بدأت تحت النطاق.'),
  started_high: t('بدأت فوق النطاق.'),
  exercise: t('رياضة أثناء المراجعة: {x}.', { x: c.text ?? '' }),
}[c.key]);
const qualityText = (w: string) => {
  const [k, v] = w.split(':');
  return k === 'readings' ? t('قراءات ناقصة {m}', { m: dur(Number(v)) }) : k === 'estimated' ? t('كارب تقديري: {x}', { x: v }) : k === 'eating_time' ? t('وقت الأكل تقديري')
    : k === 'no_dose' ? t('الجرعة غير مسجّلة مع الخطة') : t('لا قراءة عند بدء الأكل');
};
export const comparableText = (w: string) => {
  const [k, v] = w.split(':');
  return k === 'ended' ? t('انتهت المراجعة بعد {d}', { d: dur(Number(v)) }) : k === 'quality' ? t('جودة المراجعة محدودة') : k === 'part' ? t('أكلت {p} فقط', { p: partTxt(Number(v)) })
    : k === 'no_interval' ? t('الوقت بين الجرعة والأكل غير مسجّل') : t('رياضة أثناء الوجبة');
};
const otherText = (o: Other) => o.kind === 'food' ? t('أكل: {x}', { x: o.label }) + (o.grams ? ` · ${fmt(o.grams)} ${t('غ')}` : '')
  : o.kind === 'carbs' ? t('كارب إضافي {g} غ', { g: fmt(o.grams ?? 0) }) : o.kind === 'treatment' ? t('علاج انخفاض {g} غ', { g: fmt(o.grams ?? 0) }) + (o.label ? ` · ${o.label}` : '')
    : o.kind === 'correction' ? t('جرعة إضافية {u} و', { u: fmt(o.units ?? 0) }) : t('رياضة') + (o.label ? ` · ${o.label}` : '');

/* ------------------------------------------------------------ history */

/** Meals → Planned → History: To review / All. */
export function PlanHistoryPage() {
  const nav = useNavigate();
  const { plans, loaded } = usePlanHistory();
  const [tab, setTab] = useState<'todo' | 'all'>('todo');
  const todo = plans.filter((p) => p.status === 'eaten' && !p.reviewed_at);
  const list = tab === 'todo' ? todo : plans;
  return (
    <main className="mx-auto max-w-2xl space-y-3 px-4 pb-28 pt-3">
      <div className="flex items-center gap-2">
        <button aria-label={t('رجوع')} onClick={() => nav('/meals')} className="grid h-11 w-11 place-items-center rounded-full bg-white text-xl shadow-sm">{isEn() ? '←' : '→'}</button>
        <h1 className="flex-1 text-2xl font-bold">{t('سجل الخطط')}</h1>
        <button onClick={() => nav('/plans/report')} className="min-h-[44px] rounded-full bg-white px-3 text-sm font-bold text-brand shadow-sm">{t('تقرير الفريق')}</button>
      </div>
      <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1 text-sm">
        {(['todo', 'all'] as const).map((k) => <button key={k} onClick={() => setTab(k)} className={cx('min-h-[40px] rounded-full', tab === k ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k === 'todo' ? `${t('للمراجعة')}${todo.length ? ` (${todo.length})` : ''}` : t('الكل')}</button>)}
      </div>
      {!loaded ? <p className="text-slate-500">…</p> : list.length === 0 ? (
        <Card><p className="text-sm text-slate-500">{tab === 'todo' ? t('لا شيء للمراجعة الآن.') : t('بعد أن تأكل وجبة مخططة تظهر هنا مع مراجعتها.')}</p></Card>
      ) : (
        <Card className="!p-0 overflow-hidden">
          <ul className="divide-y divide-slate-100">
            {list.map((p) => {
              const when = eatingOf(p) ?? Date.parse(p.dose_at);
              return (
                <li key={p.id}><button onClick={() => nav(`/plans/${p.id}`)} className="flex min-h-[60px] w-full items-center gap-3 px-4 py-2 text-start active:bg-slate-50">
                  <span className="w-20 shrink-0 text-xs text-slate-500">{relDay(new Date(when))}<br />{clock(when)}</span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-sm font-bold"><bdi>{SLOT[p.slot]} · {p.name}</bdi></span>
                    <span className="block text-xs text-slate-500">{p.given_units != null ? t('أُعطي {u} و', { u: fmt(p.given_units) }) : t('بدون جرعة مسجّلة')}{p.calc_units != null && p.given_units !== p.calc_units ? ` · ${t('المحسوبة {u} و', { u: fmt(p.calc_units) })}` : ''}{p.reviewed_at ? ` · ${t('رُوجعت ✓')}` : ''}</span>
                  </span>
                  <PlanChip p={p} />
                </button></li>
              );
            })}
          </ul>
        </Card>
      )}
    </main>
  );
}

/* ------------------------------------------------------------ one plan */

export function PlanPage() {
  const { id } = useParams();
  const nav = useNavigate();
  const { plans: active } = usePlans();
  const { plans: past } = usePlanHistory();
  const [fetched, setFetched] = useState<PlannedMeal | null | undefined>(undefined);
  const plan = active.find((p) => p.id === id) ?? past.find((p) => p.id === id) ?? fetched ?? null;
  useEffect(() => { if (id && !active.some((p) => p.id === id) && !past.some((p) => p.id === id)) void fetchPlan(id).then(setFetched); }, [id, active, past]);
  if (!plan) return <p className="p-4 text-slate-500">{fetched === null ? t('الخطة غير موجودة') : '…'}</p>;
  return <PlanBody plan={plan} back={() => nav('/plans/history')} />;
}

function PlanBody({ plan, back }: { plan: PlannedMeal; back: () => void }) {
  const { products, settings, me, nameOf } = useData();
  const { review, series, eating } = usePlanReview(plan);
  const unit = settings.glucose_unit, g = (mg: number | null | undefined) => (mg == null ? '—' : formatGlucose(mg, unit));
  const meal = useMemo(() => planMeal(plan.items, products, settings), [plan.items, products, settings]);
  const [planNote, setPlanNote] = useState(plan.note ?? '');
  const [note, setNote] = useState(plan.review_note ?? '');
  const [busy, setBusy] = useState(false);
  const run = async (f: () => Promise<void>, msg: string) => { setBusy(true); try { await f(); toast(msg); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };
  const range = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const snap = plan.dose_snapshot;
  const when = eating ?? Date.parse(plan.dose_at);
  const o = review?.stage === 'final' && review.outcome ? OUTCOME[review.outcome] : null;

  return (
    <main className="mx-auto max-w-2xl space-y-3 px-4 pb-28 pt-3">
      <div className="flex items-center gap-2">
        <button aria-label={t('رجوع')} onClick={back} className="grid h-11 w-11 place-items-center rounded-full bg-white text-xl shadow-sm">{isEn() ? '←' : '→'}</button>
        <div className="min-w-0 flex-1"><div className="truncate font-bold"><bdi>{SLOT[plan.slot]} · {plan.name}</bdi></div><div className="text-sm text-slate-500">{relDay(new Date(when))} · {clock(when)}</div></div>
      </div>

      {/* the quick answer */}
      {plan.status === 'skipped' ? <p className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-600">{t('أُلغيت الخطة: لم تُؤكل')}</p>
        : o ? <p className={cx('rounded-2xl px-4 py-3 text-lg font-bold', o.tone)}>{o.icon} {o.label()}</p>
          : review?.stage === 'early' ? <p className="rounded-2xl bg-brand-soft px-4 py-3 font-bold text-brand">{t('نتيجة أولية · المراجعة النهائية {time}', { time: clock(review.finalAt!) })}</p>
            : eating !== null ? <p className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-600">{t('النتيجة الأولية بعد ساعتين من الأكل ({time})', { time: clock(eating + 120 * MIN) })}</p>
              : <p className="rounded-2xl bg-slate-100 px-4 py-3 font-bold text-slate-600">{t('لم يُسجَّل الأكل بعد')}</p>}
      {review?.stage === 'final' && (
        <div className="flex flex-wrap gap-1.5 text-xs">
          <span className={cx('rounded-full px-2 py-0.5 font-bold', review.quality === 'high' ? 'bg-ok-soft text-ok' : 'bg-near-soft text-near')}>{review.quality === 'high' ? t('جودة المراجعة: عالية') : t('جودة المراجعة: محدودة')}</span>
          <span className={cx('rounded-full px-2 py-0.5 font-bold', review.comparable ? 'bg-brand-soft text-brand' : 'bg-slate-100 text-slate-600')}>{review.comparable ? t('تصلح للمقارنة') : t('لا تصلح للمقارنة')}</span>
        </div>
      )}

      {series && eating !== null && <Card className="!px-2"><PlanChart plan={plan} series={series} review={review} eating={eating} unit={unit} range={{ low: range.low ?? 70, high: range.high ?? 180 }} /></Card>}

      {/* Plan */}
      <Section title={t('الخطة')}>
        <ul className="divide-y divide-slate-100 text-sm">
          {meal.lines.map((l, i) => <li key={i} className="flex justify-between gap-2 py-1"><bdi>{tMaybe(plan.items[i]?.label ?? l.product?.name ?? plan.items[i]?.slot_category ?? '')}</bdi><span><span className="num">{l.carbs === null ? '—' : fmt(Math.round(l.carbs * 10) / 10)}</span> <span className="text-xs text-slate-500">{t('غ كارب')}</span></span></li>)}
        </ul>
        <Row k={t('الكارب المخطط')} v={t('{g} غ', { g: fmt(plan.carbs_planned ?? Math.round(meal.total.carbs * 10) / 10) })} />
        <label className="block text-sm"><span className="mb-1 block text-slate-600">{t('خطتي')}</span>
          <textarea className={inputCls} rows={2} dir="auto" maxLength={500} value={planNote} onChange={(e) => setPlanNote(e.target.value)} placeholder={t('مثلًا: أجرّب الجرعة قبل الأكل بـ 15 د')} />
        </label>
        {planNote !== (plan.note ?? '') && <Btn block disabled={busy} onClick={() => run(() => savePlanNote(plan.id, planNote), t('حُفظ ✓'))}>{t('حفظ')}</Btn>}
      </Section>

      {/* What happened */}
      {plan.status !== 'skipped' && (
        <Section title={t('ماذا حدث')}>
          <Row k={t('السكر عند الجرعة')} v={`${g(snap?.glucose ?? review?.atDose)}${snap?.level != null ? ` ${['↓', '↘', '→', '↗', '↑'][snap.level + 2]}` : ''}`} />
          <Row k={t('الإنسولين النشط عند الجرعة')} v={snap ? t('{u} و', { u: fmt(snap.iob) }) : '—'} />
          <CalcDose snap={snap ?? null} g={g}>
            <Row k={t('الجرعة المحسوبة (إعدادات الطبيب)')} v={plan.calc_units != null ? t('{u} و', { u: fmt(plan.calc_units) }) : '—'} sub={snap ? t('نسبة الكارب {cr} · الحساسية {isf} · الهدف {a}–{b}', { cr: fmt(snap.cr), isf: g(snap.isf).replace(/\.0$/, ''), a: g(snap.target[0]), b: g(snap.target[1]) }) : undefined} />
          </CalcDose>
          <Row k={t('الجرعة المعطاة')} v={plan.given_units != null ? t('{u} و', { u: fmt(plan.given_units) }) : '—'} sub={plan.dose_reason ? t('السبب: {x}', { x: plan.dose_reason }) : undefined} strong={plan.given_units != null && plan.calc_units != null && plan.given_units !== plan.calc_units} />
          <Row k={t('وقت الجرعة')} v={plan.dosed_at ? clock(Date.parse(plan.dosed_at)) : '—'} />
          <Row k={t('بدء الأكل')} v={eating !== null ? clock(eating) : '—'} />
          <Row k={t('من الجرعة إلى الأكل')} v={review?.interval != null ? dur(review.interval) : '—'} />
          <Row k={t('الكارب: مخطط ← مأكول')} v={`${fmt(plan.carbs_planned ?? 0)} ${isEn() ? '→' : '←'} ${plan.carbs_eaten != null ? fmt(plan.carbs_eaten) : '—'} ${t('غ')}`} sub={plan.part_eaten != null ? t('أكلت {p}', { p: partTxt(plan.part_eaten) }) : undefined} />
          {review?.endedBy && <Row k={t('انتهت المراجعة')} v={t('بعد {d}', { d: dur(review.cleanMin ?? 0) })} sub={otherText(review.endedBy)} strong />}
          {review && review.exercise.length > 0 && review.exercise.map((x, k) => <Row key={k} k={clock(x.t)} v={otherText(x)} />)}
        </Section>
      )}

      {/* Early result */}
      {review?.early && !(review.final && (review.cleanMin ?? 0) <= 125) && <Section title={t('النتيجة الأولية (ساعتان)')} hint={t('ملاحظة مبكرة، وليست الحكم النهائي.')}><Numbers w={review.early} g={g} early /></Section>}

      {/* Final review */}
      {review?.final && (
        <Section title={t('المراجعة النهائية ({d})', { d: dur(review.cleanMin ?? 0) })}>
          <Numbers w={review.final} g={g} />
          <Row k={t('عاد نحو النطاق')} v={review.returned === null ? '—' : review.returned ? t('نعم') : t('كلا')} />
          <Row k={t('ارتفاع متأخر')} v={review.lateRise ? t('نعم') : t('كلا')} />
          {review.contributors.length > 0 && (
            <div className="rounded-xl bg-slate-50 p-3">
              <div className="mb-1 text-sm font-bold">{t('ما قد يكون أثّر (ليس مؤكدًا)')}</div>
              <ul className="list-disc space-y-0.5 ps-5 text-sm text-slate-700">{review.contributors.map((c, k) => <li key={k}>{contributorText(c, (mg) => g(mg))}</li>)}</ul>
            </div>
          )}
          {review.quality === 'limited' && <p className="text-xs text-slate-500">{t('جودة محدودة:')} {review.qualityWhy.map(qualityText).join(' · ')}</p>}
          {!review.comparable && <p className="text-xs text-slate-500">{t('لا تصلح للمقارنة:')} {review.notComparableWhy.map(comparableText).join(' · ')}</p>}
        </Section>
      )}

      {/* What we learned */}
      {plan.status === 'eaten' && (
        <Section title={t('ماذا تعلّمنا')}>
          <textarea className={inputCls} rows={3} dir="auto" maxLength={800} value={note} onChange={(e) => setNote(e.target.value)} placeholder={t('مثلًا: انتبه للارتفاع المبكر، وناقش التوقيت في الموعد القادم')} />
          <p className="text-[11px] text-slate-500">{t('تظهر هذه الملاحظة تلقائيًا عند تخطيط الوجبة نفسها مرة أخرى.')}</p>
          <div className="grid grid-cols-2 gap-2">
            <Btn disabled={busy || note === (plan.review_note ?? '')} onClick={() => run(() => saveReviewNote(plan.id, note, false, me), t('حُفظ ✓'))}>{t('حفظ الملاحظة')}</Btn>
            <Btn kind="primary" disabled={busy || review?.stage !== 'final'} onClick={() => run(() => saveReviewNote(plan.id, note, true, me), t('رُوجعت ✓'))}>{plan.reviewed_at ? t('رُوجعت ✓') : t('تمت المراجعة')}</Btn>
          </div>
          {plan.reviewed_at && <p className="text-xs text-slate-500">{t('رُوجعت {when} · {who}', { when: `${relDay(new Date(plan.reviewed_at))} ${clock(Date.parse(plan.reviewed_at))}`, who: plan.reviewed_by ? nameOf(plan.reviewed_by) : '' })}</p>}
        </Section>
      )}
      <p className="text-center text-[11px] text-slate-400">{unitLabel(unit)} · {t('ملاحظات من بياناتها، وليست توصية بجرعة.')}</p>
    </main>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return <Card className="space-y-2"><div><h2 className="font-bold">{title}</h2>{hint && <p className="text-xs text-slate-500">{hint}</p>}</div>{children}</Card>;
}
/** The calculated dose row with a 🧮 button: the working stays hidden until tapped. */
function CalcDose({ snap, g, children }: { snap: DoseSnapshot | null; g: (mg: number | null | undefined) => string; children: React.ReactNode }) {
  const [open, setOpen] = useState(false);
  if (!snap) return <>{children}</>;
  return (
    <>
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">{children}</div>
        <button type="button" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-label={t('كيف انحسبت الجرعة')} title={t('كيف انحسبت الجرعة')}
          className={cx('mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full text-lg', open ? 'bg-brand text-white' : 'bg-brand-soft')}>🧮</button>
      </div>
      {open && <DoseWorking snap={snap} g={g} />}
    </>
  );
}

/** How the calculated dose was worked out, from the numbers saved with it: food, correction, insulin still working, rounding. */
function DoseWorking({ snap, g }: { snap: DoseSnapshot; g: (mg: number | null | undefined) => string }) {
  const d = doseSteps(snap);
  const n = (x: number) => String(Math.round(x * 100) / 100); // two decimals, so the parts visibly add up
  const gg = (mg: number) => g(mg);
  const f = (x: string) => <bdi dir="ltr" className="num">{x}</bdi>;
  const u = (x: number) => t('{u} و', { u: n(x) });
  return (
    <div className="my-1 space-y-1 rounded-xl bg-slate-50 px-3 py-2 text-sm">
      <div className="text-xs font-bold text-slate-600">{t('كيف انحسبت الجرعة')}</div>
      <div className="flex justify-between gap-2"><span>🍽️ {t('الأكل')}</span><span>{f(`${n(d.carbs)} ${t('غ')} ÷ ${n(d.cr)}`)} = <b className="num">{u(d.food)}</b></span></div>
      <div className="flex justify-between gap-2"><span>🩸 {t('التصحيح')}</span>{d.side === 'inside'
        ? <span className="text-slate-600">{t('السكر ضمن الهدف · بلا تصحيح')}</span>
        : <span>{f(`(${gg(d.glucose)} − ${gg(d.side === 'above' ? d.target[1] : d.target[0])}) ÷ ${g(d.isf).replace(/\.0$/, '')}`)} = <b className="num" dir="ltr">{d.correction < 0 ? '−' : ''}{u(Math.abs(d.correction))}</b></span>}</div>
      {d.side === 'below' && <p className="text-xs text-slate-500">{t('السكر تحت الهدف، فالتصحيح ينقص الجرعة')}</p>}
      {d.iob > 0 && <div className="flex justify-between gap-2"><span>💉 {t('إنسولين ما زال يشتغل')} <span className="text-xs text-slate-500">({u(d.iob)})</span></span><span>{d.iobUsed > 0 ? <b className="num" dir="ltr">−{u(d.iobUsed)}</b> : <span className="text-xs text-slate-500">{t('يُخصم من التصحيح فقط')}</span>}</span></div>}
      <div className="flex justify-between gap-2 border-t border-slate-200 pt-1"><span>{t('المجموع')}</span><span>{f(n(d.raw))} → <b className="num">{u(d.dose)}</b></span></div>
      {d.raw !== d.dose && <p className="text-xs text-slate-500">{t('يُقرّب لتحت لأقرب {s} (قلم الإنسولين)', { s: u(d.step) })}</p>}
    </div>
  );
}

function Row({ k, v, sub, strong }: { k: string; v: string; sub?: string; strong?: boolean }) {
  return (
    <div className="flex items-baseline justify-between gap-3 border-b border-slate-50 py-1 text-sm last:border-0">
      <span className="text-slate-600">{k}</span>
      <span className="text-end"><span className={cx('num', strong && 'font-bold')} dir="auto">{v}</span>{sub && <span className="block text-xs text-slate-500" dir="auto">{sub}</span>}</span>
    </div>
  );
}
function Numbers({ w, g, early }: { w: Window; g: (mg: number | null | undefined) => string; early?: boolean }) {
  const dir = w.direction === 'up' ? t('يرتفع ↗') : w.direction === 'down' ? t('ينزل ↘') : w.direction === 'flat' ? t('ثابت →') : '—';
  return (
    <>
      <Row k={early ? t('أعلى قراءة حتى الآن') : t('أعلى قراءة')} v={g(w.peak)} sub={w.ttp !== null ? t('بعد {d} من الأكل', { d: dur(w.ttp) }) : undefined} />
      <Row k={t('الارتفاع')} v={w.rise !== null ? `+${g(w.rise)}` : '—'} />
      <Row k={t('بعد ساعتين')} v={g(w.at2h)} />
      {!early && <Row k={t('بعد 3 ساعات')} v={g(w.at3h)} />}
      <Row k={early ? t('الاتجاه الآن') : t('آخر قراءة')} v={early ? dir : g(w.last)} sub={!early && w.lastAt ? clock(w.lastAt) : undefined} />
      <Row k={t('الوقت ضمن النطاق')} v={w.tir !== null ? `${w.tir}%` : '—'} />
      <Row k={t('انخفاض')} v={w.low ? t('نعم · أدنى {g} عند {time}', { g: g(w.low.min), time: clock(w.low.at) }) : t('كلا')} strong={!!w.low} />
      <Row k={t('ارتفاع واضح')} v={w.high ? t('نعم · {d} فوق النطاق', { d: dur(w.high.minutes) }) : t('كلا')} strong={!!w.high} />
    </>
  );
}

/** Dose to the end of the review: her readings, the target band, dose / eat / end lines, and what else happened. */
function PlanChart({ plan, series, review, eating, unit, range }: { plan: PlannedMeal; series: Series; review: Review | null; eating: number; unit: 'mmol' | 'mgdl'; range: { low: number; high: number } }) {
  const W = 340, PL = 4, PR = 30, PT = 14, PH = 170, H = PT + PH + 20;
  const dose = plan.dosed_at ? Date.parse(plan.dosed_at) : null;
  const t0 = Math.min(dose ?? eating, eating) - 20 * MIN;
  const t1 = Math.max(eating + 120 * MIN, Math.min(review?.finalAt ?? eating + 360 * MIN, Date.now()));
  const pts: [number, number][] = [];
  for (let i = 0; i < series.t.length; i++) if (series.t[i] >= t0 && series.t[i] <= t1) pts.push([series.t[i], series.v[i]]);
  const top = Math.max(250, ...pts.map((p) => p[1] + 20)), bottom = 40;
  const x = (t: number) => PL + ((t - t0) / (t1 - t0)) * (W - PL - PR);
  const y = (v: number) => PT + PH - ((Math.min(Math.max(v, bottom), top) - bottom) / (top - bottom)) * PH;
  let d = ''; let prev = 0;
  for (const [t, v] of pts) { d += `${!d || t - prev > 20 * MIN ? 'M' : 'L'}${x(t).toFixed(1)},${y(v).toFixed(1)}`; prev = t; }
  const end = review?.endedBy ? review.endedBy.t : null;
  const peak = review?.final ?? review?.early;
  // the dose label sits left of its line and the others right of theirs, so dose and meal never overlap
  const vline = (t: number, label: string, color: string, dash?: string, left?: boolean) => (
    <g key={label + t}><line x1={x(t)} x2={x(t)} y1={PT} y2={PT + PH} stroke={color} strokeDasharray={dash} />
      <text x={x(t) + (left ? -3 : 3)} y={PT - 3} fontSize="9.5" fill={color} fontFamily="Rubik, system-ui" textAnchor={left ? 'end' : 'start'}>{label}</text></g>
  );
  const ticks = unit === 'mmol' ? [4, 10, 16].map((m) => m * 18.016) : [70, 180, 300];
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="w-full" role="img" aria-label={t('السكر حول الوجبة')} direction="ltr">
      <rect x={PL} y={PT} width={W - PL - PR} height={PH} rx="8" fill="rgb(var(--surface-2))" />
      <rect x={PL} y={y(range.high)} width={W - PL - PR} height={y(range.low) - y(range.high)} fill="rgb(var(--st-in))" opacity="0.13" />
      {ticks.filter((v) => v < top).map((v) => <text key={v} x={W - 2} y={y(v) + 4} textAnchor="end" fontSize="10" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{formatGlucose(v, unit).replace(/\.0$/, '')}</text>)}
      {dose !== null && vline(dose, t('الجرعة'), 'rgb(var(--primary))', undefined, true)}
      {vline(eating, t('الأكل'), 'rgb(var(--text-2))', '3 3')}
      {end !== null && vline(end, t('انتهت'), 'rgb(var(--text-3))', '2 3', true)}
      <path d={d} fill="none" stroke="rgb(var(--primary-strong))" strokeWidth="2" strokeLinejoin="round" />
      {peak?.peak != null && peak.ttp != null && <circle cx={x(eating + peak.ttp * MIN)} cy={y(peak.peak)} r="3.5" fill="rgb(var(--primary-strong))" />}
      {[0, 60, 120, 180, 240, 300, 360].filter((m) => eating + m * MIN <= t1).map((m) => <text key={m} x={x(eating + m * MIN)} y={H - 5} textAnchor="middle" fontSize="10" fill="rgb(var(--text-3))" fontFamily="Rubik, system-ui">{m ? `+${m / 60}h` : '0'}</text>)}
    </svg>
  );
}
