// Pattern cards (GLUCOSE_PLAN 10.10, 11.10, stage 11). Pure, tested in Node. Each card states the rule that
// produced it and the days behind it, so the parents can check it; none says what to do about it.
import type { HistoryEntry } from '../lib/types';
import { dayStartOf, lowEpisodes } from './day';
import { nearest, type Series } from './series';

const MIN = 60000, HOUR = 60 * MIN, DAY = 24 * HOUR;

export type PatternKind = 'recurring_lows' | 'overnight_drift' | 'recipe_rise' | 'unusual_day';
export interface PatternCard {
  id: string;            // stable per rule and subject, used to dismiss
  kind: PatternKind;
  title: string;
  /** what was seen; {0}, {1}… are mg/dL values the page formats in her unit */
  facts: { text: string; mg?: number[] };
  rule: string;
  n: number;             // how many events or nights the card rests on
  days: number[];        // Kuwait day starts behind the card, newest first, for drill-down
}

export interface PatternInput {
  series: Series; history: HistoryEntry[]; now: number;
  low: number; high: number; reference: boolean;
}

const median = (a: number[]) => { const s = [...a].sort((x, y) => x - y), m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
const at = (s: Series, t: number, tol = 15 * MIN) => { const i = nearest(s, t, tol); return i === null ? null : s.v[i]; };
const hh = (h: number) => `${String(h % 24).padStart(2, '0')}:00`;

/** Fixed thresholds, stated on every card (GLUCOSE_PLAN 5.7). */
export const DRIFT_MG = 30, RISE_MG = 60;

/** Rules from GLUCOSE_PLAN 5.7. Descriptive only. */
export function findPatterns(p: PatternInput): PatternCard[] {
  const { series: s, now } = p;
  const today = dayStartOf(now);
  const out: PatternCard[] = [];

  // 1. recurring lows by time of day: ≥ 3 episodes starting in the same 2-hour window within 14 days
  {
    const eps = lowEpisodes(s, now - 14 * DAY, now, p.low, 10).map((e) => ({ ...e, h: (e.t - dayStartOf(e.t)) / HOUR }));
    let best: { from: number; list: typeof eps } | null = null;
    for (let from = 0; from < 24; from++) {
      const list = eps.filter((e) => ((e.h - from + 24) % 24) < 2);
      if (list.length >= 3 && (!best || list.length > best.list.length)) best = { from, list };
    }
    if (best) {
      // name the window from the earliest start in the cluster (circular across midnight)
      const offs = best.list.map((e) => (e.h - best!.from + 24) % 24);
      best.from = (best.from + Math.floor(Math.min(...offs))) % 24;
    }
    if (best)
      out.push({
        id: `recurring_lows:${best.from}`, kind: 'recurring_lows', title: `انخفاضات متكررة بين ${hh(best.from)} و${hh(best.from + 2)}`,
        facts: { text: `${best.list.length} انخفاضات تحت {0} بدأت في هذه الساعتين خلال آخر 14 يومًا. أدنى قراءة {1}.${p.reference ? ' الحد مرجعي.' : ''}`, mg: [p.low, Math.min(...best.list.map((e) => e.nadir))] },
        rule: 'القاعدة: 3 انخفاضات أو أكثر (كل منها 10 دقائق على الأقل دون انقطاع في البيانات) تبدأ في نفس الساعتين خلال 14 يومًا.',
        n: best.list.length, days: [...new Set(best.list.map((e) => dayStartOf(e.t)))].sort((a, b) => b - a),
      });
  }

  // 2. overnight drift: median change 00:00 → 06:00 over the last 7 nights
  {
    const nights: { day: number; d: number }[] = [];
    for (let k = 0; k < 7; k++) {
      const d = today - k * DAY; if (d + 6 * HOUR > now) continue;
      const a = at(s, d), b = at(s, d + 6 * HOUR);
      if (a !== null && b !== null) nights.push({ day: d, d: b - a });
    }
    const m = nights.length >= 4 ? median(nights.map((n) => n.d)) : 0;
    if (Math.abs(m) >= DRIFT_MG) {
      const down = m < 0, hits = nights.filter((n) => (down ? -n.d : n.d) >= DRIFT_MG);
      out.push({
        id: `overnight_drift:${down ? 'down' : 'up'}`, kind: 'overnight_drift', title: down ? 'نزول خلال الليل' : 'ارتفاع خلال الليل',
        facts: { text: `${down ? 'نزل' : 'ارتفع'} السكر بين 00:00 و06:00 أكثر من {0} في ${hits.length} من ${nights.length} ليالٍ. الوسيط {1}.`, mg: [DRIFT_MG, Math.abs(m)] },
        rule: `القاعدة: وسيط التغيّر من 00:00 إلى 06:00 (قراءة ±15 د عند كل طرف) في آخر 7 ليالٍ، ${DRIFT_MG} ملغ/دل أو أكثر، و4 ليالٍ فيها بيانات على الأقل.`,
        n: nights.length, days: hits.map((h) => h.day),
      });
    }
  }

  // 3. recurring rise after a recipe: median rise ≥ RISE_MG with n ≥ 3 (last 30 days)
  {
    const by = new Map<string, { name: string; rows: { day: number; rise: number }[] }>();
    for (const h of p.history) {
      const t = Date.parse(h.eaten_at);
      if (h.kind !== 'meal' || t < now - 30 * DAY || t + 150 * MIN > now) continue;
      const v0 = at(s, t, 10 * MIN); if (v0 === null) continue;
      let peak = -Infinity, n = 0;
      for (let i = 0; i < s.t.length; i++) if (s.t[i] >= t && s.t[i] <= t + 150 * MIN) { n++; peak = Math.max(peak, s.v[i]); }
      if (n < 6) continue;
      const key = h.recipe_id ?? h.name, g = by.get(key) ?? { name: h.name, rows: [] };
      g.rows.push({ day: dayStartOf(t), rise: peak - v0 }); by.set(key, g);
    }
    const rows = [...by.entries()].map(([key, g]) => ({ key, ...g, m: median(g.rows.map((r) => r.rise)) }))
      .filter((g) => g.rows.length >= 3 && g.m >= RISE_MG).sort((a, b) => b.m - a.m).slice(0, 3);
    for (const g of rows)
      out.push({
        id: `recipe_rise:${g.key}`, kind: 'recipe_rise', title: `ارتفاع بعد ${g.name}`,
        facts: { text: `وسيط الارتفاع خلال ساعتين ونصف بعد الأكل {0} في ${g.rows.length} مرات.`, mg: [g.m] },
        rule: `القاعدة: قراءة عند بداية الوجبة (±10 د) وأعلى قراءة بعدها خلال ساعتين ونصف؛ الوسيط ${RISE_MG} ملغ/دل أو أكثر في 3 مرات على الأقل خلال 30 يومًا.`,
        n: g.rows.length, days: [...new Set(g.rows.map((r) => r.day))].sort((a, b) => b - a),
      });
  }

  // 4. unusual day: today's time below (or above) range above her 90th percentile of the last 14 days
  {
    const share = (d: number, e: number) => {
      const slots = new Set<number>(); let n = 0, lo = 0, hi = 0;
      for (let i = 0; i < s.t.length; i++) if (s.t[i] >= d && s.t[i] < e) {
        n++; if (s.v[i] < p.low) lo++; else if (s.v[i] > p.high) hi++; slots.add(Math.floor((s.t[i] - d) / (15 * MIN)));
      }
      return { slots: slots.size, lo: n ? (lo / n) * 100 : 0, hi: n ? (hi / n) * 100 : 0 };
    };
    const td = share(today, now);
    const past: { lo: number; hi: number }[] = [];
    for (let k = 1; k <= 14; k++) { const x = share(today - k * DAY, today - (k - 1) * DAY); if (x.slots >= 67) past.push(x); }
    if (td.slots >= 24 && past.length >= 7) {
      const p90 = (a: number[]) => { const q = [...a].sort((x, y) => x - y); return q[Math.min(q.length - 1, Math.ceil(0.9 * q.length) - 1)]; };
      for (const side of ['lo', 'hi'] as const) {
        const ref = p90(past.map((x) => x[side]));
        if (td[side] > ref && td[side] >= 5)
          out.push({
            id: `unusual_day:${today}:${side}`, kind: 'unusual_day', title: side === 'lo' ? 'اليوم وقت أطول تحت النطاق' : 'اليوم وقت أطول فوق النطاق',
            facts: { text: `${side === 'lo' ? 'تحت' : 'فوق'} النطاق ${Math.round(td[side])}% من اليوم حتى الآن، وأعلى من 90% من أيامها في آخر 14 يومًا (${Math.round(ref)}%).${p.reference ? ' النطاق مرجعي.' : ''}` },
            rule: 'القاعدة: نسبة اليوم فوق المئين التسعين لآخر 14 يومًا (الأيام التي فيها بيانات 70% أو أكثر، 7 أيام على الأقل)، وبعد 6 ساعات من البيانات اليوم.',
            n: past.length, days: [today],
          });
      }
    }
  }
  return out;
}

/** Dismissed cards stay hidden for a week, then come back if the rule still holds. */
export const DISMISS_MS = 7 * DAY;
export const visible = (cards: PatternCard[], dismissed: Record<string, number>, now: number) => cards.filter((c) => !(dismissed[c.id] > now));
