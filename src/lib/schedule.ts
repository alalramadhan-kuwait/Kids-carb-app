// Night and school windows in Kuwait time (no daylight saving). Pure, shared by the screens.
import type { Settings } from './types';

const KW = 3 * 3600000;
const toMin = (hhmm: string) => { const [h, m] = hhmm.split(':').map(Number); return h * 60 + (m || 0); };
export const hhmm = (t: string | null) => (t ? t.slice(0, 5) : '');

export function kuwaitClock(now = Date.now()) {
  const k = new Date(now + KW);
  return { min: k.getUTCHours() * 60 + k.getUTCMinutes(), day: k.getUTCDay() };
}
/** Inside [start, end) — a window like 21:00–06:30 wraps midnight. */
export function inWindow(nowMin: number, start: string, end: string) {
  const a = toMin(start), b = toMin(end);
  return a <= b ? nowMin >= a && nowMin < b : nowMin >= a || nowMin < b;
}
export const isNight = (s: Pick<Settings, 'night_start' | 'night_end'>, now = Date.now()) =>
  !!s.night_start && !!s.night_end && inWindow(kuwaitClock(now).min, s.night_start, s.night_end);

/** Today's school window as UTC ms, if today is a school day and the profile is set. */
export function schoolWindow(s: Pick<Settings, 'school_days' | 'school_start' | 'school_end'>, now = Date.now()) {
  if (!s.school_start || !s.school_end) return null;
  const { day } = kuwaitClock(now);
  if (!s.school_days.includes(day)) return null;
  const midnight = Math.floor((now + KW) / 86400000) * 86400000 - KW;
  return { from: midnight + toMin(s.school_start) * 60000, to: midnight + toMin(s.school_end) * 60000 };
}

/** The night hours for the graph: the parents' alert night window, or 22:00–06:00 until they set one. */
export const nightOf = (s: Pick<Settings, 'night_start' | 'night_end'>) =>
  ({ start: (s.night_start ?? '22:00').slice(0, 5), end: (s.night_end ?? '06:00').slice(0, 5) });
