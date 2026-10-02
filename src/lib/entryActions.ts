// Quick actions on a logged entry (log again, set time, note, copy). Pure parts here; saving in entrySave.ts.
export type MealSlot = 'breakfast' | 'lunch' | 'dinner' | 'late';
/** Which meal a time of day is, on the phone's clock: 5–11 breakfast, 11–16 lunch, 16–22 dinner, otherwise late. */
export function mealSlot(ms: number): MealSlot {
  const h = new Date(ms).getHours();
  return h >= 5 && h < 11 ? 'breakfast' : h >= 11 && h < 16 ? 'lunch' : h >= 16 && h < 22 ? 'dinner' : 'late';
}
/** Logging the same thing again: never a dose (that is the dose calculator's job), a finger-prick or a sleep. */
export const canLogAgain = (kind: string) => kind === 'meal' || kind === 'carbs' || kind === 'treatment' || kind === 'note' || kind === 'exercise';
/** Earlier entries of the same food (same recipe, or same name), newest first, not this one. */
export function similar<T extends { id: string; name: string; recipe_id: string | null; eaten_at: string }>(h: T, all: T[], n = 5): T[] {
  const name = h.name.trim().toLowerCase();
  return all.filter((x) => x.id !== h.id && ((h.recipe_id && x.recipe_id === h.recipe_id) || x.name.trim().toLowerCase() === name))
    .sort((a, b) => Date.parse(b.eaten_at) - Date.parse(a.eaten_at)).slice(0, n);
}
