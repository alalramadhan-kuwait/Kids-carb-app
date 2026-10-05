import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { fetchSeries } from '../engine/useSeries';
import { dayStartOf } from '../engine/day';
import { effectiveRange, formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { UNIT_TEXT, fmt, unitText } from '../lib/carbs';
import { displayName } from '../lib/shortName';
import { foodName, untranslated } from '../lib/foodName';
import { usePortions } from '../lib/mom';
import { Icon } from '../components/Icon';
import { fmtTime } from '../lib/constants';
import { AFTER_MIN, DEFAULT_STARTS, SLOT_KEYS, buildDay, type Activity, type DaySheet, type Dose, type Flag, type Food, type Line, type Occasion, type Slot, type Sum, type Prick, type SlotKey, type SlotStarts, type Treat } from '../lib/dietSheet';
import type { EventRow, HistoryEntry, Portion, Product, Unit } from '../lib/types';
import { Alert, Card, Page, cx } from '../components/ui';
import { SharePdf } from '../components/SharePdf';
import { makePdf } from '../lib/pdfShare';
import { isEn, locale, t, tMaybe } from '../i18n';

const MIN = 60000, DAY = 86400000;
const STARTS_KEY = 'diet-sheet-starts';
const SLOT_LABEL: Record<SlotKey, string> = { breakfast: 'الإفطار', snack1: 'سناك 1', lunch: 'الغداء', snack2: 'سناك 2', dinner: 'العشاء' }; // i18n-ok: shown through t()
const isoDay = (t: number) => new Date(t + 3 * 3600000).toISOString().slice(0, 10);       // Kuwait date of a day start
const dayFromIso = (s: string) => Date.parse(s + 'T00:00:00+03:00');
const hm = (min: number) => `${String(Math.floor(min / 60)).padStart(2, '0')}:${String(min % 60).padStart(2, '0')}`;
const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + (m || 0); };
const time = (t: number) => fmtTime(new Date(t));
const sep = () => (isEn() ? ', ' : '\u060C ');   // a list comma in the reader's language

function loadStarts(): SlotStarts {
  try { const j = JSON.parse(localStorage.getItem(STARTS_KEY) ?? 'null'); if (j && SLOT_KEYS.every((k) => typeof j[k] === 'number')) return j; } catch { /* default */ }
  return DEFAULT_STARTS;
}

/**
 * جدول أخصائية التغذية: one A4 landscape page per day in the dietitian's own layout (five meals × meal, carbs,
 * glucose before, glucose 2 hours after, insulin), with fat, protein, fatty-meal and late-rise notes, and the day's
 * totals, glucose and graph. Printed or saved as PDF from the phone's print sheet.
 */
export default function DietSheetPage() {
  const nav = useNavigate();
  const { settings, products, recipes } = useData();
  const { portions } = usePortions();
  const today = dayStartOf(Date.now());
  const [from, setFrom] = useState(isoDay(today - 6 * DAY));
  const [to, setTo] = useState(isoDay(today));
  const [starts, setStarts] = useState<SlotStarts>(loadStarts);
  const [showTimes, setShowTimes] = useState(false);
  const [custom, setCustom] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const [boxW, setBoxW] = useState(0);
  useLayoutEffect(() => {
    const el = box.current; if (!el) return;
    const ro = new ResizeObserver(() => setBoxW(el.clientWidth)); ro.observe(el); setBoxW(el.clientWidth);
    return () => ro.disconnect();
  }, []);
  // phone: cards; wide screen: the table. The choice is kept on this phone.
  const wide = typeof window !== 'undefined' && window.innerWidth >= 900;
  const [view, setView] = useState<'cards' | 'table'>(() => { try { const v = localStorage.getItem('diet-sheet-view'); if (v === 'cards' || v === 'table') return v; } catch { /* default */ } return wide ? 'table' : 'cards'; });
  const pickView = (v: 'cards' | 'table') => { setView(v); try { localStorage.setItem('diet-sheet-view', v); } catch { /* not kept */ } };
  const [sheets, setSheets] = useState<DaySheet[] | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const rng = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const low = rng.low ?? 70, high = rng.high ?? 180;

  const a = dayFromIso(from), b = dayFromIso(to);
  const days = Number.isFinite(a) && Number.isFinite(b) && b >= a ? Math.round((b - a) / DAY) + 1 : 0;
  const tooMany = days > 31;

  useEffect(() => { try { localStorage.setItem(STARTS_KEY, JSON.stringify(starts)); } catch { /* not kept */ } }, [starts]);

  useEffect(() => {
    if (!days || tooMany) { setSheets(null); return; }
    let live = true;
    setBusy(true); setErr('');
    (async () => {
      const start = a, end = b + DAY, after = end + 6 * 3600000;   // the late rise after dinner runs past midnight
      const [h, e, series] = await Promise.all([
        supabase.from('meal_history').select('*').gte('eaten_at', new Date(start).toISOString()).lt('eaten_at', new Date(after).toISOString()).order('eaten_at').limit(3000),
        supabase.from('events').select('*').is('deleted_at', null).gte('occurred_at', new Date(start - 3600000).toISOString()).lt('occurred_at', new Date(after).toISOString()).order('occurred_at').limit(5000),
        fetchSeries(start, after),
      ]);
      if (h.error || e.error) throw new Error((h.error ?? e.error)!.message);
      const hist = (h.data ?? []) as HistoryEntry[], ev = (e.data ?? []) as EventRow[];
      // what the plans add: the meal type, the part eaten, and which dose was for which meal
      const ids = hist.map((x) => x.id), recipeIds = [...new Set(hist.map((x) => x.recipe_id).filter((x): x is string => !!x))];
      const [pl, rc, ri] = await Promise.all([
        ids.length ? supabase.from('planned_meals').select('history_id,slot,part_eaten,carbs_planned,dose_event_id,eating_at').or(`history_id.in.(${ids.join(',')}),and(history_id.is.null,status.eq.eaten,eating_at.gte.${new Date(start).toISOString()},eating_at.lt.${new Date(after).toISOString()})`) : Promise.resolve({ data: [], error: null }),
        recipeIds.length ? supabase.from('recipes').select('id,carb_pending').in('id', recipeIds) : Promise.resolve({ data: [], error: null }),
        recipeIds.length ? supabase.from('recipe_ingredients').select('recipe_id,qty_confirmed,product_id,slot_category').in('recipe_id', recipeIds) : Promise.resolve({ data: [], error: null }),
      ]);
      type PlanRow = { history_id: string | null; slot: string; part_eaten: number | null; carbs_planned: number | null; dose_event_id: string | null; eating_at: string | null };
      const plans = (pl.data ?? []) as PlanRow[];
      // a plan whose entry was deleted and logged again has no link: it is the entry eaten within 10 minutes of its time
      for (const r of plans) if (!r.history_id && r.eating_at) {
        const at = Date.parse(r.eating_at);
        const m = hist.filter((x) => !plans.some((q) => q.history_id === x.id) && Math.abs(Date.parse(x.eaten_at) - at) <= 10 * 60000).sort((a, b) => Math.abs(Date.parse(a.eaten_at) - at) - Math.abs(Date.parse(b.eaten_at) - at))[0];
        if (m) r.history_id = m.id;
      }
      const planOf = new Map(plans.filter((r) => r.history_id).map((r) => [r.history_id!, r]));
      const doseFor = new Map(plans.filter((r) => r.dose_event_id && r.history_id).map((r) => [r.dose_event_id!, r.history_id!]));
      const unsure = new Set<string>([
        ...((rc.data ?? []) as { id: string; carb_pending: boolean }[]).filter((r) => r.carb_pending).map((r) => r.id),
        ...((ri.data ?? []) as { recipe_id: string; qty_confirmed: boolean | null; product_id: string | null; slot_category: string | null }[]).filter((r) => r.qty_confirmed === false || (!r.product_id && !r.slot_category)).map((r) => r.recipe_id),
      ]);
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      const productFor = (key: string | null, name: string) => products.find((p) => key && [p.name, p.brand].filter(Boolean).join(' — ') === key) ?? products.find((p) => p.name === name) ?? null;
      const slotKey = (x: string | undefined): Food['slot'] => (x === 'breakfast' || x === 'lunch' || x === 'dinner' || x === 'snack' ? x : null);
      const foods: Food[] = [], treatments: Treat[] = [];
      for (const x of hist) {
        const t0 = Date.parse(x.eaten_at), carbs = Number(x.total_carbs);
        const plan = planOf.get(x.id);
        const imported = x.source === 'gluroo';
        const flags: Flag[] = [];
        if (imported) flags.push('imported');
        if (x.needs_review) flags.push('review');
        if (x.recipe_id && unsure.has(x.recipe_id)) flags.push('recipe');
        const lines: Line[] = (x.lines ?? []).map((l) => {
          const p = productFor(l.product ?? null, l.name);
          return { name: p ? foodName(p) : l.name, named: !!p && !untranslated(p), quantity: imported && l.unit === 'serving' && l.quantity === 1 ? null : l.quantity ?? null, unit: l.unit ?? null, carbs: l.carbs ?? null, productKey: l.product ?? null };
        });
        // the meal's own name: its recipe, or its one product, in the page's language
        const rec = x.recipe_id ? recipes.find((r) => r.id === x.recipe_id) : null;
        const one = !rec && (x.lines ?? []).length === 1 ? productFor(x.lines[0].product ?? null, x.lines[0].name) : null;
        const own = rec ?? one ?? productFor(null, x.name);
        const note = x.notes && !/^gluroo\b/i.test(x.notes.trim()) ? x.notes.trim() : null;
        foods.push({ t: t0, id: x.id, name: own ? foodName(own) : x.name, named: !!own && !untranslated(own), detail: null, carbs, fat: num(x.total_fat), protein: num(x.total_protein), kcal: num(x.total_kcal), fiber: num(x.total_fiber),
          slot: slotKey(plan?.slot), planned: !!plan, recipe: !!x.recipe_id, lines, note, flags, partEaten: num(plan?.part_eaten), carbsPlanned: num(plan?.carbs_planned) });
      }
      const doses: Dose[] = [], pricks: Prick[] = [], acts: Activity[] = [];
      for (const x of ev) {
        const t0 = Date.parse(x.occurred_at);
        if (x.kind === 'insulin' && x.insulin_units) {
          const c = x.dose_calc;
          doses.push({ t: t0, id: x.id, units: Number(x.insulin_units), type: x.insulin_type === 'long' ? 'long' : 'rapid', purpose: x.bolus_purpose, forFood: doseFor.get(x.id) ?? null,
            calc: c ? { food: Number(c.food), correction: Number(c.correction), carbs: c.carbs ?? null, suggested: c.suggested ?? null } : null });
        }
        else if (x.kind === 'carbs' && x.carbs_g) foods.push({ t: t0, id: x.id, name: x.note?.trim() || t('كارب'), detail: null, carbs: Number(x.carbs_g), fat: null, protein: null, kcal: null, fiber: null, flags: x.note?.trim() ? [] : ['unnamed'] });
        else if (x.kind === 'treatment' && x.carbs_g !== null) {
          const tp = x.treatment ? productFor(null, x.treatment) : null;   // logged from the products list as a low treatment
          treatments.push({ t: t0, name: tp ? foodName(tp) : tMaybe(x.treatment ?? t('علاج انخفاض')), named: !!tp && !untranslated(tp), carbs: Number(x.carbs_g) });
        }
        else if (x.kind === 'bg_check' && x.bg_mgdl) pricks.push({ t: t0, mg: Number(x.bg_mgdl) });
        else if (x.kind === 'exercise') acts.push({ t: t0, text: t('رياضة {m} د', { m: x.activity_min ?? 0 }) + (x.note ? ` · ${x.note}` : '') });
        else if (x.kind === 'sleep' && x.ends_at) acts.push({ t: t0, text: t('نوم {a} – {b}', { a: time(t0), b: time(Date.parse(x.ends_at)) }) });
        else if (x.kind === 'note' && x.note) acts.push({ t: t0, text: x.note });
      }
      const out: DaySheet[] = [];
      for (let d = a; d <= b; d += DAY) out.push(buildDay(d, starts, { foods, doses, pricks, treatments, activities: acts, series: { t: series.t, v: series.v }, low, high }));
      if (live) setSheets(out);
    })().catch((x) => { if (live) setErr((x as Error).message); }).finally(() => { if (live) setBusy(false); });
    return () => { live = false; };
  }, [from, to, starts, low, high, products.length, recipes.length, isEn()]); // eslint-disable-line react-hooks/exhaustive-deps

  const span = days && to === isoDay(today) ? days : 0;   // which quick period is showing (0: custom dates)
  const quick = (n: number) => { setFrom(isoDay(today - (n - 1) * DAY)); setTo(isoDay(today)); setCustom(false); };
  const zoom = boxW ? Math.min(1, boxW / 1065) : 0.3; // the A4 page (281 mm ≈ 1062 px) fitted to the width it has
  const ctx: Ctx = { g: (mg: number) => formatGlucose(mg, settings.glucose_unit), low, high, products, portions };
  const pageOf = (s: DaySheet) => <SheetPage key={s.start} s={s} unit={settings.glucose_unit} low={low} high={high} child={settings.child_name ?? t('ليان')} rapidName={settings.rapid_insulin} basalName={settings.basal_insulin} ratios={settings.ratios} ctx={ctx} />;
  const pages = sheets?.map(pageOf);
  const seg = (on: boolean) => cx('min-h-[40px] rounded-full px-3 text-sm font-bold', on ? 'bg-brand text-white' : 'text-slate-600');

  return (
    <Page title={t('جدول أخصائية التغذية')} back={() => nav(-1)} wide={view === 'table'}>
      <div ref={box} className="space-y-3">
        <Card className="space-y-3">
          {/* the period: four quick choices, or your own dates */}
          <div className="grid grid-cols-4 gap-1 rounded-full bg-slate-50 p-1" role="radiogroup" aria-label={t('الفترة')}>
            {[1, 3, 7, 14].map((n) => <button key={n} role="radio" aria-checked={!custom && span === n} onClick={() => quick(n)} className={seg(!custom && span === n)}>{n === 1 ? t('اليوم') : t('{n} أيام', { n })}</button>)}
          </div>
          <button onClick={() => setCustom(!custom)} className="flex min-h-[36px] w-full items-center justify-between text-sm text-slate-600">
            <span>{t('من {a} إلى {b}', { a: niceDay(dayFromIso(from)), b: niceDay(dayFromIso(to)) })}</span><span className="font-bold text-brand">{custom ? t('تم') : t('تواريخ أخرى')}</span>
          </button>
          {custom && (
            <div className="grid grid-cols-2 gap-2">
              <label className="text-sm"><span className="mb-1 block text-slate-600">{t('من')}</span><input type="date" dir="ltr" className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-2" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
              <label className="text-sm"><span className="mb-1 block text-slate-600">{t('إلى')}</span><input type="date" dir="ltr" className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-2" value={to} min={from} max={isoDay(today)} onChange={(e) => setTo(e.target.value)} /></label>
            </div>
          )}
          {tooMany && <Alert tone="near">{t('31 يومًا كحد أقصى في المرة الواحدة.')}</Alert>}
          {err && <Alert tone="over">{err}</Alert>}
          <SharePdf className="w-full" disabled={!sheets?.length || busy} filename={`layan-food-sheet-${from}-${to}.pdf`} title={t('جدول التغذية اليومي')}
            make={() => makePdf(Array.from(document.querySelectorAll<HTMLElement>('#print-root .diet-page')), { orientation: 'landscape', fit: 'page' })} />
          <p className="text-center text-xs text-slate-500">{busy ? t('جارٍ التجهيز…') : sheets ? t('PDF للطباعة: {n} صفحة A4، صفحة لكل يوم', { n: sheets.length }) : ''}</p>
          <details className="text-sm" open={showTimes} onToggle={(e) => setShowTimes((e.target as HTMLDetailsElement).open)}>
            <summary className="min-h-[36px] cursor-pointer py-1 text-slate-600">{t('أوقات الوجبات')}</summary>
            <div className="grid grid-cols-2 gap-2 pt-1 sm:grid-cols-5">
              {SLOT_KEYS.map((k) => (
                <label key={k} className="text-xs"><span className="mb-1 block text-slate-600">{t('{slot} يبدأ', { slot: t(SLOT_LABEL[k]) })}</span>
                  <input type="time" dir="ltr" className="min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-2" value={hm(starts[k])}
                    onChange={(e) => { const v = toMin(e.target.value); if (Number.isFinite(v)) setStarts({ ...starts, [k]: v }); }} /></label>
              ))}
              <button className="col-span-2 text-start text-xs font-bold text-brand sm:col-span-5" onClick={() => setStarts(DEFAULT_STARTS)}>{t('الأوقات الافتراضية')}</button>
            </div>
          </details>
        </Card>

        {/* how to look at it: cards on a phone, the dietitian's table on a wide screen; either can be chosen */}
        {sheets && sheets.length > 0 && (
          <div className="grid grid-cols-2 gap-1 rounded-full bg-slate-100 p-1" role="radiogroup" aria-label={t('العرض')}>
            <button role="radio" aria-checked={view === 'cards'} onClick={() => pickView('cards')} className={seg(view === 'cards')}>📱 {t('بطاقات')}</button>
            <button role="radio" aria-checked={view === 'table'} onClick={() => pickView('table')} className={seg(view === 'table')}>🖥️ {t('جدول')}</button>
          </div>
        )}
        {view === 'cards'
          ? <div className="space-y-3">{[...(sheets ?? [])].reverse().map((s) => <DayCard key={s.start} s={s} unit={settings.glucose_unit} low={low} high={high} ctx={ctx} />)}</div>
          : <div className="space-y-3 overflow-hidden" style={{ zoom } as React.CSSProperties}>{pages}</div>}
      </div>
      {sheets && createPortal(<div id="print-root" dir={isEn() ? 'ltr' : 'rtl'}>{pages}</div>, document.body)}
    </Page>
  );
}

const niceDay = (ms: number) => Number.isFinite(ms) ? new Date(ms + 3 * 3600000).toLocaleDateString(locale(), { day: 'numeric', month: 'short', timeZone: 'UTC', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions) : '—';

// ── shared words for both views ──────────────────────────────────────────────────────────────────────────────
type Ctx = { g: (mg: number) => string; low: number; high: number; products: Product[]; portions: Portion[] };
const FLAG_TEXT: Record<Flag, string> = { estimate: 'تقديري', imported: 'مستورد', review: 'يحتاج مراجعة', recipe: 'وصفة غير مؤكدة', unnamed: 'غير مسمّى', duplicate: 'مكرر؟' }; // i18n-ok: shown through t()
const AFF_TEXT = { food: 'أكل', treatment: 'علاج', correction: 'تصحيح' } as const; // i18n-ok: shown through t()
const r1 = (x: number) => Math.round(x * 10) / 10;
/** A name in the page's language when the dictionary has it, without pack sizes; † when shown as typed. */
function nameOf(raw: string): { text: string; asTyped: boolean } {
  const text = displayName(tMaybe(raw));
  const ar = /[\u0600-\u06FF]/.test(text), lat = /[A-Za-z]{3}/.test(text);
  return { text, asTyped: isEn() ? ar : lat && !ar };
}
const Name = ({ raw, named }: { raw: string; named?: boolean }) => { const n = nameOf(raw); return <><bdi>{n.text}</bdi>{n.asTyped && !named ? <sup>†</sup> : null}</>; };
const roundQ = (q: number) => (q < 10 ? Math.round(q * 2) / 2 : Math.round(q));
/** "150 ml (~½ cup)": the amount eaten, and a household measure only when one of her saved portions is within 15 %. */
function amountOf(l: Line, ctx: Ctx): string | null {
  if (l.quantity === null || !Number.isFinite(l.quantity)) return null;
  const u = l.unit as Unit | null;
  let out = `${fmt(roundQ(l.quantity))} ${u && UNIT_TEXT[u] ? unitText(u) : ''}`.trim();
  if (u === 'g' || u === 'ml') {
    const p = ctx.products.find((x) => [x.name, x.brand].filter(Boolean).join(' — ') === l.productKey) ?? ctx.products.find((x) => x.name === l.name);
    const near = p && ctx.portions.find((x) => x.product_id === p.id && x.amount > 0 && Math.abs(x.amount - l.quantity!) / x.amount <= 0.15);
    if (near) out += ` (~${tMaybe(near.label)})`;
  }
  return out;
}
const carbsText = (c: number | null) => (c === null ? '—' : t('{g} غ', { g: fmt(c < 10 ? r1(c) : Math.round(c)) }));
const sumText = (x: Sum, u: string) => (x.v === null ? null : `${x.partial ? '≥ ' : ''}${fmt(Math.round(x.v))} ${u}`);
function doseWords(d: Dose, o: Occasion): string[] {
  const out: string[] = [];
  const m = Math.round((o.t - d.t) / MIN);
  out.push(m >= 0 ? t('قبل الأكل {m} د', { m }) : t('بعد الأكل {m} د', { m: -m }));
  if (d.calc && d.calc.food + d.calc.correction > 0) out.push(t('وجبة {a} + تصحيح {b}', { a: fmt(r1(d.calc.food)), b: fmt(r1(d.calc.correction)) }));
  if (d.calc?.suggested != null && d.calc.suggested !== d.units) out.push(t('المحسوب {c} · أُعطي {g}', { c: fmt(d.calc.suggested), g: fmt(d.units) }));
  if (d.calc?.carbs != null && Math.abs(d.calc.carbs - o.carbs) > 2) out.push(t('محسوبة لـ {g} غ', { g: fmt(Math.round(d.calc.carbs)) }));
  if (d.purpose === 'correction') out.push(t('تصحيح فقط'));
  else if (!d.purpose && !d.calc) out.push(t('الغرض غير مسجّل'));
  return out;
}
const affectedText = (o: Occasion) => (o.affected.length ? t('متأثرة: {x}', { x: o.affected.map((x) => `${t(AFF_TEXT[x.kind])} ${time(x.t)}`).join(sep()) }) : null);
const lowAfterText = (o: Occasion, g: (mg: number) => string) => (o.lowAfter ? t('انخفاض بعد الأكل: {v} · {time} ({m} د)', { v: g(o.lowAfter.mg), time: time(o.lowAfter.t), m: Math.round((o.lowAfter.t - o.t) / MIN) }) : null);
const occFlags = (o: Occasion) => [...new Set(o.foods.flatMap((f) => f.flags ?? []))];
const partText = (f: Food) => (f.partEaten != null && f.partEaten > 0 && f.partEaten < 1 ? t('أكلت {p} من {g} غ', { p: f.partEaten === 0.75 ? '¾' : f.partEaten === 0.5 ? '½' : f.partEaten === 0.25 ? '¼' : `${Math.round(f.partEaten * 100)}%`, g: fmt(Math.round(f.carbsPlanned ?? 0)) }) : null);
const treatLine = (x: Treat, g: (mg: number) => string) => [
  x.startMg != null ? t('عند البدء {v}', { v: g(x.startMg) }) : null,
  x.lowestMg != null ? t('أدنى {v}', { v: g(x.lowestMg) }) : null,
  x.after15 != null ? t('بعد 15 د: {v}', { v: g(x.after15) }) : null,
  x.followedByFood ? t('تبعها أكل') : null,
].filter(Boolean).join(' · ');

/** The phone view of one day: each time she ate (food, carbs, glucose before → 2 h after, insulin), the low treatments, the day. */
function DayCard({ s, unit, low, high, ctx }: { s: DaySheet; unit: GlucoseUnit; low: number; high: number; ctx: Ctx }) {
  const g = ctx.g;
  const toneCls = (mg: number) => (mg < low ? 'text-over' : mg > high ? 'text-near' : 'text-ok');
  const date = new Date(s.start + 3 * 3600000);
  const title = date.toLocaleDateString(locale(), { weekday: 'long', day: 'numeric', month: 'long', timeZone: 'UTC', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
  if (!s.recorded) return <Card className="flex items-center justify-between"><b>{title}</b><span className="text-sm text-slate-500">{t('غير مسجّل')}</span></Card>;
  const eaten = s.slots.filter((x) => x.occasions.length);
  const hours = (ms: number) => t('{h} س', { h: Math.round((ms / 3600000) * 2) / 2 });
  const pill = (label: string, v: string, cls = '') => <span className="rounded-full bg-slate-50 px-2.5 py-1 text-xs text-slate-600">{label} <b className={cx('num', cls)}>{v}</b></span>;
  const chip = (text: string, cls = 'bg-slate-100 text-slate-600') => <span className={cx('rounded-full px-2 py-0.5 text-xs font-bold', cls)}>{text}</span>;
  return (
    <Card className="space-y-3">
      <div>
        <h2 className="text-lg font-bold">{title}</h2>
        {s.cgmFrom && <p className="text-xs text-slate-500">{t('يوم ناقص: الحساس من {t}', { t: time(s.cgmFrom) })}</p>}
        <div className="mt-1.5 flex flex-wrap gap-1.5">
          {pill(t('أكل'), t('{g} غ', { g: fmt(Math.round(s.totals.carbs)) }), 'text-kcarb')}
          {s.totals.treatmentCarbs > 0 && pill(t('علاج'), t('{g} غ', { g: fmt(Math.round(s.totals.treatmentCarbs)) }), 'text-over')}
          {pill(t('إنسولين سريع'), t('{u} و', { u: fmt(s.totals.rapid) }), 'text-kins')}
          {s.glucose.inRange !== null && pill(t('في النطاق'), `${s.glucose.inRange}%`, 'text-ok')}
          {s.lows.length > 0 && pill(t('انخفاضات'), String(s.lows.length), 'text-over')}
        </div>
      </div>
      {eaten.length === 0 ? <p className="text-sm text-slate-500">{t('لا وجبات مسجّلة')}</p> : (
        <ul className="divide-y divide-slate-100 rounded-2xl border border-slate-100">
          {eaten.map((x) => (
            <li key={x.key} className="space-y-2 px-3 py-2.5">
              <div className="text-sm font-bold text-brand">{t(SLOT_LABEL[x.key])}</div>
              {x.occasions.map((o) => (
                <div key={o.t} className="space-y-1">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="min-w-0 text-sm leading-snug"><b className="num">{time(o.t)}</b> · {o.foods.map((f, i) => <span key={i}>{i ? sep() : ''}<Name raw={f.name} named={f.named} /></span>)}</span>
                    <b className="num shrink-0 text-kcarb">{carbsText(o.carbs)}</b>
                  </div>
                  <details className="text-xs text-slate-600">
                    <summary className="cursor-pointer text-brand">{t('المكوّنات')}</summary>
                    <ul className="mt-1 space-y-0.5">
                      {o.foods.flatMap((f) => (f.lines?.length ? f.lines : [{ name: f.name, quantity: null, unit: null, carbs: f.carbs, productKey: null }]).map((l, i) => (
                        <li key={f.t + ':' + i} className="flex justify-between gap-2"><span><Name raw={l.name} named={l.named} />{' · '}{amountOf(l, ctx) ?? <span className="text-slate-400">{t('كمية غير مسجّلة')}</span>}</span><span className="num">{carbsText(l.carbs)}</span></li>
                      )))}
                      {o.foods.map((f) => partText(f)).filter(Boolean).map((p, i) => <li key={'p' + i}>{p}</li>)}
                      {o.foods.filter((f) => f.note).map((f, i) => <li key={'n' + i}>{t('ملاحظة')}: <bdi>{f.note}</bdi></li>)}
                    </ul>
                  </details>
                  <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
                    <span className="text-slate-500">{t('قبل')} {o.before ? <b className={cx('num', toneCls(o.before.mg))}>{g(o.before.mg)}{o.before.prick ? '*' : ''}</b> : '—'}
                      {' · '}{t('بعد ساعتين')} {o.after ? <b className={cx('num', toneCls(o.after.mg))}>{g(o.after.mg)}</b> : <span className="text-xs">{o.t + AFTER_MIN * MIN > Date.now() ? t('لم تمر ساعتان') : '—'}</span>}</span>
                    <span className="flex items-center gap-1 text-slate-500"><Icon name="insulin" size={14} />{o.doses.length ? o.doses.map((d, i) => <b key={i} className="num text-kins">{i ? ' + ' : ''}{t('{u} و', { u: fmt(d.units) })}</b>) : <span className="text-xs">{t('لم تُسجّل جرعة')}</span>}</span>
                  </div>
                  {o.doses.length > 0 && <div className="text-xs text-slate-500">{o.doses.flatMap((d) => doseWords(d, o)).join(' · ')}</div>}
                  <div className="flex flex-wrap gap-1.5">
                    {o.startedLow && chip(t('بدأت وهي منخفضة'), 'bg-over-soft text-over')}
                    {lowAfterText(o, g) && chip(lowAfterText(o, g)!, 'bg-over-soft text-over')}
                    {affectedText(o) && chip(affectedText(o)!)}
                    {o.fatty && chip(t('دسمة: دهون {f} غ', { f: fmt(Math.round(o.fat.v ?? 0)) }), 'bg-near-soft text-near')}
                    {o.bump && chip(t('ارتفاع متأخر +{d} بعد {h}', { d: g(o.bump.rise), h: hours(o.bump.peakAt - o.t) }), 'bg-over-soft text-over')}
                    {occFlags(o).map((f) => <span key={f}>{chip(t(FLAG_TEXT[f]))}</span>)}
                  </div>
                </div>
              ))}
            </li>
          ))}
        </ul>
      )}
      {s.treatments.length > 0 && (
        <div className="rounded-2xl border border-over/30 px-3 py-2.5">
          <div className="text-sm font-bold text-over">{t('علاج الانخفاض')} · {t('المجموع {g} غ', { g: fmt(Math.round(s.totals.treatmentCarbs)) })}</div>
          <ul className="mt-1 space-y-1 text-sm">
            {s.treatments.map((x, i) => (
              <li key={i}><b className="num">{time(x.t)}</b> · <Name raw={x.name} named={x.named} /> <b className="num">{carbsText(x.carbs)}</b>
                <div className="text-xs text-slate-500">{treatLine(x, g)}{x.byCgm ? ` · ${t('حسب الحساس')}` : ''}{x.duplicate ? ` · ${t('مكرر؟')}` : ''}</div></li>
            ))}
          </ul>
        </div>
      )}
      <div className="flex flex-col"><DayChart s={s} low={low} high={high} unit={unit} /></div>
      <details className="text-sm">
        <summary className="min-h-[36px] cursor-pointer py-1 font-bold text-brand">{t('ملخص اليوم')}</summary>
        <div className="space-y-1 text-slate-700">
          <div>{t('الكارب')}: <b>{t('أكل {a} غ · علاج {b} غ', { a: fmt(Math.round(s.totals.carbs)), b: fmt(Math.round(s.totals.treatmentCarbs)) })}</b>{s.totals.fat !== null ? ` · ${t('دهون')} ${s.totals.partial.fat ? '≥ ' : ''}${fmt(Math.round(s.totals.fat))} ${t('غ')}` : ''}{s.totals.kcal !== null ? ` · ${s.totals.partial.kcal ? '≥ ' : ''}${t('{n} سعرة', { n: Math.round(s.totals.kcal) })}` : ''}</div>
          {s.glucose.mean !== null && <div>{t('السكر')}: {t('المتوسط')} <b>{g(s.glucose.mean)}</b> · {t('تحت')} <b className="text-over">{s.glucose.below}%</b> · {t('فوق')} <b className="text-near">{s.glucose.above}%</b></div>}
          <div>{t('الإنسولين الطويل')}: <b>{s.basal.length ? s.basal.map((d) => `${t('{u} وحدة', { u: fmt(d.units) })} · ${time(d.t)}`).join(sep()) : t('لم يُسجّل')}</b></div>
          {s.otherDoses.length > 0 && <div>{t('منها خارج الوجبات')}: {s.otherDoses.map((d) => `${fmt(d.units)} · ${time(d.t)}`).join(sep())}</div>}
          <div>{t('الانخفاضات')}: {s.lows.length ? s.lows.map((l) => `${time(l.t)} (${g(l.nadir)})`).join(sep()) : t('لا يوجد')}</div>
          {s.night.length > 0 && <div>{t('أكل بعد منتصف الليل')}: {s.night.map((f) => `${nameOf(f.name).text} ${carbsText(f.carbs)} · ${time(f.t)}`).join(sep())}</div>}
          {s.activities.length > 0 && <div>{t('نشاط وملاحظات')}: {s.activities.map((x) => `${x.text} · ${time(x.t)}`).join(sep())}</div>}
        </div>
      </details>
    </Card>
  );
}

// ── one day, one A4 landscape page ─────────────────────────────────────────────────────────────────────────────
const C = { ink: '#261E5C', ink2: '#625A87', ink3: '#9084A9', line: '#E4DCF9', soft: '#F4EFFD', brand: '#5B48D6', bg: '#FFFDFD',
  ok: '#1F7A55', high: '#8F5A00', low: '#B83A44', okDot: '#46B98A', highDot: '#F2A541', lowDot: '#E95F68', band: '#E3F5EC', ins: '#2E7CD6', carb: '#C2408F' };
const tone = (mg: number, low: number, high: number) => (mg < low ? C.low : mg > high ? C.high : C.ok);

function SheetPage({ s, unit, low, high, child, rapidName, basalName, ratios, ctx }: {
  s: DaySheet; unit: GlucoseUnit; low: number; high: number; child: string; rapidName: string | null; basalName: string | null; ratios: { from: string; cr: number; isf: number }[]; ctx: Ctx;
}) {
  const g = ctx.g;
  // a busy day: shrink step by step until the page fits (never cut treatments, lows, insulin or readings)
  const ref = useRef<HTMLElement>(null);
  const [dense, setDense] = useState(0);
  useLayoutEffect(() => {
    const el = ref.current; if (!el) return;
    if (dense < 3 && el.scrollHeight / el.offsetWidth > 193 / 281 + 0.005) setDense(dense + 1);
  });
  const u = tMaybe(unitLabel(unit));
  const date = new Date(s.start + 3 * 3600000);
  const dayName = date.toLocaleDateString(locale(), { weekday: 'long', timeZone: 'UTC' });
  const dateText = date.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
  const hours = (ms: number) => { const h = ms / 3600000; return t('{h} س', { h: Math.round(h * 2) / 2 }); };
  const base = dense >= 2 ? 7.4 : 8.4;
  const cell: React.CSSProperties = { border: `1px solid ${C.line}`, padding: '1.2mm 1.6mm', verticalAlign: 'top', fontSize: `${base}pt`, lineHeight: 1.3 };
  const head: React.CSSProperties = { ...cell, background: C.soft, fontWeight: 700, color: C.brand, textAlign: 'center', fontSize: '10.5pt' };
  const label: React.CSSProperties = { ...cell, background: C.soft, fontWeight: 700, fontSize: '8.5pt', width: '24mm', color: C.ink };
  const small: React.CSSProperties = { fontSize: `${base - 1.2}pt`, color: C.ink2 };
  const empty = <span style={{ color: C.ink3 }}>—</span>;
  const rule: React.CSSProperties = { borderTop: `1px dashed ${C.line}`, marginTop: '1mm', paddingTop: '1mm' };
  const maxLines = dense >= 3 ? 3 : dense >= 1 ? 5 : 99;
  const perOcc = (x: Slot, f: (o: Occasion) => React.ReactNode) => x.occasions.length ? x.occasions.map((o, i) => <div key={o.t} style={i ? rule : undefined}>{f(o)}</div>) : empty;
  const tm = (o: Occasion) => <b style={{ color: C.ink }}>{time(o.t)} </b>;
  const flagWords = (o: Occasion) => occFlags(o).map((f) => t(FLAG_TEXT[f]));

  if (!s.recorded) return (
    <section ref={ref} className="diet-page" style={{ width: '281mm', minHeight: '193mm', background: C.bg, color: C.ink, fontFamily: "'Rubik', system-ui, sans-serif", display: 'grid', placeItems: 'center' }}>
      <div style={{ fontSize: '14pt', fontWeight: 700 }}>{dayName} · {dateText} — {t('غير مسجّل')}</div>
    </section>
  );
  return (
    <section ref={ref} className="diet-page" style={{ width: '281mm', minHeight: '193mm', background: C.bg, color: C.ink, fontFamily: "'Rubik', system-ui, sans-serif", fontSize: '9pt', boxSizing: 'border-box', padding: '0', display: 'flex', flexDirection: 'column', gap: '2mm' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '3mm', borderBottom: `2px solid ${C.brand}`, paddingBottom: '1.5mm' }}>
        <img src={`${import.meta.env.BASE_URL}icons/layan-logo-256.webp`} alt="" style={{ width: '12mm', height: '12mm', borderRadius: '3mm' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14pt', fontWeight: 700, color: C.brand }}>{t('جدول التغذية اليومي')} · {child}</div>
          <div style={{ fontSize: '10pt', fontWeight: 600 }}>{dayName} · {dateText}{s.cgmFrom ? ` · ${t('يوم ناقص: الحساس من {t}', { t: time(s.cgmFrom) })}` : ''}</div>
        </div>
        <div style={{ fontSize: '7pt', color: C.ink2, textAlign: 'end', lineHeight: 1.45 }}>
          <div>{t('السكر بوحدة {u} · النطاق {a}–{b}', { u, a: g(low), b: g(high) })}</div>
          <div>{t('بعد ساعتين = الحساس بعد ساعتين من أول لقمة')} · {t('* وخز إصبع')}</div>
          <div>{t('† كما كتبها الأهل')}</div>
        </div>
      </header>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr><th style={{ ...head, width: '24mm' }} />{SLOT_KEYS.map((k) => <th key={k} style={head}>{t(SLOT_LABEL[k])}</th>)}</tr>
        </thead>
        <tbody>
          <tr>
            <td style={label}>{t('الأكل')}</td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{perOcc(x, (o) => {
              const lines = o.foods.flatMap((f) => (f.lines?.length ? f.lines : [{ name: f.name, quantity: null, unit: null, carbs: f.carbs, productKey: null }]));
              const big = dense >= 1 ? lines.filter((l) => l.carbs === null || l.carbs >= 1) : lines;
              const tiny = dense >= 1 ? lines.filter((l) => l.carbs !== null && l.carbs < 1) : [];
              const shown = big.slice(0, maxLines);
              return <>
                <div>{tm(o)}<b style={{ color: C.carb, fontSize: `${base + 2}pt` }}>{carbsText(o.carbs)}</b>{o.foods.map((f) => partText(f)).filter(Boolean).map((p, i) => <span key={i} style={small}> · {p}</span>)}</div>
                {o.foods.length > 1 || (o.foods[0].lines?.length ?? 0) > 1 ? <div style={{ fontWeight: 600 }}>{o.foods.map((f, i) => <span key={i}>{i ? sep() : ''}<Name raw={f.name} named={f.named} /></span>)}</div> : null}
                {shown.map((l, i) => <div key={i}><Name raw={l.name} named={l.named} /><span style={small}> · {amountOf(l, ctx) ?? t('كمية غير مسجّلة')} · {carbsText(l.carbs)}</span></div>)}
                {big.length > shown.length && <div style={small}>{t('+{n} أخرى', { n: big.length - shown.length })}</div>}
                {tiny.length > 0 && <div style={small}>+ {tiny.map((l) => nameOf(l.name).text).join(sep())} ({t('أقل من 1 غ')})</div>}
                {dense < 2 && <div style={small}>{[sumText(o.fat, t('غ دهون')), sumText(o.protein, t('غ بروتين')), o.fiber.v !== null ? sumText(o.fiber, t('غ ألياف')) : null, o.kcal.v !== null ? `${o.kcal.partial ? '≥ ' : ''}${t('{n} سعرة', { n: Math.round(o.kcal.v) })}` : null].filter(Boolean).join(' · ')}</div>}
              </>;
            })}</td>)}
          </tr>
          <tr>
            <td style={label}>{t('قبل الأكل')}</td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{perOcc(x, (o) => o.before ? <>{tm(o)}<b style={{ fontSize: `${base + 2}pt`, color: tone(o.before.mg, low, high) }}>{g(o.before.mg)}</b>{o.before.prick ? '*' : ''}{o.startedLow && <div style={{ color: C.low, fontWeight: 600 }}>{t('بدأت وهي منخفضة')}</div>}</> : <>{tm(o)}<span style={small}>{t('لا قراءة')}</span></>)}</td>)}
          </tr>
          <tr>
            <td style={label}>{t('بعد ساعتين')}</td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{perOcc(x, (o) => <>
              {tm(o)}{o.after ? <><b style={{ fontSize: `${base + 2}pt`, color: tone(o.after.mg, low, high) }}>{g(o.after.mg)}</b>{o.before && <span style={{ ...small, fontWeight: 600 }}> ({o.after.mg >= o.before.mg ? '+' : '−'}{g(Math.abs(o.after.mg - o.before.mg))})</span>}</> : <span style={small}>{o.t + AFTER_MIN * MIN > Date.now() ? t('لم تمر ساعتان') : t('لا قراءة')}</span>}
              {affectedText(o) && <div style={small}>{affectedText(o)}</div>}
              {lowAfterText(o, g) && <div style={{ color: C.low, fontWeight: 700, borderInlineStart: `2px solid ${C.low}`, paddingInlineStart: '1mm' }}>{lowAfterText(o, g)}</div>}
            </>)}</td>)}
          </tr>
          <tr>
            <td style={label}>{t('الإنسولين')}{rapidName ? <div style={{ ...small, fontWeight: 400 }}>{rapidName}</div> : null}</td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{perOcc(x, (o) => o.doses.length ? o.doses.map((d, i) => (
              <div key={i}>{tm(o)}<b style={{ color: C.ins, fontSize: `${base + 1.5}pt` }}>{t('{u} وحدة', { u: fmt(d.units) })}</b><div style={small}>{doseWords(d, o).join(' · ')}</div></div>
            )) : <>{tm(o)}<span style={small}>{t('لم تُسجّل جرعة')}</span></>)}</td>)}
          </tr>
          <tr>
            <td style={label}>{t('ملاحظات')}</td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{x.occasions.length ? perOcc(x, (o) => <>
              {o.fatty && <div style={{ color: C.high, fontWeight: 600 }}>{t('دسمة: دهون {f} غ', { f: fmt(Math.round(o.fat.v ?? 0)) })}</div>}
              {o.bump && <div style={{ color: C.low, fontWeight: 600 }}>{t('ارتفاع متأخر +{d} بعد {h}', { d: g(o.bump.rise), h: hours(o.bump.peakAt - o.t) })}</div>}
              {o.fatty && !o.bump && o.t + 5 * 3600000 < Date.now() && <div style={small}>{t('لم يظهر ارتفاع متأخر')}</div>}
              {o.noFatData && <div style={small}>{t('لا توجد قيم دهون مسجّلة')}</div>}
              {flagWords(o).length > 0 && <div style={small}>[{flagWords(o).join('] [')}]</div>}
              {o.foods.filter((f) => f.note).map((f, i) => <div key={i} style={small}>{t('ملاحظة')}: <bdi>{f.note}</bdi></div>)}
            </>) : empty}</td>)}
          </tr>
          <tr>
            <td style={{ ...label, color: C.low }}>{t('علاج الانخفاض')}</td>
            <td colSpan={5} style={cell}>{s.treatments.length ? <>
              {s.treatments.map((x, i) => <span key={i} style={{ marginInlineEnd: '3mm', display: 'inline-block' }}><b>{time(x.t)}</b> <Name raw={x.name} named={x.named} /> <b style={{ color: C.low }}>{carbsText(x.carbs)}</b> <span style={small}>({treatLine(x, g)}{x.byCgm ? ` · ${t('حسب الحساس')}` : ''}{x.duplicate ? ` · ${t('مكرر؟')}` : ''})</span></span>)}
              <b> · {t('المجموع {g} غ', { g: fmt(Math.round(s.totals.treatmentCarbs)) })}</b>
            </> : <span style={small}>{t('لا يوجد')}</span>}</td>
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: '3mm', flex: 1, minHeight: dense >= 2 ? '30mm' : '40mm' }}>
        <div style={{ flex: '1.25', border: `1px solid ${C.line}`, borderRadius: '2mm', padding: '1.5mm 2mm', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, color: C.brand, marginBottom: '1mm' }}>{t('السكر خلال اليوم')}</div>
          <DayChart s={s} low={low} high={high} unit={unit} />
          <div style={{ fontSize: '7pt', color: C.ink2, display: 'flex', gap: '3mm', flexWrap: 'wrap' }}>
            <span><b style={{ color: C.carb }}>▲</b> {t('أكل')}</span><span><b style={{ color: C.ins }}>▮</b> {t('إنسولين سريع')}</span><span><b style={{ color: C.lowDot }}>●</b> {t('علاج انخفاض')}</span><span style={{ background: C.band, padding: '0 1.5mm' }}>{t('النطاق')}</span>
          </div>
        </div>
        <div style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: '2mm', padding: '1.5mm 2.5mm', lineHeight: 1.4, fontSize: dense >= 2 ? '7.6pt' : '8.6pt' }}>
          <div style={{ fontWeight: 700, color: C.brand }}>{t('ملخص اليوم')}</div>
          <div>{t('الكارب')}: <b>{t('أكل {a} غ · علاج {b} غ', { a: fmt(Math.round(s.totals.carbs)), b: fmt(Math.round(s.totals.treatmentCarbs)) })}</b>{s.totals.fat !== null ? ` · ${t('دهون')} ${s.totals.partial.fat ? '≥ ' : ''}${fmt(Math.round(s.totals.fat))} ${t('غ')}` : ''}{s.totals.protein !== null ? ` · ${t('بروتين')} ${s.totals.partial.protein ? '≥ ' : ''}${fmt(Math.round(s.totals.protein))} ${t('غ')}` : ''}{s.totals.kcal !== null ? ` · ${s.totals.partial.kcal ? '≥ ' : ''}${t('{n} سعرة', { n: Math.round(s.totals.kcal) })}` : ''}{s.totals.partial.fat || s.totals.partial.kcal ? ` (${t('ناقص')})` : ''}</div>
          <div>{t('الإنسولين السريع')}: <b>{t('{u} وحدة', { u: fmt(s.totals.rapid) })}</b>{s.otherDoses.length ? ` (${t('منها خارج الوجبات')}: ${s.otherDoses.map((d) => `${fmt(d.units)} · ${time(d.t)}`).join(sep())})` : ''}</div>
          <div>{t('الإنسولين الطويل')}{basalName ? ` (${basalName})` : ''}: <b>{s.basal.length ? s.basal.map((d) => `${t('{u} وحدة', { u: fmt(d.units) })} · ${time(d.t)}`).join(sep()) : t('لم يُسجّل')}</b></div>
          <div>{t('السكر')}: {s.glucose.mean !== null ? <>{t('المتوسط')} <b>{g(s.glucose.mean)}</b> · {t('في النطاق')} <b style={{ color: C.ok }}>{s.glucose.inRange}%</b> · {t('تحت')} <b style={{ color: C.low }}>{s.glucose.below}%</b> · {t('فوق')} <b style={{ color: C.high }}>{s.glucose.above}%</b> · {g(s.glucose.min!)}–{g(s.glucose.max!)}</> : t('لا قراءات')}</div>
          <div>{t('الانخفاضات')}: {s.lows.length ? s.lows.map((l) => `${time(l.t)} (${g(l.nadir)}${sep()}${t('{m} د', { m: l.minutes })})`).join(sep()) : t('لا يوجد')}</div>
          {s.night.length > 0 && <div>{t('أكل بعد منتصف الليل')}: {s.night.map((f) => `${nameOf(f.name).text} ${carbsText(f.carbs)} · ${time(f.t)}`).join(sep())}</div>}
          {s.activities.length > 0 && <div>{t('نشاط وملاحظات')}: {s.activities.map((x) => `${x.text} · ${time(x.t)}`).join(sep())}</div>}
          {ratios.length > 0 && <div style={{ fontSize: '7pt', color: C.ink2 }}>{t('المسجّل من الفريق الطبي')}: {ratios.map((r) => `${r.from} · ${t('الوحدة لكل {n} غ كارب', { n: fmt(r.cr) })} · ${t('الوحدة تنزّل السكر ~{v}', { v: g(r.isf) })}`).join(' | ')}</div>}
          <div style={{ fontSize: '7pt', color: C.ink2, marginTop: '1mm', borderTop: `1px dashed ${C.line}`, paddingTop: '1mm' }}>{t('ملاحظات الأهل')}: ………………………………………………………………</div>
        </div>
      </div>
    </section>
  );
}

/** The day's readings (0–24 h) with her range, food, rapid insulin and low treatments. */
function DayChart({ s, low, high, unit }: { s: DaySheet; low: number; high: number; unit: GlucoseUnit }) {
  const W = 600, H = 150, x0 = 18, x1 = W - 4, y0 = 6, y1 = H - 16;
  const lo = 40, hi = Math.max(300, ...s.points.map((p) => p[1]));
  const x = (t: number) => x0 + ((t - s.start) / DAY) * (x1 - x0);
  const y = (mg: number) => y1 - ((Math.min(hi, Math.max(lo, mg)) - lo) / (hi - lo)) * (y1 - y0);
  const foods = s.slots.flatMap((sl) => sl.foods).concat(s.night);
  const doses = s.slots.flatMap((sl) => sl.doses).concat(s.otherDoses);
  return (
    <svg viewBox={`0 0 ${W} ${H}`} style={{ width: '100%', flex: 1, minHeight: 0 }}>
      <rect x={x0} y={y(high)} width={x1 - x0} height={y(low) - y(high)} fill={C.band} />
      {[0, 3, 6, 9, 12, 15, 18, 21, 24].map((h) => (
        <g key={h}><line x1={x(s.start + h * 3600000)} x2={x(s.start + h * 3600000)} y1={y0} y2={y1} stroke={C.line} strokeWidth={0.6} />
          <text x={x(s.start + h * 3600000)} y={H - 4} fontSize={9} fill={C.ink3} textAnchor="middle">{String(h).padStart(2, '0')}</text></g>
      ))}
      {[low, high].map((v) => <text key={v} x={x0 - 2} y={y(v) + 3} fontSize={8} fill={C.ink3} textAnchor="end">{formatGlucose(v, unit)}</text>)}
      {s.points.map(([t0, v], i) => <circle key={i} cx={x(t0)} cy={y(v)} r={1.4} fill={v < low ? C.lowDot : v > high ? C.highDot : C.okDot} />)}
      {foods.map((f, i) => <path key={'f' + i} d={`M${x(f.t)} ${y1 - 7} l-3.5 6 h7 z`} fill={C.carb} />)}
      {doses.map((d, i) => <rect key={'d' + i} x={x(d.t) - 1} y={y1 - 16} width={2.2} height={8} fill={C.ins} />)}
      {s.treatments.map((x2, i) => <circle key={'t' + i} cx={x(x2.t)} cy={y1 - 3} r={3} fill={C.lowDot} />)}
    </svg>
  );
}
