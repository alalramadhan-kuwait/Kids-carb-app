// Editing a logged entry: the phone's date-time picker, and the checks a change must pass.

const p2 = (n: number) => String(n).padStart(2, '0');
/** ms → "YYYY-MM-DDTHH:mm" in the phone's time, the same clock the log list shows (what <input type="datetime-local"> uses). */
export function toLocalInput(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())}T${p2(d.getHours())}:${p2(d.getMinutes())}`;
}
/** "YYYY-MM-DDTHH:mm" in the phone's time → ms, or null when it is not a valid time. */
export function fromLocalInput(v: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(v);
  if (!m) return null;
  const d = new Date(+m[1], +m[2] - 1, +m[3], +m[4], +m[5]);
  return Number.isNaN(d.getTime()) || d.getDate() !== +m[3] ? null : d.getTime();
}

export interface EditDraft {
  t: number | null; units?: number | null; carbs?: number | null; bg?: number | null; minutes?: number | null; name?: string; note?: string;
  fat?: number | null; protein?: number | null; fiber?: number | null; kcal?: number | null; brand?: string; toQuick?: boolean;
  label?: { per100: import('./per100').Nutr; amount: number | null; unit: 'ml' | 'g' } | null;
  /** the part of the portion she ate (½, ¾…), when chosen: the meal's items are scaled with it */
  part?: number;
}

/** The items of a meal when she ate only part of it (or more): each amount and its carbs scale by the same factor. */
export function scaleLines<L extends { quantity?: number | null; carbs?: number | null }>(lines: L[], f: number): L[] {
  const r = (x: number) => Math.round(x * 100) / 100;
  return lines.map((l) => ({ ...l, quantity: l.quantity == null ? l.quantity : r(l.quantity * f), carbs: l.carbs == null ? l.carbs : Math.round(l.carbs * f * 10) / 10 }));
}
export type EditProblem = 'time' | 'future' | 'units' | 'carbs' | 'bg' | 'minutes' | 'name' | 'nutrition';
/** What is wrong with the draft, if anything (a typo must not reach the log or the dose calculator). */
/** `carbsUnknown`: a meal eaten out whose carbs are not known may be saved (its time, name…) without carbs. */
export function editProblem(kind: string, d: EditDraft, now: number, carbsUnknown = false): EditProblem | null {
  if (d.t === null) return 'time';
  if (d.t > now + 5 * 60000) return 'future';
  if (kind === 'insulin' && !(d.units != null && d.units > 0 && d.units <= 100)) return 'units';
  if ((kind === 'carbs' || kind === 'treatment' || kind === 'meal') && !(carbsUnknown && d.carbs == null) && !(d.carbs != null && d.carbs >= 0 && d.carbs <= 300)) return 'carbs';
  if (kind === 'bg_check' && !(d.bg != null && d.bg >= 20 && d.bg <= 600)) return 'bg';
  if (kind === 'exercise' && d.minutes != null && !(d.minutes > 0 && d.minutes <= 600)) return 'minutes';
  if (kind === 'meal' && !d.name?.trim()) return 'name';
  // fat, protein and fiber in grams, energy in kcal: optional, but never negative or absurd
  if ([d.fat, d.protein, d.fiber].some((g) => g != null && (g < 0 || g > 300)) || (d.kcal != null && (d.kcal < 0 || d.kcal > 3000))) return 'nutrition';
  return null;
}
