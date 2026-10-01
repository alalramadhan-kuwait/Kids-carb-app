import type { EventRow } from './types';
import type { IconName } from '../icons/defs';

export const EVENT_ICON: Record<EventRow['kind'], IconName> = { insulin: 'insulin', carbs: 'carbs', treatment: 'treatment', note: 'note', exercise: 'activity', sleep: 'moon' };

type Describable = Pick<EventRow, 'kind' | 'insulin_units' | 'insulin_type' | 'carbs_g' | 'treatment' | 'note' | 'activity_min' | 'activity_level' | 'occurred_at' | 'ends_at'>;

export const LEVEL_TEXT = { light: 'خفيف', moderate: 'متوسط', hard: 'شديد' } as const;
const hm = (min: number) => (min < 60 ? `${min} د` : `${Math.floor(min / 60)}:${String(min % 60).padStart(2, '0')} س`);

/** Arabic number agreement: 1 وحدة, 2 وحدتان, 3–10 وحدات, 11+ and fractions وحدة. */
export const unitsWord = (n: number) => (n === 2 ? 'وحدتان' : Number.isInteger(n) && n >= 3 && n <= 10 ? 'وحدات' : 'وحدة');

export const describeEvent = (e: Describable) => {
  if (e.kind === 'insulin') return `${e.insulin_units} ${unitsWord(e.insulin_units ?? 0)} · ${e.insulin_type === 'long' ? 'طويل المفعول' : 'سريع'}`;
  if (e.kind === 'carbs') return `${e.carbs_g}غ كارب`;
  if (e.kind === 'treatment') return `علاج انخفاض ${e.carbs_g}غ${e.treatment ? ` · ${e.treatment}` : ''}`;
  if (e.kind === 'exercise') return `رياضة ${hm(e.activity_min ?? 0)}${e.activity_level ? ` · ${LEVEL_TEXT[e.activity_level]}` : ''}`;
  if (e.kind === 'sleep' && e.ends_at) return `نوم ${hm(Math.round((Date.parse(e.ends_at) - Date.parse(e.occurred_at)) / 60000))}`;
  return e.note ?? '';
};

/**
 * Sleep is logged after waking as two clock times (Kuwait). The end is its latest occurrence not after now;
 * the start is the latest occurrence before the end (so 21:30 → 06:45 spans midnight). Returns ISO times.
 */
export function sleepWindow(start: string, end: string, now = Date.now()) {
  const KW = 3 * 3600000, DAY = 86400000;
  const toMin = (s: string) => { const [h, m] = s.split(':').map(Number); return h * 60 + m; };
  const dayStart = Math.floor((now + KW) / DAY) * DAY - KW; // Kuwait midnight today, in UTC ms
  let e = dayStart + toMin(end) * 60000;
  if (e > now + 60000) e -= DAY;
  let s = dayStart + toMin(start) * 60000;
  while (s >= e) s -= DAY;
  while (e - s > DAY) s += DAY;
  return { occurred_at: new Date(s).toISOString(), ends_at: new Date(e).toISOString(), minutes: Math.round((e - s) / 60000) };
}
