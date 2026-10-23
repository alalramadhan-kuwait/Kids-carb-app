// The rapid-insulin curve (the exponential model used by open-source Loop, Dragan Maksimovic) with no imports, so
// the app (engine/iob.ts) and the server benchmark (supabase/functions/carb-benchmark) run the very same code.

export interface IobParams { dia: number; peak: number } // minutes

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
