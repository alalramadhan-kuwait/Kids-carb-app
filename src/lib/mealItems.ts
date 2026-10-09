// Editing the items of a logged meal (not the recipe it came from): change an amount, remove an item, add a product.
// Pure. A line whose product is still in the catalogue is recomputed from its label; a line without one keeps its
// carbs in proportion to its amount. Nutrients follow the "missing is never zero" rule: a total stays known only when
// every line's share of it is known (the share of unresolved lines is what the saved total had beyond the resolved
// ones, and it is kept only while those lines all change by the same factor).
import { computeLine, MICRO_FIELD, type Micro } from './carbs';
import type { HistoryEntry, HistoryLine, Product, Settings } from './types';

export type Nut = 'fat' | 'fiber' | 'protein' | 'kcal' | Micro;
export const NUTS: Nut[] = ['fat', 'fiber', 'protein', 'kcal', ...(Object.keys(MICRO_FIELD) as Micro[])];
const COL: Record<Nut, keyof HistoryEntry> = {
  fat: 'total_fat', fiber: 'total_fiber', protein: 'total_protein', kcal: 'total_kcal', sat_fat: 'total_sat_fat', sugar_added: 'total_sugar_added',
  sodium: 'total_sodium', calcium: 'total_calcium', iron: 'total_iron', potassium: 'total_potassium', vit_d: 'total_vit_d',
};

export interface ItemRow { line: HistoryLine; q0: number; carbs0: number; product: Product | null; added?: boolean }

/** The product a logged line names: "name — brand" first, then the name alone. */
export function productOf(l: HistoryLine, products: Product[]): Product | null {
  return products.find((p) => [p.name, p.brand].filter(Boolean).join(' — ') === l.product) ?? products.find((p) => p.name === l.name) ?? null;
}
export const rowsOf = (h: HistoryEntry, products: Product[]): ItemRow[] =>
  h.lines.map((line) => ({ line, q0: line.quantity, carbs0: line.carbs ?? 0, product: productOf(line, products) }));

/** One line at its (new) quantity: carbs and every nutrient, or null where unknown. */
function valuesAt(r: ItemRow, quantity: number, settings: Settings): { carbs: number; nut: Record<Nut, number | null> } | null {
  if (!r.product) return null;
  const c = computeLine({ product_id: r.product.id, slot_category: null, unit: r.line.unit, state: r.line.state, quantity }, [{ ...r.product, approved: true }], settings);
  if (c.carbs === null) return null;
  const nut = { fat: c.fat, fiber: c.fiber, protein: c.protein, kcal: c.kcal, ...(c.micro ?? {}) } as Record<Nut, number | null>;
  for (const k of NUTS) if (nut[k] === undefined) nut[k] = null;
  return { carbs: c.carbs, nut };
}

const r1 = (x: number) => Math.round(x * 10) / 10;

/**
 * The edited meal: its lines (removed ones dropped) and totals. Only what changed moves: an untouched item keeps what
 * was logged, a changed catalogue item adds the label difference between its old and new amount, a changed item
 * without a product scales its carbs (and its share of the other totals, when that share is known).
 */
export function recompute(h: HistoryEntry, rows: ItemRow[], settings: Settings) {
  const lines: HistoryLine[] = [];
  let carbs = 0;
  const delta: Record<Nut, number> = Object.fromEntries(NUTS.map((k) => [k, 0])) as Record<Nut, number>;
  const lost = new Set<Nut>();
  const resolvedWas: Record<Nut, number | null> = Object.fromEntries(NUTS.map((k) => [k, 0])) as Record<Nut, number | null>;
  const ratios: number[] = []; // changed items without a product

  for (const r of rows) {
    const q = r.line.quantity;
    if (r.added) {
      const now = valuesAt(r, q, settings);
      if (!now || q <= 0) continue;
      for (const k of NUTS) { if (now.nut[k] === null) lost.add(k); else delta[k] += now.nut[k]!; }
      lines.push({ ...r.line, carbs: r1(now.carbs) }); carbs += now.carbs;
      continue;
    }
    const was = valuesAt(r, r.q0, settings);
    if (was) for (const k of NUTS) resolvedWas[k] = was.nut[k] === null || resolvedWas[k] === null ? null : resolvedWas[k]! + was.nut[k]!;
    if (q === r.q0) { lines.push(r.line); carbs += r.carbs0; continue; }      // untouched: as logged
    const now = was ? valuesAt(r, q, settings) : null;
    if (was && now) {
      for (const k of NUTS) { if (was.nut[k] === null || now.nut[k] === null) lost.add(k); else delta[k] += now.nut[k]! - was.nut[k]!; }
      const c = Math.max(0, r.carbs0 + now.carbs - was.carbs);
      if (q > 0) { lines.push({ ...r.line, carbs: r1(c) }); carbs += c; }
    } else {
      const f = r.q0 > 0 ? q / r.q0 : 0;
      ratios.push(f);
      if (q > 0) { const c = r.carbs0 * f; lines.push({ ...r.line, carbs: r1(c) }); carbs += c; }
    }
  }
  const sameRatio = ratios.every((x) => Math.abs(x - ratios[0]) < 1e-9);
  const totals = {} as Record<Nut, number | null>;
  for (const k of NUTS) {
    const saved = h[COL[k]] as number | null | undefined;
    if (saved == null || lost.has(k)) { totals[k] = null; continue; }
    if (!ratios.length) { totals[k] = Math.max(0, saved + delta[k]); continue; }
    // the items without a product hold what the saved total had beyond the catalogue items
    const rest = resolvedWas[k] === null || !sameRatio ? null : Math.max(0, saved - resolvedWas[k]!);
    totals[k] = rest === null ? null : Math.max(0, saved + delta[k] + rest * (ratios[0] - 1));
  }
  return { lines, carbs: r1(carbs), totals };
}

/** One item's carbs at its current amount (for showing beside it). */
export function carbsOfRow(r: ItemRow, settings: Settings): number {
  if (!r.added && r.line.quantity === r.q0) return r.carbs0;
  const now = valuesAt(r, r.line.quantity, settings);
  if (r.added) return now ? r1(now.carbs) : 0;
  const was = valuesAt(r, r.q0, settings);
  return was && now ? r1(Math.max(0, r.carbs0 + now.carbs - was.carbs)) : r.q0 > 0 ? r1(r.carbs0 * r.line.quantity / r.q0) : 0;
}

/** A new line for a product picked from the catalogue: one serving when it has one, else 100 g / ml. */
export function addRow(p: Product): ItemRow {
  const serving = p.serving_size ? 'serving' : p.unit;
  const line: HistoryLine = { name: p.name, product: [p.name, p.brand].filter(Boolean).join(' — '), quantity: serving === 'serving' ? 1 : 100, unit: serving as HistoryLine['unit'], state: 'as_is', role: 'main', carbs: null };
  return { line, q0: 0, carbs0: 0, product: p, added: true };
}

/** The database columns for the edited totals. */
export function totalsPatch(t: Record<Nut, number | null>) {
  const out: Record<string, number | null> = {};
  for (const k of NUTS) { const v = t[k]; out[COL[k] as string] = v === null ? null : k === 'kcal' || k === 'sodium' || k === 'calcium' || k === 'potassium' ? Math.round(v) : r1(v); }
  return out;
}

/** The rows as they will be saved when she ate only part of it: each amount times that part. */
export const scaledRows = (rows: ItemRow[], part: number): ItemRow[] =>
  part === 1 ? rows : rows.map((x) => ({ ...x, line: { ...x.line, quantity: Math.round(x.line.quantity * part * 10) / 10 } }));
