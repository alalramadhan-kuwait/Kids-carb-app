// Growth & nutrition for the screens: measurements from the database, then everything else computed from the app's
// data with the pure engines (WHO 2007 growth, NASEM 2023 energy, the nutrition rules). Display only: nothing here
// changes a dose, an alert or a target, and nothing suggests eating less.
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from './supabase';
import { useData } from './data';
import { ageYears, growthStatus, points, type GrowthStatus, type Measurement, type Point, type Sex } from '../engine/growth';
import { eer, type Activity, type Eer } from '../engine/energy';
import {
  CATEGORY_GROUP, average, balance, carbsOnly, dayKey, days, energyRef, energyState, fattyMeals, foodEntry, references,
  NUTRITION_RULES, type Avg, type Balance, type Day, type EnergyState, type FoodGroup, type Period, type Ref, type Nutrient, type Targets,
} from '../engine/nutrition';
import type { Product } from './types';

export interface MeasurementRow { id: string; measured_on: string; weight_kg: number | null; height_cm: number | null; place: 'home' | 'clinic' | null; note: string | null }

let cache: MeasurementRow[] | null = null;
const subs = new Set<(l: MeasurementRow[]) => void>();
async function load() {
  const { data } = await supabase.from('growth_measurements').select('id,measured_on,weight_kg,height_cm,place,note').order('measured_on');
  cache = ((data ?? []) as MeasurementRow[]).map((m) => ({ ...m, weight_kg: m.weight_kg === null ? null : Number(m.weight_kg), height_cm: m.height_cm === null ? null : Number(m.height_cm) }));
  subs.forEach((f) => f(cache!));
}
/** Weight and height history, shared by every screen that shows it. */
export function useMeasurements() {
  const [list, setList] = useState<MeasurementRow[] | null>(cache);
  useEffect(() => { subs.add(setList); if (!cache) void load(); return () => { subs.delete(setList); }; }, []);
  return { list, reload: load };
}
export async function saveMeasurement(m: Omit<MeasurementRow, 'id'> & { id?: string }) {
  const row = { measured_on: m.measured_on, weight_kg: m.weight_kg, height_cm: m.height_cm, place: m.place, note: m.note?.trim() || null, updated_at: new Date().toISOString() };
  const { error } = m.id ? await supabase.from('growth_measurements').update(row).eq('id', m.id) : await supabase.from('growth_measurements').insert(row);
  if (error) throw new Error(error.message);
  await load();
}
export async function deleteMeasurement(id: string) {
  const { error } = await supabase.from('growth_measurements').delete().eq('id', id);
  if (error) throw new Error(error.message);
  await load();
}

/** A line of a logged meal → its food group, through its product (or the category it was chosen from). */
export function groupResolver(products: Product[]) {
  const byLabel = new Map<string, Product>(), byName = new Map<string, Product>();
  for (const p of products) { byLabel.set([p.name, p.brand].filter(Boolean).join(' — '), p); if (!byName.has(p.name)) byName.set(p.name, p); }
  return (l: { name: string; product: string | null }): FoodGroup | null => {
    const p = (l.product && byLabel.get(l.product)) || byName.get(l.name);
    if (p) return (p.food_group as FoodGroup | null) ?? CATEGORY_GROUP[p.category] ?? null;
    return CATEGORY_GROUP[l.name] ?? null;
  };
}

export type CardTone = 'ok' | 'attention' | 'neutral' | 'pending';
export interface GrowthNutrition {
  ready: boolean;
  profile: { birth: string | null; approx: boolean; sex: Sex; activity: Activity; activityAssumed: boolean; age: number | null };
  measurements: MeasurementRow[]; points: Point[]; growth: GrowthStatus;
  eer: Eer | null; energyRef: ReturnType<typeof energyRef>; refs: Partial<Record<Nutrient, Ref>>; targets: Targets; coverageMin: number;
  days: Day[]; avg: Record<Period, Avg>; bal: Record<Period, Balance>; energy: Record<Period, EnergyState>;
  fatty: ReturnType<typeof fattyMeals>;
  card: { growth: CardTone; energy: CardTone; balance: CardTone };
}

export function useGrowthNutrition(): GrowthNutrition {
  const { settings: s, history, events, products, loading } = useData();
  const { list } = useMeasurements();
  return useMemo(() => {
    const measurements = list ?? [];
    const sex: Sex = s.child_sex ?? 'female';
    const birth = s.child_birth_date ?? null;
    const now = Date.now(), today = dayKey(now);
    const age = birth ? ageYears(birth, new Date(now).toISOString().slice(0, 10)) : null;
    const activity: Activity = s.activity_level ?? 'active';
    const pts = birth ? points(measurements.map((m): Measurement => ({ on: m.measured_on, weight_kg: m.weight_kg, height_cm: m.height_cm })), birth, sex) : [];
    const growth = growthStatus(pts);
    const lastW = [...measurements].reverse().find((m) => m.weight_kg !== null)?.weight_kg ?? null;
    const lastH = [...measurements].reverse().find((m) => m.height_cm !== null)?.height_cm ?? null;
    const e = age !== null && lastW && lastH ? eer({ age, sex, height_cm: lastH, weight_kg: lastW, activity }) : null;
    const targets: Targets = s.nutrition_targets ?? {};
    const coverageMin = targets.coverage_min ?? NUTRITION_RULES.coverageMin;
    const eref = energyRef(e, targets);
    const refs = age !== null ? references(age, lastW, targets) : {};
    // food: logged meals and snacks (not the ones set aside as possible duplicates) and carbs logged on their own;
    // low treatments are kept apart
    const groupOf = groupResolver(products);
    const food = [
      ...history.filter((h) => !h.needs_review).map((h) => foodEntry(h, groupOf)),
      ...events.filter((x) => x.kind === 'carbs' && x.carbs_g).map((x) => carbsOnly(Date.parse(x.occurred_at), x.carbs_g!)),
    ];
    const treatments = events.filter((x) => x.kind === 'treatment' && x.carbs_g).map((x) => ({ at: Date.parse(x.occurred_at), carbs: x.carbs_g! }));
    const ds = days(food, treatments, today);
    const periods: Period[] = ['today', 'd7', 'd30'];
    const avg = Object.fromEntries(periods.map((p) => [p, average(ds, p, today)])) as Record<Period, Avg>;
    const bal = Object.fromEntries(periods.map((p) => [p, balance(avg[p], refs, NUTRITION_RULES, coverageMin)])) as Record<Period, Balance>;
    const energy = Object.fromEntries(periods.map((p) => [p, energyState(avg[p], eref, coverageMin)])) as Record<Period, EnergyState>;
    const from7 = new Date(Date.parse(today + 'T00:00:00Z') - 7 * 86400000).toISOString().slice(0, 10);
    const card = {
      growth: (growth.state === 'attention' ? 'attention' : growth.state === 'stable' ? 'ok' : 'pending') as CardTone,
      energy: (energy.d7 === 'within' ? 'ok' : energy.d7 === 'below' ? 'attention' : energy.d7 === 'above' ? 'neutral' : 'pending') as CardTone,
      balance: (bal.d7.state === 'balanced' ? 'ok' : bal.d7.state === 'attention' ? 'attention' : 'pending') as CardTone,
    };
    return {
      ready: !loading && list !== null,
      profile: { birth, approx: s.child_birth_approx ?? true, sex, activity, activityAssumed: !s.activity_level, age },
      measurements, points: pts, growth, eer: e, energyRef: eref, refs, targets, coverageMin,
      days: ds, avg, bal, energy, fatty: fattyMeals(history.filter((h) => !h.needs_review), from7, today), card,
    };
  }, [s, history, events, products, loading, list]);
}

/** Every 30 days without a weight, a quiet reminder on the card. */
export const weighInDue = (m: MeasurementRow[], now = Date.now()) => {
  const w = [...m].reverse().find((x) => x.weight_kg !== null);
  return !w || now - Date.parse(w.measured_on) > 30 * 86400000;
};
