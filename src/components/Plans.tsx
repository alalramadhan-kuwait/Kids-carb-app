// Planned meals on screen: the plan sheet (make it the evening before), the line on Now, the "Planned" list on Meals,
// and the check that turns a plan into what really happened: dose (approved by a parent) → eat time → she ate. A plan
// is on hold until then; a low first is treated first (with the plan's juice, if it has one).
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { useData } from '../lib/data';
import { approveDose, ate, deletePlan, planMeal, savePlan, skipPlan, treatFromPlan, usePlanHistory, usePlans } from '../lib/plans';
import { useLiveDose } from '../lib/useLiveDose';
import { eatAt, expectedDose, isFastDrink, phase, planAlerts, remindAt, upcoming, type PlanAlert, type Phase, type Slot } from '../engine/mealPlan';
import { fmt } from '../lib/carbs';
import { formatGlucose, unitLabel } from '../lib/glucose';
import { fmtTime, isoDate, relDay } from '../lib/constants';
import type { DoseSnapshot, PlanItem, PlannedMeal, Product, Recipe } from '../lib/types';
import { ProductPicker } from './ProductPicker';
import { Btn, NumInput, Sheet, cx, inputCls, toast } from './ui';
import { ratioAt } from '../engine/status';
import { Icon } from './Icon';
import { isEn, t, tMaybe, tr } from '../i18n';

const MIN = 60000, KW = 3 * 3600000;
const SLOT = tr({ breakfast: 'الفطور', lunch: 'الغداء', dinner: 'العشاء', snack: 'سناك' }); // i18n-ok: values translated when read
const SLOT_TIME: Record<Slot, string> = { breakfast: '07:00', lunch: '13:00', dinner: '19:00', snack: '16:00' };
const UNIT = tr({ g: 'غ', ml: 'مل', serving: 'حصة', tbsp: 'ملعقة' }) as Record<string, string>; // i18n-ok
const PARTS: [number, string][] = [[1, ''], [0.75, '¾'], [0.5, '½'], [0.25, '¼']];
const clock = (ms: number) => fmtTime(new Date(ms));
const fmtDay = (ms: number) => `${relDay(new Date(ms))} ${clock(ms)}`;
// the phone's own clock, as everywhere else on screen (the ratios stay on Kuwait time, as the care plan is)
const dayOf = (ms: number) => isoDate(new Date(ms));
const hmOf = (ms: number) => { const d = new Date(ms); return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };
const at = (date: string, hm: string) => new Date(`${date}T${hm}:00`).getTime();
const until = (ms: number, now: number) => { const m = Math.max(0, Math.round((ms - now) / MIN)); return m >= 60 ? t('{h} س {m} د', { h: Math.floor(m / 60), m: m % 60 }) : t('{m} د', { m }); };

/** How much of it: "120 غ", "125 مل", "2 حصة (60 غ)" — servings with their weight when the label gives one. */
function amountOf(i: PlanItem, p: Product | null | undefined) {
  const q = fmt(i.quantity);
  const serv = isEn() ? (i.quantity === 1 ? 'serving' : 'servings') : UNIT.serving;
  if (i.unit === 'serving') return `${q} ${serv}${p?.serving_size ? ` (${fmt(Math.round(i.quantity * p.serving_size))} ${UNIT[p.unit]})` : ''}`;
  return `${q} ${UNIT[i.unit] ?? i.unit}`;
}
function itemName(i: PlanItem, products: Product[]) { return i.label ?? products.find((p) => p.id === i.product_id)?.name ?? (i.slot_category ? tMaybe(i.slot_category) : '?'); }
const fromProduct = (p: Product): PlanItem => ({ product_id: p.id, slot_category: null, label: null, quantity: p.unit === 'ml' && (p.pack_size ?? 0) > 0 && (p.pack_size ?? 0) <= 500 ? Number(p.pack_size) : p.serving_size ? 1 : 100, unit: p.unit === 'ml' && (p.pack_size ?? 0) > 0 && (p.pack_size ?? 0) <= 500 ? 'ml' : p.serving_size ? 'serving' : p.unit, state: 'as_is', role: p.category === 'مشروبات' ? 'drink' : 'main' }); // i18n-ok: data value

/** An item given a catalogue product: its name and amount stay; the unit too when the product is measured that way. */
function withProduct(i: PlanItem, p: Product): PlanItem {
  const fits = i.unit === p.unit || (i.unit === 'serving' && !!p.serving_size) || i.unit === 'tbsp';
  const d = fromProduct(p);
  return { ...i, product_id: p.id, slot_category: null, label: i.label ?? i.slot_category, quantity: fits ? i.quantity : d.quantity, unit: fits ? i.unit : d.unit };
}

/* ------------------------------------------------------------ plan sheet */

export interface PlanSeed { name: string; recipe_id: string | null; items: PlanItem[] }

/** Make (or change) a plan: which meal, when the dose is, what's in it. The eat time follows the care team's minutes. */
export function PlanSheet({ open, plan, seed, onClose }: { open: boolean; plan?: PlannedMeal | null; seed?: PlanSeed | null; onClose: () => void }) {
  const { products, recipes, ingsByRecipe, settings, events } = useData();
  const now = Date.now();
  const eatAfter = settings.dose_to_meal_min ?? 0;
  const [name, setName] = useState('');
  const [slot, setSlot] = useState<Slot>('breakfast');
  const [day, setDay] = useState(dayOf(now + 86400000));
  const [time, setTime] = useState(SLOT_TIME.breakfast);
  const [items, setItems] = useState<PlanItem[]>([]);
  const [recipeId, setRecipeId] = useState<string | null>(null);
  const [adding, setAdding] = useState<null | 'product' | 'recipe'>(null);
  const [replacing, setReplacing] = useState<number | null>(null); // the item whose product is being chosen
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (!open) return;
    if (plan) { setName(plan.name); setSlot(plan.slot); setDay(plan.for_date); setTime(hmOf(Date.parse(plan.dose_at))); setItems(plan.items); setRecipeId(plan.recipe_id); }
    else {
      const h = new Date(now).getHours(), s: Slot = h < 10 || h >= 20 ? 'breakfast' : h < 15 ? 'lunch' : 'dinner';
      setSlot(s); setTime(SLOT_TIME[s]); setName(seed?.name ?? ''); setItems(seed?.items ?? []); setRecipeId(seed?.recipe_id ?? null);
      setDay(at(dayOf(now), SLOT_TIME[s]) > now ? dayOf(now) : dayOf(now + 86400000));
    }
    setAdding(null); setReplacing(null);
  }, [open]); // eslint-disable-line react-hooks/exhaustive-deps
  const meal = useMemo(() => planMeal(items, products, settings), [items, products, settings]);
  // what you wrote after the same meal before: shown while planning it again
  const { plans: past } = usePlanHistory();
  const notes = past.filter((p) => p.review_note && p.id !== plan?.id && ((recipeId && p.recipe_id === recipeId) || (name.trim() && p.name === name.trim()))).slice(0, 2);
  const doseAt = at(day, time);
  const lastLow = events.filter((e) => e.kind === 'treatment').map((e) => Date.parse(e.occurred_at)).sort((a, b) => b - a)[0] ?? null;
  const fast = meal.lines.reduce((s, l) => s + (isFastDrink(l.ing, l.product?.category, l.carbs) ? l.carbs ?? 0 : 0), 0);
  const alerts = planAlerts({ block: null, carbs: meal.total.carbs, fat: meal.missing.fat ? null : meal.total.fat, protein: meal.missing.protein ? null : meal.total.protein, maxCarbs: settings.max_meal_carbs, fastDrinkCarbs: fast, lastLowAt: lastLow, now });
  const ratio = ratioAt(settings.ratios ?? [], Math.round(((doseAt + KW) % 86400000) / MIN))?.cr ?? null;
  const exp = expectedDose(meal.total.carbs, ratio, settings.pen_step ?? 1);
  const addRecipe = (r: Recipe) => {
    const ings = ingsByRecipe.get(r.id) ?? [];
    setItems((x) => [...x, ...ings.filter((i) => i.role !== 'snack').map((i) => ({ product_id: i.product_id, slot_category: i.slot_category, label: i.label, quantity: i.quantity, unit: i.unit, state: i.state, role: i.role }))]);
    if (!name.trim()) setName(r.name);
    if (!recipeId) setRecipeId(r.id);
    setAdding(null);
  };
  const save = async () => {
    if (!items.length) return toast(t('أضيفوا صنفًا واحدًا على الأقل'));
    const gap = meal.lines.findIndex((l) => l.carbs === null);
    if (gap >= 0) return toast(t('{name}: الكارب غير معروف. اختاروا منتجه أو احذفوه.', { name: itemName(items[gap], products) }));
    if (doseAt < now - 5 * MIN && !plan) return toast(t('وقت الجرعة مضى'));
    setBusy(true);
    try {
      await savePlan({ id: plan?.id, for_date: day, slot, name: name.trim() || SLOT[slot], recipe_id: recipeId, items, dose_at: new Date(doseAt).toISOString(), eat_after_min: eatAfter, remind_min: 10, note: null });
      toast(t('حُفظت الخطة ✓ (معلّقة حتى التأكيد)')); onClose();
    } catch (e) { toast((e as Error).message); } finally { setBusy(false); }
  };
  const remove = async () => { if (!plan) return; setBusy(true); try { await deletePlan(plan.id); toast(t('حُذفت الخطة')); onClose(); } catch (e) { toast((e as Error).message); } finally { setBusy(false); } };

  return (
    <Sheet open={open} onClose={onClose} title={plan ? t('تعديل الخطة') : t('خطة وجبة')}>
      {adding === 'product' || replacing !== null ? (
        <div className="space-y-2">
          <ProductPicker onPick={(p) => {
            if (replacing !== null) setItems((x) => x.map((it, k) => (k === replacing ? withProduct(it, p) : it)));
            else setItems((x) => [...x, fromProduct(p)]);
            setAdding(null); setReplacing(null);
          }} />
          <Btn block kind="ghost" onClick={() => { setAdding(null); setReplacing(null); }}>{t('رجوع')}</Btn>
        </div>
      ) : adding === 'recipe' ? (
        <div className="space-y-2">
          <ul className="max-h-[60vh] divide-y divide-slate-100 overflow-y-auto">
            {recipes.filter((r) => r.approved).map((r) => <li key={r.id}><button className="min-h-[48px] w-full text-start font-medium" onClick={() => addRecipe(r)}><bdi>{r.name}</bdi></button></li>)}
          </ul>
          <Btn block kind="ghost" onClick={() => setAdding(null)}>{t('رجوع')}</Btn>
        </div>
      ) : (
        <div className="space-y-3">
          <div className="grid grid-cols-4 gap-1 rounded-full bg-slate-100 p-1 text-xs">
            {(['breakfast', 'lunch', 'dinner', 'snack'] as Slot[]).map((s) => <button key={s} onClick={() => { setSlot(s); if (!plan) setTime(SLOT_TIME[s]); }} className={cx('min-h-[36px] rounded-full', slot === s ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{SLOT[s]}</button>)}
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm">
              {[dayOf(now), dayOf(now + 86400000)].map((d, k) => <button key={d} onClick={() => setDay(d)} className={cx('min-h-[36px] rounded-lg', day === d ? 'bg-white font-bold shadow-sm' : 'text-slate-600')}>{k ? t('غدًا') : t('اليوم')}</button>)}
            </div>
            <label className="flex items-center gap-2 text-sm"><span className="shrink-0 text-slate-600">{t('الجرعة')}</span><input type="time" dir="ltr" className={cx(inputCls, '!min-h-[40px]')} value={time} onChange={(e) => setTime(e.target.value)} /></label>
          </div>
          <p className="rounded-xl bg-brand-soft px-3 py-2 text-sm text-brand">
            {t('الجرعة {d} · الأكل {e}', { d: clock(doseAt), e: clock(doseAt + eatAfter * MIN) })}
            <span className="block text-xs">{eatAfter ? t('الأكل بعد الجرعة بـ {m} د (فريق السكري) · تذكير {r}', { m: eatAfter, r: clock(doseAt - 10 * MIN) }) : t('الأكل بعد الجرعة مباشرة · تذكير {r}', { r: clock(doseAt - 10 * MIN) })}</span>
          </p>
          <input className={inputCls} dir="auto" placeholder={SLOT[slot]} value={name} onChange={(e) => setName(e.target.value)} aria-label={t('الاسم')} />
          <ul className="divide-y divide-slate-100">
            {meal.lines.map((l, i) => (
              <li key={i} className="flex items-center gap-2 py-1.5">
                <span className="min-w-0 flex-1"><span className="block truncate text-sm font-medium"><bdi>{itemName(items[i], products)}</bdi></span>
                  {l.carbs === null
                    ? <button onClick={() => setReplacing(i)} className="min-h-[32px] text-xs font-bold text-over underline">{t('الكارب غير معروف · اختيار منتج')}</button>
                    : <span className="text-xs text-slate-500"><span className="num">{fmt(Math.round(l.carbs * 10) / 10)}</span> {t('غ كارب')}</span>}</span>
                <span className="w-20 shrink-0"><NumInput className="!min-h-[40px] !px-1 !text-center" value={items[i].quantity} onChange={(v) => setItems((x) => x.map((it, k) => (k === i ? { ...it, quantity: v ?? 0 } : it)))} /></span>
                <span className="w-9 shrink-0 text-xs text-slate-500">{UNIT[items[i].unit]}</span>
                <button onClick={() => setItems((x) => x.filter((_, k) => k !== i))} aria-label={t('حذف')} className="grid h-10 w-10 shrink-0 place-items-center rounded-full text-slate-500">✕</button>
              </li>
            ))}
          </ul>
          {notes.length > 0 && (
            <ul className="space-y-1 rounded-xl bg-near-soft p-3 text-sm">
              {notes.map((p) => <li key={p.id}><span className="text-xs text-slate-500">{t('ملاحظتك بعد {when}:', { when: fmtDay(Date.parse(p.eating_at ?? p.dose_at)) })}</span> <bdi>{p.review_note}</bdi></li>)}
            </ul>
          )}
          <div className="flex gap-4 text-sm font-bold text-brand">
            <button className="min-h-[40px]" onClick={() => setAdding('recipe')}>{t('+ وصفة')}</button>
            <button className="min-h-[40px]" onClick={() => setAdding('product')}>{t('+ منتج')}</button>
          </div>
          {items.length > 0 && (
            <div className="flex items-baseline justify-between rounded-xl bg-slate-50 px-3 py-2">
              <span className="text-sm text-slate-600">{t('المجموع')}</span>
              <span><b className="num text-xl">{fmt(Math.round(meal.total.carbs * 10) / 10)}</b> <span className="text-sm text-slate-500">{t('غ كارب')}</span>{exp !== null && <span className="block text-end text-xs text-slate-500">{t('الجرعة المتوقعة ~{u} و · تُحسب نهائيًا وقت الجرعة', { u: fmt(exp) })}</span>}</span>
            </div>
          )}
          <Alerts list={alerts} />
          <Btn kind="primary" block disabled={busy || !items.length} onClick={save}>{t('حفظ الخطة')}</Btn>
          {plan && <Btn block disabled={busy} onClick={remove}>{t('حذف الخطة')}</Btn>}
        </div>
      )}
    </Sheet>
  );
}

const ALERT_TEXT = (a: PlanAlert) => ({
  treat_first: t('منخفض أو ينزل بسرعة: عالجوا أولًا حسب خطة الرعاية (15 غ ثم إعادة القياس بعد 15 د). لا جرعة ولا أكل الآن.'),
  no_reading: t('لا قراءة حديثة أو الحساس يسخّن: قيسوا بالوخز أولًا.'),
  gap: t('فاصل الجرعات لم ينتهِ: الجرعة التالية بعد {time}.', { time: a.until ? clock(a.until) : '' }),
  recent_low: t('كان منخفضًا {time} خلال آخر 12 ساعة.', { time: a.at ? clock(a.at) : '' }),
  fast_drink: t('عصير مع الوجبة: يرفع السكر خلال 10–15 د، أسرع من الإنسولين.'),
  over_max: t('فوق الحد الأقصى للكارب في الوجبة.'),
  fatty: t('وجبة دسمة: قد يرتفع السكر بعد 2–5 ساعات.'),
}[a.key]);
function Alerts({ list }: { list: PlanAlert[] }) {
  if (!list.length) return null;
  return (
    <ul className="space-y-1">
      {list.map((a) => <li key={a.key} className={cx('rounded-xl px-3 py-1.5 text-sm', a.tone === 'red' ? 'bg-over-soft font-bold text-over' : 'bg-near-soft text-near')}>{a.tone === 'red' ? '⛔' : '⚠'} {ALERT_TEXT(a)}</li>)}
    </ul>
  );
}

/* ------------------------------------------------------------ the check */

/** The plan, live: her glucose now, what to see first, the doctor's-plan dose to approve, then eating. */
export function PlanCheck({ plan, onClose, onEdit }: { plan: PlannedMeal | null; onClose: () => void; onEdit: (p: PlannedMeal) => void }) {
  return <Sheet open={!!plan} onClose={onClose} title={plan ? `${SLOT[plan.slot]} · ${plan.name}` : ''}>{plan && <CheckBody plan={plan} onClose={onClose} onEdit={onEdit} />}</Sheet>;
}
function CheckBody({ plan, onClose, onEdit }: { plan: PlannedMeal; onClose: () => void; onEdit: (p: PlannedMeal) => void }) {
  const { products, settings, events, reload } = useData();
  const meal = useMemo(() => planMeal(plan.items, products, settings), [plan.items, products, settings]);
  const live = useLiveDose(meal.total.carbs);
  const { now, latest, r } = live;
  const ph: Phase = phase(plan, now);
  const [units, setUnits] = useState<number | null>(null);
  useEffect(() => { if (!r.block) setUnits((u) => (u === null ? r.dose : u)); }, [r.block, r.dose]);
  const [reason, setReason] = useState('');
  // when she started eating: the eat time if "She ate" is tapped within the hour after it, else now (changeable)
  const eatDefault = (() => { const e = eatAt(plan); return now < e ? now : now - e <= 60 * MIN ? e : now; })();
  const [eatHm, setEatHm] = useState<string | null>(null);
  const eatingAt = eatHm ? at(dayOf(eatDefault), eatHm) : eatDefault;
  const snapshot = (): DoseSnapshot | null => {
    const c = live.calc();
    return c ? { ...c, at: new Date(now).toISOString(), level: live.level, reading_at: latest?.taken_at ?? null, dia_min: settings.iob_dia_min, peak_min: settings.iob_peak_min, pen_step: settings.pen_step ?? 1 } : null;
  };
  const [busy, setBusy] = useState(false);
  const unit = settings.glucose_unit, gl = (mg: number) => formatGlucose(mg, unit);
  const lastLow = events.filter((e) => e.kind === 'treatment').map((e) => Date.parse(e.occurred_at)).sort((a, b) => b - a)[0] ?? null;
  const drinks = meal.lines.map((l, i) => ({ i, l })).filter(({ l }) => isFastDrink(l.ing, l.product?.category, l.carbs));
  const alerts = planAlerts({ block: r.block, until: r.until, carbs: meal.total.carbs, fat: meal.missing.fat ? null : meal.total.fat, protein: meal.missing.protein ? null : meal.total.protein, maxCarbs: settings.max_meal_carbs, fastDrinkCarbs: drinks.reduce((s, d) => s + (d.l.carbs ?? 0), 0), lastLowAt: lastLow, now });
  const run = async (f: () => Promise<void>, msg: string) => { setBusy(true); try { await f(); await reload(); toast(msg); } catch (e) { toast((e as Error).message === 'incomplete' ? t('لا يمكن التسجيل: الكارب غير مكتمل') : (e as Error).message); } finally { setBusy(false); } };
  const dosed = plan.status === 'dosed', eatTime = eatAt(plan);
  const treatFirst = r.block === 'low' || r.block === 'falling';

  return (
    <div className="space-y-3">
      {/* where it stands */}
      <p className={cx('rounded-xl px-3 py-2 text-sm font-bold', dosed ? (ph === 'eat_now' ? 'bg-ok-soft text-ok' : 'bg-brand-soft text-brand') : ph === 'later' ? 'bg-slate-100 text-slate-600' : 'bg-near-soft text-near')}>
        {dosed ? (ph === 'eat_now' ? t('وقت الأكل الآن') : t('الأكل {time} · بعد {left}', { time: clock(eatTime), left: until(eatTime, now) }))
          : ph === 'recheck' ? t('عولج الانخفاض · أعيدوا القياس {time} (بعد {left})', { time: clock(Date.parse(plan.recheck_at!)), left: until(Date.parse(plan.recheck_at!), now) })
            : ph === 'later' ? t('معلّقة · الجرعة {d} · الأكل {e}', { d: clock(Date.parse(plan.dose_at)), e: clock(eatTime) })
              : t('حان وقت الفحص · الجرعة {d}', { d: clock(Date.parse(plan.dose_at)) })}
      </p>

      {/* glucose now and what's on board */}
      <div className="flex items-baseline justify-between text-sm">
        <span>{latest ? <><b className="num text-2xl">{gl(latest.mg_dl)}</b> <span className="text-slate-500">{unitLabel(unit)} · {t('قراءة {when}', { when: clock(Date.parse(latest.taken_at)) })}</span></> : <span className="text-slate-500">{t('حاسبة الجرعة…')}</span>}</span>
        <span className="text-slate-600">{t('إنسولين نشط {u} و', { u: fmt(Math.round((live.iob ?? 0) * 10) / 10) })}</span>
      </div>

      {/* the meal */}
      <ul className="divide-y divide-slate-100 text-sm">
        {meal.lines.map((l, i) => (
          <li key={i} className="flex items-baseline justify-between gap-2 py-1">
            <span className="min-w-0"><bdi>{itemName(plan.items[i], products)}</bdi> <span className="text-xs text-slate-500">· {amountOf(plan.items[i], l.product)}</span></span>
            <span className="shrink-0"><span className="num">{l.carbs === null ? '—' : fmt(Math.round(l.carbs * 10) / 10)}</span> <span className="text-xs text-slate-500">{t('غ كارب')}</span></span>
          </li>
        ))}
        <li className="flex justify-between gap-2 py-1 font-bold"><span>{t('المجموع')}</span><span className="num">{fmt(Math.round(meal.total.carbs * 10) / 10)} {t('غ')}</span></li>
      </ul>

      {!dosed && <Alerts list={alerts} />}

      {/* low first: treat (with the plan's juice when it has one), recheck in 15 min */}
      {!dosed && treatFirst && (
        <div className="space-y-2">
          {drinks.map(({ i, l }) => (
            <Btn key={i} kind="primary" block disabled={busy} onClick={() => run(() => treatFromPlan(plan, { grams: l.carbs ?? 0, name: itemName(plan.items[i], products), itemIndex: i }), t('سُجّل علاج الانخفاض · أعيدوا القياس بعد 15 د'))}>
              {t('علاج بـ {x} من الخطة ({g} غ)', { x: itemName(plan.items[i], products), g: fmt(Math.round((l.carbs ?? 0) * 10) / 10) })}
            </Btn>
          ))}
          <Btn block disabled={busy} onClick={() => run(() => treatFromPlan(plan, { grams: 15, name: t('عصير') }), t('سُجّل علاج الانخفاض · أعيدوا القياس بعد 15 د'))}>{t('علاج آخر: 15 غ')}</Btn>
        </div>
      )}

      {/* the dose: the calculator's (doctor's numbers), the parent can change it */}
      {!dosed && !r.block && (
        <div className="space-y-2 rounded-2xl bg-slate-50 p-3">
          <div className="text-sm text-slate-600">
            {t('الأكل {c} ÷ {cr} = {f}', { c: fmt(Math.round(meal.total.carbs * 10) / 10), cr: fmt(live.ratio!.cr), f: (Math.round(r.food * 10) / 10).toFixed(1) })}
            {' · '}{t('التصحيح {x}', { x: (r.correction + r.iobUsed >= 0 ? '+' : '−') + (Math.round(Math.abs(r.correction + r.iobUsed) * 10) / 10).toFixed(1) })}
            {r.iobUsed > 0 && <> · {t('نشط −{x}', { x: (Math.round(r.iobUsed * 10) / 10).toFixed(1) })}</>}
          </div>
          <div className="flex items-baseline justify-between rounded-xl bg-white px-3 py-2">
            <span className="text-sm text-slate-600">{t('الجرعة المحسوبة (إعدادات الطبيب)')}</span>
            <b className="num text-xl">{t('{u} و', { u: fmt(r.dose) })}</b>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex-1 text-sm font-medium">{t('الجرعة التي قررتُ إعطاءها')}</span>
            <button className="grid h-11 w-11 place-items-center rounded-full bg-white text-xl shadow-sm" onClick={() => setUnits((u) => Math.max(0, (u ?? r.dose) - (settings.pen_step ?? 1)))} aria-label="−">−</button>
            <b className="num w-12 text-center text-2xl">{fmt(units ?? r.dose)}</b>
            <button className="grid h-11 w-11 place-items-center rounded-full bg-white text-xl shadow-sm" onClick={() => setUnits((u) => (u ?? r.dose) + (settings.pen_step ?? 1))} aria-label="+">+</button>
          </div>
          {(units ?? r.dose) !== r.dose && (
            <input className={inputCls} dir="auto" maxLength={200} placeholder={t('لماذا تختلف؟ (اختياري)')} value={reason} onChange={(e) => setReason(e.target.value)} aria-label={t('لماذا تختلف؟ (اختياري)')} />
          )}
          {(units ?? r.dose) > 0 && (
            <Btn kind="primary" block disabled={busy} onClick={() => run(() => approveDose(plan, { given: units ?? r.dose, calc: r.dose, reason: (units ?? r.dose) !== r.dose ? reason : null, purpose: live.purpose, snapshot: snapshot(), carbs: meal.total.carbs }), t('سُجّلت الجرعة · الأكل بعد {m} د', { m: plan.eat_after_min }))}>
              {t('أعطِ {u} وحدة الآن · الأكل {time}', { u: fmt(units ?? r.dose), time: clock(Date.now() + plan.eat_after_min * MIN) })}
            </Btn>
          )}
          <p className="text-[11px] text-slate-500">{t('من خطة الطبيب. راجعوا الرقم قبل الإعطاء؛ الرياضة والمرض والأكل غير المسجّل غير محسوبة.')}</p>
        </div>
      )}

      {/* she ate: logged now, scaled to what she ate */}
      {(dosed || (!treatFirst && r.block !== null) || (!r.block && (units ?? r.dose) === 0)) && (
        <div className="space-y-1.5">
          <label className="flex items-center justify-between gap-2 text-sm">
            <span className="text-slate-600">{t('بدأت الأكل')}</span>
            <input type="time" dir="ltr" className={cx(inputCls, '!min-h-[40px] !w-36')} value={eatHm ?? hmOf(eatDefault)} onChange={(e) => setEatHm(e.target.value || null)} aria-label={t('بدأت الأكل')} />
          </label>
          <div className="text-sm font-medium text-slate-600">{dosed ? t('أكلت:') : t('تسجيل الأكل بدون جرعة:')}</div>
          <div className="grid grid-cols-4 gap-1.5">
            {PARTS.map(([f, l]) => <Btn key={f} kind={f === 1 ? 'primary' : 'soft'} disabled={busy} onClick={() => run(() => ate(plan, f, Math.min(eatingAt, Date.now()), products, settings), t('سُجّلت الوجبة ✓'))}>{l || t('كلها')}</Btn>)}
          </div>
        </div>
      )}

      <div className="flex justify-between gap-2 pt-1 text-sm">
        {!dosed && <button className="min-h-[44px] font-bold text-brand" onClick={() => { onClose(); onEdit(plan); }}>{t('تعديل الخطة')}</button>}
        <button className="min-h-[44px] text-slate-500" disabled={busy} onClick={() => run(() => skipPlan(plan.id), t('أُلغيت الخطة'))}>{t('لم تُؤكل · إلغاء')}</button>
      </div>
    </div>
  );
}

/* ---------------------------------------------------- Now line & Meals list */

const phaseLine = (p: PlannedMeal, ph: Phase, now: number) =>
  ph === 'eat_now' ? { tone: 'bg-ok-soft text-ok', text: t('وقت الأكل الآن') }
    : ph === 'wait_to_eat' ? { tone: 'bg-brand-soft text-brand', text: t('الأكل {time}', { time: clock(eatAt(p)) }) }
      : ph === 'recheck' ? { tone: 'bg-near-soft text-near', text: t('إعادة القياس {time}', { time: clock(Date.parse(p.recheck_at!)) }) }
        : ph === 'check' ? { tone: 'bg-near-soft text-near', text: t('افحصوا الآن') }
          : { tone: 'bg-slate-100 text-slate-600', text: t('معلّقة') };

function PlanRow({ p, now, onOpen }: { p: PlannedMeal; now: number; onOpen: () => void }) {
  const { products, settings } = useData();
  const carbs = useMemo(() => planMeal(p.items, products, settings).total.carbs, [p.items, products, settings]);
  const ph = phase(p, now), l = phaseLine(p, ph, now);
  return (
    <button onClick={onOpen} className="flex min-h-[56px] w-full items-center gap-3 px-3 py-2 text-start active:bg-slate-50">
      <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-brand-soft text-brand"><Icon name="clock" size={18} /></span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-bold"><bdi>{SLOT[p.slot]} · {p.name}</bdi></span>
        <span className="block text-xs text-slate-500">{t('الجرعة {d} · الأكل {e} · {g} غ', { d: clock(Date.parse(p.dose_at)), e: clock(eatAt(p)), g: fmt(Math.round(carbs * 10) / 10) })}</span>
      </span>
      <span className={cx('shrink-0 rounded-full px-2 py-0.5 text-xs font-bold', l.tone)}>{l.text}</span>
      <span className="text-slate-300">{isEn() ? '›' : '‹'}</span>
    </button>
  );
}

/** The planned meals on Now: one line each, only for the next 12 hours. */
export function PlanLines() {
  const { plans } = usePlans();
  const [now, setNow] = useState(Date.now());
  useEffect(() => { const id = setInterval(() => setNow(Date.now()), 30000); return () => clearInterval(id); }, []);
  const [open, setOpen] = useState<string | null>(null);
  const [edit, setEdit] = useState<PlannedMeal | null>(null);
  // a reminder opens its plan's check (./#/?plan=id)
  const [sp, setSp] = useSearchParams();
  useEffect(() => { const id = sp.get('plan'); if (id) { setOpen(id); setSp({}, { replace: true }); } }, [sp, setSp]);
  const list = upcoming(plans, now);
  if (!list.length && !edit && !open) return null;
  return (
    <>
      {list.length > 0 && <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">{list.map((p) => <li key={p.id}><PlanRow p={p} now={now} onOpen={() => setOpen(p.id)} /></li>)}</ul>}
      <PlanCheck plan={plans.find((p) => p.id === open) ?? null} onClose={() => setOpen(null)} onEdit={setEdit} />
      <PlanSheet open={!!edit} plan={edit} onClose={() => setEdit(null)} />
    </>
  );
}

/** «مخططة» on Meals: today's and tomorrow's plans, and a new one. */
export function PlannedSection() {
  const { plans } = usePlans();
  const nav = useNavigate();
  const now = Date.now();
  const [open, setOpen] = useState<string | null>(null);
  const [sheet, setSheet] = useState<{ plan?: PlannedMeal | null } | null>(null);
  const list = plans.filter((p) => phase(p, now) !== 'done' && p.for_date >= dayOf(now));
  return (
    <section className="mb-4 space-y-2">
      <div className="flex items-center justify-between">
        <h2 className="text-lg font-bold">{t('مخططة')}</h2>
        <span className="flex items-center gap-4">
          <button className="min-h-[40px] text-sm font-bold text-brand" onClick={() => nav('/plans/history')}>{t('السجل')} {isEn() ? '›' : '‹'}</button>
          <button className="min-h-[40px] text-sm font-bold text-brand" onClick={() => setSheet({})}>{t('+ خطة وجبة')}</button>
        </span>
      </div>
      {list.length > 0 ? <ul className="divide-y divide-slate-100 overflow-hidden rounded-2xl border border-slate-100 bg-white">{list.map((p) => <li key={p.id}><PlanRow p={p} now={now} onOpen={() => setOpen(p.id)} /></li>)}</ul>
        : <p className="text-sm text-slate-500">{t('خطّطوا الفطور من الليل: الجرعة ووقت الأكل، وتبقى معلّقة حتى تأكيدها.')}</p>}
      <PlanCheck plan={plans.find((p) => p.id === open) ?? null} onClose={() => setOpen(null)} onEdit={(p) => setSheet({ plan: p })} />
      <PlanSheet open={!!sheet} plan={sheet?.plan ?? null} onClose={() => setSheet(null)} />
    </section>
  );
}

