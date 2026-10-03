import { useEffect, useState } from 'react';
import { createPortal } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { supabase } from '../lib/supabase';
import { useData } from '../lib/data';
import { fetchSeries } from '../engine/useSeries';
import { dayStartOf } from '../engine/day';
import { effectiveRange, formatGlucose, unitLabel, type GlucoseUnit } from '../lib/glucose';
import { fmt, unitText } from '../lib/carbs';
import { fmtTime } from '../lib/constants';
import { AFTER_MIN, DEFAULT_STARTS, SLOT_KEYS, buildDay, type Activity, type DaySheet, type Dose, type Food, type Prick, type SlotKey, type SlotStarts, type Treat } from '../lib/dietSheet';
import type { EventRow, HistoryEntry } from '../lib/types';
import { Alert, Btn, Card, Chip, Page } from '../components/ui';
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
  const { settings } = useData();
  const today = dayStartOf(Date.now());
  const [from, setFrom] = useState(isoDay(today - 6 * DAY));
  const [to, setTo] = useState(isoDay(today));
  const [starts, setStarts] = useState<SlotStarts>(loadStarts);
  const [showTimes, setShowTimes] = useState(false);
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
      const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
      const foods: Food[] = [], treatments: Treat[] = [];
      for (const x of hist) {
        const t0 = Date.parse(x.eaten_at), carbs = Number(x.total_carbs);
        // a drink or snack logged from the products list while she was low is a low treatment, not a meal
        if (x.glucose_mgdl !== null && Number(x.glucose_mgdl) < low && x.kind === 'snack' && carbs <= 30) { treatments.push({ t: t0, name: x.name, carbs }); continue; }
        const l = x.lines?.length === 1 ? x.lines[0] : null;
        foods.push({ t: t0, name: x.name, detail: l && l.unit !== 'serving' && l.quantity ? `${fmt(l.quantity)} ${unitText(l.unit)}` : null,
          carbs, fat: num(x.total_fat), protein: num(x.total_protein), kcal: num(x.total_kcal), fiber: num(x.total_fiber) });
      }
      const doses: Dose[] = [], pricks: Prick[] = [], acts: Activity[] = [];
      for (const x of ev) {
        const t0 = Date.parse(x.occurred_at);
        if (x.kind === 'insulin' && x.insulin_units) doses.push({ t: t0, units: Number(x.insulin_units), type: x.insulin_type === 'long' ? 'long' : 'rapid', purpose: x.bolus_purpose });
        else if (x.kind === 'carbs' && x.carbs_g) foods.push({ t: t0, name: x.note?.trim() || t('كارب'), detail: null, carbs: Number(x.carbs_g), fat: null, protein: null, kcal: null, fiber: null });
        else if (x.kind === 'treatment' && x.carbs_g !== null) treatments.push({ t: t0, name: tMaybe(x.treatment ?? t('علاج انخفاض')), carbs: Number(x.carbs_g) });
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
  }, [from, to, starts, low, high]); // eslint-disable-line react-hooks/exhaustive-deps

  const quick = (n: number) => { setFrom(isoDay(today - (n - 1) * DAY)); setTo(isoDay(today)); };
  const zoom = Math.min(1, (typeof window !== 'undefined' ? window.innerWidth - 32 : 1000) / 1123);
  const pages = sheets?.map((s) => <SheetPage key={s.start} s={s} unit={settings.glucose_unit} low={low} high={high} starts={starts} child={settings.child_name ?? t('ليان')} rapidName={settings.rapid_insulin} basalName={settings.basal_insulin} ratios={settings.ratios} />);

  return (
    <Page title={t('جدول أخصائية التغذية')} back={() => nav(-1)}>
      <div className="space-y-3">
        <Card className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <label className="text-sm"><span className="mb-1 block text-slate-600">{t('من')}</span><input type="date" dir="ltr" className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-2" value={from} max={to} onChange={(e) => setFrom(e.target.value)} /></label>
            <label className="text-sm"><span className="mb-1 block text-slate-600">{t('إلى')}</span><input type="date" dir="ltr" className="min-h-[44px] w-full rounded-xl border border-slate-200 bg-white px-2" value={to} min={from} max={isoDay(today)} onChange={(e) => setTo(e.target.value)} /></label>
          </div>
          <div className="flex flex-wrap gap-1.5">
            {[1, 3, 7, 14].map((n) => <Chip key={n} onClick={() => quick(n)}>{n === 1 ? t('اليوم') : t('آخر {n} أيام', { n })}</Chip>)}
          </div>
          <button onClick={() => setShowTimes(!showTimes)} className="flex min-h-[40px] w-full items-center justify-between text-sm font-medium text-slate-600">
            <span>{t('أوقات الوجبات')}: {SLOT_KEYS.map((k) => `${t(SLOT_LABEL[k])} ${hm(starts[k])}`).join(' · ')}</span><span aria-hidden>{showTimes ? '▴' : '▾'}</span>
          </button>
          {showTimes && (
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
              {SLOT_KEYS.map((k) => (
                <label key={k} className="text-xs"><span className="mb-1 block text-slate-600">{t('{slot} يبدأ', { slot: t(SLOT_LABEL[k]) })}</span>
                  <input type="time" dir="ltr" className="min-h-[40px] w-full rounded-xl border border-slate-200 bg-white px-2" value={hm(starts[k])}
                    onChange={(e) => { const v = toMin(e.target.value); if (Number.isFinite(v)) setStarts({ ...starts, [k]: v }); }} /></label>
              ))}
              <button className="col-span-2 text-start text-xs font-bold text-brand sm:col-span-5" onClick={() => setStarts(DEFAULT_STARTS)}>{t('الأوقات الافتراضية')}</button>
            </div>
          )}
          {tooMany && <Alert tone="near">{t('31 يومًا كحد أقصى في المرة الواحدة.')}</Alert>}
          {err && <Alert tone="over">{err}</Alert>}
          <Btn kind="primary" block disabled={!sheets?.length || busy} onClick={() => window.print()}>{busy ? t('جارٍ التجهيز…') : t('حفظ PDF ({n} صفحة)', { n: sheets?.length ?? 0 })}</Btn>
          <p className="text-xs leading-relaxed text-slate-500">{t('كل يوم في صفحة A4 أفقية. في شاشة الطباعة على الآيفون: اضغطوا مشاركة ← حفظ في الملفات، أو أرسلوها بالواتساب. إذا لم تظهر شاشة الطباعة من التطبيق، افتحوه في Safari.')}</p>
        </Card>
        {/* preview, scaled to the screen */}
        <div className="space-y-3 overflow-hidden" style={{ zoom } as React.CSSProperties}>{pages}</div>
      </div>
      {sheets && createPortal(<div id="print-root" dir={isEn() ? 'ltr' : 'rtl'}>{pages}</div>, document.body)}
    </Page>
  );
}

// ── one day, one A4 landscape page ─────────────────────────────────────────────────────────────────────────────
const C = { ink: '#261E5C', ink2: '#625A87', ink3: '#9084A9', line: '#E4DCF9', soft: '#F4EFFD', brand: '#5B48D6', bg: '#FFFDFD',
  ok: '#1F7A55', high: '#8F5A00', low: '#B83A44', okDot: '#46B98A', highDot: '#F2A541', lowDot: '#E95F68', band: '#E3F5EC', ins: '#2E7CD6', carb: '#C2408F' };
const tone = (mg: number, low: number, high: number) => (mg < low ? C.low : mg > high ? C.high : C.ok);

function SheetPage({ s, unit, low, high, starts, child, rapidName, basalName, ratios }: {
  s: DaySheet; unit: GlucoseUnit; low: number; high: number; starts: SlotStarts; child: string; rapidName: string | null; basalName: string | null; ratios: { from: string; cr: number; isf: number }[];
}) {
  const g = (mg: number) => formatGlucose(mg, unit);
  const u = tMaybe(unitLabel(unit));
  const date = new Date(s.start + 3 * 3600000);
  const dayName = date.toLocaleDateString(locale(), { weekday: 'long', timeZone: 'UTC' });
  const dateText = date.toLocaleDateString(locale(), { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC', numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);
  const hours = (ms: number) => { const h = ms / 3600000; return t('{h} س', { h: Math.round(h * 2) / 2 }); };
  const cell: React.CSSProperties = { border: `1px solid ${C.line}`, padding: '1.6mm 2mm', verticalAlign: 'top' };
  const head: React.CSSProperties = { ...cell, background: C.soft, fontWeight: 700, color: C.brand, textAlign: 'center', fontSize: '10.5pt' };
  const label: React.CSSProperties = { ...cell, background: C.soft, fontWeight: 700, fontSize: '9pt', width: '30mm', color: C.ink };
  const small: React.CSSProperties = { fontSize: '7.5pt', color: C.ink2 };
  const empty = <span style={{ color: C.ink3 }}>—</span>;

  return (
    <section className="diet-page" style={{ width: '281mm', height: '193mm', background: C.bg, color: C.ink, fontFamily: "'Rubik', system-ui, sans-serif", fontSize: '9pt', boxSizing: 'border-box', padding: '0', display: 'flex', flexDirection: 'column', gap: '2.5mm', overflow: 'hidden' }}>
      <header style={{ display: 'flex', alignItems: 'center', gap: '3mm', borderBottom: `2px solid ${C.brand}`, paddingBottom: '2mm' }}>
        <img src={`${import.meta.env.BASE_URL}icons/layan-logo-256.webp`} alt="" style={{ width: '13mm', height: '13mm', borderRadius: '3mm' }} />
        <div style={{ flex: 1 }}>
          <div style={{ fontSize: '14pt', fontWeight: 700, color: C.brand }}>{t('جدول التغذية اليومي')} · {child}</div>
          <div style={{ fontSize: '10pt', fontWeight: 600 }}>{t('اليوم')}: {dayName} · {t('التاريخ')}: {dateText}</div>
        </div>
        <div style={{ ...small, textAlign: 'end', lineHeight: 1.5 }}>
          <div>{t('السكر بوحدة {u} · النطاق {a}–{b}', { u, a: g(low), b: g(high) })}</div>
          <div>{t('«بعد الأكل» = بعد ساعتين من بداية الوجبة · ✱ وخز إصبع')}</div>
        </div>
      </header>

      <table style={{ width: '100%', borderCollapse: 'collapse', tableLayout: 'fixed' }}>
        <thead>
          <tr>
            <th style={{ ...head, width: '30mm' }} />
            {SLOT_KEYS.map((k) => <th key={k} style={head}>{t(SLOT_LABEL[k])} <span style={{ ...small, fontWeight: 400 }}>{hm(starts[k])}</span></th>)}
          </tr>
        </thead>
        <tbody>
          <tr style={{ height: '30mm' }}>
            <td style={label}>{t('الوجبة')}</td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{x.foods.length ? x.foods.map((f, i) => (
              <div key={i} style={{ marginBottom: '1mm', lineHeight: 1.3 }}><b style={{ fontWeight: 600 }}>{f.name}</b>{f.detail ? <span style={small}> · {f.detail}</span> : null}<span style={small}> · {time(f.t)}</span></div>
            )) : empty}</td>)}
          </tr>
          <tr>
            <td style={label}>{t('كمية الكربوهيدرات')}</td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{x.foods.length ? <>
              <div style={{ fontSize: '12pt', fontWeight: 700, color: C.carb }}>{t('{g} غ', { g: fmt(x.carbs) })}</div>
              <div style={small}>{[x.fat !== null ? t('دهون {g} غ', { g: fmt(x.fat) }) : null, x.protein !== null ? t('بروتين {g} غ', { g: fmt(x.protein) }) : null, x.fiber ? t('ألياف {g} غ', { g: fmt(x.fiber) }) : null, x.kcal !== null ? t('{n} سعرة', { n: Math.round(x.kcal) }) : null].filter(Boolean).join(' · ')}</div>
            </> : empty}</td>)}
          </tr>
          <tr>
            <td style={label}>{t('قراءة السكر قبل الأكل')}</td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{x.before ? <>
              <span style={{ fontSize: '12pt', fontWeight: 700, color: tone(x.before.mg, low, high) }}>{g(x.before.mg)}</span>{x.before.prick ? ' ✱' : ''}
              <div style={small}>{time(x.before.t)}</div>
            </> : x.foods.length ? <span style={small}>{t('لا قراءة')}</span> : empty}</td>)}
          </tr>
          <tr>
            <td style={label}>{t('قراءة السكر بعد الأكل')}<div style={{ ...small, fontWeight: 400 }}>{t('بعد ساعتين')}</div></td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{x.after ? <>
              <span style={{ fontSize: '12pt', fontWeight: 700, color: tone(x.after.mg, low, high) }}>{g(x.after.mg)}</span>
              {x.before && <span style={{ ...small, fontWeight: 600 }}> ({x.after.mg >= x.before.mg ? '+' : '−'}{g(Math.abs(x.after.mg - x.before.mg))})</span>}
              <div style={small}>{time(x.after.t)}{x.afterNextMeal ? ' · ' + t('بعد بدء الوجبة التالية') : ''}</div>
            </> : x.foods.length ? <span style={small}>{x.start !== null && x.start + AFTER_MIN * MIN > Date.now() ? t('لم تمر ساعتان') : t('لا قراءة')}</span> : empty}</td>)}
          </tr>
          <tr>
            <td style={label}>{t('الإنسولين')}{rapidName ? <div style={{ ...small, fontWeight: 400 }}>{rapidName}</div> : null}</td>
            {s.slots.map((x) => <td key={x.key} style={cell}>{x.doses.length ? x.doses.map((d, i) => (
              <div key={i}><b style={{ color: C.ins, fontSize: '11pt' }}>{t('{u} وحدة', { u: fmt(d.units) })}</b> <span style={small}>{time(d.t)}{d.purpose === 'correction' ? ' · ' + t('تصحيح') : d.purpose === 'both' ? ' · ' + t('وجبة + تصحيح') : ''}</span></div>
            )) : x.foods.length ? <span style={small}>{t('لم تُسجّل جرعة')}</span> : empty}</td>)}
          </tr>
          <tr>
            <td style={label}>{t('ملاحظات')}</td>
            {s.slots.map((x) => <td key={x.key} style={{ ...cell, fontSize: '8pt', lineHeight: 1.35 }}>
              {x.fatty && <div style={{ color: C.high, fontWeight: 600 }}>🍕 {t('وجبة دسمة: دهون {f} غ · بروتين {p} غ', { f: fmt(x.fat ?? 0), p: fmt(x.protein ?? 0) })}</div>}
              {x.bump && <div style={{ color: C.low, fontWeight: 600 }}>⤴ {t('ارتفاع متأخر +{d} بعد {h} ({a} ← {b})', { d: g(x.bump.rise), h: hours(x.bump.peakAt - x.start!), a: g(x.bump.fromMg), b: g(x.bump.toMg) })}</div>}
              {x.fatty && !x.bump && x.start !== null && x.start + 5 * 3600000 < Date.now() && <div style={small}>{t('لم يظهر ارتفاع متأخر')}</div>}
              {x.noFatData && <div style={small}>{t('لا توجد قيم دهون مسجّلة')}</div>}
            </td>)}
          </tr>
        </tbody>
      </table>

      <div style={{ display: 'flex', gap: '3mm', flex: 1, minHeight: 0 }}>
        <div style={{ flex: '1.25', border: `1px solid ${C.line}`, borderRadius: '2mm', padding: '1.5mm 2mm', display: 'flex', flexDirection: 'column' }}>
          <div style={{ fontWeight: 700, color: C.brand, marginBottom: '1mm' }}>{t('السكر خلال اليوم')}</div>
          <DayChart s={s} low={low} high={high} unit={unit} />
          <div style={{ ...small, display: 'flex', gap: '3mm', flexWrap: 'wrap' }}>
            <span><b style={{ color: C.carb }}>▲</b> {t('أكل')}</span><span><b style={{ color: C.ins }}>▮</b> {t('إنسولين سريع')}</span><span><b style={{ color: C.lowDot }}>●</b> {t('علاج انخفاض')}</span><span style={{ background: C.band, padding: '0 1.5mm' }}>{t('النطاق')}</span>
          </div>
        </div>
        <div style={{ flex: 1, border: `1px solid ${C.line}`, borderRadius: '2mm', padding: '1.5mm 2.5mm', lineHeight: 1.45, overflow: 'hidden' }}>
          <div style={{ fontWeight: 700, color: C.brand }}>{t('ملخص اليوم')}</div>
          <div>{t('الكارب')}: <b>{t('{g} غ', { g: fmt(s.totals.carbs) })}</b>{s.totals.fat !== null ? ` · ${t('دهون {g} غ', { g: fmt(s.totals.fat) })}` : ''}{s.totals.protein !== null ? ` · ${t('بروتين {g} غ', { g: fmt(s.totals.protein) })}` : ''}{s.totals.kcal !== null ? ` · ${t('{n} سعرة', { n: Math.round(s.totals.kcal) })}` : ''}</div>
          <div>{t('الإنسولين السريع')}: <b>{t('{u} وحدة', { u: fmt(s.totals.rapid) })}</b>{s.otherDoses.length ? ` (${t('منها خارج الوجبات')}: ${s.otherDoses.map((d) => `${fmt(d.units)} · ${time(d.t)}`).join(sep())})` : ''}</div>
          <div>{t('الإنسولين الطويل')}{basalName ? ` (${basalName})` : ''}: <b>{s.basal.length ? s.basal.map((d) => `${t('{u} وحدة', { u: fmt(d.units) })} · ${time(d.t)}`).join(sep()) : t('لم يُسجّل')}</b></div>
          <div>{t('السكر')}: {s.glucose.mean !== null ? <>{t('المتوسط')} <b>{g(s.glucose.mean)}</b> · {t('في النطاق')} <b style={{ color: C.ok }}>{s.glucose.inRange}%</b> · {t('تحت')} <b style={{ color: C.low }}>{s.glucose.below}%</b> · {t('فوق')} <b style={{ color: C.high }}>{s.glucose.above}%</b> · {g(s.glucose.min!)}–{g(s.glucose.max!)}</> : t('لا قراءات')}</div>
          <div>{t('الانخفاضات')}: {s.lows.length ? s.lows.map((l) => `${time(l.t)} (${g(l.nadir)}${sep()}${t('{m} د', { m: l.minutes })})`).join(sep()) : t('لا يوجد')}</div>
          <div>{t('علاج الانخفاض')}: {s.treatments.length ? s.treatments.map((x) => `${tMaybe(x.name)} ${t('{g} غ', { g: fmt(x.carbs) })} · ${time(x.t)}`).join(sep()) : t('لا يوجد')}</div>
          {s.night.length > 0 && <div>{t('أكل بعد منتصف الليل')}: {s.night.map((f) => `${f.name} ${t('{g} غ', { g: fmt(f.carbs) })} · ${time(f.t)}`).join(sep())}</div>}
          {s.activities.length > 0 && <div>{t('نشاط وملاحظات')}: {s.activities.map((x) => `${x.text} · ${time(x.t)}`).join(sep())}</div>}
          {ratios.length > 0 && <div style={small}>{t('المسجّل في التطبيق من الفريق الطبي')}: {ratios.map((r) => `${r.from} CR 1:${fmt(r.cr)} · ISF ${g(r.isf)}`).join(' | ')}</div>}
          <div style={{ ...small, marginTop: '1mm', borderTop: `1px dashed ${C.line}`, paddingTop: '1mm' }}>{t('ملاحظات الأهل')}: ………………………………………………………………</div>
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
