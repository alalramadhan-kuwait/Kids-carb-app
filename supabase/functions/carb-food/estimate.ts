// Pure parts of the food photo estimate, so the app's tests can run them: the prompt, the JSON schema the model
// must answer in, and the clean-up of its answer. Estimates only: the parents check and edit before anything is saved.

export const MODEL = 'claude-haiku-5-5'; // the cheapest; the parents check and edit every estimate before it is saved
export const DAILY_LIMIT = 40; // photos per day for the family, to keep the cost bounded

export const SYSTEM = `You estimate the nutrition of the food in a photo for the parents of a 6-year-old girl with type 1 diabetes in Kuwait. They count carbohydrates; your answer is a starting point that they check and edit before saving.

List each distinct food or drink you can see with the amount on the plate or in the glass (grams; for drinks, millilitres counted as grams) and the nutrients for that amount. Think of typical Kuwaiti, Gulf and international recipes and portion sizes.

Be honest about what a photo cannot show. Use low confidence when the portion or the ingredients cannot be judged (sugar dissolved in tea or juice, sauces, fillings, frying oil), set hidden_sugar when sugar may be added but not visible, and say in the notes what the parents should check, in one or two short sentences in Arabic and in English. A note from the parents is more reliable than the photo.

Keep it short: each name at most three words (in Arabic as people in Kuwait say it, e.g. «بسكويت شوكولاتة»), and each note at most twelve words about the one thing most worth checking, or empty. When the parents say where the food is from (a restaurant or a brand), use that place's usual portions and recipes.

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

// ── nutrition labels ──
export const LABEL_DAILY_LIMIT = 30;

export const LABEL_SYSTEM = `You read the nutrition label of a packaged food from one or two photos (the front of the pack and the nutrition table) for the parents of a 6-year-old girl with type 1 diabetes. Your answer fills a form that the parents check and edit before saving.

Copy the numbers exactly as printed per 100 g (or per 100 ml for drinks). If only per-serving values are printed, convert them to per 100 using the printed serving size. Give the serving size and the pack size in grams or millilitres when printed, else null. Never guess a number you cannot read: use null and add the field name to uncertain.

label_style: "eu_fibre_excluded" when the label lists carbohydrate and fibre as separate lines in the European way (carbohydrate already excludes fibre), "fibre_included" when total carbohydrate includes dietary fibre (US/Gulf style with "Total Carbohydrate"), else "unknown". Report carbohydrate as printed either way.

category: one short Arabic product group such as خبز, حليب, عصير, سناكات, حلويات, لحوم, أخرى. Never mention insulin, doses or treatment. If no nutrition table is visible, set is_label to false.`;

const nul = (t: string) => ({ type: ['number', 'null'] as const, description: t });
export const LABEL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  required: ['is_label', 'name', 'brand', 'barcode', 'category', 'unit', 'serving', 'pack', 'per100', 'label_style', 'uncertain'],
  properties: {
    is_label: { type: 'boolean' },
    name: { type: 'string' }, brand: { type: 'string' }, barcode: { type: 'string' }, category: { type: 'string' },
    unit: { type: 'string', enum: ['g', 'ml'] },
    serving: nul('serving size'), pack: nul('pack size'),
    per100: {
      type: 'object', additionalProperties: false,
      required: ['carbs', 'sugar', 'fiber', 'fat', 'protein', 'kcal'],
      properties: { carbs: nul('g'), sugar: nul('g'), fiber: nul('g'), fat: nul('g'), protein: nul('g'), kcal: nul('kcal') },
    },
    label_style: { type: 'string', enum: ['eu_fibre_excluded', 'fibre_included', 'unknown'] },
    uncertain: { type: 'array', items: { type: 'string' } },
  },
} as const;

export interface LabelPer100 { carbs: number | null; sugar: number | null; fiber: number | null; fat: number | null; protein: number | null; kcal: number | null }
export interface Label {
  is_label: boolean; name: string; brand: string; barcode: string; category: string; unit: 'g' | 'ml';
  serving: number | null; pack: number | null; per100: LabelPer100;
  label_style: 'eu_fibre_excluded' | 'fibre_included' | 'unknown'; uncertain: string[];
}

const opt = (x: unknown, max: number) => { if (x === null || x === undefined || x === '') return null; const n = Number(x); return Number.isFinite(n) && n >= 0 && n <= max ? Math.round(n * 10) / 10 : null; };
const FIELDS = ['name', 'brand', 'barcode', 'serving', 'pack', 'carbs', 'sugar', 'fiber', 'fat', 'protein', 'kcal'];

/** Make a label reading safe to prefill: impossible numbers become blanks (and are flagged), nothing is invented. */
export function cleanLabel(raw: unknown): Label {
  const r = (raw ?? {}) as Record<string, unknown>;
  const p = (r.per100 ?? {}) as Record<string, unknown>;
  const per100: LabelPer100 = { carbs: opt(p.carbs, 100), sugar: opt(p.sugar, 100), fiber: opt(p.fiber, 100), fat: opt(p.fat, 100), protein: opt(p.protein, 100), kcal: opt(p.kcal, 900) };
  const uncertain = new Set((Array.isArray(r.uncertain) ? r.uncertain : []).filter((x): x is string => typeof x === 'string' && FIELDS.includes(x)));
  for (const k of ['carbs', 'sugar', 'fiber', 'fat', 'protein', 'kcal'] as const) if (p[k] !== null && p[k] !== undefined && per100[k] === null) uncertain.add(k);
  if (per100.carbs === null) uncertain.add('carbs');
  if (per100.sugar !== null && per100.carbs !== null && per100.sugar > per100.carbs) uncertain.add('sugar');
  const barcode = str(r.barcode, 60).replace(/\D/g, '').slice(0, 14);
  return {
    is_label: r.is_label === true && per100.carbs !== null,
    name: str(r.name), brand: str(r.brand, 60), barcode: barcode.length >= 8 ? barcode : '', category: str(r.category, 40),
    unit: r.unit === 'g' ? 'g' : r.unit === 'ml' ? 'ml' : 'g',
    serving: opt(r.serving, 5000), pack: opt(r.pack, 10000), per100,
    label_style: (['eu_fibre_excluded', 'fibre_included'] as const).includes(r.label_style as never) ? (r.label_style as Label['label_style']) : 'unknown',
    uncertain: [...uncertain],
  };
}
