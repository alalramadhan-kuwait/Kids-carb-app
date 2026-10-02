// Import a Gluroo data export (CSV). Pure, tested in Node; reading the file and writing to the database are in
// importGluroo.ts. Two steps, so that no exported entry is ever thrown away:
//
// 1. classify(): every message row becomes an import entry, kept as exported, with a status the parents can change:
//      accepted            used as logged
//      probable_duplicate  the same text and carbs again within 10 min from the same person, or already in the app
//      replaced            the same food with a changed amount from the same person within 30 min: a corrected estimate
//      low_treatment       juice or a sweet of 20 g or less while glucose was under 4.4 mmol/L (or a Gluroo intervention)
//      uncertain           the same food and amount again from the same person 10–30 min later, the same food from
//                          the other parent within 60 min, or a second basal within 2 h:
//                          maybe the same plate or dose logged twice, maybe not. Left for the parents to decide;
//                          the importer never uses the insulin dose to judge what a meal "should" have been
//      info                badges, messages, barcode definitions: kept, not used
// 2. derive(): the cleaned meals and events, rebuilt from the entries' current statuses (after any parent change).
//    Items within 20 min form one meal; a meal next to an undecided entry is marked uncertain, so research leaves it out.

const MIN = 60000;
export const GLUROO_SENDERS: Record<string, string> = { '422380': 'الأب', '422389': 'Rawan', '422378': 'Layan' }; // i18n-ok: data

type Food = { key: string; name: string; kind: 'meal' | 'snack'; pats: RegExp[] };
// first match wins; names are stored data (shown through tMaybe)
const FOODS: Food[] = ([
  ['cocktail', 'عصير كوكتيل فواكه', 'snack', [/cocktail fruit drink/]], // i18n-ok: data
  ['juice_box', 'عصير علبة', 'snack', [/made from juice concentrate/, /nutrition facts for a juice box/]], // i18n-ok: data
  ['mango', 'عصير مانجو', 'snack', [/mango nectar/]], // i18n-ok: data
  ['kdd_choc', 'حليب KDD بالشوكولاتة', 'snack', [/kdd/]], // i18n-ok: data
  ['mint_milk', 'حليب بالنعناع', 'snack', [/flavored milk drink/]], // i18n-ok: data
  ['egg_sandwich', 'ساندويتش بيض وتركي وجبن', 'meal', [/sandwich.*(egg|turkey)/]], // i18n-ok: data
  ['chicken_sandwich', 'ساندويتش دجاج', 'meal', [/chicken sandwiches|burgers/]], // i18n-ok: data
  ['tea', 'شاي بالحليب والسكر', 'snack', [/tea/]], // i18n-ok: data
  ['spinach_rice', 'عيش مع مرق سبانخ', 'meal', [/spinach/]], // i18n-ok: data
  ['rice', 'عيش أبيض', 'meal', [/rice|vermicelli/]], // i18n-ok: data
  ['stew', 'مرق دجاج وبطاط', 'meal', [/stew|curry/]], // i18n-ok: data
  ['skewers', 'تكة دجاج', 'meal', [/skewer|tikka/]], // i18n-ok: data
  ['meat_plate', 'لحم مشوي', 'meal', [/cooked meat/]], // i18n-ok: data
  ['meat_sauce', 'لحم بصلصة طماط', 'meal', [/thick red sauce/]], // i18n-ok: data
  ['ice_cream', 'آيس كريم', 'snack', [/ice cream/]], // i18n-ok: data
  ['eggs', 'بيض مسلوق', 'snack', [/\begg/]], // i18n-ok: data
  ['turkey', 'شرائح تركي وخيار', 'snack', [/deli meat|turkey or chicken deli|turkey meat/]], // i18n-ok: data
  ['snack_bar', 'سناك بار / بسكويت (101 سعرة)', 'snack', [/101 per 15g|snack bar|energy 101/]], // i18n-ok: data
  ['cookies', 'كوكيز (حبتين)', 'snack', [/cookie/]], // i18n-ok: data
  ['choc_biscuits', 'بسكويت بالشوكولاتة', 'snack', [/biscuits with chocolate/]], // i18n-ok: data
  ['biscuit', 'بسكويت', 'snack', [/biscuit/]], // i18n-ok: data
  ['bar55', 'بار (55 غ)', 'snack', [/1 bar \(55g\)/]], // i18n-ok: data
  ['pita', 'خبز عربي', 'meal', [/pita/]], // i18n-ok: data
  ['clotted_cream', 'قشطة وعسل', 'snack', [/clotted cream/]], // i18n-ok: data
  ['cream_cheese_honey', 'جبن كريمي وعسل', 'snack', [/cream cheese with honey/]], // i18n-ok: data
  ['cream_cheese', 'جبن كريمي', 'snack', [/cream cheese/]], // i18n-ok: data
  ['cucumber', 'خيار', 'snack', [/cucumber/]], // i18n-ok: data
  ['cake', 'كيك شوكولاتة', 'snack', [/chocolate cake/]], // i18n-ok: data
  ['yogurt', 'روب (كوب)', 'snack', [/yogurt/]], // i18n-ok: data
  ['national', 'منتج National Food (ملصق)', 'snack', [/national food products/]], // i18n-ok: data
] as [string, string, 'meal' | 'snack', RegExp[]][]).map(([key, name, kind, pats]) => ({ key, name, kind, pats }));
const TREAT_KEYS = new Set(['juice_box', 'cocktail', 'mango', 'sweet']);
const ARROW: Record<string, number> = { SINGLE_DOWN: 1, DOUBLE_DOWN: 1, FORTYFIVE_DOWN: 2, FLAT: 3, FORTYFIVE_UP: 4, SINGLE_UP: 5, DOUBLE_UP: 5 };

/** CSV with quoted fields (commas, quotes and line breaks inside quotes). */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = []; let row: string[] = [], field = '', q = false;
  const s = text.replace(/^﻿/, '');
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (q) { if (c === '"') { if (s[i + 1] === '"') { field += '"'; i++; } else q = false; } else field += c; continue; }
    if (c === '"') q = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && s[i + 1] === '\n') i++; row.push(field); rows.push(row); row = []; field = ''; }
    else field += c;
  }
  if (field || row.length) { row.push(field); rows.push(row); }
  const [head, ...body] = rows.filter((r) => r.length > 1 || r[0]);
  return body.map((r) => Object.fromEntries(head.map((h, k) => [h, r[k] ?? ''])));
}

const num = (x: string | undefined) => { const n = Number(x); return x === undefined || x === '' || Number.isNaN(n) ? null : n; };
const r1 = (x: number) => Math.round(x * 10) / 10;
export function foodOf(text: string, desc: string): { key: string; name: string; kind: 'meal' | 'snack' } {
  const s = `${text} ${desc}`.toLowerCase();
  const f = FOODS.find((x) => x.pats.some((p) => p.test(s)));
  return f ? { key: f.key, name: f.name, kind: f.kind } : { key: 'other:' + s.slice(0, 40), name: text.slice(0, 60), kind: 'snack' };
}

export type EntryStatus = 'accepted' | 'probable_duplicate' | 'replaced' | 'low_treatment' | 'uncertain' | 'info';
export interface ImportEntry {
  key: string; t: number; type: string; sender: string; raw: Record<string, string>;
  food_key: string | null; food_name: string | null; carbs: number | null; units: number | null;
  status: EntryStatus; reason: string | null; related_key: string | null; decided_by?: 'importer' | 'parent';
}
export interface Existing { kind: 'insulin' | 'carbs' | 'treatment'; amount: number; t: number }
export interface Reading { t: number; mg: number; tr: number | null }

export const entryKey = (r: Record<string, string>) => `gluroo:${r.date}:${r.msgType}:${(r.text || '').slice(0, 40)}:${r.foodG || r.doseUnits || r.fpBgl || ''}`;

export function readingsFrom(rows: Record<string, string>[]): Reading[] {
  return rows.filter((r) => r.eventType === 'cgm_reading' && num(r.bgl)).map((r) => ({ t: Date.parse(r.date), mg: num(r.bgl)!, tr: ARROW[r.trend] ?? null }))
    .filter((r) => !Number.isNaN(r.t)).sort((a, b) => a.t - b.t);
}

export function nearestReading(readings: Reading[], t: number, within = 10 * MIN): Reading | null {
  let lo = 0, hi = readings.length - 1;
  while (lo < hi) { const m = (lo + hi) >> 1; if (readings[m].t < t) lo = m + 1; else hi = m; }
  const c = [readings[lo - 1], readings[lo]].filter(Boolean).sort((a, b) => Math.abs(a.t - t) - Math.abs(b.t - t))[0];
  return c && Math.abs(c.t - t) <= within ? c : null;
}

/** Step 1: one entry per exported message, with the importer's status and the reason in plain words. */
export function classify(rows: Record<string, string>[], readings: Reading[], existing: Existing[]): ImportEntry[] {
  const already = (kind: Existing['kind'], amount: number, t: number) =>
    existing.some((e) => e.kind === kind && Math.abs(e.t - t) <= 15 * MIN && Math.abs(e.amount - amount) < 0.01);
  const msgs = rows.filter((r) => r.eventType === 'message').map((r) => ({ r, t: Date.parse(r.date) })).filter((x) => !Number.isNaN(x.t)).sort((a, b) => a.t - b.t);
  const out: ImportEntry[] = [];
  const base = (r: Record<string, string>, t: number): ImportEntry => ({
    key: entryKey(r), t, type: r.msgType || 'message', sender: r.senderId, raw: r, food_key: null, food_name: null,
    carbs: num(r.foodG), units: num(r.doseUnits), status: 'info', reason: null, related_key: null,
  });
  const seen = new Map<string, number>(); // identical rows (same time, text and amount) stay separate entries
  let lastBasal: ImportEntry | null = null;
  const food: ImportEntry[] = [];
  for (const { r, t } of msgs) {
    const e = base(r, t);
    const n = (seen.get(e.key) ?? 0) + 1; seen.set(e.key, n); if (n > 1) e.key += `#${n}`;
    if (r.msgType === 'DOSE_INSULIN' || r.msgType.startsWith('DOSE_BASAL')) {
      const long = r.msgType.startsWith('DOSE_BASAL');
      if (e.units && already('insulin', e.units, t)) Object.assign(e, { status: 'probable_duplicate', reason: 'already_in_app' });
      else if (long && lastBasal && t - lastBasal.t < 2 * 3600000 && lastBasal.sender !== e.sender)
        Object.assign(e, { status: 'uncertain', reason: 'second_basal', related_key: lastBasal.key });
      else e.status = 'accepted';
      if (long && e.status === 'accepted') lastBasal = e;
    } else if (r.msgType === 'BGL_FP_READING' && num(r.fpBgl)) e.status = 'accepted';
    else if (r.msgType === 'INTERVENTION') Object.assign(e, { status: 'low_treatment', reason: 'intervention', food_key: 'sweet', food_name: r.description || 'حلاوة', carbs: num(r.foodG) ?? 0 }); // i18n-ok: stored
    else if (r.msgType === 'ANNOUNCE_MEAL' && num(r.foodG) !== null) {
      const f = foodOf(r.text, r.description);
      Object.assign(e, { food_key: f.key, food_name: f.name, status: 'accepted' });
      food.push(e);
    }
    out.push(e);
  }
  // food: compare each entry with the later ones
  food.forEach((it, i) => {
    const later = food.slice(i + 1);
    const same = later.find((j) => j.sender === it.sender && j.raw.text === it.raw.text && j.carbs === it.carbs && j.t - it.t <= 10 * MIN);
    if (same) return void Object.assign(it, { status: 'probable_duplicate', reason: 'identical_repeat', related_key: same.key });
    // a changed amount for the same food soon after is a corrected estimate; the same amount again may be a second serving
    const corrected = later.filter((j) => j.food_key === it.food_key && j.sender === it.sender && j.t - it.t <= 30 * MIN && j.carbs !== it.carbs).pop();
    if (corrected) return void Object.assign(it, { status: 'replaced', reason: 'later_estimate', related_key: corrected.key });
    const again = later.find((j) => j.food_key === it.food_key && j.sender === it.sender && j.t - it.t <= 30 * MIN);
    if (again) return void Object.assign(it, { status: 'uncertain', reason: 'same_food_again', related_key: again.key });
    const other = later.filter((j) => j.food_key === it.food_key && j.sender !== it.sender && j.t - it.t <= 60 * MIN).pop();
    if (other) return void Object.assign(it, { status: 'uncertain', reason: 'other_parent_same_food', related_key: other.key });
    if (already('carbs', it.carbs!, it.t) || already('treatment', it.carbs!, it.t)) return void Object.assign(it, { status: 'probable_duplicate', reason: 'already_in_app' });
    const g = nearestReading(readings, it.t);
    if (TREAT_KEYS.has(it.food_key!) && it.carbs! <= 20 && g && g.mg < 80) Object.assign(it, { status: 'low_treatment', reason: 'juice_while_low' });
  });
  return out;
}

export interface DerivedEvent {
  key: string; kind: 'insulin' | 'treatment' | 'bg_check'; t: number; sender: string;
  insulin_units?: number; insulin_type?: 'rapid' | 'long'; bolus_purpose?: 'meal' | 'correction';
  carbs_g?: number; treatment?: string; bg_mgdl?: number;
}
export interface DerivedMeal {
  key: string; t: number; kind: 'meal' | 'snack'; name: string; items: ImportEntry[]; carbs: number;
  fat: number | null; protein: number | null; kcal: number | null; uncertain: boolean; senders: string[];
  glucose: Reading | null;
}
export interface DerivedQuick { name: string; carbs: number; fat: number | null; protein: number | null; kcal: number | null; kind: 'meal' | 'snack'; barcode: string | null; uses: number; values: number[]; last: number }

/** Step 2: the cleaned meals and events from the entries' current statuses. */
export function derive(entries: ImportEntry[], readings: Reading[]): { meals: DerivedMeal[]; events: DerivedEvent[]; quick: DerivedQuick[] } {
  const E = [...entries].sort((a, b) => a.t - b.t);
  const used = (e: ImportEntry) => e.status === 'accepted';
  const foodIn = E.filter((e) => e.type === 'ANNOUNCE_MEAL');
  const events: DerivedEvent[] = [];
  for (const e of E) {
    if (e.type === 'DOSE_INSULIN' && used(e) && e.units) {
      const nearFood = foodIn.some((m) => (m.status === 'accepted' || m.status === 'uncertain') && m.t - e.t >= -20 * MIN && m.t - e.t <= 45 * MIN);
      events.push({ key: e.key, kind: 'insulin', t: e.t, sender: e.sender, insulin_units: e.units, insulin_type: 'rapid', bolus_purpose: nearFood ? 'meal' : 'correction' });
    } else if (e.type.startsWith('DOSE_BASAL') && used(e) && e.units) events.push({ key: e.key, kind: 'insulin', t: e.t, sender: e.sender, insulin_units: e.units, insulin_type: 'long' });
    else if (e.type === 'BGL_FP_READING' && used(e) && num(e.raw.fpBgl)) events.push({ key: e.key, kind: 'bg_check', t: e.t, sender: e.sender, bg_mgdl: Math.round(num(e.raw.fpBgl)!) });
    else if (e.status === 'low_treatment') events.push({ key: e.key, kind: 'treatment', t: e.t, sender: e.sender, carbs_g: e.carbs ?? 0, treatment: e.food_key === 'sweet' ? 'أخرى' : 'عصير' }); // i18n-ok: stored values
  }
  const groups: ImportEntry[][] = [];
  for (const it of foodIn.filter(used)) {
    const g = groups[groups.length - 1];
    if (g && it.t - g[g.length - 1].t <= 20 * MIN) g.push(it); else groups.push([it]);
  }
  const pending = foodIn.filter((e) => e.status === 'uncertain');
  const sum = (g: ImportEntry[], k: 'foodFat' | 'foodProtein' | 'foodCal') => (g.some((i) => num(i.raw[k]) !== null) ? r1(g.reduce((s, i) => s + (num(i.raw[k]) ?? 0), 0)) : null);
  const meals: DerivedMeal[] = groups.map((g) => {
    const carbs = r1(g.reduce((s, i) => s + (i.carbs ?? 0), 0)), keys = new Set(g.map((i) => i.key));
    return {
      key: g[0].key, t: g[0].t, kind: carbs >= 20 || g.some((i) => FOODS.find((f) => f.key === i.food_key)?.kind === 'meal') ? 'meal' : 'snack',
      name: [...new Set(g.map((i) => i.food_name!))].join(' + '), items: g, carbs, fat: sum(g, 'foodFat'), protein: sum(g, 'foodProtein'), kcal: sum(g, 'foodCal'),
      uncertain: pending.some((p) => (p.related_key && keys.has(p.related_key)) || Math.abs(p.t - g[0].t) <= 60 * MIN),
      senders: [...new Set(g.map((i) => GLUROO_SENDERS[i.sender] ?? i.sender))], glucose: nearestReading(readings, g[0].t),
    };
  });
  // foods logged on 2 or more occasions -> quick items, with the amount logged most often (partial servings ignored)
  const by = new Map<string, ImportEntry[]>();
  for (const it of foodIn) if ((used(it) || it.status === 'low_treatment') && !it.food_key!.startsWith('other:')) by.set(it.food_key!, [...(by.get(it.food_key!) ?? []), it]);
  const quick: DerivedQuick[] = [...by.values()].filter((its) => its.length >= 2).map((its) => {
    const max = Math.max(...its.map((i) => i.carbs ?? 0));
    const counts = new Map<number, number>(); for (const i of its) if ((i.carbs ?? 0) >= max / 2) counts.set(r1(i.carbs ?? 0), (counts.get(r1(i.carbs ?? 0)) ?? 0) + 1);
    const carbs = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const pick = [...its].reverse().find((i) => r1(i.carbs ?? 0) === carbs) ?? its[its.length - 1];
    const kind = (FOODS.find((f) => f.key === pick.food_key)?.kind ?? 'snack') as 'meal' | 'snack';
    return { name: pick.food_name!, carbs, fat: num(pick.raw.foodFat), protein: num(pick.raw.foodProtein), kcal: num(pick.raw.foodCal), kind,
      barcode: its.map((i) => i.raw.description).find((d) => /^\d+$/.test(d ?? '')) ?? null, uses: its.length, values: its.map((i) => i.carbs ?? 0), last: its[its.length - 1].t };
  }).sort((a, b) => b.uses - a.uses);
  return { meals, events, quick };
}

/** RFC 4122 version 5 (SHA-1) id, so the same Gluroo entry always gets the same client id. */
export async function uuid5(name: string): Promise<string> {
  const ns = '6f1c1d3e3b9e4e559b8a6c1a0d0f2a11'.match(/../g)!.map((h) => parseInt(h, 16));
  const data = new Uint8Array([...ns, ...new TextEncoder().encode(name)]);
  const h = new Uint8Array(await crypto.subtle.digest('SHA-1', data)).slice(0, 16);
  h[6] = (h[6] & 0x0f) | 0x50; h[8] = (h[8] & 0x3f) | 0x80;
  const x = [...h].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20)}`;
}
