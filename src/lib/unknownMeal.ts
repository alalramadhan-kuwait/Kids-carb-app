// Ate out and nobody knows the grams: the meal is kept with its carbs marked unknown (never 0, never guessed). These
// helpers keep that one rule in one place: show «unknown», count nothing, and warn wherever a dose is worked out.
import { t, tMaybe } from '../i18n';
import { fmt } from './carbs';
import type { HistoryEntry } from './types';

const HOUR = 3600000;

/** "45 غ كارب", or "الكارب غير معروف" for a meal whose carbs are not known. */
export const carbsOrUnknown = (c: number | null) => (c === null ? t('الكارب غير معروف') : t('{g} غ كارب', { g: fmt(c) }));

/** The newest meal with unknown carbs eaten in the last 4 hours (or about to be): a dose worked out now cannot count it. */
export function recentUnknownMeal(history: Pick<HistoryEntry, 'total_carbs' | 'eaten_at' | 'name' | 'foods'>[], now: number, hours = 4) {
  return history.find((h) => h.total_carbs === null && Date.parse(h.eaten_at) <= now + 15 * 60000 && now - Date.parse(h.eaten_at) < hours * HOUR) ?? null;
}

/** A meal's name in the page's language: a meal eaten out is named after its kinds of food, each one translated. */
export const mealTitle = (h: Pick<HistoryEntry, 'name' | 'foods'>) => (h.foods?.length ? h.foods.map((f) => tMaybe(f)).join(' + ') : tMaybe(h.name));

/** Meals still waiting for their carbs (newest first): for the parent who fills them in later. */
export const waitingForCarbs = (history: HistoryEntry[]) => history.filter((h) => h.total_carbs === null);
