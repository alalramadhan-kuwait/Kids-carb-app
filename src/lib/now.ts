import type { EventRow } from './types';
import type { GlucoseStatus } from './glucose';

/** What the parent reads first: one short sentence. Masculine because the subject is "السكر". */
export type Tone = 'ok' | 'low' | 'urgent' | 'high' | 'warn' | 'plain';
const TREND_TAIL: Record<number, string> = { 1: ' ونازل بسرعة', 2: ' ونازل', 3: '', 4: ' وصاعد', 5: ' وصاعد بسرعة' };
const TREND_ALONE: Record<number, string> = { 1: 'نازل بسرعة', 2: 'نازل', 3: 'ثابت', 4: 'صاعد', 5: 'صاعد بسرعة' };

export function statusSentence(args: {
  hasReading: boolean;
  age: 'fresh' | 'old' | 'stale' | null;
  status: GlucoseStatus | null;
  trend: number | null;
}): { text: string; tone: Tone } {
  const { hasReading, age, status, trend } = args;
  if (!hasReading || age === 'stale') return { text: 'لا توجد قراءة حديثة', tone: 'warn' };
  if (age === 'old') return { text: 'القراءة ليست حديثة', tone: 'warn' };
  const tail = trend ? TREND_TAIL[trend] ?? '' : '';
  if (!status) return { text: trend ? `السكر ${TREND_ALONE[trend]}` : 'السكر', tone: 'plain' };
  switch (status) {
    case 'urgent_low': return { text: `منخفض جدًا${tail}`, tone: 'urgent' };
    case 'low': return { text: `منخفض${tail}`, tone: 'low' };
    case 'in_range': return { text: trend === 3 || !trend ? 'مستقر ضمن النطاق' : `ضمن النطاق${tail}`, tone: 'ok' };
    case 'high': return { text: `مرتفع${tail}`, tone: 'high' };
    case 'very_high': return { text: `مرتفع جدًا${tail}`, tone: 'high' };
  }
}

/** "قبل 25 د" / "قبل 1:20" — short enough for one line. */
export function sinceText(iso: string, now = Date.now()): string {
  const min = Math.max(0, Math.round((now - new Date(iso).getTime()) / 60000));
  if (min < 1) return 'الآن';
  if (min < 60) return `قبل ${min} د`;
  const h = Math.floor(min / 60), m = min % 60;
  if (h < 24) return `قبل ${h}:${String(m).padStart(2, '0')}`;
  return `قبل ${Math.floor(h / 24)} يوم`;
}

/**
 * Two caregivers logging the same thing: same kind within 10 minutes and
 * (insulin) the same units and type, or (carbs / treatment) grams within 10%.
 */
export function findDuplicate(events: EventRow[], c: Pick<EventRow, 'kind' | 'occurred_at' | 'insulin_units' | 'insulin_type' | 'carbs_g'>): EventRow | null {
  const t = new Date(c.occurred_at).getTime();
  return events.find((e) => {
    if (e.deleted_at || e.kind !== c.kind || c.kind === 'note') return false;
    if (Math.abs(new Date(e.occurred_at).getTime() - t) > 10 * 60000) return false;
    if (c.kind === 'insulin') return e.insulin_units === c.insulin_units && e.insulin_type === c.insulin_type;
    const a = e.carbs_g ?? 0, b = c.carbs_g ?? 0;
    return Math.abs(a - b) <= Math.max(1, 0.1 * Math.max(a, b));
  }) ?? null;
}

/** Kuwait has no daylight saving: local midnight is 21:00 UTC the day before. */
export function kuwaitDayStart(now = new Date()): Date {
  const k = new Date(now.getTime() + 3 * 3600000);
  return new Date(Date.UTC(k.getUTCFullYear(), k.getUTCMonth(), k.getUTCDate()) - 3 * 3600000);
}

export const hoursOfDay = (pct: number) => {
  const mins = Math.round((pct / 100) * 24 * 60);
  return `${Math.floor(mins / 60)} س ${mins % 60} د`;
};

/** GMI (%) = 3.31 + 0.02392 × mean glucose (mg/dL). Only meaningful with ≥ 14 days and ≥ 70% data. */
export const gmi = (meanMgdl: number) => Math.round((3.31 + 0.02392 * meanMgdl) * 10) / 10;
