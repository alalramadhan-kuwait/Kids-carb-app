import { useEffect, useState } from 'react';
import { useData } from '../lib/data';
import { fmt } from '../lib/carbs';
import { formatGlucose } from '../lib/glucose';
import { fetchSeries } from '../engine/useSeries';
import { nearest, type Series } from '../engine/series';
import { isEn, t } from '../i18n';
import type { EventRow, HistoryEntry } from '../lib/types';

const MIN = 60000;
const ARROW = () => (isEn() ? '→' : '←');

/** Readings from 10 minutes before to 25 after a moment (the sensor next to a finger-prick, a dose or a low treatment). */
function useAround(at: number | null): Series | null {
  const [s, setS] = useState<Series | null>(null);
  useEffect(() => {
    if (at === null) { setS(null); return; }
    let live = true;
    fetchSeries(at - 10 * MIN, at + 26 * MIN).then((x) => { if (live) setS(x); }).catch(() => { if (live) setS(null); });
    return () => { live = false; };
  }, [at]);
  return s;
}
const mgAt = (s: Series | null, at: number, tol = 5 * MIN): number | null => { if (!s) return null; const i = nearest(s, at, tol); return i === null ? null : s.v[i]; };

/**
 * The one thing worth knowing when an entry is opened, in a line or two: finger against sensor, the dose given against
 * the one recommended, what a low treatment did. The full calculation sits behind "How?".
 */
export function EntryGlance({ e, h }: { e?: EventRow; h?: HistoryEntry }) {
  const { settings, events } = useData();
  const unit = settings.glucose_unit;
  const at = e && (e.kind === 'bg_check' || e.kind === 'treatment' || (e.kind === 'insulin' && e.dose_calc)) ? Date.parse(e.occurred_at) : null;
  const around = useAround(at);
  const [how, setHow] = useState(false);
  const g = (mg: number) => formatGlucose(mg, unit);
  const Line = ({ children }: { children: React.ReactNode }) => <p className="num text-lg font-bold text-slate-800">{children}</p>;
  const arrow = ARROW();

  if (h) {
    const t0 = Date.parse(h.eaten_at);
    const dose = events.find((x) => x.kind === 'insulin' && x.insulin_type === 'rapid' && !x.deleted_at && (x.insulin_units ?? 0) > 0
      && Date.parse(x.occurred_at) >= t0 - 30 * MIN && Date.parse(x.occurred_at) <= t0 + 15 * MIN);
    return <Line><bdi>{fmt(h.total_carbs)} {t('غ كارب')}</bdi>{dose ? <bdi> + 💉 {t('{u} وحدة', { u: fmt(dose.insulin_units) })}</bdi> : null}</Line>;
  }
  if (!e) return null;

  if (e.kind === 'bg_check' && e.bg_mgdl) {
    const sensor = mgAt(around, Date.parse(e.occurred_at));
    return (
      <Line>
        <bdi>{t('إصبع')} {g(e.bg_mgdl)} {arrow} {sensor !== null ? <>{t('الحساس')} {g(sensor)}</> : <span className="font-medium text-slate-500">{t('لا قراءة حساس وقتها')}</span>}</bdi>
        {sensor !== null && <span className="block text-sm font-medium text-slate-500">{t('في نفس الوقت')}</span>}
      </Line>
    );
  }

  if (e.kind === 'treatment') {
    const t0 = Date.parse(e.occurred_at);
    const before = mgAt(around, t0), after = mgAt(around, t0 + 15 * MIN, 6 * MIN);
    return (
      <Line>
        <bdi>{t('{g} غ كارب', { g: fmt(e.carbs_g) })}</bdi>
        {before !== null && <span className="block text-base"><bdi>{t('السكر')} {g(before)}{after !== null ? ` ${arrow} ${g(after)}` : ''}</bdi></span>}
      </Line>
    );
  }

  if (e.kind === 'insulin' && e.insulin_type !== 'long') {
    const c = e.dose_calc, given = e.insulin_units ?? 0;
    if (!c) return <Line><bdi>{t('أُعطيت {u} وحدة', { u: fmt(given) })}</bdi></Line>;
    const same = Math.abs(c.suggested - given) < 0.01;
    const hasCorr = Math.abs(c.correction) >= 0.05, hasFood = c.carbs > 0;
    const sum = hasFood && hasCorr ? t('{c} غ كارب + تصحيح = {u} وحدة', { c: fmt(c.carbs), u: fmt(c.suggested) })
      : hasFood ? t('{c} غ كارب = {u} وحدة', { c: fmt(c.carbs), u: fmt(c.suggested) })
      : t('تصحيح = {u} وحدة', { u: fmt(c.suggested) });
    const tgt = c.glucose > c.target[1] ? c.target[1] : c.target[0];
    const n1 = (x: number) => String(Math.round(x * 10) / 10);
    return (
      <div className="space-y-1">
        <Line><bdi>{t('أُعطيت {u} وحدة', { u: fmt(given) })}{same ? '' : <> {arrow} {t('الموصى {u} وحدة', { u: fmt(c.suggested) })}</>}</bdi></Line>
        <p className="text-sm text-slate-500"><bdi>{sum}</bdi> <button onClick={() => setHow(!how)} aria-expanded={how} className="min-h-[36px] px-1 font-bold text-brand">{t('كيف؟')}</button></p>
        {how && (
          <ul className="num space-y-0.5 rounded-xl bg-slate-50 p-2.5 text-sm text-slate-600" dir="ltr" style={{ textAlign: 'start' }}>
            {hasFood && <li>{t('الأكل')}: {fmt(c.carbs)} ÷ {n1(c.cr)} = {n1(c.food)}</li>}
            {c.glucose > 0 && <li>{t('التصحيح')}: ({g(c.glucose)} − {g(tgt)}) ÷ {g(c.isf)}{c.iob > 0 ? ` − ${n1(c.iob)}` : ''} = {n1(c.correction)}</li>}
            <li className="font-bold">{t('المجموع')}: {n1(c.food + c.correction)} → {fmt(c.suggested)}</li>
          </ul>
        )}
      </div>
    );
  }
  if (e.kind === 'insulin') return <Line><bdi>{t('أُعطيت {u} وحدة', { u: fmt(e.insulin_units) })}</bdi></Line>;
  return null;
}
