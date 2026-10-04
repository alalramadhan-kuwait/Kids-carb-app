// Estimated Energy Requirement (EER) from the National Academies of Sciences, Engineering, and Medicine (2023),
// Dietary Reference Intakes for Energy, Chapter 5, Table 5-5 (TEE equations, girls 3.0–18.99 y) plus the energy
// deposited in growth (Table 5-12). A reference for comparison, never a prescription or a limit.
import type { Sex } from './growth';

export type Activity = 'inactive' | 'low_active' | 'active' | 'very_active';
export const ACTIVITIES: Activity[] = ['inactive', 'low_active', 'active', 'very_active'];

/** TEE = a + b·age(y) + c·height(cm) + d·weight(kg), girls 3–18.99 y (NASEM 2023, Table 5-5). */
const GIRLS: Record<Activity, [number, number, number, number]> = {
  inactive: [55.59, -22.25, 8.43, 17.07],
  low_active: [-297.54, -22.25, 12.77, 14.73],
  active: [-189.55, -22.25, 11.74, 18.34],
  very_active: [-709.59, -22.25, 18.22, 14.25],
};
/** Energy deposition for growth, girls (NASEM 2023): kcal/day by age band. */
export const growthKcal = (age: number) => (age < 4 ? 15 : age < 9 ? 15 : age < 14 ? 30 : 20);
/** The published standard error of the girls' equation (Active, at the sample mean: 9.6 y, 135 cm, 37.6 kg): 221 kcal/d. */
export const EER_SE = 221;

export interface Eer { kcal: number; low: number; high: number; activity: Activity; byActivity: Record<Activity, number> }

/** EER for a girl aged 3–18.99 y; null outside the equations' range or for boys (not bundled). */
export function eer(p: { age: number; sex: Sex; height_cm: number; weight_kg: number; activity: Activity }): Eer | null {
  if (p.sex !== 'female' || p.age < 3 || p.age >= 19 || !(p.height_cm > 0) || !(p.weight_kg > 0)) return null;
  const one = (a: Activity) => { const [k, b, c, d] = GIRLS[a]; return k + b * p.age + c * p.height_cm + d * p.weight_kg + growthKcal(p.age); };
  const byActivity = Object.fromEntries(ACTIVITIES.map((a) => [a, Math.round(one(a))])) as Record<Activity, number>;
  const kcal = byActivity[p.activity];
  return { kcal, low: kcal - EER_SE, high: kcal + EER_SE, activity: p.activity, byActivity };
}
