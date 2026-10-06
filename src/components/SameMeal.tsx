// The same meal again: today's glucose after eating drawn over the earlier times she had the same meal, all lined up
// at the first bite, with what she ate, the carbs and the NovoRapid each time. Facts only: never a proposed dose.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { fetchSeries } from '../engine/useSeries';
import { nearest, type Series } from '../engine/series';
import { assess } from '../engine/meals';
import { sameMeals, sittingOf, sittings, type Sitting } from '../engine/sameMeal';
import { effectiveRange, formatGlucose, unitLabel } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import { fmtTime, relDay } from '../lib/constants';
import type { EventRow, HistoryEntry } from '../lib/types';
import { t, tMaybe } from '../i18n';

const MIN = 60000, BEFORE = 30, AFTER = 240;
export const SAME_COLORS = ['rgb(var(--primary-strong))', '#e07a1f', '#2f8f55', '#8a84a0']; // today first

/** What she ate: the food log and the low treatments (a juice for a low is food too, and has its own pattern). */
function eaten(history: HistoryEntry[], events: EventRow[]): HistoryEntry[] {
  const treats = events.filter((e) => e.kind === 'treatment' && !e.deleted_at && (e.carbs_g ?? 0) > 0).map((e) => ({
    id: e.id, kind: 'snack', recipe_id: null, name: e.treatment || t('علاج انخفاض'), category: null, eaten_at: e.occurred_at, total_carbs: e.carbs_g ?? 0, lines: [],
  }) as unknown as HistoryEntry);
  return [...history, ...treats];
}

/** A sitting and the earlier times it was the same meal. */
export function useSameMeal(id: string | null | undefined) {
  const { history, events } = useData();
  return useMemo(() => {
    if (!id) return null;
    const all = sittings(eaten(history, events)), target = sittingOf(id, all);
    if (!target) return null;
    return { target, matches: sameMeals(target, all).map((x) => x.s) };
  }, [id, history, events]);
}

/** The last thing she ate in the past 4 hours (a juice included), when she had the same before. */
export function useRecentSame() {
  const { history, events } = useData();
  return useMemo(() => {
    const all = sittings(eaten(history, events)), now = Date.now();
    const last = [...all].reverse().find((s) => s.t0 <= now && now - s.t0 <= 4 * 3600000 && s.carbs >= 10);
    if (!last) return null;
    const matches = sameMeals(last, all).map((x) => x.s);
    return matches.length ? { target: last, matches } : null;
  }, [history, events]);
}

/** "Friday 9:22 PM", with the date once it is more than a week ago. */
export const whenText = (ms: number) => {
  const d = new Date(ms), old = Date.now() - ms > 6 * 86400000;
  return `${relDay(d)}${old ? ` ${d.getDate()}/${d.getMonth() + 1}` : ''} ${fmtTime(d)}`;
};

/** The rapid doses of one sitting: from an hour before the first bite to 30 minutes after. */
const dosesOf = (s: Sitting, events: EventRow[]) => events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_type !== 'long'
  && Date.parse(e.occurred_at) >= s.t0 - 60 * MIN && Date.parse(e.occurred_at) <= s.t0 + 30 * MIN);

interface Line { s: Sitting; series: Series; until: number; why: string[] }

/** The overlay itself, then one row per time: when, what, carbs, dose and the numbers that describe the curve. */
export function SameMealView({ target, matches, big }: { target: Sitting; matches: Sitting[]; big?: boolean }) {
  const { settings, history, events } = useData();
  const unit = settings.glucose_unit === 'mmol' ? 'mmol' : 'mgdl';
  const range = effectiveRange(settings.glucose_low_mgdl, settings.glucose_high_mgdl);
  const [lines, setLines] = useState<Line[] | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const key = [target, ...matches].map((s) => s.id).join();
  useEffect(() => {
    let live = true;
    Promise.all([target, ...matches].map(async (s, k) => {
      const series = await fetchSeries(s.t0 - BEFORE * MIN, Math.min(Date.now(), s.t0 + AFTER * MIN));
      // an earlier time counts until she ate again or was treated; today runs until now
      const a = k === 0 ? { until: s.t0 + AFTER * MIN, reasons: [] } : assess(s.t0, new Set(s.ids), history, events, series);
      return { s, series, until: a.until, why: a.reasons };
    })).then((x) => { if (live) setLines(x); }).catch((e) => live && setErr((e as Error).message));
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  const W = 340, H = big ? 230 : 190, PL = 6, PR = 30, PT = 8, PB = 22;
  const x = (m: number) => PL + ((m + BEFORE) / (BEFORE + AFTER)) * (W - PL - PR);
  const pts = (l: Line) => {
    const out: { m: number; v: number }[] = [];
    for (let i = 0; i < l.series.t.length; i++) {
      const m = (l.series.t[i] - l.s.t0) / MIN;
      if (m >= -BEFORE && m <= AFTER && l.series.t[i] <= l.until) out.push({ m, v: l.series.v[i] });
    }
    return out;
  };
  const all = (lines ?? []).flatMap(pts).map((p) => p.v);
  const lo = Math.min(range.low ?? 70, ...all) - 10, hi = Math.max(range.high ?? 180, ...all) + 10;
  const y = (v: number) => PT + (H - PT - PB) * (1 - (v - lo) / (hi - lo));
  const path = (ps: { m: number; v: number }[]) => ps.map((p, i) => `${i && ps[i - 1].m >= p.m - 20 ? 'L' : 'M'}${x(p.m).toFixed(1)},${y(p.v).toFixed(1)}`).join('');
  const g = (v: number | null) => (v == null ? '—' : formatGlucose(v, unit));
  const at = (l: Line, m: number) => { const i = nearest(l.series, l.s.t0 + m * MIN, 10 * MIN); return i === null || l.series.t[i] > l.until ? null : l.series.v[i]; };
  const peak = (l: Line) => { let best: { m: number; v: number } | null = null; for (const p of pts(l)) if (p.m >= 0 && p.m <= 180 && (!best || p.v > best.v)) best = p; return best; };
  const ticks = [0, 60, 120, 180, 240];

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" direction="ltr" role="img" aria-label={t('نفس الوجبة: المقارنة')}>
        {range.low != null && range.high != null && <rect x={PL} y={y(range.high)} width={W - PL - PR} height={y(range.low) - y(range.high)} fill="#2f8f55" opacity="0.1" />}
        {ticks.map((m) => <g key={m}><line x1={x(m)} x2={x(m)} y1={PT} y2={H - PB} stroke="rgb(var(--text-3))" strokeOpacity={m ? 0.18 : 0.6} strokeDasharray={m ? undefined : '4 4'} /><text x={x(m)} y={H - 6} fontSize="11" fill="#8a84a0" textAnchor="middle">{m ? t('{h} س', { h: m / 60 }) : '🍽️'}</text></g>)}
        {[range.low, range.high].filter((v): v is number => v != null).map((v) => <text key={v} x={W - PR + 4} y={y(v) + 4} fontSize="11" fill="#8a84a0">{g(v)}</text>)}
        {(lines ?? []).slice().reverse().map((l) => { const k = lines!.indexOf(l); return <path key={l.s.id} d={path(pts(l))} fill="none" stroke={SAME_COLORS[k]} strokeWidth={k ? 2.2 : 3.6} strokeLinejoin="round" strokeLinecap="round" opacity={k ? 0.85 : 1} />; })}
        {(lines ?? []).map((l, k) => dosesOf(l.s, events).map((e) => { const m = (Date.parse(e.occurred_at) - l.s.t0) / MIN; return <circle key={e.id} cx={x(Math.max(-BEFORE, m))} cy={H - PB - 4 - k * 7} r="3.5" fill={SAME_COLORS[k]} />; }))}
      </svg>
      {!lines && !err && <p className="text-center text-sm text-slate-500">{t('جاري التحميل…')}</p>}
      {err && <p className="text-center text-sm text-over">{err}</p>}
      <ul className="space-y-2">
        {(lines ?? []).map((l, k) => {
          const p = peak(l), d = dosesOf(l.s, events), units = d.reduce((n, e) => n + (e.insulin_units ?? 0), 0);
          const first = d.length ? Math.round((Date.parse(d[0].occurred_at) - l.s.t0) / MIN) : null;
          return (
            <li key={l.s.id} className="rounded-2xl border border-slate-100 bg-white px-3 py-2">
              <div className="flex items-center gap-2">
                <span aria-hidden className="h-1.5 w-6 shrink-0 rounded-full" style={{ background: SAME_COLORS[k] }} />
                <span className="font-bold">{k === 0 ? t('هذه المرة') : whenText(l.s.t0)}</span>
                <span className="ms-auto num text-sm text-slate-600">{t('{g} غ', { g: fmt(l.s.carbs) })}{units ? ` · ${t('{u} و', { u: fmt(units) })}` : ''}</span>
              </div>
              <div className="mt-0.5 text-sm text-slate-600"><bdi>{l.s.items.map((i) => tMaybe(i.label)).join(' + ')}</bdi></div>
              <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
                <span>{t('البداية')} <b className="num">{g(at(l, 0))}</b></span>
                {p && <span>{t('الأعلى')} <b className="num">{g(p.v)}</b> <span className="text-slate-500">{t('بعد {m} د', { m: Math.round(p.m) })}</span></span>}
                <span>{t('بعد ساعتين')} <b className="num">{g(at(l, 120))}</b></span>
                {first !== null && <span className="text-slate-500">{first <= 0 ? t('الجرعة قبل الأكل بـ {m} د', { m: -first }) : t('الجرعة بعد الأكل بـ {m} د', { m: first })}</span>}
              </div>
              {l.why.length > 0 && <div className="mt-1 text-xs text-near">{t('الخط يقف عند: {w}', { w: l.why.join(' · ') })}</div>}
            </li>
          );
        })}
      </ul>
      <p className="text-xs text-slate-500">{t('كل الخطوط تبدأ من أول لقمة. {u}', { u: unitLabel(unit) })}</p>
    </div>
  );
}

/** One line that opens the comparison, for the home screens and an entry's details. */
export function SameMealLink({ to, target, matches, className, short }: { to: string; target: Sitting; matches: Sitting[]; className?: string; short?: boolean }) {
  return (
    <Link to={to} className={className ?? 'flex min-h-[44px] items-center gap-2 rounded-2xl bg-brand-soft px-3 py-2 text-sm font-medium text-brand'}>
      <span aria-hidden>🔁</span>
      <span className="min-w-0 flex-1 truncate">{t('نفس وجبة {w}', { w: short ? relDay(new Date(matches[0].t0)) : whenText(matches[0].t0) })}{!short && matches.length > 1 ? ` ${t('+{n} قبلها', { n: matches.length - 1 })}` : ''}</span>
      <span>{t('قارن')}</span>
    </Link>
  );
}
