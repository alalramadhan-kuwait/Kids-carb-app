// The same meal again: today's glucose after eating drawn over the earlier times she had the same meal, all lined up
// at the first bite, with what she ate, the carbs and the NovoRapid each time. Facts only: never a proposed dose.
import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useData } from '../lib/data';
import { fetchSeries } from '../engine/useSeries';
import { nearest, type Series } from '../engine/series';
import { assess, median } from '../engine/meals';
import { sameMeals, sittingOf, sittings, type Sitting } from '../engine/sameMeal';
import { effectiveRange, formatGlucose, unitLabel } from '../lib/glucose';
import { fmt } from '../lib/carbs';
import { fmtTime, relDay } from '../lib/constants';
import type { EventRow, HistoryEntry } from '../lib/types';
import { t, tMaybe } from '../i18n';

const MIN = 60000, BEFORE = 30, AFTER = 240;
const GRID5 = Array.from({ length: (BEFORE + AFTER) / 5 + 1 }, (_, k) => -BEFORE + k * 5);
const NOW_COLOR = 'rgb(var(--primary-strong))', USUAL_COLOR = '#e07a1f', PAST_COLOR = '#9b95b3';
const MAX_TIMES = 20; // every earlier time in 90 days, up to this many: each a thin line, and their middle as "usual" 

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
    return { target, matches: sameMeals(target, all, { max: MAX_TIMES }).map((x) => x.s) };
  }, [id, history, events]);
}

/** The last thing she ate in the past 4 hours (a juice included), when she had the same before. */
export function useRecentSame() {
  const { history, events } = useData();
  return useMemo(() => {
    const all = sittings(eaten(history, events)), now = Date.now();
    const last = [...all].reverse().find((s) => s.t0 <= now && now - s.t0 <= 4 * 3600000 && s.carbs >= 10);
    if (!last) return null;
    const matches = sameMeals(last, all, { max: MAX_TIMES }).map((x) => x.s);
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
  const at = (l: Line, m: number, tol = 10) => { const i = nearest(l.series, l.s.t0 + m * MIN, tol * MIN); return i === null || l.series.t[i] > l.until ? null : l.series.v[i]; };
  const peakOf = (ps: { m: number; v: number }[]) => { let best: { m: number; v: number } | null = null; for (const p of ps) if (p.m >= 0 && p.m <= 180 && (!best || p.v > best.v)) best = p; return best; };
  const ticks = [0, 60, 120, 180, 240];
  const now = lines?.[0], past = (lines ?? []).slice(1);
  // "usual": the middle of all the earlier times, every 5 minutes (needs at least two of them at that moment)
  // each line read between its own readings (straight line, never across a gap of over 20 min), so the middle does not
  // jump from one line to another where only some have a reading
  const inter = (ps: { m: number; v: number }[], m: number) => {
    const k = ps.findIndex((p) => p.m >= m);
    if (k < 0) return null;
    if (ps[k].m === m || k === 0) return ps[k].m - m <= 5 ? ps[k].v : null;
    const a = ps[k - 1], b = ps[k];
    return b.m - a.m > 20 ? null : a.v + ((b.v - a.v) * (m - a.m)) / (b.m - a.m);
  };
  const pastPts = past.map(pts);
  const usual = past.length >= 2 ? GRID5.map((m) => {
    const vs = pastPts.map((ps) => inter(ps, m)).filter((v): v is number => v != null);
    return { m, v: vs.length >= Math.max(2, Math.ceil(past.length / 2)) ? median(vs) : null };
  }).filter((p): p is { m: number; v: number } => p.v != null) : [];
  const usualAt = (m: number) => usual.find((p) => p.m === m)?.v ?? null;
  const unitsOf = (l: Line) => dosesOf(l.s, events).reduce((n, e) => n + (e.insulin_units ?? 0), 0);

  return (
    <div className="space-y-3">
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" direction="ltr" role="img" aria-label={t('نفس الوجبة: المقارنة')}>
        {range.low != null && range.high != null && <rect x={PL} y={y(range.high)} width={W - PL - PR} height={y(range.low) - y(range.high)} fill="#2f8f55" opacity="0.1" />}
        {ticks.map((m) => <g key={m}><line x1={x(m)} x2={x(m)} y1={PT} y2={H - PB} stroke="rgb(var(--text-3))" strokeOpacity={m ? 0.18 : 0.6} strokeDasharray={m ? undefined : '4 4'} /><text x={x(m)} y={H - 6} fontSize="11" fill="#8a84a0" textAnchor="middle">{m ? t('{h} س', { h: m / 60 }) : '🍽️'}</text></g>)}
        {[range.low, range.high].filter((v): v is number => v != null).map((v) => <text key={v} x={W - PR + 4} y={y(v) + 4} fontSize="11" fill="#8a84a0">{g(v)}</text>)}
        {past.map((l) => <path key={l.s.id} d={path(pts(l))} fill="none" stroke={PAST_COLOR} strokeWidth="1.4" strokeLinejoin="round" opacity="0.55" />)}
        {usual.length > 1 && <path d={path(usual)} fill="none" stroke={USUAL_COLOR} strokeWidth="3" strokeLinejoin="round" strokeLinecap="round" />}
        {now && <path d={path(pts(now))} fill="none" stroke={NOW_COLOR} strokeWidth="3.6" strokeLinejoin="round" strokeLinecap="round" />}
        {now && dosesOf(now.s, events).map((e) => { const m = (Date.parse(e.occurred_at) - now.s.t0) / MIN; return <circle key={e.id} cx={x(Math.max(-BEFORE, m))} cy={H - PB - 4} r="3.5" fill={NOW_COLOR} />; })}
      </svg>
      {!lines && !err && <p className="text-center text-sm text-slate-500">{t('جاري التحميل…')}</p>}
      {err && <p className="text-center text-sm text-over">{err}</p>}
      {now && (
        <ul className="space-y-2">
          <Row color={NOW_COLOR} title={t('هذه المرة')} carbs={now.s.carbs} units={unitsOf(now)} what={now.s.items.map((i) => tMaybe(i.label)).join(' + ')}
            start={g(at(now, 0))} peak={peakOf(pts(now))} after2={g(at(now, 120))} g={g}
            dose={(() => { const d = dosesOf(now.s, events); return d.length ? Math.round((Date.parse(d[0].occurred_at) - now.s.t0) / MIN) : null; })()} />
          {usual.length > 1 && <Row color={USUAL_COLOR} title={t('المعتاد · {n} مرات', { n: past.length })} start={g(usualAt(0))} peak={peakOf(usual)} after2={g(usualAt(120))} g={g} />}
        </ul>
      )}
      {past.length > 0 && (
        <div className="rounded-2xl border border-slate-100 bg-white px-3 py-2">
          <div className="mb-1 flex items-center gap-2 text-sm font-bold"><span aria-hidden className="h-1 w-6 rounded-full" style={{ background: PAST_COLOR }} />{t('كل مرة قبل')}</div>
          <ul className="divide-y divide-slate-100 text-sm">
            {past.map((l) => {
              const p = peakOf(pts(l)), u = unitsOf(l);
              return (
                <li key={l.s.id} className="py-1.5">
                  <div className="flex flex-wrap items-baseline gap-x-2">
                    <span className="font-medium">{whenText(l.s.t0)}</span>
                    <span className="num text-slate-500">{t('{g} غ', { g: fmt(l.s.carbs) })}{u ? ` · ${t('{u} و', { u: fmt(u) })}` : ''}</span>
                    <span className="ms-auto num" dir="ltr">{g(at(l, 0))} → <b>{p ? g(p.v) : '—'}</b>{p ? <span className="text-slate-500"> ({t('{m} د', { m: Math.round(p.m) })})</span> : null} · {t('{h} س', { h: 2 })} {g(at(l, 120))}</span>
                  </div>
                  {l.why.length > 0 && <div className="text-xs text-near">{t('الخط يقف عند: {w}', { w: l.why.join(' · ') })}</div>}
                </li>
              );
            })}
          </ul>
        </div>
      )}
      <p className="text-xs text-slate-500">{t('كل الخطوط تبدأ من أول لقمة. {u}', { u: unitLabel(unit) })}</p>
    </div>
  );
}

function Row({ color, title, carbs, units, what, start, peak, after2, dose, g }: {
  color: string; title: string; carbs?: number; units?: number; what?: string; start: string; peak: { m: number; v: number } | null; after2: string; dose?: number | null; g: (v: number | null) => string;
}) {
  return (
    <li className="rounded-2xl border border-slate-100 bg-white px-3 py-2">
      <div className="flex items-center gap-2">
        <span aria-hidden className="h-1.5 w-6 shrink-0 rounded-full" style={{ background: color }} />
        <span className="font-bold">{title}</span>
        {carbs != null && <span className="ms-auto num text-sm text-slate-600">{t('{g} غ', { g: fmt(carbs) })}{units ? ` · ${t('{u} و', { u: fmt(units) })}` : ''}</span>}
      </div>
      {what && <div className="mt-0.5 text-sm text-slate-600"><bdi>{what}</bdi></div>}
      <div className="mt-1 flex flex-wrap gap-x-3 text-sm">
        <span>{t('البداية')} <b className="num">{start}</b></span>
        {peak && <span>{t('الأعلى')} <b className="num">{g(peak.v)}</b> <span className="text-slate-500">{t('بعد {m} د', { m: Math.round(peak.m) })}</span></span>}
        <span>{t('بعد ساعتين')} <b className="num">{after2}</b></span>
        {dose != null && <span className="text-slate-500">{dose <= 0 ? t('الجرعة قبل الأكل بـ {m} د', { m: -dose }) : t('الجرعة بعد الأكل بـ {m} د', { m: dose })}</span>}
      </div>
    </li>
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
