// Mom mode, the injection: the number from the doctor's plan (engine/dose.ts via useLiveDose), or a stop that says
// why — never a guess. The dose is saved only when Mom presses «سجّلي الإبرة». Then where it was given, the countdown
// to eating, «بدأت تاكل», and later «شكثر أكلت؟».
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { useLiveDose } from '../../lib/useLiveDose';
import { draftOps, useDraft } from '../../lib/mom';
import { approveDose, ate, fetchPlan, planMeal, planNow, startEating, usePlans } from '../../lib/plans';
import { logMeal, saveEvent, setInjectionSite } from '../../lib/api';
import { SiteRow, useSite } from './MomShots';
import { planItems } from '../../engine/mom';
import { fmt } from '../../lib/carbs';
import { toast, cx } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import type { DoseSnapshot, PlannedMeal } from '../../lib/types';
import { Big, Choice, MomPage, ago, clock, glucoseText, left } from './MomUI';
import { useCatalog } from './MomMeal';

const slotNow = (): PlannedMeal['slot'] => { const h = new Date().getHours(); return h < 5 ? 'snack' : h < 10 ? 'breakfast' : h < 15 ? 'lunch' : h < 20 ? 'dinner' : 'snack'; };
const ARROW: Record<number, string> = { [-3]: '⇊', [-2]: '↓', [-1]: '↘', 0: '→', 1: '↗', 2: '↑', 3: '⇈' };
const SLOT = { breakfast: 'فطور', lunch: 'غدا', dinner: 'عشا', snack: 'سناك' } as const; // i18n-ok: stored name
const PARTS: [number, string, string][] = [[1, '🟢', 'كلها'], [0.5, '◐', 'تقريبًا نصها'], [0.25, '◔', 'شوي']]; // i18n-ok: translated where shown
// why the number given differs, by direction (stored as said, shown via t())
const REASONS = {
  less: ['أكلت أقل', 'كانت نازلة', 'ما رضت', 'شي ثاني'], // i18n-ok
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
  const names = planM ? planM.lines.map((l, k) => tMaybe(plan!.items[k].label ?? l.product?.name ?? '?')) : d.items.map((i) => nameOf(i));
  const leftOut = plan ? [] : d.left;
  const backTo = correction ? '/mom/shot' : plan ? `/mom/plan/${plan.id}` : '/mom/meal';
  const live = useLiveDose(carbs ?? 0);
  const { r, latest, level } = live;
  const { site, suggest } = useSite('rapid');
  const [given, setGiven] = useState<number | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (given === null && live.ready && !r.block) setGiven(r.dose); }, [live.ready, r.block, r.dose]); // eslint-disable-line react-hooks/exhaustive-deps
  const step = s.pen_step ?? 1;
  const unit = s.glucose_unit;
  const lastRapid = events.filter((e) => e.kind === 'insulin' && e.insulin_type !== 'long' && !e.deleted_at).sort((a, b) => Date.parse(b.occurred_at) - Date.parse(a.occurred_at))[0] ?? null;

  // what stops the number: the doctor's rules and anything unknown
  const stop = !live.ready ? null : carbs === null ? 'missing' : r.block;
  const STOP: Record<string, string> = {
    missing: 'في شي ناقص بالوجبة', recent_dose: 'لا تعطينها إبرة الحين', low: 'نازل · عالجيها أول', falling: 'قاعد ينزل بسرعة', // i18n-ok
    no_reading: 'ما في قراءة جديدة', warmup: 'الحساس جديد · افحصي بالإصبع', no_plan: 'خطة الدكتور ناقصة', // i18n-ok
  }; // i18n: translated where shown

  const snapshot = (): DoseSnapshot | null => { const x = live.calc(); return x ? { ...x, at: new Date().toISOString(), level, reading_at: latest?.taken_at ?? null, dia_min: s.iob_dia_min, peak_min: s.iob_peak_min, pen_step: step } : null; };
  const save = async () => {
    if (!given || given <= 0) return;
    setBusy(true);
    try {
      if (correction) {
        await saveEvent({ client_id: crypto.randomUUID(), kind: 'insulin', occurred_at: new Date().toISOString(), insulin_units: given, insulin_type: 'rapid', bolus_purpose: 'correction',
          carbs_g: null, treatment: null, note: given !== r.dose ? reason : null, activity_min: null, activity_level: null, ends_at: null, dose_calc: snapshot(), bg_mgdl: null, injection_site: site });
        await reload();
        toast(t('تم تسجيل الإبرة ✓'));
        nav('/mom', { replace: true });
        return;
      }
      if (plan) {
        await approveDose(plan, { given, calc: r.dose, reason: given !== r.dose ? reason : null, purpose: live.purpose, snapshot: snapshot(), carbs: carbs! });
        const fresh = await fetchPlan(plan.id);
        if (fresh?.dose_event_id && site) await setInjectionSite(fresh.dose_event_id, site);
        await reload();
        nav(`/mom/given/${plan.id}`, { replace: true });
        return;
      }
      const items = planItems(d.items, c)!;
      const note = [d.left.length ? `${d.left.join(' · ')} ${t('ما ينحسب بالإبرة · كلّمي بابا')}` : null, weighedNote(d.items)].filter(Boolean).join(' · ') || null;
      const plan2 = await planNow({ name: d.name ?? SLOT[slotNow()], slot: slotNow(), items, eat_after_min: s.dose_to_meal_min ?? 10, note });
      await approveDose(plan2, { given, calc: r.dose, reason: given !== r.dose ? reason : null, purpose: live.purpose, snapshot: snapshot(), carbs: carbs! });
      const fresh = await fetchPlan(plan2.id);
      if (fresh?.dose_event_id && site) await setInjectionSite(fresh.dose_event_id, site);
      draftOps.clear();
      await reload();
      nav(`/mom/given/${plan2.id}`, { replace: true });
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  const eatWithout = async () => {
    if (!window.confirm(t('تسجلين الأكل بدون إبرة؟'))) return;
    setBusy(true);
    try {
      if (plan) { await ate(plan, 1, Date.now(), products, s); await reload(); toast(t('تم: الأكل بدون إبرة ✓')); nav('/mom', { replace: true }); return; }
      const items = planItems(d.items, c)!;
      const meal = planMeal(items, products, s);
      await logMeal({ kind: 'meal', recipe_id: null, name: d.name ?? SLOT[slotNow()], category: null, meal, modified: true, notes: weighedNote(d.items) ?? undefined });
      draftOps.clear(); await reload(); toast(t('تم: الأكل بدون إبرة ✓')); nav('/mom', { replace: true });
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };

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
      {!correction && stop !== 'missing' && <Big tone="ghost" disabled={busy} onClick={eatWithout}>{t('سجّلي الأكل بدون إبرة')}</Big>}
      <p className="mt-auto text-center text-sm text-slate-500">{t('كلّمي بابا قبل أي إبرة')}</p>
    </MomPage>
  );
  const differs = given !== null && given !== r.dose;
  const reasons = given !== null && given > r.dose ? REASONS.more : REASONS.less;
  const leftNote = leftOut.length > 0 && !correction && <p className="rounded-2xl bg-over-soft px-4 py-3 text-center text-[17px] font-bold text-over">⚠️ <bdi>{leftOut.join(' · ')}</bdi> {t('ما ينحسب بالإبرة · كلّمي بابا')}</p>;
  return (
    <MomPage title={correction ? t('إبرة تصحيح') : t('قبل الأكل')} back={backTo}
      foot={<>{differs && !reason && <p className="text-center text-[16px] font-bold text-near">{t('اختاري السبب')}</p>}<Big disabled={busy || !given || given <= 0 || (differs && !reason)} onClick={save}>💉 {t('سجّلي الإبرة')}</Big></>}>
      {leftNote}
      <div className="space-y-1.5 rounded-3xl border border-slate-100 bg-white px-4 py-3 text-[17px]">
        {!correction && <div className="text-[16px] text-slate-600"><bdi>{names.join(' · ')}</bdi></div>}
        {!correction && <div className="flex justify-between"><span>🍽️ {t('الكارب')}</span><b className="num">{fmt(carbs ?? 0)} {t('غرام')}</b></div>}
        {latest && <div className="flex justify-between"><span>{t('السكر الحين')}</span><b className="num" dir="ltr">{glucoseText(latest.mg_dl, unit)} {level !== null ? ARROW[level] : ''}</b></div>}
        <div className="flex justify-between"><span>{t('آخر إبرة')}</span><b>{lastRapid ? ago(Date.parse(lastRapid.occurred_at)) : '—'}</b></div>
      </div>
      <div className="rounded-3xl bg-brand-soft px-4 py-4 text-center">
        <div className="text-sm text-brand">{t('حسب خطة الدكتور')}</div>
        <div className="text-brand"><span className="num text-[64px] font-extrabold leading-none">{fmt(r.dose)}</span> <span className="text-[22px] font-bold">{t('وحدة')}</span></div>
        <button className="mt-1 min-h-[36px] text-sm font-bold text-brand underline" onClick={() => setWhy(!why)}>{t('ليش؟')}</button>
        {why && (
          <div className="mt-1 space-y-0.5 text-start text-[15px]" dir="auto">
            <div className="flex justify-between"><span>{t('للأكل')}</span><b className="num">{fmt(Math.round(r.food * 10) / 10)}</b></div>
            <div className="flex justify-between"><span>{t('تصحيح')}</span><b className="num">{fmt(Math.round(r.correction * 10) / 10)}</b></div>
            {r.iobUsed > 0.05 && <div className="flex justify-between"><span>{t('إبرة باقي مفعولها')}</span><b className="num">−{fmt(Math.round(r.iobUsed * 10) / 10)}</b></div>}
            <div className="flex justify-between border-t border-brand/20 pt-0.5"><span>{t('المجموع')}</span><b className="num">{fmt(Math.round(r.raw * 10) / 10)}</b></div>
            {r.raw - r.dose > 0.05 && <div className="flex justify-between"><span>{t('القلم: للأقل')}</span><b className="num">{fmt(r.dose)}</b></div>}
          </div>
        )}
      </div>
      {r.dose === 0 && !correction
        ? <><p className="text-center text-[18px]">{t('ما تحتاج إبرة')}</p><Big tone="soft" disabled={busy} onClick={eatWithout}>{t('سجّلي الأكل')}</Big></>
        : (
          <>
            <div className="text-center text-[17px] font-bold">{t('كم عطيتيها؟')}</div>
            <div className="flex items-center justify-center gap-6">
              <button aria-label="+" className="grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-4xl font-bold text-brand" onClick={() => { setGiven(Math.round(((given ?? 0) + step) * 10) / 10); setReason(null); }}>+</button>
              <span className="num w-20 text-center text-[48px] font-extrabold">{given === null ? '—' : fmt(given)}</span>
              <button aria-label="−" className="grid h-16 w-16 place-items-center rounded-full bg-brand-soft text-4xl font-bold text-brand" onClick={() => { setGiven(Math.max(0, Math.round(((given ?? 0) - step) * 10) / 10)); setReason(null); }}>−</button>
            </div>
            <SiteRow type="rapid" site={site} suggest={suggest} />
            {differs && <div className="flex flex-wrap justify-center gap-2">{reasons.map((x) => <button key={x} onClick={() => setReason(x)} className={cx('min-h-[44px] rounded-full px-4 text-[16px]', reason === x ? 'bg-brand font-bold text-white' : 'bg-white border border-slate-200')}>{t(x)}</button>)}</div>}
          </>
        )}
      <p className="text-center text-xs text-slate-400">{t('الأرقام من خطة الدكتور')}</p>
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
  const { products, settings } = useData();
  const [part, setPart] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const p = plans.find((x) => x.id === id);
  if (!p) return <MomPage title="…" back="/mom"><span /></MomPage>;
  const done = async () => {
    if (part === null) return;
    setBusy(true);
    try { await ate(p, part, p.eating_at ? Date.parse(p.eating_at) : Date.now(), products, settings); toast(t('تم ✓')); nav('/mom', { replace: true }); }
    catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <MomPage title={t('شكثر أكلت؟')} back="/mom" foot={<Big disabled={part === null || busy} onClick={done}>{t('تم')}</Big>}>
      <div className="text-center text-[18px] text-slate-600">🍽️ <bdi>{p.name}</bdi></div>
      {PARTS.map(([v, icon, label]) => (
        <Choice key={String(v)} icon={icon} label={t(label)} on={part === v} onClick={() => setPart(v)} />
      ))}
      {part !== null && part < 1 && <p className="rounded-2xl bg-near-soft px-4 py-3 text-center text-[17px] font-bold text-near">{t('افحصيها بعد ساعة')}</p>}
    </MomPage>
  );
}
