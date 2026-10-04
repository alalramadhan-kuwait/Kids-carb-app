// Mom mode, the pure parts: a meal built from portions (household measures set by a parent), turned into the plan
// items the rest of the app already understands; the status word for the home screen; injection-site rotation.
// Tested in Node. Nothing here proposes a dose; the dose always comes from engine/dose.ts and the care plan.
import type { Ingredient, InjectionSite, PlanItem, Portion, Product, Recipe } from '../lib/types';

/** One thing on her plate: a product or a recipe, in one of its portions. */
export interface MomItem { kind: 'product' | 'recipe'; id: string; portion_id: string }

export interface Catalog {
  products: Product[];
  recipes: Recipe[];
  ingsByRecipe: Map<string, Ingredient[]>;
  portions: Portion[];
}

/** The plan items for one mom item: a product's portion in its own unit, or a recipe's ingredients scaled. */
export function planItemsOf(it: MomItem, c: Catalog): PlanItem[] | null {
  const p = c.portions.find((x) => x.id === it.portion_id);
  if (!p) return null;
  if (it.kind === 'product') {
    const pr = c.products.find((x) => x.id === it.id);
    if (!pr || p.product_id !== pr.id) return null;
    return [{ product_id: pr.id, slot_category: null, label: null, quantity: Number(p.amount), unit: pr.unit, state: 'as_is', role: pr.category === 'مشروبات' ? 'drink' : 'main' }]; // i18n-ok: stored value
  }
  const r = c.recipes.find((x) => x.id === it.id);
  if (!r || p.recipe_id !== r.id) return null;
  const ings = (c.ingsByRecipe.get(r.id) ?? []).filter((i) => i.role !== 'snack');
  if (!ings.length) return null;
  return ings.map((i) => ({ product_id: i.product_id, slot_category: i.slot_category, label: i.label, quantity: Number(i.quantity) * Number(p.amount), unit: i.unit, state: i.state, role: i.role }));
}

/** Everything on the plate as plan items; null if any item is missing (no guessing). */
export function planItems(items: MomItem[], c: Catalog): PlanItem[] | null {
  const out: PlanItem[] = [];
  for (const it of items) { const x = planItemsOf(it, c); if (!x) return null; out.push(...x); }
  return out;
}

/** Shown to Mom only when the parent has set at least one portion and the item is approved. */
export function readyForMom(kind: 'product' | 'recipe', id: string, c: Catalog) {
  const has = c.portions.some((p) => (kind === 'product' ? p.product_id === id : p.recipe_id === id));
  if (!has) return false;
  if (kind === 'product') return !!c.products.find((x) => x.id === id)?.approved;
  const r = c.recipes.find((x) => x.id === id);
  return !!r && r.approved && !r.carb_pending;
}

/** The home screen's one word and colour, from the reading, its age and the trend. */
export type Mood = 'ok' | 'falling' | 'high' | 'low' | 'stale';
export function moodOf(mg: number | null, ageMin: number | null, level: number | null, low: number, high: number): Mood {
  if (mg === null || ageMin === null || ageMin > 15) return 'stale';
  if (mg < low) return 'low';
  if (level !== null && level <= -2) return 'falling';
  if (mg > high) return 'high';
  if (level !== null && level <= -1 && mg < low + 30) return 'falling';
  return 'ok';
}

// ── injection sites ─────────────────────────────────────────────────────────────────────────────
export const SITES: InjectionSite[] = ['belly_r', 'belly_l', 'thigh_r', 'thigh_l', 'arm_r', 'arm_l', 'buttock_r', 'buttock_l'];
export interface Shot { t: number; site: InjectionSite | null; type: 'rapid' | 'long' }

/** The rotation order: arms, then belly, then legs (buttocks if allowed), right before left. */
export const SITE_ORDER: InjectionSite[] = ['arm_r', 'arm_l', 'belly_r', 'belly_l', 'thigh_r', 'thigh_l', 'buttock_r', 'buttock_l'];

/** Rotation in cycles: every allowed site once, then a new cycle. The suggestion is the first site in SITE_ORDER not
 *  yet used in this cycle (never the one just used), so she can follow the order or mix freely; either way the cycle
 *  only ends when all sites have had their turn. Also when each site was last used (any insulin). */
export function siteSuggestion(shots: Shot[], allowed: InjectionSite[]) {
  const last = new Map<InjectionSite, number>();
  for (const s of shots) if (s.site && (!last.has(s.site) || s.t > last.get(s.site)!)) last.set(s.site, s.t);
  const order = SITE_ORDER.filter((x) => allowed.includes(x));
  const seq = shots.filter((s) => s.site && order.includes(s.site)).sort((a, b) => a.t - b.t);
  const used = new Set<InjectionSite>();
  for (const s of seq) { if (used.size === order.length) used.clear(); used.add(s.site!); }
  if (used.size === order.length) used.clear();
  const prev = seq.length ? seq[seq.length - 1].site : null;
  const suggest = order.find((x) => !used.has(x) && x !== prev) ?? order.find((x) => !used.has(x)) ?? order[0] ?? null;
  return { suggest, last, used, total: order.length };
}

/** Uses per site in the last `days` days, and the sites used much more than the rest (≥ 2× the average, at least 4). */
export function siteCounts(shots: Shot[], now: number, allowed: InjectionSite[], days = 14) {
  const counts = new Map<InjectionSite, number>(allowed.map((s) => [s, 0]));
  for (const s of shots) if (s.site && now - s.t <= days * 86400000 && counts.has(s.site)) counts.set(s.site, counts.get(s.site)! + 1);
  const total = [...counts.values()].reduce((a, b) => a + b, 0), avg = total / Math.max(1, allowed.length);
  const overused = [...counts.entries()].filter(([, n]) => n >= 4 && n >= 2 * avg).map(([s]) => s);
  return { counts, overused };
}

/** The doctor's gap between rapid doses: when the next one is allowed (null = now). */
export function nextRapidAllowed(lastRapidAt: number | null, gapMin: number, now: number): number | null {
  if (lastRapidAt === null) return null;
  const at = lastRapidAt + gapMin * 60000;
  return at > now ? at : null;
}
