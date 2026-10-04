import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeLine, computeMeal, deriveLabel, labelMismatch, levelFor, targetMiss } from '../carbs';
import { blocker, candidatesOf, suggest } from '../suggest';
import { shoppingList } from '../shopping';
import { hostFor, loginProblem, redirectRegion, maskEmail, parseLluTimestamp, readingsFromGraph, sha256Hex, toReading, tooSoon } from '../../../supabase/functions/carb-glucose/lib';
import { effectiveRange, formatGlucose, glucoseAge, glucoseLevel, glucoseStatus, mergeReading, toMgdl } from '../glucose';
import { TREND_ICON, TREND_WORDS } from '../../components/Icon';
import { ICONS } from '../../icons/defs';
import { describeEvent, sleepWindow, unitsWord } from '../events';
import { buildMarks, defaultLayers, groupLabel, groupMarks, mealResponse } from '../../engine/events';
import { dayStartOf, dayTitle, dayTotals, lowEpisodes } from '../../engine/day';
import { inWindow, isNight, schoolWindow } from '../schedule';
import { daysFor, solidRuns } from '../../engine/profile';
import { seriesStats } from '../../engine/stats';
import { buildCsv } from '../export';
import { adrrBand, grid, hbgiBand, lbgiBand, riskF, variability } from '../../engine/variability';
import { findPatterns, visible } from '../../engine/patterns';
import { carbLane, cobAt, dosesFrom, insulinLane, iobAt, iobFraction, iobParamsOk } from '../../engine/iob';
import { GRID, alignCurve, assess, buildOccurrence, coverage, medianCurve, summary, windowSeries } from '../../engine/meals';
import { ackMessage, alertMessage, evaluate, profileAt, rate15, recipients, type AlertCfg, type OpenAlert } from '../../../supabase/functions/carb-glucose/alerts';
import { b64u, encryptPayload } from '../../../supabase/functions/carb-glucose/push';
import { PERIODS, delta15, freshness, gapsIn, mergeSeries, emptySeries, nearest, rateAt, runsFor, timeTicks, tickLabel, yDomain, yGrid, zoomAt } from '../../engine/series';
import { findDuplicate, gmi, hoursOfDay, kuwaitDayStart, sinceText, statusSentence } from '../now';
import { DEFAULT_SETTINGS, type HistoryEntry, type Ingredient, type Product, type Recipe, type Settings } from '../types';

let n = 0;
const pending: Promise<void>[] = [];
const test = (name: string, fn: () => void | Promise<void>) => {
  const r = fn();
  if (r instanceof Promise) pending.push(r.then(() => { n++; console.log('  ok', name); }));
  else { n++; console.log('  ok', name); }
};
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
  // each total on its own: bread with fat, fibre and protein but no calories on its label still gives fat, fibre and
  // protein totals, and its calories are worked out from carbs, fat and protein (4 / 9 / 4)
  const bread = prod({ kind: 'natural', carbs_per_100: 50, fat_per_100: 2, fiber_per_100: 2, protein_per_100: 10, kcal_per_100: null });
  const b = computeMeal([ing({ product_id: rice.id, quantity: 100 }), ing({ product_id: bread.id, quantity: 100 })], [rice, bread], S);
  assert.deepEqual(b.missing, { fat: false, fiber: false, protein: false, kcal: false });
  close(b.total.fat, 2.3); close(b.total.kcal, 130 + (50 * 4 + 2 * 9 + 10 * 4));
  const c = computeMeal([ing({ product_id: rice.id, quantity: 100 }), ing({ product_id: apple.id })], [rice, apple], S);
  assert.deepEqual(c.missing, { fat: true, fiber: true, protein: true, kcal: true }, 'no macros at all: nothing is worked out');
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

test('a pushed reading updates the live card without duplicates and keeps 3 hours', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  const g = { connected: true, account_hint: null, last_ok_at: null, last_error: null,
    latest: { taken_at: '2026-10-01T11:58:00.000Z', mg_dl: 100, trend: 3 },
    readings: [{ taken_at: '2026-10-01T08:30:00.000Z', mg_dl: 90, trend: null }, { taken_at: '2026-10-01T11:58:00.000Z', mg_dl: 100, trend: 3 }] };
  const m = mergeReading(g, { taken_at: '2026-10-01T11:59:00.000Z', mg_dl: 104, trend: 4 }, now);
  assert.equal(m.latest?.mg_dl, 104);
  assert.equal(m.readings.length, 2); // 08:30 is older than 3 h and drops out
  const again = mergeReading(m, { taken_at: '2026-10-01T11:59:00.000Z', mg_dl: 104, trend: 4 }, now);
  assert.equal(again.readings.length, 2); // same reading twice is one reading
});

console.log('now screen');

test('status sentence: fact first, trend second, never a number without its freshness', () => {
  assert.deepEqual(statusSentence({ hasReading: false, age: null, status: null, trend: null }), { text: 'لا توجد قراءة حديثة', tone: 'warn' });
  assert.equal(statusSentence({ hasReading: true, age: 'stale', status: 'in_range', trend: 3 }).text, 'لا توجد قراءة حديثة');
  assert.equal(statusSentence({ hasReading: true, age: 'old', status: 'low', trend: 2 }).tone, 'warn');
  assert.equal(statusSentence({ hasReading: true, age: 'fresh', status: 'in_range', trend: 3 }).text, 'مستقر ضمن النطاق');
  assert.equal(statusSentence({ hasReading: true, age: 'fresh', status: 'in_range', trend: 1 }).text, 'ضمن النطاق ونازل بسرعة');
  assert.deepEqual(statusSentence({ hasReading: true, age: 'fresh', status: 'low', trend: 2 }), { text: 'منخفض ونازل', tone: 'low' });
  assert.equal(statusSentence({ hasReading: true, age: 'fresh', status: 'urgent_low', trend: 1 }).tone, 'urgent');
  assert.equal(statusSentence({ hasReading: true, age: 'fresh', status: 'very_high', trend: 5 }).text, 'مرتفع جدًا وصاعد بسرعة');
  assert.equal(statusSentence({ hasReading: true, age: 'fresh', status: null, trend: 4 }).text, 'السكر صاعد'); // no range set
});

test('time since, Kuwait day start, hours per day, GMI', () => {
  const now = Date.parse('2026-10-01T12:00:00Z');
  assert.equal(sinceText('2026-10-01T11:59:40Z', now), 'الآن');
  assert.equal(sinceText('2026-10-01T11:35:00Z', now), 'قبل 25 د');
  assert.equal(sinceText('2026-10-01T10:40:00Z', now), 'قبل 1:20');
  assert.equal(kuwaitDayStart(new Date('2026-10-01T12:00:00Z')).toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(kuwaitDayStart(new Date('2026-10-01T22:30:00Z')).toISOString(), '2026-10-01T21:00:00.000Z'); // 01:30 Kuwait next day
  assert.equal(hoursOfDay(82), '19 س 41 د');
  assert.equal(gmi(154), 7); // 3.31 + 0.02392*154 = 6.99
});

test('duplicate guard: same dose within 10 minutes is flagged, different dose or later time is not', () => {
  const ev = (o: any) => ({ id: 'x', client_id: 'c', kind: 'insulin', occurred_at: '2026-10-01T12:00:00Z', insulin_units: 4, insulin_type: 'rapid',
    bolus_purpose: null, carbs_g: null, treatment: null, note: null, created_by: 'u', deleted_at: null, ...o });
  const list = [ev({}), ev({ id: 'c1', kind: 'carbs', insulin_units: null, insulin_type: null, carbs_g: 30 })];
  assert.equal(findDuplicate(list, { kind: 'insulin', occurred_at: '2026-10-01T12:06:00Z', insulin_units: 4, insulin_type: 'rapid', carbs_g: null })?.id, 'x');
  assert.equal(findDuplicate(list, { kind: 'insulin', occurred_at: '2026-10-01T12:06:00Z', insulin_units: 3, insulin_type: 'rapid', carbs_g: null }), null);
  assert.equal(findDuplicate(list, { kind: 'insulin', occurred_at: '2026-10-01T12:20:00Z', insulin_units: 4, insulin_type: 'rapid', carbs_g: null }), null);
  assert.equal(findDuplicate(list, { kind: 'carbs', occurred_at: '2026-10-01T12:05:00Z', insulin_units: null, insulin_type: null, carbs_g: 32 })?.id, 'c1');
  assert.equal(findDuplicate([ev({ deleted_at: '2026-10-01T12:01:00Z' })], { kind: 'insulin', occurred_at: '2026-10-01T12:02:00Z', insulin_units: 4, insulin_type: 'rapid', carbs_g: null }), null);
});

test('insulin units read correctly in Arabic', () => {
  assert.equal(unitsWord(1), 'وحدة'); assert.equal(unitsWord(2), 'وحدتان'); assert.equal(unitsWord(4), 'وحدات');
  assert.equal(unitsWord(10), 'وحدات'); assert.equal(unitsWord(12), 'وحدة'); assert.equal(unitsWord(2.5), 'وحدة');
});

console.log('alerts');

const CFG: AlertCfg = { urgentLow: 55, low: 70, high: 250, lowDelay: 5, highDelay: 30, noDataMin: 20, renotify: 10, highRenotify: 60, escalateMin: 30 };
const T0 = Date.parse('2026-10-01T12:00:00Z');
const at = (min: number) => T0 + min * 60000;
const rd = (min: number, mg: number) => ({ taken_at: new Date(at(min)).toISOString(), mg_dl: mg, trend: 2 });
const open = (o: Partial<OpenAlert>): OpenAlert => ({ id: 'a', kind: 'low', state: 'active', started_at: new Date(T0).toISOString(), active_at: new Date(T0).toISOString(),
  last_notified_at: new Date(T0).toISOString(), snoozed_until: null, clear_since: null, value_mgdl: 65, worst_mgdl: 65, ...o });

test('low waits its delay, then notifies once; a brief dip that recovers never notifies', () => {
  let s = evaluate(at(0), [rd(0, 66)], CFG, [], true);
  assert.deepEqual(s.map((x) => [x.kind, x.op, x.patch.state, x.notify]), [['low', 'create', 'pending', undefined]]);
  s = evaluate(at(3), [rd(3, 64)], CFG, [open({ state: 'pending', active_at: null, last_notified_at: null })], true);
  assert.equal(s[0].op, 'update'); assert.equal(s[0].notify, undefined); assert.equal(s[0].patch.worst_mgdl, 64);
  s = evaluate(at(5), [rd(5, 64)], CFG, [open({ state: 'pending', active_at: null, last_notified_at: null })], true);
  assert.equal(s[0].patch.state, 'active'); assert.equal(s[0].notify, 'alert');
  s = evaluate(at(3), [rd(3, 75)], CFG, [open({ state: 'pending' })], true);
  assert.equal(s[0].op, 'delete');
});

test('low expected: a steady fall heading below the low limit warns ahead of time; not once she is low', () => {
  const cfg: AlertCfg = { ...CFG, predictLowMin: 20 };
  const fall = (end: number, from: number) => Array.from({ length: 15 }, (_, i) => rd(end - 14 + i, from - 2 * i)); // 2 mg/dL a minute down
  let s = evaluate(at(14), fall(14, 128), cfg, [], true);                     // now 100, heading to ~60 in 20 min
  assert.deepEqual(s.map((x) => [x.kind, x.patch.state]), [['predicted_low', 'pending']]);
  const pend = { ...open({ state: 'pending', active_at: null, last_notified_at: null }), kind: 'predicted_low' as const, id: 'p' };
  s = evaluate(at(16), fall(16, 128), cfg, [pend], true);                     // still heading low 2 min later: told once
  assert.equal(s.find((x) => x.kind === 'predicted_low')!.notify, 'alert');
  s = evaluate(at(14), fall(14, 96), cfg, [], true);                          // already 68, below the limit: the low alert's job
  assert.equal(s.find((x) => x.kind === 'predicted_low'), undefined);
  assert.ok(s.find((x) => x.kind === 'low'));
  s = evaluate(at(14), Array.from({ length: 15 }, (_, i) => rd(i, 140)), cfg, [], true);
  assert.equal(s.length, 0, 'steady: nothing');
  assert.equal(evaluate(at(14), fall(14, 128), CFG, [], true).length, 0, 'off unless set');
});

test('fast fall and fast rise have their own thresholds', () => {
  const cfg: AlertCfg = { ...CFG, fallRate: 1.8, riseRate: null };
  const line = (slope: number) => Array.from({ length: 15 }, (_, i) => rd(i, 150 + slope * i));
  assert.deepEqual(evaluate(at(14), line(-2), cfg, [], true).filter((x) => x.kind.startsWith('rapid')).map((x) => x.kind), ['rapid_fall']);
  assert.deepEqual(evaluate(at(14), line(2), cfg, [], true).filter((x) => x.kind.startsWith('rapid')).map((x) => x.kind), [], 'rise off');
  assert.deepEqual(evaluate(at(14), line(2), { ...CFG, rapidRate: 1.8 }, [], true).filter((x) => x.kind.startsWith('rapid')).map((x) => x.kind), ['rapid_rise'], 'the older shared setting still works');
});

test('urgent low notifies at once; the plain low stays quiet while it sounds', () => {
  const s = evaluate(at(0), [rd(0, 50)], CFG, [], true);
  assert.deepEqual(s.map((x) => [x.kind, x.patch.state, x.notify]), [['urgent_low', 'active', 'alert'], ['low', 'pending', undefined]]);
  const s2 = evaluate(at(10), [rd(10, 50)], CFG, [open({ kind: 'urgent_low', id: 'u', last_notified_at: new Date(at(9)).toISOString() }), open({ id: 'l', last_notified_at: null, active_at: null, state: 'pending' })], true);
  assert.equal(s2.find((x) => x.kind === 'low')!.patch.state, 'active');
  assert.equal(s2.find((x) => x.kind === 'low')!.notify, undefined);
});

test('repeats only while the condition holds, and resolves only after holding clear (hysteresis)', () => {
  assert.equal(evaluate(at(10), [rd(10, 66)], CFG, [open({})], true)[0].notify, 'repeat');
  assert.equal(evaluate(at(10), [rd(10, 75)], CFG, [open({})], true)[0].notify, undefined); // between 70 and 80: no repeat, not resolved
  let s = evaluate(at(20), [rd(20, 85)], CFG, [open({})], true);
  assert.equal(s[0].op, 'update'); assert.equal(s[0].patch.clear_since, new Date(at(20)).toISOString());
  s = evaluate(at(35), [rd(35, 90)], CFG, [open({ clear_since: new Date(at(20)).toISOString() })], true);
  assert.equal(s[0].op, 'resolve'); assert.equal(s[0].notify, 'resolved');
  s = evaluate(at(30), [rd(30, 72)], CFG, [open({ clear_since: new Date(at(20)).toISOString() })], true);
  assert.equal(s[0].patch.clear_since, null); // dipped back: the clock restarts
});

test('"I am on it" silences until the snooze ends, then repeats if still low', () => {
  const ack = open({ state: 'acknowledged', snoozed_until: new Date(at(15)).toISOString() });
  assert.equal(evaluate(at(12), [rd(12, 62)], CFG, [ack], true)[0].notify, undefined);
  const s = evaluate(at(15), [rd(15, 62)], CFG, [ack], true)[0];
  assert.equal(s.notify, 'repeat'); assert.equal(s.patch.state, 'active');
});

test('a stale reading neither raises nor clears; no data alerts after the set minutes and only with a CGM', () => {
  assert.equal(evaluate(at(30), [rd(10, 60)], CFG, [], true).filter((x) => x.kind !== 'no_data').length, 0);
  const held = evaluate(at(25), [rd(5, 90)], CFG, [open({})], true).find((x) => x.kind === 'low')!;
  assert.equal(held.op, 'update'); assert.equal(held.patch.clear_since, null);
  assert.equal(evaluate(at(25), [rd(4, 100)], CFG, [], true)[0].kind, 'no_data');
  assert.equal(evaluate(at(19), [rd(0, 100)], CFG, [], true).length, 0);
  assert.equal(evaluate(at(25), [rd(4, 100)], CFG, [], false).length, 0);
  const back = evaluate(at(26), [rd(26, 100)], CFG, [open({ kind: 'no_data' })], true);
  assert.equal(back[0].op, 'resolve'); assert.equal(back[0].notify, 'resolved');
});

test('an alert with no threshold is off, and an open one closes silently', () => {
  const off = { ...CFG, low: null, urgentLow: null };
  assert.equal(evaluate(at(0), [rd(0, 40)], off, [], true).length, 0);
  const s = evaluate(at(0), [rd(0, 40)], off, [open({})], true);
  assert.equal(s[0].op, 'resolve'); assert.equal(s[0].notify, undefined);
});


test('profiles: night and school windows in Kuwait time change the thresholds; night can silence highs', () => {
  const cfg: AlertCfg = { ...CFG, night: { start: '21:00', end: '06:30', low: 90, high: 300, highSilent: true }, school: { days: [0, 1, 2, 3, 4], start: '07:00', end: '14:00', low: 80, high: null } };
  const kt = (iso: string) => Date.parse(iso) - 3 * 3600000; // Kuwait local → UTC
  assert.equal(profileAt(kt('2026-10-01T23:30:00Z'), cfg), 'night');   // Thursday 23:30
  assert.equal(profileAt(kt('2026-10-01T05:00:00Z'), cfg), 'night');   // 05:00 wraps midnight
  assert.equal(profileAt(kt('2026-10-01T09:00:00Z'), cfg), 'school');  // Thursday is a school day
  assert.equal(profileAt(kt('2026-10-02T09:00:00Z'), cfg), 'day');     // Friday is not
  const n = kt('2026-10-01T23:30:00Z');
  const lowAtNight = evaluate(n, [{ taken_at: new Date(n - 60000).toISOString(), mg_dl: 85, trend: 3 }], cfg, [], true);
  assert.equal(lowAtNight[0].kind, 'low'); assert.equal(lowAtNight[0].patch.profile, 'night'); // 85 is low under the night threshold of 90
  const highAtNight = evaluate(n, [{ taken_at: new Date(n - 60000).toISOString(), mg_dl: 320, trend: 3 }], { ...cfg, highDelay: 0 }, [], true);
  assert.equal(highAtNight[0].kind, 'high'); assert.equal(highAtNight[0].silent, true);
});

test('the server rate leaves out Libre history points beside minute readings, like the app', () => {
  const r = (m: number, v: number, trend: number | null) => ({ taken_at: new Date(at(m)).toISOString(), mg_dl: v, trend });
  const minute = [r(0, 150, 2), r(3, 144, 2), r(6, 138, 2), r(9, 132, 2), r(12, 126, 2)];
  assert.equal(Math.round(rate15(minute)! * 10) / 10, -2);
  assert.equal(Math.round(rate15([...minute.slice(0, 4), r(10, 150, null), minute[4]])! * 10) / 10, -2, 'the odd history point at 10 min is ignored');
});

test('low expected looks ahead with a fading trend: a slow fall far above the limit does not warn', () => {
  const cfg: AlertCfg = { ...CFG, predictLowMin: 20 };
  const slow = Array.from({ length: 15 }, (_, i) => rd(i, 112 - i)); // 1 mg/dL a minute down, now 98
  assert.equal(evaluate(at(14), slow, cfg, [], true).find((x) => x.kind === 'predicted_low'), undefined, 'a straight line said 78 in 20 min; fading, she levels near 88');
  const near = Array.from({ length: 15 }, (_, i) => rd(i, 102 - i)); // now 88
  assert.ok(evaluate(at(14), near, cfg, [], true).find((x) => x.kind === 'predicted_low'), 'close to the limit and falling: warns');
});

test('rapid fall: a sustained slope beyond the set rate, never from a single jump or across a gap', () => {
  const pts = (vals: number[], step = 5) => vals.map((v, k) => ({ taken_at: new Date(at(k * step)).toISOString(), mg_dl: v, trend: null }));
  assert.equal(Math.round(rate15(pts([180, 165, 150, 135])) ?? 0), -3);
  assert.equal(rate15(pts([180, 120])), null);                                 // two points are not a trend
  const cfg = { ...CFG, rapidRate: 2.5 };
  const s1 = evaluate(at(15), pts([180, 165, 150, 135]), cfg, [], true).filter((x) => x.kind === 'rapid_fall');
  assert.equal(s1[0].op, 'create'); assert.equal(s1[0].patch.state, 'pending');
  const gapped = [...pts([180, 165]), { taken_at: new Date(at(40)).toISOString(), mg_dl: 120, trend: null }, { taken_at: new Date(at(45)).toISOString(), mg_dl: 118, trend: null }];
  assert.equal(rate15(gapped), null);
});

test('escalation: nobody answers within the set minutes, the backup parent is told once', () => {
  const cfg = { ...CFG, escalateMin: 10 };
  const s = evaluate(at(10), [rd(10, 64)], cfg, [open({})], true)[0];
  assert.equal(s.notify, 'escalate'); assert.ok(s.patch.escalated_at);
  assert.equal(evaluate(at(12), [rd(12, 64)], cfg, [open({ escalated_at: new Date(at(10)).toISOString(), last_notified_at: new Date(at(10)).toISOString() })], true)[0].notify, undefined);
  assert.equal(evaluate(at(10), [rd(10, 64)], cfg, [open({ state: 'acknowledged', snoozed_until: new Date(at(25)).toISOString() })], true)[0].notify, undefined);
  const fam = [{ user_id: 'mum', alert_role: 'primary' }, { user_id: 'dad', alert_role: 'backup' }, { user_id: 'gran', alert_role: 'off' }];
  assert.deepEqual(recipients(fam, 'alert'), ['mum']); assert.deepEqual(recipients(fam, 'escalate'), ['mum', 'dad']);
  assert.deepEqual(recipients([{ user_id: 'dad', alert_role: 'backup' }], 'alert'), ['dad']); // no primary: nobody is left out
});

test('push wording: what is happening first, then glucose now, then what it means; no names, source or doses', () => {
  const I = (x: string) => `\u2066${x}\u2069`;
  const pl = alertMessage('predicted_low', 'alert', { value: 94, trend: 3, unit: 'mmol', minutes: 0, low: 70, rate: -1.2, ahead: 20 });
  assert.equal(pl.title, '🟠 انخفاض متوقع خلال 20 دقيقة');
  assert.equal(pl.body, `الآن ${I('5.2 →')} ملمول/ل\nقد ينزل تحت ${I('3.9')}`);
  assert.equal(pl.urgency, 'high');
  const ul = alertMessage('urgent_low', 'alert', { value: 50, trend: 1, unit: 'mmol', minutes: 0 });
  assert.equal(ul.title, '🔴 منخفض جدًا · عالجوا الآن'); assert.equal(ul.body, `الآن ${I('2.8 ↓')} ملمول/ل`); assert.equal(ul.severity, 'urgent');
  const lo = alertMessage('low', 'repeat', { value: 63, trend: 2, unit: 'mmol', minutes: 34 });
  assert.equal(lo.title, '🟠 ما زال منخفضًا'); assert.equal(lo.body, `الآن ${I('3.5 ↘')} ملمول/ل\nمنذ 34 دقيقة`);
  assert.equal(alertMessage('high', 'alert', { value: 250, trend: 4, unit: 'mgdl', minutes: 75 }).title, '🟠 مرتفع منذ ساعة و15 دقيقة');
  assert.equal(alertMessage('rapid_rise', 'alert', { value: 160, trend: 5, unit: 'mgdl', minutes: 2 }).urgency, 'normal');
  assert.equal(alertMessage('no_data', 'alert', { value: null, trend: null, unit: 'mgdl', minutes: 21 }).title, '🟠 لا توجد قراءة منذ 21 دقيقة');
  assert.equal(alertMessage('low', 'resolved', { value: 90, trend: 4, unit: 'mgdl', minutes: 30 }).title, '✅ انتهى الانخفاض');
  // the time to the low limit follows the fading trend: from 90 at −3 a minute it gets there in about 12 minutes; from 130 it levels off first
  const rf = alertMessage('rapid_fall', 'alert', { value: 90, trend: 1, unit: 'mgdl', minutes: 2, low: 70, rate: -3 });
  assert.equal(rf.body, `الآن ${I('90 ↓')} ملغ/دل\nقد ينزل تحت ${I('70')} خلال 12 دقيقة`);
  assert.equal(alertMessage('rapid_fall', 'alert', { value: 130, trend: 1, unit: 'mgdl', minutes: 2, low: 70, rate: -3 }).body, `الآن ${I('130 ↓')} ملغ/دل`);
  for (const k of ['urgent_low', 'low', 'predicted_low', 'high', 'no_data', 'rapid_fall', 'rapid_rise'] as const) for (const n of ['alert', 'repeat', 'resolved', 'escalate'] as const) {
    const m = alertMessage(k, n, { value: 60, trend: 1, unit: 'mgdl', minutes: 3, low: 70, rate: -2 });
    const t = m.title + '\n' + m.body;
    assert.ok(!/ليان|خطة الطبيب|وحد|غرام|جرام|أعط|اعط|جرعة|[A-Za-z]/.test(t), t);
    assert.ok(/^[🔴🟠🔵✅]/u.test(m.title), m.title);
    assert.ok(m.body.split('\n').length <= 2, m.body);
  }
});

test('push wording in English: same layout, no Arabic, no doses', () => {
  const m = alertMessage('predicted_low', 'alert', { value: 94, trend: null, unit: 'mmol', minutes: 0, low: 70, rate: -1.2 }, 'en');
  assert.equal(m.title, '🟠 Low expected in 30 min'); // levels off near the limit: the look-ahead, not a made-up time
  assert.equal(m.body, 'Now \u20665.2 ↘\u2069 mmol/L\nMay drop below \u20663.9\u2069');
  assert.equal(alertMessage('no_data', 'escalate', { value: null, trend: null, unit: 'mgdl', minutes: 21 }, 'en').title, '🔴 No one answered · no reading for 21 min');
  assert.equal(ackMessage('urgent_low', null, 'treated', 'en').title, '✅ A parent treated it');
  for (const k of ['urgent_low', 'low', 'predicted_low', 'high', 'no_data', 'rapid_fall', 'rapid_rise'] as const) for (const n of ['alert', 'repeat', 'resolved', 'escalate'] as const) {
    const t = Object.values(alertMessage(k, n, { value: 60, trend: 1, unit: 'mgdl', minutes: 3, low: 70, rate: -2 }, 'en')).join(' ');
    assert.ok(!/[\u0600-\u06FF]|Layan|unit|gram|give|dose|take /i.test(t), t);
  }
});

test('push payload encryption matches RFC 8291 appendix A', async () => {
  const out = await encryptPayload(new TextEncoder().encode('When I grow up, I want to be a watermelon'),
    b64u.dec('BCVxsr7N_eNgVRqvHtD0zTZsEc6-VV-JvLexhqUzORcxaOzi6-AYWXvTBHm4bjyPjs7Vd8pZGH6SRpkNtoIAiw4'), b64u.dec('BTBZMqHH6r4Tts7J_aSIgg'),
    { salt: b64u.dec('DGv6ra1nlYgDCS1FRnbzlw'), asPublic: b64u.dec('BP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A8'), asPrivate: b64u.dec('yfWPiYE-n46HLnH0KqZOF1fJJU3MYrct3AELtAQ-oRw') });
  assert.equal(b64u.enc(out), 'DGv6ra1nlYgDCS1FRnbzlwAAEABBBP4z9KsN6nGRTbVYI_c7VJSPQTBtkgcy27mlmlMoZIIgDll6e3vCYLocInmYWAmS6TlzAC8wEqKK6PBru3jl7A_yl95bQpu6cVPTpK4Mqgkf1CXztLVBSt2Ks3oZwbuwXPXLWyouBWLVWGNWQexSgSxsj_Qulcy4a-fN');
});

console.log('timeline engine');

// 90 days of 1-minute readings: a gentle wave, one 52 mg/dL (2.9 mmol/L) reading, and a 27-minute gap
const DAY = 86400000, M = 60000, END = Date.parse('2026-10-01T12:00:00Z'), START = END - 90 * DAY;
const fx = (() => {
  const t: number[] = [], v: number[] = [];
  for (let x = START; x <= END; x += M) {
    if (x > END - 2 * DAY && x < END - 2 * DAY + 27 * M) continue; // the gap
    t.push(x); v.push(Math.round(130 + 40 * Math.sin(x / (3 * 3600000))));
  }
  const k = Math.floor(t.length * 0.37); v[k] = 52;
  return { s: mergeSeries(emptySeries(), t, v), lowAt: t[k] };
})();

test('a single low reading survives min-max decimation at every zoom and every pan position', () => {
  for (const p of PERIODS) for (const frac of [0.05, 0.5, 0.95]) {
    const end = fx.lowAt + p.ms * frac, start = end - p.ms;
    const runs = runsFor(fx.s, start, end, 390);
    assert.ok(runs.some((r) => r.v.includes(52)), `${p.id} at ${frac}`);
    const pts = runs.reduce((n, r) => n + r.x.length, 0);
    assert.ok(pts <= 2 * 390 + 2 * runs.length + 4, `${p.id}: ${pts} points drawn for 390 px`);
  }
});

test('decimation never invents a value or joins across a gap', () => {
  const gapStart = END - 2 * DAY;
  const runs = runsFor(fx.s, gapStart - 3 * 3600000, gapStart + 3 * 3600000, 390);
  assert.equal(runs.length, 2);
  const all = new Set(Array.from(fx.s.v));
  for (const r of runsFor(fx.s, END - 30 * DAY, END, 390)) for (const v of r.v) assert.ok(all.has(v));
});

test('a 27-minute gap is found with its length; the open gap after the last reading counts too', () => {
  const gapStart = END - 2 * DAY;
  const gaps = gapsIn(fx.s, gapStart - 3600000, gapStart + 3600000, END);
  assert.equal(gaps.length, 1); assert.equal(gaps[0].minutes, 27); assert.equal(gaps[0].open, false);
  const open = gapsIn(fx.s, END - 3600000, END + 30 * M, END + 30 * M);
  const last = open[open.length - 1]; assert.equal(last.open, true); assert.equal(last.minutes, 30);
  assert.equal(gapsIn(fx.s, END - 3600000, END, END + 10 * M).length, 0);
});

test('decimating 90 days for one frame is fast enough for 60 fps', () => {
  const t0 = performance.now();
  for (let k = 0; k < 20; k++) runsFor(fx.s, END - 90 * DAY + k * DAY, END, 390);
  const per = (performance.now() - t0) / 20;
  assert.ok(per < 8, `${per.toFixed(2)} ms per frame`);
});

test('merging keeps order, replaces the same instant, and handles unsorted batches', () => {
  const a = mergeSeries(emptySeries(), [10, 20, 30], [1, 2, 3]);
  const b = mergeSeries(a, [25, 20, 5], [9, 8, 7]);
  assert.deepEqual(Array.from(b.t), [5, 10, 20, 25, 30]); assert.deepEqual(Array.from(b.v), [7, 1, 8, 9, 3]);
  // timing: warm up, then the best of three, so a busy machine does not fail the check
  mergeSeries(fx.s, [END + M], [100]);
  const best = Math.min(...[0, 1, 2].map(() => { const t0 = performance.now(); mergeSeries(fx.s, [END + M], [100]); return performance.now() - t0; }));
  assert.ok(best < 30, `${best.toFixed(1)} ms`);
});

test('inspector values: nearest reading, 15-minute change, rate, freshness', () => {
  const s = mergeSeries(emptySeries(), [0, 5, 10, 15].map((m) => END + m * M), [100, 95, 90, 85]);
  assert.equal(nearest(s, END + 6 * M), 1);
  assert.equal(nearest(s, END + 40 * M), null);
  assert.equal(delta15(s, 3), -15);
  assert.equal(Math.round(rateAt(s, 3)! * 100) / 100, -1);
  assert.equal(freshness(END, END + 4 * M), 'live'); assert.equal(freshness(END, END + 12 * M), 'delayed'); assert.equal(freshness(END, END + 16 * M), 'missing');
  const gapped = mergeSeries(emptySeries(), [0, 30, 35, 40].map((m) => END + m * M), [100, 95, 90, 85]);
  assert.equal(delta15(gapped, 3), null); // the 15-minute point would sit across the gap
});

test('zoom keeps the time under the fingers fixed; ticks follow Kuwait time', () => {
  const v = { end: END, span: 6 * 3600000 };
  const z = zoomAt(v, 0.5, 0.25);
  const at = (w: typeof v, f: number) => w.end - w.span * (1 - f);
  assert.equal(at(z, 0.25), at(v, 0.25)); assert.equal(z.span, 3 * 3600000);
  assert.equal(zoomAt(v, 1e-6, 0.5).span, 30 * M); // never closer than 30 minutes
  const { step, ticks } = timeTicks(END - 6 * 3600000, END, 390);
  assert.equal(step, 3600000); assert.equal(tickLabel(ticks[0], step).length, 5);
  assert.equal(tickLabel(Date.parse('2026-10-01T21:00:00Z'), 3600000), '2/10'); // midnight in Kuwait shows the date
});

console.log('event rail');

const evr = (o: any) => ({ id: o.id ?? 'x', client_id: 'c', kind: 'insulin', occurred_at: '2026-10-01T12:00:00Z', insulin_units: null, insulin_type: null, bolus_purpose: null,
  carbs_g: null, treatment: null, note: null, created_by: 'u', deleted_at: null, ...o });
const meal = (o: any) => ({ id: 'm1', kind: 'meal', recipe_id: null, name: 'مجبوس دجاج', category: null, eaten_at: '2026-10-01T12:05:00Z', total_carbs: 45,
  total_fat: null, total_fiber: null, total_protein: null, total_kcal: null, modified: false, glucose_mgdl: null, glucose_trend: null, glucose_at: null, lines: [], notes: null, ...o });

test('every logged thing becomes a marker at its exact minute, on its own layer', () => {
  const marks = buildMarks([meal({})] as any, [
    evr({ id: 'i1', insulin_units: 3, insulin_type: 'rapid', bolus_purpose: 'meal', occurred_at: '2026-10-01T11:53:00Z' }),
    evr({ id: 'b1', insulin_units: 12, insulin_type: 'long', occurred_at: '2026-10-01T20:00:00Z' }),
    evr({ id: 't1', kind: 'treatment', carbs_g: 15, occurred_at: '2026-10-01T15:00:00Z' }),
    evr({ id: 'x1', kind: 'exercise', activity_min: 35, occurred_at: '2026-10-01T16:20:00Z' }),
    evr({ id: 'd1', kind: 'note', note: 'x', deleted_at: '2026-10-01T16:00:00Z' }),
  ]);
  assert.deepEqual(marks.map((m) => [m.kind, m.layer, new Date(m.t).toISOString().slice(11, 16)]),
    [['insulin', 'insulin', '11:53'], ['meal', 'meals', '12:05'], ['treatment', 'treatment', '15:00'], ['exercise', 'exercise', '16:20'], ['basal', 'basal', '20:00']]);
  assert.equal(marks[3].end! - marks[3].t, 35 * 60000);
});

test('markers that would collide group into one chip; hidden layers are skipped', () => {
  const marks = buildMarks([meal({})] as any, [evr({ id: 'i1', insulin_units: 3, insulin_type: 'rapid', occurred_at: '2026-10-01T11:58:00Z' }),
    evr({ id: 't1', kind: 'treatment', carbs_g: 15, occurred_at: '2026-10-01T15:00:00Z' }), evr({ id: 'b1', insulin_units: 12, insulin_type: 'long', occurred_at: '2026-10-01T13:00:00Z' })]);
  const start = Date.parse('2026-10-01T10:00:00Z'), end = Date.parse('2026-10-01T16:00:00Z');
  const groups = groupMarks(marks, defaultLayers(), start, end, 390);
  assert.equal(groups.length, 2); // basal is off by default
  assert.equal(groupLabel(groups[0]), '45 غ + 3 و'); assert.equal(groups[0].marks.length, 2);
  assert.equal(groupLabel(groups[1]), 'علاج 15 غ');
  assert.equal(groupMarks(marks, defaultLayers(), start, end, 4000).length, 3); // zoomed in: they separate
});

test('meal response on a fixture meal matches section 10.7', () => {
  // meal 12:05, readings every 5 min: 110 at the meal, rising 2/min to a peak of 170 at +30, then down 1/min
  const t0 = Date.parse('2026-10-01T12:05:00Z');
  const ts: number[] = [], vs: number[] = [];
  for (let m = -30; m <= 250; m += 5) { ts.push(t0 + m * M); vs.push(m <= 0 ? 110 : m <= 30 ? 110 + 2 * m : 170 - (m - 30)); }
  const ser = mergeSeries(emptySeries(), ts, vs);
  const bolus = evr({ id: 'i1', insulin_units: 3, insulin_type: 'rapid', bolus_purpose: 'meal', occurred_at: '2026-10-01T11:53:00Z' });
  const r = mealResponse(ser, t0, [bolus as any], t0 + 6 * 3600000);
  assert.equal(r.g0, 110); assert.equal(r.at[30], 170); assert.equal(r.at[60], 140); assert.equal(r.at[120], 80); assert.equal(r.at[180], 20);
  assert.equal(r.peak, 170); assert.equal(r.rise, 60); assert.equal(r.ttp, 30); assert.equal(r.complete, true);
  assert.equal(r.prebolus, 12); assert.equal(r.bolus?.id, 'i1');
  // a gap after +60: later values are not reported and the response is partial
  const cut = mergeSeries(emptySeries(), ts.filter((t) => t <= t0 + 60 * M || t >= t0 + 100 * M), vs.filter((_, k) => ts[k] <= t0 + 60 * M || ts[k] >= t0 + 100 * M));
  const r2 = mealResponse(cut, t0, [], t0 + 6 * 3600000);
  assert.equal(r2.at[60], 140); assert.equal(r2.at[120], null); assert.equal(r2.complete, false); assert.equal(r2.bolus, null);
  // a correction dose is not the meal bolus
  assert.equal(mealResponse(ser, t0, [{ ...bolus, bolus_purpose: 'correction' } as any], t0 + 6 * 3600000).bolus, null);
});

test('sleep from two clock times crosses midnight; exercise and sleep read naturally', () => {
  const nowK = Date.parse('2026-10-02T04:00:00Z'); // 07:00 in Kuwait
  const w = sleepWindow('21:30', '06:45', nowK);
  assert.equal(w.occurred_at, '2026-10-01T18:30:00.000Z'); assert.equal(w.ends_at, '2026-10-02T03:45:00.000Z'); assert.equal(w.minutes, 555);
  assert.equal(sleepWindow('13:00', '15:00', nowK).ends_at, '2026-10-01T12:00:00.000Z'); // 15:00 today is later than now → yesterday
  assert.equal(describeEvent({ kind: 'exercise', activity_min: 35, activity_level: 'hard' } as any), 'رياضة 35 د · شديد');
  assert.equal(describeEvent({ kind: 'sleep', occurred_at: w.occurred_at, ends_at: w.ends_at } as any), 'نوم 9:15 س');
});

test('the reference range stands in until the parents set hers, and is marked as reference', () => {
  assert.deepEqual(effectiveRange(null, null), { low: 70, high: 180, reference: true });
  assert.deepEqual(effectiveRange(72, 160), { low: 72, high: 160, reference: false });
  assert.deepEqual(effectiveRange(80, null), { low: 80, high: null, reference: false });
  const r = effectiveRange(null, null);
  assert.equal(glucoseStatus(65, r.low, r.high), 'low'); assert.equal(glucoseStatus(120, r.low, r.high), 'in_range');
});

console.log('day view');

test('a Kuwait day runs from local midnight (21:00 UTC the day before)', () => {
  assert.equal(new Date(dayStartOf(Date.parse('2026-10-01T20:59:00Z'))).toISOString(), '2026-09-30T21:00:00.000Z');
  assert.equal(new Date(dayStartOf(Date.parse('2026-10-01T21:00:00Z'))).toISOString(), '2026-10-01T21:00:00.000Z');
  const d = dayStartOf(Date.parse('2026-10-01T10:00:00Z'));
  assert.equal(dayTitle(d, Date.parse('2026-10-01T10:00:00Z')), 'اليوم · الخميس 1 أكتوبر');
  assert.equal(dayTitle(d - 86400000, Date.parse('2026-10-01T10:00:00Z')), 'أمس · الأربعاء 30 سبتمبر');
  assert.equal(dayTitle(d - 3 * 86400000, Date.parse('2026-10-01T10:00:00Z')), 'الاثنين · 28 سبتمبر');
});

test('low episodes: at least 10 minutes below the line, split by gaps, with their lowest value', () => {
  const t0 = Date.parse('2026-10-01T06:00:00Z');
  const vals = [90, 68, 64, 60, 62, 66, 75, 69, 90, 67, 66, 65]; // 5-min steps: 10:00 low run of 25 min, a 5-min blip, then a run cut by a gap
  const times = vals.map((_, k) => t0 + k * 5 * M);
  times[10] += 30 * M; times[11] += 30 * M; // gap before the last two
  const ser = mergeSeries(emptySeries(), times, vals);
  const eps = lowEpisodes(ser, t0, t0 + 3 * 3600000, 70);
  assert.equal(eps.length, 1);
  assert.equal(eps[0].t, t0 + 5 * M); assert.equal(eps[0].nadir, 60); assert.equal(eps[0].minutes, 20);
  assert.equal(lowEpisodes(ser, t0, t0 + 3 * 3600000, 70, 5).length, 2); // the 35-40 min pair counts at 5 min, the blip never
});

test('day totals separate meal carbs, hypo treatment, rapid and long insulin, and skip deleted entries', () => {
  const start = Date.parse('2026-09-30T21:00:00Z'), end = start + 86400000;
  const hist = [meal({ eaten_at: '2026-10-01T04:15:00Z', total_carbs: 42 }), meal({ id: 'm2', eaten_at: '2026-10-01T10:05:00Z', total_carbs: 48 }),
    meal({ id: 'm3', eaten_at: '2026-09-30T20:00:00Z', total_carbs: 30 })];
  const evs = [evr({ insulin_units: 3, insulin_type: 'rapid', occurred_at: '2026-10-01T04:05:00Z' }), evr({ id: 'b', insulin_units: 12, insulin_type: 'long', occurred_at: '2026-10-01T17:00:00Z' }),
    evr({ id: 't', kind: 'treatment', carbs_g: 15, occurred_at: '2026-10-01T07:36:00Z' }), evr({ id: 'c', kind: 'carbs', carbs_g: 10, occurred_at: '2026-10-01T12:00:00Z' }),
    evr({ id: 'd', insulin_units: 2, insulin_type: 'rapid', occurred_at: '2026-10-01T12:00:00Z', deleted_at: '2026-10-01T12:01:00Z' })];
  assert.deepEqual(dayTotals(hist as any, evs as any, start, end), { carbs: 100, treatment: 15, rapid: 3, long: 12, meals: 2 });
});

test('night and school windows on the phone match the server (Kuwait time, overnight wrap)', () => {
  assert.equal(inWindow(23 * 60, '21:00', '06:30'), true); assert.equal(inWindow(7 * 60, '21:00', '06:30'), false);
  assert.equal(isNight({ night_start: '21:00:00', night_end: '06:30:00' }, Date.parse('2026-10-01T20:00:00Z')), true); // 23:00 Kuwait
  assert.equal(isNight({ night_start: null, night_end: null }, Date.parse('2026-10-01T20:00:00Z')), false);
  const w = schoolWindow({ school_days: [0, 1, 2, 3, 4], school_start: '07:00:00', school_end: '14:00:00' }, Date.parse('2026-10-01T10:00:00Z'))!;
  assert.equal(new Date(w.from).toISOString(), '2026-10-01T04:00:00.000Z'); assert.equal(new Date(w.to).toISOString(), '2026-10-01T11:00:00.000Z');
  assert.equal(schoolWindow({ school_days: [0, 1, 2, 3, 4], school_start: '07:00', school_end: '14:00' }, Date.parse('2026-10-02T10:00:00Z')), null); // Friday
});

test('patterns: day filters and bins with too few days', () => {
  assert.equal(daysFor('all', [0, 1, 2, 3, 4], []), null);
  assert.deepEqual(daysFor('weekend', [0, 1, 2, 3, 4], []), [5, 6]);
  assert.deepEqual(daysFor('school', [], []), [0, 1, 2, 3, 4]);
  assert.deepEqual(daysFor('custom', [], [2, 4]), [2, 4]);
  const b = (bin: number, days: number) => ({ bin, days, n: days, p10: 0, p25: 0, p50: 0, p75: 0, p90: 0 });
  const runs = solidRuns([b(0, 6), b(1, 6), b(2, 3), b(3, 7), b(5, 7)]);
  assert.deepEqual(runs.map((r) => r.map((x) => x.bin)), [[0, 1], [3], [5]]);
});

test('meal response per recipe: clean meals, aligned curves and medians', () => {
  const t0 = Date.parse('2026-10-01T10:00:00Z');
  const curve = (rise: number) => { const o: number[] = [], v: number[] = []; for (let m = -60; m <= 240; m += 5) { o.push(m); v.push(110 + (m <= 0 ? 0 : m <= 60 ? rise * m / 60 : rise * Math.max(0, 1 - (m - 60) / 150))); } return { o, v }; };
  const occ = [40, 60, 50, 200].map((rise, k) => {
    const c = curve(rise), tk = t0 + k * 86400000;
    const meal = { id: 'm' + k, kind: 'meal', recipe_id: 'r', name: 'مجبوس', eaten_at: new Date(tk).toISOString(), total_carbs: 45 } as any;
    return buildOccurrence(meal, windowSeries(tk, c.o, c.v), [meal], [], tk + 6 * 3600000);
  });
  assert.equal(coverage(occ[0].series, occ[0].t0, 180), 1);
  assert.deepEqual(occ.map((o) => o.reasons.length), [0, 0, 0, 0]);
  const s = summary(occ);
  assert.equal(s.n, 4); assert.equal(s.rise, 55); assert.ok(Math.abs(s.per10! - 55 / 4.5) < 1e-9); assert.equal(s.ttp, 60); assert.equal(s.g0, 110); // the 200 outlier moves the median only a little
  const mc = medianCurve(occ.map((o) => o.curve));
  assert.equal(mc[GRID.indexOf(60)]!.p50, 110 + 55);
  assert.equal(alignCurve(windowSeries(t0, [0, 100], [100, 120]), t0)[GRID.indexOf(50)], null); // no reading within ±5 min of +50
  // what still counts: food after the peak cuts the curve there; food before it, a hypo treatment, too few readings do not
  const M = 60000, full = (() => { const o: number[] = [], v: number[] = []; for (let m = 0; m <= 240; m += 5) { o.push(m); v.push(120); } return windowSeries(t0, o, v); })();
  const own = new Set(['x']);
  const at = (id: string, min: number, carbs: number) => ({ id, eaten_at: new Date(t0 + min * M).toISOString(), total_carbs: carbs }) as any;
  const late = assess(t0, own, [at('y', 90, 20)], [], full);
  assert.deepEqual(late.reasons, []); assert.equal(late.until, t0 + 90 * M, 'a snack 90 min later cuts the meal there');
  assert.deepEqual(assess(t0, own, [at('y', 30, 20)], [], full).reasons, ['أكل آخر'], 'food before the peak: unusable');
  assert.deepEqual(assess(t0, own, [at('y', 20, 3)], [], full).reasons, [], 'a 3 g bite does not count');
  assert.equal(assess(t0, own, [], [], full).until, t0 + 180 * M, 'a meal is followed 3 hours');
  assert.equal(assess(t0, own, [], [], full, 'quick').until, t0 + 120 * M, 'a drink 2 hours');
  assert.deepEqual(assess(t0, own, [at('y', 45, 20)], [], full, 'quick').reasons, [], 'a drink peaks within 40 min');
  const treat = evr({ id: 't', kind: 'treatment', carbs_g: 15, occurred_at: new Date(t0 + 20 * M).toISOString() });
  assert.deepEqual(assess(t0, own, [], [treat as any], full).reasons, ['علاج انخفاض']);
  assert.deepEqual(assess(t0, own, [], [], windowSeries(t0, [0, 30], [100, 120])).reasons, ['قراءات ناقصة']);
  const cutOcc = buildOccurrence(at('x', 0, 45), full, [at('x', 0, 45), at('y', 90, 20)], [], t0 + 6 * 3600000);
  assert.equal(cutOcc.curve[GRID.indexOf(85)], 120); assert.equal(cutOcc.curve[GRID.indexOf(100)], null, 'nothing after the snack');
});

test('period stats on the phone follow carb.glucose_stats (time-weighted, 15-minute cap, weekday filter)', () => {
  const from = Date.parse('2026-09-30T21:00:00Z'); // Thursday 1 Oct, Kuwait midnight
  // one reading every 10 minutes for 2 hours: 60 min at 60, 30 min at 120, 30 min at 200; then a 40-minute gap
  const vals = [60, 60, 60, 60, 60, 60, 120, 120, 120, 200, 200, 200];
  const t = vals.map((_, k) => from + k * 10 * M);
  const ser = mergeSeries(emptySeries(), [...t, from + 160 * M], [...vals, 100]);
  const st = seriesStats(ser, from, from + 180 * M, from + 180 * M);
  // weights: 11 readings × 10 min, the 200 at +110 counts 15 min (gap after), the 100 at +160 counts 15 min (cap) → 140 of 180 min
  assert.equal(st.coverage, 77.8); assert.equal(st.pct_low, 42.9); assert.equal(st.pct_in, 32.1); assert.equal(st.pct_high, 25);
  assert.equal(st.min, 60); assert.equal(st.max, 200);
  assert.equal(seriesStats(ser, from, from + 180 * M, from + 180 * M, [5, 6]).n, 0); // Thursday is not weekend
  assert.equal(seriesStats(ser, from, from + 180 * M, from + 180 * M, [4]).n, 13);
});

test('CSV export: Kuwait time, both units, logged entries in order, commas quoted, deleted entries skipped', () => {
  const t = Date.parse('2026-10-01T04:15:00Z');
  const csv = buildCsv([{ t, v: 126 }], [evr({ id: 'a', insulin_units: 3, insulin_type: 'rapid', occurred_at: '2026-10-01T04:05:00Z', note: 'قبل الفطور, بسرعة' }),
    evr({ id: 'b', insulin_units: 9, insulin_type: 'rapid', occurred_at: '2026-10-01T05:00:00Z', deleted_at: '2026-10-01T05:01:00Z' })] as any,
    [meal({ eaten_at: '2026-10-01T04:20:00Z', total_carbs: 42 })] as any, () => 'ماما');
  const lines = csv.replace('\uFEFF', '').trim().split('\r\n');
  assert.equal(lines.length, 4);
  assert.equal(lines[1], '2026-10-01 07:05,إنسولين,,,,3,سريع,"قبل الفطور, بسرعة",ماما');
  assert.equal(lines[2], '2026-10-01 07:15,قراءة,126,7.0,,,,,');
  assert.ok(lines[3].startsWith('2026-10-01 07:20,وجبة,,,42'));
});

test('IOB follows the exponential model (1 at the dose, 0 at DIA, falling); COB is linear; long insulin is excluded', () => {
  const p = { dia: 360, peak: 75 };
  assert.equal(iobFraction(0, p), 1); assert.equal(iobFraction(360, p), 0);
  let prev = 1; for (let t = 5; t <= 360; t += 5) { const f = iobFraction(t, p); assert.ok(f <= prev + 1e-9, `rises at ${t}`); prev = f; }
  assert.ok(Math.abs(iobFraction(180, p) - 0.208) < 0.005, String(iobFraction(180, p))); // matches 1 − ∫activity, integrated independently
  assert.equal(iobParamsOk({ dia: 240, peak: 130 }), false); assert.equal(iobParamsOk(p), true);
  const t0 = Date.parse('2026-10-01T10:00:00Z');
  const doses = dosesFrom([evr({ insulin_units: 3, insulin_type: 'rapid', occurred_at: '2026-10-01T10:00:00Z' }), evr({ id: 'l', insulin_units: 12, insulin_type: 'long', occurred_at: '2026-10-01T10:00:00Z' })] as any);
  assert.equal(doses.length, 1); assert.equal(iobAt(t0, doses, p), 3); assert.equal(iobAt(t0 - 60000, doses, p), 0);
  assert.equal(cobAt(t0 + 90 * M, [{ t: t0, grams: 45 }], 180), 22.5); assert.equal(cobAt(t0 + 200 * M, [{ t: t0, grams: 45 }], 180), 0);
});

test('on-board timelines: left of how much, from what, ending at the last one + the duration; nothing when used up', () => {
  const p = { dia: 360, peak: 65 }, t0 = Date.parse('2026-10-01T13:27:00Z'), now = t0 + 112 * M;
  const ins = insulinLane([{ t: t0, units: 2 }, { t: t0 - 7 * 60 * M, units: 5 }], now, p)!;
  assert.equal(ins.total, 2, 'a dose older than the duration is not counted'); assert.equal(ins.n, 1);
  assert.equal(ins.first, t0); assert.equal(ins.end, t0 + 360 * M);
  assert.ok(Math.abs(ins.left - iobAt(now, [{ t: t0, units: 2 }], p)) < 1e-9 && ins.left < 2 && ins.left > 0);
  const two = insulinLane([{ t: t0, units: 2 }, { t: t0 + 60 * M, units: 1 }], now, p)!;
  assert.equal(two.total, 3); assert.equal(two.n, 2); assert.equal(two.last, t0 + 60 * M); assert.equal(two.end, t0 + 420 * M);
  assert.equal(insulinLane([{ t: now + 5 * M, units: 2 }], now, p), null, 'a dose logged ahead does not count yet');
  assert.equal(insulinLane([{ t: t0, units: 2 }], t0 + 359.9 * M, p), null, 'almost nothing left: no lane');
  const c = carbLane([{ t: t0, grams: 27.5 }], now, 180)!;
  assert.equal(c.total, 27.5); assert.equal(c.end, t0 + 180 * M); assert.ok(Math.abs(c.left - 27.5 * (1 - 112 / 180)) < 1e-9);
  assert.equal(carbLane([{ t: t0, grams: 27.5 }], t0 + 181 * M, 180), null);
});

test('graph axis fits the readings: 3 mmol/L up to 2 above the high limit, more only when a reading needs it', () => {
  const mm = (x: number) => x * 18.016;
  const [a0, a1] = yDomain(mm(8), mm(5), 180);
  assert.equal(a0, 54); assert.equal(a1, 216, 'a 5–8 day: 3 to 12 mmol/L, not 2.2 to 16.7');
  assert.ok(yDomain(mm(15), mm(5), 180)[1] >= mm(15) + 18, 'a high reading always fits with room');
  assert.equal(yDomain(mm(2.4), mm(2.4), 180)[0], 36, 'a very low reading lowers the floor (2 mmol/L at most)');
  assert.equal(yDomain(500, 60, 180)[1], 400, 'capped');
  assert.equal(yDomain(mm(8.1), mm(5), 180)[1], yDomain(mm(8.6), mm(5), 180)[1], 'small changes do not move the top');
  assert.deepEqual(yGrid(54, 216, 'mmol').map((v) => Math.round(v / 18.016)), [4, 6, 8, 10], 'short axis: every 2 mmol/L');
  assert.deepEqual(yGrid(40, 400, 'mmol').map((v) => Math.round(v / 18.016)), [4, 8, 12, 16, 20]);
});

console.log('variability and pattern cards');

const mkSeries = (from: number, to: number, f: (t: number) => number | null, step = 60000) => {
  const t: number[] = [], v: number[] = [];
  for (let x = from; x < to; x += step) { const y = f(x); if (y !== null) { t.push(x); v.push(y); } }
  return { t: Float64Array.from(t), v: Float64Array.from(v) };
};

test('variability: flat glucose has no swings; a 6-hour wave of ±50 gives MAGE about 100; MODD sees a day-to-day shift; minimum data hides values', () => {
  const D = 86400000, start = Date.UTC(2026, 8, 1) - 3 * 3600000;
  const flat = variability(mkSeries(start, start + 8 * D, () => 120), start, start + 8 * D);
  assert.equal(flat.mage, 0); assert.equal(flat.modd, 0); assert.equal(flat.conga1, 0); assert.equal(flat.lbgi, 0);
  const wave = (x: number) => 140 + 50 * Math.sin((2 * Math.PI * (x - start)) / (6 * 3600000)) + (Math.floor((x - start) / D) % 2 ? 20 : 0); // every other day 20 higher
  const w = variability(mkSeries(start, start + 8 * D, wave), start, start + 8 * D);
  assert.ok(Math.abs(w.mage! - 100) < 6, String(w.mage));
  assert.ok(Math.abs(w.modd! - 20) < 0.5, String(w.modd));
  assert.ok(w.conga1! > 20);
  // 15-minute history and 1-minute live readings land on the same grid
  const g1 = grid(mkSeries(start, start + D, () => 100), start, start + D), g15 = grid(mkSeries(start, start + D, () => 100, 900000), start, start + D);
  assert.equal(g1.v.filter((x) => !isNaN(x)).length, g15.v.filter((x) => !isNaN(x)).length);
  // a gap stays a gap: no pairs across it
  const gappy = variability(mkSeries(start, start + 2 * D, (x) => (x - start < 30 * 3600000 ? 100 : x - start < 33 * 3600000 ? null : 200)), start, start + 2 * D);
  assert.equal(gappy.conga1, 0);
  // below the plan's minimum data the value is hidden
  const short = variability(mkSeries(start, start + 3 * D, () => 120), start, start + 3 * D);
  assert.equal(short.mage, null); assert.equal(short.modd, 0); assert.equal(short.adrr, null);
});

test('risk indices: Kovatchev f is zero at 112.5 mg/dL; a day at 50 is high low-risk, a day at 300 high high-risk', () => {
  assert.ok(Math.abs(riskF(112.5)) < 0.01);
  const D = 86400000, start = Date.UTC(2026, 8, 1) - 3 * 3600000;
  const lo = variability(mkSeries(start, start + 14 * D, () => 50), start, start + 14 * D);
  assert.equal(lbgiBand(lo.lbgi!), 'مرتفع'); assert.equal(lo.hbgi, 0); assert.equal(lo.fullDays, 14); assert.ok(Math.abs(lo.adrr! - 22.5) < 0.3, String(lo.adrr)); assert.equal(adrrBand(lo.adrr!), 'متوسط'); // f(50) ≈ −1.50 by hand → 10f² ≈ 22.5
  const hi = variability(mkSeries(start, start + D, () => 300), start, start + D);
  assert.equal(hbgiBand(hi.hbgi!), 'مرتفع'); assert.equal(hi.adrr, null, 'ADRR needs 14 days');
});

test('pattern cards follow plan 5.7: recurring lows, overnight drift, rise after a recipe, unusual day; each states its rule', () => {
  const D = 86400000, H = 3600000, now = Date.UTC(2026, 9, 1, 12) - 3 * H; // noon Kuwait
  const today = dayStartOf(now);
  const driftNights = new Set([0, 1, 2, 4, 5].map((k) => today - k * D));        // 5 of 7 nights fall 80
  const lowStarts = [3, 8, 11].map((k) => today - k * D - 1.5 * H);             // 22:30 three times
  const meals = [8, 10, 11, 12].map((k) => today - k * D + 13 * H);
  const f = (t: number) => {
    const d = dayStartOf(t), c = t - d;
    if (d === today && c >= 7 * H) return 60;                                    // today: low since 07:00
    if (driftNights.has(d) && c <= 6 * H) return 180 - (80 * c) / (6 * H);
    if (lowStarts.some((x) => t >= x && t < x + 25 * 60000)) return 60;
    for (const m of meals) if (t >= m && t < m + 150 * 60000) return 110 + Math.min(80, ((t - m) / 60000) * 1.2);
    return 110;
  };
  const series = mkSeries(today - 31 * D, now, f);
  const history = meals.map((m, k) => ({ id: 'b' + k, kind: 'meal', recipe_id: 'r9', name: 'مكرونة', eaten_at: new Date(m).toISOString() })) as unknown as HistoryEntry[];
  const cards = findPatterns({ series, history, now, low: 70, high: 180, reference: true });
  const by = (k: string) => cards.find((c) => c.kind === k);
  assert.equal(by('recurring_lows')?.n, 3); assert.ok(by('recurring_lows')!.title.includes('22:00'));
  assert.ok(by('recurring_lows')!.facts.text.includes('مرجعي'));
  assert.equal(by('overnight_drift')?.id, 'overnight_drift:down'); assert.equal(by('overnight_drift')!.days.length, 5); assert.equal(by('overnight_drift')!.facts.mg![1], 80);
  assert.equal(by('recipe_rise')?.title, 'ارتفاع بعد مكرونة'); assert.equal(by('recipe_rise')!.n, 4); assert.equal(by('recipe_rise')!.facts.mg![0], 80);
  assert.equal(by('unusual_day')?.id, `unusual_day:${today}:lo`);
  for (const c of cards) assert.ok(c.rule.startsWith('القاعدة'), 'every card states its rule');
  assert.equal(findPatterns({ series: mkSeries(today - 31 * D, now, () => 110), history: [], now, low: 70, high: 180, reference: false }).length, 0);
  // dismissing hides a card for a week
  const id = by('overnight_drift')!.id;
  assert.equal(visible(cards, { [id]: now + 1000 }, now).some((c) => c.id === id), false);
  assert.equal(visible(cards, { [id]: now - 1000 }, now).some((c) => c.id === id), true);
});

console.log('food photos and barcodes');

test('photo estimates are cleaned: bounded numbers, carbs never above the weight, totals computed here, no dosing text', async () => {
  const { cleanEstimate, mentionsDosing, SCHEMA } = await import('../../../supabase/functions/carb-food/estimate');
  const e = cleanEstimate({ is_food: true, notes_ar: 'تحقق من السكر', notes_en: 'Check the sugar', items: [
    { name_ar: 'شاي', name_en: 'Tea', grams: 150, carbs_g: 10, protein_g: 0, fat_g: 0, kcal: 40, confidence: 'low', hidden_sugar: true },
    { name_ar: 'خبز', name_en: 'Bread', grams: 30, carbs_g: 90, protein_g: -3, fat_g: 'x', kcal: 80, confidence: 'weird', hidden_sugar: 'yes' },
  ] });
  assert.equal(e.items.length, 2);
  assert.equal(e.items[1].carbs_g, 30, 'carbs capped at the weight');
  assert.equal(e.items[1].protein_g, 0); assert.equal(e.items[1].fat_g, 0); assert.equal(e.items[1].confidence, 'low'); assert.equal(e.items[1].hidden_sugar, false);
  assert.equal(e.total.carbs_g, 40);
  assert.equal(cleanEstimate({ is_food: true, items: [] }).is_food, false, 'no items means nothing to log');
  assert.equal(cleanEstimate(null).items.length, 0);
  assert.ok(mentionsDosing('give 2 units of insulin') && mentionsDosing('جرعة الإنسولين') && !mentionsDosing('Check the sugar in the tea'));
  // the schema the model must answer in is strict (structured outputs)
  assert.equal(SCHEMA.additionalProperties, false); assert.equal(SCHEMA.properties.items.items.additionalProperties, false);
});

test('editing an estimated item: grams scale everything; barcode data reads Open Food Facts per 100 g', async () => {
  const { scaleItem, totals, offToPackaged } = await import('../foodcalc');
  const i = { name_ar: 'أرز', name_en: 'Rice', grams: 100, carbs_g: 28, protein_g: 2.7, fat_g: 0.3, kcal: 130, confidence: 'medium' as const, hidden_sugar: false };
  const h = scaleItem(i, 150);
  assert.equal(h.carbs_g, 42); assert.equal(h.kcal, 195); assert.equal(h.grams, 150);
  assert.equal(totals([i, h]).carbs, 70);
  const p = offToPackaged('6281007', { status: 1, product: { product_name: 'Juice', product_name_ar: 'عصير', brands: 'Almarai, X', serving_quantity: '200', nutriments: { carbohydrates_100g: 11.5, proteins_100g: 0.4, 'energy-kcal_100g': 48 } } }, 'ar')!;
  assert.equal(p.name, 'عصير'); assert.equal(p.brand, 'Almarai'); assert.equal(p.per100.carbs, 11.5); assert.equal(p.serving, 200); assert.equal(p.per100.fat, null);
  assert.equal(offToPackaged('1', { status: 1, product: { product_name: 'No carbs listed', nutriments: {} } }, 'en'), null, 'no carb value: not usable');
  assert.equal(offToPackaged('1', { status: 0 }, 'en'), null);
});

console.log('languages');

test('English: every t() text has a translation with the same placeholders, and no Arabic is left outside t()', async () => {
  const { checkI18n } = await import('../../i18n/check');
  const r = checkI18n(new URL('../../', import.meta.url).pathname);
  const show = (name: string, a: string[]) => (a.length ? `\n${name} (${a.length}):\n  ` + a.slice(0, 40).join('\n  ') : '');
  assert.ok(!r.missing.length && !r.params.length && !r.bare.length && !r.templ.length && !r.tables.length,
    show('missing English', r.missing) + show('placeholders differ', r.params) + show('Arabic outside t()', r.bare) + show('template literal in t()', r.templ) + show('label table without English', r.tables));
});

test('t(): placeholders, English plurals, fallback to Arabic', async () => {
  const i = await import('../../i18n');
  i.__setLangForTest('ar'); assert.equal(i.t('ليان'), 'ليان');
  i.__setLangForTest('en'); assert.equal(i.t('ليان'), 'Layan'); assert.equal(i.t('نص غير مترجم'), 'نص غير مترجم');
  assert.equal(i.t('{n} يوم', { n: 1 }), '1 day'); assert.equal(i.t('{n} يوم', { n: 3 }), '3 days');
  i.__setLangForTest('ar');
});

console.log('status page');

{
  const { onBoard, ratioAt, sensorLife } = await import('../../engine/status');
  const { sensorFrom, sensorReminderDue } = await import('../../../supabase/functions/carb-glucose/lib');
  const H = 3600000, T0 = Date.UTC(2026, 9, 1, 9, 0);
  const R = [{ from: '06:00', cr: 15, isf: 54 }, { from: '12:00', cr: 20, isf: 72 }];
  test('the doctor\'s block in effect wraps past midnight', () => {
    assert.equal(ratioAt(R, 7 * 60)!.cr, 15); assert.equal(ratioAt(R, 13 * 60)!.cr, 20); assert.equal(ratioAt(R, 2 * 60)!.cr, 20);
    assert.equal(ratioAt([{ from: '06:00', cr: 0, isf: 54 }], 400), null, 'a bad block is ignored');
  });
  const ev = (units: number, at: number) => ({ id: 'e', kind: 'insulin', insulin_type: 'rapid', insulin_units: units, occurred_at: new Date(at).toISOString(), deleted_at: null }) as never;
  const meal = (g: number, at: number) => ({ eaten_at: new Date(at).toISOString(), total_carbs: g }) as never;
  const base = { now: T0, kuwaitMin: 12 * 60 + 30, iob: { dia: 360, peak: 65 }, absorbMin: 180, ratios: R };
  test('estimate = current + carbs left ÷ CR × ISF − insulin left × ISF', () => {
    const o = onBoard({ ...base, glucose: { mg: 120, at: T0 }, history: [meal(40, T0)], events: [ev(2, T0)] });
    assert.equal(o.iob, 2); assert.equal(o.cob, 40);
    assert.ok(Math.abs(o.est! - (120 + 40 / 20 * 72 - 2 * 72)) < 1e-9);
    assert.equal(o.estBy, T0 + 360 * 60000);
  });
  test('no estimate from an old reading, or without the doctor\'s numbers', () => {
    assert.equal(onBoard({ ...base, glucose: { mg: 120, at: T0 - 20 * 60000 }, history: [], events: [] }).est, null);
    assert.equal(onBoard({ ...base, ratios: [], glucose: { mg: 120, at: T0 }, history: [], events: [] }).est, null);
    const idle = onBoard({ ...base, glucose: { mg: 120, at: T0 }, history: [], events: [] });
    assert.equal(idle.est, 120); assert.equal(idle.estBy, T0);
  });
  test('sensor life and its reminders, once each per serial', () => {
    const start = new Date(T0 - 13.5 * 24 * H).toISOString();
    const l = sensorLife(start, 14, T0); assert.equal(l.state, 'today'); assert.ok(Math.abs(l.left - 12 * H) < 1);
    assert.equal(sensorLife(new Date(T0 - 30 * 60000).toISOString(), 14, T0).warmup, true);
    assert.equal(sensorLife(start, 14, T0 + 13 * H).state, 'ended');
    assert.equal(sensorReminderDue(start, 14, 'A', null, T0), '24');
    assert.equal(sensorReminderDue(start, 14, 'A', 'A:24', T0), null);
    assert.equal(sensorReminderDue(start, 14, 'A', 'A:24', T0 + 11 * H), '2');
    assert.equal(sensorReminderDue(start, 14, 'B', 'A:2', T0), '24', 'a new sensor starts over');
    assert.equal(sensorReminderDue(start, 15, 'A', null, T0), null, 'Libre 2 Plus: a day more');
  });
  test('sensor serial and start from a LibreLinkUp reply', () => {
    assert.deepEqual(sensorFrom({ activeSensors: [{ sensor: { sn: '0ABC', a: 1790000000 } }] }), { sn: '0ABC', started_at: new Date(1790000000000).toISOString() });
    assert.equal(sensorFrom({ connection: { sensor: { sn: 'X', a: 0 } } }), null);
    assert.deepEqual(sensorFrom({ activeSensors: [{ sensor: { a: 1790507358, pt: 3 } }] }), { sn: 'a1790507358', started_at: '2026-09-27T11:09:18.000Z' }, 'Libre 2 sends no serial');
  });
}

{
  const { planPushDue, planMessage } = await import('../../../supabase/functions/carb-glucose/alerts');
  const M = 60000, DOSE = Date.UTC(2026, 9, 5, 4, 0); // 07:00 Kuwait
  const p = { status: 'planned', name: 'synthetic toast', slot: 'breakfast', dose_at: new Date(DOSE).toISOString(), eat_after_min: 10, remind_min: 10, recheck_at: null as string | null, notified: {} as Record<string, string> };
  test('plan reminders: the check 10 min before the dose, once', () => {
    assert.equal(planPushDue(p, DOSE - 11 * M), null);
    const d = planPushDue(p, DOSE - 10 * M)!; assert.equal(d.kind, 'check');
    assert.equal(planPushDue({ ...p, notified: { check: d.at } }, DOSE - 9 * M), null, 'sent once');
    assert.equal(planPushDue({ ...p, notified: { check: d.at }, dose_at: new Date(DOSE + 30 * M).toISOString() }, DOSE + 20 * M)!.kind, 'check', 'a moved dose time reminds again');
    assert.equal(planPushDue(p, DOSE + 25 * M), null, 'long past: not sent');
  });
  test('plan reminders: eat time after the dose, recheck after a treatment, nothing once done', () => {
    assert.equal(planPushDue({ ...p, status: 'dosed' }, DOSE + 9 * M), null);
    assert.equal(planPushDue({ ...p, status: 'dosed' }, DOSE + 10 * M)!.kind, 'eat');
    const rc = new Date(DOSE + 15 * M).toISOString();
    assert.equal(planPushDue({ ...p, recheck_at: rc, notified: { check: 'x' } }, DOSE + 14 * M), null);
    assert.equal(planPushDue({ ...p, recheck_at: rc }, DOSE + 15 * M)!.kind, 'recheck');
    assert.equal(planPushDue({ ...p, status: 'eaten' }, DOSE + 10 * M), null);
    assert.equal(planPushDue({ ...p, status: 'skipped' }, DOSE - 10 * M), null);
  });
  test('plan reminders after the meal: early result at 2 h, final review at the insulin-action time, once each', () => {
    const e = DOSE + 10 * M, ate = { ...p, status: 'eaten', eating_at: new Date(e).toISOString() };
    assert.equal(planPushDue(ate, e + 119 * M), null);
    const early = planPushDue(ate, e + 120 * M)!; assert.equal(early.kind, 'early');
    assert.equal(planPushDue({ ...ate, notified: { early: early.at } }, e + 125 * M), null);
    assert.equal(planPushDue(ate, e + 360 * M)!.kind, 'final');
    assert.equal(planPushDue(ate, e + 300 * M, { earlyMin: 120, diaMin: 300 })!.kind, 'final', 'follows the configured duration');
    assert.equal(planPushDue({ ...p, status: 'eaten' }, e + 120 * M), null, 'no eating time: nothing to review');
    assert.equal(planMessage('final', p, 'en').title, '🔵 Breakfast review ready');
  });
  test('plan reminder text, in both languages', () => {
    assert.equal(planMessage('check', p, 'en').title, '🔵 Breakfast plan · dose at \u206607:00\u2069');
    assert.equal(planMessage('check', p, 'ar', { mg: 94, trend: 3, unit: 'mmol' }).body, 'الآن \u20665.2 →\u2069 ملمول/ل\nافحصوا السكر وأكّدوا الجرعة');
    assert.ok(planMessage('eat', p, 'en').body.startsWith('10 min since the dose'));
    assert.equal(planMessage('eat', p, 'ar').title, '🔵 وقت أكل الفطور');
    assert.equal(planMessage('recheck', p, 'ar').title, '🟠 أعيدوا قياس السكر');
  });
}

{
  const { reviewPlan, rulesOf, snapshotOf } = await import('../../engine/planReview');
  const { mergeSeries, emptySeries } = await import('../../engine/series');
  const M = 60000, E = Date.UTC(2026, 9, 5, 4, 10), R = { low: 70, high: 180 };
  // readings every 5 min from 30 min before eating to 6 h after, from a shape f(minutes after eating)
  const ser = (f: (m: number) => number | null) => { const t: number[] = [], v: number[] = []; for (let m = -30; m <= 370; m += 5) { const x = f(m); if (x !== null) { t.push(E + m * M); v.push(x); } } return mergeSeries(emptySeries(), t, v); };
  const bell = (base: number, top: number) => (m: number) => m <= 0 ? base : m <= 60 ? base + (top - base) * m / 60 : m <= 180 ? top - (top - base) * (m - 60) / 120 : base;
  const input = (o: Partial<Parameters<typeof reviewPlan>[0]> = {}) => ({
    now: E + 400 * M, eatingAt: E, dosedAt: E - 10 * M, calcUnits: 3, givenUnits: 3, carbsPlanned: 45, carbsEaten: 45, part: 1, startLevel: 0,
    series: ser(bell(110, 160)), others: [], range: R, diaMin: 360, fatty: false, fastShare: 0, estimatedItems: [], eatingTimeEstimated: false,
    rules: rulesOf(null), ...o,
  });
  test('plan review: a clean meal in target is final after the insulin-action time, comparable, high quality', () => {
    const r = reviewPlan(input());
    assert.equal(r.stage, 'final'); assert.equal(r.outcome, 'in_target'); assert.equal(r.quality, 'high'); assert.equal(r.comparable, true);
    assert.equal(r.final!.peak, 160); assert.equal(r.final!.ttp, 60); assert.equal(r.final!.rise, 50); assert.equal(r.interval, 10);
    assert.equal(r.cleanMin, 360); assert.equal(r.returned, true); assert.deepEqual(r.contributors, []);
    assert.equal(snapshotOf(r).outcome, 'in_target');
  });
  test('plan review: at 2 hours only the early result, never a verdict', () => {
    const r = reviewPlan(input({ now: E + 125 * M }));
    assert.equal(r.stage, 'early'); assert.equal(r.outcome, null); assert.ok(r.early!.at2h !== null); assert.equal(r.final, null);
  });
  test('plan review: food after 90 min ends the window there; too short to judge or compare', () => {
    const r = reviewPlan(input({ others: [{ t: E + 90 * M, kind: 'food', label: 'snack', grams: 20 }] }));
    assert.equal(r.endedBy!.label, 'snack'); assert.equal(r.cleanMin, 90); assert.equal(r.outcome, 'unclear');
    assert.equal(r.comparable, false); assert.ok(r.notComparableWhy.includes('ended:90'));
    assert.equal(reviewPlan(input({ others: [{ t: E + 90 * M, kind: 'food', label: 'bite', grams: 3 }] })).cleanMin, 360, 'a 3 g bite does not end it');
  });
  test('plan review: a low is a low even when ended early; facts that may have contributed', () => {
    const dip = (m: number) => (m >= 140 && m <= 165 ? 62 : bell(110, 150)(m));
    const r = reviewPlan(input({ series: ser(dip), givenUnits: 4, calcUnits: 3, part: 0.5 }));
    assert.equal(r.outcome, 'low'); assert.equal(r.final!.low!.min, 62);
    assert.deepEqual(r.contributors.map((c) => c.key), ['dose_higher', 'ate_less']);
    assert.ok(r.notComparableWhy.includes('part:0.5'));
  });
  test('plan review: high with an early rise, juice, a lower dose than calculated', () => {
    const r = reviewPlan(input({ series: ser(bell(110, 260)), dosedAt: E - 5 * M, givenUnits: 2, calcUnits: 3, fastShare: 0.4 }));
    assert.equal(r.outcome, 'high'); assert.ok(r.final!.high!.minutes >= 30);
    assert.deepEqual(r.contributors.map((c) => c.key), ['early_rise_interval', 'fast_carbs', 'dose_lower']);
    assert.equal(r.contributors[0].m, 5);
  });
  test('plan review: limited quality says why and is not used for comparison', () => {
    const gappy = (m: number) => (m > 60 && m < 200 ? null : bell(110, 160)(m));
    const r = reviewPlan(input({ series: ser(gappy), estimatedItems: ['ملوخية'], eatingTimeEstimated: true }));
    assert.equal(r.quality, 'limited'); assert.ok(r.qualityWhy.some((w) => w.startsWith('readings:')));
    assert.ok(r.qualityWhy.includes('estimated:ملوخية') && r.qualityWhy.includes('eating_time'));
    assert.equal(r.comparable, false);
  });
  test('plan review rules: stored values over the defaults', () => {
    const rr = rulesOf({ high_min: 45, comparable: { carbs_pct: 20 } } as never);
    assert.equal(rr.high_min, 45); assert.equal(rr.comparable.carbs_pct, 20); assert.equal(rr.comparable.iob_u, 0.5); assert.equal(rr.early_min, 120);
  });
}

console.log('dose calculator');

{
  const { suggestDose } = await import('../../engine/dose');
  const T = Date.UTC(2026, 9, 1, 9, 0), M = 60000;
  const base = { now: T, carbs: 45, ratio: { from: '00:00', cr: 15, isf: 54 }, target: { low: 99, high: 117 }, lowMg: 70,
    glucose: { mg: 171, at: T - 2 * M, level: 0 }, sensorStartedAt: T - 5 * 86400000, iob: 0, lastRapidAt: null, gapMin: 120, step: 1 };
  test('food plus correction to the top of the range, rounded down to the pen', () => {
    const r = suggestDose(base);
    assert.equal(r.block, null); assert.equal(r.food, 3); assert.equal(r.correction, 1); assert.equal(r.dose, 4);
    assert.equal(suggestDose({ ...base, carbs: 40 }).dose, 3, '2.67 + 1 = 3.67 → 3');
    assert.equal(suggestDose({ ...base, carbs: 40, step: 0.5 }).dose, 3.5);
  });
  test('inside the range there is no correction; below it the food dose is lowered', () => {
    assert.equal(suggestDose({ ...base, glucose: { mg: 110, at: T, level: 0 } }).correction, 0);
    const r = suggestDose({ ...base, glucose: { mg: 72, at: T, level: 0 } });
    assert.equal(r.correction, -0.5); assert.equal(r.dose, 2, '3 − 0.5 = 2.5 → 2');
  });
  test('insulin still working covers the correction, never the food', () => {
    const r = suggestDose({ ...base, iob: 0.6 });
    assert.ok(Math.abs(r.correction - 0.4) < 1e-9); assert.equal(r.iobUsed, 0.6); assert.equal(r.dose, 3);
    assert.equal(suggestDose({ ...base, iob: 5 }).dose, 3);
  });
  test('refuses, with the reason, when the inputs cannot be trusted', () => {
    assert.equal(suggestDose({ ...base, lastRapidAt: T - 90 * M }).block, 'recent_dose');
    assert.equal(suggestDose({ ...base, lastRapidAt: T - 90 * M }).until, T + 30 * M);
    assert.equal(suggestDose({ ...base, lastRapidAt: T - 121 * M }).block, null);
    assert.equal(suggestDose({ ...base, glucose: { mg: 171, at: T - 16 * M, level: 0 } }).block, 'no_reading');
    assert.equal(suggestDose({ ...base, glucose: { mg: 65, at: T, level: 0 } }).block, 'low');
    assert.equal(suggestDose({ ...base, glucose: { mg: 171, at: T, level: -2 } }).block, 'falling');
    assert.equal(suggestDose({ ...base, sensorStartedAt: T - 30 * M }).block, 'warmup');
    assert.equal(suggestDose({ ...base, ratio: null }).block, 'no_plan');
    assert.equal(suggestDose({ ...base, iob: null }).block, 'no_plan');
  });
}

console.log('prediction tracking');

{
  const P = await import('../../engine/predict');
  const M = 60000, T = Date.UTC(2026, 9, 1, 9, 0); // 12:00 Kuwait
  const model = { iob: { dia: 360, peak: 65 }, absorb: 180, ratios: [{ from: '00:00', cr: 15, isf: 54 }] };
  const meal = (id: string, min: number, g: number) => ({ id, eaten_at: new Date(T + min * M).toISOString(), total_carbs: g, name: 'مجبوس', recipe_id: 'r4' }) as never;
  const dose = (id: string, min: number, u: number) => ({ id, kind: 'insulin', insulin_type: 'rapid', insulin_units: u, occurred_at: new Date(T + min * M).toISOString(), deleted_at: null }) as never;
  const ex = (id: string, min: number) => ({ id, kind: 'exercise', occurred_at: new Date(T + min * M).toISOString(), deleted_at: null }) as never;
  test('a meal and its dose 5 minutes later make one prediction', () => {
    const e = P.entriesFrom([meal('m', 0, 45)], [dose('d', 5, 3)]);
    const tr = P.triggers(e);
    assert.deepEqual(tr.map((x) => x.key), ['h:m']);
    const p = P.predict(tr[0], e, 120, model)!;
    assert.equal(p.carbs, 45); assert.equal(p.units, 3); assert.equal(p.end_min, 360);
    assert.equal(p.curve[0], 120);
    // all used up at the end: 120 + 45/15*54 − 3*54 = 120
    assert.equal(p.curve[p.curve.length - 1], 120);
    assert.ok(Math.max(...p.curve) > 120, 'carbs act faster than insulin, so it rises first');
  });
  test('carbs alone: the end is start + carbs ÷ CR × ISF', () => {
    const e = P.entriesFrom([meal('m', 0, 30)], []);
    const p = P.predict(P.triggers(e)[0], e, 100, model)!;
    assert.equal(p.end_min, 180); assert.equal(p.curve[p.curve.length - 1], 100 + 2 * 54);
    assert.equal(P.predAt(p.curve, 90), 154, 'half the carbs absorbed at 90 of 180 minutes');
  });
  test('checkpoints fill from the sensor, and stop at anything logged later', () => {
    const e = P.entriesFrom([meal('m', 0, 30)], [ex('x', 100)]);
    const p = { ...P.predict(P.triggers(e)[0], e, 100, model)!, checks: {} };
    const t = [T + 61 * M, T + 120 * M], v = [150, 190];
    const r = P.fillChecks(p, e, t, v, T + 400 * M);
    assert.deepEqual(r.checks['60'], { pred: Math.round(P.predAt(p.curve, 60)), actual: 150 });
    assert.deepEqual(r.checks['120'], { skip: 'other_entry' });
    assert.equal(r.done, true);
    const early = P.fillChecks(p, [], t, v, T + 65 * M);
    assert.equal(early.done, false); assert.equal(early.checks['60'], undefined, 'waits 10 minutes past the checkpoint');
    assert.deepEqual(P.fillChecks(p, [], [], [], T + 400 * M).checks['60'], { skip: 'no_data' });
  });
  test('accuracy: average miss and direction, excluded predictions left out', () => {
    const a = P.accuracy([
      { checks: { '60': { pred: 150, actual: 170 } }, excluded: null },
      { checks: { '60': { pred: 150, actual: 140 } }, excluded: null },
      { checks: { '60': { pred: 150, actual: 300 } }, excluded: 'sensor_day1' },
    ]);
    assert.equal(a[0].n, 2); assert.equal(a[0].mae, 15); assert.equal(a[0].bias, 5); assert.equal(a[0].within, 0.5);
  });
}

console.log('trend');

{
  const { trendFrom, levelOf, levelFromLibre, libreOf } = await import('../../engine/trend');
  const M = 60000, T = Date.UTC(2026, 9, 1, 9, 0);
  const R = (mins: number[], f: (m: number) => number) => mins.map((m) => ({ taken_at: new Date(T + m * M).toISOString(), mg_dl: f(m), trend: null }));
  test('seven steps, with double arrows over 3 mg/dL a minute', () => {
    assert.deepEqual([-3.5, -2.5, -1.5, 0, 0.9, 1.5, 2.5, 3.2].map(levelOf), [-3, -2, -1, 0, 0, 1, 2, 3]);
    assert.equal(levelFromLibre(1), -2); assert.equal(libreOf(-3), 1); assert.equal(libreOf(0), 3);
  });
  test('rate from a straight fit over the last 15–20 minutes', () => {
    const tr = trendFrom(R([-15, -12, -9, -6, -3, 0], (m) => 120 + 2 * m), T)!;
    assert.ok(Math.abs(tr.rate - 2) < 1e-9); assert.ok(Math.abs(tr.change15 - 30) < 1e-9); assert.equal(tr.level, 2);
    // the projection fades: 2 mg/dL a minute adds about 10 in 30 minutes, not 60 (a straight line overshot her turns)
    assert.ok(Math.abs(tr.projected30! - (120 + 5 * 2 * 0.5 * (1 - 0.5 ** 6) / 0.5)) < 1e-9);
    assert.ok(tr.projected30! > 125 && tr.projected30! < 135);
  });
  test('one odd reading does not flip it', () => {
    const tr = trendFrom(R([-15, -12, -9, -6, -3, 0], (m) => (m === 0 ? 112 : 100)), T)!;
    assert.equal(tr.level, 0);
  });
  test('no trend from old readings, across a gap, or from too little', () => {
    assert.equal(trendFrom(R([-40, -35, -30], (m) => 100 + m), T), null);
    assert.equal(trendFrom(R([-3, 0], (m) => 100 + m), T), null, 'under 5 minutes');
    const gap = trendFrom(R([-20, -2, 0], (m) => 100 + m), T);
    assert.equal(gap, null, 'the 18-minute gap leaves only 2 minutes');
    assert.equal(trendFrom(R([-8, 0], (m) => 100 + 2 * m), T)!.projected30, null, 'two points: a direction, no projection');
  });
}

console.log('arrow comparison');

{
  const { compareArrows, arrowWinner, rateBetween, trendFrom } = await import('../../engine/trend');
  const M = 60000, T = Date.UTC(2026, 9, 1, 0, 0);
  test('rate over a window never crosses a gap', () => {
    const t = [0, 3, 6, 30, 33, 36].map((m) => T + m * M), v = [100, 100, 100, 160, 166, 172];
    assert.ok(Math.abs(rateBetween(t, v, T, T + 36 * M)! - 2) < 1e-9, 'only the run after the gap');
    assert.equal(rateBetween(t, v, T + 31 * M, T + 36 * M), null, 'under 5 minutes');
  });
  test('scores both arrows against what the next 15 minutes did', () => {
    // steady for an hour, then rising 2.5 mg/dL a minute for an hour; a reading every minute
    const t: number[] = [], v: number[] = [], a: (number | null)[] = [];
    for (let m = 0; m <= 120; m++) { t.push(T + m * M); v.push(m <= 60 ? 120 : 120 + 2.5 * (m - 60)); a.push(m <= 60 ? 3 : 4); }
    const c = compareArrows(t, v, a, T + 200 * M);
    assert.ok(c.n > 15); assert.ok(c.fastN > 0);
    assert.ok(c.ours.exact > c.libre.exact, 'Libre said only "rising" during the fast rise');
    assert.equal(c.libre.fastCaught, 0);
    assert.equal(arrowWinner({ ...c, n: 10 }), null, 'too few moments for a verdict');
  });
  test('a 15-minute history point beside minute readings is left out of the trend', () => {
    const R = (m: number, mg: number, trend: number | null) => ({ taken_at: new Date(T + m * M).toISOString(), mg_dl: mg, trend });
    const rows = [R(-15, 100, 3), R(-12, 100, 3), R(-9, 100, 3), R(-6, 100, 3), R(-3, 100, 3), R(-1, 112, null), R(0, 100, 3)];
    assert.ok(Math.abs(trendFrom(rows as never, T)!.rate) < 1e-9);
  });
}

console.log('gluroo import');

{
  const G = await import('../gluroo');
  const H = 'date,bgl,trend,eventType,senderId,text,template,msgType,affectsFob,affectsIob,doseUnits,foodG,foodSugar,foodFat,foodProtein,foodSalt,foodCal,doseAutomatic,description,fpBgl,actionMins,exerciseMins,exerciseLevel';
  const at = (m: number) => new Date(Date.UTC(2026, 8, 29, 9, 0) + m * 60000).toISOString();
  const cgm = (m: number, mg: number, tr = 'FLAT') => `${at(m)},${mg},${tr},cgm_reading,,,,,,,,,,,,,,,,,,,`;
  const msg = (m: number, sender: string, type: string, o: { text?: string; units?: number; g?: number; fp?: number; desc?: string } = {}) =>
    `${at(m)},,,message,${sender},"${o.text ?? ''}",,${type},true,false,${o.units ?? ''},${o.g ?? ''},,,,,,false,${o.desc ?? ''},${o.fp ?? ''},,,`;
  const csv = [H,
    ...Array.from({ length: 50 }, (_, k) => cgm(k * 3 - 30, k * 3 - 30 > 60 ? 70 : 120, 'FORTYFIVE_UP')),
    msg(0, '422389', 'DOSE_INSULIN', { units: 3 }),
    msg(5, '422389', 'ANNOUNCE_MEAL', { text: 'A grilled sandwich with scrambled eggs inside., turkey, cheese', g: 40 }),
    msg(6, '422389', 'ANNOUNCE_MEAL', { text: 'A cup of tea with milk, small spoon of sugar', g: 10 }),
    msg(12, '422380', 'ANNOUNCE_MEAL', { text: 'sandwich with two eggs and turkey with cheese bread, accompanied by a cup', g: 36 }),
    msg(30, '422380', 'BGL_FP_READING', { text: 'Fingerprick of 7.3mM', fp: 132 }),
    msg(70, '422380', 'ANNOUNCE_MEAL', { text: 'Made from juice concentrate. With added sugar, fruit content min 30%', g: 15 }),
    msg(100, '422389', 'DOSE_BASAL_INSULIN', { units: 11, desc: 'Tresiba' }),
    msg(108, '422380', 'DOSE_BASAL_INSULIN', { units: 11, desc: 'Tresiba' }),
    msg(140, '422380', 'ANNOUNCE_MEAL', { text: 'Made from juice concentrate. With added sugar', g: 15 }),
  ].join('\n');
  const rows = G.parseCsv(csv);
  test('Gluroo CSV: quoted fields with commas are read whole', () => {
    assert.equal(rows.length, 59);
    assert.equal(rows.find((r) => r.msgType === 'ANNOUNCE_MEAL')!.text, 'A grilled sandwich with scrambled eggs inside., turkey, cheese');
  });
  const readings = G.readingsFrom(rows);
  const entries = G.classify(rows, readings, [{ kind: 'carbs', amount: 15, t: Date.parse(at(141)) }]);
  const st = (pred: (e: (typeof entries)[number]) => boolean) => entries.filter(pred).map((e) => e.status);
  test('Gluroo import: every row is kept with a status; the other parent logging the same food waits for a decision', () => {
    assert.equal(entries.length, 9, 'all message rows kept');
    assert.deepEqual(st((e) => e.food_key === 'egg_sandwich'), ['uncertain', 'accepted']);
    assert.equal(entries.find((e) => e.status === 'uncertain' && e.food_key === 'egg_sandwich')!.reason, 'other_parent_same_food');
    const d = G.derive(entries, readings);
    assert.equal(d.meals.length, 1); assert.equal(d.meals[0].carbs, 46, 'tea 10 + the accepted sandwich 36'); assert.equal(d.meals[0].uncertain, true);
    const decided = entries.map((e) => (e.status === 'uncertain' && e.food_key === 'egg_sandwich' ? { ...e, status: 'accepted' as const } : e));
    const d2 = G.derive(decided, readings);
    assert.equal(d2.meals[0].carbs, 86, 'a parent said it was separate food: added'); assert.equal(d2.meals[0].uncertain, false);
  });
  test('Gluroo import: juice while low, a second basal left undecided, already-logged entries marked, finger-prick kept', () => {
    assert.deepEqual(st((e) => e.food_key === 'juice_box'), ['low_treatment', 'probable_duplicate']);
    assert.deepEqual(st((e) => e.type === 'DOSE_BASAL_INSULIN'), ['accepted', 'uncertain']);
    const d = G.derive(entries, readings);
    assert.deepEqual(d.events.filter((e) => e.kind === 'insulin').map((e) => [e.insulin_type, e.bolus_purpose]), [['rapid', 'meal'], ['long', undefined]]);
    assert.equal(d.events.find((e) => e.kind === 'bg_check')!.bg_mgdl, 132);
    assert.equal(d.events.filter((e) => e.kind === 'treatment').length, 1);
    assert.equal(readings.length, 50); assert.equal(readings[0].tr, 4);
  });
  test('Gluroo import: an intervention snack (Gluroo\'s low-prevention sweet) is a low treatment with its carbs', () => {
    const e3 = G.classify(G.parseCsv([H, msg(0, '422380', 'INTERVENTION_SNACK', { text: '5g Sugar (White Toffee)', g: 5, desc: 'White Toffee' })].join('\n')), [], []);
    assert.deepEqual([e3[0].status, e3[0].carbs, e3[0].food_name], ['low_treatment', 5, 'White Toffee']);
    assert.equal(G.derive(e3, []).events.filter((e) => e.kind === 'treatment').length, 1);
  });
  test('Gluroo import: the same amount again 10–30 min later is uncertain; a changed amount is a corrected estimate', () => {
    const rows2 = G.parseCsv([H,
      msg(0, '422389', 'ANNOUNCE_MEAL', { text: 'Made from juice concentrate', g: 15 }),
      msg(12, '422389', 'ANNOUNCE_MEAL', { text: 'Made from juice concentrate', g: 15 }),
      msg(40, '422389', 'ANNOUNCE_MEAL', { text: 'A cup of cooked white basmati rice', g: 60 }),
      msg(45, '422389', 'ANNOUNCE_MEAL', { text: 'A plate of cooked white basmati rice', g: 45 }),
    ].join('\n'));
    const e2 = G.classify(rows2, [], []);
    assert.deepEqual(e2.map((e) => e.status), ['uncertain', 'accepted', 'replaced', 'accepted']);
  });
  test('Gluroo import: stable ids, so importing again adds nothing', async () => {
    const a = await G.uuid5('gluroo:x'), b = await G.uuid5('gluroo:x');
    assert.equal(a, b); assert.match(a, /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });
}

console.log('finger-prick vs sensor');

{
  const F = await import('../../engine/fingerprick');
  const M = 60000, T = Date.UTC(2026, 9, 1, 9, 0); // 12:00 Kuwait
  const R = (f: (m: number) => number) => Array.from({ length: 41 }, (_, k) => ({ t: T + (k - 20) * M, v: f(k - 20), a: 3 }));
  const base = { enteredLateMin: 2, handsClean: true, sensor: { sn: 'S1', startedAt: T - 1.5 * 86400000 }, lastMeal: T - 200 * M, lastInsulin: T - 200 * M, now: T + 60 * M };
  test('steady glucose, Libre 1.6 lower: a good test pointing at sensor bias', () => {
    const r = F.compareFingerprick({ ...base, t: T, bg: 180, readings: R(() => 151) });
    assert.equal(r.state, 'stable'); assert.equal(r.quality, 'good'); assert.equal(r.cause, 'sensor_bias');
    assert.equal(r.diff_mgdl, -29); assert.equal(r.sensor_day, 2); assert.equal(r.libre_10, 151); assert.equal(r.complete, true);
  });
  test('rising: Libre catches up 10 minutes later, so it is lag, not error', () => {
    const r = F.compareFingerprick({ ...base, t: T, bg: 112, readings: R((m) => 100 + 1.4 * m) }); // finger 6.2, Libre 5.5 → 6.3 at +10
    assert.equal(r.state, 'rising'); assert.equal(r.cause, 'cgm_lag'); assert.equal(r.best, 'plus10'); assert.equal(r.quality, 'fair');
  });
  test('fast change, juice just before, night pressure: named for what they are', () => {
    assert.equal(F.compareFingerprick({ ...base, t: T, bg: 160, readings: R((m) => 120 + 2.5 * m) }).cause, 'rapid_change');
    assert.equal(F.compareFingerprick({ ...base, t: T, bg: 95, lastMeal: T - 9 * M, readings: R(() => 70) }).cause, 'cgm_lag');
    const night = T - 9 * 3600000; // 03:00 Kuwait
    const Rn = Array.from({ length: 41 }, (_, k) => ({ t: night + (k - 20) * M, v: 65, a: 3 }));
    assert.equal(F.compareFingerprick({ ...base, t: night, bg: 100, readings: Rn }).cause, 'compression');
    assert.equal(F.compareFingerprick({ ...base, t: T, bg: 120, readings: [] }).cause, 'insufficient');
  });
  test('no bias estimate from fewer than 4 good steady tests', () => {
    const one = { ...F.compareFingerprick({ ...base, t: T, bg: 180, readings: R(() => 151) }), bg: 180 };
    assert.equal(F.sensorProfile([one, one, one]).bias, null);
    const p = F.sensorProfile([one, one, one, one]);
    assert.equal(p.bias!.n, 4); assert.equal(p.bias!.mgdl, -29);
  });
}

console.log('research scoring');

{
  const Rz = await import('../../engine/research');
  const M = 60000, T = Date.UTC(2026, 9, 1, 9, 0);
  const ctx = { doses: [] as { t: number; u: number }[], carbs: [] as { t: number; g: number }[], iob: { dia: 360, peak: 65 }, absorb: 180, cr: 15, isf: 54 };
  test('carbs push the context effect up, insulin pulls it down, by the doctor\'s ratios', () => {
    const c = { ...ctx, carbs: [{ t: T, g: 45 }] };
    assert.ok(Math.abs(Rz.physEffect(c, T, T + 180 * M) - 162) < 1e-9, '45 g ÷ 15 × 54');
    const d = { ...ctx, doses: [{ t: T, u: 1 }] };
    assert.ok(Math.abs(Rz.physEffect(d, T, T + 360 * M) + 54) < 1e-9);
    assert.equal(Rz.physEffect({ ...ctx, carbs: [{ t: T + M, g: 45 }] }, T, T + 60 * M), 0, 'only what was known at the moment');
  });
  test('on steady glucose no-change is exact; a steady rise is caught by the trend, and moments are shared', () => {
    const steady = Array.from({ length: 90 }, (_, k) => ({ t: T + k * M, v: 120, a: 3 }));
    const s1 = Rz.samples(steady, ctx, []).kept;
    assert.ok(s1.length > 10); assert.equal(Rz.score(s1, 'none').mae15, 0);
    const rise = Array.from({ length: 90 }, (_, k) => ({ t: T + k * M, v: 100 + 2.5 * k, a: 5 }));
    const s2 = Rz.samples(rise, ctx, []).kept;
    const tr = Rz.score(s2, 'trend');
    assert.ok(tr.mae15 < 1e-6); assert.equal(tr.rise.caught, tr.rise.truth); assert.ok(Rz.score(s2, 'none').mae15 > 30);
    assert.equal(Rz.samples(rise, ctx, [[T, T + 90 * M]]).kept.length, 0, 'excluded windows are left out');
    const r = Rz.samples(rise, ctx, [[T, T + 30 * M, 'uncertain_entry']]);
    assert.ok(r.excludedBy.uncertain_entry > 0 && r.excludedBy.uncertain_entry === r.excluded, 'each exclusion keeps its reason');
  });
}

console.log('research lab');

{
  const L = await import('../../engine/lab');
  const Rz = await import('../../engine/research');
  const M = 60000, H = 60 * M, D = 24 * H;
  const T0 = Date.UTC(2026, 9, 10, 6, 0); // 09:00 Kuwait
  const ctx = { doses: [] as { t: number; u: number }[], carbs: [] as { t: number; g: number }[], iob: { dia: 360, peak: 65 }, absorb: 180, cr: 15, isf: 54 };
  const clues = { uncertain: [] as number[], sensorStarts: [] as number[], fingerpricks: [] as { t: number; cause: string }[], exercise: [] as number[] };
  // synthetic: steady 110, then a rise over 30 min, then steady at the new level
  const bump = (start: number, delta: number) => Array.from({ length: 240 }, (_, k) => {
    const t = start + k * M, x = Math.min(1, Math.max(0, (k - 60) / 30));
    return { t, v: Math.round(110 + delta * x), a: 3 };
  });
  test('a rise nothing logged explains is found, called a missing event, and can be asked about', () => {
    const r = bump(T0, 60);
    const eps = L.findUnexplained(r, ctx, T0, T0 + 4 * H);
    assert.equal(eps.length, 1); assert.equal(eps[0].dir, 'rise');
    const c = L.classifyEpisode(eps[0], r, ctx, clues);
    assert.equal(c.cause, 'missing_event'); assert.ok(c.askable); assert.ok(c.evidence.includes('no_carbs_logged'));
    assert.ok(L.infoValue(c, eps[0].end + H) >= L.QUESTION_RULES.minInfo, 'fresh, big: worth a question');
    assert.equal(L.infoValue(c, eps[0].end + 3 * D), 0, 'too old to remember: never asked');
  });
  test('the same rise after logged carbs is the model\'s error, not a question; logged carbs it matches are not flagged', () => {
    const r = bump(T0, 60);
    const fed = { ...ctx, carbs: [{ t: T0 + 50 * M, g: 5 }] };
    const e = L.findUnexplained(r, fed, T0, T0 + 4 * H)[0];
    const c = L.classifyEpisode(e, r, fed, clues);
    assert.equal(c.cause, 'model_error'); assert.equal(c.askable, false);
    // 45 g at the doctor's ratios explains 162 mg/dL over 3 h; a matching slow rise is not a surprise
    const slow = Array.from({ length: 300 }, (_, k) => ({ t: T0 + k * M, v: 110 + Math.min(162, (162 * Math.max(0, k - 30)) / 180), a: 3 }));
    assert.equal(L.findUnexplained(slow, { ...ctx, carbs: [{ t: T0 + 30 * M, g: 45 }] }, T0, T0 + 5 * H).length, 0);
  });
  test('data problems are named without asking: a set-aside entry, a new sensor, a night dip that bounces back', () => {
    const r = bump(T0, 60);
    const e = L.findUnexplained(r, ctx, T0, T0 + 4 * H)[0];
    assert.equal(L.classifyEpisode(e, r, ctx, { ...clues, uncertain: [T0 + 40 * M] }).cause, 'bad_input');
    assert.equal(L.classifyEpisode(e, r, ctx, { ...clues, sensorStarts: [T0 - 2 * H] }).cause, 'cgm');
    const night = Date.UTC(2026, 9, 10, 0, 0); // 03:00 Kuwait
    const dip = Array.from({ length: 180 }, (_, k) => ({ t: night + k * M, v: k < 40 ? 120 : k < 60 ? 120 - 3 * (k - 40) : k < 80 ? 60 + 3 * (k - 60) : 120, a: 3 }));
    const de = L.findUnexplained(dip, ctx, night, night + 3 * H).find((x) => x.dir === 'fall')!;
    const dc = L.classifyEpisode(de, dip, ctx, clues);
    assert.equal(dc.cause, 'cgm'); assert.ok(dc.evidence.includes('compression_shape')); assert.equal(dc.askable, false);
  });
  test('a parent answer overrides the automatic cause and closes the question', () => {
    const r = bump(T0, 60);
    const e = L.findUnexplained(r, ctx, T0, T0 + 4 * H)[0];
    const a = L.classifyEpisode(e, r, ctx, clues, 'sensor');
    assert.equal(a.cause, 'cgm'); assert.equal(a.autoCause, 'missing_event'); assert.equal(a.askable, false);
    assert.equal(L.classifyEpisode(e, r, ctx, clues, 'unknown').cause, 'missing_event', '"don\'t know" keeps the automatic cause');
  });
  test('questions: at most 3 a day, the biggest first, a double entry only on a quiet day', () => {
    const c = (info: number, kind: 'unexplained' | 'duplicate' = 'unexplained') => ({ kind, ref: String(info) + kind, info });
    assert.deepEqual(L.pickQuestions([c(3), c(5), c(4), c(6), c(1)], []).map((q) => q.info), [6, 5, 4]);
    assert.equal(L.pickQuestions([c(3), c(5)], [{ kind: 'unexplained' }, { kind: 'unexplained' }]).length, 1);
    assert.equal(L.pickQuestions([c(9)], [{ kind: 'a' }, { kind: 'b' }, { kind: 'c' }]).length, 0);
    assert.deepEqual(L.pickQuestions([c(2, 'duplicate'), c(3, 'duplicate')], []).map((q) => q.info), [3], 'one double entry a day');
    assert.equal(L.pickQuestions([c(3, 'duplicate'), c(4)], []).filter((q) => q.kind === 'duplicate').length, 0);
    assert.equal(L.pickQuestions([c(1.2)], []).length, 0, 'small surprises are not worth asking');
  });
  test('walk-forward only uses earlier days, and the verdict goes collecting / not better / ready / rejected', () => {
    // a slow wave: the damped trend should beat no-change; days 1–2 train, day 3 on is unseen
    const start = Date.UTC(2026, 9, 1, 21, 0); // 00:00 Kuwait
    const r = Array.from({ length: 5 * 1440 }, (_, k) => ({ t: start + k * M, v: 140 + 40 * Math.sin((2 * Math.PI * k) / 240), a: 3 }));
    const res = L.runLab({ readings: r, ctx, clues, uncertain: [], answers: {}, baselineEnd: start + 2 * D, production: 'libre', now: start + 5 * D });
    assert.ok(res.choices.damped.length >= 2 && res.choices.damped.every((c) => c.day >= start + 2 * D), 'chosen per unseen day');
    assert.ok(res.unseen.all.damped.mae15 < res.unseen.all.none.mae15);
    assert.equal(res.data.unseen, res.unseen.all.none.n, 'every model on the same moments');
    const s = (mae15: number, mae30: number, n = 1200, caught = 3, fa = 2) => ({ n, mae15, mae30, bias15: 0, direction: 0, arrow: 0, fall: { truth: 5, caught, falseAlarms: fa }, rise: { truth: 5, caught: 0, falseAlarms: 0 } });
    const prod = s(16, 27), none = s(15, 23);
    assert.equal(L.verdict(s(10, 20, 200), prod, none, 10).verdict, 'collecting');
    assert.equal(L.verdict(s(14.5, 22), prod, none, 10).verdict, 'not_better', 'needs 10 % better than both');
    assert.equal(L.verdict(s(12, 22), prod, none, 10).verdict, 'ready');
    assert.equal(L.verdict(s(12, 22), prod, none, 4).verdict, 'collecting', 'promising, but not enough days yet');
    assert.equal(L.verdict(s(12, 22, 1200, 1), prod, none, 10).verdict, 'not_better', 'never misses more fast falls');
    assert.equal(L.verdict(s(17, 26), prod, none, 10).verdict, 'rejected');
    assert.equal(L.verdict(s(12, 22, 1200, 3, 30), prod, none, 10).verdict, 'rejected', 'too many false fall alarms');
  });
  test('similar meals: learns a dip then a bump from earlier meals only, and is judged after food', () => {
    // synthetic: three fully covered meals a day, each dips ~50 at 70 min then bumps ~60 at 3.5 h
    const start = Date.UTC(2026, 9, 1, 21, 0), days = 7;
    const g = (x: number, c: number, w: number) => Math.exp(-(((x - c) / w) ** 2));
    const meals = Array.from({ length: days * 3 }, (_, j) => start + Math.floor(j / 3) * D + [8, 13, 18][j % 3] * H);
    const r = Array.from({ length: days * 1440 }, (_, k) => {
      const t = start + k * M;
      const v = 120 + meals.reduce((s, m) => s + (t >= m ? -50 * g((t - m) / M, 70, 35) + 60 * g((t - m) / M, 210, 45) : 0), 0);
      return { t, v, a: 3 };
    });
    const fed = { ...ctx, carbs: meals.map((t) => ({ t, g: 40, fpu: 1, meal: true })), doses: meals.map((t) => ({ t, u: 2.7 })) };
    const res = L.runLab({ readings: r, ctx: fed, clues, uncertain: [], answers: {}, baselineEnd: start + 2 * D, production: 'libre', now: start + days * D });
    const af = res.unseen.bySituation.after_food!;
    assert.ok(af.similar_meals.mae15 < 0.5 * af.context.mae15, `${af.similar_meals.mae15} vs ${af.context.mae15}`);
    assert.ok(af.similar_meals.mae15 < af.libre.mae15);
    assert.ok(res.verdicts.similar_meals.verdict !== 'rejected');
    // the first meal has nothing earlier to learn from: it is Context v1 there
    const first = Rz.samples(r.slice(0, 1440), fed, [], { s: { f: Rz.similarMeals(fed, Rz.contextModel(0.5)) }, c: { f: Rz.contextModel(0.5) } }).kept.filter((x) => x.t > meals[0] && x.t < meals[1]);
    assert.ok(first.length > 20 && first.every((x) => x.preds.s!.v15 === x.preds.c!.v15));
  });
  test('arrow while moving: a flat guess is never right while glucose really moves', () => {
    const row = (truthRate: number, rate: number) => ({ t: 0, v: 100, truth15: 100, truth30: 100, truthRate, situation: 'other' as const, libreArrow: 3, preds: { none: { v15: 100, v30: 100, rate: 0 }, x: { v15: 100, v30: 100, rate } } });
    const rows = [row(0, 0), row(0, 0), row(0.2, 0), row(-1.5, -1.4), row(2.5, 1.2)];
    const none = Rz.score(rows, 'none'), x = Rz.score(rows, 'x');
    close(none.arrow, 0.6); close(none.arrowMoving!, 0);
    close(x.arrowMoving!, 0.5);
  });
  test('more forecasters: smoothing follows a steady ramp, learned ones fit only on earlier days, the best three are averaged', async () => {
    const F = await import('../../engine/forecasters');
    const ramp = Array.from({ length: 120 }, (_, k) => T0 + k * M), rv = ramp.map((_, k) => 100 + k), na = ramp.map(() => 3);
    for (const f of [F.holt(0.5, 0.3), F.kalman(0.002)]) { const p = f(119, ramp, rv, na, ctx)!; close(p.v15, 234, 2); close(p.v30, 249, 3); }
    // a wave every 4 h: AR learns it from earlier days and beats no change; on the first two days it does not predict
    const start = Date.UTC(2026, 9, 1, 21, 0);
    const r = Array.from({ length: 5 * 1440 }, (_, k) => ({ t: start + k * M, v: 140 + 40 * Math.sin((2 * Math.PI * k) / 240), a: 3 }));
    const { kept } = Rz.samples(r, ctx, [], { ar: { f: F.arModel(ctx) }, none: { f: (i: number, _t: number[], v: number[]) => ({ v15: v[i], v30: v[i], rate: 0 }) } });
    assert.ok(kept.filter((x) => x.t < start + 2 * D).every((x) => x.preds.ar === null));
    const later = kept.filter((x) => x.t >= start + 3 * D);
    assert.ok(Rz.score(later, 'ar').mae15 < 0.2 * Rz.score(later, 'none').mae15);
    const res = L.runLab({ readings: r, ctx, clues, uncertain: [], answers: {}, baselineEnd: start + 2 * D, production: 'libre', now: start + 5 * D });
    assert.ok(res.choices.ensemble.length >= 2 && res.choices.ensemble.every((c) => c.key.split('+').length === 3));
    assert.ok(res.unseen.all.ensemble.mae15 < res.unseen.all.none.mae15);
  });
  test('goals: progress toward enough data, 10 % better than the shown line, after meals, and the arrow', () => {
    const sc = (mae15: number, arrowMoving = 0.5) => ({ n: 500, mae15, mae30: 20, bias15: 0, direction: 0.6, arrow: 0.55, arrowMoving, fall: { truth: 0, caught: 0, falseAlarms: 0 }, rise: { truth: 0, caught: 0, falseAlarms: 0 } });
    const all = { none: sc(15), libre: sc(16, 0.6), context: sc(14.25, 0.66), damped: sc(16) };
    const [data, beat, meals, arrow] = L.goals(all, { after_food: { none: sc(20), libre: sc(22), similar_meals: sc(17) } }, { unseen: 500, unseenDays: 7 }, 'libre');
    close(data.pct, 0.5);
    assert.equal(beat.best, 'context'); close(beat.pct, 0.5); // 5 % of the 10 % needed
    assert.equal(meals.best, 'similar_meals'); close(meals.pct, 1); // 15 % better after food
    assert.equal(arrow.best, 'context'); assert.equal(arrow.a, 60); close(arrow.pct, 1);
    const flat = L.goals({ none: sc(15, 0), libre: sc(16, 0.6), damped: sc(16, 0.3) }, {}, { unseen: 500, unseenDays: 7 }, 'libre')[3];
    close(flat.pct, 0.5, 0.01); // half as often right as Libre while moving: 50 %, however often it is right when steady
    assert.equal(L.goals({ none: sc(15), libre: sc(16) }, {}, { unseen: 0, unseenDays: 0 }, 'libre')[2].pct, 0, 'no data yet: 0, never NaN');
  });
  test('set-aside entries are kept out with a reason, and their cost to the research is measured', () => {
    const start = Date.UTC(2026, 9, 1, 21, 0);
    const r = Array.from({ length: 3 * 1440 }, (_, k) => ({ t: start + k * M, v: 120, a: 3 }));
    const res = L.runLab({ readings: r, ctx, clues, uncertain: [{ id: 'x', t: start + D }], answers: {}, baselineEnd: start, production: 'libre', now: start + 3 * D });
    assert.ok(res.data.excludedBy.uncertain_entry > 30);
    assert.ok(res.duplicates[0].moments >= 36);
  });
}

console.log('growth and nutrition');

{
  const G = await import('../../engine/growth');
  const E = await import('../../engine/energy');
  const N = await import('../../engine/nutrition');
  test('EER: the NASEM 2023 girls equations, plus 15 kcal for growth at 4–8 y, with the published ±221 range', () => {
    const e = E.eer({ age: 7, sex: 'female', height_cm: 124, weight_kg: 23, activity: 'active' })!;
    assert.deepEqual(e.byActivity, { inactive: 1353, low_active: 1484, active: 1547, very_active: 1737 });
    assert.equal(e.low, 1547 - 221); assert.equal(e.high, 1547 + 221);
    assert.equal(E.eer({ age: 7, sex: 'male', height_cm: 124, weight_kg: 23, activity: 'active' }), null, 'boys are not bundled: no number rather than a wrong one');
    assert.equal(E.eer({ age: 2.5, sex: 'female', height_cm: 90, weight_kg: 13, activity: 'active' }), null);
  });
  test('WHO 2007: median is z 0, height uses LMS directly, weight and BMI use the restricted tail past ±3', () => {
    close(G.zScore('bmi', 15.2697, 72)!, 0, 1e-6);
    close(G.zScore('hfa', 121, 72)!, (121 - 115.1244) / (115.1244 * 0.04447), 1e-4);
    close(G.zScore('wfa', 20.1639, 72)!, 0, 1e-6);
    close(G.percentile(0), 50, 1e-6); close(G.percentile(1.96), 97.5, 0.01); close(G.percentile(-1), 15.87, 0.01);
    const sd3 = G.valueAtZ('bmi', 72, 3)!, sd2 = G.valueAtZ('bmi', 72, 2)!;
    close(G.zScore('bmi', sd3 + (sd3 - sd2), 72)!, 4, 1e-6);
    assert.equal(G.zScore('wfa', 30, 130), null, 'weight-for-age stops at 10 years');
    assert.equal(G.bmiBand(-2.5), 'thinness'); assert.equal(G.bmiBand(0.5), 'normal'); assert.equal(G.bmiBand(1.5), 'overweight');
  });
  test('growth: one measurement is a baseline; a trajectory needs 3 months; short-term changes are shown, not judged', () => {
    const birth = '2019-03-01';
    const one = G.growthStatus(G.points([{ on: '2025-09-01', weight_kg: 19.5, height_cm: 116 }], birth));
    assert.equal(one.state, 'baseline'); assert.deepEqual(one.reasons, []);
    close(one.latest!.bmi!, 14.49, 0.01);
    const wobble = G.growthStatus(G.points([{ on: '2025-09-01', weight_kg: 19.5, height_cm: 116 }, { on: '2025-09-08', weight_kg: 18.9, height_cm: null }], birth));
    assert.equal(wobble.state, 'baseline', 'a 7-day dip is not a growth warning'); assert.equal(wobble.change.d7, -0.6);
    const loss = G.growthStatus(G.points([{ on: '2025-09-01', weight_kg: 19.5, height_cm: 116 }, { on: '2025-12-08', weight_kg: 18.8, height_cm: 117.5 }], birth));
    assert.equal(loss.state, 'attention'); assert.ok(loss.reasons.includes('weight_down'));
    const fine = G.growthStatus(G.points([{ on: '2025-09-01', weight_kg: 19.5, height_cm: 116 }, { on: '2025-12-08', weight_kg: 20.1, height_cm: 118 }], birth));
    assert.equal(fine.state, 'stable');
    const thin = G.growthStatus(G.points([{ on: '2025-09-01', weight_kg: 15, height_cm: 116 }], birth));
    assert.ok(thin.reasons.includes('bmi_thinness'), 'WHO thinness (BMI-for-age < −2 SD) counts from the first measurement');
    assert.deepEqual(G.implausible({ on: '2025-09-01', weight_kg: 19.5, height_cm: 116 }, { on: '2025-09-02', weight_kg: 12, height_cm: 108 }), ['weight', 'height']);
  });
  const today = '2026-10-10';
  const at = (k: string, h: number) => Date.parse(k + 'T00:00:00Z') - 3 * 3600000 + h * 3600000;
  const meal = (k: string, h: number, o: Partial<Record<string, number | null>> = {}, groups: string[] | null = ['grains']) => N.foodEntry({
    eaten_at: new Date(at(k, h)).toISOString(), total_carbs: 50, total_kcal: 500, total_fat: 20, total_protein: 15, total_fiber: 4, ...o,
    lines: groups ? groups.map((g) => ({ name: g, product: null, carbs: 50 / groups.length })) : [],
  } as never, (l) => l.name as never);
  test('nutrition: missing is never zero; "low" needs coverage; a minimum met by known food is adequate whatever the rest', () => {
    const ks = ['2026-10-07', '2026-10-08', '2026-10-09'];
    const food = ks.flatMap((k) => [meal(k, 8), meal(k, 13, { total_fiber: null }), meal(k, 19)]);
    const a = N.average(N.days(food, [], today), 'd7', today);
    assert.equal(a.days, 3); close(a.nutrients.fiber.coverage, 2 / 3, 1e-9); close(a.nutrients.fiber.known, 8, 1e-9);
    assert.equal(N.nutrientState('fiber', a.nutrients.fiber, a.energy.est, { kind: 'min', value: 11, source: 'ispad_2022' }), 'insufficient', 'two thirds known: not enough to say low');
    assert.equal(N.nutrientState('fiber', a.nutrients.fiber, a.energy.est, { kind: 'min', value: 7, source: 'ispad_2022' }), 'adequate', 'known part already reaches it');
    assert.equal(N.nutrientState('fiber', a.nutrients.fiber, a.energy.est, { kind: 'min', value: 13, source: 'ispad_2022' }, 0.6), 'low', 'the threshold is configurable (8 g known ÷ ⅔ ≈ 12 g, below 13)');
    assert.equal(N.nutrientState('calcium', a.nutrients.calcium, a.energy.est, { kind: 'min', value: 1000, source: 'iom_2011' }), 'insufficient', 'no label gave calcium');
    assert.equal(N.nutrientState('fat', a.nutrients.fat, a.energy.est, { kind: 'pct_range', value: 30, high: 40, source: 'ispad_2022' }), 'within', '60 g of 1500 kcal = 36 %: context only');
  });
  test('nutrition: low treatments add to energy eaten but not to diet quality; incomplete days stay out of averages', () => {
    const ks = ['2026-10-05', '2026-10-06', '2026-10-07', '2026-10-08'];
    const food = ks.flatMap((k) => [meal(k, 8, {}, ['grains', 'dairy']), meal(k, 13, {}, ['protein', 'vegetables']), meal(k, 19, {}, ['extras'])]).concat([meal('2026-10-09', 9)]);
    const tr = [{ at: at('2026-10-06', 15), carbs: 20 }, { at: at('2026-10-08', 2), carbs: 20 }];
    const ds = N.days(food, tr, today);
    assert.equal(ds.find((d) => d.key === '2026-10-09')!.complete, false, 'one entry is not a full day');
    const a = N.average(ds, 'd7', today);
    assert.equal(a.days, 4); close(a.energy.est!, 1500, 1e-9); close(a.treatment.kcal, 40, 1e-9); close(a.totalKcal!, 1540, 1e-9);
    const refs = N.references(7, 23);
    const b = N.balance(a, refs);
    assert.equal(b.states.carbs, 'within', 'carbs from food only: 600 of 1500 kcal = 40 %');
    assert.equal(a.groupDays.vegetables, 4); assert.ok(!b.issues.includes('few_vegetables'));
    close(a.extrasCarbShare!, 1 / 3, 1e-9);
    const eref = N.energyRef(E.eer({ age: 7, sex: 'female', height_cm: 124, weight_kg: 23, activity: 'active' }), {})!;
    assert.equal(N.energyState(a, eref), 'within');
    assert.equal(N.energyState({ ...a, totalKcal: 1100 }, eref), 'below');
    assert.equal(N.energyState(N.average(ds, 'd30', today), eref), 'insufficient', '30 days needs 7 complete days');
    assert.equal(N.energyRef(null, { energy_kcal: 1600 })!.source, 'dietitian');
  });
  test('nutrition: a 3-day window, carbs / protein / fat in a word, one data-quality figure', () => {
    const ks = ['2026-10-07', '2026-10-08', '2026-10-09', '2026-10-04'];
    const food = ks.flatMap((k) => [meal(k, 8, { total_fat: 24 }), meal(k, 13, { total_fat: 24 }), meal(k, 19, { total_fat: 24, total_protein: null })]);
    const ds = N.days(food, [], today);
    const a3 = N.average(ds, 'd3', today), a7 = N.average(ds, 'd7', today);
    assert.equal(a3.days, 3, 'only the last 3 days'); assert.equal(a7.days, 4);
    const refs = N.references(7, 23);
    assert.equal(N.macroLevel('carbs', a3, refs), 'ok', '600 of 1500 kcal = 40 %');
    assert.equal(N.macroLevel('fat', a3, refs), 'slightly_high', '72 g × 9 = 43 % of energy: within 5 points above 40 %');
    assert.equal(N.macroLevel('protein', a3, refs, 0.8), 'unknown', 'protein known for two thirds of the food');
    close(N.dataQuality(a3), 2 / 3, 1e-9);
    assert.equal(N.macroLevel('protein', N.average(N.days(food.filter((_, i) => i % 3 !== 2), [], today), 'd3', today), refs), 'unknown', 'two meals a day is not a complete day');
  });
  test('references: ISPAD 2022 ranges as context, minimums and limits by age, the dietitian overrides any of them', () => {
    const r = N.references(7.2, 23);
    assert.deepEqual([r.carbs!.value, r.carbs!.high, r.fat!.value, r.fat!.high, r.sat_fat!.value], [40, 50, 30, 40, 10]);
    assert.equal(r.protein!.value, 21.8); assert.equal(r.fiber!.value, 12); assert.equal(r.calcium!.value, 1000); assert.equal(r.sodium!.value, 1500);
    const d = N.references(7.2, 23, { refs: { fiber: { kind: 'min', value: 18 } } });
    assert.equal(d.fiber!.value, 18); assert.equal(d.fiber!.source, 'dietitian');
    assert.deepEqual(N.references(15, 50), {}, 'no bundled reference outside 4–13 y');
  });
}

console.log('editing the items of a logged meal');

{
  const MI = await import('../mealItems');
  const P = (id: string, name: string, c: number, extra: Partial<Product> = {}): Product => ({ id, name, brand: null, category: 'x', kind: 'commercial', image_path: null, pack_size: null, unit: 'g', carbs_per_100: c, fat_per_100: 10, fiber_per_100: 2, protein_per_100: 5, kcal_per_100: null, serving_size: null, carbs_per_serving: null, label_basis: 'as_sold', cooked_yield: null, available: true, approved: true, label_updated_at: '2026-01-01', notes: null, ...extra });
  const rice = P('r', 'rice', 30), bread = P('b', 'bread', 50, { fat_per_100: null });
  const h = { id: 'h', kind: 'meal', recipe_id: 'rec', name: 'plate', category: null, eaten_at: '2026-10-01T10:00:00Z', total_carbs: 70, total_fat: 25, total_fiber: 5, total_protein: 12, total_kcal: 500, modified: false, glucose_mgdl: null, glucose_trend: null, glucose_at: null, notes: null,
    lines: [{ name: 'rice', product: 'rice', quantity: 100, unit: 'g', state: 'as_is', role: 'main', carbs: 30 }, { name: 'sauce', product: null, quantity: 50, unit: 'g', state: 'as_is', role: 'main', carbs: 40 }] } as HistoryEntry;
  test('logged meal items: a catalogue item is recomputed from its label, an item without one keeps its carbs in proportion', () => {
    const rows = MI.rowsOf(h, [rice, bread]);
    assert.equal(rows[0].product?.id, 'r'); assert.equal(rows[1].product, null);
    const same = MI.recompute(h, rows, S);
    assert.equal(same.carbs, 70, 'nothing changed: exactly as logged'); assert.equal(same.totals.fat, 25);
    rows[0].line = { ...rows[0].line, quantity: 150 }; rows[1].line = { ...rows[1].line, quantity: 25 };
    const r = MI.recompute(h, rows, S);
    assert.equal(r.carbs, 30 + 15 + 20, 'rice adds its label difference (+15), the sauce halves');
    // fat: saved 25; rice +5 (10 → 15 g); the sauce's share (25 − 10 = 15) halves → −7.5
    close(r.totals.fat!, 25 + 5 - 7.5, 1e-9);
  });
  test('logged meal items: removing, adding, and a nutrient that becomes unknown is never zero', () => {
    const rows = MI.rowsOf(h, [rice, bread]);
    rows[0].line = { ...rows[0].line, quantity: 0 };
    rows.push(MI.addRow(bread)); rows[2].line = { ...rows[2].line, quantity: 40 };
    const r = MI.recompute(h, rows, S);
    assert.deepEqual(r.lines.map((l) => l.name), ['sauce', 'bread'], 'removed item dropped');
    assert.equal(r.carbs, 40 + 20);
    assert.equal(r.totals.fat, null, 'bread has no fat on its label: unknown, not zero');
    close(r.totals.protein!, 12 - 5 + 2, 1e-9, );
  });
}

console.log('planned meals');

{
  const MP = await import('../../engine/mealPlan');
  const D = await import('../../engine/dose');
  const M = 60000, at = (h: number, m = 0) => Date.UTC(2026, 9, 5, h - 3, m); // Kuwait time on 5 Oct
  const plan = { dose_at: new Date(at(6, 40)).toISOString(), eat_after_min: 10, remind_min: 10, status: 'planned' as const, recheck_at: null };
  test('planned meal: on hold until the reminder, then check; after the dose, wait 10 min to eat; done once eaten', () => {
    assert.equal(MP.phase(plan, at(-2)), 'later', 'planned at 10 pm the night before');
    assert.equal(MP.phase(plan, at(6, 29)), 'later');
    assert.equal(MP.phase(plan, at(6, 30)), 'check', 'reminder 10 min before the dose');
    const dosed = { ...plan, status: 'dosed' as const, dose_at: new Date(at(6, 42)).toISOString() };
    assert.equal(MP.phase(dosed, at(6, 45)), 'wait_to_eat'); assert.equal(MP.eatAt(dosed), at(6, 52));
    assert.equal(MP.phase(dosed, at(6, 52)), 'eat_now');
    assert.equal(MP.phase({ ...plan, status: 'eaten' }, at(7)), 'done');
    const treated = { ...plan, recheck_at: new Date(at(6, 46)).toISOString() };
    assert.equal(MP.phase(treated, at(6, 40)), 'recheck'); assert.equal(MP.phase(treated, at(6, 46)), 'check');
    assert.equal(MP.upcoming([plan, { ...plan, status: 'eaten' }], at(-2)).length, 1, 'shown on Now from 10 pm: dose within 12 h');
  });
  test('planned meal rehearsal: 48.8 g previews 3 U; low at 6:30 means treat first; after the juice, toast only gives 1 U', () => {
    assert.equal(MP.expectedDose(48.8, 15, 1), 3);
    const base = { ratio: { from: '00:00', cr: 15, isf: 54 }, target: { low: 99, high: 117 }, lowMg: 70, sensorStartedAt: null, iob: 0, lastRapidAt: null, gapMin: 120, step: 1 };
    const low = D.suggestDose({ ...base, now: at(6, 30), carbs: 48.8, glucose: { mg: 63, at: at(6, 29), level: -1 } });
    assert.equal(low.block, 'low');
    const a = MP.planAlerts({ block: low.block, carbs: 48.8, fat: 15, protein: 12, maxCarbs: 60, fastDrinkCarbs: 18.75, lastLowAt: at(3, 52), now: at(6, 30) });
    assert.deepEqual(a.map((x) => x.key), ['treat_first', 'recent_low', 'fast_drink', 'fatty']);
    assert.equal(a[0].tone, 'red');
    const after = D.suggestDose({ ...base, now: at(6, 46), carbs: 30, glucose: { mg: 90, at: at(6, 45), level: 1 } });
    assert.equal(after.block, null); assert.equal(after.dose, 1, '30 ÷ 15 = 2, minus (99 − 90) ÷ 54, rounded down');
    const normal = D.suggestDose({ ...base, now: at(6, 30), carbs: 48.8, glucose: { mg: 115, at: at(6, 29), level: 0 } });
    assert.equal(normal.dose, 3);
    assert.equal(MP.isFastDrink({ role: 'main', unit: 'ml' }, 'مشروبات', 18.75), true);
    assert.equal(MP.isFastDrink({ role: 'main', unit: 'g' }, 'خبز', 30), false);
  });
}

console.log('editing entries');

{
  const Ed = await import('../edit');
  test('editing: she ate ¾ of a meal, so every item scales with it', () => {
    const lines = [{ name: 'عسل', quantity: 25, unit: 'g', carbs: 20.5 }, { name: 'bread', quantity: 1, unit: 'serving', carbs: 28 }];
    assert.deepEqual(Ed.scaleLines(lines, 0.75), [{ name: 'عسل', quantity: 18.75, unit: 'g', carbs: 15.4 }, { name: 'bread', quantity: 0.75, unit: 'serving', carbs: 21 }]);
  });
  const now = Date.UTC(2026, 9, 2, 7, 0);
  test('the time picker shows the same clock as the log and reads it back exactly', () => {
    const t = new Date(2026, 9, 2, 0, 21).getTime();
    assert.equal(Ed.toLocalInput(t), '2026-10-02T00:21');
    assert.equal(Ed.fromLocalInput('2026-10-02T00:21'), t);
    assert.equal(Ed.fromLocalInput(''), null); assert.equal(Ed.fromLocalInput('2026-10-02'), null); assert.equal(Ed.fromLocalInput('2026-02-31T10:00'), null);
  });
  test('an edit is refused when it would put an impossible value in the log', () => {
    const t = now - 3600000;
    assert.equal(Ed.editProblem('insulin', { t, units: 3 }, now), null);
    assert.equal(Ed.editProblem('insulin', { t, units: 0 }, now), 'units');
    assert.equal(Ed.editProblem('insulin', { t, units: 150 }, now), 'units', 'a typo like 150 units never reaches the dose calculator');
    assert.equal(Ed.editProblem('meal', { t, carbs: 45, name: 'x' }, now), null);
    assert.equal(Ed.editProblem('meal', { t, carbs: 45, name: ' ' }, now), 'name');
    assert.equal(Ed.editProblem('treatment', { t, carbs: 400 }, now), 'carbs');
    assert.equal(Ed.editProblem('bg_check', { t, bg: 10 }, now), 'bg');
    assert.equal(Ed.editProblem('note', { t: now + 3600000 }, now), 'future');
    assert.equal(Ed.editProblem('note', { t: null }, now), 'time');
    assert.equal(Ed.editProblem('meal', { t, carbs: 19, name: 'KDD', fat: 2.5, protein: 5, kcal: 135 }, now), null);
    assert.equal(Ed.editProblem('meal', { t, carbs: 19, name: 'KDD', fat: -1 }, now), 'nutrition');
  });
}

console.log('brands');

{
  const B = await import('../brand');
  test('one brand however it was typed, most used first', () => {
    assert.equal(B.normBrand('  KDD  '), 'KDD'); assert.equal(B.normBrand(' '), null);
    assert.ok(B.sameBrand('kdd', 'KDD ')); assert.ok(!B.sameBrand('KDD', 'Almarai'));
    assert.deepEqual(B.brandsOf([{ brand: 'KDD', uses: 3 }, { brand: 'kdd', uses: 1 }, { brand: 'Almarai', uses: 2 }, { brand: null }, { brand: 'KDD', uses: 1 }]), ['KDD', 'Almarai']);
  });
}

console.log('label per 100');

{
  const P = await import('../per100');
  const label = { carbs: 9.4, fat: 2, protein: 3, fiber: 0, kcal: 64 };   // flavoured milk, per 100 ml
  test('a 135 ml box from the per-100 ml label', () => {
    assert.deepEqual(P.fromPer100(label, 135), { carbs: 12.7, fat: 2.7, protein: 4.1, fiber: 0, kcal: 86 });
    assert.deepEqual(P.fromPer100(label, null), P.EMPTY, 'no amount, no serving');
    // half of it: every value halves; on a label (per 100) the amount halves and the printed values stay
    const apple = { mode: 'serving' as const, serving: { carbs: 13.8, fat: 0.2, protein: 0.3, fiber: 2.4, kcal: 52 }, per100: P.EMPTY, amount: null, unit: 'g' as const };
    assert.deepEqual(P.scaled(apple, 0.5).serving, { carbs: 6.9, fat: 0.1, protein: 0.2, fiber: 1.2, kcal: 26 });
    const box = { mode: 'per100' as const, serving: P.EMPTY, per100: label, amount: 200, unit: 'ml' as const };
    assert.equal(P.scaled(box, 0.5).amount, 100); assert.deepEqual(P.scaled(box, 0.5).per100, label);
    assert.equal(P.totalsOf(P.scaled(apple, 2)).carbs, 27.6);
  });
  test('per-100 values over 100 g are refused (a serving typed in the wrong box); the amount is required', () => {
    const s = { mode: 'per100' as const, serving: P.EMPTY, per100: label, amount: 135, unit: 'ml' as const };
    assert.equal(P.nutrProblem(s), null);
    assert.equal(P.totalsOf(s).carbs, 12.7);
    assert.equal(P.nutrProblem({ ...s, amount: null }), 'amount');
    assert.equal(P.nutrProblem({ ...s, per100: { ...label, carbs: 120 } }), 'per100');
    assert.equal(P.nutrProblem({ mode: 'serving', serving: { ...P.EMPTY, carbs: 19 }, per100: P.EMPTY, amount: null, unit: 'ml' }), null);
    assert.equal(P.nutrProblem({ mode: 'serving', serving: P.EMPTY, per100: P.EMPTY, amount: null, unit: 'ml' }), 'carbs');
  });
}

console.log('entry actions');

{
  const A = await import('../entryActions');
  test('meal labels by time of day; a dose, finger-prick or sleep is never one tap to repeat', () => {
    const at = (h: number) => new Date(2026, 9, 2, h, 30).getTime();
    assert.deepEqual([7, 12, 19, 23, 2].map((h) => A.mealSlot(at(h))), ['breakfast', 'lunch', 'dinner', 'late', 'late']);
    assert.ok(A.canLogAgain('meal') && A.canLogAgain('treatment'));
    assert.ok(!A.canLogAgain('insulin') && !A.canLogAgain('bg_check') && !A.canLogAgain('sleep'));
  });
  test('earlier times of the same food: same recipe or name, newest first, not itself', () => {
    const H = (id: string, name: string, d: number, recipe_id: string | null = null) => ({ id, name, recipe_id, eaten_at: new Date(2026, 9, d).toISOString() });
    const me = H('a', 'Rice', 5);
    const r = A.similar(me, [me, H('b', 'rice ', 1), H('c', 'Pasta', 3), H('d', 'Other name', 4, 'r1'), H('e', 'Rice', 3)]);
    assert.deepEqual(r.map((x) => x.id), ['e', 'b']);
    assert.deepEqual(A.similar({ ...me, recipe_id: 'r1' }, [H('d', 'Other name', 4, 'r1')]).map((x) => x.id), ['d']);
  });
}

console.log('product pictures');

{
  const I = await import('../../../supabase/functions/carb-product-image/lib');
  const base = 'https://eshop.kddc.com/en/item-1';
  test('a product page gives its share picture; logos and icons are never taken', () => {
    const html = '<meta property="og:image" content="/img/full-cream-250.jpg"><img src="/logo.png" alt="KDD"><img src="/img/other.jpg" alt="x">';
    assert.equal(I.pickImage(html, base, 'Full Cream Milk 250ml', false), 'https://eshop.kddc.com/img/full-cream-250.jpg');
    assert.equal(I.pickImage('<img src="/logo.png" alt="Full Cream">', base, 'Full Cream Milk 250ml', false), null);
  });
  test('a page listing several products only gives a picture that names this product', () => {
    const html = '<meta property="og:image" content="/banner-good-for-me.jpg"><img data-src="/p/mango-peach-0.png" alt="Mango Peach 0% sugar"><img src="/p/mojito.png" alt="Mojito lemon mint"><img src="/p/apple-rasp.png" alt="Apple Raspberry">';
    assert.equal(I.pickImage(html, base, 'Mango Peach Beverage (0% Sugar) 250ml', true), 'https://eshop.kddc.com/p/mango-peach-0.png');
    assert.equal(I.pickImage(html, base, 'Mojito (lemon & mint) Beverage (0% Sugar) 250ml', true), 'https://eshop.kddc.com/p/mojito.png');
    assert.equal(I.pickImage(html, base, 'Chocolate Ice Cream Cups (No Added Sugar)', true), null, 'no match: no picture rather than a wrong one');
    assert.deepEqual(I.keyWords('Mango Peach Beverage (0% Sugar) 250ml'), ['mango', 'peach']);
    // only the maker's own sites
    assert.ok(I.allowedHost('https://www.kddc.com/x.png') && I.allowedHost('https://eshop.kddc.com/x.png') && I.allowedHost('https://kddc.com/x'));
    assert.ok(!I.allowedHost('https://cdn.other.com/kddc.com.png') && !I.allowedHost('https://kddc.com.evil.io/x.png'));
    assert.equal(I.pickImage('<meta property="og:image" content="https://cdn.other.com/milk.png">', base, 'Full Cream Milk 250ml', false), null, 'a picture from another site is never taken');
    assert.equal(I.pickImage('<meta property="og:image" content="/a.png">', 'https://other.com/p', 'Full Cream Milk 250ml', false), null, 'nor a page from another site');
    // a picture loaded by script or as a background, found by its file name
    const lazy = '<div style="background-image:url(https://www.kddc.com/wp-content/uploads/2025/03/GFM-Mango-Peach-250ml.png)"></div><script>var p={"img":"https:\\/\\/www.kddc.com\\/wp-content\\/uploads\\/GFM-Mojito-Lemon-Mint.png"}</script>';
    assert.equal(I.pickImage(lazy, base, 'Mango Peach Beverage (0% Sugar) 250ml', true), 'https://www.kddc.com/wp-content/uploads/2025/03/GFM-Mango-Peach-250ml.png');
    assert.equal(I.pickImage(lazy, base, 'Mojito (lemon & mint) Beverage (0% Sugar) 250ml', true), 'https://www.kddc.com/wp-content/uploads/GFM-Mojito-Lemon-Mint.png');
    assert.equal(I.toHttps('http://eshop.kddc.com/en/a'), 'https://eshop.kddc.com/en/a');
    // a shop page for one product whose name is all common words: the big English picture, not a thumbnail or a flag
    const shop = '<img src="/catalog/language/en-gb/en-gb.png" alt="English"><img src="/image/cache//catalog/FullCreamMilk250ml-en-543x543.png" alt="Full Cream Milk 250ml"><img src="/image/cache//catalog/FullCreamMilk250ml-ar-114x114.png" alt="Full Cream Milk 250ml"><img src="/image/cache//catalog/FullCreamMilk250ml-en-114x114.png" alt="Full Cream Milk 250ml">';
    assert.equal(I.pickImage(shop, base, 'Full Cream Milk 250ml', false), 'https://eshop.kddc.com/image/cache//catalog/FullCreamMilk250ml-en-543x543.png');
  });
}

console.log('fatty meals');

{
  const I = await import('../../engine/iob');
  test('fatty meals: flagged for the notice; their carbs keep the care team absorption time', () => {
    const T = Date.parse('2026-10-02T12:00:00Z'), M = 60000;
    assert.ok(I.isFatty(18, 12) && I.isFatty(15, null) && I.isFatty(12, 25), 'fat 15 g, or fat and protein worth 200 kcal');
    assert.ok(!I.isFatty(5, 3) && !I.isFatty(null, 30) && !I.isFatty(0.7, 5.8));
    assert.equal(I.cobAt(T + 180 * M, [{ t: T, grams: 30 }], 180), 0, 'replayed on her data the slower curve was worse: COB is not slowed');
    const h = (min: number, fat: number | null) => ({ name: 'x' + min, eaten_at: new Date(T - min * M).toISOString(), total_fat: fat, total_protein: null });
    assert.equal(I.recentFatty([h(60, 20), h(30, 2)], T)?.name, 'x60');
    assert.equal(I.recentFatty([h(301, 20)], T), null, 'after 5 h: no notice');
  });
}

console.log('nights report');

{
  const N = await import('../../engine/nights');
  test('each night: lowest reading, minutes below 70 and low treatments, in the parents night hours', () => {
    const KW = 3 * 3600000, M = 60000, day = Date.parse('2026-09-30T00:00:00Z') - KW; // Kuwait midnight 30 Sep
    const start = day + 22 * 60 * M; // 22:00 on 30 Sep
    const t: number[] = [], v: number[] = [];
    for (let k = 0; k < 8 * 12; k++) { t.push(start + k * 5 * M); v.push(k >= 40 && k < 46 ? 62 : 110); } // 30 min under 70
    const rows = N.nightRows(t, v, [start + 4 * 3600000], day, day + 86400000, '22:00', '06:00');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].min, 62);
    assert.equal(rows[0].minutesBelow, 30);
    assert.equal(rows[0].treatments, 1);
    assert.ok(rows[0].coverage > 0.99);
    assert.deepEqual(N.nightRows([], [], [], day, day + 86400000, '22:00', '06:00'), [], 'no readings: no row');
  });
}

console.log('fat bump candidate');

{
  const R = await import('../../engine/research');
  test('the late fat bump arrives 2 to 5 hours after a fatty meal and leaves other meals alone', () => {
    const T = Date.parse('2026-10-02T12:00:00Z'), M = 60000;
    const ctx = { doses: [], carbs: [{ t: T, g: 30, fpu: 3 }], iob: { dia: 360, peak: 65 }, absorb: 180, cr: 15, isf: 54 };
    const bump = { k: 4, ...R.FAT_WINDOW };
    // no extra effect in the first 2 hours
    assert.equal(R.physEffect(ctx, T + 30 * M, T + 60 * M, bump), R.physEffect(ctx, T + 30 * M, T + 60 * M));
    // from 3 h to 4 h: the meal's own carbs are done; the bump adds 3 FPU × 4 g = 12 g over 3 h → 4 g an hour
    const late = R.physEffect(ctx, T + 180 * M, T + 240 * M, bump);
    assert.ok(Math.abs(late - (4 / 15) * 54) < 1e-6);
    // the whole bump over its window equals 12 g of carbs
    assert.ok(Math.abs(R.physEffect(ctx, T + 120 * M, T + 300 * M, bump) - R.physEffect(ctx, T + 120 * M, T + 300 * M) - (12 / 15) * 54) < 1e-6);
    // under 1 FPU or k = 0: identical to the normal model
    const lean = { ...ctx, carbs: [{ t: T, g: 30, fpu: 0.5 }] };
    assert.equal(R.physEffect(lean, T + 180 * M, T + 240 * M, bump), R.physEffect(lean, T + 180 * M, T + 240 * M));
    assert.equal(R.physEffect(ctx, T + 180 * M, T + 240 * M, { ...bump, k: 0 }), R.physEffect(ctx, T + 180 * M, T + 240 * M));
  });
  test('basal drift adds a steady change per hour on top of the context model', () => {
    const M = 60000, t = [0, 5, 10, 15, 20].map((k) => k * M), v = [120, 120, 120, 120, 120];
    const ctx = { doses: [], carbs: [], iob: { dia: 360, peak: 65 }, absorb: 180, cr: 15, isf: 54 };
    const flat = R.contextModel(0.5)(4, t, v, [3, 3, 3, 3, 3], ctx)!, drift = R.contextModel(0.5, undefined, undefined, -6)(4, t, v, [3, 3, 3, 3, 3], ctx)!;
    assert.ok(Math.abs(drift.v30 - flat.v30 - -3) < 1e-9, '-6 mg/dL an hour → -3 over 30 min');
    assert.ok(Math.abs(drift.v15 - flat.v15 - -1.5) < 1e-9);
  });
}

console.log('graph forecasts');

{
  const F = await import('../../engine/forecast');
  test('forecast lines: trend 30 min, the on-board curve, past frozen curves', () => {
    const T = Date.parse('2026-10-02T12:00:00Z'), M = 60000;
    const last = { t: T - 2 * M, v: 140 };
    const tr = F.trendForecast(last, 170, T)!;
    assert.deepEqual(tr.pts[0], last);
    assert.deepEqual(tr.pts[tr.pts.length - 1], { t: last.t + 30 * M, v: 170 });
    assert.ok(tr.pts[1].v - last.v > (170 - last.v) / 2, 'steep first, then levelling');
    assert.equal(F.trendForecast({ t: T - 20 * M, v: 140 }, 170, T), null, 'an old reading draws no trend line');
    assert.equal(F.trendForecast(last, null, T), null);

    const iob = { dia: 300, peak: 75 }, ratio = { from: '00:00', cr: 15, isf: 54 };
    // 2 u just given and nothing to eat: the curve only goes down, by 2 × ISF in total, and ends when the insulin is used up
    const down = F.onboardForecast(last, T, [{ t: last.t, units: 2 }], [], iob, 180, ratio)!;
    assert.equal(down.pts[0].v, 140);
    assert.ok(down.pts.every((p, k) => k === 0 || p.v <= down.pts[k - 1].v + 1e-9));
    assert.ok(Math.abs(down.pts[down.pts.length - 1].v - (140 - 2 * 54)) < 3);
    assert.ok(down.pts[down.pts.length - 1].t <= last.t + 300 * M);
    // 30 g and the matching 2 u: it ends about where it started
    const even = F.onboardForecast(last, T, [{ t: last.t, units: 2 }], [{ t: last.t, grams: 30 }], iob, 180, ratio)!;
    assert.ok(Math.abs(even.pts[even.pts.length - 1].v - 140) < 3);
    // the sensor is a few minutes behind: a dose logged after the last reading must pull the curve down, never up
    const late = F.onboardForecast(last, last.t + 5 * M, [{ t: last.t + 4 * M, units: 1 }], [], iob, 180, ratio)!;
    assert.ok(late.pts.every((p) => p.v <= 140 + 1e-9), 'never above the start');
    assert.ok(late.pts[late.pts.length - 1].v < 140 - 40);
    const lateFood = F.onboardForecast(last, last.t + 5 * M, [], [{ t: last.t + 3 * M, grams: 15 }], iob, 180, ratio)!;
    assert.ok(lateFood.pts.every((p) => p.v >= 140 - 1e-9) && lateFood.pts[lateFood.pts.length - 1].v > 180, 'food logged after the reading only raises it');
    assert.equal(F.onboardForecast(last, T, [], [], iob, 180, ratio), null, 'nothing on board: no curve');
    assert.equal(F.onboardForecast(last, T, [{ t: last.t, units: 2 }], [], null, 180, ratio), null, 'no care-team numbers: no curve');

    const rows = [{ key: 'h:a', t0: new Date(T - 3 * 60 * M).toISOString(), curve: [120, 150, 170, 160, 140] }, { key: 'h:c', t0: new Date(T - 60 * M).toISOString(), curve: [130, 140] },
      { key: 'h:b', t0: new Date(T - 30 * 60 * M).toISOString(), curve: [100, 110] }, { key: 'h:d', t0: new Date(T - 5 * 60 * M).toISOString(), curve: Array(25).fill(150) }];
    const past = F.pastForecasts(rows, T - 4 * 60 * M, T);
    assert.equal(past.length, 1, 'one line only: the latest meal in view');
    assert.equal(past[0].key, 'ph:c');
    assert.equal(past[0].pts[1].t, T - 60 * M + 15 * M);
    assert.deepEqual(F.pastForecasts(rows.slice(3), T - 4 * 60 * M, T), [], 'a curve from a meal before the view is not drawn');
  });
}

console.log('next dose');

{
  const D = await import('../../engine/dose');
  test('the gap between rapid doses counts from the last one; a dose in parts counts as one', () => {
    const T = Date.parse('2026-10-02T10:00:00Z'), M = 60000;
    assert.equal(D.doseGap([], T, 120), null);
    assert.equal(D.doseGap([{ t: T - 7 * 60 * M, units: 2 }], T, 120), null, 'nothing in the last 6 hours: no line');
    const g = D.doseGap([{ t: T - 150 * M, units: 2 }, { t: T - 30 * M, units: 2 }, { t: T - 25 * M, units: 1 }], T, 120)!;
    assert.equal(g.lastAt, T - 25 * M); assert.equal(g.lastUnits, 3); assert.equal(g.until, T + 95 * M); assert.equal(g.left, 95 * M);
    assert.ok(Math.abs(g.frac - 25 / 120) < 1e-9);
    const done = D.doseGap([{ t: T - 130 * M, units: 3 }], T, 120)!;
    assert.equal(done.left, 0); assert.equal(done.frac, 1);
    assert.equal(D.doseGap([{ t: T + 10 * M, units: 3 }], T, 120), null, 'a dose logged ahead is not counted yet');
    assert.equal(D.doseGap([{ t: T - 30 * M, units: 3 }], T, 0), null, 'gap switched off');
  });
}

console.log('maker labels');

{
  const I = await import('../../../supabase/functions/carb-product-image/lib');
  test('a maker nutrition table is read per 100, scaled when it is for another amount', () => {
    const page = 'Description Delicious milk Nutrition Facts Per 100 ml. Nutrition Value Energy (Calories) 80 Calories from Fat (g) 18 Total Fat (g) 2 Saturated Fat (g) 1.5 Trans Fat (g) 0 Cholesterol (g) 5 Total Carbohydrate (g) 12 Dietary Fibres (g) 1 Total Sugars (g) 11 Added Sugar (g) 7 Protein (g) 3 Write a review';
    assert.deepEqual(I.parseLabel(page), { basis: 100, unit: 'ml', carbs: 12, kcal: 80, fat: 2, fiber: 1, sugars: 11, protein: 3 });
    const cup = I.parseLabel('Nutrition Facts per 50 g Energy 100 Total Fat 5 Carbohydrates 12 Protein 2');
    assert.equal(cup?.carbs, 24); assert.equal(cup?.unit, 'g'); assert.equal(cup?.kcal, 200);
    assert.equal(I.parseLabel('Nutrition Facts Energy 80 Protein 3'), null, 'no carbohydrate line: nothing');
    assert.equal(I.parseLabel('Delicious milk, no table'), null);
    assert.ok(I.labelAddsUp(I.parseLabel(page)!));
    assert.ok(!I.labelAddsUp({ basis: 100, unit: 'ml', carbs: 13, kcal: 60, fat: 1, protein: 3, fiber: null, sugars: null }), 'carbs that do not match the energy are flagged');
  });
  test('pack size from a product name', () => {
    assert.deepEqual(I.packOf('Mango Nectar 250ml'), { size: 250, unit: 'ml' });
    assert.deepEqual(I.packOf('Apple Juice 1 LTR'), { size: 1000, unit: 'ml' });
    assert.deepEqual(I.packOf('Lactose Free - Full Cream Milk 1LTR'), { size: 1000, unit: 'ml' });
    assert.deepEqual(I.packOf('Labneh ( Full Fat ) 500 GRM.'), { size: 500, unit: 'g' });
    assert.deepEqual(I.packOf('Spicy Tomato Paste 130 Grms'), { size: 130, unit: 'g' });
    assert.deepEqual(I.packOf('Chocolate Protein Milk 20g (No Added Sugar)'), { size: 20, unit: 'g' }, 'the caller checks this against the shop unit');
    assert.equal(I.packOf('Vanilla Lulu Stick'), null);
  });
}

console.log('product portions');

{
  const P = await import('../portion');
  test('a product portion follows its label per 100; the pack comes first', () => {
    const mango = { carbs_per_100: 15, fat_per_100: 0, protein_per_100: null, fiber_per_100: null, kcal_per_100: 60, pack_size: 125, serving_size: 125 };
    const x = P.portion(mango as any, 125);
    assert.equal(x.carbs, 18.8); assert.equal(x.kcal, 75); assert.equal(x.fat, 0); assert.equal(x.protein, null);
    assert.deepEqual(P.amountChoices(mango as any), [{ key: 'pack', amount: 125 }, { key: 'hundred', amount: 100 }]);
    assert.deepEqual(P.amountChoices({ pack_size: 1000, serving_size: 200 } as any), [{ key: 'serving', amount: 200 }, { key: 'hundred', amount: 100 }], 'a 1 L carton is not one portion');
    assert.deepEqual(P.amountChoices({ pack_size: 100, serving_size: null } as any), [{ key: 'pack', amount: 100 }]);
  });
}

console.log('low treatments');
{
  const { usualLowTreatments } = await import('../lowUsual');
  test('what she usually takes for a low: treatments and drinks logged while low, most used first', () => {
    const h = [
      { name: 'Juice box', total_carbs: 15, glucose_mgdl: 66 }, { name: 'Juice box', total_carbs: 15, glucose_mgdl: 70 },
      { name: 'Rice', total_carbs: 45, glucose_mgdl: 60 },            // a meal, not a treatment
      { name: 'Crackers', total_carbs: 12, glucose_mgdl: 140 },       // not low
      { name: 'Crackers', total_carbs: 12, glucose_mgdl: null },
    ];
    const e = [{ kind: 'treatment', treatment: 'Tablets', carbs_g: 8 }, { kind: 'treatment', treatment: 'Juice box', carbs_g: 15, deleted_at: 'x' }, { kind: 'carbs', treatment: null, carbs_g: 20 }];
    assert.deepEqual(usualLowTreatments(h, e), [{ name: 'Juice box', carbs: 15, n: 2 }, { name: 'Tablets', carbs: 8, n: 1 }]);
    assert.equal(usualLowTreatments(h, e, 1).length, 1);
    assert.deepEqual(usualLowTreatments([], []), []);
  });
}

console.log('search');
{
  const { matches } = await import('../search');
  test('search: every word must match; Arabic letter forms, diacritics and case do not matter', () => {
    assert.ok(matches(['شاورما دجاج (لحم فقط)', null], 'شاورما'));
    assert.ok(matches(['أرز أبيض مطبوخ'], 'ارز'));
    assert.ok(matches(['عصير علبة'], 'علبه'));
    assert.ok(matches(['Chicken Nuggets', 'Americana'], 'nugg amer'));
    assert.ok(!matches(['Chicken Nuggets'], 'nuggets fries'));
    assert.ok(matches(['anything'], '  '));
  });
  test('search: the words a parent types for a McDonald\'s order or a school breakfast', () => {
    assert.ok(matches(['Chicken McNuggets 6 pcs', "McDonald's", 'ناجت'], 'تشكن نقت'));
    assert.ok(matches(['World Famous Fries (Regular)', "McDonald's", 'نشويات'], 'ماكدونالدز'));
    assert.ok(matches(['1.2.3 Cocktail Drink (Kids) 125ml', 'KDD', 'مشروبات'], 'عصير كوكتيل'), 'a fruit drink is «عصير»');
    assert.ok(matches(['Samoon', null, 'خبز'], 'صمونه'));
    assert.ok(matches(['Turkey Breast Slices', null, 'لحوم'], 'تركي'));
  });
  test('search: either language finds the item (foods, types and brands), whole words only', () => {
    assert.ok(matches(['Milk Toast With Vitamin D3', 'المطاحن', 'توست'], 'توست'));
    assert.ok(matches(['Milk Toast With Vitamin D3', 'المطاحن'], 'توست المطاحن'));
    assert.ok(matches(['White Soft Bread', 'المطاحن', 'خبز'], 'kfmb bread'));
    assert.ok(matches(['عسل', null, 'حلويات'], 'honey'));
    assert.ok(matches(['قشطة قيمر (Thick Cream)', 'KDD'], 'قشطه'));
    assert.ok(matches(['قشطة قيمر (Thick Cream)', 'KDD'], 'cream'));
    assert.ok(matches(['Chocolate Ice Cream 5 LTR', 'KDD'], 'ايس كريم'));
    assert.ok(matches(['Chicken Nuggets', 'Americana', 'ناجت'], 'دجاج'));
    assert.ok(matches(['مرق دجاج كويتي مع عيش'], 'rice'), 'in Kuwait «عيش» is rice');
    assert.ok(matches(['Sliced White Bread', 'لوزين'], 'lusine'));
    assert.ok(matches(['شاورما دجاج بدون خبز + ثوم'], 'shawarma'));
    assert.ok(matches(['Royale Yoghurt(Fresh Full Cream) 180 GRM'], 'روب'));
    // part of another word does not count: "ice" is not in "rice", «لبن» (laban) is not «لبنة» (labneh)
    assert.ok(!matches(['أرز أبيض مطبوخ'], 'ice cream'));
    assert.ok(!matches(['Labneh ( Full Fat ) 250 GRM'], 'laban'));
    assert.ok(!matches(['Orange Juice'], 'تفاح'));
    assert.ok(!matches(['أرز أبيض مطبوخ', 'Apple Juice'], 'ice'), 'a word is matched from its start');
    assert.ok(matches(['Chocolate Ice Cream Cups'], 'ice'));
    assert.ok(matches(['Toast'], 'توس'), 'while typing');
    assert.ok(matches(['White Soft Bread'], 'الخبز'));
    assert.ok(!matches(['1.2.3 Full Cream Milk (Kids)', 'KDD'], 'قشطه'), 'full cream milk is milk, not قشطة');
    assert.ok(!matches(['Ritz Crackers 39.6g (12 pcs)'], '1.2.3'));
  });
}

console.log('dietitian sheet');
{
  const D = await import('../dietSheet');
  // a made-up day (Kuwait midnight = 21:00 UTC the day before): readings every 5 minutes
  const day = Date.UTC(2026, 0, 9, 21), M = 60000, at = (h: number, m = 0) => day + (h * 60 + m) * M;
  const pts: [number, number][] = [];
  for (let k = 0; k < 288; k++) {
    const t = day + k * 5 * M, h = k / 12;
    // breakfast at 7:00 rises to 180 at 8:00, back to 110 by 10:00; dinner at 19:00 dips, then a late rise from 22:00 to 23:00
    let v = 110;
    if (h >= 7 && h < 10) v = h < 8 ? 110 + (h - 7) * 70 : 180 - (h - 8) * 35;
    if (h >= 19 && h < 24) v = h < 21 ? 110 - (h - 19) * 20 : h < 22 ? 70 : h < 23 ? 70 + (h - 22) * 60 : 130;
    if (h >= 2 && h < 2.5) v = 62;   // a 30-minute low at night
    pts.push([t, v]);
  }
  const series = { t: Float64Array.from(pts.map((p) => p[0])), v: Float64Array.from(pts.map((p) => p[1])) };
  const food = (t: number, name: string, carbs: number, fat: number | null = null, protein: number | null = null) => ({ t, name, detail: null, carbs, fat, protein, kcal: null, fiber: null });
  const sheet = D.buildDay(day, D.DEFAULT_STARTS, {
    foods: [food(at(7), 'Toast', 30, 3, 5), food(at(7, 5), 'Milk', 12, 4, 4), food(at(15), 'Rice', 45), food(at(19), 'Nuggets + fries', 58, 31, 19), food(at(0, 30), 'Late snack', 10)],
    doses: [{ t: at(6, 50), units: 3, type: 'rapid', purpose: 'meal' }, { t: at(18, 55), units: 4, type: 'rapid', purpose: 'meal' }, { t: at(13), units: 1, type: 'rapid', purpose: 'correction' }, { t: at(19, 0), units: 11, type: 'long', purpose: null }],
    pricks: [{ t: at(6, 55), mg: 104 }], treatments: [{ t: at(2, 10), name: 'Juice', carbs: 15 }], activities: [{ t: at(17), text: 'Swimming 30 min' }],
    series, low: 70, high: 180,
  });
  const s = Object.fromEntries(sheet.slots.map((x) => [x.key, x]));
  test('dietitian sheet: foods go to their column by time; night food and low treatments are kept apart', () => {
    assert.deepEqual(s.breakfast.foods.map((f) => f.name), ['Toast', 'Milk']); assert.equal(s.breakfast.carbs, 42);
    assert.deepEqual(s.lunch.foods.map((f) => f.name), ['Rice']); assert.equal(s.snack1.foods.length, 0);
    assert.deepEqual(sheet.night.map((f) => f.name), ['Late snack']);
    assert.deepEqual(sheet.treatments.map((x) => x.name), ['Juice']);
    assert.equal(sheet.totals.carbs, 42 + 45 + 58 + 10, 'low treatments are not counted as food');
  });
  test('dietitian sheet: before eating prefers a finger-prick; after = the reading 2 hours after the meal starts', () => {
    assert.deepEqual(s.breakfast.before, { mg: 104, t: at(6, 55), prick: true });
    assert.equal(s.breakfast.after!.t, at(9)); assert.equal(Math.round(s.breakfast.after!.mg), 145);
    assert.equal(s.lunch.before!.prick, false);
  });
  test('dietitian sheet: insulin goes with its meal; the rest (corrections) and Tresiba are listed apart', () => {
    assert.deepEqual(s.breakfast.doses.map((x) => x.units), [3]); assert.deepEqual(s.dinner.doses.map((x) => x.units), [4]);
    assert.deepEqual(s.lunch.doses, [], 'the 13:00 dose is 2 hours before lunch');
    assert.deepEqual(sheet.otherDoses.map((x) => x.units), [1]); assert.equal(sheet.totals.basal, 11); assert.equal(sheet.totals.rapid, 8);
  });
  test('dietitian sheet: fatty meal noted, missing fat said so, and a late rise found 2–5 h after', () => {
    assert.equal(s.dinner.fatty, true); assert.equal(s.breakfast.fatty, false); assert.equal(s.lunch.noFatData, true);
    assert.ok(s.dinner.bump, 'dinner had a late rise'); assert.ok(s.dinner.bump!.rise >= 36); assert.ok(s.dinner.bump!.peakAt > at(22) && s.dinner.bump!.peakAt <= at(24));
    assert.equal(s.breakfast.bump, null, 'falling after breakfast is no late rise');
    assert.equal(D.lateBump(series, at(19), [at(21)]), null, 'food eaten before the rise explains it');
  });
  test('dietitian sheet: the day\'s glucose and its lows', () => {
    assert.equal(sheet.lows.length, 1); assert.equal(sheet.lows[0].nadir, 62); assert.ok(sheet.lows[0].minutes >= 25);
    assert.ok(sheet.glucose.inRange! > 80); assert.equal(sheet.glucose.min, 62);
    assert.equal(D.slotOf(4 * 60 + 59, D.DEFAULT_STARTS), null); assert.equal(D.slotOf(16 * 60, D.DEFAULT_STARTS), 'snack2');
  });
}

console.log('short names');
{
  const { shortName } = await import('../shortName');
  test('short names on food cards: no kids/sugar/flavour notes, the cup size for big packs, the full name when nothing is left', () => {
    const cases: [string, string][] = [
      ['1.2.3 Full Cream Milk (Kids) 125ml', '1.2.3 Milk 125ml'],
      ['Apple Juice 1 LTR (كوب 200 مل)', 'Apple Juice 200ml'],
      ['Mojito (lemon & mint) Beverage (0% Sugar) 250ml', 'Mojito 250ml'],
      ['Premium Chocolate Milk (No Added Sugar) 250ML', 'Chocolate Milk 250ml'],
      ['Strawberry Ice Cream Cups (No Added Sugar) (كوب 94 غ)', 'Strawberry Ice Cream 94g'],
      ['Lactose Free - Full Cream Milk 1LTR (كوب 200 مل)', 'Lactose-free Milk 200ml'],
      ['سناك بار / بسكويت (101 سعرة)', 'سناك بار / بسكويت'],
      ['Ritz Crackers 39.6g (12 pcs)', 'Ritz Crackers 39.6g (12 pcs)'],
      ['عصير علبة', 'عصير علبة'],
      ['(Kids)', '(Kids)'],
    ];
    for (const [a, b] of cases) assert.equal(shortName(a), b, a);
  });
}

console.log('product groups');
{
  const { groupOf, groupsIn, typesIn } = await import('../productGroups');
  test('product groups: categories gather into groups; a brand shows only its groups, with counts, then the types inside', () => {
    assert.equal(groupOf('روب').key, 'dairy'); assert.equal(groupOf('آيس كريم').key, 'sweets'); assert.equal(groupOf('شيء جديد').key, 'other'); assert.equal(groupOf(null).key, 'other');
    const kdd = [{ category: 'حليب' }, { category: 'حليب' }, { category: 'لبن' }, { category: 'مشروبات' }, { category: 'آيس كريم' }, { category: 'غريب' }];
    assert.deepEqual(groupsIn(kdd).map((x) => [x.group.key, x.n]), [['dairy', 3], ['drinks', 1], ['sweets', 1], ['other', 1]]);
    assert.deepEqual(typesIn(kdd, 'dairy'), [{ cat: 'حليب', n: 2 }, { cat: 'لبن', n: 1 }]);
  });
}

console.log('frequent foods');
{
  const { rankQuick } = await import('../quickRank');
  test('frequent foods: most logged first (history or one-tap uses), then most recent, then name', () => {
    const q = (name: string, uses: number, last_used: string | null = null) => ({ name, uses, last_used });
    const items = [q('B juice', 0), q('A milk', 0), q('Cocktail', 1), q('Sandwich', 4), q('C bar', 0, '2026-10-02T10:00:00Z')];
    const history = [{ name: 'Cocktail' }, { name: 'Cocktail' }, { name: 'Cocktail' }, { name: 'Sandwich' }, { name: 'Rice' }];
    assert.deepEqual(rankQuick(items, history).map((x) => x.name), ['Sandwich', 'Cocktail', 'C bar', 'A milk', 'B juice']);
  });
}

console.log('iphone widget');
{
  const { widgetLoader } = await import('../widgetScript');
  const body = readFileSync(new URL('../../../public/widget/layan-widget.js', import.meta.url), 'utf8');
  // a stand-in for Scriptable: every object accepts anything; texts added to the widget are recorded
  const U: any = new Proxy(function () {}, { get: (_t, p) => (p === 'then' ? undefined : U), apply: () => U, construct: () => U, set: () => true });
  type Opts = { throws?: boolean; cache?: unknown; en?: boolean; code?: string | null; savedCode?: string };
  // Scriptable's API is global, so widget runs take turns (the tests themselves run side by side)
  let turn: Promise<unknown> = Promise.resolve();
  const run = (family: string, reply: unknown, opts: Opts = {}) => { const r = turn.then(() => runOne(family, reply, opts)); turn = r.catch(() => {}); return r; };
  const runOne = async (family: string, reply: unknown, opts: Opts) => {
    const texts: string[] = []; let shown = false; let req: any = null; const files = new Map<string, string>();
    if (opts.cache !== undefined) files.set('d/layan-widget.json', JSON.stringify(opts.cache));
    if (opts.savedCode) files.set('d/layan-widget-code.js', opts.savedCode);
    const node = (): any => new Proxy({}, { set: () => true, get: (_t, p) => p === 'then' ? undefined : p === 'addText' ? (x: string) => { texts.push(String(x)); return U; } : p === 'addStack' ? () => node() : U });
    function Request(this: any, url: string) {
      this.url = url;
      if (url.endsWith('/widget/layan-widget.js')) {
        this.loadString = async () => { if (opts.code === null) throw new Error('offline'); this.response = { statusCode: 200 }; return opts.code ?? body; };
      } else {
        if (url.endsWith('.png')) { this.loadImage = async () => U; return; }
        req = this;
        this.loadJSON = async () => { if (opts.throws) throw new Error('offline'); return reply; };
      }
    }
    const fm = { joinPath: (a: string, b: string) => a + '/' + b, cacheDirectory: () => 'd', fileExists: (p: string) => files.has(p), readString: (p: string) => files.get(p), writeString: (p: string, v: string) => { files.set(p, v); } };
    const script = widgetLoader({ url: 'https://x.supabase.co', key: 'pk', token: 'tok"en', app: 'https://app/', lang: opts.en ? 'en' : 'ar' });
    const AsyncFn = Object.getPrototypeOf(async function () {}).constructor;
    const g = globalThis as any;
    Object.assign(g, { Request, FileManager: { local: () => fm }, ListWidget: function () { return node(); }, DrawContext: U, Color: U, Font: U, Rect: U, SFSymbol: U,
      Size: function (this: any, w: number, h: number) { this.width = w; this.height = h; }, Device: { screenSize: () => ({ width: 393, height: 852 }) },
      Script: { setWidget: () => { shown = true; }, complete: () => {} }, config: { widgetFamily: family, runsInWidget: true }, args: { widgetParameter: null } });
    try { await new AsyncFn(script)(); } finally { for (const k of ['Request', 'FileManager', 'ListWidget', 'DrawContext', 'Color', 'Font', 'Size', 'Rect', 'SFSymbol', 'Device', 'Script', 'config', 'args']) delete g[k]; }
    return { texts: texts.join(' | '), shown, req, files };
  };
  const now = Date.now(), at = (m: number) => new Date(now - m * 60000).toISOString();
  const data = { child: 'ليان', unit: 'mmol', low: 70, high: 180, readings: [{ t: at(30), v: 150, trend: 3 }, { t: at(15), v: 120, trend: 2 }, { t: at(2), v: 110, trend: 2 }] };
  test('widget: the loader fetches the widget from the app and runs it; value, arrow, age, range word; every size draws', async () => {
    assert.ok(body.startsWith('// LAYAN_WIDGET'), 'the served widget starts with the mark the loader checks');
    const m = await run('medium', data);
    assert.ok(m.shown);
    const clock = (() => { const x = new Date(now - 2 * 60000); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); })();
    assert.match(m.texts, /ليان/); assert.match(m.texts, /6\.1/); assert.match(m.texts, /↘/); assert.match(m.texts, /−0\.6/); assert.ok(m.texts.includes(clock), 'the reading\'s time');
    const sm = (await run('small', data)).texts;
    assert.match(sm, /6\.1/); assert.match(sm, /قبل 2 د/);
    assert.equal(m.req.url, 'https://x.supabase.co/rest/v1/rpc/share_view');
    assert.deepEqual(JSON.parse(m.req.body), { p_token: 'tok"en' }, 'the token is embedded safely');
    assert.equal(m.req.headers['Content-Profile'], 'carb');
    assert.equal(m.files.get('d/layan-widget-code.js'), body, 'the widget is kept for offline use');
    for (const f of ['small', 'large', 'accessoryInline', 'accessoryCircular', 'accessoryRectangular']) assert.match((await run(f, data)).texts, /6\.1/, f);
  });
  test('widget: offline uses the kept widget; a page that is not the widget is never run; nothing kept says so', async () => {
    assert.match((await run('small', data, { code: null, savedCode: body })).texts, /6\.1/);
    assert.match((await run('small', data, { code: '<html>not found</html>' })).texts, /تعذّر تحميل الويدجت/);
    assert.match((await run('small', data, { code: null })).texts, /تعذّر تحميل الويدجت/);
  });
  test('widget: IOB and COB match the app (engine/iob.ts) for the same doses and carbs', async () => {
    const ob = { dia: 360, peak: 65, absorb: 180, doses: [{ t: at(50), u: 3 }, { t: at(200), u: 4 }, { t: at(400), u: 2 }], carbs: [{ t: at(50), g: 45 }, { t: at(120), g: 15 }, { t: at(200), g: 30 }] };
    const P = { dia: 360, peak: 65 };
    const iob = iobAt(now, ob.doses.map((d) => ({ t: Date.parse(d.t), units: d.u })), P);
    const cob = cobAt(now, ob.carbs.map((c) => ({ t: Date.parse(c.t), grams: c.g })), 180);
    const m = await run('accessoryRectangular', { ...data, onboard: ob });
    const got = /IOB ([\d.]+)u  COB (\d+)g/.exec(m.texts);
    assert.ok(got, m.texts);
    assert.ok(Math.abs(Number(got![1]) - iob) <= 0.051 && Math.abs(Number(got![2]) - cob) <= 0.51, `${got![0]} vs IOB ${iob} COB ${cob}`);
    const circ = (await run('accessoryCircular', { ...data, onboard: ob })).texts;
    assert.ok(circ.includes(got![1] + 'u') && circ.includes(got![2] + 'g') && /6\.1/.test(circ), 'the lock-screen circle shows both: ' + circ);
    const med = (await run('medium', { ...data, onboard: ob })).texts;
    assert.ok(med.includes(got![1] + 'u') && med.includes(got![2] + 'g'), 'the side panel shows both: ' + med);
    assert.doesNotMatch((await run('medium', { ...data, onboard: { ...ob, dia: null, peak: null, absorb: null } })).texts, /IOB|COB/, 'nothing when the care team has not set the parameters');
    assert.doesNotMatch((await run('medium', data)).texts, /IOB/, 'family links carry no onboard data');
  });
  test('widget: low, old reading, revoked link, offline with and without a saved copy, English', async () => {
    assert.match((await run('small', { ...data, readings: [{ t: at(1), v: 62, trend: 1 }] })).texts, /3\.4.*⇊/);
    const old = (await run('small', { ...data, readings: [{ t: at(40), v: 120, trend: 3 }] })).texts;
    assert.match(old, /قراءة قديمة/); assert.doesNotMatch(old, /→/, 'no arrow on an old reading');
    assert.match((await run('medium', { error: 'invalid' })).texts, /الرابط انتهى/);
    assert.match((await run('medium', null, { throws: true })).texts, /لا اتصال/);
    assert.match((await run('medium', null, { throws: true, cache: data })).texts, /بلا اتصال/);
    assert.match((await run('medium', { ...data, readings: [] })).texts, /لا توجد قراءات/);
    assert.match((await run('small', data, { en: true })).texts, /2 min ago/, 'in English when the app is');
  });
}

{
  const { whyNotLike, lastSimilar, groupsOf, patternOf, evidenceOf } = await import('../../engine/planCompare');
  const { DEFAULT_RULES } = await import('../../engine/planReview');
  const D = 86400000, T0 = Date.UTC(2026, 0, 10, 4);
  // synthetic meals only
  const meal = (k: number, o: Partial<import('../../engine/planCompare').PlanFacts> = {}): import('../../engine/planCompare').PlanFacts => ({
    id: `m${k}`, key: 'r1', name: 'Test breakfast', at: T0 + k * D, carbs: 40, start: 120, level: 0, iob: 0, calc: 3, given: 3, reason: null,
    cr: 15, isf: 54, correction: 0, interval: 10, part: 1, outcome: 'in_target', quality: 'high', comparable: true, notComparable: [],
    peak: 200, last: 130, ttp: 60, rise: 80, lowAfterMin: null, lowMin: null, highMin: null, endedBy: null, cleanMin: 360, contributors: [], note: null, ...o,
  });

  test('comparable meals: carbs ±25%, start ±2 mmol/L, same direction, IOB ±0.5 U, and each one comparable', () => {
    const a = meal(0);
    assert.deepEqual(whyNotLike(a, meal(1, { carbs: 48 }), DEFAULT_RULES), []);
    assert.deepEqual(whyNotLike(a, meal(1, { carbs: 52 }), DEFAULT_RULES), ['carbs:30']);
    assert.deepEqual(whyNotLike(a, meal(1, { start: 160 }), DEFAULT_RULES), ['start:40']);
    assert.deepEqual(whyNotLike(a, meal(1, { level: -1 }), DEFAULT_RULES), ['direction']);
    assert.deepEqual(whyNotLike(a, meal(1, { iob: 0.8 }), DEFAULT_RULES), ['iob:0.8']);
    assert.deepEqual(whyNotLike(a, meal(1, { comparable: false, notComparable: ['ended:95'] }), DEFAULT_RULES), ['ended:95']);
    // unknown start or arrow is not a reason (planning ahead)
    assert.deepEqual(whyNotLike({ carbs: 40, start: null, level: null, iob: null }, meal(1), DEFAULT_RULES), []);
  });

  test('last 3 similar: the same meal only, newest first, each with its reasons', () => {
    const past = [meal(1), meal(2, { carbs: 80 }), meal(3), meal(4, { key: 'other' }), meal(5)];
    const r = lastSimilar('r1', { carbs: 40, start: null, level: null, iob: null }, past, DEFAULT_RULES);
    assert.deepEqual(r.map((x) => x.p.id), ['m5', 'm3', 'm2']);
    assert.deepEqual(r[2].why, ['carbs:100']);
  });

  test('a pattern needs 3 comparable meals; the excluded say why', () => {
    const two = groupsOf([meal(1), meal(2), meal(3, { comparable: false, notComparable: ['part:0.5'] })], DEFAULT_RULES)[0];
    assert.equal(two.comparable.length, 2);
    assert.deepEqual(two.excluded[0].why, ['part:0.5']);
    assert.equal(patternOf(two.comparable, DEFAULT_RULES), null);
    const g = groupsOf([meal(1, { outcome: 'high' }), meal(2, { outcome: 'high', given: 2 }), meal(3, { outcome: 'high', given: 2 }), meal(4)], DEFAULT_RULES)[0];
    const p = patternOf(g.comparable, DEFAULT_RULES)!;
    assert.equal(p.n, 4);
    assert.equal(p.outcomes.high, 3);
    assert.deepEqual(p.repeats.map((r) => r.key), ['went_high']); // gave less only 2 of 4: not repeated enough
  });

  test('care-team evidence names a setting and the meals, never a value', () => {
    const highs = [1, 2, 3].map((k) => meal(k, { outcome: 'high' }));
    const ev = evidenceOf([...highs, meal(4)], DEFAULT_RULES, [99, 117]);
    assert.deepEqual(ev.map((e) => [e.setting, e.finding, e.n, e.of]), [['icr', 'high_after_calc', 3, 4]]);
    assert.deepEqual(ev[0].ids, ['m1', 'm2', 'm3']);
    // the dose given was lower than calculated: not evidence about the ratio
    assert.deepEqual(evidenceOf([1, 2, 3].map((k) => meal(k, { outcome: 'high', given: 2 })), DEFAULT_RULES, null), []);
    // late lows point at the insulin-action time; early rises at the timing
    assert.deepEqual(evidenceOf([1, 2, 3].map((k) => meal(k, { outcome: 'low', lowAfterMin: 200 })), DEFAULT_RULES, null).map((e) => e.setting), ['dia']);
    assert.deepEqual(evidenceOf([1, 2, 3].map((k) => meal(k, { contributors: ['early_rise_interval'] })), DEFAULT_RULES, null).map((e) => e.setting), ['timing']);
    assert.ok(!JSON.stringify(ev).match(/units|ratio_to|suggest/));
  });
}

{
  const { basalStretches, basalSummary, atNight } = await import('../../engine/basal');
  const { mergeSeries, emptySeries } = await import('../../engine/series');
  const M = 60000, H = 3600000, T = Date.UTC(2026, 0, 10, 16); // synthetic, 16:00 UTC
  // readings every 5 min for 16 h: flat 150 until 22:00, then falling 30 mg/dL per hour
  const t: number[] = [], v: number[] = [];
  for (let m = 0; m <= 16 * 60; m += 5) { t.push(T + m * M); v.push(m < 360 ? 150 : 150 - (m - 360) / 2); }
  const s = mergeSeries(emptySeries(), t, v);
  test('long-acting-only stretches: 6 h after rapid insulin, 3 h after food, while the log is kept', () => {
    const marks = [{ t: T, kind: 'rapid' as const }, { t: T + 30 * M, kind: 'food' as const }, { t: T + 14 * H, kind: 'treatment' as const }];
    const long = [{ t: T - H, units: 11 }];
    const st = basalStretches(s, marks, long, 70, T, T + 16 * H);
    assert.equal(st.length, 1);
    assert.equal(st[0].from, T + 6 * H);                 // 6 h after the rapid dose
    assert.equal(st[0].to, T + 14 * H - 5 * M);          // until the treatment
    assert.equal(st[0].endedBy, 'treatment');
    assert.ok(Math.abs(st[0].rate - -24) < 7, `rate ${st[0].rate}`);
    assert.equal(st[0].low, true);
    assert.deepEqual(st[0].long, { t: T - H, units: 11 });
    // without a logged long-acting dose nothing is shown (the log may be incomplete)
    assert.equal(basalStretches(s, marks, [], 70, T, T + 16 * H).length, 0);
    const sum = basalSummary(st, { rapid_gap_min: 360, food_gap_min: 180, min_len_min: 60, fall_mgdl_h: 18 }, () => 'n1');
    assert.deepEqual([sum.n, sum.falling, sum.low, sum.treated, sum.nights], [1, 1, 1, 1, 1]);
    assert.equal(atNight(st[0], (ms) => new Date(ms).getUTCHours() * 60, '20:30', '06:30'), true);
    assert.equal(atNight({ ...st[0], from: T + H, to: T + 3 * H }, (ms) => new Date(ms).getUTCHours() * 60, '20:30', '06:30'), false); // 17:00–19:00: daytime
  });
}

test('Frosties is found by «كورن فليكس», «كورنفليكس» and «النمر»', async () => {
  const { matches } = await import('../search');
  for (const q of ['كورن فليكس', 'كورنفليكس', 'النمر', 'frosties', 'كيلوقز']) assert.ok(matches(["Kellogg's Frosties", "Kellogg's", 'نشويات'], q), q);
});

test('Topi cheese is found by «توبي» and «جبن»', async () => {
  const { matches } = await import('../search');
  for (const q of ['توبي', 'جبن', 'cheese', 'topi', 'موراتبي']) assert.ok(matches(['Topi Cheese (كرات جبن طازجة) 200g', 'Muratbey', 'جبن'], q), q);
});

{
  const { treatRechecksDue, treatRecheckMessage } = await import('../../../supabase/functions/carb-glucose/alerts');
  const M = 60000, T = Date.UTC(2026, 9, 5, 0, 0);
  const r = (id: string, m: number, sent: string | null = null) => ({ id, occurred_at: new Date(T + m * M).toISOString(), recheck_sent_at: sent });
  test('a recheck push 15 min after every low treatment, once, not for an older one or a planned meal', () => {
    assert.deepEqual(treatRechecksDue([r('a', 0)], T + 10 * M).map((x) => x.id), [], 'not yet');
    assert.deepEqual(treatRechecksDue([r('a', 0)], T + 15 * M).map((x) => x.id), ['a']);
    assert.deepEqual(treatRechecksDue([r('a', 0, 'x')], T + 16 * M), [], 'sent already');
    assert.deepEqual(treatRechecksDue([r('a', 0), r('b', 5)], T + 16 * M).map((x) => x.id), [], 'a newer juice has its own timer');
    assert.deepEqual(treatRechecksDue([r('a', 0), r('b', 5)], T + 20 * M).map((x) => x.id), ['b']);
    assert.deepEqual(treatRechecksDue([r('a', 0)], T + 15 * M, 15, new Set(['a'])), [], 'a planned meal reminds itself');
    assert.deepEqual(treatRechecksDue([r('a', 0)], T + 50 * M), [], 'too late to be useful');
    assert.equal(treatRecheckMessage('ar').title, '🟠 أعيدوا قياس السكر');
    assert.equal(treatRecheckMessage('en', null, 15).body, '15 min since the low treatment');
  });
}

{
  const M = await import('../../engine/mom');
  const prod = (id: string, o: Record<string, unknown> = {}) => ({ id, name: id, brand: null, category: 'نشويات', kind: 'commercial', image_path: null, pack_size: null, unit: 'g', carbs_per_100: 87, fat_per_100: 0.6, fiber_per_100: 2, protein_per_100: 4.5, kcal_per_100: 375, serving_size: null, carbs_per_serving: null, label_basis: 'as_sold', cooked_yield: null, available: true, approved: true, ...o }) as any;
  const cat = {
    products: [prod('frost'), prod('milk', { unit: 'ml', carbs_per_100: 4.7, category: 'حليب' }), prod('new', { approved: false })],
    recipes: [{ id: 'r1', name: 'مجبوس', category: null, image_path: null, instructions: null, notes: null, approved: true, favorite: false, carb_pending: false, pending_note: null, saved_total_carbs: null }] as any,
    ingsByRecipe: new Map([['r1', [{ id: 'i1', role: 'main', product_id: 'frost', slot_category: null, label: null, quantity: 40, unit: 'g', state: 'as_is', qty_confirmed: true, note: null, sort: 0 }]]]) as any,
    portions: [{ id: 'p1', product_id: 'frost', recipe_id: null, label: 'صحن ليان الصغير', amount: 30, photo_path: null, sort: 0 },
      { id: 'p2', product_id: 'milk', recipe_id: null, label: 'كوب ليان', amount: 150, photo_path: null, sort: 0 },
      { id: 'p3', product_id: null, recipe_id: 'r1', label: 'صحن كبير', amount: 1.5, photo_path: null, sort: 0 }],
  };
  test('mom meal: portions become plan items (product amount, recipe ingredients scaled); a missing portion never guesses', () => {
    assert.deepEqual(M.planItemsOf({ kind: 'product', id: 'frost', portion_id: 'p1' }, cat)!.map((i) => [i.product_id, i.quantity, i.unit]), [['frost', 30, 'g']]);
    assert.deepEqual(M.planItemsOf({ kind: 'product', id: 'milk', portion_id: 'p2' }, cat)!.map((i) => [i.quantity, i.unit, i.role]), [[150, 'ml', 'main']]);
    assert.deepEqual(M.planItemsOf({ kind: 'recipe', id: 'r1', portion_id: 'p3' }, cat)!.map((i) => i.quantity), [60]);
    assert.equal(M.planItemsOf({ kind: 'product', id: 'milk', portion_id: 'p1' }, cat), null, "another product's portion");
    assert.equal(M.planItems([{ kind: 'product', id: 'frost', portion_id: 'p1' }, { kind: 'product', id: 'frost', portion_id: 'zz' }], cat), null);
    assert.equal(M.readyForMom('product', 'frost', cat), true);
    assert.equal(M.readyForMom('product', 'new', cat), false, 'not approved');
    assert.equal(M.readyForMom('product', 'milk', cat), true, 'approved: shown even before Dad sets a portion');
  });
  test('mom meal: an amount chosen on the spot — grams, label servings, recipe plates; nothing without a known size', () => {
    const c2 = { ...cat, products: [...cat.products, prod('toast', { serving_size: 28 })] };
    assert.deepEqual(M.planItemsOf({ kind: 'product', id: 'frost', portion_id: null, amount: 45, unit: 'g' }, c2)!.map((i) => [i.quantity, i.unit]), [[45, 'g']]);
    assert.deepEqual(M.planItemsOf({ kind: 'product', id: 'milk', portion_id: null, amount: 200, unit: 'g' }, c2)!.map((i) => [i.quantity, i.unit]), [[200, 'ml']], 'grams means the product\'s own unit');
    assert.deepEqual(M.planItemsOf({ kind: 'product', id: 'toast', portion_id: null, amount: 2, unit: 'serving' }, c2)!.map((i) => [i.quantity, i.unit]), [[2, 'serving']]);
    assert.equal(M.planItemsOf({ kind: 'product', id: 'frost', portion_id: null, amount: 1, unit: 'serving' }, c2), null, 'no serving size on the label');
    assert.equal(M.planItemsOf({ kind: 'product', id: 'frost', portion_id: null, amount: 0, unit: 'g' }, c2), null, 'no amount');
    assert.deepEqual(M.planItemsOf({ kind: 'recipe', id: 'r1', portion_id: null, amount: 0.5, unit: 'plate' }, c2)!.map((i) => i.quantity), [20]);
  });
  test('mom home word: stale beats everything, then low, falling, high', () => {
    assert.equal(M.moodOf(120, 20, 0, 70, 180), 'stale');
    assert.equal(M.moodOf(null, null, null, 70, 180), 'stale');
    assert.equal(M.moodOf(65, 2, 0, 70, 180), 'low');
    assert.equal(M.moodOf(120, 2, -2, 70, 180), 'falling');
    assert.equal(M.moodOf(90, 2, -1, 70, 180), 'falling');
    assert.equal(M.moodOf(200, 2, 0, 70, 180), 'high');
    assert.equal(M.moodOf(120, 2, 0, 70, 180), 'ok');
  });
  test('injection sites: suggest the one used longest ago; flag overuse; doctor gap countdown', () => {
    const H = 3600000, now = 100 * H;
    const shots = [{ t: now - 2 * H, site: 'belly_r', type: 'rapid' }, { t: now - 30 * H, site: 'belly_l', type: 'rapid' }, { t: now - 80 * H, site: 'thigh_r', type: 'long' }] as any;
    const allowed = ['belly_r', 'belly_l', 'thigh_r', 'thigh_l'] as any;
    assert.equal(M.siteSuggestion(shots, allowed).suggest, 'thigh_l', 'the one left in this cycle');
    // all four used: a new cycle starts at the top of the order (belly right)
    assert.equal(M.siteSuggestion([...shots, { t: now - H, site: 'thigh_l', type: 'rapid' }], allowed).suggest, 'belly_r');
    // arms → belly → legs, right before left; mixing is fine, the cycle waits for the sites not yet used
    const six = ['arm_r', 'arm_l', 'belly_r', 'belly_l', 'thigh_r', 'thigh_l'] as any;
    const at = (sites: string[]) => sites.map((x, k) => ({ t: now - (sites.length - k) * H, site: x, type: 'rapid' })) as any;
    assert.equal(M.siteSuggestion([], six).suggest, 'arm_r', 'starts at the right arm');
    assert.equal(M.siteSuggestion(at(['arm_r']), six).suggest, 'arm_l');
    assert.equal(M.siteSuggestion(at(['arm_r', 'thigh_l']), six).suggest, 'arm_l', 'mixed: the order goes on with what is left');
    assert.equal(M.siteSuggestion(at(['arm_r', 'arm_l', 'belly_r', 'belly_l', 'thigh_r', 'thigh_l']), six).suggest, 'arm_r', 'full cycle: start again');
    assert.equal(M.siteSuggestion(at(['arm_l', 'belly_r', 'belly_l', 'thigh_r', 'thigh_l', 'arm_r']), six).suggest, 'arm_l', 'never the site just used');
    assert.equal(M.siteSuggestion(at(['arm_r', 'arm_l', 'belly_r']), six).used.size, 3);
    const many = Array.from({ length: 6 }, (_, k) => ({ t: now - k * H, site: 'belly_r', type: 'rapid' })) as any;
    assert.deepEqual(M.siteCounts(many, now, allowed).overused, ['belly_r']);
    assert.equal(M.nextRapidAllowed(now - 40 * 60000, 120, now), now + 80 * 60000);
    assert.equal(M.nextRapidAllowed(now - 3 * H, 120, now), null);
  });
}

console.log('releases');

test('the newest release notes are for the version being built', () => {
  const pkg = JSON.parse(readFileSync(new URL('../../../package.json', import.meta.url), 'utf8'));
  const rel = JSON.parse(readFileSync(new URL('../../releases.json', import.meta.url), 'utf8'));
  assert.equal(rel[0].version, pkg.version, 'add an entry at the top of src/releases.json');
  assert.ok(rel[0].notes.length > 0);
  assert.ok(rel[0].notes_en?.length > 0, 'add notes_en (English) to the newest release');
});

await Promise.all(pending);
console.log(`\n${n} tests passed`);
