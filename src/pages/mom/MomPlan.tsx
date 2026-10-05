// Mom mode, a meal planned for later — the same planned meals as the full app (on hold until its time; reminders go to
// both parents): «متى؟» (which meal, today or tomorrow, the injection time), the planned list, one plan (injection
// now, change the time, cancel), and the «المزيد» tab.
import { useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { draftOps, setFullModeNow, setSensorSite, useDraft, useSensor } from '../../lib/mom';
import { planMeal, savePlan, skipPlan, usePlans } from '../../lib/plans';
import { planItems } from '../../engine/mom';
import { eatAt, phase } from '../../engine/mealPlan';
import { isoDate } from '../../lib/constants';
import { fmt } from '../../lib/carbs';
import { cx, inputCls, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import type { PlannedMeal, Product } from '../../lib/types';
import { Big, Choice, MomPage, SITE_NAME, clock, dayWord, sensorLeft } from './MomUI';
import { setAlarmSound, testAlarm, useAlarmSound } from '../../components/Alarm';
import { setKeepAwake, useKeepAwakePref } from '../../lib/keepAwake';
import type { InjectionSite } from '../../lib/types';
import { useCatalog } from './MomMeal';

type Slot = PlannedMeal['slot'];
const SLOTS: Slot[] = ['breakfast', 'lunch', 'dinner', 'snack'];
const SLOT_NAME = { breakfast: 'فطور', lunch: 'غدا', dinner: 'عشا', snack: 'سناك' } as const; // i18n-ok: stored name, shown via t()
const SLOT_ICON = { breakfast: '🌅', lunch: '☀️', dinner: '🌙', snack: '🍪' } as const;
const SLOT_TIME: Record<Slot, string> = { breakfast: '07:00', lunch: '13:00', dinner: '19:00', snack: '16:00' };
const at = (date: string, hm: string) => new Date(`${date}T${hm}:00`).getTime();
const hmOf = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const nameOfItem = (i: PlannedMeal['items'][number], products: Product[]) => tMaybe(i.label ?? products.find((p) => p.id === i.product_id)?.name ?? i.slot_category ?? '?');

/** Plans not finished yet, from today on, soonest first. */
export function useOpenPlans() {
  const { plans } = usePlans();
  const now = Date.now();
  return plans.filter((p) => phase(p, now) !== 'done' && p.for_date >= isoDate(new Date(now - 86400000))).sort((a, b) => Date.parse(a.dose_at) - Date.parse(b.dose_at));
}

/** «متى؟»: which meal, today or tomorrow, and the injection time; saving puts the plan on hold. ?plan=id changes a plan's time. */
export function MomWhen() {
  const nav = useNavigate();
  const [sp] = useSearchParams();
  const { settings } = useData();
  const { plans } = usePlans();
  const editing = plans.find((p) => p.id === sp.get('plan')) ?? null;
  const d = useDraft();
  const { c } = useCatalog();
  const now = Date.now();
  const today = isoDate(new Date(now)), tomorrow = isoDate(new Date(now + 86400000));
  const h = new Date(now).getHours();
  const first: Slot = h < 10 || h >= 20 ? 'breakfast' : h < 15 ? 'lunch' : 'dinner';
  const [slot, setSlot] = useState<Slot>(editing?.slot ?? first);
  const [time, setTime] = useState(editing ? hmOf(Date.parse(editing.dose_at)) : SLOT_TIME[first]);
  const [day, setDay] = useState(editing?.for_date ?? (at(today, SLOT_TIME[first]) > now ? today : tomorrow));
  const [busy, setBusy] = useState(false);
  const eatAfter = settings.dose_to_meal_min ?? 10;
  const doseAt = at(day, time);
  const save = async () => {
    const items = editing ? editing.items : planItems(d.items, c);
    if (!items?.length) return toast(t('في شي ناقص بالوجبة'));
    if (doseAt < now - 5 * 60000) return toast(t('الوقت مضى'));
    setBusy(true);
    try {
      const note = editing ? editing.note : d.left.length ? `${d.left.join(' · ')} ${t('ما ينحسب بالإبرة · كلّمي بابا')}` : null;
      await savePlan({ id: editing?.id, for_date: day, slot, name: editing?.name ?? d.name ?? SLOT_NAME[slot], recipe_id: editing?.recipe_id ?? null, items, dose_at: new Date(doseAt).toISOString(), eat_after_min: eatAfter, remind_min: 10, note });
      if (!editing) draftOps.clear();
      toast(t('انحفظت الخطة ✓'));
      nav('/mom/plans', { replace: true });
    } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <MomPage title={t('متى؟')} foot={<>
      <div className="text-center text-[17px]">💉 {clock(doseAt)} · 🍽️ {clock(doseAt + eatAfter * 60000)}</div>
      <Big disabled={busy} onClick={save}>✓ {t('احفظي الخطة')}</Big>
    </>}>
      <div className="grid grid-cols-2 gap-2">
        {SLOTS.map((x) => (
          <button key={x} onClick={() => { setSlot(x); if (!editing) setTime(SLOT_TIME[x]); }} className={cx('min-h-[64px] rounded-2xl border-2 text-[19px] font-bold', slot === x ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 bg-white')}>{SLOT_ICON[x]} {t(SLOT_NAME[x])}</button>
        ))}
      </div>
      <div className="grid grid-cols-2 gap-2">
        {[today, tomorrow].map((x, k) => <button key={x} onClick={() => setDay(x)} className={cx('min-h-[56px] rounded-2xl border-2 text-[18px] font-bold', day === x ? 'border-brand bg-brand-soft text-brand' : 'border-slate-200 bg-white')}>{k ? t('بكرة') : t('اليوم')}</button>)}
      </div>
      <label className="block space-y-1"><span className="text-[17px] font-bold">💉 {t('وقت الإبرة')}</span>
        <input type="time" dir="ltr" className={cx(inputCls, '!min-h-[60px] !text-center !text-[26px] font-bold')} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} /></label>
      <p className="text-center text-[15px] text-slate-500">{t('الأكل بعد الإبرة بـ {m} د · يوصلكم تذكير', { m: eatAfter })}</p>
    </MomPage>
  );
}

/** «مخططة»: the meals planned and still on hold (or dosed and waiting), soonest first. */
export function MomPlans() {
  const nav = useNavigate();
  const list = useOpenPlans();
  const { products, settings } = useData();
  const now = Date.now();
  return (
    <MomPage title={t('مخططة')} back="/mom/more" foot={<Big tone="soft" onClick={() => { draftOps.start('plan'); nav('/mom/meal'); }}>📅 {t('خططي وجبة')}</Big>}>
      {!list.length && <p className="text-center text-[18px] text-slate-500">{t('ما في وجبات مخططة')}</p>}
      {list.map((p) => {
        const m = planMeal(p.items, products, settings);
        const ph = phase(p, now);
        const chip = ph === 'later' ? t('معلّقة') : ph === 'check' ? t('وقتها الحين') : ph === 'wait_to_eat' ? t('الأكل {c}', { c: clock(eatAt(p)) }) : ph === 'eat_now' ? t('وقت الأكل') : t('افحصيها');
        return <Choice key={p.id} icon={SLOT_ICON[p.slot]} label={p.name} on={false} onClick={() => nav(`/mom/plan/${p.id}`)}
          sub={<>{dayWord(Date.parse(p.dose_at))} 💉 {clock(Date.parse(p.dose_at))} · {m.complete ? `${fmt(Math.round(m.total.carbs))} ${t('غرام')}` : '—'} · <b className={ph === 'later' ? '' : 'text-near'}>{chip}</b></>} />;
      })}
    </MomPage>
  );
}

/** One plan: what is in it and when; the injection now (the dose page decides the number), change the time, cancel. */
export function MomPlanView() {
  const nav = useNavigate();
  const { id } = useParams();
  const { plans } = usePlans();
  const { products, settings } = useData();
  const [busy, setBusy] = useState(false);
  const p = plans.find((x) => x.id === id);
  if (!p) return <MomPage title="…" back="/mom/plans"><span /></MomPage>;
  const m = planMeal(p.items, products, settings);
  const ph = phase(p, Date.now());
  const dosed = p.status === 'dosed';
  const cancel = async () => {
    if (!window.confirm(t('تلغين الخطة؟'))) return;
    setBusy(true);
    try { await skipPlan(p.id); toast(t('انلغت')); nav('/mom/plans', { replace: true }); } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <MomPage title={p.name} back="/mom/plans" foot={<>
      {dosed ? <Big onClick={() => nav(p.eating_at ? `/mom/ate/${p.id}` : `/mom/given/${p.id}`)}>🍽️ {p.eating_at ? t('شكثر أكلت؟') : t('بدأت تاكل؟')}</Big>
        : <Big tone={ph === 'later' ? 'soft' : 'primary'} onClick={() => nav(`/mom/dose?plan=${p.id}`)}>💉 {t('الإبرة الحين')}</Big>}
      {!dosed && <div className="grid grid-cols-2 gap-2">
        <Big tone="ghost" className="min-h-[52px] text-[17px]" onClick={() => nav(`/mom/when?plan=${p.id}`)}>🕐 {t('غيّري الوقت')}</Big>
        <Big tone="ghost" className="min-h-[52px] text-[17px] !text-over" disabled={busy} onClick={cancel}>✕ {t('ألغيها')}</Big>
      </div>}
    </>}>
      <div className="rounded-3xl bg-white px-4 py-3 text-center text-[18px]">
        {dayWord(Date.parse(p.dose_at))} · 💉 <b>{clock(Date.parse(p.dose_at))}</b> · 🍽️ {clock(eatAt(p))}
      </div>
      <ul className="divide-y divide-slate-100 rounded-3xl bg-white px-4">
        {m.lines.map((l, k) => (
          <li key={k} className="flex items-center justify-between gap-2 py-2.5 text-[17px]"><bdi className="min-w-0 truncate">{nameOfItem(p.items[k], products)}</bdi><span className="shrink-0 text-slate-500">{l.carbs === null ? '—' : `${fmt(Math.round(l.carbs * 10) / 10)} ${t('غرام')}`}</span></li>
        ))}
      </ul>
      <div className="flex items-baseline justify-between px-1 text-slate-500"><span>{t('الكارب')}</span><b className="num text-[22px] text-slate-900">{m.complete ? `${fmt(Math.round(m.total.carbs * 10) / 10)} ${t('غرام')}` : '—'}</b></div>
      {p.note && <p className="rounded-2xl bg-over-soft px-4 py-3 text-center text-[16px] font-bold text-over"><bdi>{p.note}</bdi></p>}
    </MomPage>
  );
}

/** «المزيد»: planned meals, injection sites, the full app. */
export function MomMore() {
  const nav = useNavigate();
  const n = useOpenPlans().length;
  const sensor = useSensor();
  const sound = useAlarmSound();
  const awake = useKeepAwakePref();
  return (
    <MomPage title={t('المزيد')} back={null} tabs>
      <Choice icon={sound ? '🔔' : '🔕'} label={t('صوت التنبيه')} sub={sound ? t('شغّال على هالتلفون · اضغطي للإطفاء') : t('طافي على هالتلفون · اضغطي للتشغيل')} on={sound}
        onClick={() => { setAlarmSound(!sound); if (!sound) testAlarm('low'); }} />
      <Choice icon={awake ? '☀️' : '🌙'} label={t('الشاشة تبقى شغّالة')} sub={awake ? t('شغّال · خلّي التلفون على الشاحن') : t('طافي · اضغطي للتشغيل')} on={awake} onClick={() => setKeepAwake(!awake)} />
      <Choice icon="📡" label={t('الحساس')} onClick={() => nav('/mom/sensor')}
        sub={sensor ? `${sensor.site ? t(SITE_NAME[sensor.site]) : t('وين؟')} · ${t('ينتهي بعد {x}', { x: sensorLeft(sensor.life.left) })}` : t('ما في حساس')} />
      <Choice icon="📅" label={t('مخططة')} sub={n ? t('{n} معلّقة', { n }) : undefined} onClick={() => nav('/mom/plans')} />
      <Choice icon="💉" label={t('أماكن الإبر')} onClick={() => nav('/mom/sites')} />
      <Choice icon="🔓" label={t('الوضع الكامل')} onClick={() => { if (window.confirm(t('تفتحين الوضع الكامل؟'))) { setFullModeNow(true); nav('/'); } }} />
    </MomPage>
  );
}

/** The sensor: when it ends, and which arm it is on (that arm gets no injections until it is changed). */
export function MomSensor() {
  const sensor = useSensor();
  const [busy, setBusy] = useState(false);
  const SPOTS: InjectionSite[] = ['arm_r', 'arm_l', 'belly_r', 'belly_l'];
  const pick = async (site: InjectionSite) => {
    if (!sensor) return;
    setBusy(true);
    try { await setSensorSite(sensor.sn, sensor.startedAt, sensor.days, site); toast(t('تم ✓')); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  if (!sensor) return <MomPage title={t('الحساس')} back="/mom/more"><p className="text-center text-[18px] text-slate-500">{t('ما في حساس شغّال')}</p></MomPage>;
  const end = sensor.life.end, soon = sensor.life.state !== 'ok';
  return (
    <MomPage title={t('الحساس')} back="/mom/more">
      <div className={cx('rounded-3xl px-4 py-4 text-center', soon ? 'bg-over-soft text-over' : 'bg-white')}>
        <div className="text-[17px]">{t('ينتهي بعد')}</div>
        <div className="text-[34px] font-extrabold leading-tight">{sensorLeft(sensor.life.left)}</div>
        <div className="text-[18px]">{dayWord(end)} · {clock(end)}</div>
        <div className="mt-1 text-[14px] text-slate-500">{t('انحط {d}', { d: `${dayWord(sensor.life.start)} ${clock(sensor.life.start)}` })}</div>
      </div>
      <h2 className="text-[18px] font-bold">📡 {t('وين الحساس؟')}</h2>
      {SPOTS.map((x) => <Choice key={x} icon={sensor.site === x ? '📡' : '○'} label={t(SITE_NAME[x])} on={sensor.site === x} onClick={() => { if (!busy) void pick(x); }} />)}
      <p className="text-center text-[15px] text-slate-500">{t('مكان الحساس ما تنعطى فيه إبرة')}</p>
    </MomPage>
  );
}
