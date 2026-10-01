import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeLine, computeMeal, deriveLabel, labelMismatch, levelFor, targetMiss } from '../carbs';
import { blocker, candidatesOf, suggest } from '../suggest';
import { shoppingList } from '../shopping';
import { hostFor, loginProblem, redirectRegion, maskEmail, parseLluTimestamp, readingsFromGraph, sha256Hex, toReading, tooSoon } from '../../../supabase/functions/carb-glucose/lib';
import { formatGlucose, glucoseAge, glucoseLevel, glucoseStatus, toMgdl } from '../glucose';
import { TREND_ICON, TREND_WORDS } from '../../components/Icon';
import { ICONS } from '../../icons/defs';
import { DEFAULT_SETTINGS, type HistoryEntry, type Ingredient, type Product, type Recipe, type Settings } from '../types';

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('  ok', name); };
const close = (a: number | null, b: number, eps = 0.05) => assert.ok(a !== null && Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

const S: Settings = { ...DEFAULT_SETTINGS, category_targets: [
  { category: 'ناجت', basis: 'per100', max: 15 },
  { category: 'توست', basis: 'serving', max: 14 },
] };

let pid = 0;
const prod = (o: Partial<Product>): Product => ({
  id: `p${++pid}`, name: 'x', brand: null, category: 'x', kind: 'commercial', image_path: null, pack_size: null,
  unit: 'g', carbs_per_100: 0, fat_per_100: null, fiber_per_100: null, protein_per_100: null, kcal_per_100: null,
  serving_size: null, carbs_per_serving: null, label_basis: 'as_sold', cooked_yield: null, available: false,
  approved: true, label_updated_at: '2026-01-01', notes: null, ...o,
});
let iid = 0;
const ing = (o: Partial<Ingredient>): Ingredient => ({
  id: `i${++iid}`, role: 'main', product_id: null, slot_category: null, label: null, quantity: 100, unit: 'g',
  state: 'as_is', qty_confirmed: true, note: null, sort: 0, ...o,
});

console.log('carbs');

test('the brief\'s example: 20 g per 100 g, 75 g used = 15 g', () => {
  const p = prod({ carbs_per_100: 20 });
  close(computeLine(ing({ product_id: p.id, quantity: 75 }), [p], S).carbs, 15);
});

test('unregistered product is never guessed', () => {
  const l = computeLine(ing({ slot_category: 'ناجت' }), [], S);
  assert.equal(l.carbs, null);
  assert.equal(l.problem, 'no_product');
});

test('unapproved product does not count', () => {
  const p = prod({ category: 'ناجت', carbs_per_100: 12, approved: false });
  assert.equal(computeLine(ing({ slot_category: 'ناجت' }), [p], S).problem, 'unapproved');
  assert.equal(computeLine(ing({ product_id: p.id }), [p], S).problem, 'unapproved');
});

test('a category slot prefers the product that is in the pantry', () => {
  const a = prod({ name: 'A', category: 'ناجت', carbs_per_100: 10, available: false });
  const b = prod({ name: 'B', category: 'ناجت', carbs_per_100: 14, available: true });
  assert.equal(computeLine(ing({ slot_category: 'ناجت' }), [a, b], S).product?.id, b.id);
  // pinning wins over the pantry
  assert.equal(computeLine(ing({ product_id: a.id }), [a, b], S).product?.id, a.id);
});

test('servings and tablespoons come from the product / settings, not constants', () => {
  const toast = prod({ carbs_per_100: 46.7, serving_size: 30 });
  close(computeLine(ing({ product_id: toast.id, quantity: 2, unit: 'serving' }), [toast], S).carbs, 28, 0.1);
  const noServing = prod({ carbs_per_100: 10 });
  assert.equal(computeLine(ing({ product_id: noServing.id, quantity: 1, unit: 'serving' }), [noServing], S).problem, 'no_serving');
  const ketchup = prod({ carbs_per_100: 25 });
  close(computeLine(ing({ product_id: ketchup.id, quantity: 1, unit: 'tbsp' }), [ketchup], S).carbs, 3.75);
  close(computeLine(ing({ product_id: ketchup.id, quantity: 1, unit: 'tbsp' }), [ketchup], { ...S, tbsp_size: 20 }).carbs, 5);
});

test('cooked pasta needs the yield; the label is for dry pasta', () => {
  const dry = prod({ category: 'باستا', carbs_per_100: 72 });
  const cooked = ing({ product_id: dry.id, quantity: 120, state: 'cooked' });
  assert.equal(computeLine(cooked, [dry], S).problem, 'no_yield');
  const withYield = { ...dry, cooked_yield: 2.4 };
  close(computeLine(cooked, [withYield], S).carbs, 36); // 120/2.4 = 50 g dry × 0.72
  // and uncooked/as-is weights ignore the yield
  close(computeLine(ing({ product_id: dry.id, quantity: 50, state: 'as_is' }), [withYield], S).carbs, 36);
});

test('natural foods already entered as cooked are used as they are', () => {
  const rice = prod({ kind: 'natural', label_basis: 'cooked', carbs_per_100: 28.2 });
  close(computeLine(ing({ product_id: rice.id, quantity: 140, state: 'cooked' }), [rice], S).carbs, 39.5, 0.1);
});

test('grams against an ml product is refused, not converted', () => {
  const milk = prod({ unit: 'ml', carbs_per_100: 4 });
  assert.equal(computeLine(ing({ product_id: milk.id, unit: 'g' }), [milk], S).problem, 'unit_mismatch');
});

test('meal total, roles, completeness and nutrition', () => {
  const rice = prod({ kind: 'natural', carbs_per_100: 28.2, fat_per_100: 0.3, fiber_per_100: 0.4, protein_per_100: 2.7, kcal_per_100: 130 });
  const apple = prod({ kind: 'natural', carbs_per_100: 13.8 }); // no macros on file
  const m = computeMeal([ing({ product_id: rice.id, quantity: 140 }), ing({ product_id: apple.id, role: 'snack' })], [rice, apple], S);
  assert.ok(m.complete);
  close(m.total.carbs, 39.5 + 13.8, 0.1);
  close(m.byRole.snack, 13.8);
  close(m.total.kcal, 182);
  assert.equal(m.nutritionPartial, true);
  const missing = computeMeal([ing({ product_id: rice.id }), ing({ slot_category: 'جبن' })], [rice], S);
  assert.equal(missing.complete, false);
});

test('levels: ≤55 normal, up to 60 near, above 60 warning', () => {
  assert.equal(levelFor(55, S), 'normal');
  assert.equal(levelFor(55.1, S), 'near');
  assert.equal(levelFor(60, S), 'near');
  assert.equal(levelFor(60.1, S), 'over');
  assert.equal(levelFor(70, { ...S, max_meal_carbs: 70 }), 'near');
});

test('label helpers derive the missing number and catch typos', () => {
  assert.deepEqual(deriveLabel({ serving: 30, perServing: 14 }), { per100: 46.7, serving: 30, perServing: 14 });
  assert.deepEqual(deriveLabel({ per100: 20, serving: 25 }), { per100: 20, serving: 25, perServing: 5 });
  assert.equal(labelMismatch(46.7, 30, 14), null);
  assert.equal(labelMismatch(46.7, 30, 41), 14);
});

test('category targets come from settings and flag products that miss them', () => {
  assert.ok(targetMiss({ category: 'ناجت', carbs_per_100: 18, serving_size: null, carbs_per_serving: null }, S));
  assert.equal(targetMiss({ category: 'ناجت', carbs_per_100: 15, serving_size: null, carbs_per_serving: null }, S), null);
  assert.ok(targetMiss({ category: 'توست', carbs_per_100: 50, serving_size: 30, carbs_per_serving: null }, S)); // 15 per slice
  assert.equal(targetMiss({ category: 'توست', carbs_per_100: 45, serving_size: 30, carbs_per_serving: 13.5 }, S), null);
});

console.log('suggestions');

const rice = prod({ name: 'rice', kind: 'natural', carbs_per_100: 28.2 });
const products = [rice, prod({ name: 'nuggets', category: 'ناجت', carbs_per_100: 14, available: true })];
const mkRecipe = (id: string, o: Partial<Recipe> = {}): Recipe => ({
  id, name: id, category: id, image_path: null, instructions: null, notes: null, approved: true, favorite: false,
  carb_pending: false, pending_note: null, saved_total_carbs: null, ...o,
});
const riceMeal = (id: string, grams: number) => [ing({ recipe_id: id, product_id: rice.id, quantity: grams })];
const recipes = [mkRecipe('a'), mkRecipe('b'), mkRecipe('c'), mkRecipe('d'), mkRecipe('big'), mkRecipe('draft', { approved: false }),
  mkRecipe('pending', { carb_pending: true }), mkRecipe('nosku')];
const byRecipe = new Map<string, Ingredient[]>([
  ['a', riceMeal('a', 150)], ['b', riceMeal('b', 160)], ['c', riceMeal('c', 170)], ['d', riceMeal('d', 145)],
  ['big', riceMeal('big', 250)], ['draft', riceMeal('draft', 150)], ['pending', riceMeal('pending', 150)],
  ['nosku', [ing({ slot_category: 'توست', quantity: 2, unit: 'serving' })]],
]);
const cands = candidatesOf(recipes, byRecipe, products, S);
const today = new Date(2026, 8, 30, 12);
const hist = (recipe_id: string, daysAgo: number): HistoryEntry => ({
  id: `h${recipe_id}${daysAgo}`, kind: 'meal', recipe_id, name: recipe_id, category: null,
  eaten_at: new Date(2026, 8, 30 - daysAgo, 19).toISOString(), total_carbs: 50, total_fat: null, total_fiber: null,
  total_protein: null, total_kcal: null, modified: false, glucose_mgdl: null, glucose_trend: null, glucose_at: null, lines: [], notes: null,
});

test('only approved, complete, non-pending recipes within 60 g are eligible', () => {
  const why = Object.fromEntries(cands.map((c) => [c.recipe.id, blocker(c, S)]));
  assert.equal(why.a, null);
  assert.equal(why.big, 'تتجاوز الحد');
  assert.equal(why.draft, 'تحت المراجعة');
  assert.equal(why.pending, 'الكارب غير مكتمل');
  assert.equal(why.nosku, 'ينقصها منتجات');
});

test('never suggests an ineligible recipe, always at most the requested count', () => {
  const ids = suggest({ candidates: cands, history: [], settings: S, today }).map((c) => c.recipe.id);
  assert.equal(ids.length, 3);
  for (const id of ids) assert.ok(['a', 'b', 'c', 'd'].includes(id), id);
});

test('does not repeat yesterday while alternatives exist', () => {
  // c, d and the two big/ineligible ones are out; a, b eaten yesterday -> c, d first, one repeat only to fill
  for (let shuffle = 0; shuffle < 20; shuffle++) {
    const ids = suggest({ candidates: cands, history: [hist('a', 1), hist('b', 1)], settings: S, today, shuffle }).map((c) => c.recipe.id);
    assert.ok(ids.includes('c') && ids.includes('d'), `${ids}`);
    assert.equal(ids.filter((x) => x === 'a' || x === 'b').length, 1, `${ids}`);
  }
  // with enough alternatives nothing from yesterday appears
  const many = candidatesOf(recipes.slice(0, 4), byRecipe, products, S);
  for (let shuffle = 0; shuffle < 20; shuffle++) {
    const ids = suggest({ candidates: many, history: [hist('a', 1)], settings: S, today, shuffle }).map((c) => c.recipe.id);
    assert.ok(!ids.includes('a'), `${ids}`);
  }
});

test('repeats yesterday only to fill the list when there is no other choice', () => {
  const two = candidatesOf(recipes.slice(0, 2), byRecipe, products, S);
  const ids = suggest({ candidates: two, history: [hist('a', 1)], settings: S, today }).map((c) => c.recipe.id);
  assert.deepEqual([...ids].sort(), ['a', 'b']);
});

test('same day, same picks; shuffle changes them', () => {
  const key = (s: number) => suggest({ candidates: cands, history: [], settings: S, today, shuffle: s }).map((c) => c.recipe.id).join();
  assert.equal(key(0), key(0));
  assert.ok(new Set([0, 1, 2, 3, 4, 5, 6, 7].map(key)).size > 1);
});

test('favourites and pantry stock win', () => {
  const fav = candidatesOf([mkRecipe('a', { favorite: true }), ...recipes.slice(1, 4)], byRecipe, products, S);
  assert.equal(suggest({ candidates: fav, history: [], settings: S, today, count: 1 })[0].recipe.id, 'a');
});

console.log('shopping list');

test('scales by people, converts cooked back to dry, rounds up packs, keeps unresolved visible', () => {
  const pasta = prod({ name: 'pasta', category: 'باستا', carbs_per_100: 72, cooked_yield: 2.4, pack_size: 500, available: true });
  const nug = products[1];
  const pr = [pasta, nug, rice];
  const r = [mkRecipe('p'), mkRecipe('n')];
  const ibr = new Map<string, Ingredient[]>([
    ['p', [ing({ slot_category: 'باستا', quantity: 120, state: 'cooked' }), ing({ slot_category: 'جبن', label: 'جبن' })]],
    ['n', [ing({ slot_category: 'ناجت', quantity: 100 })]],
  ]);
  const plan = [
    { id: '1', plan_date: '2026-10-01', recipe_id: 'p', people: 4 },
    { id: '2', plan_date: '2026-10-02', recipe_id: 'p', people: 4 },
    { id: '3', plan_date: '2026-10-03', recipe_id: 'n', people: 2 },
  ];
  const list = shoppingList(plan, r, ibr, pr, S);
  const pastaItem = list.find((i) => i.name === 'pasta')!;
  close(pastaItem.qty, 50 * 8); // 120/2.4 = 50 g dry × 8 servings
  close(pastaItem.plated, 120 * 8);
  assert.equal(pastaItem.packs, 1);
  assert.equal(list.find((i) => i.name === 'nuggets')!.qty, 200);
  assert.ok(list.find((i) => i.unresolved && i.name === 'جبن'));
});


console.log('glucose');

test('LibreLinkUp timestamps are US-order 12-hour UTC', () => {
  assert.equal(parseLluTimestamp('10/1/2026 8:05:09 AM'), '2026-10-01T08:05:09.000Z');
  assert.equal(parseLluTimestamp('10/1/2026 12:05:09 AM'), '2026-10-01T00:05:09.000Z');
  assert.equal(parseLluTimestamp('10/1/2026 12:30:00 PM'), '2026-10-01T12:30:00.000Z');
  assert.equal(parseLluTimestamp('10/1/2026 11:59:59 PM'), '2026-10-01T23:59:59.000Z');
  assert.equal(parseLluTimestamp('garbage'), null);
  assert.equal(parseLluTimestamp(undefined), null);
});

test('readings use mg/dL from the service, never guess, and drop what cannot be trusted', () => {
  const ok = toReading({ FactoryTimestamp: '10/1/2026 8:05:09 AM', ValueInMgPerDl: 112.4, TrendArrow: 3 });
  assert.deepEqual(ok, { taken_at: '2026-10-01T08:05:09.000Z', mg_dl: 112, trend: 3 });
  assert.equal(toReading({ FactoryTimestamp: '10/1/2026 8:05:09 AM', Value: 6.2 })?.mg_dl, 112); // mmol/L fallback
  assert.equal(toReading({ Timestamp: '10/1/2026 11:05:09 AM', ValueInMgPerDl: 100 }), null);     // local time only: refuse
  assert.equal(toReading({ FactoryTimestamp: '10/1/2026 8:05:09 AM', ValueInMgPerDl: 0 }), null);
  assert.equal(toReading({ FactoryTimestamp: '10/1/2026 8:05:09 AM', ValueInMgPerDl: 5000 }), null);
  assert.equal(toReading({ FactoryTimestamp: '10/1/2026 8:05:09 AM', ValueInMgPerDl: 100, TrendArrow: 9 })?.trend, null);
});

test('graph: sorted, de-duplicated, current reading wins and carries the trend', () => {
  const r = readingsFromGraph({
    graphData: [
      { FactoryTimestamp: '10/1/2026 8:10:00 AM', ValueInMgPerDl: 120 },
      { FactoryTimestamp: '10/1/2026 8:00:00 AM', ValueInMgPerDl: 110 },
    ],
    connection: { glucoseMeasurement: { FactoryTimestamp: '10/1/2026 8:10:00 AM', ValueInMgPerDl: 121, TrendArrow: 4 } },
  });
  assert.deepEqual(r.map((x) => [x.mg_dl, x.trend]), [[110, null], [121, 4]]);
});

test('login problems are told apart', () => {
  assert.equal(loginProblem(200, { status: 0, data: { authTicket: { token: 't' } } }), null);
  assert.equal(loginProblem(200, { status: 0, data: { redirect: true, region: 'eu' } }), null);
  assert.equal(loginProblem(200, { status: 2 }), 'bad_credentials');
  assert.equal(loginProblem(200, { status: 4, data: { step: { type: 'tou' } } }), 'terms_required');
  assert.equal(loginProblem(403, { status: 920 }), 'version_rejected');
  assert.equal(loginProblem(429, null), 'rate_limited');
  assert.equal(loginProblem(500, null), 'upstream');
});

test('a regional redirect is recognised on any endpoint, not only login', () => {
  assert.equal(redirectRegion({ status: 0, data: { redirect: true, region: 'eu2' } }), 'eu2');
  assert.equal(redirectRegion({ status: 0, data: { connection: {}, graphData: [] } }), null);
  assert.equal(redirectRegion({ status: 0, data: [] }), null);
  assert.equal(redirectRegion(null), null);
});

test('hosts, hashing, masking, throttle', async () => {
  assert.equal(hostFor(null), 'https://api.libreview.io');
  assert.equal(hostFor('EU'), 'https://api-eu.libreview.io');
  assert.throws(() => hostFor('evil.com/x'));
  assert.equal(await sha256Hex('abc'), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
  assert.equal(maskEmail('mama@gmail.com'), 'm***@gmail.com');
  assert.equal(tooSoon(new Date(1000).toISOString(), 30_000), true);
  assert.equal(tooSoon(new Date(1000).toISOString(), 80_000), false);
  assert.equal(tooSoon(null, 80_000), false);
});

test('showing glucose: units, trend, age and colouring come from parent-entered settings', () => {
  assert.equal(formatGlucose(112, 'mmol'), '6.2');
  assert.equal(formatGlucose(112, 'mgdl'), '112');
  assert.equal(toMgdl(6.2, 'mmol'), 112);
  assert.equal(toMgdl(112, 'mgdl'), 112);
  const now = Date.parse('2026-10-01T10:00:00Z');
  assert.deepEqual(glucoseAge('2026-10-01T09:57:00Z', now), { minutes: 3, state: 'fresh' });
  assert.equal(glucoseAge('2026-10-01T09:40:00Z', now).state, 'old');
  assert.equal(glucoseAge('2026-10-01T09:00:00Z', now).state, 'stale');
  // no range entered -> no colouring, never a default medical range
  assert.equal(glucoseLevel(50, null, null), 'none');
  assert.equal(glucoseLevel(50, 70, 180), 'low');
  assert.equal(glucoseLevel(100, 70, 180), 'in');
  assert.equal(glucoseLevel(250, 70, 180), 'high');
});

test('trend arrows follow Libre: straight up/down are the fast ones, diagonals are moderate', () => {
  assert.equal(TREND_ICON[5], 'trend_rising_fast'); assert.equal(TREND_WORDS[5], 'صاعد بسرعة');
  assert.equal(TREND_ICON[1], 'trend_falling_fast'); assert.equal(TREND_WORDS[1], 'نازل بسرعة');
  assert.ok(ICONS.trend_rising_fast.d[0].startsWith('M12 20V'), 'fast rise is a vertical arrow');
  assert.ok(ICONS.trend_falling_fast.d[0].startsWith('M12 4v'), 'fast fall is a vertical arrow');
  assert.ok(ICONS.trend_rising.d[0] === 'M6 18L18 6', 'moderate rise is diagonal');
  assert.ok(ICONS.trend_falling.d[0] === 'M6 6l12 12', 'moderate fall is diagonal');
});

test('status chip needs the parents range; urgent low and very high use the reporting bands', () => {
  assert.equal(glucoseStatus(50, null, null), null);
  assert.equal(glucoseStatus(50, 70, 180), 'urgent_low');
  assert.equal(glucoseStatus(65, 70, 180), 'low');
  assert.equal(glucoseStatus(120, 70, 180), 'in_range');
  assert.equal(glucoseStatus(200, 70, 180), 'high');
  assert.equal(glucoseStatus(300, 70, 180), 'very_high');
});

console.log('releases');

test('the newest release notes are for the version being built', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  const rel = JSON.parse(readFileSync(new URL('../../releases.json', import.meta.url), 'utf8'));
  assert.equal(rel[0].version, pkg.version, 'add an entry at the top of src/releases.json');
  assert.ok(rel[0].notes.length > 0);
});

console.log(`\n${n} tests passed`);
