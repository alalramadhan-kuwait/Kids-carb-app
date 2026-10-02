// Import a Gluroo data export (CSV). Pure planning, tested in Node; applying the plan is in importGluroo.ts.
// The same rules as scripts/gluroo_import.py:
//   readings      -> glucose_readings (only where no reading exists within 90 s), Libre's arrow kept
//   rapid dose    -> insulin event; 'meal' if food was logged from 20 min before to 45 min after, else 'correction'
//   basal dose    -> insulin event, long; a second basal within 2 h is reported, not imported
//   finger-prick  -> bg_check event
//   intervention  -> treatment event
//   meals         -> meal_history after removing double entries: the same food again within 30 min (a corrected
//                    estimate) or by the other parent within 60 min (the same plate) keeps only the last one;
//                    items within 20 min become one meal; juice or a sweet of 20 g or less while glucose is under
//                    4.4 mmol/L becomes a low treatment
//   repeated foods -> quick items
// Anything already in the app (same kind and amount within 15 min) is skipped. Running it twice adds nothing.

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

export interface Existing { kind: 'insulin' | 'carbs' | 'treatment'; amount: number; t: number }
export interface PlanEvent {
  key: string; kind: 'insulin' | 'treatment' | 'bg_check'; t: number; sender: string;
  insulin_units?: number; insulin_type?: 'rapid' | 'long'; bolus_purpose?: 'meal' | 'correction';
  carbs_g?: number; treatment?: string; bg_mgdl?: number; sensor?: number | null;
}
export interface PlanItem { t: number; key: string; name: string; kind: 'meal' | 'snack' | 'treatment'; g: number; fat: number | null; protein: number | null; kcal: number | null; sender: string; barcode: string | null; date: string }
export interface PlanMeal { key: string; t: number; kind: 'meal' | 'snack'; name: string; items: PlanItem[]; carbs: number; fat: number | null; protein: number | null; kcal: number | null; glucose: { mg: number; trend: number | null; t: number } | null; senders: string[] }
export interface PlanQuick { name: string; carbs: number; fat: number | null; protein: number | null; kcal: number | null; kind: 'meal' | 'snack'; barcode: string | null; uses: number; values: number[]; last: number }
export interface GlurooPlan {
  readings: { t: number; mg: number; tr: number | null }[];
  range: [number, number] | null;
  events: PlanEvent[];
  meals: PlanMeal[];
  quick: PlanQuick[];
  doubles: { item: PlanItem; keptG: number; keptT: number; otherParent: boolean }[];
  skipped: { what: string; t: number; amount: number }[];
  flagged: { what: string; t: number; amount: number; minutes: number }[];
}

export function planGluroo(rows: Record<string, string>[], existing: Existing[]): GlurooPlan {
  type Row = Record<string, string> & { t: number };
  const R: Row[] = rows.map((r) => Object.assign({}, r, { t: Date.parse(r.date) }) as Row).filter((r) => !Number.isNaN(r.t)).sort((a, b) => a.t - b.t);
  const already = (kind: Existing['kind'], amount: number, t: number) =>
    existing.some((e) => e.kind === kind && Math.abs(e.t - t) <= 15 * MIN && Math.abs(e.amount - amount) < 0.01);

  const cgm = R.filter((r) => r.eventType === 'cgm_reading' && num(r.bgl));
  const readings = cgm.map((r) => ({ t: r.t, mg: num(r.bgl)!, tr: ARROW[r.trend] ?? null }));
  const bgAt = (t: number) => {
    let best: (typeof readings)[number] | null = null;
    for (const g of readings) if (!best || Math.abs(g.t - t) < Math.abs(best.t - t)) best = g;
    return best && Math.abs(best.t - t) <= 10 * MIN ? best : null;
  };

  const msgs = R.filter((r) => r.eventType === 'message');
  const mealMsgs = msgs.filter((r) => r.msgType === 'ANNOUNCE_MEAL' && num(r.foodG) !== null);
  const events: PlanEvent[] = [], skipped: GlurooPlan['skipped'] = [], flagged: GlurooPlan['flagged'] = [];

  // insulin
  let lastBasal: number | null = null;
  for (const r of msgs) {
    const long = r.msgType.startsWith('DOSE_BASAL');
    if (!(r.msgType === 'DOSE_INSULIN' || long)) continue;
    const u = num(r.doseUnits); if (!u) continue;
    if (already('insulin', u, r.t)) { skipped.push({ what: long ? 'long' : 'rapid', t: r.t, amount: u }); continue; }
    if (long && lastBasal !== null && r.t - lastBasal < 2 * 3600000) { flagged.push({ what: 'long', t: r.t, amount: u, minutes: Math.round((r.t - lastBasal) / MIN) }); continue; }
    if (long) lastBasal = r.t;
    const purpose = long ? undefined : mealMsgs.some((m) => m.t - r.t >= -20 * MIN && m.t - r.t <= 45 * MIN) ? 'meal' : 'correction';
    events.push({ key: `gluroo:${r.date}:${r.msgType}`, kind: 'insulin', t: r.t, sender: r.senderId, insulin_units: u, insulin_type: long ? 'long' : 'rapid', ...(purpose ? { bolus_purpose: purpose as 'meal' | 'correction' } : {}) });
  }
  // finger-pricks
  for (const r of msgs) {
    if (r.msgType !== 'BGL_FP_READING' || !num(r.fpBgl)) continue;
    events.push({ key: `gluroo:${r.date}:fp`, kind: 'bg_check', t: r.t, sender: r.senderId, bg_mgdl: Math.round(num(r.fpBgl)!), sensor: bgAt(r.t)?.mg ?? null });
  }

  // food
  const items: PlanItem[] = mealMsgs.map((r) => {
    const f = foodOf(r.text, r.description);
    return { t: r.t, key: f.key, name: f.name, kind: f.kind, g: num(r.foodG)!, fat: num(r.foodFat), protein: num(r.foodProtein), kcal: num(r.foodCal), sender: r.senderId, barcode: /^\d+$/.test(r.description) ? r.description : null, date: r.date };
  });
  for (const r of msgs) if (r.msgType === 'INTERVENTION')
    items.push({ t: r.t, key: 'sweet', name: r.description || 'حلاوة', kind: 'treatment', g: num(r.foodG) ?? 0, fat: null, protein: null, kcal: num(r.foodCal), sender: r.senderId, barcode: null, date: r.date }); // i18n-ok: stored
  items.sort((a, b) => a.t - b.t);

  const doubles: GlurooPlan['doubles'] = [], kept: PlanItem[] = [];
  items.forEach((it, i) => {
    const later = items.slice(i + 1).filter((j) => j.key === it.key && (j.t - it.t <= 30 * MIN || (j.sender !== it.sender && j.t - it.t <= 60 * MIN)));
    if (later.length) { const k = later[later.length - 1]; doubles.push({ item: it, keptG: k.g, keptT: k.t, otherParent: k.sender !== it.sender }); return; }
    kept.push(it);
  });

  const food: PlanItem[] = [];
  for (const it of kept) {
    if (already('carbs', it.g, it.t) || already('treatment', it.g, it.t)) { skipped.push({ what: it.name, t: it.t, amount: it.g }); continue; }
    const s = bgAt(it.t);
    if (it.kind === 'treatment' || (TREAT_KEYS.has(it.key) && it.g <= 20 && s && s.mg < 80)) {
      events.push({ key: `gluroo:${it.date}:treat`, kind: 'treatment', t: it.t, sender: it.sender, carbs_g: it.g, treatment: it.key === 'sweet' ? 'أخرى' : 'عصير', sensor: s?.mg ?? null }); // i18n-ok: stored values
      continue;
    }
    food.push(it);
  }

  const groups: PlanItem[][] = [];
  for (const it of food) {
    const g = groups[groups.length - 1];
    if (g && it.t - g[g.length - 1].t <= 20 * MIN) g.push(it); else groups.push([it]);
  }
  const sum = (g: PlanItem[], k: 'fat' | 'protein' | 'kcal') => (g.some((i) => i[k] !== null) ? r1(g.reduce((s, i) => s + (i[k] ?? 0), 0)) : null);
  const meals: PlanMeal[] = groups.map((g) => {
    const carbs = r1(g.reduce((s, i) => s + i.g, 0)), s = bgAt(g[0].t);
    return {
      key: 'gluroo:' + g[0].date, t: g[0].t, kind: carbs >= 20 || g.some((i) => i.kind === 'meal') ? 'meal' : 'snack',
      name: [...new Set(g.map((i) => i.name))].join(' + '), items: g, carbs, fat: sum(g, 'fat'), protein: sum(g, 'protein'), kcal: sum(g, 'kcal'),
      glucose: s ? { mg: s.mg, trend: s.tr, t: s.t } : null, senders: [...new Set(g.map((i) => GLUROO_SENDERS[i.sender] ?? i.sender))],
    };
  });

  // repeated foods -> quick items: the amount logged most often (the larger one on a tie)
  const by = new Map<string, PlanItem[]>();
  for (const it of kept) if (!it.key.startsWith('other:') && it.key !== 'sweet') by.set(it.key, [...(by.get(it.key) ?? []), it]);
  const quick: PlanQuick[] = [...by.values()].filter((its) => its.length >= 2).map((its) => {
    // partial servings (under half the largest amount) do not set the item's amount
    const max = Math.max(...its.map((i) => i.g));
    const counts = new Map<number, number>(); for (const i of its) if (i.g >= max / 2) counts.set(r1(i.g), (counts.get(r1(i.g)) ?? 0) + 1);
    const carbs = [...counts.entries()].sort((a, b) => b[1] - a[1] || b[0] - a[0])[0][0];
    const pick = [...its].reverse().find((i) => r1(i.g) === carbs) ?? its[its.length - 1];
    return { name: pick.name, carbs, fat: pick.fat, protein: pick.protein, kcal: pick.kcal, kind: (pick.kind === 'meal' ? 'meal' : 'snack') as 'meal' | 'snack', barcode: its.find((i) => i.barcode)?.barcode ?? null, uses: its.length, values: its.map((i) => i.g), last: its[its.length - 1].t };
  }).sort((a, b) => b.uses - a.uses);

  return { readings, range: readings.length ? [readings[0].t, readings[readings.length - 1].t] : null, events, meals, quick, doubles, skipped, flagged };
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
