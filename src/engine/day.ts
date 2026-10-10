// Day view (GLUCOSE_PLAN 11.8). Pure: day bounds in Kuwait time, low episodes found in the readings, and the
// day's logged totals. The glucose percentages come from carb.glucose_stats so they match the other screens.
import type { EventRow, HistoryEntry } from '../lib/types';
import { GAP_MS, lowerBound, type Series } from './series';
import { isEn, t } from '../i18n';

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR, KW = 3 * HOUR;

/** Kuwait midnight (as UTC ms) of the day containing t. Kuwait has no daylight saving. */
export const dayStartOf = (t: number) => Math.floor((t + KW) / DAY) * DAY - KW;

export interface Episode { t: number; end: number; nadir: number; minutes: number }

/**
 * Lows: runs of readings below `low` lasting at least `minMinutes`, never joined across a gap.
 * The episode time is its first low reading; nadir is its lowest value.
 */
export function lowEpisodes(s: Series, start: number, end: number, low: number, minMinutes = 10): Episode[] {
  const out: Episode[] = [];
  let i = lowerBound(s.t, start), run: Episode | null = null;
  const close = () => { if (run && run.minutes >= minMinutes) out.push(run); run = null; };
  for (; i < s.t.length && s.t[i] < end; i++) {
    if (run && s.t[i] - s.t[i - 1] > GAP_MS) close();
    if (s.v[i] < low) {
      if (!run) run = { t: s.t[i], end: s.t[i], nadir: s.v[i], minutes: 0 };
      run.end = s.t[i]; run.nadir = Math.min(run.nadir, s.v[i]); run.minutes = Math.round((run.end - run.t) / MIN);
    } else close();
  }
  close();
  return out;
}

/** unknown: meals whose carbs are not known (ate out); their carbs are not in `carbs` */
export interface DayTotals { carbs: number; treatment: number; rapid: number; long: number; meals: number; unknown: number }

/** What was logged in [start, end): meal/snack/carb grams, hypo-treatment grams, rapid and long insulin units. */
export function dayTotals(history: HistoryEntry[], events: EventRow[], start: number, end: number): DayTotals {
  const inDay = (iso: string) => { const t = Date.parse(iso); return t >= start && t < end; };
  const t: DayTotals = { carbs: 0, treatment: 0, rapid: 0, long: 0, meals: 0, unknown: 0 };
  for (const h of history) if (inDay(h.eaten_at)) { if (h.total_carbs === null) t.unknown++; else t.carbs += h.total_carbs; if (h.kind === 'meal') t.meals++; }
  for (const e of events) {
    if (e.deleted_at || !inDay(e.occurred_at)) continue;
    if (e.kind === 'carbs') t.carbs += e.carbs_g ?? 0;
    if (e.kind === 'treatment') t.treatment += e.carbs_g ?? 0;
    if (e.kind === 'insulin') { if (e.insulin_type === 'long') t.long += e.insulin_units ?? 0; else t.rapid += e.insulin_units ?? 0; }
  }
  const r1 = (n: number) => Math.round(n * 10) / 10;
  return { carbs: r1(t.carbs), treatment: r1(t.treatment), rapid: r1(t.rapid), long: r1(t.long), meals: t.meals, unknown: t.unknown };
}

/** Weekday and date for a day start: «الخميس 1 أكتوبر» / "Thursday 1 October". */
const WEEKDAYS = ['الأحد', 'الاثنين', 'الثلاثاء', 'الأربعاء', 'الخميس', 'الجمعة', 'السبت']; // i18n-ok: data, English twin below
const MONTHS = ['يناير', 'فبراير', 'مارس', 'أبريل', 'مايو', 'يونيو', 'يوليو', 'أغسطس', 'سبتمبر', 'أكتوبر', 'نوفمبر', 'ديسمبر']; // i18n-ok: data, English twin below
const WEEKDAYS_EN = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS_EN = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
export function dayTitle(dayStart: number, now = Date.now()) {
  const d = new Date(dayStart + KW), en = isEn();
  const wd = (en ? WEEKDAYS_EN : WEEKDAYS)[d.getUTCDay()], month = (en ? MONTHS_EN : MONTHS)[d.getUTCMonth()];
  const rel = dayStart === dayStartOf(now) ? t('اليوم') : dayStart === dayStartOf(now) - DAY ? t('أمس') : wd;
  return `${rel} · ${rel === wd ? '' : wd + ' '}${d.getUTCDate()} ${month}`;
}
