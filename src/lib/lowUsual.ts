// What Layan usually takes for a low, from what was logged: low treatments, and food or drink logged while she was
// low (the family often logs the juice box from the products list). Offered first when logging a low treatment.
const LOW_MG = 80;

export interface UsualLow { name: string; carbs: number; n: number }

export function usualLowTreatments(
  history: { name: string; total_carbs: number | null; glucose_mgdl: number | null }[],
  events: { kind: string; treatment: string | null; carbs_g: number | null; deleted_at?: string | null }[],
  max = 4,
): UsualLow[] {
  const count = new Map<string, UsualLow>();
  const add = (name: string, carbs: number) => {
    if (!name.trim() || !(carbs >= 5 && carbs <= 30)) return;   // a treatment-sized amount, not a meal
    const key = name.trim() + '|' + carbs;
    const c = count.get(key) ?? { name: name.trim(), carbs, n: 0 };
    c.n++; count.set(key, c);
  };
  for (const h of history) if (h.total_carbs !== null && h.glucose_mgdl !== null && h.glucose_mgdl < LOW_MG) add(h.name, h.total_carbs);
  for (const e of events) if (e.kind === 'treatment' && !e.deleted_at && e.treatment && e.carbs_g !== null) add(e.treatment, e.carbs_g);
  return [...count.values()].sort((a, b) => b.n - a.n || a.name.localeCompare(b.name)).slice(0, max);
}
