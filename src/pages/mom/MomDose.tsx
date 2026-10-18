// Mom mode, the injection: the number from the doctor's plan (engine/dose.ts via useLiveDose), or a stop that says
// why — never a guess. The dose is saved only when Mom presses «سجّلي الإبرة». Then where it was given, the countdown
// to eating, «بدأت تاكل», and later «شكثر أكلت؟».
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { useLiveDose } from '../../lib/useLiveDose';
import { UnknownMealNote } from '../../components/UnknownMealNote';
import { draftOps, useDraft } from '../../lib/mom';
import { adoptDose, approveDose, ate, fetchPlan, logPendingMeal, planMeal, planNow, startEating, usePlans, type DoseConflict } from '../../lib/plans';
import { insulinNear, logMeal, saveEvent } from '../../lib/api';
import { useSubmitId } from '../../lib/useSubmitId';
import { SameDose } from '../../components/SameDose';
import { SiteRow, useSite } from './MomShots';
import { planItems } from '../../engine/mom';
import { fmt } from '../../lib/carbs';
import { toast, cx } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import type { DoseSnapshot, PlannedMeal } from '../../lib/types';
import { Big, Choice, MomPage, ago, clock, glucoseText, left, SourceTag } from './MomUI';
import { carbSource, plateSources } from '../../engine/source';
import { TimePicker } from '../../components/TimePicker';
import { fetchSeries } from '../../engine/useSeries';
import { doseAt, type DoseAt } from '../../engine/doseAt';
import { dosesFrom } from '../../engine/iob';
import { useCatalog } from './MomMeal';

// Kuwait's late dinners: from 3 pm until 5 am it is dinner, never «snack» by the clock
const slotNow = (at = Date.now()): PlannedMeal['slot'] => { const h = new Date(at).getHours(); return h >= 5 && h < 10 ? 'breakfast' : h >= 10 && h < 15 ? 'lunch' : 'dinner'; };
const ARROW: Record<number, string> = { [-3]: '⇊', [-2]: '↓', [-1]: '↘', 0: '→', 1: '↗', 2: '↑', 3: '⇈' };
const SLOT = { breakfast: 'فطور', lunch: 'غدا', dinner: 'عشا', snack: 'سناك' } as const; // i18n-ok: stored name
const PARTS: [number, string, string][] = [[1, '🟢', 'كلها'], [0.5, '◐', 'تقريبًا نصها'], [0.25, '◔', 'شوي']]; // i18n-ok: translated where shown
// why the number given differs, by direction (stored as said, shown via t())
const REASONS = {
  less: ['أكلت أقل', 'كانت نازلة', 'ما احتاجت وقتها', 'ما رضت', 'شي ثاني'], // i18n-ok
  more: ['أكلت أكثر', 'كان مرتفع', 'شي ثاني'], // i18n-ok
};


/** A home dish she weighed is an estimate: the note says so, for Dad and the dietitian. */
const weighedNote = (items: { kind: string; unit?: string; amount?: number }[]) => {
  const g = items.filter((x) => x.kind === 'recipe' && x.unit === 'g').map((x) => fmt(x.amount ?? 0));
  return g.length ? `⚖️ ${t('صحن موزون (تقدير): {g} غ', { g: g.join(' + ') })}` : null;
};
export function MomDose() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const correction = sp.get('correction') === '1';
  const { settings: s, events, products, nameOf: who, me, reload } = useData();
  const d = useDraft();
  const { c, mealCarbs, nameOf } = useCatalog();
  // a planned meal (?plan=id): its own items; otherwise the plate being built
  const { plans } = usePlans();
  const plan = plans.find((p) => p.id === sp.get('plan')) ?? null;
  const planM = plan ? planMeal(plan.items, products, s) : null;
  const carbs = correction ? 0 : planM ? (planM.complete ? Math.round(planM.total.carbs * 10) / 10 : null) : mealCarbs(d.items);
  // the plate's carb sources (estimate, reference, her label reading), once each, beside the food names
  const srcs = plateSources((plan ? plan.items.map((i) => i.product_id) : d.items.map((i) => (i.kind === 'product' ? i.id : null))).map((id) => (id ? carbSource(products.find((p) => p.id === id)) : null)));
  const names = planM ? planM.lines.map((l, k) => tMaybe(plan!.items[k].label ?? l.product?.name ?? '?')) : d.items.map((i) => nameOf(i));
  const leftOut = plan ? [] : d.left;
  const backTo = correction ? '/mom/shot' : plan ? `/mom/plan/${plan.id}` : '/mom/meal';
  const live = useLiveDose(carbs ?? 0);
  const { r, latest, level } = live;
  const { site, suggest } = useSite('rapid');
  const [given, setGiven] = useState<number | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  // a warning (falling, low, a recent dose…) never stops her recording a dose she gave: she says so and enters it herself
  const [override, setOverride] = useState(false);
  const [busy, setBusy] = useState(false);
  const [eatAt, setEatAt] = useState(() => Date.now()); // none given: when she ate (it may have been a while ago)
  // one submission: the same ids on a retry, so a weak connection cannot record the dose (or the plan) twice
  const [cid] = useSubmitId();
  const [planId] = useState(() => crypto.randomUUID());
  const [mealId] = useState(() => crypto.randomUUID());
  // a dose already recorded (the other parent's, or a moment ago): shown, and she says which it is
  const [conflict, setConflict] = useState<{ dose: DoseConflict; planId: string | null; mine?: boolean } | null>(null);
  // the number starts at the plan's dose, once the meal is known (a plan opened from a link arrives a moment later)
  const mealKnown = correction || (sp.get('plan') ? !!plan : true);
  useEffect(() => { if (given === null && live.ready && !r.block && mealKnown) setGiven(r.dose); }, [live.ready, r.block, r.dose, mealKnown]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = s.pen_step ?? 1;
  const unit = s.glucose_unit;
  // food logged after she ate it, with no dose: what the doctor's plan said at that time (her reading, the insulin
  // still working and the doctor's block then), so the parents see whether their choice matched it
  const past = !correction && given === 0 && r.dose > 0 && Date.now() - eatAt > 10 * 60000;
  const [then, setThen] = useState<DoseAt | null>(null);
  useEffect(() => {
    if (!past || carbs === null) { setThen(null); return; }
    let on = true;
    void fetchSeries(eatAt - 40 * 60000, eatAt + 60000).then((sr) => {
      if (!on) return;
      setThen(doseAt({ at: eatAt, carbs, t: sr.t, v: sr.v, doses: dosesFrom(events), ratios: s.ratios ?? [],
        target: s.target_mgdl !== null && s.target_high_mgdl !== null ? { low: s.target_mgdl, high: s.target_high_mgdl } : null,
        lowMg: s.alert_low_mgdl ?? s.glucose_low_mgdl, dia: s.iob_dia_min, peak: s.iob_peak_min, gapMin: s.dose_gap_min ?? 120, step,
        sensorStartedAt: live.g?.sensor?.started_at ? Date.parse(live.g.sensor.started_at) : null }));
    }).catch(() => on && setThen(null));
    return () => { on = false; };
  }, [past, eatAt, carbs, events]); // eslint-disable-line react-hooks/exhaustive-deps
  const lastRapid = events.filter((e) => e.kind === 'insulin' && e.insulin_type !== 'long' && !e.deleted_at).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0] ?? null;

  // what stops the number: the doctor's rules and anything unknown
  const block = !live.ready ? null : carbs === null ? 'missing' : r.block;
  const stop = override && block !== 'missing' ? null : block;
  const STOP: Record<string, string> = {
    missing: 'في شي ناقص بالوجبة', recent_dose: 'لا تعطينها إبرة الحين', low: 'نازل · عالجيها أول', falling: 'قاعد ينزل بسرعة', // i18n-ok
    no_reading: 'ما في قراءة جديدة', warmup: 'الحساس جديد · افحصي بالإصبع', no_plan: 'خطة الدكتور ناقصة', // i18n-ok
  }; // i18n: translated where shown

  /** The note saved with a dose given past a warning: the warning as it was, then her reason. */
  const warnNote = (why: string | null) => (override && block ? [`تحذير وقتها: ${STOP[block] ?? block}`, why].filter(Boolean).join(' · ') : why) || null; // i18n-ok: stored note
  const snapshot = (): DoseSnapshot | null => { const x = live.calc(); return x ? { ...x, at: new Date().toISOString(), level, reading_at: latest?.taken_at ?? null, dia_min: s.iob_dia_min, peak_min: s.iob_peak_min, pen_step: step } : null; };
  const save = async (separate = false) => {
    if (!given || given <= 0) return;
    setBusy(true);
    try {
      if (correction) {
        if (!separate) {
          // this same submission already reached the server (its answer was lost): not a question, it is saved
          const near = (await insulinNear('rapid', Date.now(), 15)).filter((e) => e.client_id !== cid);
          if (near.length) { const e = near[0]; setConflict({ dose: { id: e.id, units: e.insulin_units ?? 0, at: e.occurred_at, by: e.created_by }, planId: null }); setBusy(false); return; }
        }
        await saveEvent({ client_id: cid, kind: 'insulin', occurred_at: new Date().toISOString(), insulin_units: given, insulin_type: 'rapid', bolus_purpose: 'correction',
          carbs_g: null, treatment: null, note: warnNote(given !== r.dose ? reason : null), activity_min: null, activity_level: null, ends_at: null, dose_calc: snapshot(), bg_mgdl: null, injection_site: site });
        await reload();
        toast(t('تم تسجيل الإبرة ✓'));
        nav('/mom', { replace: true });
        return;
      }
      const dose = { given, calc: r.dose, reason: warnNote(given !== r.dose ? reason : null), purpose: live.purpose, snapshot: snapshot(), carbs: carbs!, site };
      let target = plan;
      if (!target) {
        const items = planItems(d.items, c)!;
        const note = [d.left.length ? `${d.left.join(' · ')} ${t('ما ينحسب بالإبرة · كلّمي بابا')}` : null, weighedNote(d.items)].filter(Boolean).join(' · ') || null;
        target = await planNow({ id: planId, name: mealName(Date.now()), slot: slotNow(), items, eat_after_min: s.dose_to_meal_min ?? 10, note });
      }
      const res = await approveDose(target, dose, cid, separate);
      if (res.status === 'already_dosed' || res.status === 'recent_dose') { setConflict({ dose: res.event, planId: target.id, mine: res.status === 'already_dosed' }); setBusy(false); return; }
      if (res.status !== 'ok') throw new Error(t('الوجبة ما عادت موجودة'));
      await logPendingMeal(target.id, products, s); // in the Log now, as "how much did she eat?" not answered yet
      if (!plan) draftOps.clear();
      await reload();
      nav(`/mom/given/${target.id}`, { replace: true });
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  /** «نفس الإبرة»: nothing new is saved. A meal takes the dose already recorded (unless it is another meal's). */
  const same = async () => {
    if (!conflict) return;
    setBusy(true);
    try {
      if (!conflict.planId) { toast(t('ما تسجّلت: الإبرة مسجّلة من قبل')); nav('/mom', { replace: true }); return; }
      // this meal's own dose (the other parent gave it from their phone): nothing to link, just carry on
      if (conflict.mine) { await reload(); nav(`/mom/given/${conflict.planId}`, { replace: true }); return; }
      const how = await adoptDose(conflict.planId, conflict.dose);
      if (how === 'linked') await logPendingMeal(conflict.planId, products, s);
      if (!plan) draftOps.clear();
      await reload();
      if (how === 'linked') nav(`/mom/given/${conflict.planId}`, { replace: true });
      else { toast(t('ما تسجّلت: الإبرة والوجبة مسجّلة من قبل')); nav('/mom', { replace: true }); }
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  /** A meal is called by what she ate (McNuggets + Fries), never by the clock; the time of day is kept in its slot. */
  const mealName = (at: number) => { const names = d.items.map(nameOf).filter(Boolean); return d.name ?? (names.length ? (names.length > 3 ? `${names.slice(0, 3).join(' + ')} +${names.length - 3}` : names.join(' + ')) : SLOT[slotNow(at)]); };
  /** The food without a dose: asked first, unless she already chose 0 and said why (then it is saved at her time). */
  const eatWithout = async (chosen?: { at: number; why: string }) => {
    if (!chosen && !window.confirm(t('تسجلين الأكل بدون إبرة؟'))) return;
    const at = chosen?.at ?? Date.now();
    const planThen = chosen && then && !then.r.block && then.glucose !== null ? `خطة الدكتور وقتها: ${fmt(then.r.dose)} وحدة (السكر ${glucoseText(then.glucose, unit)})` : null; // i18n-ok: stored note
    const notes = [chosen ? `بدون إبرة: ${chosen.why}` /* i18n-ok: stored note, the reason as stored */ : null, planThen, weighedNote(d.items)].filter(Boolean).join(' · ') || undefined;
    setBusy(true);
    try {
      if (plan) { await ate(plan, 1, at, products, s); await reload(); toast(t('تم: الأكل بدون إبرة ✓')); nav('/mom', { replace: true }); return; }
      const items = planItems(d.items, c)!;
      const meal = planMeal(items, products, s);
      await logMeal({ kind: 'meal', recipe_id: null, name: mealName(at), category: null, meal, modified: true, notes, eatenAt: new Date(at).toISOString(), client_id: mealId });
      draftOps.clear(); await reload(); toast(t('تم: الأكل بدون إبرة ✓')); nav('/mom', { replace: true });
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };

  // before the doctor's-rules stop: once the other dose is on this phone the stop would hide the question
  if (conflict) return (
    <MomPage title={correction ? t('إبرة تصحيح') : t('قبل الأكل')} back={backTo}>
      <SameDose big dose={{ ...conflict.dose, type: 'rapid' }} busy={busy} onSame={same} onSeparate={() => { setConflict(null); void save(true); }} />
    </MomPage>
  );
  if (!live.ready) return <MomPage title={t('الإبرة')}><p className="text-center text-slate-500">…</p></MomPage>;
  if (stop) return (
    <MomPage title={t('الإبرة')} back={correction ? '/mom' : backTo}>
      <div className="rounded-3xl border-2 border-over/40 bg-over-soft p-5 text-center">
        <div className="text-5xl">✋</div>
        <div className="mt-2 text-[24px] font-bold text-over">{t(STOP[stop] ?? STOP.recent_dose)}</div>
        {stop === 'recent_dose' && lastRapid && <div className="mt-2 text-[18px]">{lastRapid.created_by === me ? t('أنت عطيتيها {u} وحدة {when}', { u: lastRapid.insulin_units ?? 0, when: ago(Date.parse(lastRapid.occurred_at)) }) : t('{who} عطاها {u} وحدة {when}', { who: who(lastRapid.created_by) || t('أحد'), u: lastRapid.insulin_units ?? 0, when: ago(Date.parse(lastRapid.occurred_at)) })}</div>}
        {stop === 'recent_dose' && r.until && <div className="mt-1 text-[22px] font-bold">{t('لا نوفورابيد قبل الساعة {c}', { c: clock(r.until) })}<div className="text-[17px] font-normal">{t('بعد {m}', { m: left(r.until) })}</div></div>}
        {latest && <div className="mt-2 text-[18px]">{t('السكر الحين')} <b className="num">{glucoseText(latest.mg_dl, unit)}</b></div>}
      </div>
      {stop === 'missing' && <Big tone="soft" onClick={() => nav(backTo)}>{t('رجوع للوجبة')}</Big>}
      {stop === 'low' && <Big tone="danger" onClick={() => nav('/mom/juice')}>🧃 {t('عطيتها عصير')}</Big>}
      {stop !== 'missing' && <Big tone="soft" onClick={() => { setOverride(true); setGiven(null); setReason(null); }}>💉 {t('عطيتها إبرة؟ سجّليها')}</Big>}
      {!correction && stop !== 'missing' && <Big tone="ghost" disabled={busy} onClick={() => eatWithout()}>{t('سجّلي الأكل بدون إبرة')}</Big>}
      <p className="mt-auto text-center text-sm text-slate-500">{t('كلّمي بابا قبل أي إبرة')}</p>
    </MomPage>
  );
  const differs = !override && given !== null && given !== r.dose;
  const none = !override && !correction && given === 0 && r.dose > 0; // she chose no dose for this food: the food is saved on its own
  const reasons = given !== null && given > r.dose ? REASONS.more : REASONS.less;
  const leftNote = leftOut.length > 0 && !correction && <p className="rounded-2xl bg-over-soft px-4 py-3 text-center text-[17px] font-bold text-over">⚠️ <bdi>{leftOut.join(' · ')}</bdi> {t('ما ينحسب بالإبرة · كلّمي بابا')}</p>;
  return (
    <MomPage compact title={correction ? t('إبرة تصحيح') : t('قبل الأكل')} back={backTo}
      foot={<>{differs && !reason && <p className="text-center text-[14px] font-bold text-near">{t('اختاري السبب')}</p>}
        {none ? <Big md disabled={busy || !reason} onClick={() => eatWithout({ at: eatAt, why: reason! })}>🍽️ {t('سجّلي الأكل بدون إبرة')}</Big>
          : <Big md disabled={busy || !given || given <= 0 || (differs && !reason)} onClick={() => save()}>💉 {t('سجّلي الإبرة')}</Big>}</>}>
      {leftNote}
      {override && block && <p className="rounded-2xl bg-over-soft px-4 py-3 text-center text-[17px] font-bold text-over">⚠️ {t(STOP[block] ?? STOP.recent_dose)} · {t('سجّلي الإبرة اللي عطيتيها')}</p>}
      <UnknownMealNote meal={live.unknownMeal} big />
      <div className="space-y-1 rounded-3xl border border-slate-100 bg-white px-4 py-2.5 text-[15px]">
        {!correction && <div className="text-[14px] text-slate-600"><bdi>{names.join(' · ')}</bdi>{srcs.map((x) => <SourceTag key={x} s={x} />)}</div>}
        {!correction && <div className="flex justify-between"><span>🍽️ {t('الكارب')}</span><b className="num">{fmt(carbs ?? 0)} {t('غرام')}</b></div>}
        {latest && <div className="flex justify-between"><span>{t('السكر الحين')}</span><b className="num" dir="ltr">{glucoseText(latest.mg_dl, unit)} {level !== null ? ARROW[level] : ''}</b></div>}
        <div className="flex justify-between"><span>{t('آخر إبرة')}</span><b>{lastRapid ? ago(Date.parse(lastRapid.occurred_at)) : '—'}</b></div>
      </div>
      {!override && <div className="rounded-3xl bg-brand-soft px-4 py-2 text-center">
        <div className="text-[13px] text-brand">{past ? t('حسب خطة الدكتور الحين') : t('حسب خطة الدكتور')}</div>
        <div className="text-brand"><span className="num text-[48px] font-extrabold leading-none">{fmt(r.dose)}</span> <span className="text-[18px] font-bold">{t('وحدة')}</span></div>
        <button className="min-h-[32px] text-[13px] font-bold text-brand underline" onClick={() => setWhy(!why)}>{t('ليش؟')}</button>
        {why && (
          <div className="mt-1 space-y-0.5 text-start text-[15px]" dir="auto">
            <div className="flex justify-between"><span>{t('للأكل')}</span><b className="num">{fmt(Math.round(r.food * 10) / 10)}</b></div>
            <div className="flex justify-between"><span>{t('تصحيح')}</span><b className="num">{fmt(Math.round(r.correction * 10) / 10)}</b></div>
            {r.iobUsed > 0.05 && <div className="flex justify-between"><span>{t('إبرة باقي مفعولها')}</span><b className="num">−{fmt(Math.round(r.iobUsed * 10) / 10)}</b></div>}
            <div className="flex justify-between border-t border-brand/20 pt-0.5"><span>{t('المجموع')}</span><b className="num">{fmt(Math.round(r.raw * 10) / 10)}</b></div>
            {r.raw - r.dose > 0.05 && <div className="flex justify-between"><span>{t('القلم: للأقل')}</span><b className="num">{fmt(r.dose)}</b></div>}
          </div>
        )}
      </div>}
      {r.dose === 0 && !correction && !override
        ? <><p className="text-center text-[18px]">{t('ما تحتاج إبرة')}</p><Big tone="soft" disabled={busy} onClick={() => eatWithout()}>{t('سجّلي الأكل')}</Big></>
        : (
          <>
            <div className="text-center text-[15px] font-bold">{t('كم عطيتيها؟')}</div>
            <div className="flex items-center justify-center gap-6">
              <button aria-label="+" className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => { setGiven(Math.round(((given ?? 0) + step) * 10) / 10); setReason(null); }}>+</button>
              <span className="num w-16 text-center text-[38px] font-extrabold leading-none">{given === null ? '—' : fmt(given)}</span>
              <button aria-label="−" className="grid h-12 w-12 place-items-center rounded-full bg-brand-soft text-3xl font-bold text-brand" onClick={() => { setGiven(Math.max(0, Math.round(((given ?? 0) - step) * 10) / 10)); setReason(null); }}>−</button>
            </div>
            {!none && <SiteRow type="rapid" site={site} suggest={suggest} />}
            {none && <><div className="text-center text-[15px] font-bold">{t('متى أكلت؟')}</div><TimePicker compact value={eatAt} onChange={setEatAt} /></>}
            {past && then && (
              <div className={cx('rounded-2xl px-3 py-2 text-center text-[14px] leading-snug', !then.r.block && then.r.dose === 0 ? 'bg-ok-soft text-ok' : 'bg-white text-slate-700')}>
                {then.r.block || then.glucose === null ? t('الساعة {c}: ما في حسبة وقتها ({why})', { c: clock(eatAt), why: t(STOP[then.r.block ?? 'no_reading'] ?? STOP.no_reading) })
                  : <><b>{t('خطة الدكتور الساعة {c}: {n} وحدة', { c: clock(eatAt), n: fmt(then.r.dose) })}</b> · {t('السكر وقتها {g}', { g: glucoseText(then.glucose, unit) })}
                    <span className="block font-bold">{then.r.dose === 0 ? `✓ ${t('نفس قرارك')}` : t('قرارك أقل بـ {n} وحدة', { n: fmt(then.r.dose) })}</span></>}
              </div>
            )}
            {differs && <div className="flex flex-wrap justify-center gap-1.5">{reasons.map((x) => <button key={x} onClick={() => setReason(x)} className={cx('min-h-[40px] rounded-full px-3.5 text-[14px]', reason === x ? 'bg-brand font-bold text-white' : 'bg-white border border-slate-200')}>{t(x)}</button>)}</div>}
          </>
        )}
      {!override && <p className="text-center text-[11px] text-slate-400">{t('الأرقام من خطة الدكتور')}</p>}
    </MomPage>
  );
}

/** After the injection: countdown to eating, then «بدأت تاكل». */
export function MomGiven() {
  const nav = useNavigate();
  const { id } = useParams();
  const { plans } = usePlans();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const x = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(x); }, []);
  const p = plans.find((x) => x.id === id);
  if (!p) return <MomPage title="…" back="/mom"><span /></MomPage>;
  const eatAt = Date.parse(p.dose_at) + p.eat_after_min * 60000;
  const secs = Math.max(0, Math.round((eatAt - now) / 1000));
  return (
    <MomPage title={t('تم تسجيل الإبرة ✓')} back="/mom" foot={<Big className="min-h-[72px] text-[22px]" onClick={async () => { await startEating(p.id); nav('/mom', { replace: true }); }}>🍽️ {t('بدأت تاكل')}</Big>}>
      <div className="text-center text-[18px] text-slate-600">🍽️ <bdi>{p.name}</bdi></div>
      <div className="text-center text-[22px] font-bold">{p.given_units} {t('وحدة')} · {clock(Date.parse(p.dose_at))}</div>
      <div className="rounded-3xl bg-white p-6 text-center">
        <div className="text-slate-500">{t('الأكل بعد')}</div>
        <div className="num text-[64px] font-extrabold text-brand" dir="ltr">{secs ? `${Math.floor(secs / 60)}:${String(secs % 60).padStart(2, '0')}` : t('الحين')}</div>
        <div className="text-slate-500">{clock(eatAt)}</div>
      </div>
      {p.dose_event_id && <button className="min-h-[44px] text-[16px] text-slate-500 underline" onClick={() => nav(`/mom/entry/${p.dose_event_id}`)}>{t('غلطانة؟')}</button>}
    </MomPage>
  );
}

/** «شكثر أكلت؟»: all / about half / a little; planned and eaten both kept for the review. */
export function MomAte() {
  const nav = useNavigate();
  const { id } = useParams();
  const { plans } = usePlans();
  const { products, settings, reload } = useData();
  const [part, setPart] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  // a meal from days ago (opened from the Log) is not in the recent plans: read it once
  const [older, setOlder] = useState<PlannedMeal | null>(null);
  const recent = plans.find((x) => x.id === id);
  useEffect(() => { if (!recent && id) void fetchPlan(id).then(setOlder); }, [recent, id]);
  const p = recent ?? older;
  // "all of it" unless said otherwise; a meal already set shows what was said
  useEffect(() => { if (p && part === null) setPart(p.part_eaten != null && PARTS.some(([v]) => v === p.part_eaten) ? p.part_eaten : 1); }, [p, part]);
  if (!p) return <MomPage title="…" back="/mom"><span /></MomPage>;
  const change = p.status === 'eaten';
  const done = async () => {
    if (part === null) return;
    setBusy(true);
    // when she started: as said («بدأت تاكل»), else the planned eating time (an answer given hours later keeps the meal at its time)
    const eatAt = p.eating_at ? Date.parse(p.eating_at) : p.dosed_at ? Math.min(Date.now(), Date.parse(p.dosed_at) + p.eat_after_min * 60000) : Date.now();
    try { await ate(p, part, eatAt, products, settings, { change }); await reload(); toast(t('تم ✓')); if (change) nav(-1); else nav('/mom', { replace: true }); }
    catch (e) {
      // the other parent answered first: nothing is saved twice, and she is told so
      if ((e as Error).message === 'already_eaten') { await reload(); toast(t('انحسبت من قبل ✓')); nav('/mom', { replace: true }); return; }
      toast((e as Error).message); setBusy(false);
    }
  };
  return (
    <MomPage title={t('شكثر أكلت؟')} back="/mom" foot={<Big disabled={part === null || busy} onClick={done}>{t('تم')}</Big>}>
      <div className="text-center text-[18px] text-slate-600">🍽️ <bdi>{p.name}</bdi></div>
      {change && p.part_auto && <p className="text-center text-[15px] text-slate-500">{t('انحسبت «كلها» تلقائيًا. غيّريها إذا أكلت أقل.')}</p>}
      {PARTS.map(([v, icon, label]) => (
        <Choice key={String(v)} icon={icon} label={t(label)} on={part === v} onClick={() => setPart(v)} />
      ))}
      {part !== null && part < 1 && <p className="rounded-2xl bg-near-soft px-4 py-3 text-center text-[17px] font-bold text-near">{t('افحصيها بعد ساعة')}</p>}
    </MomPage>
  );
}
