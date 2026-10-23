import { useId, useMemo } from 'react';
import { useData } from '../lib/data';
import { absorbing, isDrink, stillToAbsorb, type FoodIn } from '../engine/absorb';
import { fmt } from '../lib/carbs';
import { t } from '../i18n';
import type { View } from '../engine/series';

const N = 160;

/**
 * Under the glucose graph, on the same time axis: the food still being absorbed (an estimate, display only). A fatty
 * meal shows its slow part darker, under the quick part (engine/absorb). Ahead of now it is lighter: what is left to
 * come. Hidden when no food is being absorbed in the view.
 */
export function FoodLane({ view, now, height = 34 }: { view: View; now: number; height?: number }) {
  const { history, events } = useData();
  const id = useId().replace(/:/g, '');
  const foods = useMemo<FoodIn[]>(() => [
    ...history.filter((h) => h.total_carbs !== null && !h.deleted_at && h.intake !== 'pending')
      .map((h) => ({ t: Date.parse(h.eaten_at), carbs: Number(h.total_carbs), fat: h.total_fat, drink: isDrink(h.name) })),
    ...events.filter((e) => !e.deleted_at && (e.kind === 'carbs' || e.kind === 'treatment') && e.carbs_g)
      .map((e) => ({ t: Date.parse(e.occurred_at), carbs: Number(e.carbs_g), drink: e.kind === 'treatment' })),
  ], [history, events]);
  const start = view.end - view.span;
  const pts = useMemo(() => Array.from({ length: N + 1 }, (_, i) => { const at = start + (i / N) * view.span; return { at, ...absorbing(foods, at) }; }),
    [foods, start, view.span]);
  const peak = Math.max(0, ...pts.map((p) => p.fast + p.slow));
  if (peak < 1) return null;
  const top = Math.max(20, peak * 1.05), W = 1000, H = 100;
  const x = (at: number) => ((at - start) / view.span) * W;
  const y = (g: number) => H - (g / top) * (H - 6);
  const area = (f: (p: (typeof pts)[number]) => number) => `M0,${H} ${pts.map((p) => `L${x(p.at).toFixed(1)},${y(f(p)).toFixed(1)}`).join(' ')} L${W},${H}Z`;
  const nowX = Math.min(W, Math.max(0, x(now)));
  const slow = pts.some((p) => p.slow > 0.5);
  const left = stillToAbsorb(foods, now);
  return (
    <div className="px-0.5" aria-label={t('الأكل اللي يمتص (تقدير)')}>
      <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none" className="block w-full" style={{ height }} aria-hidden>
        <defs>
          <clipPath id={`${id}p`}><rect x={0} y={0} width={nowX} height={H} /></clipPath>
          <clipPath id={`${id}a`}><rect x={nowX} y={0} width={W - nowX} height={H} /></clipPath>
        </defs>
        {([`${id}p`, `${id}a`]).map((c, k) => (
          <g key={c} clipPath={`url(#${c})`} opacity={k === 0 ? 1 : 0.4}>
            <path d={area((p) => p.fast + p.slow)} className="fill-kcarb" opacity={0.32} />
            <path d={area((p) => p.slow)} className="fill-kcarb" opacity={1} />
          </g>
        ))}
        <line x1={0} x2={W} y1={H - 0.5} y2={H - 0.5} className="stroke-slate-200" strokeWidth={1} vectorEffect="non-scaling-stroke" />
        {now >= start && now <= view.end && <line x1={nowX} x2={nowX} y1={0} y2={H} className="stroke-slate-400" strokeWidth={1} strokeDasharray="3 3" vectorEffect="non-scaling-stroke" />}
      </svg>
      <p className="mt-0.5 flex flex-wrap justify-between gap-x-2 text-[11.5px] text-slate-500">
        <span>🍽️ {t('الأكل اللي يمتص · تقدير')}{slow ? ` · ${t('الغامق: الجزء البطيء للأكل الدسم')}` : ''}</span>
        {left >= 1 && <b className="text-kcarb">{t('باقي ~{g} غ', { g: fmt(Math.round(left)) })}</b>}
      </p>
    </div>
  );
}
