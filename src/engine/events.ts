// CGM Timeline Engine — event layer (GLUCOSE_PLAN 11.5, 10.7). Pure: builds rail markers from what the parents
// logged, groups markers that would collide, and computes a meal's glucose response from stored readings.
import type { EventRow, HistoryEntry } from '../lib/types';
import { GAP_MS, lowerBound, nearest, type Series } from './series';
import { t } from '../i18n';

const MIN = 60000;

export type Layer = 'meals' | 'insulin' | 'treatment' | 'basal' | 'exercise' | 'notes' | 'sleep' | 'iob' | 'act' | 'cob' | 'forecast';
// labels stay Arabic here and are shown with t(l.label)
export const LAYERS: { id: Layer; label: string; on: boolean }[] = [
  { id: 'meals', label: 'الوجبات والكارب', on: true }, // i18n-ok
  { id: 'insulin', label: 'الإنسولين السريع', on: true }, // i18n-ok
  { id: 'treatment', label: 'علاج الانخفاض', on: true }, // i18n-ok
  { id: 'basal', label: 'الإنسولين الطويل', on: false }, // i18n-ok
  { id: 'exercise', label: 'الرياضة', on: false }, // i18n-ok
  { id: 'notes', label: 'الملاحظات', on: false }, // i18n-ok
  { id: 'sleep', label: 'النوم', on: false }, // i18n-ok
  { id: 'iob', label: 'الإنسولين النشط (IOB)', on: false }, // i18n-ok
  { id: 'act', label: 'مفعول الإنسولين (الذروة)', on: true }, // i18n-ok
  { id: 'cob', label: 'الكارب النشط (COB)', on: false }, // i18n-ok
  { id: 'forecast', label: 'التوقعات', on: true }, // i18n-ok
];
export const defaultLayers = () => new Set(LAYERS.filter((l) => l.on).map((l) => l.id));

export type MarkKind = 'meal' | 'carbs' | 'insulin' | 'basal' | 'treatment' | 'exercise' | 'note' | 'sleep';
export interface Mark {
  key: string; t: number; end?: number; kind: MarkKind; layer: Layer;
  carbs?: number; units?: number; name?: string;
  /** a meal whose carbs are not known (ate out) */
  unknown?: boolean;
  event?: EventRow; meal?: HistoryEntry;
}

export function buildMarks(history: HistoryEntry[], events: EventRow[]): Mark[] {
  const out: Mark[] = [];
  for (const h of history) out.push({ key: 'h' + h.id, t: Date.parse(h.eaten_at), kind: 'meal', layer: 'meals', carbs: h.total_carbs ?? undefined, unknown: h.total_carbs === null, name: h.name, meal: h });
  for (const e of events) {
    if (e.deleted_at) continue;
    const t = Date.parse(e.occurred_at), base = { key: 'e' + e.id, t, event: e };
    switch (e.kind) {
      case 'insulin': out.push(e.insulin_type === 'long'
        ? { ...base, kind: 'basal', layer: 'basal', units: e.insulin_units ?? undefined }
        : { ...base, kind: 'insulin', layer: 'insulin', units: e.insulin_units ?? undefined }); break;
      case 'carbs': out.push({ ...base, kind: 'carbs', layer: 'meals', carbs: e.carbs_g ?? undefined }); break;
      case 'treatment': out.push({ ...base, kind: 'treatment', layer: 'treatment', carbs: e.carbs_g ?? undefined }); break;
      case 'exercise': out.push({ ...base, kind: 'exercise', layer: 'exercise', end: t + (e.activity_min ?? 0) * MIN }); break;
      case 'sleep': out.push({ ...base, kind: 'sleep', layer: 'sleep', end: e.ends_at ? Date.parse(e.ends_at) : t }); break;
      default: out.push({ ...base, kind: 'note', layer: 'notes' });
    }
  }
  return out.sort((a, b) => a.t - b.t);
}

export interface Group { x: number; t: number; marks: Mark[] }

/** Markers closer than `px` on screen merge into one chip (e.g. a meal and its bolus). Sleep is drawn as a band, not grouped. */
export function groupMarks(marks: Mark[], layers: Set<Layer>, start: number, end: number, width: number, px = 30): Group[] {
  const groups: Group[] = [];
  const k = width / (end - start);
  for (const m of marks) {
    if (!layers.has(m.layer) || m.kind === 'sleep' || m.t < start - (end - start) * 0.02 || m.t > end) continue;
    const x = (m.t - start) * k, last = groups[groups.length - 1];
    if (last && x - last.x < px) last.marks.push(m);
    else groups.push({ x, t: m.t, marks: [m] });
  }
  return groups;
}

/** Short rail label: "45 غ + 3 و", with a hypo treatment kept apart ("علاج 15 غ") so it is never read as meal carbs. */
export function groupLabel(g: Group): string {
  let carbs = 0, units = 0, treat = 0, unknown = false;
  for (const m of g.marks) {
    if (m.unknown) unknown = true;
    if (m.kind === 'meal' || m.kind === 'carbs') carbs += m.carbs ?? 0;
    if (m.kind === 'treatment') treat += m.carbs ?? 0;
    if (m.kind === 'insulin') units += m.units ?? 0;
  }
  const r = (n: number) => String(Math.round(n * 10) / 10);
  return [carbs ? t('{v} غ', { v: r(carbs) }) + (unknown ? ' + ?' : '') : unknown ? t('كارب ؟') : '', units ? t('{v} و', { v: r(units) }) : '', treat ? t('علاج {v} غ', { v: r(treat) }) : ''].filter(Boolean).join(' + ');
}

/**
 * The events under the graph in two lanes. Each event (icon, what, when) is centred on its time; lane 1 is the
 * default, and an event whose block would touch the one before it in lane 1 goes to lane 2. Only when both lanes are
 * taken there is it nudged along (the caller draws its line back to the time), and one that still cannot fit is left
 * out (null) rather than drawn over another. Items in time order.
 */
export function laneLayout(items: { x: number; w: number }[], width: number, gap = 10, edge = 2): ({ lane: 0 | 1; left: number } | null)[] {
  const right = [edge - gap, edge - gap];
  return items.map(({ x, w }) => {
    const c = Math.min(Math.max(x - w / 2, edge), width - edge - w);
    for (const lane of [0, 1] as const) if (c >= right[lane] + gap) { right[lane] = c + w; return { lane, left: c }; }
    const lane: 0 | 1 = right[0] <= right[1] ? 0 : 1, left = right[lane] + gap;
    if (left + w > width - edge) return null;
    right[lane] = left + w;
    return { lane, left };
  });
}

// ── meal response (GLUCOSE_PLAN 10.7) ─────────────────────────────────────────
export const OFFSETS = [30, 60, 90, 120, 180] as const;
export interface MealResponse {
  g0: number | null;                                  // glucose within ±10 min of the meal
  at: Record<(typeof OFFSETS)[number], number | null>; // nearest reading within ±5 min, never across a gap
  peak: number | null; rise: number | null; ttp: number | null; // in 0–4 h, up to the first gap
  complete: boolean;                                  // 4 h of data with no gap
  bolus: EventRow | null; prebolus: number | null;    // minutes; positive = insulin before eating
}

export function mealResponse(s: Series, t0: number, events: EventRow[], now = Date.now()): MealResponse {
  const i0 = nearest(s, t0, 10 * MIN);
  const g0 = i0 !== null ? s.v[i0] : null;
  // contiguous data from the meal forward: stop at the first gap
  const iEnd = lowerBound(s.t, t0);
  let last = iEnd;
  const limit = t0 + 240 * MIN;
  while (last + 1 < s.t.length && s.t[last + 1] <= limit && s.t[last + 1] - s.t[last] <= GAP_MS) last++;
  const reached = last < s.t.length && iEnd < s.t.length ? s.t[last] : -Infinity;
  const startsClean = iEnd < s.t.length && s.t[iEnd] - t0 <= GAP_MS; // a reading soon after the meal
  const at = {} as MealResponse['at'];
  for (const o of OFFSETS) {
    const j = startsClean ? nearest(s, t0 + o * MIN, 5 * MIN) : null;
    at[o] = j !== null && s.t[j] <= reached ? s.v[j] : null;
  }
  let peak: number | null = null, ttp: number | null = null;
  if (startsClean) for (let j = iEnd; j <= last; j++) if (peak === null || s.v[j] > peak) { peak = s.v[j]; ttp = Math.round((s.t[j] - t0) / MIN); }
  const complete = startsClean && limit <= now && reached >= limit - 10 * MIN;
  // the meal bolus: rapid insulin for a meal (or meal + correction) from 60 min before to 30 min after
  let bolus: EventRow | null = null;
  for (const e of events) {
    if (e.deleted_at || e.kind !== 'insulin' || e.insulin_type === 'long' || e.bolus_purpose === 'correction') continue;
    const dt = Date.parse(e.occurred_at) - t0;
    if (dt < -60 * MIN || dt > 30 * MIN) continue;
    if (!bolus || Math.abs(dt) < Math.abs(Date.parse(bolus.occurred_at) - t0)) bolus = e;
  }
  return {
    g0, at, peak, ttp, complete, bolus,
    rise: peak !== null && g0 !== null ? peak - g0 : null,
    prebolus: bolus ? Math.round((t0 - Date.parse(bolus.occurred_at)) / MIN) : null,
  };
}
