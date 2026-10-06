// The dietitian's "graph + events" page: the day's events in time order, numbered, so the numbers on the graph point
// to rows of the table. A meal row carries its insulin (the dose markers show the meal's number); a correction, the
// long-acting dose and activity get rows of their own. Each item says where its carbs came from, and anything the
// dietitian should not trust as measured is flagged. Pure, so it is tested.
import type { Product } from './types';
import { restaurantOf } from './restaurants';
import type { DaySheet, Dose, Food, Line, Occasion, Treat } from './dietSheet';

const MIN = 60000;
export const AFTER_MIN = 120;

/** label: the pack's nutrition label · table: a food-composition value for a plain food · restaurant: the chain's
 *  published menu · portion: a household measure (spoon, piece) turned into grams · estimate: typed or estimated by
 *  the family · gluroo: imported from Gluroo, as entered there */
export type CarbSource = 'label' | 'table' | 'restaurant' | 'portion' | 'estimate' | 'gluroo';
export const UNSURE: CarbSource[] = ['estimate', 'gluroo'];

export interface EventItem { line: Line; source: CarbSource }
export type Lane = 'food' | 'med';
interface Base { n: number; t: number; lane: Lane; at: number | null; after: number | null; afterMin: number; warn: string[] }
export type DayEvent =
  | (Base & { kind: 'food'; occ: Occasion; items: EventItem[]; recipe: boolean })
  | (Base & { kind: 'treat'; tr: Treat; source: CarbSource })
  | (Base & { kind: 'dose'; dose: Dose })
  | (Base & { kind: 'note'; text: string });

type Unnumbered = DayEvent extends infer T ? T extends DayEvent ? Omit<T, 'n'> : never : never;
const ESTIMATE = /estimate|\u062a\u0642\u062f\u064a\u0631/i; // "estimate" in English or Arabic, in a product's name or notes

export function sourceOf(line: Pick<Line, 'unit' | 'productKey' | 'name'>, food: Pick<Food, 'flags'>, product: Product | null): CarbSource {
  if (food.flags?.includes('imported')) return 'gluroo';
  if (!product) return 'estimate';
  if (ESTIMATE.test(product.name) || ESTIMATE.test(product.notes ?? '')) return 'estimate';
  if (restaurantOf(product.brand)) return 'restaurant';
  if (line.unit === 'tbsp' || (line.unit === 'serving' && !product.per_item && product.kind === 'natural')) return 'portion';
  return product.kind === 'commercial' ? 'label' : 'table';
}

export const productFinder = (products: Product[]) => (key: string | null, name: string) =>
  products.find((p) => key && [p.name, p.brand].filter(Boolean).join(' — ') === key) ?? products.find((p) => p.name === name) ?? null;

/** The reading nearest to t within 15 minutes, from the day's points. */
export function glucoseAt(points: [number, number][], t: number): number | null {
  let best: [number, number] | null = null;
  for (const p of points) if (Math.abs(p[0] - t) <= 15 * MIN && (!best || Math.abs(p[0] - t) < Math.abs(best[0] - t))) best = p;
  return best?.[1] ?? null;
}

const FLAG_WARN: Record<string, string> = { estimate: 'estimate', imported: 'gluroo', review: 'review', recipe: 'recipe', unnamed: 'estimate', duplicate: 'duplicate' };

export function dayEvents(s: DaySheet, products: Product[], o: { after?: [number, number][] } = {}): DayEvent[] {
  const find = productFinder(products);
  const pts = o.after ? [...s.points, ...o.after] : s.points; // readings past midnight, for the +2 h of a late dinner
  const out: Unnumbered[] = [];
  const occs = s.slots.flatMap((sl) => sl.occasions);
  const withMeal = new Set(occs.flatMap((oc) => oc.doses));
  for (const oc of occs) {
    const items: EventItem[] = oc.foods.flatMap((f) => {
      const lines: Line[] = f.lines?.length ? f.lines : [{ name: f.name, named: f.named, quantity: null, unit: null, carbs: f.carbs, productKey: null }];
      return lines.map((line) => ({ line, source: sourceOf(line, f, f.lines?.length ? find(line.productKey, line.name) : find(null, f.name)) }));
    });
    const warn = new Set(oc.foods.flatMap((f) => (f.flags ?? []).map((x) => FLAG_WARN[x])));
    if (items.some((i) => i.source === 'estimate')) warn.add('estimate');
    out.push({ kind: 'food', t: oc.t, lane: 'food', occ: oc, items, recipe: oc.foods.some((f) => f.recipe),
      at: oc.before?.mg ?? glucoseAt(pts, oc.t), after: oc.after?.mg ?? null, afterMin: AFTER_MIN, warn: [...warn] });
  }
  for (const f of s.night) {
    // after midnight but before the day's first meal column: no occasion, shown on its own
    const lines: Line[] = f.lines?.length ? f.lines : [{ name: f.name, named: f.named, quantity: null, unit: null, carbs: f.carbs, productKey: null }];
    const items = lines.map((line) => ({ line, source: sourceOf(line, f, f.lines?.length ? find(line.productKey, line.name) : find(null, f.name)) }));
    const occ: Occasion = { t: f.t, foods: [f], carbs: f.carbs, fat: { v: f.fat, partial: false }, protein: { v: f.protein, partial: false }, kcal: { v: f.kcal, partial: false }, fiber: { v: f.fiber, partial: false },
      before: null, after: null, affected: [], startedLow: false, lowAfter: null, doses: [], fatty: false, noFatData: false, bump: null };
    const warn = new Set((f.flags ?? []).map((x) => FLAG_WARN[x]));
    if (items.some((i) => i.source === 'estimate')) warn.add('estimate');
    out.push({ kind: 'food', t: f.t, lane: 'food', occ, items, recipe: !!f.recipe, at: glucoseAt(pts, f.t), after: glucoseAt(pts, f.t + AFTER_MIN * MIN), afterMin: AFTER_MIN, warn: [...warn] });
  }
  for (const tr of s.treatments) {
    // found by the sensor: its source is the food entry's; logged as a treatment: the product it was picked from
    const src = tr.food
      ? (tr.food.lines?.length ? tr.food.lines : [null]).map((l) => sourceOf(l ?? { unit: null, productKey: null, name: tr.food!.name }, tr.food!, l ? find(l.productKey, l.name) : find(null, tr.food!.name)))
      : [sourceOf({ unit: null, productKey: null, name: tr.name }, {}, find(null, tr.productName ?? tr.name))];
    const source = src.find((x) => UNSURE.includes(x)) ?? src[0];
    out.push({ kind: 'treat', t: tr.t, lane: 'food', tr, source,
      at: tr.startMg ?? glucoseAt(pts, tr.t), after: tr.after15 ?? glucoseAt(pts, tr.t + 15 * MIN), afterMin: 15, warn: [...(tr.duplicate ? ['duplicate'] : []), ...(UNSURE.includes(source) ? [source] : [])] });
  }
  for (const d of [...s.otherDoses, ...s.basal]) if (!withMeal.has(d))
    out.push({ kind: 'dose', t: d.t, lane: 'med', dose: d, at: glucoseAt(pts, d.t), after: d.type === 'long' ? null : glucoseAt(pts, d.t + AFTER_MIN * MIN), afterMin: AFTER_MIN, warn: [] });
  for (const a of s.activities) out.push({ kind: 'note', t: a.t, lane: 'med', text: a.text, at: glucoseAt(pts, a.t), after: null, afterMin: AFTER_MIN, warn: [] });
  return out.sort((a, b) => a.t - b.t).map((e, i) => ({ ...e, n: i + 1 }) as DayEvent);
}

/** Markers on two rows under the graph (food and treatments; insulin and the rest). A meal's doses are drawn in the
 *  insulin row with the meal's number. Markers too close to the one before move down a step (up to three steps). */
export interface Marker { n: number; t: number; lane: Lane; kind: 'food' | 'treat' | 'dose' | 'note'; step: number }
export function markers(evs: DayEvent[], xOf: (t: number) => number, minGap = 20): Marker[] {
  const raw: Omit<Marker, 'step'>[] = [];
  for (const e of evs) {
    raw.push({ n: e.n, t: e.t, lane: e.lane, kind: e.kind });
    if (e.kind === 'food') for (const d of e.occ.doses) raw.push({ n: e.n, t: d.t, lane: 'med', kind: 'dose' });
  }
  raw.sort((a, b) => a.t - b.t);
  const last: Record<Lane, number[]> = { food: [], med: [] };
  return raw.map((m) => {
    const x = xOf(m.t), row = last[m.lane];
    let step = 0;
    while (step < 2 && row[step] !== undefined && x - row[step] < minGap) step++;
    row[step] = x;
    return { ...m, step };
  });
}
