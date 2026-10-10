// Saving a meal eaten out whose carbs nobody knows. Its carbs are marked unknown (stored as 0 with carbs_unknown, read
// back as null), never guessed. The parent's own guess, if typed, is kept apart and never used in any calculation.
import { supabase } from './supabase';
import { glucoseAt, glucoseCols } from './productLog';
import { savedMeal } from './api';
import type { AtePart, MealSlot, PlateSize } from './types';

export interface OutMeal {
  foods: string[]; place: string | null; plate: PlateSize | null; ate: AtePart | null; at: number;
  guess: number | null; photo: string | null; slot: MealSlot | null; note: string | null;
}

export const outMealName = (foods: string[]) => foods.join(' + ');

/** Saved once per `clientId` (a retry after a weak connection gives back the same meal). Returns its id. */
export async function saveOutMeal(m: OutMeal, clientId: string): Promise<string> {
  if (!m.foods.length) throw new Error('no_food');
  const { data, error } = await supabase.from('meal_history').insert({
    client_id: clientId, kind: m.slot === 'snack' ? 'snack' : 'meal', meal_slot: m.slot, recipe_id: null, name: outMealName(m.foods), category: null,
    eaten_at: new Date(m.at).toISOString(), total_carbs: 0, carbs_unknown: true, foods: m.foods, place: m.place?.trim() || null,
    plate_size: m.plate, ate: m.ate, carbs_guess: m.guess, photo_path: m.photo,
    total_fat: null, total_fiber: null, total_protein: null, total_kcal: null, modified: false, lines: [], notes: m.note?.trim() || null,
    ...glucoseCols(await glucoseAt(m.at)),
  }).select('id').single();
  if (error?.code === '23505') return (await savedMeal(clientId)).id;
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}
