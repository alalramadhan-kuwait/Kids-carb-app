// Clinical report engine, part 6: fixed range labels. Written out, not computed from the cut-offs, so 181 mg/dL never
// prints as "10.0" next to an in-range "3.9–10.0" (it rounds to 10.0 in mmol/L). Consensus bands, both units.
export type Unit = 'mmol' | 'mgdl';
export type Band = 'veryHigh' | 'high' | 'inRange' | 'low' | 'veryLow';

export const BAND_LABEL: Record<Unit, Record<Band, string>> = {
  mmol: { veryHigh: '>13.9', high: '10.1–13.9', inRange: '3.9–10.0', low: '3.0–3.8', veryLow: '<3.0' },
  mgdl: { veryHigh: '>250', high: '181–250', inRange: '70–180', low: '54–69', veryLow: '<54' },
};
export const BAND_NAME: Record<Band, string> = { veryHigh: 'Very high', high: 'High', inRange: 'Target range', low: 'Low', veryLow: 'Very low' };
export const BAND_ORDER: Band[] = ['veryHigh', 'high', 'inRange', 'low', 'veryLow'];
export const UNIT_LABEL: Record<Unit, string> = { mmol: 'mmol/L', mgdl: 'mg/dL' };

/** mg/dL to the unit shown, one decimal in mmol/L (factor 18.016, as everywhere in the app). */
export const showGlucose = (mg: number, unit: Unit) => (unit === 'mmol' ? (Math.round((mg / 18.016) * 10) / 10).toFixed(1) : String(Math.round(mg)));
