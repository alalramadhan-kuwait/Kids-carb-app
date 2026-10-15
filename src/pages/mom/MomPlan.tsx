import { setThemePref, themePref, type ThemePref } from '../../lib/theme';
// Mom mode, a meal planned for later — the same planned meals as the full app (on hold until its time; reminders go to
// both parents): «متى؟» (which meal, today or tomorrow, the injection time), the planned list, one plan (injection
// now, change the time, cancel), and the «المزيد» tab.
import { TimeField } from '../../components/TimeField';
import { useEffect, useState } from 'react';
import { useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useData } from '../../lib/data';
import { draftOps, setFullModeNow, setSensorSite, useDraft, useSensor } from '../../lib/mom';
import { planMeal, savePlan, skipPlan, usePlans } from '../../lib/plans';
import { planItems, type MomItem } from '../../engine/mom';
import { eatAt, phase } from '../../engine/mealPlan';
import { isoDate } from '../../lib/constants';
import { fmt } from '../../lib/carbs';
import { cx, inputCls, toast } from '../../components/ui';
import { t, tMaybe } from '../../i18n';
import type { PlannedMeal, Product } from '../../lib/types';
import { Big, Choice, MomPage, okToReplace, SITE_NAME, SettingsGroup, SettingsRow, Switch, clock, dayWord, sensorLeft } from './MomUI';
import { setAlarmSound, testAlarm, useAlarmSound } from '../../components/Alarm';
import { setKeepAwake, useKeepAwakePref } from '../../lib/keepAwake';
import type { InjectionSite } from '../../lib/types';
import { useCatalog } from './MomMeal';
import { enablePush, pushState, type PushState } from '../../lib/push';
import { ACTIVITY_KINDS, activityOn, setActivityPush, type ActivityKind } from '../../lib/activityPush';

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
    // a plan whose plate was changed here takes the new plate; otherwise a plan keeps its food
    const fromPlate = !editing || d.planId === editing.id;
    const items = fromPlate ? planItems(d.items, c) : editing.items;
    if (!items?.length) return toast(t('في شي ناقص بالوجبة'));
    if (doseAt < now - 5 * 60000) return toast(t('الوقت مضى'));
    setBusy(true);
    try {
      const note = editing ? editing.note : d.left.length ? `${d.left.join(' · ')} ${t('ما ينحسب بالإبرة · كلّمي بابا')}` : null;
      await savePlan({ id: editing?.id, for_date: day, slot, name: editing?.name ?? d.name ?? SLOT_NAME[slot], recipe_id: fromPlate ? null : editing?.recipe_id ?? null, items, ...(fromPlate ? { mom_items: d.items } : {}), dose_at: new Date(doseAt).toISOString(), eat_after_min: eatAfter, remind_min: 10, note });
      if (fromPlate) draftOps.clear();
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
        <TimeField dir="ltr" className={cx(inputCls, '!min-h-[60px] !text-center !text-[26px] font-bold')} value={time} onChange={(e) => e.target.value && setTime(e.target.value)} /></label>
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
    <MomPage title={t('مخططة')} back="/mom/more" foot={<Big tone="soft" onClick={() => { if (okToReplace('plan')) draftOps.start('plan'); nav('/mom/meal'); }}>📅 {t('خططي وجبة')}</Big>}>
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
  const { products, settings, ingsByRecipe } = useData();
  const [busy, setBusy] = useState(false);
  const p = plans.find((x) => x.id === id);
  if (!p) return <MomPage title="…" back="/mom/plans"><span /></MomPage>;
  const m = planMeal(p.items, products, settings);
  const ph = phase(p, Date.now());
  const dosed = p.status === 'dosed';
  // the plate behind the plan: kept since 3.4.1; an older plan made of foods (not a recipe's parts) is rebuilt from them
  const plate: MomItem[] | null = (p.mom_items as MomItem[] | null | undefined) ?? (p.recipe_id ? (() => {
    // a recipe's plan holds its ingredients scaled by the plates eaten: the same factor on every one gives the plates back
    const ings = (ingsByRecipe.get(p.recipe_id) ?? []).filter((i) => i.role !== 'snack');
    if (!ings.length || ings.length !== p.items.length) return null;
    const k = Number(p.items[0].quantity) / Number(ings[0].quantity);
    if (!(k > 0) || p.items.some((it, n) => Math.abs(Number(it.quantity) - Number(ings[n].quantity) * k) > 0.01 * Math.max(1, Number(it.quantity)))) return null;
    return [{ kind: 'recipe' as const, id: p.recipe_id, portion_id: null, amount: Math.round(k * 100) / 100, unit: 'plate' as const }];
  })() : (() => {
    const out: MomItem[] = [];
    for (const i of p.items) {
      if (!i.product_id) return null;
      if (i.unit === 'serving') out.push({ kind: 'product', id: i.product_id, portion_id: null, amount: Number(i.quantity), unit: 'serving' });
      else if (i.unit === 'g' || i.unit === 'ml') out.push({ kind: 'product', id: i.product_id, portion_id: null, amount: Number(i.quantity), unit: 'g', ...(i.state === 'cooked' ? { cooked: true } : {}) });
      else return null;
    }
    return out.length ? out : null;
  })());
  const editFood = () => { if (!plate || !okToReplace()) return; draftOps.editPlan(plate, p.name, p.id); nav('/mom/meal'); };
  const cancel = async () => {
    if (!window.confirm(t('تلغين الخطة؟'))) return;
    setBusy(true);
    try { await skipPlan(p.id); toast(t('انلغت')); nav('/mom/plans', { replace: true }); } catch (e) { toast((e as Error).message); setBusy(false); }
  };
  return (
    <MomPage title={p.name} back="/mom/plans" foot={<>
      {dosed ? <Big onClick={() => nav(p.eating_at ? `/mom/ate/${p.id}` : `/mom/given/${p.id}`)}>🍽️ {p.eating_at ? t('شكثر أكلت؟') : t('بدأت تاكل؟')}</Big>
        : <Big tone={ph === 'later' ? 'soft' : 'primary'} onClick={() => nav(`/mom/dose?plan=${p.id}`)}>💉 {t('الإبرة الحين')}</Big>}
      {!dosed && plate && <Big tone="soft" className="min-h-[52px] text-[17px]" onClick={editFood}>✏️ {t('عدّلي الأكل')}</Big>}
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
  // icon tiles in the app's purples and blues (orange and red are kept for glucose and warnings)
  const TINT = { alerts: '#5b4bd5', device: '#3f7fd0', plan: '#8b5cf6', app: '#8a84a0' };
  return (
    <MomPage title={t('المزيد')} back={null} tabs>
      <div className="space-y-5 pb-2">
        <SettingsGroup title={t('التنبيهات والإشعارات')}>
          <SettingsRow icon="sound" tint={TINT.alerts} label={t('صوت التنبيه')} sub={t('على هالتلفون')}
            end={<Switch on={sound} label={t('صوت التنبيه')} onChange={(v) => { setAlarmSound(v); if (v) testAlarm('low'); }} />} />
          <PhonePushRow tint={TINT.alerts} />
          <SettingsRow icon="family" tint={TINT.alerts} label={t('أخبرني لما يسجّل غيري')} onClick={() => nav('/mom/activity')} />
        </SettingsGroup>
        <SettingsGroup title={t('الجهاز والحساس')}>
          <SettingsRow icon="sun" tint={TINT.device} label={t('الشاشة تبقى شغّالة')} sub={awake ? t('خلّي التلفون على الشاحن') : undefined}
            end={<Switch on={awake} label={t('الشاشة تبقى شغّالة')} onChange={setKeepAwake} />} />
          <SettingsRow icon="sensor" tint={TINT.device} label={t('الحساس')} onClick={() => nav('/mom/sensor')}
            sub={sensor ? `${sensor.site ? t(SITE_NAME[sensor.site]) : t('وين؟')} · ${t('ينتهي بعد {x}', { x: sensorLeft(sensor.life.left) })}` : t('ما في حساس')}
            subTone={sensor && sensor.life.state !== 'ok' ? 'warn' : undefined} />
        </SettingsGroup>
        <SettingsGroup title={t('التخطيط والسجلات')}>
          <SettingsRow icon="calendar" tint={TINT.plan} label={t('مخططة')} sub={n ? t('{n} معلّقة', { n }) : undefined} onClick={() => nav('/mom/plans')} />
          <SettingsRow icon="insulin" tint={TINT.plan} label={t('أماكن الإبر')} onClick={() => nav('/mom/sites')} />
          <SettingsRow icon="trash" tint={TINT.plan} label={t('المحذوفة مؤخرًا')} onClick={() => nav('/mom/deleted')} />
        </SettingsGroup>
        <SettingsGroup title={t('إعدادات التطبيق')}>
          <Appearance />
          <SettingsRow icon="unlock" tint={TINT.app} label={t('الوضع الكامل')} onClick={() => { if (window.confirm(t('تفتحين الوضع الكامل؟'))) { setFullModeNow(true); nav('/'); } }} />
        </SettingsGroup>
      </div>
    </MomPage>
  );
}

/** This phone's notifications as a settings row: off → the switch turns them on (the phone asks for permission);
 *  on → shown as on (turning them off is not offered here, as before); not possible yet → why, in the second line. */
function PhonePushRow({ tint }: { tint: string }) {
  const [ps, setPs] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushState().then(setPs); }, []);
  if (!ps) return null;
  const on = async () => {
    if (ps !== 'off' || busy) return;
    setBusy(true);
    try { setPs(await enablePush()); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const why = ps === 'needs_install' ? t('افتحي التطبيق من أيقونته على الشاشة الرئيسية أول') : ps === 'denied' ? t('مرفوضة: فعّليها من إعدادات التلفون ← الإشعارات ← ليان') : ps === 'unsupported' ? t('هالمتصفح ما يدعم الإشعارات') : undefined;
  return (
    <SettingsRow icon="bell" tint={tint} label={t('الإشعارات على هالتلفون')} sub={why} subTone={why ? 'warn' : undefined}
      end={ps === 'on' ? <span className="shrink-0 text-[15px] font-semibold text-ok">✓ {t('شغّال')}</span>
        : ps === 'off' ? <Switch on={false} disabled={busy} label={t('الإشعارات على هالتلفون')} onChange={() => void on()} /> : undefined} />
  );
}

/** Which of the other parent's entries she is told about; each one taps on or off. */
/** This phone's notifications in simple mode: off → one tap turns them on (the phone asks for permission). */
function PhonePushChoice() {
  const [ps, setPs] = useState<PushState | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { void pushState().then(setPs); }, []);
  if (!ps || ps === 'on') return ps === 'on' ? <Choice icon="🔔" label={t('الإشعارات على هالتلفون')} sub={t('شغّال')} on onClick={() => undefined} /> : null;
  const sub = ps === 'needs_install' ? t('افتحي التطبيق من أيقونته على الشاشة الرئيسية أول') : ps === 'denied' ? t('مرفوضة: فعّليها من إعدادات التلفون ← الإشعارات ← ليان') : ps === 'unsupported' ? t('هالمتصفح ما يدعم الإشعارات') : t('طافي · اضغطي للتشغيل');
  const on = async () => {
    if (ps !== 'off' || busy) return;
    setBusy(true);
    try { setPs(await enablePush()); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return <Choice icon="🔕" label={t('الإشعارات على هالتلفون')} sub={sub} onClick={() => void on()} color="#d6303c" />;
}

export function MomActivity() {
  const { members, me, reload } = useData();
  const m = members.find((x) => x.user_id === me);
  const [busy, setBusy] = useState(false);
  const flip = async (k: ActivityKind) => {
    setBusy(true);
    try { await setActivityPush(m, k, !activityOn(m, k)); await reload(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  return (
    <MomPage title={t('أخبرني لما يسجّل غيري')} back="/mom/more">
      <PhonePushChoice />
      {ACTIVITY_KINDS.map((a) => (
        <Choice key={a.k} icon={a.icon} label={t(a.label)} on={activityOn(m, a.k)} sub={activityOn(m, a.k) ? t('شغّال') : t('طافي')} onClick={() => { if (!busy) void flip(a.k); }} />
      ))}
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

/** Appearance on this phone: Auto follows the phone (iPhone Settings → Display), or always light / always dark. */
function Appearance() {
  const [p, setP] = useState<ThemePref>(themePref);
  const opts: [ThemePref, string, string][] = [['auto', '◐', t('تلقائي')], ['day', '☀︎', t('فاتح')], ['night', '☾', t('داكن')]];
  return (
    <div className="px-4 py-3">
      <div className="flex items-center justify-between"><span className="text-[17px] font-semibold">{t('المظهر')}</span><span className="text-[13px] text-slate-400">{p === 'auto' ? t('يتبع إعداد التلفون') : ''}</span></div>
      <div role="radiogroup" aria-label={t('المظهر')} className="mt-2 grid grid-cols-3 gap-1 rounded-2xl bg-slate-100 p-1">
        {opts.map(([v, ic, l]) => <button key={v} role="radio" aria-checked={p === v} onClick={() => { setP(v); setThemePref(v); }}
          className={'flex min-h-[44px] items-center justify-center gap-1.5 rounded-xl text-[15px] font-bold ' + (p === v ? 'bg-white text-brand shadow-sm' : 'text-slate-500')}><span aria-hidden>{ic}</span>{l}</button>)}
      </div>
    </div>
  );
}
