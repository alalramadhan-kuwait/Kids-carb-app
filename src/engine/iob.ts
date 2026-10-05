// Insulin on board and carbs on board (GLUCOSE_PLAN 10.9, 11.5). Display only: nothing in the app uses these
// to suggest anything. The parameters come from the care team and are printed under every value.
//
// IOB: the exponential insulin-activity model used by open-source Loop (Dragan Maksimovic), with duration of
// action (DIA) and peak time. COB: carbs absorbed in a straight line over the absorption time.
import type { EventRow, HistoryEntry } from '../lib/types';
import { t } from '../i18n';

const MIN = 60000;
export interface IobParams { dia: number; peak: number } // minutes

/** Valid only when the peak is less than half the duration (the model's own condition). */
export const iobParamsOk = (p: IobParams | null): p is IobParams => !!p && p.dia > 0 && p.peak > 0 && p.peak < p.dia / 2;

/** Fraction of a dose still active t minutes after it (1 at 0, 0 at DIA). */
export function iobFraction(t: number, { dia, peak }: IobParams): number {
  if (t <= 0) return 1;
  if (t >= dia) return 0;
  const tau = (peak * (1 - peak / dia)) / (1 - (2 * peak) / dia);
  const a = (2 * tau) / dia;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-dia / tau));
  const f = 1 - S * (1 - a) * ((t * t / (tau * dia * (1 - a)) - t / tau - 1) * Math.exp(-t / tau) + 1);
  return Math.min(1, Math.max(0, f));
}

/**
 * Insulin activity t minutes after a dose: the share of the dose working in that minute (the same model's rate,
 * the slope of the curve above). It starts at 0, is highest at the peak time, and adds up to the whole dose by DIA.
 */
export function activityFraction(t: number, { dia, peak }: IobParams): number {
  if (t <= 0 || t >= dia) return 0;
  const tau = (peak * (1 - peak / dia)) / (1 - (2 * peak) / dia);
  const a = (2 * tau) / dia;
  const S = 1 / (1 - a + (1 + a) * Math.exp(-dia / tau));
  return Math.max(0, (S / (tau * tau)) * t * (1 - t / dia) * Math.exp(-t / tau));
}

export interface Dose { t: number; units: number }
export interface CarbEntry { t: number; grams: number }

/**
 * Fatty meals (the parents' choice, 2026-10-02): a meal with 15 g of fat or more, or fat and protein together worth
 * 200 kcal or more, often rises again 3–5 hours after eating. Used for a notice and a tag only. Slowing the whole meal's
 * absorption was tried and replayed against her readings (2026-10-02): it predicted worse than the normal model, so COB
 * and the forecast lines keep the care team's absorption time; a better shape is tested in the research lab.
 */
export const FATTY = { fatG: 15, fpuKcal: 200, windowMin: 300 } as const;
export const isFatty = (fat: number | null | undefined, protein: number | null | undefined) =>
  fat !== null && fat !== undefined && (fat >= FATTY.fatG || fat * 9 + (protein ?? 0) * 4 >= FATTY.fpuKcal);

/** Rapid-acting doses only; long-acting insulin is not "on board" in this sense. */
export const dosesFrom = (events: EventRow[]): Dose[] =>
  events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_type !== 'long' && e.insulin_units)
    .map((e) => ({ t: Date.parse(e.occurred_at), units: e.insulin_units! }));

export const carbsFrom = (history: HistoryEntry[], events: EventRow[]): CarbEntry[] => [
  ...history.map((h) => ({ t: Date.parse(h.eaten_at), grams: h.total_carbs })),
  ...events.filter((e) => !e.deleted_at && (e.kind === 'carbs' || e.kind === 'treatment') && e.carbs_g).map((e) => ({ t: Date.parse(e.occurred_at), grams: e.carbs_g! })),
];

export function iobAt(t: number, doses: Dose[], p: IobParams): number {
  let sum = 0;
  for (const d of doses) if (d.t <= t && t - d.t < p.dia * MIN) sum += d.units * iobFraction((t - d.t) / MIN, p);
  return sum;
}
/**
 * The activity line starts this many minutes after the shot (Loop's "effect delay"): rapid insulin needs time under
 * the skin before it does anything, so the line, its peak and its end move later by this much. Display only: IOB
 * and the dose screens keep the care team's curve unchanged.
 */
export const ACT_DELAY_MIN = 10;
/** How hard the rapid insulin is working at t, in units per hour (all doses added up), `delay` minutes late. */
export function activityAt(t: number, doses: Dose[], p: IobParams, delay = 0): number {
  let sum = 0;
  for (const d of doses) { const m = (t - d.t) / MIN - delay; if (m > 0 && m < p.dia) sum += d.units * activityFraction(m, p); }
  return sum * 60;
}
/** When the summed activity is at its top between `from` and `to`: each peak higher than the 15 minutes either side. */
export function activityPeaks(doses: Dose[], p: IobParams, from: number, to: number, delay = 0): number[] {
  const span = (p.dia + delay) * MIN;
  const near = doses.filter((d) => d.t < to && d.t + span > from);
  if (!near.length) return [];
  const a = Math.max(from, Math.min(...near.map((d) => d.t))), b = Math.min(to, Math.max(...near.map((d) => d.t)) + span);
  const W = 15, v: number[] = [];
  for (let t = a - W * MIN; t <= b + W * MIN; t += MIN) v.push(activityAt(t, near, p, delay));
  const out: number[] = [];
  for (let k = W; k < v.length - W; k++) {
    if (!(v[k] > 0)) continue;
    let top = true;
    for (let j = k - W; j <= k + W && top; j++) if (j !== k && (j < k ? v[j] >= v[k] : v[j] > v[k])) top = false;
    if (top) out.push(a + (k - W) * MIN);
  }
  return out;
}
export function cobAt(t: number, carbs: CarbEntry[], absorbMin: number): number {
  let sum = 0;
  for (const c of carbs) if (c.t <= t && t - c.t < absorbMin * MIN) sum += c.grams * (1 - (t - c.t) / (absorbMin * MIN));
  return sum;
}
export const modelLine = (p: IobParams | null, absorb: number | null) =>
  [p ? t('IOB: نموذج أُسّي، مدة {h} س، الذروة {m} د', { h: Math.round(p.dia / 60 * 10) / 10, m: p.peak }) : null, absorb ? t('COB: امتصاص خطّي خلال {m} د', { m: absorb }) : null]
    .filter(Boolean).join(' · ') + ' — ' + t('من الفريق الطبي، للعرض فقط');

/** The latest fatty meal still inside its late-rise window (5 h), for the notice on Now; null when there is none. */
export function recentFatty(history: { name: string; eaten_at: string; total_fat: number | null; total_protein: number | null }[], now: number) {
  let best: { name: string; at: number; until: number } | null = null;
  for (const h of history) {
    const at = Date.parse(h.eaten_at);
    if (at > now || now - at >= FATTY.windowMin * MIN || !isFatty(h.total_fat, h.total_protein)) continue;
    if (!best || at > best.at) best = { name: h.name, at, until: at + FATTY.windowMin * MIN };
  }
  return best;
}

/**
 * What is still on board, told as a timeline (the Now screen): how much is left of how much, from which doses or
 * meals, when the first and last of them were, and when the model says the last of it is done (the care team's
 * duration of action, or absorption time, after the last one). Null when nothing is left. Display only.
 */
export interface OnBoardLane { left: number; total: number; n: number; first: number; last: number; end: number }
export function insulinLane(doses: Dose[], now: number, p: IobParams): OnBoardLane | null {
  const act = doses.filter((d) => d.t <= now && now - d.t < p.dia * MIN);
  const left = iobAt(now, act, p);
  return act.length && left >= 0.05 ? lane(act.map((d) => ({ t: d.t, v: d.units })), left, p.dia) : null;
}
export function carbLane(carbs: CarbEntry[], now: number, absorbMin: number): OnBoardLane | null {
  const act = carbs.filter((c) => c.t <= now && now - c.t < absorbMin * MIN && c.grams > 0);
  const left = cobAt(now, act, absorbMin);
  return act.length && left >= 0.5 ? lane(act.map((c) => ({ t: c.t, v: c.grams })), left, absorbMin) : null;
}
function lane(xs: { t: number; v: number }[], left: number, durMin: number): OnBoardLane {
  const ts = xs.map((x) => x.t);
  const first = Math.min(...ts), last = Math.max(...ts);
  return { left, total: xs.reduce((s, x) => s + x.v, 0), n: xs.length, first, last, end: last + durMin * MIN };
}
