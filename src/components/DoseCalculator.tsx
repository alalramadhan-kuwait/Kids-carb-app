import { useEffect, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { callGlucose } from '../lib/api';
import { formatGlucose, unitLabel, type GlucoseState } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import { kuwaitClock } from '../lib/schedule';
import { carbsFrom, dosesFrom, iobAt, iobParamsOk } from '../engine/iob';
import { ratioAt } from '../engine/status';
import { suggestDose, type DoseBlock } from '../engine/dose';
import { levelFromLibre, trendFrom } from '../engine/trend';
import type { DoseCalc } from '../lib/types';
import { NumInput, cx } from './ui';
import { locale, t } from '../i18n';
import { KIND_STYLE } from '../lib/kinds';

const MIN = 60000;
/** Of the app's arrow and Libre's, the one pointing lower: no dose if either says falling fast. */
const cautious = (a: number | null, b: number | null) => (a === null ? b : b === null ? a : Math.min(a, b));
const n1 = (x: number) => (Math.round(x * 10) / 10).toFixed(1);
const clock = (ms: number) => new Date(ms).toLocaleTimeString(locale(), { hour: 'numeric', minute: '2-digit', hour12: true, numberingSystem: 'latn' } as Intl.DateTimeFormatOptions);

/**
 * Dose calculator inside «سجّل ← إنسولين سريع»: the doctor's plan from Settings, the carbs just eaten (editable),
 * the glucose now and the insulin still working. Shows every step; «استخدم» only fills the field, the parent saves.
 */
export function DoseCalculator({ onUse }: { onUse: (units: number, purpose: 'meal' | 'correction' | 'both', calc: DoseCalc) => void }) {
  const { settings: s, history, events } = useData();
  const [g, setG] = useState<GlucoseState | null>(null);
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const load = () => { setNow(Date.now()); callGlucose({ action: 'status' }).then(setG).catch(() => setG(null)); };
    load();
    const id = setInterval(load, MIN);
    return () => clearInterval(id);
  }, []);

  const doses = useMemo(() => dosesFrom(events), [events]);
  const lastRapidAt = doses.reduce<number | null>((m, d) => (d.t <= now && (m === null || d.t > m) ? d.t : m), null);
  // carbs logged in the last 30 minutes and not yet covered by a rapid dose
  const recentCarbs = useMemo(() => carbsFrom(history, events)
    .filter((c) => c.t <= now && now - c.t <= 30 * MIN && (lastRapidAt === null || c.t > lastRapidAt))
    .reduce((sum, c) => sum + c.grams, 0), [history, events, now, lastRapidAt]);
  const [carbs, setCarbs] = useState<number | null>(null);
  const box = useRef<HTMLElement>(null);
  // when the keyboard opens for the carbs, bring the whole calculator up so its answer stays in view
  const lift = () => window.setTimeout(() => box.current?.scrollIntoView({ block: 'start', behavior: 'smooth' }), 350);
  useEffect(() => { setCarbs((c) => (c === null && recentCarbs > 0 ? Math.round(recentCarbs) : c)); }, [recentCarbs]);

  const iobP = s.iob_dia_min && s.iob_peak_min ? { dia: s.iob_dia_min, peak: s.iob_peak_min } : null;
  const iob = iobParamsOk(iobP) ? iobAt(now, doses, iobP) : null;
  const ratio = ratioAt(s.ratios ?? [], kuwaitClock(now).min);
  const target = s.target_mgdl !== null && s.target_high_mgdl !== null ? { low: s.target_mgdl, high: s.target_high_mgdl } : null;
  const latest = g?.latest ?? null;
  const r = suggestDose({
    now, carbs: carbs ?? 0, ratio, target, lowMg: s.alert_low_mgdl ?? s.glucose_low_mgdl,
    glucose: latest ? { mg: latest.mg_dl, at: Date.parse(latest.taken_at), level: cautious((g ? trendFrom(g.readings, now) : null)?.level ?? null, levelFromLibre(latest.trend)) } : null,
    sensorStartedAt: g?.sensor?.started_at ? Date.parse(g.sensor.started_at) : null,
    iob, lastRapidAt, gapMin: s.dose_gap_min ?? 120, step: s.pen_step ?? 1,
  });
  const unit = s.glucose_unit, gl = (mg: number) => formatGlucose(mg, unit);

  const BLOCK: Record<DoseBlock, string> = {
    no_plan: t('أكملوا خطة الطبيب في الإعدادات: نسبة الكارب، معامل التصحيح، الهدف، ومدة عمل الإنسولين.'),
    recent_dose: t('آخر جرعة سريعة قبل أقل من {h} س. الجرعة التالية بعد {time}.', { h: (s.dose_gap_min ?? 120) / 60, time: r.until ? clock(r.until) : '' }),
    no_reading: t('لا توجد قراءة سكر حديثة (آخر 15 دقيقة). قيسوا بالجهاز أو انتظروا القراءة.'),
    warmup: t('الحساس في ساعة التسخين الأولى. قيسوا بجهاز الوخز.'),
    low: t('السكر منخفض: عالجوا الانخفاض أولًا. لا جرعة الآن.'),
    falling: t('السكر ينزل بسرعة. لا جرعة الآن؛ راقبوا وأعيدوا الحساب بعد قليل.'),
  };

  if (!g) return <div className="rounded-2xl bg-slate-50 p-3 text-sm text-slate-500">{t('حاسبة الجرعة…')}</div>;
  const purpose = r.food > 0 && r.correction > 0 ? 'both' : r.food > 0 ? 'meal' : 'correction';
  return (
    <section ref={box} className="scroll-mt-2 space-y-2 rounded-2xl bg-slate-50 p-3" aria-label={t('حاسبة الجرعة')}>
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-bold">{t('حاسبة الجرعة')}</h3>
        {ratio && target && <span className="text-xs text-slate-500">{t('كارب {cr} غ/وحدة · تصحيح {isf} · هدف {lo}–{hi}', { cr: fmt(ratio.cr), isf: gl(ratio.isf), lo: '\u2066' + gl(target.low), hi: gl(target.high) + '\u2069' /* keep the range left to right in Arabic */ })}</span>}
      </div>
      <label className="flex items-center gap-3">
        <span className="flex-1 text-sm text-slate-600">{t('كارب الوجبة (غ)')}</span>
        <NumInput value={carbs} onChange={setCarbs} onFocus={lift} enterKeyHint="done" className="!w-24 !text-center" aria-label={t('كارب الوجبة (غ)')} />
        {/* the answer right next to what is being typed, visible even with the keyboard up */}
        {!r.block && <b className="num w-16 shrink-0 text-end text-lg">= {fmt(r.dose)}</b>}
      </label>
      {r.block ? (
        <p className={cx('text-sm font-medium', r.block === 'low' || r.block === 'falling' ? 'text-over' : 'text-slate-700')}>
          {BLOCK[r.block]} {r.block === 'no_plan' && <Link to="/settings" className="text-brand underline">{t('الإعدادات')}</Link>}
        </p>
      ) : (
        <>
          <dl className="space-y-1 text-sm">
            <Line label={t('الأكل')} math={`${fmt(carbs ?? 0)} ÷ ${fmt(ratio!.cr)}`} value={n1(r.food)} />
            <Line label={t('التصحيح')}
              math={r.correction + r.iobUsed === 0 ? t('{g} داخل الهدف', { g: gl(latest!.mg_dl) })
                : `(${gl(latest!.mg_dl)} − ${gl(latest!.mg_dl > target!.high ? target!.high : target!.low)}) ÷ ${gl(ratio!.isf)}`}
              value={(r.correction + r.iobUsed >= 0 ? '+' : '−') + n1(Math.abs(r.correction + r.iobUsed))} />
            {r.iobUsed > 0 && <Line label={t('إنسولين ما زال يعمل')} math="" value={'−' + n1(r.iobUsed)} />}
          </dl>
          <div className="flex items-center gap-3 border-t border-slate-200 pt-2">
            <span className="flex-1 text-sm text-slate-600">
              {t('المجموع {raw}، مقرّب للأسفل', { raw: n1(r.raw) })}
              <span className="block text-xs text-slate-500">{unitLabel(unit)} · {t('قراءة {when}', { when: clock(Date.parse(latest!.taken_at)) })}</span>
            </span>
            <b className="num text-2xl">{t('{u} وحدة', { u: fmt(r.dose) })}</b>
          </div>
          {r.dose > 0
            ? <button className={cx('min-h-[48px] w-full rounded-xl font-bold', KIND_STYLE.insulin.solid)} onClick={() => onUse(r.dose, purpose, {
                suggested: r.dose, carbs: carbs ?? 0, glucose: latest!.mg_dl, iob: Math.round((iob ?? 0) * 100) / 100, cr: ratio!.cr, isf: ratio!.isf,
                target: [target!.low, target!.high], food: Math.round(r.food * 100) / 100, correction: Math.round(r.correction * 100) / 100,
              })}>{t('استخدم {u} وحدة', { u: fmt(r.dose) })}</button>
            : <p className="text-sm font-medium text-slate-700">{t('لا حاجة لجرعة الآن.')}</p>}
          <p className="text-xs leading-relaxed text-slate-500">{t('من خطة الطبيب. راجعوا الرقم قبل الإعطاء؛ الرياضة والمرض والأكل غير المسجّل غير محسوبة.')}</p>
        </>
      )}
    </section>
  );
}

function Line({ label, math, value }: { label: string; math: string; value: string }) {
  return (
    <div className="flex items-baseline gap-2">
      <dt className="text-slate-600">{label}</dt>
      <dd className="num min-w-0 flex-1 truncate text-xs text-slate-500" dir={/[\u0600-\u06FF]/.test(math) ? 'rtl' : 'ltr'} style={{ textAlign: 'start' }}>{math}</dd>
      <dd className="num w-12 text-end font-bold" dir="ltr">{value}</dd>
    </div>
  );
}
