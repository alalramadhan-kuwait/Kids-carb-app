import type { AlertKind, AlertRow } from './types';

/** A low, a low expected or a fast fall is open: then no screen shows a «≈ later» number or dashed trend that could
 *  read as reassurance next to the alert. The alert's own look-ahead (server, alerts.ts) is the one that decides. */
const LOWISH: AlertKind[] = ['urgent_low', 'low', 'predicted_low', 'rapid_fall'];
export const lowOpen = (open: AlertRow[]) => open.some((a) => LOWISH.includes(a.kind));
