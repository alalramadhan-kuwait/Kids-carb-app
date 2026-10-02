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

export interface Dose { t: number; units: number }
export interface CarbEntry { t: number; grams: number; fatty?: boolean }

/**
 * Fatty meals (the parents' choice, 2026-10-02): fat slows the stomach, so their carbs arrive later and the rise can
 * come 3–5 hours after eating. A meal with 15 g of fat or more, or fat and protein together worth 200 kcal or more,
 * is absorbed over at least 5 hours. Display only (COB, the estimate and forecast lines); never used for a dose.
 */
export const FATTY = { fatG: 15, fpuKcal: 200, absorbMin: 300 } as const;
export const isFatty = (fat: number | null | undefined, protein: number | null | undefined) =>
  fat !== null && fat !== undefined && (fat >= FATTY.fatG || fat * 9 + (protein ?? 0) * 4 >= FATTY.fpuKcal);
/** How long these carbs take to absorb: the care team's time, or longer for a fatty meal. */
export const absorbOf = (c: { fatty?: boolean }, base: number) => (c.fatty ? Math.max(base, FATTY.absorbMin) : base);

/** Rapid-acting doses only; long-acting insulin is not "on board" in this sense. */
export const dosesFrom = (events: EventRow[]): Dose[] =>
  events.filter((e) => !e.deleted_at && e.kind === 'insulin' && e.insulin_type !== 'long' && e.insulin_units)
    .map((e) => ({ t: Date.parse(e.occurred_at), units: e.insulin_units! }));

export const carbsFrom = (history: HistoryEntry[], events: EventRow[]): CarbEntry[] => [
  ...history.map((h) => ({ t: Date.parse(h.eaten_at), grams: h.total_carbs, fatty: isFatty(h.total_fat, h.total_protein) })),
  ...events.filter((e) => !e.deleted_at && (e.kind === 'carbs' || e.kind === 'treatment') && e.carbs_g).map((e) => ({ t: Date.parse(e.occurred_at), grams: e.carbs_g! })),
];

export function iobAt(t: number, doses: Dose[], p: IobParams): number {
  let sum = 0;
  for (const d of doses) if (d.t <= t && t - d.t < p.dia * MIN) sum += d.units * iobFraction((t - d.t) / MIN, p);
  return sum;
}
export function cobAt(t: number, carbs: CarbEntry[], absorbMin: number): number {
  let sum = 0;
  for (const c of carbs) { const a = absorbOf(c, absorbMin); if (c.t <= t && t - c.t < a * MIN) sum += c.grams * (1 - (t - c.t) / (a * MIN)); }
  return sum;
}
export const modelLine = (p: IobParams | null, absorb: number | null) =>
  [p ? t('IOB: نموذج أُسّي، مدة {h} س، الذروة {m} د', { h: Math.round(p.dia / 60 * 10) / 10, m: p.peak }) : null, absorb ? t('COB: امتصاص خطّي خلال {m} د', { m: absorb }) : null]
    .filter(Boolean).join(' · ') + ' — ' + t('من الفريق الطبي، للعرض فقط');

/** The latest fatty meal still inside its slow window (5 h), for the notice on Now; null when there is none. */
export function recentFatty(history: { name: string; eaten_at: string; total_fat: number | null; total_protein: number | null }[], now: number) {
  let best: { name: string; at: number; until: number } | null = null;
  for (const h of history) {
    const at = Date.parse(h.eaten_at);
    if (at > now || now - at >= FATTY.absorbMin * MIN || !isFatty(h.total_fat, h.total_protein)) continue;
    if (!best || at > best.at) best = { name: h.name, at, until: at + FATTY.absorbMin * MIN };
  }
  return best;
}
