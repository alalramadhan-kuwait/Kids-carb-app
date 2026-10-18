// Food photo and barcode scanning. Photos go to the carb-food edge function for an estimate; barcodes are read in
// the browser and looked up in Open Food Facts (no AI). Either way the parents check and edit before anything is
// saved, and the saved entry says it was estimated.
import { supabase } from './supabase';
import type { HistoryLine } from './types';
import type { Label } from '../../supabase/functions/carb-food/estimate';
import { offToPackaged, totals, type EstItem, type Packaged } from './foodcalc';

export * from './foodcalc';

// ── barcodes ──
export async function lookupBarcode(code: string, lang: 'ar' | 'en'): Promise<Packaged | null> {
  const r = await fetch(`https://world.openfoodfacts.org/api/v2/product/${encodeURIComponent(code)}?fields=product_name,product_name_ar,product_name_en,brands,nutriments,serving_quantity`);
  if (!r.ok) return null;
  return offToPackaged(code, await r.json(), lang);
}

/** EAN/UPC from a photo: the browser's own detector where it exists, otherwise a small WebAssembly one. */
export async function findBarcode(blob: Blob): Promise<string | null> {
  try {
    const formats = ['ean_13', 'ean_8', 'upc_a', 'upc_e'] as ('ean_13' | 'ean_8' | 'upc_a' | 'upc_e')[];
    const Native = (globalThis as { BarcodeDetector?: new (o: { formats: string[] }) => { detect(i: ImageBitmapSource): Promise<{ rawValue: string }[]> } }).BarcodeDetector;
    const Detector = Native ?? (await import('barcode-detector/ponyfill')).BarcodeDetector;
    const found = await new Detector({ formats }).detect(await createImageBitmap(blob));
    return found[0]?.rawValue ?? null;
  } catch { return null; }
}

// ── photos ──
/** A phone photo scaled to at most 1280 px on its long side, as JPEG base64 (small enough to send quickly). */
export async function shrinkPhoto(file: Blob, max = 1280): Promise<{ data: string; media_type: 'image/jpeg'; url: string }> {
  const bmp = await createImageBitmap(file);
  const k = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement('canvas');
  c.width = Math.round(bmp.width * k); c.height = Math.round(bmp.height * k);
  c.getContext('2d')!.drawImage(bmp, 0, 0, c.width, c.height);
  const url = c.toDataURL('image/jpeg', 0.82);
  return { data: url.slice(url.indexOf(',') + 1), media_type: 'image/jpeg', url };
}

// ── AI estimate (carb-food, Claude) ──
async function callFood<T>(body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke('carb-food', { body });
  const code = (data as { error?: string } | null)?.error
    ?? (error && 'context' in error ? ((await (error as { context: Response }).context.json().catch(() => ({}))) as { error?: string }).error : undefined);
  if (code || error) throw new Error(code ?? 'server');
  return data as T;
}
/** Whether a key is saved (the photo estimate is offered only then), and today's count against the daily limit. */
export const aiStatus = () => callFood<{ configured: boolean; used: number; limit: number }>({ action: 'status' });
/** A nutrition label photographed instead of a plate: its per 100 carbs (and printed serving and pack), never a portion. */
export interface EstLabel { name_ar: string; name_en: string; unit: 'g' | 'ml'; carbs_per100: number; serving: number | null; pack: number | null }
/** The foods in a photo with estimated grams and nutrients, or a label's per 100 numbers. Display only: the parents check and edit before saving. */
export const estimatePhoto = (photo: { data: string; media_type: string }, note = '') =>
  callFood<{ scan_id: string | null; estimate: { is_food: boolean; label?: EstLabel | null; items: EstItem[]; notes_ar: string; notes_en: string } }>({ action: 'photo', image: photo.data, media_type: photo.media_type, note });

// ── saving ──
/**
 * The photo kept for reference (AI estimate on hold): the parents' own carb count is logged as one entry and the
 * photo is stored with it, so the carbs can be estimated again later. Returns the new id.
 */
export async function logPhotoEntry(input: { name: string; kind: 'meal' | 'snack'; carbs: number; photo_path: string; notes: string | null }) {
  const { data: g } = await supabase.from('glucose_readings').select('taken_at,mg_dl,trend').order('taken_at', { ascending: false }).limit(1).maybeSingle();
  const fresh = g && Date.now() - new Date(g.taken_at).getTime() <= 15 * 60000;
  const line: HistoryLine = { name: input.name, product: null, quantity: 1, unit: 'serving', state: 'as_is', role: 'main', carbs: input.carbs };
  const { data, error } = await supabase.from('meal_history').insert({
    glucose_mgdl: fresh ? g.mg_dl : null, glucose_trend: fresh ? g.trend : null, glucose_at: fresh ? g.taken_at : null,
    kind: input.kind, recipe_id: null, name: input.name, category: null,
    total_carbs: input.carbs, total_fat: null, total_fiber: null, total_protein: null, total_kcal: null,
    modified: false, lines: [line], notes: input.notes, photo_path: input.photo_path,
  }).select('id').single();
  if (error) throw new Error(error.message);
  return (data as { id: string }).id;
}

/** Logs the checked items as one entry in the meal history, marked as an estimate. Returns the new id. */
export async function logEstimated(input: { name: string; kind: 'meal' | 'snack'; items: EstItem[]; lang: 'ar' | 'en'; notes: string; scanId?: string | null }) {
  const lines: HistoryLine[] = input.items.map((i) => ({
    name: input.lang === 'en' ? i.name_en : i.name_ar, product: null, quantity: i.grams, unit: 'g', state: 'as_is', role: 'main',
    carbs: Math.round(i.carbs_g * 10) / 10,
  }));
  const tot = totals(input.items);
  const { data: g } = await supabase.from('glucose_readings').select('taken_at,mg_dl,trend').order('taken_at', { ascending: false }).limit(1).maybeSingle();
  const fresh = g && Date.now() - new Date(g.taken_at).getTime() <= 15 * 60000;
  const { data, error } = await supabase.from('meal_history').insert({
    glucose_mgdl: fresh ? g.mg_dl : null, glucose_trend: fresh ? g.trend : null, glucose_at: fresh ? g.taken_at : null,
    kind: input.kind, recipe_id: null, name: input.name, category: null,
    total_carbs: tot.carbs, total_fat: tot.fat, total_fiber: null, total_protein: tot.protein, total_kcal: tot.kcal,
    modified: true, lines, notes: input.notes,
  }).select('id').single();
  if (error) throw new Error(error.message);
  if (input.scanId) await supabase.from('food_scans').update({ history_id: (data as { id: string }).id }).eq('id', input.scanId);
  return (data as { id: string }).id;
}


export type { Label };
