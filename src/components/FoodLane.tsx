import { useId, useMemo } from 'react';
import { useData } from '../lib/data';
import { absorbing, foodEnd, foodEndRange, foodsFrom, stillToAbsorb } from '../engine/absorb';
import { iobFraction } from '../engine/insulinCurve';
import { dosesFrom, iobParamsOk } from '../engine/iob';
import { fmt } from '../lib/carbs';
import { fmtTime } from '../lib/constants';
import { t } from '../i18n';
import type { View } from '../engine/series';

const N = 160, MIN = 60000;
/** Tresiba lasts beyond 42 hours: a long dose within that is shown as a flat background, not as meal insulin. */
const LONG_H = 42;
export const FAST_FILL = '#F6B8D1', SLOW_FILL = '#C2185B', INS_FILL = '#2563EB';
const clock = (at: number) => fmtTime(new Date(at)).replace(/\s*[^\d:]+$/, '');

/**
 * Under the glucose graph, on its time axis (no side inset, so a minute here is the same minute above): the food
 * still being absorbed, light pink for the quick part and dark pink for the slow part of a fatty meal, with a thin
 * outline for the two together (engine/absorb, the same curves as «active carbs»). Below it, NovoRapid from each
 * injection to the care team's duration, and Tresiba as a flat band. A tick marks about when each ends. Ahead of now
 * is lighter. All of it is an estimate for display: nothing here is a dose, a ratio or a forecast.
 */
export function FoodLane({ view, now, height = 34 }: { view: View; now: number; height?: number }) {
  const { history, events, settings: s } = useData();
  const id = useId().replace(/:/g, '');
  const foods = useMemo(() => foodsFrom(history, events), [history, events]);
  const p = s.iob_dia_min && s.iob_peak_min ? { dia: s.iob_dia_min, peak: s.iob_peak_min } : null;
  const on = iobParamsOk(p);
  const doses = useMemo(() => (on ? dosesFrom(events) : []), [events, on]);
  const longAt = useMemo(() => {
    const ts = events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_type === 'long' && e.insulin_units)
      .map((e) => Date.parse(e.occurred_at)).filter((at) => at <= now);
    return ts.length ? Math.max(...ts) : null;
  }, [events, now]);
  const start = view.end - view.span;
  const pts = useMemo(() => Array.from({ length: N + 1 }, (_, i) => { const at = start + (i / N) * view.span; return { at, ...absorbing(foods, at) }; }),
    [foods, start, view.span]);

  const W = 1000, H = 100, FOOD_H = 72, INS_Y = 78, INS_H = 9, LONG_Y = 92, LONG_PX = 5;
  const x = (at: number) => ((at - start) / view.span) * W;
  const inView = (at: number) => at >= start && at <= view.end;
  const dia = on ? p!.dia : 0;
  const rapid = doses.filter((d) => d.t + dia * MIN > start && d.t < view.end);
  const long = longAt !== null && longAt + LONG_H * 3600000 > start && longAt < view.end ? longAt : null;
  const peak = Math.max(0, ...pts.map((q) => q.fast + q.slow));
  if (peak < 1 && !rapid.length && long === null) return null;

  const top = Math.max(20, peak * 1.05);
  const y = (g: number) => FOOD_H - (g / top) * (FOOD_H - 4);
  const line = (f: (q: (typeof pts)[number]) => number) => pts.map((q) => `${x(q.at).toFixed(1)},${y(f(q)).toFixed(1)}`).join(' L');
  const area = (f: (q: (typeof pts)[number]) => number) => `M0,${FOOD_H} L${line(f)} L${W},${FOOD_H}Z`;
  const nowX = Math.min(W, Math.max(0, x(now)));
  const left = stillToAbsorb(foods, now);
  const carbEnd = foodEnd(foods, now);
  const insEnd = rapid.length ? Math.max(...rapid.map((d) => d.t)) + dia * MIN : null;
  // each end as a range, never one exact clock: food from 85 % to 95 % absorbed; NovoRapid from 85 % used to the end of
  // the care team's duration. The tick sits at 90 % (food) and at the end (insulin).
  const carbRange = foodEndRange(foods, now);
  const lastDose = rapid.length ? Math.max(...rapid.map((d) => d.t)) : null;
  let insFrom = lastDose;
  if (lastDose !== null && on) { let m = 0; while (m < dia && iobFraction(m, p!) > 0.15) m += 5; insFrom = lastDose + m * MIN; }
  const ends = [
    carbEnd !== null && carbRange && carbEnd >= start ? { at: carbEnd, from: carbRange.from, to: carbRange.to, cls: 'text-kcarb', fill: SLOW_FILL } : null,
    insEnd !== null && insEnd > now && insEnd >= start ? { at: insEnd, from: Math.max(now, insFrom!), to: insEnd, cls: 'text-kins', fill: INS_FILL } : null,
  ].filter(Boolean) as { at: number; from: number; to: number; cls: string; fill: string }[];
  const pct = (at: number) => `${Math.min(97, Math.max(3, ((at - start) / view.span) * 100))}%`;

  return (
    <div aria-label={t('الأكل اللي يمتص (تقدير)')}>
      <div className="relative">
        <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden>
          <defs>
            <clipPath id={`${id}p`}><rect x={0} y={0} width={nowX} height={H} /></clipPath>
            <clipPath id={`${id}a`}><rect x={nowX} y={0} width={W - nowX} height={H} /></clipPath>
          </defs>
          {long !== null && (
            <rect x={Math.max(0, x(long))} width={Math.min(W, x(long + LONG_H * 3600000)) - Math.max(0, x(long))} y={LONG_Y} height={LONG_PX} fill={INS_FILL} opacity={0.2} />
          )}
          {([`${id}p`, `${id}a`]).map((c, k) => (
            <g key={c} clipPath={`url(#${c})`} opacity={k === 0 ? 1 : 0.45}>
              <path d={area((q) => q.fast + q.slow)} fill={FAST_FILL} />
              <path d={area((q) => q.slow)} fill={SLOW_FILL} opacity={0.85} />
              {peak >= 1 && <path d={`M${line((q) => q.fast + q.slow)}`} fill="none" stroke={SLOW_FILL} strokeWidth={1} vectorEffect="non-scaling-stroke" opacity={0.7} />}
              {rapid.map((d) => <rect key={d.t} x={x(d.t)} width={x(d.t + dia * MIN) - x(d.t)} y={INS_Y} height={INS_H} fill={INS_FILL} opacity={0.55} />)}
            </g>
          ))}
          {rapid.filter((d) => inView(d.t)).map((d) => (
            <line key={d.t} x1={x(d.t)} x2={x(d.t)} y1={INS_Y - 6} y2={INS_Y + INS_H} stroke={INS_FILL} strokeWidth={2} vectorEffect="non-scaling-stroke" />
          ))}
          {ends.filter((e) => inView(e.at)).map((e) => (
            <line key={e.at} x1={x(e.at)} x2={x(e.at)} y1={0} y2={H} stroke={e.fill} strokeWidth={1.5} strokeDasharray="2 2" vectorEffect="non-scaling-stroke" />
          ))}
          <line x1={0} x2={W} y1={FOOD_H + 0.5} y2={FOOD_H + 0.5} className="stroke-slate-200" strokeWidth={1} vectorEffect="non-scaling-stroke" />
          {inView(now) && <line x1={nowX} x2={nowX} y1={0} y2={H} className="stroke-slate-400" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
        </svg>
        {ends.map((e, i) => {
          const past = e.at > view.end; // beyond the view: pinned to its edge, pointing on
          return (
            <span key={e.at} dir="ltr" className={`num pointer-events-none absolute rounded bg-white/85 px-0.5 text-[10.5px] font-bold leading-none ${e.cls} ${past ? '' : '-translate-x-1/2'}`}
              style={{ ...(past ? { right: 0 } : { left: pct(e.at) }), top: i && (past ? ends[0].at > view.end : Math.abs(e.at - ends[0].at) < view.span * 0.1) ? 12 : 0 }}>
              {clock(e.from) === clock(e.to) || e.to - e.from < 10 * MIN ? `~${clock(e.to)}` : `${clock(e.from)}–${clock(e.to)}`}{past ? ' →' : ''}
            </span>
          );
        })}
      </div>
      <p className="mt-0.5 flex flex-wrap items-center justify-between gap-x-2 text-[11px] text-slate-500">
        <span className="flex flex-wrap items-center gap-x-1">
          {peak >= 1 && <><Dot c={FAST_FILL} />{t('كارب سريع')} <Dot c={SLOW_FILL} />{t('كارب بطيء')}</>}
          {rapid.length > 0 && <> <Dot c={INS_FILL} />{t('نوفورابيد')}</>}
          {long !== null && <> <Dot c={INS_FILL} faint />{t('تريسيبا')}</>}
          <span>· {t('تقدير')}</span>
        </span>
        {left >= 1 && <b className="text-kcarb">{t('باقي ~{g} غ', { g: fmt(Math.round(left)) })}</b>}
      </p>
    </div>
  );
}

const Dot = ({ c, faint }: { c: string; faint?: boolean }) => (
  <span aria-hidden className="inline-block h-2 w-2.5 rounded-sm" style={{ background: c, opacity: faint ? 0.3 : 1 }} />
);
