// Pure parts of the food photo estimate, so the app's tests can run them: the prompt, the JSON schema the model
// must answer in, and the clean-up of its answer. Estimates only: the parents check and edit before anything is saved.

export const MODEL = 'claude-opus-5-5';
export const DAILY_LIMIT = 40; // photos per day for the family, to keep the cost bounded

export const SYSTEM = `You estimate the nutrition of the food in a photo for the parents of a 6-year-old girl with type 1 diabetes in Kuwait. They count carbohydrates; your answer is a starting point that they check and edit before saving.

List each distinct food or drink you can see with the amount on the plate or in the glass (grams; for drinks, millilitres counted as grams) and the nutrients for that amount. Think of typical Kuwaiti, Gulf and international recipes and portion sizes.

Be honest about what a photo cannot show. Use low confidence when the portion or the ingredients cannot be judged (sugar dissolved in tea or juice, sauces, fillings, frying oil), set hidden_sugar when sugar may be added but not visible, and say in the notes what the parents should check, in one or two short sentences in Arabic and in English. A note from the parents is more reliable than the photo.

Never mention insulin, doses or treatment. If there is no food or drink in the photo, set is_food to false and leave items empty.`;

export const SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_food', 'items', 'notes_ar', 'notes_en'],
  properties: {
    is_food: { type: 'boolean' },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        required: ['name_ar', 'name_en', 'grams', 'carbs_g', 'protein_g', 'fat_g', 'kcal', 'confidence', 'hidden_sugar'],
        properties: {
          name_ar: { type: 'string' }, name_en: { type: 'string' },
          grams: { type: 'number' }, carbs_g: { type: 'number' }, protein_g: { type: 'number' }, fat_g: { type: 'number' }, kcal: { type: 'number' },
          confidence: { type: 'string', enum: ['low', 'medium', 'high'] },
          hidden_sugar: { type: 'boolean' },
        },
      },
    },
    notes_ar: { type: 'string' }, notes_en: { type: 'string' },
  },
} as const;

export interface EstItem {
  name_ar: string; name_en: string; grams: number; carbs_g: number; protein_g: number; fat_g: number; kcal: number;
  confidence: 'low' | 'medium' | 'high'; hidden_sugar: boolean;
}
export interface Estimate { is_food: boolean; items: EstItem[]; notes_ar: string; notes_en: string; total: { carbs_g: number; protein_g: number; fat_g: number; kcal: number } }

const num = (x: unknown, max: number) => { const n = Number(x); return Number.isFinite(n) ? Math.min(max, Math.max(0, Math.round(n * 10) / 10)) : 0; };
const str = (x: unknown, max = 120) => (typeof x === 'string' ? x.trim().slice(0, max) : '');

/** Make the model's answer safe to show: bounded numbers, carbs never above the weight, totals computed here. */
export function cleanEstimate(raw: unknown): Estimate {
  const r = (raw ?? {}) as Record<string, unknown>;
  const items = (Array.isArray(r.items) ? r.items : []).slice(0, 12).map((x) => {
    const i = (x ?? {}) as Record<string, unknown>;
    const grams = num(i.grams, 2000);
    return {
      name_ar: str(i.name_ar) || str(i.name_en), name_en: str(i.name_en) || str(i.name_ar),
      grams, carbs_g: Math.min(num(i.carbs_g, 500), grams || 500), protein_g: num(i.protein_g, 300), fat_g: num(i.fat_g, 300), kcal: num(i.kcal, 5000),
      confidence: (['low', 'medium', 'high'] as const).includes(i.confidence as never) ? (i.confidence as EstItem['confidence']) : 'low',
      hidden_sugar: i.hidden_sugar === true,
    };
  }).filter((i) => i.name_ar || i.name_en);
  const sum = (k: 'carbs_g' | 'protein_g' | 'fat_g' | 'kcal') => Math.round(items.reduce((s, i) => s + i[k], 0) * 10) / 10;
  return {
    is_food: r.is_food === true && items.length > 0, items,
    notes_ar: str(r.notes_ar, 400), notes_en: str(r.notes_en, 400),
    total: { carbs_g: sum('carbs_g'), protein_g: sum('protein_g'), fat_g: sum('fat_g'), kcal: Math.round(sum('kcal')) },
  };
}

/** Never show advice the app does not give, whatever the model wrote. */
export const mentionsDosing = (s: string) => /insulin|bolus|dose|units? of|إنسولين|انسولين|جرعة|وحدات|وحدة/i.test(s);
