// Which meal something was, by the clock (Kuwait time). One rule for every report and sheet, as the family set it:
// breakfast in the morning, lunch from 1 pm to 5 pm, dinner in the evening. The time decides, not a tag: a meal
// planned as "dinner" but eaten at 4 pm is lunch. Small amounts are snacks; so is anything after midnight.
// Pure, tested in Node.

export type MealPeriod = 'breakfast' | 'snack' | 'lunch' | 'dinner';
/** Where each period starts, in minutes after midnight. Before `breakfast` (after midnight) is night: snacks only. */
export interface PeriodBounds { breakfast: number; snack: number; lunch: number; dinner: number }
export const PERIOD_BOUNDS: PeriodBounds = { breakfast: 4 * 60, snack: 11 * 60, lunch: 13 * 60, dinner: 17 * 60 };
/** Under this many grams of carbs it is a snack, whatever the time. */
export const SNACK_G = 15;

/** The period for something eaten at `minute` (after midnight, Kuwait) with `carbs` (null: not known). A stored
 *  'snack' stays a snack; a stored breakfast/lunch/dinner does not override the clock. */
export function periodOf(minute: number, carbs: number | null, stored?: string | null, b: PeriodBounds = PERIOD_BOUNDS): MealPeriod {
  if (stored === 'snack') return 'snack';
  if (carbs !== null && carbs < SNACK_G) return 'snack';
  if (minute < b.breakfast) return 'snack';
  if (minute < b.snack) return 'breakfast';
  if (minute < b.lunch) return 'snack';
  if (minute < b.dinner) return 'lunch';
  return 'dinner';
}

/** A meal saved under a plain meal word ("عشا", "Lunch"…): shown by its real period instead. */
export const isGenericMealName = (name: string | null | undefined) =>
  !!name && /^(فطور|فطور الصباح|ريوق|غدا|غداء|عشا|عشاء|سناك|breakfast|lunch|dinner|supper|snack)$/i.test(name.trim()); // i18n-ok: data, the words people type
