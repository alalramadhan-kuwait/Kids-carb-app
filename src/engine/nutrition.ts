// Nutrition from the food log: daily totals, Today / 7-day / 30-day averages, and a status per nutrient against a
// reference that the dietitian can override. Pure, tested in Node. Sources are named on every reference and listed in
// docs/GROWTH_NUTRITION.md. Two rules hold everywhere:
//   1. Missing is never zero. Every total carries its coverage: the share of the food (by energy) whose label gave
//      that nutrient. Below the coverage threshold the answer is "not enough data".
//   2. Low treatments count toward energy eaten, never toward diet quality or balance.
// Macronutrient percentages are context (ISPAD gives ranges, not pass/fail); nothing here suggests eating less.
import { isFatty } from './iob';
import type { Eer } from './energy';

const HOUR = 3600000, DAY = 24 * HOUR, KW = 3 * HOUR;
export const dayKey = (t: number) => new Date(t + KW).toISOString().slice(0, 10);

export type Nutrient = 'carbs' | 'protein' | 'fat' | 'sat_fat' | 'fiber' | 'sugar_added' | 'sodium' | 'calcium' | 'iron' | 'potassium' | 'vit_d';
export const NUTRIENTS: Nutrient[] = ['carbs', 'protein', 'fat', 'sat_fat', 'fiber', 'sugar_added', 'calcium', 'iron', 'vit_d', 'potassium', 'sodium'];
export const UNIT: Record<Nutrient | 'energy', string> = { energy: 'kcal', carbs: 'g', protein: 'g', fat: 'g', sat_fat: 'g', fiber: 'g', sugar_added: 'g', sodium: 'mg', calcium: 'mg', iron: 'mg', potassium: 'mg', vit_d: 'µg' };

/** APP RULES (configurable, not clinical standards). */
export const NUTRITION_RULES = {
  coverageMin: 0.8,           // below this share of food with the nutrient's value: "not enough data"
  completeDayMeals: 3,        // a day counts in averages only with at least this many food entries
  minDays: { d3: 2, d7: 3, d30: 7 }, // complete days needed before a 3-, 7- or 30-day status is shown
  slightlyPts: 5,             // up to this many percentage points outside a %-of-energy range reads "slightly"
  carbShareForUnknownKcal: 0.45, // an entry with no calorie figure is weighed as carbs×4 ÷ 0.45 (middle of ISPAD's 40–50 %)
  fewDaysShare: 0.5,          // a food group on fewer than half of complete days is "few"
};

/* ------------------------------------------------------------- the log */

export type FoodGroup = 'vegetables' | 'fruit' | 'grains' | 'protein' | 'dairy' | 'legumes_nuts' | 'extras' | 'fats' | 'mixed';
/** ADA Standards of Care 2026, 14.2: more non-starchy vegetables, whole fruits, legumes, whole grains, nuts and seeds,
 *  low-fat dairy; less sugar-sweetened beverages, sweets, refined grains and processed foods. The app's product
 *  categories map once to these groups (a product can override its group). */
export const CATEGORY_GROUP: Record<string, FoodGroup> = {
  'خضار': 'vegetables', 'ملوخية': 'vegetables', // i18n-ok: data keys
  'فواكه': 'fruit', // i18n-ok
  'توست': 'grains', 'صمون': 'grains', 'خبز': 'grains', 'باستا': 'grains', 'نشويات': 'grains', 'طحين': 'grains', // i18n-ok
  'لحوم ودجاج': 'protein', 'بيض': 'protein', 'برغر لحم': 'protein', // i18n-ok
  'حليب': 'dairy', 'لبن': 'dairy', 'روب': 'dairy', 'جبن': 'dairy', // i18n-ok
  'حلويات': 'extras', 'آيس كريم': 'extras', 'كيك': 'extras', 'بسكويت': 'extras', 'مشروبات': 'extras', 'معجنات': 'extras', 'ناجت': 'extras', 'بطاط مجمد': 'extras', // i18n-ok
  'صلصة': 'fats', 'كاتشب': 'fats', 'مايونيز': 'fats', 'كريمة طبخ': 'fats', // i18n-ok
  'سندويشات': 'mixed', // i18n-ok
};
export const SHOWN_GROUPS: FoodGroup[] = ['vegetables', 'fruit', 'grains', 'protein', 'dairy'];

export interface FoodEntry {
  at: number; kcal: number | null; carbs: number;
  values: Partial<Record<Nutrient, number | null>>;   // null = the label did not give it
  groups: FoodGroup[] | null;                          // null = not classifiable (e.g. imported name only)
  extrasCarbs: number | null;                          // carbs from sweets, sugary drinks and processed snacks
}
export interface Treatment { at: number; carbs: number }

/** A logged meal or snack → a food entry. `groupOf` resolves a line to its food group (via its product). */
export function foodEntry(h: {
  eaten_at: string; total_carbs: number; total_kcal: number | null; total_fat: number | null; total_protein: number | null; total_fiber: number | null;
  total_sat_fat?: number | null; total_sugar_added?: number | null; total_sodium?: number | null; total_calcium?: number | null; total_iron?: number | null; total_potassium?: number | null; total_vit_d?: number | null;
  lines?: { name: string; product: string | null; carbs: number | null }[];
}, groupOf: (line: { name: string; product: string | null }) => FoodGroup | null): FoodEntry {
  const kcal = h.total_kcal ?? (h.total_fat !== null && h.total_protein !== null ? 4 * h.total_carbs + 9 * h.total_fat + 4 * h.total_protein : null);
  const g = (h.lines ?? []).map((l) => ({ g: groupOf(l), c: l.carbs ?? 0 }));
  const known = g.length > 0 && g.every((x) => x.g !== null);
  return {
    at: Date.parse(h.eaten_at), kcal, carbs: h.total_carbs,
    values: {
      carbs: h.total_carbs, protein: h.total_protein, fat: h.total_fat, fiber: h.total_fiber, sat_fat: h.total_sat_fat ?? null, sugar_added: h.total_sugar_added ?? null,
      sodium: h.total_sodium ?? null, calcium: h.total_calcium ?? null, iron: h.total_iron ?? null, potassium: h.total_potassium ?? null, vit_d: h.total_vit_d ?? null,
    },
    groups: known ? [...new Set(g.map((x) => x.g!))] : null,
    extrasCarbs: known ? g.filter((x) => x.g === 'extras').reduce((s, x) => s + x.c, 0) : null,
  };
}
/** Carbs logged on their own (not a low treatment): food with only its carbs known. */
export const carbsOnly = (at: number, carbs: number): FoodEntry => ({ at, kcal: null, carbs, values: { carbs }, groups: null, extrasCarbs: null });

/* ------------------------------------------------------------- one day */

export interface Total { known: number; est: number | null; coverage: number }  // est = known ÷ coverage (≈ the whole day)
export interface Day {
  key: string; entries: number; complete: boolean;
  energy: Total;                         // food only
  treatment: { carbs: number; kcal: number };
  nutrients: Record<Nutrient, Total>;
  groups: Partial<Record<FoodGroup, boolean>>; groupCoverage: number; extrasCarbShare: number | null;
}

const weight = (e: FoodEntry, R = NUTRITION_RULES) => e.kcal ?? (e.carbs * 4) / R.carbShareForUnknownKcal;
const total = (known: number, coveredW: number, allW: number): Total => {
  const coverage = allW > 0 ? coveredW / allW : 0;
  return { known, coverage, est: coverage > 0 ? known / coverage : null };
};

export function day(key: string, food: FoodEntry[], treatments: Treatment[], R = NUTRITION_RULES): Day {
  const W = food.reduce((s, e) => s + weight(e, R), 0);
  const nut = {} as Record<Nutrient, Total>;
  for (const n of NUTRIENTS) {
    const has = food.filter((e) => e.values[n] != null);
    nut[n] = total(has.reduce((s, e) => s + e.values[n]!, 0), has.reduce((s, e) => s + weight(e, R), 0), W);
  }
  const kn = food.filter((e) => e.kcal !== null);
  const energy = total(kn.reduce((s, e) => s + e.kcal!, 0), kn.reduce((s, e) => s + weight(e, R), 0), W);
  const cl = food.filter((e) => e.groups);
  const groups: Day['groups'] = {};
  for (const e of cl) for (const g of e.groups!) groups[g] = true;
  const carbsCl = cl.reduce((s, e) => s + e.carbs, 0);
  const tc = treatments.reduce((s, x) => s + x.carbs, 0);
  return {
    key, entries: food.length, complete: food.length >= R.completeDayMeals,
    energy, treatment: { carbs: tc, kcal: tc * 4 },
    nutrients: nut, groups, groupCoverage: W > 0 ? cl.reduce((s, e) => s + weight(e, R), 0) / W : 0,
    extrasCarbShare: carbsCl > 0 ? cl.reduce((s, e) => s + (e.extrasCarbs ?? 0), 0) / carbsCl : null,
  };
}

/** Days from the log, newest first; `today` is the key of the day in progress (never counted as complete). */
export function days(food: FoodEntry[], treatments: Treatment[], today: string, R = NUTRITION_RULES): Day[] {
  const keys = new Set([...food.map((e) => dayKey(e.at)), ...treatments.map((x) => dayKey(x.at))]);
  return [...keys].sort().reverse().map((k) => {
    const d = day(k, food.filter((e) => dayKey(e.at) === k), treatments.filter((x) => dayKey(x.at) === k), R);
    return k === today ? { ...d, complete: false } : d;
  });
}

/* ------------------------------------------------------------ a period */

export type Period = 'today' | 'd3' | 'd7' | 'd30';
export const WINDOW: Record<Exclude<Period, 'today'>, number> = { d3: 3, d7: 7, d30: 30 };
export interface Avg {
  period: Period; days: number; enough: boolean;
  energy: Total; treatment: { carbs: number; kcal: number }; totalKcal: number | null;
  nutrients: Record<Nutrient, Total>;
  groupDays: Partial<Record<FoodGroup, number>>; groupCoverage: number; extrasCarbShare: number | null;
}

/** Averages over complete days in the window (today: the day so far). Coverage pools the energy of all those days. */
export function average(all: Day[], period: Period, today: string, R = NUTRITION_RULES): Avg {
  const n = period === 'today' ? 0 : WINDOW[period];
  const from = new Date(Date.parse(today + 'T00:00:00Z') - n * DAY).toISOString().slice(0, 10);
  const ds = period === 'today' ? all.filter((d) => d.key === today) : all.filter((d) => d.complete && d.key >= from && d.key < today);
  const k = Math.max(1, ds.length);
  const pool = (pick: (d: Day) => Total): Total => {
    // weights: each day's food energy estimate (the coverage of a day is relative to its own food)
    const w = ds.map((d) => d.energy.est ?? 0), W = w.reduce((s, x) => s + x, 0);
    const known = ds.reduce((s, d) => s + pick(d).known, 0) / k;
    const coverage = W > 0 ? ds.reduce((s, d, i) => s + pick(d).coverage * w[i], 0) / W : 0;
    return { known, coverage, est: coverage > 0 ? known / coverage : null };
  };
  const nutrients = {} as Record<Nutrient, Total>;
  for (const nu of NUTRIENTS) nutrients[nu] = pool((d) => d.nutrients[nu]);
  const energy = pool((d) => d.energy);
  const treatment = { carbs: ds.reduce((s, d) => s + d.treatment.carbs, 0) / k, kcal: ds.reduce((s, d) => s + d.treatment.kcal, 0) / k };
  const groupDays: Avg['groupDays'] = {};
  for (const g of [...SHOWN_GROUPS, 'extras' as FoodGroup]) groupDays[g] = ds.filter((d) => d.groups[g]).length;
  const ex = ds.filter((d) => d.extrasCarbShare !== null);
  return {
    period, days: ds.length, enough: period === 'today' ? ds.length > 0 : ds.length >= R.minDays[period],
    energy, treatment, totalKcal: energy.est === null ? null : energy.est + treatment.kcal, nutrients, groupDays,
    groupCoverage: ds.length ? ds.reduce((s, d) => s + d.groupCoverage, 0) / ds.length : 0,
    extrasCarbShare: ex.length ? ex.reduce((s, d) => s + d.extrasCarbShare!, 0) / ex.length : null,
  };
}

/* ------------------------------------------------------------ references */

export type RefKind = 'min' | 'max' | 'pct_range' | 'pct_max';
export type RefSource = 'ispad_2022' | 'iom_2005' | 'iom_2011' | 'iom_2001' | 'nasem_2019' | 'dga_2020' | 'dietitian';
export interface Ref { kind: RefKind; value: number; high?: number; source: RefSource }
/** Dietitian targets saved in settings; any key replaces the general reference. */
export interface Targets { energy_kcal?: number | null; coverage_min?: number | null; refs?: Partial<Record<Nutrient, { kind: RefKind; value: number; high?: number }>> }

/**
 * General references for a girl by age (years) and weight (kg):
 *  carbs 40–50 % energy, fat 30–40 %, saturated fat < 10 %: ISPAD 2022 (Annan et al.), Box 1 — context ranges;
 *  protein ≥ 0.95 g/kg/day: IOM 2005 RDA (4–13 y); fibre ≥ age + 5 g/day: ISPAD 2022 Box 3 (children > 2 y);
 *  added sugars < 10 % energy: Dietary Guidelines for Americans 2020–2025; sodium ≤ 1,500 mg (4–8 y) / 1,800 (9–13):
 *  NASEM 2019 CDRR; potassium 2,300 mg: NASEM 2019 AI (girls 4–13); calcium 1,000 / 1,300 mg and vitamin D 15 µg:
 *  IOM 2011 RDA; iron 10 / 8 mg: IOM 2001 RDA. Ages outside 4–13 have no bundled reference.
 */
export function references(age: number, weightKg: number | null, targets: Targets = {}): Partial<Record<Nutrient, Ref>> {
  const out: Partial<Record<Nutrient, Ref>> = {};
  if (age >= 4 && age < 14) {
    const y = age < 9;
    out.carbs = { kind: 'pct_range', value: 40, high: 50, source: 'ispad_2022' };
    out.fat = { kind: 'pct_range', value: 30, high: 40, source: 'ispad_2022' };
    out.sat_fat = { kind: 'pct_max', value: 10, source: 'ispad_2022' };
    if (weightKg) out.protein = { kind: 'min', value: Math.round(0.95 * weightKg * 10) / 10, source: 'iom_2005' };
    out.fiber = { kind: 'min', value: Math.floor(age) + 5, source: 'ispad_2022' };
    out.sugar_added = { kind: 'pct_max', value: 10, source: 'dga_2020' };
    out.sodium = { kind: 'max', value: y ? 1500 : 1800, source: 'nasem_2019' };
    out.potassium = { kind: 'min', value: 2300, source: 'nasem_2019' };
    out.calcium = { kind: 'min', value: y ? 1000 : 1300, source: 'iom_2011' };
    out.vit_d = { kind: 'min', value: 15, source: 'iom_2011' };
    out.iron = { kind: 'min', value: y ? 10 : 8, source: 'iom_2001' };
  }
  for (const [k, r] of Object.entries(targets.refs ?? {})) if (r) out[k as Nutrient] = { ...r, source: 'dietitian' };
  return out;
}

/* --------------------------------------------------------------- statuses */

export type State = 'adequate' | 'low' | 'high' | 'within' | 'below_ref' | 'above_ref' | 'insufficient';
export const ATTENTION: State[] = ['low', 'high'];
const KCAL_PER_G: Partial<Record<Nutrient, number>> = { carbs: 4, protein: 4, fat: 9, sat_fat: 9, sugar_added: 4 };

/**
 * A nutrient over a period. "Adequate" as soon as the food WITH data reaches a minimum (the rest can only add);
 * "low" only when coverage is enough and the estimate stays below; a limit is "high" once the known part passes it.
 * Percent-of-energy ranges are context: within / below / above the reference, never attention by themselves.
 */
export function nutrientState(n: Nutrient, t: Total, foodKcal: number | null, ref: Ref | undefined, coverageMin = NUTRITION_RULES.coverageMin): State {
  if (!ref) return 'insufficient';
  const enough = t.coverage >= coverageMin && t.est !== null;
  if (ref.kind === 'min') return t.known >= ref.value ? 'adequate' : enough ? (t.est! < ref.value ? 'low' : 'adequate') : 'insufficient';
  if (ref.kind === 'max') return t.known > ref.value ? 'high' : enough ? 'within' : 'insufficient';
  if (!foodKcal || !KCAL_PER_G[n]) return 'insufficient';
  const pctKnown = (t.known * KCAL_PER_G[n]!) / foodKcal * 100;
  if (ref.kind === 'pct_max') return pctKnown > ref.value ? 'high' : enough ? 'within' : 'insufficient';
  if (!enough) return 'insufficient';
  const pct = (t.est! * KCAL_PER_G[n]!) / foodKcal * 100;
  return pct < ref.value ? 'below_ref' : pct > (ref.high ?? Infinity) ? 'above_ref' : 'within';
}
export const pctOfEnergy = (n: Nutrient, t: Total, foodKcal: number | null) => (foodKcal && KCAL_PER_G[n] && t.est !== null ? (t.est * KCAL_PER_G[n]!) / foodKcal * 100 : null);

/** One figure for "can we trust these numbers": the lowest coverage among energy, fat and protein (carbs are always
 *  logged). Shown as data quality; the per-nutrient coverage stays one tap deeper. */
export const dataQuality = (a: Avg) => Math.min(a.energy.coverage, a.nutrients.fat.coverage, a.nutrients.protein.coverage);

/** Carbs / protein / fat in a word: ok, low, slightly high/low (within a few points of the range) or high. Context
 *  only (ISPAD ranges are a guide); a minimum such as protein g/kg decides "low" for protein. */
export type Level = 'ok' | 'low' | 'slightly_low' | 'slightly_high' | 'high' | 'unknown';
export function macroLevel(n: 'carbs' | 'protein' | 'fat', a: Avg, refs: Partial<Record<Nutrient, Ref>>, coverageMin = NUTRITION_RULES.coverageMin, R = NUTRITION_RULES): Level {
  const t = a.nutrients[n], E = a.energy.est;
  if (!a.enough || t.coverage < coverageMin || t.est === null) return 'unknown';
  if (n === 'protein') {
    const r = refs.protein;
    if (r && r.kind === 'min' && t.est < r.value) return 'low';
  }
  const range = n === 'protein' ? { value: 15, high: 25 } : refs[n]?.kind === 'pct_range' ? { value: refs[n]!.value, high: refs[n]!.high ?? Infinity } : null;
  if (!range || !E) return 'ok';
  const pct = (t.est * (n === 'fat' ? 9 : 4)) / E * 100;
  if (n === 'protein' && pct > range.high) return 'ok'; // more protein than the share is not a concern here
  if (pct > range.high) return pct - range.high <= R.slightlyPts ? 'slightly_high' : 'high';
  if (pct < range.value) return range.value - pct <= R.slightlyPts ? 'slightly_low' : 'low';
  return 'ok';
}

export type EnergyState = 'within' | 'below' | 'above' | 'insufficient';
/** Total intake (food + treatments) against the EER range (± its standard error), or the dietitian's figure ± 10 %. */
export function energyState(a: Avg, ref: { low: number; high: number } | null, coverageMin = NUTRITION_RULES.coverageMin): EnergyState {
  if (!ref || !a.enough || a.period === 'today' || a.energy.coverage < coverageMin || a.totalKcal === null) return 'insufficient';
  return a.totalKcal < ref.low ? 'below' : a.totalKcal > ref.high ? 'above' : 'within';
}
export function energyRef(e: Eer | null, targets: Targets): { kcal: number; low: number; high: number; source: 'nasem_2023' | 'dietitian' } | null {
  if (targets.energy_kcal) return { kcal: targets.energy_kcal, low: Math.round(targets.energy_kcal * 0.9), high: Math.round(targets.energy_kcal * 1.1), source: 'dietitian' };
  return e ? { kcal: e.kcal, low: e.low, high: e.high, source: 'nasem_2023' } : null;
}

/* ------------------------------------------------------------- balance */

export type BalanceIssue = 'protein_low' | 'fiber_low' | 'calcium_low' | 'iron_low' | 'potassium_low' | 'vit_d_low' | 'few_vegetables' | 'few_fruit' | 'sat_fat_high' | 'sugar_added_high' | 'sodium_high';
/** Most important first: what growth needs, then the ADA 14.2 food pattern, then the limits. */
const ORDER: BalanceIssue[] = ['protein_low', 'fiber_low', 'few_vegetables', 'calcium_low', 'iron_low', 'few_fruit', 'potassium_low', 'vit_d_low', 'sat_fat_high', 'sugar_added_high', 'sodium_high'];
export interface Balance { state: 'balanced' | 'attention' | 'insufficient'; issues: BalanceIssue[]; states: Partial<Record<Nutrient, State>> }

/** Diet quality from FOOD only (treatments excluded): nutrient states plus the food-group pattern. */
export function balance(a: Avg, refs: Partial<Record<Nutrient, Ref>>, R = NUTRITION_RULES, coverageMin = R.coverageMin): Balance {
  const foodKcal = a.energy.est;
  const states: Balance['states'] = {};
  for (const n of NUTRIENTS) states[n] = nutrientState(n, a.nutrients[n], foodKcal, refs[n], coverageMin);
  if (!a.enough || a.period === 'today') return { state: 'insufficient', issues: [], states };
  const issues: BalanceIssue[] = [];
  for (const n of ['protein', 'fiber', 'calcium', 'iron', 'potassium', 'vit_d'] as const) if (states[n] === 'low') issues.push(`${n}_low` as BalanceIssue);
  for (const n of ['sat_fat', 'sugar_added', 'sodium'] as const) if (states[n] === 'high') issues.push(`${n}_high` as BalanceIssue);
  if (a.groupCoverage >= coverageMin) {
    if ((a.groupDays.vegetables ?? 0) < a.days * R.fewDaysShare) issues.push('few_vegetables');
    if ((a.groupDays.fruit ?? 0) < a.days * R.fewDaysShare) issues.push('few_fruit');
  }
  issues.sort((x, y) => ORDER.indexOf(x) - ORDER.indexOf(y));
  // "balanced" needs at least protein and fibre assessable; otherwise we cannot say
  const core = states.protein !== 'insufficient' && states.fiber !== 'insufficient';
  return { state: issues.length ? 'attention' : core ? 'balanced' : 'insufficient', issues, states };
}

/** ADA 14.4 context: how many meals were high in fat or protein (pattern only, never a dose change). */
export function fattyMeals(h: { eaten_at: string; total_fat: number | null; total_protein: number | null }[], fromKey: string, toKey: string) {
  const r = h.filter((x) => { const k = dayKey(Date.parse(x.eaten_at)); return k >= fromKey && k < toKey; });
  return { fatty: r.filter((x) => isFatty(x.total_fat, x.total_protein)).length, unknown: r.filter((x) => x.total_fat === null).length, meals: r.length };
}
