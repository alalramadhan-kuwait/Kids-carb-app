import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { computeLine, computeMeal, deriveLabel, labelMismatch, levelFor, targetMiss } from '../carbs';
import { blocker, candidatesOf, suggest } from '../suggest';
import { hostFor, loginProblem, redirectRegion, maskEmail, parseLluTimestamp, readingsFromGraph, sha256Hex, toReading, tooSoon } from '../../../supabase/functions/carb-glucose/lib';
import { effectiveRange, formatGlucose, glucoseAge, glucoseLevel, glucoseStatus, mergeReading, toMgdl } from '../glucose';
import { TREND_ICON, TREND_WORDS } from '../../components/Icon';
import { ICONS } from '../../icons/defs';
import { describeEvent, sleepWindow, unitsWord } from '../events';
import { buildMarks, defaultLayers, groupLabel, groupMarks, mealResponse } from '../../engine/events';
import { dayStartOf, dayTitle, dayTotals, lowEpisodes } from '../../engine/day';
import * as DE from '../dayEvents';
import { inWindow, isNight, schoolWindow } from '../schedule';
import { daysFor, solidRuns } from '../../engine/profile';
import { seriesStats } from '../../engine/stats';
import { buildCsv } from '../export';
import { adrrBand, grid, hbgiBand, lbgiBand, riskF, variability } from '../../engine/variability';
import { findPatterns, visible } from '../../engine/patterns';
import { ACT_DELAY_MIN, activityAt, activityFraction, activityPeaks, cobAt, dosesFrom, insulinLane, iobAt, iobFraction, iobParamsOk } from '../../engine/iob';
import { doseSteps, mealChangeDose, suggestDose } from '../../engine/dose';
import { GRID, alignCurve, assess, buildOccurrence, coverage, medianCurve, summary, windowSeries } from '../../engine/meals';
import { ackMessage, alertMessage, evaluate, lowForecast, profileAt, rate15, recipients, type AlertCfg, type OpenAlert } from '../../../supabase/functions/carb-glucose/alerts';
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

test('duplicate guard: the same pen within 15 minutes is asked about (any units); another pen or a later time is not', () => {
  const ev = (o: any) => ({ id: 'x', client_id: 'c', kind: 'insulin', occurred_at: '2026-10-01T12:00:00Z', insulin_units: 4, insulin_type: 'rapid',
    bolus_purpose: null, carbs_g: null, treatment: null, note: null, created_by: 'u', deleted_at: null, ...o });
  const list = [ev({}), ev({ id: 'c1', kind: 'carbs', insulin_units: null, insulin_type: null, carbs_g: 30 })];
  assert.equal(findDuplicate(list, { kind: 'insulin', occurred_at: '2026-10-01T12:06:00Z', insulin_units: 4, insulin_type: 'rapid', carbs_g: null })?.id, 'x');
  // the same pen within 15 minutes is asked about whatever the units (4 and 3.5 can be the same injection)
  assert.equal(findDuplicate(list, { kind: 'insulin', occurred_at: '2026-10-01T12:06:00Z', insulin_units: 3, insulin_type: 'rapid', carbs_g: null })?.id, 'x');
  assert.equal(findDuplicate(list, { kind: 'insulin', occurred_at: '2026-10-01T12:14:00Z', insulin_units: 4.5, insulin_type: 'rapid', carbs_g: null })?.id, 'x');
  assert.equal(findDuplicate(list, { kind: 'insulin', occurred_at: '2026-10-01T12:06:00Z', insulin_units: 4, insulin_type: 'long', carbs_g: null }), null, 'another pen is another dose');
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
  assert.deepEqual(s, [], 'first reading under the limit: not yet');
  s = evaluate(at(5), [rd(0, 66), rd(5, 64)], CFG, [], true);
  assert.deepEqual(s.map((x) => [x.kind, x.op, x.patch.state, x.notify]), [['low', 'create', 'active', 'alert']]);
  assert.deepEqual(evaluate(at(5), [rd(0, 66), rd(5, 75)], CFG, [], true), [], 'recovered within the delay');
});

// a clean minute-by-minute fall: `slope` mg/dL a minute from `from`, ending at minute `end`
const fallMin = (end: number, from: number, slope: number, n = 11, trend = 2) => Array.from({ length: n }, (_, i) => ({ taken_at: new Date(at(end - (n - 1) + i)).toISOString(), mg_dl: Math.round(from + slope * i), trend }));

test('low expected means it: a real, still-continuing fall that will reach the LOW limit; one episode, one alert', () => {
  const cfg: AlertCfg = { ...CFG, predictLowMin: 20 };
  const fall = fallMin(10, 108, -2);                                           // now 88, falling 2 a minute
  let s = evaluate(at(10), fall, cfg, [], true);
  assert.deepEqual(s.map((x) => [x.kind, x.patch.state]), [['predicted_low', 'pending']]);
  const f = lowForecast(fall, 70, 20)!; assert.ok(f.ok && f.eta! > 0 && f.eta! <= 20);
  const pend = { ...open({ state: 'pending', active_at: null, last_notified_at: null }), kind: 'predicted_low' as const, id: 'p' };
  s = evaluate(at(12), fallMin(12, 110, -2, 13), cfg, [pend], true);          // still falling a minute later: told once
  assert.equal(s.find((x) => x.kind === 'predicted_low')!.notify, 'alert');
  assert.equal(evaluate(at(10), fallMin(10, 140, 0), cfg, [], true).length, 0, 'steady: nothing');
  assert.equal(evaluate(at(10), fall, { ...cfg, predictOn: false }, [], true).length, 0, 'switched off');
});

test('low expected: the screenshot case. Flat at 88 after a fall, steady arrow: no warning, and an open one is cancelled at once', () => {
  const cfg: AlertCfg = { ...CFG, predictLowMin: 20 };
  const flat = [...fallMin(6, 103, -2, 8), ...[7, 8, 9, 10].map((m) => rd(m, 89 - (m % 2) * 0))].map((r) => ({ ...r, trend: 3 })); // fell, then flat at 89 on a steady arrow
  assert.equal(lowForecast(flat, 70, 20)?.ok ?? false, false);
  const act = { ...open({ kind: 'predicted_low', value_mgdl: 89 }), id: 'p' };
  const s = evaluate(at(10), flat, cfg, [act], true);
  assert.deepEqual(s.map((x) => [x.op, x.notify]), [['resolve', undefined]], 'no 5-minute hold: gone now');
  const bounce = [...fallMin(8, 108, -2, 9), rd(9, 96)]; // a bounce
  assert.equal(lowForecast(bounce, 70, 20)?.ok ?? false, false);
  assert.equal(lowForecast(fallMin(10, 108, -0.9, 11, 3), 70, 20)?.ok ?? false, false, 'a gentle fall on a steady arrow is not a warning');
});

test('one episode, one alert: expected → low → very low is the same row moving up, announced each time, never blocked by the cooldown', () => {
  const cfg: AlertCfg = { ...CFG, predictLowMin: 20 };
  const exp = { ...open({ kind: 'predicted_low', progress: [{ k: 'predicted_low', at: new Date(at(0)).toISOString() }], last_notified_at: new Date(at(0)).toISOString() }), id: 'e' };
  const rs = (v: number) => [rd(5, v + 2), rd(10, v)];
  let s = evaluate(at(10), rs(66), cfg, [exp], true);                          // fell through the limit (and the 5-minute delay is met)
  const up = s.find((x) => x.id === 'e')!;
  assert.equal(up.patch.kind, 'low'); assert.equal(up.patch.state, 'active'); assert.equal(up.notify, 'alert');
  assert.equal(s.filter((x) => x.op === 'create').length, 0, 'no second alert');
  assert.deepEqual((up.patch.progress as { k: string }[]).map((x) => x.k), ['predicted_low', 'low']);
  const low = { ...open({ kind: 'low', progress: up.patch.progress as OpenAlert['progress'] }), id: 'e' };
  s = evaluate(at(12), [rd(12, 50)], cfg, [low], true);
  assert.equal(s[0].patch.kind, 'urgent_low'); assert.equal(s[0].notify, 'alert'); assert.equal(s.length, 1);
  // a recently ended "expected" is in cooldown, but an episode that gets worse is never held back by it
  const rec = [{ id: 'old', kind: 'predicted_low' as const, started_at: new Date(at(-20)).toISOString(), resolved_at: new Date(at(-8)).toISOString() }];
  assert.deepEqual(evaluate(at(10), fallMin(10, 108, -2), cfg, [], true, rec), [], 'predicted again too soon, not imminent: quiet');
  assert.equal(evaluate(at(10), rs(60), cfg, [], true, rec)[0].notify, 'alert', 'but an actual low is announced');
});

test('a cancelled warning that turns into a real low reopens the same alert (no duplicate)', () => {
  const back = [{ id: 'old', kind: 'predicted_low' as const, started_at: new Date(at(-9)).toISOString(), resolved_at: new Date(at(-3)).toISOString(), progress: [{ k: 'predicted_low' as const, at: new Date(at(-9)).toISOString() }] }];
  const s = evaluate(at(10), [rd(5, 68), rd(10, 66)], CFG, [], true, back);
  assert.equal(s[0].op, 'update'); assert.equal(s[0].id, 'old'); assert.equal(s[0].patch.state, 'active'); assert.equal(s[0].patch.resolved_at, null); assert.equal(s[0].patch.kind, 'low');
});

test('fast fall and fast rise have their own thresholds', () => {
  const cfg: AlertCfg = { ...CFG, fallRate: 1.8, riseRate: null, fallOn: true, riseOn: true };
  const line = (slope: number) => Array.from({ length: 15 }, (_, i) => rd(i, 150 + slope * i));
  assert.deepEqual(evaluate(at(14), line(-2), cfg, [], true).filter((x) => x.kind.startsWith('rapid')).map((x) => x.kind), ['rapid_fall']);
  assert.deepEqual(evaluate(at(14), line(2), cfg, [], true).filter((x) => x.kind.startsWith('rapid')).map((x) => x.kind), [], 'rise off');
  assert.deepEqual(evaluate(at(14), line(2), { ...CFG, rapidRate: 1.8, riseOn: true }, [], true).filter((x) => x.kind.startsWith('rapid')).map((x) => x.kind), ['rapid_rise'], 'the older shared setting still works');
  assert.deepEqual(evaluate(at(14), line(-2), { ...CFG, fallRate: 1.8 }, [], true).filter((x) => x.kind.startsWith('rapid')), [], 'both fast alerts are off unless switched on');
});

test('urgent low notifies at once, as the same alert when it started as low', () => {
  const s = evaluate(at(0), [rd(0, 50)], CFG, [], true);
  assert.deepEqual(s.map((x) => [x.kind, x.patch.state, x.notify]), [['urgent_low', 'active', 'alert']], 'one alert, not urgent plus low');
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

test('"I am on it": quiet while she recovers, loud again if she worsens, a reminder if it drags on', () => {
  const ackAt = new Date(at(0)).toISOString();
  const ack = open({ state: 'acknowledged', acknowledged_at: ackAt, last_notified_at: ackAt, ack_kind: 'low', ack_value: 64 });
  const slow = (end: number, from: number, slope: number) => fallMin(end, from, slope, 11);
  assert.equal(evaluate(at(12), slow(12, 62, 0.5), CFG, [ack], true)[0].notify, undefined, 'recovering and still low: quiet');
  const worse = evaluate(at(12), slow(12, 68, -0.6), CFG, [ack], true)[0];       // keeps falling, below where she was
  assert.equal(worse.notify, 'repeat'); assert.equal(worse.patch.state, 'active');
  assert.equal(evaluate(at(31), slow(31, 66, 0), CFG, [ack], true)[0].notify, 'repeat', 'still low after half an hour');
  assert.equal(evaluate(at(31), slow(31, 58, 0.5), CFG, [ack], true)[0].notify, undefined, 'still low but rising: not yet');
  assert.equal(evaluate(at(61), slow(61, 58, 0.5), CFG, [ack], true)[0].notify, 'repeat', 'an hour is long enough');
  assert.equal(evaluate(at(31), slow(31, 76, 0), CFG, [ack], true)[0].notify, undefined, 'back over the limit: nothing to remind');
});

test('a stale reading neither raises nor clears; no data alerts after the set minutes and only with a CGM', () => {
  assert.equal(evaluate(at(30), [rd(10, 60)], CFG, [], true).filter((x) => x.kind !== 'no_data').length, 0);
  assert.equal(evaluate(at(25), [rd(5, 90)], CFG, [open({})], true).find((x) => x.kind === 'low'), undefined, 'an open low is left as it is');
  const _x = 0;  assert.equal(evaluate(at(25), [rd(4, 100)], CFG, [], true)[0].kind, 'no_data');
  assert.equal(evaluate(at(19), [rd(0, 100)], CFG, [], true).length, 0);
  assert.equal(evaluate(at(25), [rd(4, 100)], CFG, [], false).length, 0);
  const back = evaluate(at(26), [rd(26, 100)], CFG, [open({ kind: 'no_data' })], true);
  assert.equal(back[0].op, 'resolve'); assert.equal(back[0].notify, 'resolved');
  const off = { ...CFG, nodataOn: false };
  assert.equal(evaluate(at(25), [rd(4, 100)], off, [], true).length, 0, 'switched off: no «no reading» alert');
  const shut = evaluate(at(25), [rd(4, 100)], off, [open({ kind: 'no_data' })], true);
  assert.equal(shut[0].op, 'resolve'); assert.equal(shut[0].notify, undefined, 'an open one is closed quietly');
});

test('very low and low cannot be switched off (a missing limit falls back to 54 / 70); the optional ones have switches', () => {
  const none = { ...CFG, low: null, urgentLow: null };
  assert.equal(evaluate(at(0), [rd(0, 40)], none, [], true)[0].kind, 'urgent_low');
  assert.equal(evaluate(at(5), [rd(0, 66), rd(5, 66)], none, [], true)[0].kind, 'low');
  const hi = open({ kind: 'high', value_mgdl: 260 });
  const s = evaluate(at(0), [rd(0, 260)], { ...CFG, highOn: false }, [hi], true);
  assert.equal(s[0].op, 'resolve'); assert.equal(s[0].notify, undefined);
  assert.deepEqual(evaluate(at(0), [rd(0, 260)], { ...CFG, highOn: false, highDelay: 0 }, [], true), []);
});


test('profiles: night and school windows in Kuwait time change the thresholds; night can silence highs', () => {
  const cfg: AlertCfg = { ...CFG, night: { start: '21:00', end: '06:30', low: 90, high: 300, highSilent: true }, school: { days: [0, 1, 2, 3, 4], start: '07:00', end: '14:00', low: 80, high: null } };
  const kt = (iso: string) => Date.parse(iso) - 3 * 3600000; // Kuwait local → UTC
  assert.equal(profileAt(kt('2026-10-01T23:30:00Z'), cfg), 'night');   // Thursday 23:30
  assert.equal(profileAt(kt('2026-10-01T05:00:00Z'), cfg), 'night');   // 05:00 wraps midnight
  assert.equal(profileAt(kt('2026-10-01T09:00:00Z'), cfg), 'school');  // Thursday is a school day
  assert.equal(profileAt(kt('2026-10-02T09:00:00Z'), cfg), 'day');     // Friday is not
  const n = kt('2026-10-01T23:30:00Z');
  const lowAtNight = evaluate(n, [{ taken_at: new Date(n - 6 * 60000).toISOString(), mg_dl: 86, trend: 3 }, { taken_at: new Date(n - 60000).toISOString(), mg_dl: 85, trend: 3 }], cfg, [], true);
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

test('low expected: a slow fall that levels off far above the limit does not warn; a near one does', () => {
  const cfg: AlertCfg = { ...CFG, predictLowMin: 20 };
  assert.equal(evaluate(at(10), fallMin(10, 110, -0.7), cfg, [], true).find((x) => x.kind === 'predicted_low'), undefined, 'now ~103, levels near 96');
  assert.ok(evaluate(at(10), fallMin(10, 95, -1.5), cfg, [], true).find((x) => x.kind === 'predicted_low'), 'near the limit and steadily falling: warns');
});

test('rapid fall: a sustained slope beyond the set rate, never from a single jump or across a gap', () => {
  const pts = (vals: number[], step = 5) => vals.map((v, k) => ({ taken_at: new Date(at(k * step)).toISOString(), mg_dl: v, trend: null }));
  assert.equal(Math.round(rate15(pts([180, 165, 150, 135])) ?? 0), -3);
  assert.equal(rate15(pts([180, 120])), null);                                 // two points are not a trend
  const cfg = { ...CFG, rapidRate: 2.5, fallOn: true };
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
  assert.equal(evaluate(at(10), [rd(10, 64)], cfg, [open({ state: 'acknowledged', acknowledged_at: new Date(at(5)).toISOString(), last_notified_at: new Date(at(5)).toISOString() })], true)[0].notify, undefined);
  const fam = [{ user_id: 'mum', alert_role: 'primary' }, { user_id: 'dad', alert_role: 'backup' }, { user_id: 'gran', alert_role: 'off' }];
  assert.deepEqual(recipients(fam, 'alert'), ['mum']); assert.deepEqual(recipients(fam, 'escalate'), ['mum', 'dad']);
  assert.deepEqual(recipients([{ user_id: 'dad', alert_role: 'backup' }], 'alert'), ['dad']); // no primary: nobody is left out
});

test('push wording: what is happening first, then glucose now, then what it means; no names, source or doses', () => {
  const I = (x: string) => `\u2066${x}\u2069`;
  const pl = alertMessage('predicted_low', 'alert', { value: 94, trend: 3, unit: 'mmol', minutes: 0, low: 70, rate: -1.2, eta: 18 });
  assert.equal(pl.title, '🟠 انخفاض متوقع');
  assert.equal(pl.body, `الآن ${I('5.2 →')} ملمول/ل\nقد يصل ${I('3.9')} خلال ~18 دقيقة`);
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
  const m = alertMessage('predicted_low', 'alert', { value: 94, trend: null, unit: 'mmol', minutes: 0, low: 70, rate: -1.2, eta: 18 }, 'en');
  assert.equal(m.title, '🟠 Low expected');
  assert.equal(m.body, 'Now \u20665.2 ↘\u2069 mmol/L\nMay reach \u20663.9\u2069 in ~18 min');
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
  assert.equal(step, 3600000); assert.match(tickLabel(ticks[0], step), /^(1[0-2]|[1-9])(a|p|\u0635|\u0645)$/, 'hour ticks are 12-hour: 3p / 3\u0645');
  assert.equal(tickLabel(Date.parse('2026-10-01T12:30:00Z'), 1800000), '3:30', 'half-hours without am/pm (the hour ticks beside it say it)');
  assert.equal(tickLabel(Date.parse('2026-10-01T21:00:00Z'), 3600000), '2/10'); // midnight in Kuwait shows the date
});


test('Layan in simple mode follows the box status: never her own thresholds, low expected only turns happy into watching, hidden at very low', async () => {
  const { layanFace } = await import('../../engine/mom');
  assert.equal(layanFace('ok', 120, 54, false), 'ok');
  assert.equal(layanFace('ok', 120, 54, true), 'watching', 'low expected, nothing more serious');
  assert.equal(layanFace('falling', 95, 54, false), 'watching');
  assert.equal(layanFace('high', 200, 54, true), 'high', 'low expected never overrides high');
  assert.equal(layanFace('low', 62, 54, true), 'low');
  assert.equal(layanFace('low', 50, 54, false), null, 'very low: the alarm has the screen');
  assert.equal(layanFace('stale', 50, 54, true), 'no-reading', 'no new reading wins over everything');
});


test('a new meal from the Log: meals with items, the last 30 days, the same meal once, newest first', async () => {
  const { reusable } = await import('../entryActions');
  const now = Date.parse('2026-10-08T12:00:00Z'), ago = (d: number) => new Date(now - d * 86400000).toISOString();
  const L = (q: number) => [{ name: 'rice', quantity: q, unit: 'g' }];
  const list = reusable([
    { name: 'lunch', eaten_at: ago(1), lines: L(100) }, { name: 'lunch', eaten_at: ago(2), lines: L(100) }, // the same: once (the newer)
    { name: 'lunch', eaten_at: ago(0.5), lines: L(150) }, { name: 'juice', eaten_at: ago(0.2), lines: [] }, { name: 'old', eaten_at: ago(40), lines: L(10) },
  ], now);
  assert.deepEqual(list.map((x) => `${x.name}:${x.lines[0].quantity}:${x.eaten_at === ago(0.5) ? 'n' : x.eaten_at === ago(1) ? '1' : '?'}`), ['lunch:150:n', 'lunch:100:1']);
});


test('simple-mode graph scale: the smallest of a few fixed steps that holds the highest reading, never cutting a low', async () => {
  test('simple-mode graph: the scale fits the hours on screen, not the highest reading of the day', async () => {
    const { bigGraphScale: sc, visibleMax } = await import('../../engine/mom');
    const H = 3600000, day = { t: [0, 2 * H, 20 * H, 22 * H], v: [380, 300, 160, 120] }; // a high at night, a quiet morning
    assert.equal(visibleMax(day, [], 18 * H, 24 * H), 160); assert.equal(Math.round(sc(visibleMax(day, [], 18 * H, 24 * H), 'mmol').top / 18.016), 12);
    assert.equal(visibleMax(day, [{ t: 21 * H, bg: 210 }], 18 * H, 24 * H), 210, 'a finger-prick in view counts');
    assert.equal(Math.round(sc(visibleMax(day, [], 0, 6 * H), 'mmol').top / 18.016), 21);
    assert.equal(visibleMax(day, [], 5 * H, 6 * H), null); assert.equal(Math.round(sc(null, 'mmol').top / 18.016), 12, 'nothing in view: the smallest scale, high line still shown');
  });
  const { bigGraphScale } = await import('../../engine/mom');
  const mm = (x: number) => x * 18.016, top = (v: number | null) => Math.round(bigGraphScale(v, 'mmol').top / 18.016);
  assert.equal(top(mm(9)), 12); assert.equal(top(mm(12.5)), 15); assert.equal(top(mm(16)), 18); assert.equal(top(mm(19.6)), 21); assert.equal(top(mm(25)), 21);
  assert.equal(top(null), 12);
  const s = bigGraphScale(mm(12.5), 'mmol');
  assert.equal(Math.round(s.bottom / 18.016), 2, 'room under 3.0: a 2.4 is drawn as 2.4');
  assert.deepEqual(s.ticks.map((v) => Math.round(v / 18.016)), [3, 6, 9, 12, 15]);
  assert.equal(bigGraphScale(260, 'mgdl').top, 300);
});

console.log('event rail');

test('events under the graph: two lanes; a neighbour that would touch goes to lane 2, never squeezed or overlapped', async () => {
  const { laneLayout } = await import('../../engine/events');
  assert.deepEqual(laneLayout([{ x: 60, w: 80 }, { x: 250, w: 80 }], 360), [{ lane: 0, left: 20 }, { lane: 0, left: 210 }], 'far apart: both in lane 1, centred on their time');
  const near = laneLayout([{ x: 140, w: 110 }, { x: 190, w: 120 }], 360);
  assert.equal(near[0]!.lane, 0); assert.equal(near[1]!.lane, 1);
  assert.equal(near[1]!.left, 130, 'lane 2 keeps it centred on its own time');
  const three = laneLayout([{ x: 100, w: 100 }, { x: 130, w: 100 }, { x: 160, w: 100 }], 360);
  const boxes = three.map((p, i) => p && { lane: p.lane, l: p.left, r: p.left + 100, i }).filter(Boolean) as { lane: number; l: number; r: number }[];
  for (const a1 of boxes) for (const b1 of boxes) if (a1 !== b1 && a1.lane === b1.lane) assert.ok(a1.r + 10 <= b1.l || b1.r + 10 <= a1.l, 'no overlap within a lane');
  assert.equal(laneLayout([{ x: 340, w: 80 }], 360)[0]!.left, 278, 'kept inside the edge');
});


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
  assert.deepEqual(dayTotals(hist as any, evs as any, start, end), { carbs: 100, treatment: 15, rapid: 3, long: 12, meals: 2, unknown: 0 });
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

test('a meal edited after its dose: the extra food dose at the same ratio, rounded down; less food is a warning', () => {
  const more = mealChangeDose(42, 67.8, 15, 1);
  assert.ok(Math.abs(more.raw - 1.72) < 0.01); assert.equal(more.extra, 1); assert.equal(more.over, 0);
  assert.equal(mealChangeDose(42, 50, 15, 1).extra, 0, '8 g more is under one unit at 1:15');
  assert.equal(mealChangeDose(42, 50, 15, 0.5).extra, 0.5);
  const less = mealChangeDose(60, 30, 15, 1); assert.equal(less.extra, 0); assert.equal(less.over, 2); assert.equal(less.diff, -30);
});

test('the saved dose is told back step by step with the same arithmetic', () => {
  // 42.3 g at 1:15, glucose 216 mg/dL (12.0) over a 99–117 target, correction factor 54 (3.0), nothing on board
  const a = doseSteps({ carbs: 42.3, cr: 15, glucose: 216, isf: 54, target: [99, 117], iob: 0, pen_step: 1 });
  assert.ok(Math.abs(a.food - 2.82) < 1e-9); assert.equal(a.side, 'above'); assert.ok(Math.abs(a.correction - 1.8333) < 1e-3);
  assert.ok(Math.abs(a.raw - 4.6533) < 1e-3); assert.equal(a.dose, 4);
  // insulin still working takes from the correction only, never from the food
  const b = doseSteps({ carbs: 30, cr: 15, glucose: 171, isf: 54, target: [99, 117], iob: 3, pen_step: 0.5 });
  assert.equal(b.iobUsed, 1); assert.equal(b.raw, 2); assert.equal(b.dose, 2);
  // below the range the dose is lowered; inside it there is no correction
  const c = doseSteps({ carbs: 30, cr: 15, glucose: 72, isf: 54, target: [99, 117], iob: 1 });
  assert.equal(c.side, 'below'); assert.equal(c.iobUsed, 0); assert.equal(c.raw, 1.5); assert.equal(c.dose, 1);
  assert.equal(doseSteps({ carbs: 15, cr: 15, glucose: 108, isf: 54, target: [99, 117], iob: 0 }).correction, 0);
  // matches the calculator itself
  const live = suggestDose({ now: 0, carbs: 42.3, ratio: { from: '00:00', cr: 15, isf: 54 } as any, target: { low: 99, high: 117 }, lowMg: 70, glucose: { mg: 216, at: 0, level: 0 }, sensorStartedAt: null, iob: 0, lastRapidAt: null, gapMin: 120, step: 1 });
  assert.equal(live.dose, a.dose);
});

test('insulin activity is the slope of IOB, peaks at the peak time and adds up to the dose', () => {
  const p = { dia: 240, peak: 65 };
  assert.equal(activityFraction(0, p), 0); assert.equal(activityFraction(240, p), 0);
  for (const m of [20, 65, 150]) { const slope = (iobFraction(m - 0.5, p) - iobFraction(m + 0.5, p)); assert.ok(Math.abs(slope - activityFraction(m, p)) < 1e-5, `slope at ${m}`); }
  let sum = 0, best = 0; for (let m = 0; m < 240; m += 0.25) { const a = activityFraction(m, p); sum += a * 0.25; if (a > activityFraction(best, p)) best = m; }
  assert.ok(Math.abs(sum - 1) < 0.01, String(sum)); assert.ok(Math.abs(best - 65) <= 0.5, String(best));
  const t0 = Date.parse('2026-10-01T10:00:00Z'), M = 60000, doses = [{ t: t0, units: 2 }];
  assert.equal(activityAt(t0, doses, p), 0);
  assert.ok(Math.abs(activityAt(t0 + 65 * M, doses, p) - 2 * 60 * activityFraction(65, p)) < 1e-9);
  assert.deepEqual(activityPeaks(doses, p, t0 - 60 * M, t0 + 6 * 3600000), [t0 + 65 * M]);
  // two doses far apart: two peaks; nothing in range: none
  assert.equal(activityPeaks([...doses, { t: t0 + 3 * 3600000, units: 1 }], p, t0, t0 + 8 * 3600000).length, 2);
  assert.deepEqual(activityPeaks(doses, p, t0 + 5 * 3600000, t0 + 6 * 3600000), []);
  // with the delay: nothing for the first 10 minutes, the same curve 10 minutes later, the peak at 75
  assert.equal(ACT_DELAY_MIN, 10);
  assert.equal(activityAt(t0 + 10 * M, doses, p, 10), 0);
  assert.ok(Math.abs(activityAt(t0 + 75 * M, doses, p, 10) - activityAt(t0 + 65 * M, doses, p)) < 1e-9);
  assert.deepEqual(activityPeaks(doses, p, t0 - 60 * M, t0 + 6 * 3600000, 10), [t0 + 75 * M]);
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
  assert.equal(by('recurring_lows')?.n, 3); assert.ok(by('recurring_lows')!.title.includes('10 \u0645'));
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

test('push topics are always valid for Apple: never 1 over a multiple of 4, at most 32, URL-safe', async () => {
  const { pushTopic } = await import('../../../supabase/functions/carb-glucose/push');
  // the topics Apple refused (BadWebPushTopic): the night lows of 19 Oct were never delivered
  for (const t of ['alert-low', 'activity-meal', 'activity-long']) assert.notEqual(pushTopic(t).length % 4, 1, t);
  assert.equal(pushTopic('alert-low'), 'alert-low0');
  assert.equal(pushTopic('activity-rapid'), 'activity-rapid', 'topics that worked stay the same');
  assert.equal(pushTopic('alert-high'), 'alert-high');
  assert.equal(pushTopic('plan-' + 'a'.repeat(40)).length, 32);
  assert.equal(pushTopic('تنبيه'), '', 'nothing usable means no Topic header');
  for (let n = 1; n <= 40; n++) { const t = pushTopic('x'.repeat(n)); assert.ok(t.length <= 32 && t.length % 4 !== 1, `length ${n}`); }
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

test('a label in a food photo comes back per 100 only: no food, no portion, unreadable carbs mean no label', async () => {
  const { cleanEstimate, SCHEMA } = await import('../../../supabase/functions/carb-food/estimate');
  // the chocolate bar label that came back as «61.1 g» of carbs: now it is 61.1 per 100 g and nothing is eaten yet
  const e = cleanEstimate({ is_food: true, is_label: true, notes_ar: '', notes_en: 'Weigh the piece',
    label: { name_ar: 'شوكولاتة', name_en: 'Chocolate', unit: 'g', carbs_per100: 61.1, serving: null, pack: 0 },
    items: [{ name_ar: 'شوكولاتة', name_en: 'Chocolate', grams: 100, carbs_g: 61.1, protein_g: 0, fat_g: 0, kcal: 475, confidence: 'high', hidden_sugar: false }] });
  assert.deepEqual(e.label, { name_ar: 'شوكولاتة', name_en: 'Chocolate', unit: 'g', carbs_per100: 61.1, serving: null, pack: null });
  assert.equal(e.items.length, 0, 'a label never becomes a food on the plate'); assert.equal(e.is_food, false); assert.equal(e.total.carbs_g, 0);
  const ml = cleanEstimate({ is_label: true, label: { name_en: 'Cocoa', unit: 'ml', carbs_per100: '12', serving: 200, pack: 1000 } });
  assert.equal(ml.label?.unit, 'ml'); assert.equal(ml.label?.carbs_per100, 12); assert.equal(ml.label?.serving, 200); assert.equal(ml.label?.name_ar, 'Cocoa');
  for (const c of [null, 'x', 140, -3]) {
    const bad = cleanEstimate({ is_label: true, label: { name_en: 'X', unit: 'g', carbs_per100: c, serving: 30, pack: null } });
    assert.equal(bad.label, null, `carbs ${c}: nothing to prefill`); assert.equal(bad.items.length, 0, 'and still no portion');
  }
  assert.equal(cleanEstimate({ is_food: true, is_label: false, label: { carbs_per100: 50 }, items: [{ name_en: 'Rice', grams: 100, carbs_g: 28 }] }).label, null);
  assert.equal(SCHEMA.properties.label.additionalProperties, false);
});

test('label readings are cleaned: impossible numbers blanked and flagged, nothing invented', async () => {
  const { cleanLabel, LABEL_SCHEMA } = await import('../../../supabase/functions/carb-food/estimate');
  const l = cleanLabel({ is_label: true, name: 'Protein Wraps', brand: 'Nano Supps', barcode: 'EAN 5 060 123 456 789', category: 'خبز', unit: 'g', serving: 40, pack: 240,
    per100: { carbs: 11, sugar: 140, fiber: 26, fat: 13, protein: 22, kcal: 308 }, label_style: 'eu_fibre_excluded', uncertain: ['brand', 'nonsense'] });
  assert.equal(l.is_label, true); assert.equal(l.per100.carbs, 11); assert.equal(l.serving, 40); assert.equal(l.barcode, '5060123456789');
  assert.equal(l.per100.sugar, null, 'sugar over 100 g per 100 g is blanked');
  assert.ok(l.uncertain.includes('sugar') && l.uncertain.includes('brand') && !l.uncertain.includes('nonsense'));
  const bad = cleanLabel({ is_label: true, per100: { carbs: 'x' }, unit: 'kg', label_style: 'odd' });
  assert.equal(bad.is_label, false, 'no readable carbs: nothing to prefill'); assert.equal(bad.unit, 'g'); assert.equal(bad.label_style, 'unknown');
  assert.ok(bad.uncertain.includes('carbs'));
  assert.equal(cleanLabel(null).is_label, false);
  assert.equal(LABEL_SCHEMA.additionalProperties, false); assert.equal(LABEL_SCHEMA.properties.per100.additionalProperties, false);
});

test('a nutrition table read on the phone fills per-100 values from the first column', async () => {
  const { parseLabelText } = await import('../labelOcr');
  const eu = parseLabelText(`Nutrition Information\nTypical values Per 100g Per wrap (40g)\nEnergy 1288kJ / 308kcal 515kJ / 123kcal\nFat 13g 5.2g\nof which saturates 2.1g 0.8g\nCarbohydrate 11g 4.4g\nof which sugars 1.2g 0.5g\nFibre 26g 10g\nProtein 22g 8.8g\nSalt 1.1g 0.4g`);
  assert.equal(eu.is_label, true); assert.equal(eu.per100.carbs, 11); assert.equal(eu.per100.fat, 13); assert.equal(eu.per100.sugar, 1.2);
  assert.equal(eu.per100.fiber, 26); assert.equal(eu.per100.protein, 22); assert.equal(eu.per100.kcal, 308); assert.equal(eu.serving, 40);
  assert.equal(eu.label_style, 'eu_fibre_excluded'); assert.deepEqual(eu.uncertain, []);
  const ocr = parseLabelText('Per 100g Per wrap (40g)\nEnergy 1288kJ / 308kcal 515kJ/ 123kcal\nFat 13g 5.29\nCarbohydrate 11g 4.4q\nof which sugars 1.29 0.59\nFibre 269 10g\nProtein 229 8.89');
  assert.equal(ocr.per100.sugar, 1.2, 'the g read as 9 after a decimal is dropped'); assert.equal(ocr.per100.fiber, 26); assert.equal(ocr.per100.protein, 22);
  assert.ok(ocr.uncertain.includes('fiber') && ocr.uncertain.includes('protein') && !ocr.uncertain.includes('carbs'), 'repaired numbers are flagged for checking');
  const blur = parseLabelText('Energy ?? kcal\nCarbohydrate ~~');
  assert.equal(blur.is_label, false, 'no carbs read: nothing filled in as if certain'); assert.ok(blur.uncertain.includes('carbs'));
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
  const base = { now: T0, kuwaitMin: 12 * 60 + 30, iob: { dia: 360, peak: 65 }, absorbMin: 180, ratios: R, validated: true };
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
  test('no estimate while the curve forecast is not validated against her readings (the default)', () => {
    const o = onBoard({ ...base, validated: undefined, glucose: { mg: 120, at: T0 }, history: [meal(40, T0)], events: [ev(2, T0)] });
    assert.equal(o.est, null); assert.equal(o.cob, 40, 'active carbs still shown');
  });
  test('the estimate ends when the shared engine says the food is absorbed, not after a fixed 180 minutes', async () => {
    const { foodEnd, foodsFrom } = await import('../../engine/absorb');
    const fatty = [{ eaten_at: new Date(T0).toISOString(), total_carbs: 40, total_fat: 30 }] as never;
    const o = onBoard({ ...base, glucose: { mg: 120, at: T0 }, history: fatty, events: [] }); // no dose: the food alone sets the end
    assert.equal(o.estBy, foodEnd(foodsFrom(fatty, []), T0));
    assert.ok(o.estBy! - T0 > 300 * 60000, 'a fatty meal runs past 5 hours');
  });
  test('one Tresiba settling rule: doses 1–3 at new units are a transition, from the 4th it is settled (Night and Basal Check)', async () => {
    const N = await import('../../engine/nightTresiba'), B = await import('../../engine/basalCheck');
    assert.equal(N.STEADY_DOSES, 4); assert.equal(N.NT.settle, N.STEADY_DOSES - 1); assert.equal(B.BC.steadyDoses, N.STEADY_DOSES);
  });
  test('no «≈ later» beside an open low, low expected or fast fall; a high alert does not hide it', async () => {
    const { lowOpen } = await import('../lowOpen');
    const a = (kind: string) => ({ id: 'a', kind, state: 'active', started_at: '', active_at: null, value_mgdl: null }) as never;
    assert.equal(lowOpen([]), false); assert.equal(lowOpen([a('high')]), false); assert.equal(lowOpen([a('no_data')]), false);
    for (const k of ['urgent_low', 'low', 'predicted_low', 'rapid_fall']) assert.equal(lowOpen([a('high'), a(k)]), true, k);
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
    assert.equal(planMessage('check', p, 'en').title, '🔵 Breakfast plan · dose at \u20667:00 AM\u2069');
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
  // suggestDose imported at the top
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
  test('the extra dose after a meal changes is offered only when the calculator itself would give a number', async () => {
    const { extraDoseGate } = await import('../../engine/dose');
    const now = (x: Record<string, unknown>) => suggestDose({ ...base, carbs: 0, ...x } as typeof base);
    assert.deepEqual(extraDoseGate(1, now({})), { give: true, block: null }, 'fresh reading, no recent dose: one-tap give allowed');
    assert.equal(extraDoseGate(0, now({})).give, false, 'less than a pen step: nothing to give');
    // the first meal dose 40 min ago is inside the gap: no one-tap second dose, and when it would be allowed
    const recent = extraDoseGate(1, now({ lastRapidAt: T - 40 * M }));
    assert.equal(recent.give, false); assert.equal(recent.block, 'recent_dose'); assert.equal(recent.until, T + 80 * M);
    assert.equal(extraDoseGate(1, now({ glucose: { mg: 171, at: T - 16 * M, level: 0 } })).block, 'no_reading', 'an old reading is never reused');
    assert.equal(extraDoseGate(1, now({ iob: null })).block, 'no_plan', 'insulin still working unknown: no number');
    assert.equal(extraDoseGate(1, now({ glucose: { mg: 65, at: T, level: 0 } })).block, 'low');
    assert.equal(extraDoseGate(1, now({ glucose: { mg: 171, at: T, level: -2 } })).block, 'falling');
    assert.equal(extraDoseGate(1, now({ sensorStartedAt: T - 30 * M })).block, 'warmup');
  });
  test('regression: the calculator numbers and the meal-change difference are unchanged', () => {
    const r = suggestDose({ ...base, carbs: 30, glucose: { mg: 225, at: T - M, level: 0 }, iob: 0.5 });
    assert.equal(r.food, 2); assert.ok(Math.abs(r.correction - 1.5) < 1e-9); assert.equal(r.iobUsed, 0.5); assert.equal(r.dose, 3, '2 + (2 − 0.5) = 3.5 → 3');
    assert.deepEqual(mealChangeDose(30, 45, 15, 1), { diff: 15, raw: 1, extra: 1, over: 0 });
    assert.deepEqual(mealChangeDose(30, 52, 15, 0.5), { diff: 22, raw: 22 / 15, extra: 1, over: 0 }, '1.47 → 1 at half steps');
    assert.equal(mealChangeDose(45, 30, 15, 1).extra, 0); assert.equal(mealChangeDose(45, 30, 15, 1).over, 1, 'less food: a warning, never a negative dose');
  });
}

test('editing a shot that belongs to a plan changes only that shot: a top-up given later is kept', async () => {
  const { givenAfterEdit } = await import('../../engine/dose');
  assert.equal(givenAfterEdit(3, 2, 2.5), 3.5, 'first shot 2 → 2.5 U, top-up 1 U kept: 3.5');
  assert.equal(givenAfterEdit(2, 2, 1.5), 1.5, 'no top-up: the new units');
  assert.equal(givenAfterEdit(null, 2, 3), 3, 'nothing summed yet: the shot itself');
  assert.equal(givenAfterEdit(1, 2, 0), 0, 'never below zero');
});

test('a plan edited after its dose never moves the dose day or time, and keeps its reminders', async () => {
  const { planRow } = await import('../../engine/mealPlan');
  const p = { for_date: '2026-10-18', slot: 'lunch', name: 'x', recipe_id: null, items: [], dose_at: '2026-10-18T10:00:00Z', eat_after_min: 10, remind_min: 10, note: null } as never;
  const before = planRow({ ...(p as object), dosed: false } as never) as Record<string, unknown>;
  assert.equal(before.dose_at, '2026-10-18T10:00:00Z'); assert.equal(before.for_date, '2026-10-18'); assert.deepEqual(before.notified, {});
  const after = planRow({ ...(p as object), dosed: true } as never) as Record<string, unknown>;
  assert.ok(!('dose_at' in after) && !('for_date' in after) && !('notified' in after), 'dosed: time stays with the insulin entry');
  assert.equal(after.name, 'x', 'the food can still change');
});

test('a kids meal is its separate parts, each once: main, fries and the chosen drink (water unless changed)', async () => {
  const { KIDS_MEALS, kidsMealIds } = await import('../restaurants');
  const set = KIDS_MEALS.bk;
  const ids: Record<string, string> = { 'برجر كنج تشيز برجر كيدز': 'cb', 'برجر كنج بطاطا أطفال': 'fr', 'برجر كنج بطاطا (صغير)': 'small', 'برجر كنج ماء معدني': 'wa', 'برجر كنج كوك زيرو (علبة)': 'cz', 'برجر كنج تشيكن تيندر (4 قطع)': 'tn' };
  const idOf = (n: string) => ids[n] ?? null;
  assert.equal(set.drinks[0].name, 'برجر كنج ماء معدني', 'water is the first (default) drink');
  assert.deepEqual(kidsMealIds(set, { main: 'cheeseburger', side: 0, drink: 0 }, idOf), ['cb', 'fr', 'wa']);
  assert.deepEqual(kidsMealIds(set, { main: 'tenders', side: 1, drink: 1 }, idOf), ['tn', 'cz'], 'no fries, Coke Zero');
  assert.equal(kidsMealIds(set, { main: 'hamburger', side: 0, drink: 0 }, idOf), null, 'a main not in the food list is not offered');
  // the meal has no nutrition row of its own: carbs = the sum of the parts only (never meal + its fries)
  const carbs: Record<string, number> = { cb: 29.33, fr: 18, wa: 0 };
  const total = kidsMealIds(set, { main: 'cheeseburger', side: 0, drink: 0 }, idOf)!.reduce((a, id) => a + carbs[id], 0);
  assert.equal(Math.round(total * 100) / 100, 47.33);
  assert.ok(!kidsMealIds(set, { main: 'cheeseburger', side: 0, drink: 0 }, idOf)!.includes('small'), 'kids fries, never the regular small fries');
  assert.ok(!set.drinks.some((d) => d.name && /برتقال/.test(d.name)), 'orange juice is not offered until it has a reliable value');
});

test('Happy Meal: main, small fries or pineapple, and water by default; the Kuwait meal totals match the parts', async () => {
  const { KIDS_MEALS, kidsMealIds } = await import('../restaurants');
  const set = KIDS_MEALS.mcd;
  const ids: Record<string, string> = { 'Cheeseburger': 'cb', 'Beef Burger': 'bb', 'Fries (Small)': 'fs', 'Pineapple Stick': 'pn', 'ماكدونالدز ماء': 'wa', 'Milk': 'mk' };
  const idOf = (n: string) => ids[n] ?? null;
  assert.equal(set.sideNote, undefined, 'Happy Meal fries are the small fries (Kuwait totals match): no confirmation needed');
  assert.equal(set.drinks[0].name, 'ماكدونالدز ماء', 'water first');
  assert.deepEqual(kidsMealIds(set, { main: 'cheeseburger', side: 1, drink: 0 }, idOf), ['cb', 'pn', 'wa']);
  // Kuwait: Happy Meal Cheeseburger + pineapple + orange juice = 97 g; without the juice (≈55 g) the parts are 42 g
  const carbs: Record<string, number> = { cb: 36, pn: 6, wa: 0 };
  assert.equal(kidsMealIds(set, { main: 'cheeseburger', side: 1, drink: 0 }, idOf)!.reduce((a, id) => a + carbs[id], 0), 42);
  assert.ok(!set.drinks.some((d) => d.name && /orange|برتقال/i.test(d.name)), 'the Happy Meal orange juice is not offered until verified');
  assert.equal(KIDS_MEALS.bk.sideNote !== undefined, true, 'Burger King kids fries still need confirming');
});

test('an earlier meal added while planning keeps the plan (its id, name and mode); for now it stays for now', async () => {
  const { addToDraft } = await import('../../engine/mom');
  const it = (id: string) => ({ kind: 'product' as const, id, portion_id: null, amount: 1, unit: 'serving' }) as never;
  const plan = { items: [it('a')], savedId: null, name: 'عيد ميلاد', left: [], mode: 'plan' as const, planId: 'plan-1', review: [] as string[], fixing: 2 };
  const d = addToDraft(plan, [it('b'), it('c')], ['x']);
  assert.equal(d.mode, 'plan'); assert.equal(d.planId, 'plan-1'); assert.equal(d.name, 'عيد ميلاد');
  assert.equal(d.items.length, 3); assert.deepEqual(d.review, ['x']); assert.equal(d.fixing, null);
  assert.equal(plan.items.length, 1, 'the plate before is not changed in place');
  const now = addToDraft({ items: [], savedId: 's1', name: 'Saved', left: [], mode: 'now' as const, review: ['y'] }, [it('b')], [] as string[]);
  assert.equal(now.mode, 'now'); assert.equal(now.name, null); assert.equal(now.savedId, null); assert.deepEqual(now.review, ['y']);
});

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
  test('Gluroo import: both parents sending the same juice within 10 minutes is one juice', () => {
    const csv2 = [H, ...Array.from({ length: 30 }, (_, k) => cgm(k * 3 - 30, 65)),
      msg(0, '422389', 'ANNOUNCE_MEAL', { text: 'Made from juice concentrate. With added sugar', g: 15 }),
      msg(4, '422380', 'ANNOUNCE_MEAL', { text: 'Made from juice concentrate. With added sugar', g: 15 })].join('\n');
    const r2 = G.parseCsv(csv2), e2 = G.classify(r2, G.readingsFrom(r2), []);
    assert.deepEqual(e2.filter((e) => e.food_key === 'juice_box').map((e) => e.status), ['probable_duplicate', 'low_treatment']);
    assert.equal(G.derive(e2, G.readingsFrom(r2)).events.filter((e) => e.kind === 'treatment').length, 1);
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
    assert.deepEqual(a.map((x) => x.key), ['treat_first', 'recent_low', 'fast_drink'], 'toast and eggs (15 g fat) is no longer a late-rise meal');
    assert.equal(a[0].tone, 'red');
    assert.deepEqual(['06:30', '10:59', '11:00', '14:59', '15:00', '17:59', '18:00', '23:30'].map(MP.slotAt), ['breakfast', 'breakfast', 'lunch', 'lunch', 'snack', 'snack', 'dinner', 'dinner'], 'mom mode: the meal follows from the eating time');
    assert.ok(MP.planAlerts({ block: null, carbs: 30, fat: 5, protein: 5, maxCarbs: 60, fastDrinkCarbs: 0, lastLowAt: null, now: at(6, 30), roseLateBefore: true }).some((x) => x.key === 'fatty'), 'a meal that rose late before gets the late-rise note');
    assert.deepEqual(MP.planAlerts({ block: null, carbs: 30, fat: 5, protein: 5, maxCarbs: 60, fastDrinkCarbs: 0, lastLowAt: null, now: at(6, 30), droppedEarlyBefore: true }).map((x) => x.key), ['early'], 'a meal that dropped her early before gets the early note');
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
    assert.ok(I.isFatty(32, 20) && I.isFatty(25, null) && I.isFatty(20, 25), 'fat 25 g, or 20 g fat with 25 g protein');
    assert.ok(!I.isFatty(17.6, 22.2), 'toast, eggs and cheese (her early-rising breakfast) is not a late-rise meal');
    assert.ok(!I.isFatty(16.5, 25.1) && !I.isFatty(19, 40) && !I.isFatty(5, 3) && !I.isFatty(null, 30) && !I.isFatty(0.7, 5.8));
    assert.equal(I.cobAt(T + 180 * M, [{ t: T, grams: 30 }], 180), 0, 'replayed on her data the slower curve was worse: COB is not slowed');
    const h = (min: number, fat: number | null) => ({ name: 'x' + min, eaten_at: new Date(T - min * M).toISOString(), total_fat: fat, total_protein: null });
    assert.equal(I.recentFatty([h(60, 28), h(30, 2)], T)?.name, 'x60');
    assert.equal(I.recentFatty([h(301, 28)], T), null, 'after 5 h: no notice');
    const toast = [{ name: 'جبن', product: 'جبن شرائح' }, { name: 'توست أبيض', product: 'Sliced Brown Bread — لوزين' }, { name: 'بيض', product: 'بيض' }];
    const key = 'sliced brown bread — لوزين + بيض + جبن شرائح'; // as carb.meal_key gives it
    assert.equal(I.mealKey(toast, 'فطور'), key, 'keyed by its foods, in code-point order, like the server');
    assert.equal(I.mealKey([...toast].reverse(), 'ريوق'), key, '«فطور» and «ريوق» with the same foods are one meal');
    assert.equal(I.mealKey([], 'عشا'), null, 'a bare slot name is not a meal');
    assert.equal(I.mealKey(null, ' Nuggets '), 'n:nuggets');
    const L = new Map([[key, { early: true, late: false, earlyN: 3, lateN: 0 }], ['n:nuggets', { early: false, late: true, earlyN: 0, lateN: 2 }]]);
    const lean = { name: ' Nuggets ', eaten_at: new Date(T - 60 * 60000).toISOString(), total_fat: 12, total_protein: 10 };
    assert.equal(I.recentFatty([lean], T), null, 'lean meal, nothing learned: no notice');
    assert.ok(I.recentFatty([lean], T, L)?.seen, 'a meal that rose late twice before: notice by name, said to be from before');
    assert.equal(I.recentFatty([h(60, 28)], T, L)?.seen, false);
    const bf = (min: number) => ({ name: 'فطور', eaten_at: new Date(T - min * 60000).toISOString(), total_fat: 17.6, total_protein: 22.2, lines: toast });
    assert.equal(I.recentEarly([bf(60)], T, L)?.n, 3, 'the breakfast that dropped her early: notice for its first 2½ h, with how many times');
    assert.equal(I.recentEarly([bf(151)], T, L), null, 'after 2½ h: no early-drop notice');
    assert.equal(I.recentEarly([bf(60)], T), null, 'nothing learned: no notice');
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
  const { matches, mealHay } = await import('../search');
  test('log search: a logged meal is found by its restaurant in any spelling or language, and by a food inside it', () => {
    const mc = { name: 'Big Mac + Fries', brand: "McDonald's", place: null, notes: null, lines: [{ name: 'Big Mac' }, { name: 'Fries (Small)' }] };
    for (const q of ["McDonald's", 'McDonalds', 'mcdonald', 'ماكدونالدز', 'ماك', 'مكدونالدز']) assert.ok(matches(mealHay(mc), q), q);
    assert.ok(matches(mealHay(mc), 'فرايز'), 'a food inside, typed in Arabic');
    const home = { name: 'عيش وكباب إيراني', brand: null, place: null, notes: null, lines: [{ name: 'رز أبيض مطبوخ' }, { name: 'كباب إيراني' }] };
    assert.ok(matches(mealHay(home), 'rice'), 'rice (عيش/رز) in English');
    assert.ok(matches(mealHay(home), 'كباب'));
    assert.ok(!matches(mealHay(home), 'ماك'), 'not every meal');
    const place = { name: 'غدا', brand: null, place: 'ماكدونالدز', notes: null, lines: [] };
    assert.ok(matches(mealHay(place), 'mcdonalds'), 'the place of a meal eaten out');
  });
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
    assert.ok(matches(['Rolls', 'المطاحن', 'خبز'], 'صمون') && matches(['Sandwich Rolls', 'لوزين', 'خبز'], 'صمونه لوزين'), 'Flour Mills and Lusine rolls are «صمون»');
    assert.ok(matches(['Turkey Breast Slices', null, 'لحوم'], 'تركي'));
  });
  test('search: generic foods are found in the other language (vegetables, nuts, fish, grains, extras)', () => {
    assert.ok(matches(['Zucchini, boiled', null, 'خضار'], 'كوسا') && matches(['باذنجان مشوي', null, 'خضار'], 'eggplant'));
    assert.ok(matches(['Cashews', null, 'مكسرات'], 'كاجو') && matches(['Walnuts', null, 'مكسرات'], 'عين الجمل') && matches(['Pistachios', null, 'مكسرات'], 'فستق'));
    assert.ok(matches(['Shrimp, cooked', null, 'سمك وروبيان'], 'روبيان') && matches(['هامور مشوي'], 'grouper') && matches(['Oats, dry'], 'شوفان'));
    assert.ok(matches(['رز بسمتي مطبوخ', null, 'رز'], 'basmati') && matches(['Basmati rice, cooked', null, 'رز'], 'رز') && matches(['Tahini'], 'طحينه'));
    assert.ok(matches(['دبس تمر', null, 'سكر وعسل'], 'date syrup') && matches(['Popcorn', null, 'سناكات'], 'فشار'));
    // look-alikes: coconut is not walnut, peanut is not fava, cornflakes are not «ذرة»
    assert.ok(!matches(['جوز هند'], 'walnut') && !matches(['فول سوداني'], 'fava') && !matches(['Corn Flakes'], 'ذره'));
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
    assert.ok(matches(['Tutti Frutti Original Fruit Flavour 15g', 'توتي فروتي', 'Tutti Frutti Fruit Gummies', 'Red Band', 'حلويات'], 'توتي'), 'the Arabic name is searched too');
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
    // the family's meal times: after midnight is night; breakfast to 11; 11–1 snack; lunch 1–5 pm; dinner from 5 pm
    assert.equal(D.slotOf(3 * 60 + 59, D.DEFAULT_STARTS), null); assert.equal(D.slotOf(10 * 60, D.DEFAULT_STARTS), 'breakfast');
    assert.equal(D.slotOf(12 * 60, D.DEFAULT_STARTS), 'snack1'); assert.equal(D.slotOf(16 * 60 + 13, D.DEFAULT_STARTS), 'lunch');
    assert.equal(D.slotOf(18 * 60 + 30, D.DEFAULT_STARTS), 'dinner');
    assert.equal(D.slotOf(16 * 60 + 13, D.DEFAULT_STARTS, null, 'dinner'), 'lunch', 'a meal planned as dinner but eaten at 4 pm is lunch');
    assert.equal(D.slotOf(15 * 60, D.DEFAULT_STARTS, null, 'snack'), 'snack2', 'a snack stays a snack');
  });
  test('graph + events page: the day in time order, numbered; a meal keeps its insulin, the rest get rows of their own', () => {
    const ev = DE.dayEvents(sheet, []);
    assert.deepEqual(ev.map((e) => `${e.n}:${e.kind}`), ['1:food', '2:treat', '3:food', '4:dose', '5:food', '6:note', '7:food', '8:dose']);
    const bf = ev[2] as Extract<DE.DayEvent, { kind: 'food' }>;
    assert.deepEqual(bf.items.map((i) => i.line.name), ['Toast', 'Milk'], 'toast and milk 5 minutes apart are one meal');
    assert.equal(bf.at, 104, 'glucose at the meal: the finger-prick'); assert.equal(Math.round(bf.after!), 145);
    assert.ok(bf.items.every((i) => i.source === 'estimate') && bf.warn.includes('estimate'), 'no product behind it: an estimate');
    assert.equal((ev[1] as Extract<DE.DayEvent, { kind: 'treat' }>).afterMin, 15, 'a treatment is rechecked at 15 minutes');
    assert.equal((ev[7] as Extract<DE.DayEvent, { kind: 'dose' }>).dose.type, 'long');
    const ms = DE.markers(ev, (t) => (t - day) / 60000);
    assert.ok(ms.some((m) => m.n === 3 && m.lane === 'med' && m.t === at(6, 50)), 'the breakfast dose is drawn in the insulin row with the meal\'s number');
    assert.equal(ms.find((m) => m.n === 8)!.step, 1, 'the long-acting dose 5 minutes after the dinner dose moves down a step');
  });
  test('graph + events page: where the carbs came from', () => {
    const P = (o: Record<string, unknown>) => ({ id: 'x', name: 'Bread', brand: null, kind: 'commercial', notes: null, per_item: false, ...o }) as never;
    const L = (unit: string | null) => ({ unit, productKey: null, name: 'x' }) as never;
    assert.equal(DE.sourceOf(L('g'), {}, P({})), 'label');
    assert.equal(DE.sourceOf(L('g'), {}, P({ kind: 'natural' })), 'table');
    assert.equal(DE.sourceOf(L('serving'), {}, P({ kind: 'natural' })), 'portion');
    assert.equal(DE.sourceOf(L('tbsp'), {}, P({})), 'portion');
    assert.equal(DE.sourceOf(L('serving'), {}, P({ brand: "McDonald's", per_item: true })), 'restaurant');
    assert.equal(DE.sourceOf(L('serving'), {}, P({ brand: 'PICK', name: 'Purple Mi (Small cup) – estimate', per_item: true })), 'estimate');
    assert.equal(DE.sourceOf(L('g'), { flags: ['imported'] }, P({})), 'gluroo');
    assert.equal(DE.sourceOf(L('g'), {}, null), 'estimate');
  });
  // a second made-up day: a low at 7:50, a juice + crackers logged as a snack at 7:56 (the logged glucose already 72),
  // the real breakfast at 10:58 planned as breakfast, a low 40 minutes after dinner treated with juice
  const pts2: [number, number][] = [];
  for (let k = 0; k < 288; k++) {
    const h = k / 12;
    let v = 110;
    if (h >= 7.5 && h < 8) v = 65;
    if (h >= 20.5 && h < 21) v = 45;
    pts2.push([day + k * 5 * M, v]);
  }
  const series2 = { t: Float64Array.from(pts2.map((p) => p[0])), v: Float64Array.from(pts2.map((p) => p[1])) };
  const f2 = (t: number, name: string, carbs: number, o: Record<string, unknown> = {}) => ({ t, name, detail: null, carbs, fat: null, protein: null, kcal: null, fiber: null, ...o });
  const day2 = D.buildDay(day, D.DEFAULT_STARTS, {
    foods: [f2(at(7, 56), 'Cocktail drink', 15), f2(at(7, 57), 'Crackers', 6), f2(at(10, 58), 'Milk', 12, { slot: 'breakfast', planned: true, id: 'b' }),
      f2(at(10, 59), 'Egg sandwich', 33, { slot: 'breakfast', planned: true, id: 'b2', fat: 9 }), f2(at(13, 10), 'Rice', 40), f2(at(14, 40), 'Apple', 10),
      f2(at(20, 0), 'Qeemar and honey', 37, { recipe: true }), f2(at(20, 38), 'Mango nectar', 19)],
    doses: [{ t: at(10, 51), units: 2, type: 'rapid', purpose: 'meal', forFood: 'b', calc: { food: 2.6, correction: 0, carbs: 40, suggested: 2 } }, { t: at(19, 40), units: 3, type: 'rapid', purpose: null }],
    pricks: [], treatments: [], activities: [], series: series2, low: 70, high: 180,
  });
  const s2 = Object.fromEntries(day2.slots.map((x) => [x.key, x]));
  test('dietitian sheet: a small snack eaten while the sensor was low is a low treatment, not breakfast', () => {
    assert.deepEqual(day2.treatments.map((x) => [x.name, x.byCgm]), [['Cocktail drink', true], ['Crackers', true], ['Mango nectar', true]]);
    assert.equal(day2.treatments[0].startMg, 65); assert.equal(day2.treatments[0].followedByFood, false);
    assert.equal(day2.totals.carbs, 12 + 33 + 40 + 10 + 37, 'treatment carbs are not food'); assert.equal(day2.totals.treatmentCarbs, 40);
    assert.ok(!D.isTreatment(f2(at(20, 40), 'Recipe', 20, { recipe: true }), series2, 70), 'a recipe is never a treatment');
    assert.ok(!D.isTreatment(f2(at(7, 50), 'Big breakfast', 60), series2, 70), 'a meal started during a low is still a meal');
  });
  test('dietitian sheet: a planned breakfast eaten before 11 is breakfast; its dose goes with it, with the calculator split', () => {
    assert.deepEqual(s2.breakfast.foods.map((f) => f.name), ['Milk', 'Egg sandwich']); assert.equal(s2.snack1.foods.length, 0);
    assert.equal(s2.breakfast.occasions.length, 1); assert.equal(s2.breakfast.occasions[0].doses[0].calc!.carbs, 40);
  });
  test('dietitian sheet: eating times apart are separate occasions; a reading 2 h after says what else happened', () => {
    assert.deepEqual(s2.lunch.occasions.map((o) => o.foods.map((f) => f.name)), [['Rice'], ['Apple']]);
    assert.deepEqual(s2.lunch.occasions[0].affected, [{ kind: 'food', t: at(14, 40) }]);
    assert.equal(s2.dinner.occasions[0].lowAfter!.mg, 45, 'the low after dinner is shown with dinner');
    assert.deepEqual(s2.dinner.occasions[0].affected.map((x) => x.kind), ['treatment']);
  });
  test('dietitian sheet: no breakfast logged as such → the morning\'s first real meal is breakfast; a low after eating does not make it a treatment', () => {
    // the 3 Oct shape: insulin at 10:51, chocolate milk 10:58 (15 g) + sandwich 10:59 (30 g), a low only after eating (11:00)
    const pts3: [number, number][] = [];
    for (let k = 0; k < 288; k++) { const h = k / 12; pts3.push([day + k * 5 * M, h >= 11 && h < 11.5 ? 64 : 110]); }
    const series3 = { t: Float64Array.from(pts3.map((p) => p[0])), v: Float64Array.from(pts3.map((p) => p[1])) };
    const d3 = D.buildDay(day, D.DEFAULT_STARTS, {
      foods: [f2(at(10, 58), 'Chocolate milk', 15), f2(at(10, 59), 'Egg sandwich', 30), f2(at(13, 30), 'Apple', 10)],
      doses: [{ t: at(10, 51), units: 2, type: 'rapid', purpose: 'meal' }], pricks: [], treatments: [], activities: [], series: series3, low: 70, high: 180,
    });
    const s3 = Object.fromEntries(d3.slots.map((x) => [x.key, x]));
    assert.deepEqual(s3.breakfast.foods.map((f) => f.name), ['Chocolate milk', 'Egg sandwich']);
    assert.equal(s3.snack1.foods.length, 0); assert.equal(d3.treatments.length, 0, 'a low after she started eating is not why she ate');
    assert.deepEqual(s3.breakfast.occasions[0].doses.map((x) => x.units), [2]);
    // a small late-morning snack with no insulin stays a snack
    const d4 = D.buildDay(day, D.DEFAULT_STARTS, { foods: [f2(at(11, 30), 'Biscuit', 8)], doses: [], pricks: [], treatments: [], activities: [], series: series2, low: 70, high: 180 });
    assert.equal(d4.slots.find((x) => x.key === 'snack1')!.foods.length, 1);
  });
  test('dietitian sheet: a snack after a low that was already treated, once she is back in range, is food', () => {
    // series2: low 20:30–21:00 (45); mango nectar at 20:38 treats it; an apple at 21:05 when she reads 110
    const d5 = D.buildDay(day, D.DEFAULT_STARTS, { foods: [f2(at(20, 38), 'Mango nectar', 19), f2(at(21, 5), 'Apple', 4)], doses: [], pricks: [], treatments: [], activities: [], series: series2, low: 70, high: 180 });
    assert.deepEqual(d5.treatments.map((x) => x.name), ['Mango nectar']);
    assert.deepEqual(d5.slots.find((x) => x.key === 'dinner')!.foods.map((f) => f.name), ['Apple']);
  });
  test('dietitian sheet: crackers eaten a minute after the juice, during the same low, are part of the treatment, not breakfast', () => {
    // the 3 Oct 7:56 shape: low at 7:40 (65), juice 7:56 when the sensor reads 72, Ritz 26 s later; the real breakfast at 10:58 with a dose
    const pts: [number, number][] = [];
    for (let k = 0; k < 288; k++) { const h = k / 12; pts.push([day + k * 5 * M, h >= 7.6 && h < 7.9 ? 65 : h >= 7.9 && h < 8.2 ? 72 : 110]); }
    const series = { t: Float64Array.from(pts.map((p) => p[0])), v: Float64Array.from(pts.map((p) => p[1])) };
    const d6 = D.buildDay(day, D.DEFAULT_STARTS, {
      foods: [f2(at(7, 56), 'Cocktail drink', 15), f2(at(7, 56) + 26000, 'Ritz', 6), f2(at(10, 58), 'Egg sandwich', 30)],
      doses: [{ t: at(10, 51), units: 2, type: 'rapid', purpose: 'meal' }], pricks: [], treatments: [], activities: [], series, low: 70, high: 180,
    });
    assert.deepEqual(d6.treatments.map((x) => x.name), ['Cocktail drink', 'Ritz']);
    assert.deepEqual(d6.slots.find((x) => x.key === 'breakfast')!.foods.map((f) => f.name), ['Egg sandwich']);
  });
  test('dietitian sheet: totals with missing values are marked incomplete, never counted as zero', () => {
    const o = s2.breakfast.occasions[0]; assert.equal(o.fat.v, 9); assert.equal(o.fat.partial, true);
    assert.deepEqual(D.sumOf([null, null]), { v: null, partial: false });
    assert.equal(day2.recorded, true);
    const empty = D.buildDay(day + 86400000, D.DEFAULT_STARTS, { foods: [], doses: [], pricks: [], treatments: [], activities: [], series: { t: new Float64Array(0), v: new Float64Array(0) }, low: 70, high: 180 });
    assert.equal(empty.recorded, false);
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

{
  const { displayName } = await import('../shortName');
  test('report names: pack sizes, piece counts and calories removed (the amount eaten is printed beside it)', () => {
    const cases: [string, string][] = [
      ['Ritz Crackers 39.6g (12 pcs)', 'Ritz Crackers'],
      ['1.2.3 Cocktail Drink (Kids) 125ml', '1.2.3 Cocktail Drink (Kids)'],
      ['Half Cream Milk 250ml', 'Half Cream Milk'],
      ['Apple Juice 1 LTR (كوب 200 مل)', 'Apple Juice'],
      ['سناك بار / بسكويت (101 سعرة)', 'سناك بار / بسكويت'],
      ['بار (55 غ)', 'بار'],
      ['قيمر وعسل', 'قيمر وعسل'],
      ['7UP', '7UP'],
    ];
    for (const [a, b] of cases) assert.equal(displayName(a), b, a);
  });
}

console.log('product groups');
{
  const { groupOf, groupsIn, typesIn, groupByKey, subgroupOf, subgroupsIn } = await import('../productGroups');
  test('sub-groups: one more level by category or name word; the last of each group takes the rest', () => {
    const sg = (name: string, category: string) => subgroupOf({ name, category })?.key;
    assert.equal(sg('صدر دجاج مشوي', 'لحوم ودجاج'), 'chicken'); assert.equal(sg('لحم غنم مشوي', 'لحوم ودجاج'), 'meat'); assert.equal(sg('روبيان مطبوخ', 'سمك وروبيان'), 'fish');
    assert.equal(sg('بطاط مسلوق', 'خضار'), 'starchy'); assert.equal(sg('ذرة مسلوقة', 'خضار'), 'starchy'); assert.equal(sg('خيار', 'خضار'), 'salad'); assert.equal(sg('بروكلي مسلوق', 'خضار'), 'cooked');
    assert.equal(sg('تمر مجهول', 'فواكه'), 'dried'); assert.equal(sg('موز', 'فواكه'), 'fresh');
    assert.equal(sg('Sliced White Bread', 'توست'), 'toast'); assert.equal(sg('خبز عربي أبيض', 'خبز'), 'arabic'); assert.equal(sg('Sandwich Rolls', 'خبز'), 'rolls'); assert.equal(sg('صمون', 'خبز'), 'rolls'); assert.equal(sg('White Bread', 'خبز'), 'loaf'); assert.equal(sg('Fries (Small)', 'نشويات'), 'other'); assert.equal(sg('Half Cream Milk 1 LTR', 'كريمة طبخ'), 'milk'); assert.equal(sg('Garden Salad', 'خضار'), 'salad');
    assert.equal(sg('عدس مطبوخ', 'حبوب وبقوليات'), 'legumes'); assert.equal(sg('شوفان (جاف)', 'حبوب وبقوليات'), 'grains');
    assert.equal(sg('سباغيتي مطبوخة', 'باستا'), 'cooked'); assert.equal(sg('Spaghetti No. 5', 'باستا'), 'dry');
    assert.equal(sg('لوز نيء', 'مكسرات'), undefined, 'a group without sub-groups');
    assert.deepEqual(subgroupsIn([{ name: 'موز', category: 'فواكه' }, { name: 'تفاح', category: 'فواكه' }, { name: 'تمر', category: 'فواكه' }], 'fruit').map((x) => [x.sub.key, x.n]), [['dried', 1], ['fresh', 2]]);
  });
  test('product groups: categories gather into groups; a brand shows only its groups, with counts, then the types inside', () => {
    assert.equal(groupOf('روب').key, 'dairy'); assert.equal(groupOf('آيس كريم').key, 'sweets'); assert.equal(groupOf('شيء جديد').key, 'other'); assert.equal(groupOf(null).key, 'other');
    const kdd = [{ category: 'حليب' }, { category: 'حليب' }, { category: 'لبن' }, { category: 'مشروبات' }, { category: 'آيس كريم' }, { category: 'غريب' }];
    assert.deepEqual(groupsIn(kdd).map((x) => [x.group.key, x.n]), [['dairy', 3], ['drinks', 1], ['sweets', 1], ['other', 1]]);
    assert.deepEqual(typesIn(kdd, 'dairy'), [{ cat: 'حليب', n: 2 }, { cat: 'لبن', n: 1 }]);
  });
  test('product groups: the generic foods\' categories each land in their own group, in the fixed order', () => {
    assert.equal(groupOf('رز').key, 'rice'); assert.equal(groupOf('ملوخية').key, 'veg'); assert.equal(groupOf('بطاط مجمد').key, 'veg');
    assert.equal(groupOf('سمك وروبيان').key, 'protein'); assert.equal(groupOf('سكر وعسل').key, 'sauces'); assert.equal(groupOf('عصير طبيعي').key, 'drinks');
    assert.equal(groupOf('حبوب الإفطار').key, 'breakfast'); assert.equal(groupOf('باستا').key, 'pasta'); assert.equal(groupOf('طحين').key, 'bread');
    const mix = [{ category: 'شوكولاتة' }, { category: 'رز' }, { category: 'خضار' }, { category: 'مكسرات' }, { category: 'رز' }];
    assert.deepEqual(groupsIn(mix).map((x) => [x.group.key, x.n]), [['veg', 1], ['nuts', 1], ['rice', 2], ['sweets', 1]]);
    assert.equal(groupByKey('rice')?.emoji, '🍚'); assert.equal(groupByKey('other')?.key, 'other'); assert.equal(groupByKey('nope'), null);
  });
}

console.log('compare foods');
{
  const { withCompared, lowestCarbs } = await import('../../engine/mom');
  test('compare foods: up to three, no repeats; the fewest carbs marked only when there is something to compare', () => {
    const a = { kind: 'product' as const, id: 'a' }, b = { kind: 'recipe' as const, id: 'b' }, c = { kind: 'product' as const, id: 'c' }, d = { kind: 'product' as const, id: 'd' };
    assert.deepEqual(withCompared(withCompared([a], a), b), [a, b]);
    assert.deepEqual(withCompared([a, b, c], d), [a, b, c], 'a full list stays as it is');
    assert.deepEqual(lowestCarbs([30, null, 12.5]), [2]); assert.deepEqual(lowestCarbs([10, 10, 20]), [0, 1]);
    assert.deepEqual(lowestCarbs([10, null]), []); assert.deepEqual(lowestCarbs([8, 8]), []);
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
    const texts: string[] = []; const urls: string[] = []; let shown = false; let req: any = null; const files = new Map<string, string>();
    if (opts.cache !== undefined) files.set('d/layan-widget.json', JSON.stringify(opts.cache));
    if (opts.savedCode) files.set('d/layan-widget-code.js', opts.savedCode);
    const node = (): any => new Proxy({}, { set: (_t, p, v) => { if (p === 'url') urls.push(v); return true; }, get: (_t, p) => p === 'then' ? undefined : p === 'addText' ? (x: string) => { texts.push(String(x)); return U; } : p === 'addDate' ? (d: Date) => { texts.push(`@age ${Math.round((Date.now() - d.getTime()) / 60000)}m`); return U; } : p === 'addStack' ? () => node() : U });
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
    Object.assign(g, { Request, FileManager: { local: () => fm }, ListWidget: function () { return node(); }, DrawContext: function () { return new Proxy({}, { set: () => true, get: (_t, p) => p === 'then' ? undefined : p === 'drawTextInRect' ? (x: string) => { texts.push(`draw ${x}`); } : U }); }, Path: U, Point: U, Color: U, Font: U, Rect: U, SFSymbol: U,
      Size: function (this: any, w: number, h: number) { this.width = w; this.height = h; }, Device: { screenSize: () => ({ width: 393, height: 852 }) },
      Script: { name: () => 'ليان', setWidget: () => { shown = true; }, complete: () => {} }, config: { widgetFamily: family, runsInWidget: true }, args: { widgetParameter: null } });
    try { await new AsyncFn(script)(); } finally { for (const k of ['Request', 'FileManager', 'ListWidget', 'DrawContext', 'Path', 'Point', 'Color', 'Font', 'Size', 'Rect', 'SFSymbol', 'Device', 'Script', 'config', 'args']) delete g[k]; }
    return { texts: texts.join(' | '), shown, req, files, urls };
  };
  const now = Date.now(), at = (m: number) => new Date(now - m * 60000).toISOString();
  const data = { child: 'ليان', unit: 'mmol', low: 70, high: 180, readings: [{ t: at(30), v: 150, trend: 3 }, { t: at(15), v: 120, trend: 2 }, { t: at(2), v: 110, trend: 2 }] };
  test('widget: the loader fetches the widget from the app and runs it; value, arrow, age, range word; every size draws', async () => {
    assert.ok(body.startsWith('// LAYAN_WIDGET'), 'the served widget starts with the mark the loader checks');
    const m = await run('medium', data);
    assert.ok(m.shown);
    const clock = (() => { const x = new Date(now - 2 * 60000); return String(x.getHours()).padStart(2, '0') + ':' + String(x.getMinutes()).padStart(2, '0'); })();
    assert.match(m.texts, /ليان/); assert.match(m.texts, /draw 6\.1 ↘/, 'the value and arrow in the bubble on the graph');
    assert.match(m.texts, /draw الحين/, 'the graph ends at now');
    void clock;
    const sm = (await run('small', data)).texts;
    assert.match(sm, /6\.1/); assert.match(sm, /@age 2m/, 'the age counts up by itself');
    assert.equal(m.req.url, 'https://x.supabase.co/rest/v1/rpc/share_view');
    assert.deepEqual(JSON.parse(m.req.body), { p_token: 'tok"en' }, 'the token is embedded safely');
    assert.equal(m.req.headers['Content-Profile'], 'carb');
    assert.equal(m.files.get('d/layan-widget-code.js'), body, 'the widget is kept for offline use');
    for (const f of ['small', 'large', 'accessoryInline', 'accessoryCircular', 'accessoryRectangular']) assert.match((await run(f, data)).texts, /6\.1/, f);
    assert.match(m.texts, /@age 2m \|  قبل/, 'the age counts up next to the reading');
    assert.doesNotMatch(m.texts, /↻/, 'no refresh chip: a tap anywhere refreshes');
    assert.deepEqual(m.urls, ['scriptable:///run/%D9%84%D9%8A%D8%A7%D9%86'], 'a tap runs the widget\'s script again for a fresh reading');
  });
  test('widget: offline uses the kept widget; a page that is not the widget is never run; nothing kept says so', async () => {
    assert.match((await run('small', data, { code: null, savedCode: body })).texts, /6\.1/);
    assert.match((await run('small', data, { code: '<html>not found</html>' })).texts, /تعذّر تحميل الويدجت/);
    assert.match((await run('small', data, { code: null })).texts, /تعذّر تحميل الويدجت/);
  });
  test('widget: IOB and COB match the app (engine/iob.ts, engine/absorb.ts) for the same doses and carbs', async () => {
    const ob = { dia: 360, peak: 65, absorb: 180, doses: [{ t: at(50), u: 3 }, { t: at(200), u: 4 }, { t: at(400), u: 2 }], carbs: [{ t: at(50), g: 45, f: 25 }, { t: at(120), g: 15, d: true }, { t: at(200), g: 30 }] };
    const P = { dia: 360, peak: 65 };
    const iob = iobAt(now, ob.doses.map((d) => ({ t: Date.parse(d.t), units: d.u })), P);
    const { stillToAbsorb } = await import('../../engine/absorb');
    const cob = stillToAbsorb(ob.carbs.map((c) => ({ t: Date.parse(c.t), carbs: c.g, fat: c.f, drink: c.d })), now);
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
    const old11 = (await run('medium', { ...data, readings: [{ t: at(11), v: 120, trend: 3 }] })).texts;
    assert.match(old11, /قراءة قديمة/, 'old after 10 minutes'); assert.doesNotMatch(old11, /→/);
    assert.doesNotMatch((await run('medium', { ...data, readings: [{ t: at(9), v: 120, trend: 3 }] })).texts, /قراءة قديمة/);
    assert.match(old, /قراءة قديمة/); assert.doesNotMatch(old, /→/, 'no arrow on an old reading');
    assert.match((await run('medium', { error: 'invalid' })).texts, /الرابط انتهى/);
    assert.match((await run('medium', null, { throws: true })).texts, /لا اتصال/);
    assert.match((await run('medium', null, { throws: true, cache: data })).texts, /بلا اتصال/);
    assert.match((await run('medium', { ...data, readings: [] })).texts, /لا توجد قراءات/);
    assert.match((await run('accessoryInline', data, { en: true })).texts, /2 min ago/, 'in English when the app is');
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
  const C = await import('../carbs');
  const P = await import('../portion');
  const M = await import('../../engine/mom');
  const cup = { id: 'pick-s', name: 'Original Yo (Small)', brand: 'PICK', category: 'آيس كريم', kind: 'commercial', unit: 'g', per_item: true, // i18n-ok
    carbs_per_100: 28, fat_per_100: 0, protein_per_100: 5, fiber_per_100: 6, kcal_per_100: 129, serving_size: 100, carbs_per_serving: 28, pack_size: null, label_basis: 'as_sold', approved: true, available: false } as any;
  test('a per-item food: one item is one serving, the carbs are exactly the published number, and no grams are offered', () => {
    const s = { tbsp_size: 15 } as any;
    const items = M.planItemsOf({ kind: 'product', id: 'pick-s', portion_id: null, amount: 2, unit: 'serving' }, { products: [cup], recipes: [], ingsByRecipe: new Map(), portions: [] } as any)!;
    const m = C.computeMeal(items.map((i: any, k: number) => ({ ...i, id: String(k), qty_confirmed: true, note: null, sort: k })), [cup], s);
    assert.equal(m.total.carbs, 56, 'two Small cups = 2 × 28 g');
    assert.deepEqual(P.amountChoices(cup).map((c) => [c.key, c.amount]), [['item', 100], ['item', 200]], 'items only, never 100 g');
    assert.equal(P.portion(cup, 100).carbs, 28);
  });
}

{
  const R = await import('../restaurants');
  test('frozen yogurt cups: gathered by size, each size listing its flavours; the weighed flavour comes with every size', () => {
    const it = (name: string, per_item = true) => ({ name, per_item });
    const c = R.cupsOf([it('Original Yo (Small cup)'), it('Vanilla Mi (Small cup)'), it('Original Yo (Large cup)'), it('Purple Mi', false), it('Watermelon Cup')]);
    assert.deepEqual(c.sizes.map((z) => [z.size.key, z.items.map((x) => x.flavour)]), [['Small cup', ['Original Yo', 'Vanilla Mi']], ['Large cup', ['Original Yo']]]);
    assert.deepEqual(c.weighed.map((x) => x.name), ['Purple Mi']);
    assert.deepEqual(c.rest.map((x) => x.name), ['Watermelon Cup'], 'a fruit cup is not a frozen yogurt size');
    assert.deepEqual(R.cupsOf([it('Original Yo (Small cup)'), it('Big Mac')]).sizes, [], 'one flavour only: stays as tiles');
  });
}

{
  const A = await import('../../engine/alarmLog');
  const T0 = Date.UTC(2026, 9, 5, 2, 0), M = 60000;
  const al = (id: string, kind: any, s: number, e: number | null, worst: number | null = null, ack = false) => ({ id, kind, state: e === null ? 'active' : 'resolved', started_at: new Date(T0 + s * M).toISOString(),
    active_at: new Date(T0 + s * M).toISOString(), value_mgdl: worst, worst_mgdl: worst, acknowledged_by: ack ? 'u1' : null, acknowledged_at: ack ? new Date(T0 + (s + 2) * M).toISOString() : null, ack_action: ack ? 'treated' : null, snoozed_until: null, resolved_at: e === null ? null : new Date(T0 + e * M).toISOString() }) as any;
  const night = [al('p', 'predicted_low', 0, 15, 76), al('l', 'low', 14, 40, 62, true), al('u', 'urgent_low', 20, 30, 52), al('f', 'rapid_fall', 5, 12), al('h', 'high', 300, 360, 250),
    { ...al('x', 'low', 500, 505, 68), active_at: null }];
  test('alarm log: low alarms that follow each other are one episode; early warnings only with «all»; a pending one that never alarmed is left out', () => {
    const main = A.episodes(night, { now: T0 + 999 * M });
    assert.deepEqual(main.map((e) => [e.dir, e.alarms.map((a) => a.id)]), [['high', ['h']], ['low', ['l', 'u']]]);
    assert.equal(main[1].main, 'urgent_low'); assert.equal(main[1].worst, 52); assert.equal(main[1].ack?.id, 'l');
    const all = A.episodes(night, { all: true, now: T0 + 999 * M });
    assert.deepEqual(all[1].alarms.map((a) => a.id), ['p', 'f', 'l', 'u'], 'low expected and falling fast join the same night episode');
    assert.equal(all[1].start, T0); assert.equal(all[1].end, T0 + 40 * M);
  });
  test('alarm log timeline: entries during an episode (and up to 30 min after) hang off it; others stand alone', () => {
    const eps = A.episodes(night, { now: T0 + 999 * M });
    const e = (k: string, m: number) => ({ k, t: T0 + m * M });
    const tl = A.timeline(eps, [e('juice', 16), e('prick', 33), e('juice2', 65), e('dose', 320), e('meal', 200)]);
    assert.deepEqual(tl.map((x) => x.kind === 'episode' ? [x.ep.dir, x.entries.map((y) => y.k)] : x.entry.k), [['high', ['dose']], 'meal', ['low', ['juice', 'prick', 'juice2']]]);
  });
}

{
  const S = await import('../../engine/sameMeal');
  const h = (id: string, at: string, carbs: number, lines: [string, number][], name = id) => ({ id, kind: 'meal', recipe_id: null, name, category: null, eaten_at: at, total_carbs: carbs,
    lines: lines.map(([n, c]) => ({ name: n.split(' — ')[0], product: n, quantity: 1, unit: 'serving', state: 'as_is', role: 'main', carbs: c })) }) as any;
  const fri = [h('n', '2026-10-02T18:22:29Z', 15, [["Chicken McNuggets 6 pcs — McDonald's", 15]]), h('f', '2026-10-02T18:22:37Z', 42.8, [["World Famous Fries (Regular) — McDonald's", 42.8]])];
  const mon = h('d', '2026-10-05T16:32:48Z', 53.7, [["Chicken McNuggets 6 pcs — McDonald's", 18], ["Fries (Small) — McDonald's", 24.7], ["Barbeque Sauce (صوص باربيكيو) — McDonald's", 11]]);
  const other = h('r', '2026-10-03T12:00:00Z', 45, [['Rice with stew + Fish', 45]]);
  test('same meal: food words without brand, size or count', () => {
    assert.deepEqual(S.foodKey("World Famous Fries (Regular) — McDonald's"), ['fries']);
    assert.deepEqual(S.foodKey('Chicken McNuggets 6 pcs'), ['chicken', 'mcnuggets']);
    assert.deepEqual(S.foodKey('1.2.3 Cocktail Drink (Kids) 125ml'), ['1.2.3', 'cocktail', 'drink']);
    assert.ok(S.sameFood(['fries'], ['fries']) && S.sameFood(['chicken', 'mcnuggets'], ['mcnuggets']) && !S.sameFood(['fries'], ['rice']));
    assert.deepEqual(S.foodKey('أرز أبيض مطبوخ'), S.foodKey('رز أبيض مطبوخ'), 'one rice, two spellings'); // i18n-ok
    assert.ok(S.sameFood(S.foodKey('عيش أبيض'), S.foodKey('رز أبيض مطبوخ')), 'عيش is rice'); // i18n-ok
  });
  test('same meal: Friday nuggets and fries logged as two entries match Monday\'s one dinner with sauce', () => {
    const all = S.sittings([...fri, other, mon]);
    assert.equal(all.length, 3, 'the two Friday entries are one sitting');
    const target = S.sittingOf('d', all)!;
    const found = S.sameMeals(target, all);
    assert.deepEqual(found.map((x) => x.s.id), ['n'], 'Friday, not the rice');
    assert.ok(Math.abs(found[0].score - 42.7 / 53.7) < 0.01, 'the sauce is the only part Friday did not have');
    assert.deepEqual(S.sameMeals(S.sittingOf('r', all)!, all), [], 'nothing like the rice before');
  });
}

{
  const { productFromQuick } = await import('../quickProduct');
  const base = { name: 'Breaded Shrimps', brand: 'Seara', kind: 'meal' as const, barcode: null, carbs: 13, fat: 7.8, protein: 9.1, fiber: 0.7, kcal: 150 };
  test('a food added from the Log sheet becomes a catalogue product: the label per 100 g with the pack amount as the serving', () => {
    const p = productFromQuick({ ...base, per100: { carbs: 20, fat: 12, protein: 14, fiber: 1, kcal: 230 }, amount: 65, amount_unit: 'g' }, 'سمك وروبيان');
    assert.deepEqual([p.unit, p.per_item, p.carbs_per_100, p.kcal_per_100, p.serving_size, p.carbs_per_serving, p.category, p.approved], ['g', false, 20, 230, 65, 13, 'سمك وروبيان', true]);
  });
  test('given straight per serving, it is one item (values per item) in the snacks or other group', () => {
    const p = productFromQuick({ ...base, kind: 'snack', per100: null, amount: null, amount_unit: null });
    assert.deepEqual([p.per_item, p.carbs_per_100, p.carbs_per_serving, p.serving_size, p.category], [true, 13, 13, 100, 'سناكات']);
  });
}

{
  const { activityMessage, activityRecipients } = await import('../../../supabase/functions/carb-activity/activity');
  const strip = (x: string) => x.replace(/[\u2066\u2069]/g, '');
  const at = new Date(Date.UTC(2026, 9, 5, 17, 5)).toISOString(); // 8:05 PM in Kuwait
  const row = (kind: any, o: Record<string, unknown> = {}) => ({ kind, by_user: 'mom', occurred_at: at, carbs: null, units: null, mgdl: null, name: null, ...o }) as any;
  test('shared activity: the other parent is told, never the one who logged it, and only the kinds they keep on', () => {
    const members = [{ user_id: 'mom', display_name: 'Rawan' }, { user_id: 'dad', display_name: 'Dad', activity_push: { meal: false } }];
    assert.deepEqual(activityRecipients(members, 'mom', 'rapid'), ['dad']);
    assert.deepEqual(activityRecipients(members, 'mom', 'meal'), [], 'dad switched meals off');
    assert.deepEqual(activityRecipients(members, 'dad', 'meal'), ['mom'], 'no setting yet means on');
  });
  test('shared activity messages say who, what and when', () => {
    const rapid = activityMessage(row('rapid', { units: 4 }), 'Rawan', 'en');
    assert.equal(strip(rapid.title), '💉 Rawan added NovoRapid 4 U');
    assert.equal(strip(rapid.body), 'At 8:05 PM');
    assert.equal(strip(activityMessage(row('long', { units: 10 }), null, 'en').title), '💉 Tresiba 10 U added');
    const meal = activityMessage(row('meal', { carbs: 42, name: 'Toast' }), 'Rawan', 'en');
    assert.equal(strip(meal.title), '🍽️ Rawan added a meal · 42 g carbs');
    assert.equal(strip(meal.body), 'Toast\nAt 8:05 PM');
    assert.equal(strip(activityMessage(row('treatment', { carbs: 10 }), null, 'en').title), '🧃 Low treatment added · 10 g carbs');
    assert.equal(strip(activityMessage(row('finger', { mgdl: 101 }), 'Rawan', 'en', 'mmol').title), '🩸 Rawan added a finger-prick 5.6 mmol/L');
    assert.equal(strip(activityMessage(row('rapid', { units: 4 }), 'Rawan', 'ar').title), '💉 نوفورابيد 4 وحدة · من Rawan');
    assert.equal(strip(activityMessage(row('rapid', { units: 4 }), 'Rawan', 'ar').body), 'الساعة 8:05 م');
  });  test('a food asked for from simple mode tells the other parent, who can switch it off', () => {
    const r = activityMessage(row('request', { name: 'مرق دجاج' }), 'Rawan', 'en');
    assert.equal(strip(r.title), '📷 Rawan asked for a new food: مرق دجاج');
    assert.equal(r.body, 'Open it to add its label and amounts');
    assert.equal(strip(activityMessage(row('request', { name: 'كباب' }), 'Rawan', 'ar').title), '📷 طلب أكل جديد: كباب · من Rawan');
    const members = [{ user_id: 'mom', display_name: 'Rawan' }, { user_id: 'dad', display_name: 'Dad' }, { user_id: 'gran', display_name: 'Gran', activity_push: { request: false } }];
    assert.deepEqual(activityRecipients(members, 'mom', 'request'), ['dad']);
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
  test('mom meal: a food from its label (11 g for one piece) counts exactly 11 g, and two pieces 22 g', async () => {
    const { computeMeal: cm } = await import('../carbs');
    const planMeal = (items: any[], products: any[], st: any) => cm(items.map((i, k) => ({ ...i, id: String(k), qty_confirmed: true, note: null, sort: k })), products, st); // as plans.ts planMeal
    const ice = prod('ice', { per_item: true, carbs_per_100: 11, category: 'أخرى' });
    const c2 = { ...cat, products: [...cat.products, ice], portions: [...cat.portions, { id: 'pi', product_id: 'ice', recipe_id: null, label: 'حبة', amount: 100, photo_path: null, sort: 0 }] };
    const items = M.planItems([{ kind: 'product', id: 'ice', portion_id: 'pi' }], c2)!;
    const m = planMeal(items, c2.products, S);
    assert.equal(m.complete, true); assert.equal(Math.round(m.total.carbs * 10) / 10, 11);
    const two = planMeal(M.planItems([{ kind: 'product', id: 'ice', portion_id: 'pi' }, { kind: 'product', id: 'ice', portion_id: 'pi' }], c2)!, c2.products, S);
    assert.equal(Math.round(two.total.carbs * 10) / 10, 22);
  });
  test('mom meal: a weighed home dish — the pot\'s ingredients scaled to the grams; what is served on the side is left out', () => {
    // the pasta recipe as Dad wrote it: 120 g pasta, 80 g meat, 80 g sauce in the pot; 100 g yogurt on the side
    const ing = (id: string, q: number, o: Record<string, unknown> = {}) => ({ id, role: 'main', product_id: null, slot_category: null, label: id, quantity: q, unit: 'g', state: 'cooked', qty_confirmed: true, note: null, sort: 0, ...o });
    const pasta = { ...cat, recipes: [...cat.recipes, { ...cat.recipes[0], id: 'r2' }],
      ingsByRecipe: new Map([['r2', [ing('pasta', 120), ing('meat', 80), ing('sauce', 80), ing('yogurt', 100, { on_side: true })]]]) as any };
    assert.equal(M.recipeMixGrams(pasta.ingsByRecipe.get('r2'), []), 280, 'the yogurt is not in the pot');
    const w = M.planItemsOf({ kind: 'recipe', id: 'r2', portion_id: null, amount: 243, unit: 'g' }, pasta)!;
    assert.deepEqual(w.map((i) => i.label), ['pasta', 'meat', 'sauce']);
    assert.equal(Math.round(w[0].quantity), Math.round(120 * 243 / 280), 'pasta in a 243 g plate');
    assert.equal(Math.round(w.reduce((n, i) => n + i.quantity, 0)), 243);
    assert.equal(M.planItemsOf({ kind: 'recipe', id: 'r2', portion_id: null, amount: 1, unit: 'plate' }, pasta)!.length, 4, 'a plate still has the yogurt');
    const noSize = { ...pasta, ingsByRecipe: new Map([['r2', [ing('bread', 2, { unit: 'serving', product_id: 'frost' })]]]) as any };
    assert.equal(M.planItemsOf({ kind: 'recipe', id: 'r2', portion_id: null, amount: 200, unit: 'g' }, noSize), null, 'a serving with no known size: no weight, never a guess');
  });
  test('mom meal: a pot not measured is estimated (dry grain ×3, raw veg ×0.8, a cup 160 g of rice or 230 g of stew); measured wins', () => {
    const ing = (id: string, q: number, o: Record<string, unknown> = {}) => ({ id, role: 'main', product_id: id, slot_category: null, label: id, quantity: q, unit: 'g', state: 'as_is', qty_confirmed: true, note: null, sort: 0, ...o }) as any;
    const ps = [prod('wheat', { carbs_per_100: 75.9, category: 'حبوب وبقوليات' }), prod('meat', { carbs_per_100: 0 }), prod('sugar', { carbs_per_100: 100 }), prod('onion', { carbs_per_100: 9.3 }), prod('rice', { carbs_per_100: 28.2, category: 'رز' })];
    const ings = [ing('wheat', 40, { state: 'raw' }), ing('meat', 60, { state: 'cooked' }), ing('sugar', 5)];
    const r = { ...cat.recipes[0], id: 'h' };
    const est = M.recipePot(r, ings, ps);
    assert.equal(est.g, 40 * 3 + 60 + 5, 'the dry wheat triples');
    assert.equal(est.gApprox, true);
    assert.equal(Math.round(est.cups! * 100) / 100, Math.round(185 / 230 * 100) / 100, 'a stew-like cup');
    assert.equal(est.cupsApprox, true);
    const machboos = [ing('rice', 140, { state: 'cooked' }), ing('meat', 100, { state: 'cooked' }), ing('onion', 50, { state: 'raw' })];
    const m = M.recipePot(r, machboos, ps);
    assert.equal(m.g, 140 + 100 + 40, 'raw onion shrinks; nothing dry, so the weight is not flagged');
    assert.equal(m.gApprox, false);
    assert.equal(m.cups, 280 / 160, 'a rice dish: a cup of rice');
    const measured = { ...r, cooked_weight_g: 300, yield_cups: 2 };
    assert.deepEqual(M.recipePot(measured, ings, ps), { g: 300, cups: 2, gApprox: false, cupsApprox: false });
    assert.equal(M.recipeShare(measured, ings, ps, 'g', 150), 0.5);
    assert.equal(M.recipeShare(measured, ings, ps, 'cup', 0.5), 0.25);
    assert.equal(M.recipeShare(measured, ings, ps, 'plate', 0.5), 0.5);
    const c4 = { ...cat, products: ps, recipes: [measured], ingsByRecipe: new Map([['h', ings]]) as any };
    assert.deepEqual(M.planItemsOf({ kind: 'recipe', id: 'h', portion_id: null, amount: 0.5, unit: 'cup' }, c4)!.map((i) => i.quantity), [10, 15, 1.25], 'half a cup of a two-cup pot');
    assert.deepEqual(M.planItemsOf({ kind: 'recipe', id: 'h', portion_id: null, amount: 75, unit: 'g' }, c4)!.map((i) => i.quantity), [10, 15, 1.25]);
    const noSize = [ing('bread', 2, { unit: 'serving' })];
    assert.equal(M.recipePot(r, noSize, ps).g, null, 'a serving with no known size: no weight, never a guess');
  });
  test('mom meal: one part of a dish weighed after cooking keeps its cooked state (dry pasta label, cooked on the plate)', () => {
    const c5 = { ...cat, products: [...cat.products, prod('pasta', { carbs_per_100: 72, cooked_yield: 2.4 })] };
    assert.equal(M.planItemsOf({ kind: 'product', id: 'pasta', portion_id: null, amount: 120, unit: 'g', cooked: true }, c5)![0].state, 'cooked');
    assert.equal(M.planItemsOf({ kind: 'product', id: 'pasta', portion_id: null, amount: 120, unit: 'g' }, c5)![0].state, 'as_is');
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

console.log('glycemic index');
{
  const { giBand, glBand, giOf, mealGi } = await import('../../engine/gi');
  test('gi: bands at 55/70 and 10/20; a food with too little carbohydrate, or none recorded, shows nothing', () => {
    assert.deepEqual([giBand(55), giBand(56), giBand(69), giBand(70)], ['low', 'mid', 'mid', 'high']);
    assert.deepEqual([glBand(10), glBand(11), glBand(19.9), glBand(20)], ['low', 'mid', 'mid', 'high']);
    assert.equal(giOf({ gi: null, gi_match: 'na' }), null);
    assert.equal(giOf({ gi: 50, gi_match: null }), null);
    assert.deepEqual(giOf({ gi: 73, gi_match: 'exact' }), { gi: 73, band: 'high', approx: false, estimate: false });
    assert.equal(giOf({ gi: 55, gi_match: 'estimate' })!.estimate, true);
  });
  test('gi: a meal is weighted by carbs; meat adds no load; too many foods without a GI shows nothing', () => {
    const rice = { gi: 73, gi_match: 'exact' as const }, lentils = { gi: 32, gi_match: 'exact' as const }, meat = { gi: null, gi_match: 'na' as const };
    const m = mealGi([{ carbs: 30, food: rice }, { carbs: 10, food: lentils }, { carbs: 0.5, food: meat }])!;
    assert.equal(m.gi, Math.round((73 * 30 + 32 * 10) / 40));
    assert.equal(m.gl, Math.round(0.73 * 30 + 0.32 * 10));
    assert.equal(m.approx, false);
    assert.equal(mealGi([{ carbs: 30, food: rice }, { carbs: 10, food: null }]), null, '75% known is not enough');
    const part = mealGi([{ carbs: 45, food: rice }, { carbs: 5, food: null }])!;
    assert.equal(part.approx, true, 'a part without a GI makes it approximate');
    assert.equal(part.gl, Math.round(0.73 * 45 * 50 / 45), 'the unknown part counted at the meal\'s GI');
    assert.equal(mealGi([{ carbs: 0.5, food: rice }]), null, 'no carbs, nothing to say');
    assert.equal(mealGi([{ carbs: 20, food: { gi: 55, gi_match: 'similar' } }])!.approx, true);
  });
}

console.log('food search ranking');
{
  const { matchTier, rankFoods } = await import('../search');
  test('search tiers: exact name, then a name beginning with it, then found another way; «ال» and a note in brackets ignored', () => {
    assert.equal(matchTier(['رز'], [], 'رز'), 0);
    assert.equal(matchTier(['الرز'], [], 'رز'), 0, '«ال» in the name');
    assert.equal(matchTier(['نخي (حمص حب مطبوخ)'], [], 'نخي'), 0, 'the note in brackets');
    assert.equal(matchTier(['رز بسمتي مطبوخ'], [], 'رز'), 1);
    assert.equal(matchTier(['أرز أبيض مطبوخ', 'White rice, cooked'], [], 'rice'), 2, 'a word inside the English name');
    assert.equal(matchTier(['Big Mac'], ["McDonald's"], 'ماك'), 2, 'the brand, in the other language');
    assert.equal(matchTier(['Harees'], [], 'HAR'), 1, 'case does not matter');
    assert.equal(matchTier(['هريس'], [], 'رز'), null);
    assert.equal(matchTier(['بطاط مسلوق'], [], 'طاط'), 2, 'only «ال» counts for a name start; «ب» is not one');
  });
  test('search order: tier first; then favourites, then most eaten, then at home, then name', () => {
    const f = (label: string, o: Record<string, unknown> = {}) => ({ label, names: [label], ...o });
    const items = [f('رز مصري مطبوخ', { home: false }), f('رز بسمتي مطبوخ', { uses: 3 }), f('أرز أبيض مطبوخ'), f('رز', { uses: 0 }), f('رز ودجاج', { fav: true }), f('هريس')];
    assert.deepEqual(rankFoods(items, 'رز', (x) => x).map((x) => x.label), ['رز', 'رز ودجاج', 'رز بسمتي مطبوخ', 'رز مصري مطبوخ', 'أرز أبيض مطبوخ']);
    assert.deepEqual(rankFoods(items, '  ', (x) => x), [], 'nothing typed, nothing found');
  });
}

console.log('finger-pricks on the graphs');
{
  const { prickPoints, gapOf, sensorBias, prickHint } = await import('../../engine/prick');
  const await_inNight = await import('../../engine/prick');
  const M = 60000;
  test('prick: matched to the nearest sensor reading within 7 minutes; none further away', () => {
    const st = [0, 5 * M, 10 * M, 30 * M], sv = [60, 62, 65, 90];
    const [a, b] = prickPoints([{ t: 6 * M, bg: 112 }, { t: 20 * M, bg: 100 }], st, sv);
    assert.deepEqual(a, { t: 6 * M, bg: 112, libre: 62, diff: -50 });
    assert.equal(b.libre, null); assert.equal(b.diff, null);
    assert.equal(prickPoints([{ t: 0, bg: 90 }], [], []).length, 1, 'no readings, still shown');
  });
  test('prick: under 0.5 mmol/L apart counts as the same', () => {
    assert.deepEqual([gapOf(8), gapOf(-8.9), gapOf(-9), gapOf(12), gapOf(null)], ['same', 'same', 'sensor_lower', 'sensor_higher', 'none']);
  });
  test('sensor bias: the median over steady comparisons of this sensor only; lag, fast change and night pressure left out', () => {
    const r = (sn: string, d: number, cause = 'sensor_bias') => ({ sensor_sn: sn, diff_mgdl: d, cause, taken_at: '' });
    const rows = [r('A', -20), r('A', -25), r('A', -10, 'agrees'), r('A', -60, 'compression'), r('A', 30, 'cgm_lag'), r('B', 40)];
    assert.deepEqual(sensorBias(rows, 'A'), { gap: 'sensor_lower', mgdl: 20, n: 3 });
    assert.equal(sensorBias(rows, 'B'), null, 'one comparison is too few');
    assert.equal(sensorBias(rows, null), null);
    assert.equal(sensorBias([r('C', 5), r('C', -4, 'agrees'), r('C', 2), r('C', 3)], 'C')!.gap, 'same');
  });
  test('prick hint: a low that is not urgent, or a fast fall at night; never right after a prick or on an old reading', () => {
    const base = { v: 65, at: 0, rate: 0, low: 70, urgentLow: 54, now: 2 * M, lastPrick: null, night: false };
    assert.equal(prickHint(base), 'check_low');
    assert.equal(prickHint({ ...base, v: 50 }), null, 'urgent low: treat, no hint');
    assert.equal(prickHint({ ...base, lastPrick: -5 * M }), null, 'pricked a few minutes ago');
    assert.equal(prickHint({ ...base, lastPrick: -30 * M }), 'check_low');
    assert.equal(prickHint({ ...base, now: 20 * M }), null, 'reading too old');
    assert.equal(prickHint({ ...base, v: 95, rate: -2.5, night: true }), 'night_drop');
    assert.equal(prickHint({ ...base, v: 95, rate: -2.5, night: false }), null, 'by day a fall is not a pressure sign');
    assert.equal(prickHint({ ...base, v: 140, rate: -3, night: true }), null, 'still well above the low');
    assert.equal(prickHint({ ...base, v: null }), null);
  });
  test('night hours: a window across midnight, in Kuwait time', () => {
    const { inNight } = await_inNight;
    const at = (h: number, m = 0) => Date.UTC(2026, 9, 13, h - 3, m);
    assert.equal(inNight(at(23), { start: '22:00', end: '06:00' }), true);
    assert.equal(inNight(at(5, 59), { start: '22:00', end: '06:00' }), true);
    assert.equal(inNight(at(6), { start: '22:00', end: '06:00' }), false);
    assert.equal(inNight(at(14), { start: '13:00', end: '15:00' }), true);
  });
}

console.log('the dose at an earlier time');
{
  const { doseAt } = await import('../../engine/doseAt');
  const M = 60000, at = Date.UTC(2026, 9, 13, 6, 51); // 09:51 in Kuwait
  const base = { carbs: 11, ratios: [{ cr: 15, isf: 90, from: '08:00' }, { cr: 13, isf: 90, from: '18:00' }] as any, target: { low: 99, high: 117 }, lowMg: 70, dia: 240, peak: 65, gapMin: 120, step: 1, sensorStartedAt: at - 3 * 86400000 };
  const t = [0, 5, 10, 15].map((k) => at - (15 - k) * M), later = at + 30 * M;
  test('dose at a past time: that reading and that insulin, never a later reading; the pen rounds down', () => {
    const x = doseAt({ ...base, at, t: [...t, later], v: [130, 128, 126, 124, 250], doses: [{ t: at - 168 * M, units: 1 }] });
    assert.equal(x.glucose, 124, 'the reading at 09:51, not the 250 after the ice cream');
    assert.equal(x.r.block, null); assert.equal(x.r.dose, 0, '11 g at 15 g a unit is 0.73: rounded down to 0');
    assert.ok(x.iob! > 0 && x.iob! < 0.3);
    const high = doseAt({ ...base, at, t, v: [240, 240, 240, 240], doses: [] });
    assert.equal(high.r.dose, 2, '0.73 + (240 − 117) ÷ 90 = 2.1 → 2');
    assert.equal(doseAt({ ...base, at, t: [], v: [], doses: [] }).r.block, 'no_reading');
    assert.equal(doseAt({ ...base, at, t, v: [130, 128, 126, 124], doses: [{ t: at - 60 * M, units: 2 }] }).r.block, 'recent_dose', 'a dose an hour before');
  });
}

console.log("the doctor's numbers vs reality");
{
  const D = await import('../../engine/doctorCheck');
  const M = 60000, H = 3600000, DAY = 86400000;
  const now = Date.UTC(2026, 9, 13, 18, 0);
  const at = (daysAgo: number, kwHour: number) => Date.UTC(2026, 9, 13 - daysAgo, kwHour - 3, 0);
  // readings every 5 minutes for 31 days at a steady 140, so nothing is a gap and no stretch drifts
  const T: number[] = [], V: number[] = [];
  for (let x = now - 31 * DAY; x <= now; x += 5 * M) { T.push(x); V.push(140); }
  const series = { t: Float64Array.from(T), v: Float64Array.from(V) };
  const curve = (start: number, end: number, n = 17) => Array.from({ length: n }, (_, k) => Math.round(start + (end - start) * (k / (n - 1))));
  const pred = (key: string, t0: number, o: Partial<import('../../engine/doctorCheck').PredIn> = {}): import('../../engine/doctorCheck').PredIn => ({
    key, t0, name: key, carbs: 40, units: 3, start_mg: 140, params: { cr: 15, isf: 90, onboard_iob: 0, onboard_cob: 0 },
    curve: curve(140, 140), end_min: 240, checks: { '120': { pred: 140, actual: 140 } }, excluded: null, ...o });
  const base = { entries: [] as any[], makeup: new Map(), long: [], series, comparisons: [], sensor: null, lowMg: 70, now };
  // the log as it is now: each prediction's own entry, and its dose a minute later
  const logOf = (preds: import('../../engine/doctorCheck').PredIn[]) => preds.flatMap((p) => p.carbs > 0
    ? [{ key: p.key, t: p.t0, kind: 'meal', grams: p.carbs, units: 0, name: null, recipe_id: null }, { key: p.key + 'd', t: p.t0 + M, kind: 'dose', grams: 0, units: p.units, name: null, recipe_id: null }]
    : [{ key: p.key, t: p.t0, kind: 'dose', grams: 0, units: p.units, name: null, recipe_id: null }]) as any[];
  const obsOf = (o: any): import('../../engine/doctorCheck').Obs[] => D.observe({ ...o, entries: [...logOf(o.preds), ...(o.entries ?? [])].sort((a, b) => a.t - b.t) });

  test('doctor check: groups by the clock (breakfast, lunch, dinner) and corrections apart; snacks and food without insulin left out', () => {
    assert.equal(D.groupOf({ t0: at(1, 8), carbs: 40, units: 3 }), 'breakfast');
    assert.equal(D.groupOf({ t0: at(1, 14), carbs: 40, units: 3 }), 'lunch');
    assert.equal(D.groupOf({ t0: at(1, 20), carbs: 40, units: 3 }), 'dinner');
    assert.equal(D.groupOf({ t0: at(1, 20), carbs: 0, units: 1 }), 'correction');
    assert.equal(D.groupOf({ t0: at(1, 20), carbs: 10, units: 1 }), null, 'a snack');
    assert.equal(D.groupOf({ t0: at(1, 20), carbs: 40, units: 0 }), null, 'no insulin: says nothing about the ratio');
  });
  test('doctor check: the 2-hour result is the early outcome; the later one is read at the end of the curve, kept within 3–5 h', () => {
    const [o] = obsOf({ ...base, preds: [pred('a', at(1, 8), { checks: { '120': { pred: 150, actual: 186 } }, end_min: 240 })] });
    assert.deepEqual(o.early, { min: 120, pred: 150, actual: 186, diff: 36 });
    assert.equal(o.late!.min, 240); assert.equal(o.late!.actual, 140);
    const [long] = obsOf({ ...base, preds: [pred('b', at(1, 8), { end_min: 360, curve: curve(140, 140, 25) })] });
    assert.equal(long.late!.min, 300, 'never later than 5 h');
  });
  test('doctor check: anything logged before the later check removes the later outcome, never guesses it', () => {
    const t0 = at(1, 8);
    const entries = [{ key: 'snack', t: t0 + 150 * M, kind: 'carbs', grams: 10, units: 0, name: null, recipe_id: null }] as any;
    const [o] = obsOf({ ...base, entries, preds: [pred('a', t0)] });
    assert.ok(o.early, 'the 2-hour check came before the snack'); assert.equal(o.late, null);
  });
  test('doctor check: clean and affected observations are never pooled', () => {
    const t0 = at(2, 8);
    const preds = [
      pred('clean', t0, { checks: { '120': { pred: 140, actual: 150 } } }),
      pred('iob', t0 - DAY, { params: { cr: 15, isf: 90, onboard_iob: 0.8, onboard_cob: 0 }, checks: { '120': { pred: 140, actual: 260 } } }),
      pred('h:fat', t0 - 3 * DAY, { checks: { '120': { pred: 140, actual: 250 } } }),
      pred('day1', t0 - 4 * DAY, { excluded: 'sensor_day1', checks: { '120': { pred: 140, actual: 20 } } }),
    ];
    const makeup = new Map([['h:fat', { fat: 30, protein: 20 }]]);
    const obs = obsOf({ ...base, preds, makeup });
    const by = Object.fromEntries(obs.map((o) => [o.key, o]));
    assert.equal(by.clean.clean, true);
    assert.deepEqual(by.iob.flags, ['overlap']); assert.deepEqual(by['h:fat'].flags, ['fatty']);
    assert.deepEqual(by.day1.flags, ['sensor']); assert.deepEqual(by.day1.sensorWhy, ['day1']);
    const g = D.summarize(obs, now).groups.find((x) => x.group === 'breakfast')!;
    assert.equal(g.win[30].early.clean.n, 1); assert.equal(g.win[30].early.clean.median, 10, 'the clean median ignores the affected ones');
    assert.equal(g.win[30].early.affected.n, 3);
    assert.equal(g.flags.overlap, 1); assert.equal(g.flags.fatty, 1); assert.equal(g.flags.sensor, 1);
  });
  test('doctor check: sensor doubts — a hole in the data, the last day, finger-pricks disagreeing', () => {
    const t0 = at(3, 14);
    const holeT = T.filter((x) => x < t0 + 20 * M || x > t0 + 70 * M);
    const holed = { t: Float64Array.from(holeT), v: Float64Array.from(holeT.map(() => 140)) };
    assert.deepEqual(obsOf({ ...base, series: holed, preds: [pred('a', t0)] })[0].sensorWhy, ['gaps']);
    assert.deepEqual(obsOf({ ...base, sensor: { startedAt: t0 - 13.5 * DAY, days: 14 }, preds: [pred('a', t0)] })[0].sensorWhy, ['last_day']);
    const cmp = [-25, -30, -20].map((d) => ({ t: t0 - DAY, diff: d, cause: 'sensor_bias' }));
    assert.deepEqual(obsOf({ ...base, comparisons: cmp, preds: [pred('a', t0)] })[0].sensorWhy, ['bias']);
    const lag = [-25, -30, -20].map((d) => ({ t: t0 - DAY, diff: d, cause: 'cgm_lag' }));
    assert.deepEqual(obsOf({ ...base, comparisons: lag, preds: [pred('a', t0)] })[0].sensorWhy, [], 'lag during a change is not how the sensor reads');
  });
  test('doctor check: Tresiba flagged when glucose drifted on its own before, not when it held steady', () => {
    const t0 = at(2, 8);
    const long = [{ t: t0 - 18 * H, units: 9 }];
    assert.deepEqual(obsOf({ ...base, long, preds: [pred('a', t0)] })[0].flags, [], 'steady overnight');
    const dt: number[] = [], dv: number[] = [];
    for (let x = now - 31 * DAY; x <= now; x += 5 * M) { dt.push(x); dv.push(x > t0 - 18 * H && x < t0 ? 300 - ((x - (t0 - 18 * H)) / H) * 10 : 140); }
    const drifting = { t: Float64Array.from(dt), v: Float64Array.from(dv) };
    assert.deepEqual(obsOf({ ...base, long, series: drifting, preds: [pred('a', t0)] })[0].flags, ['tresiba'], 'fell 10 mg/dL an hour with nothing else working');
  });
  test('doctor check: confidence — too few under 5, low under 10 or when spread wide, never high', () => {
    const s = (xs: number[]) => D.confidence({ n: xs.length, median: 0, q1: Math.min(...xs), q3: Math.max(...xs), near: 0, lower: 0, higher: 0 });
    assert.equal(s([0, 0, 0, 0]), 'too_few');
    assert.equal(s([0, 0, 0, 0, 0]), 'low');
    assert.equal(s(Array(12).fill(10)), 'moderate');
    assert.equal(D.confidence({ n: 12, median: 0, q1: -40, q3: 30, near: 0, lower: 0, higher: 0 }), 'low', 'middle half spread over 3 mmol/L');
  });
  test('doctor check: 7, 14 and 30-day windows count only their own days', () => {
    const preds = [1, 3, 10, 20, 40].map((d, i) => pred('p' + i, at(d, 8)));
    const g = D.summarize(obsOf({ ...base, preds }), now).groups.find((x) => x.group === 'breakfast')!;
    assert.deepEqual([g.win[7].early.clean.n, g.win[14].early.clean.n, g.win[30].early.clean.n], [2, 3, 4]);
  });
  test('doctor check: a prediction that no longer matches the log is left out, never counted', () => {
    const t0 = at(2, 8), p = pred('h:m', t0);
    const log = logOf([p]);
    assert.equal(D.stillMatches(p, log as any), true);
    assert.equal(D.stillMatches(p, log.filter((e: any) => e.key !== 'h:m') as any), false, 'the meal was deleted');
    assert.equal(D.stillMatches(p, log.map((e: any) => (e.key === 'h:m' ? { ...e, grams: 55 } : e)) as any), false, 'its carbs were edited');
    const dose = pred('e:d', at(2, 13), { carbs: 0, units: 3 });
    const meal10 = { key: 'h:later', t: dose.t0 + 10 * M, kind: 'meal', grams: 50, units: 0, name: null, recipe_id: null };
    assert.equal(D.stillMatches(dose, [...logOf([dose]), meal10] as any), false, 'a meal logged later makes a pre-meal dose, not a correction');
    const r = D.doctorCheck({ ...base, entries: [...logOf([p, dose]), meal10].sort((a: any, b: any) => a.t - b.t), preds: [p, dose] } as any);
    assert.equal(r.dropped.n, 1); assert.equal(r.dropped.byGroup.correction, 1);
    assert.equal(r.groups.find((g) => g.group === 'breakfast')!.obs.length, 1);
  });
  test('doctor check: the numbers in force at each prediction are listed, so a change in the period shows', () => {
    const a = pred('a', at(20, 8)), b = pred('b', at(10, 8), { params: { cr: 15, isf: 72, onboard_iob: 0, onboard_cob: 0 } }), c = pred('c', at(2, 8), { params: { cr: 15, isf: 90, onboard_iob: 0, onboard_cob: 0 } });
    const r = D.doctorCheck({ ...base, entries: logOf([a, b, c]), preds: [c, a, b] } as any);
    assert.deepEqual(r.spans.map((x) => [x.isf, x.n]), [[90, 1], [72, 1], [90, 1]], 'a change and a change back are both shown');
    const d = pred('d', at(1, 20), { params: { cr: 13, isf: 90, onboard_iob: 0, onboard_cob: 0 } });
    assert.deepEqual(D.doctorCheck({ ...base, entries: logOf([c, d]), preds: [c, d] } as any).spans.map((x) => x.crs), [[15, 13]], 'the evening ratio is part of the same period');
  });
  test('ledger: every meal-with-insulin and correction prediction of 30 days exactly once; snacks, food without insulin and older ones not at all', () => {
    const ps = [pred('a', at(1, 8)), pred('b', at(2, 13)), pred('snack', at(2, 16), { carbs: 8 }), pred('noins', at(3, 8), { units: 0 }), pred('old', at(40, 8))];
    const L = D.ledgerOf({ ...base, entries: logOf(ps), preds: ps } as any);
    assert.deepEqual(L.map((r) => r.key).sort(), ['a', 'b']);
    assert.equal(new Set(L.map((r) => r.key)).size, L.length);
  });
  test('ledger: one primary reason, the rest kept — an invalid prediction first, then a missing 2-hour check', () => {
    const t0 = at(2, 8), M2 = 60000;
    const edited = pred('h:e', t0, { checks: { '120': { skip: 'other_entry' } } });
    const log = logOf([edited]).map((e: any) => (e.key === 'h:e' ? { ...e, grams: 60 } : e));
    const r1 = D.ledgerOf({ ...base, entries: log, preds: [edited] } as any)[0];
    assert.equal(r1.status, 'excluded'); assert.equal(r1.primary, 'edited'); assert.deepEqual(r1.reasons.slice(0, 2), ['edited', 'other_entry']);
    assert.equal(r1.early, null, 'an invalid prediction carries no outcome');
    const corr = pred('e:c', at(3, 13), { carbs: 0, units: 2 });
    const meal = { key: 'h:m', t: corr.t0 + 40 * M2, kind: 'meal', grams: 40, units: 0, name: null, recipe_id: null };
    const r2 = D.ledgerOf({ ...base, entries: [...logOf([corr]), meal], preds: [corr] } as any)[0];
    assert.equal(r2.primary, 'food_near', 'food 40 minutes later: not a correction test');
    const gone = D.ledgerOf({ ...base, entries: [], preds: [pred('h:x', t0)] } as any)[0];
    assert.equal(gone.primary, 'deleted');
    const fresh = pred('f', now - 60 * M2, { checks: {} });
    assert.equal(D.ledgerOf({ ...base, entries: logOf([fresh]), preds: [fresh] } as any)[0].primary, 'pending');
  });
  test('ledger: affected takes its first factor as primary and keeps every factor; clean is clean', () => {
    const p1 = pred('h:f', at(2, 8), { params: { cr: 15, isf: 90, onboard_iob: 0.8, onboard_cob: 0 } });
    const r = D.ledgerOf({ ...base, entries: logOf([p1]), preds: [p1], makeup: new Map([['h:f', { fat: 30, protein: 10 }]]) } as any)[0];
    assert.equal(r.status, 'affected'); assert.equal(r.primary, 'overlap'); assert.deepEqual(r.reasons, ['overlap', 'fatty']);
    const p2 = pred('h:c', at(2, 8));
    assert.deepEqual(D.ledgerOf({ ...base, entries: logOf([p2]), preds: [p2] } as any)[0].reasons, ['clean']);
  });
  test('ledger and charts agree: an invalid prediction is in neither the clean nor the observed set', () => {
    const ok = pred('h:ok', at(2, 8)), bad = pred('h:bad', at(3, 8));
    const log = logOf([ok, bad]).filter((e: any) => e.key !== 'h:bad');
    const inp = { ...base, entries: log, preds: [ok, bad] } as any;
    assert.deepEqual(D.observe(inp).map((o) => o.key), ['h:ok']);
    const L = D.ledgerOf(inp);
    assert.deepEqual(L.filter((r) => r.status !== 'excluded').map((r) => r.key), ['h:ok']);
    assert.equal(L.find((r) => r.key === 'h:bad')!.primary, 'deleted');
  });
  test('doctor check: the saved numbers are compared with what the family reported (1:15, 4.0 mmol/L)', () => {
    assert.deepEqual(D.discrepancy([{ from: '08:00', cr: 15, isf: 90 }, { from: '18:00', cr: 13, isf: 90 }]), { cr: [{ from: '18:00', cr: 13 }], isf: [90] });
    assert.equal(D.discrepancy([{ from: '08:00', cr: 15, isf: 72 }]), null);
  });
}

console.log('night and Tresiba');
{
  const N = await import('../../engine/nightTresiba');
  const M = 60000, H = 3600000;
  const kw = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 3, m);
  const now = Date.UTC(2026, 9, 14, 6, 0);
  // Tresiba 11 U to 3 Oct, 10 U 4–9 Oct, 9 U from 10 Oct, at 17:00; dinner and its NovoRapid at 17:30
  const build = (o: { extra?: any[]; dip?: number; juice?: number; pricks?: { d: number; h: number; m: number; bg: number }[] } = {}) => {
    const events: any[] = [], history: any[] = [];
    let id = 0;
    const ev = (x: any) => events.push({ id: 'e' + ++id, client_id: 'c' + id, deleted_at: null, insulin_type: null, insulin_units: null, carbs_g: null, treatment: null, ...x });
    for (let d = 1; d <= 13; d++) {
      ev({ kind: 'insulin', insulin_type: 'long', insulin_units: d <= 3 ? 11 : d <= 9 ? 10 : 9, occurred_at: new Date(kw(d, 17)).toISOString() });
      ev({ kind: 'insulin', insulin_type: 'rapid', insulin_units: 3, occurred_at: new Date(kw(d, 17, 30)).toISOString() });
      history.push({ id: 'h' + d, kind: 'meal', name: 'dinner', recipe_id: null, total_carbs: 40, eaten_at: new Date(kw(d, 17, 30)).toISOString() });
    }
    for (const x of o.extra ?? []) ev(x);
    for (const p of o.pricks ?? []) ev({ kind: 'bg_check', bg_mgdl: p.bg, occurred_at: new Date(kw(p.d, p.h, p.m)).toISOString() });
    // 140 all day; from 00:00 to 06:00 a steady fall from 180 at 20 mg/dL an hour
    const T: number[] = [], V: number[] = [];
    for (let x = kw(1, 0); x <= now; x += 5 * M) {
      const k = ((x + 3 * H) % 86400000) / H;
      let v = k < 6 ? 180 - 20 * k : 140;
      if (o.juice && x >= o.juice && k < 6) v = 180 - 20 * ((o.juice + 3 * H) % 86400000) / H; // holds after the juice
      if (o.dip !== undefined) { const m = (x - o.dip) / M; if (m >= 0 && m <= 25) v -= m <= 10 ? 4 * m : m <= 15 ? 40 : 40 - 4 * (m - 15); }
      T.push(x); V.push(v);
    }
    return { series: { t: Float64Array.from(T), v: Float64Array.from(V) }, history, events, from: kw(4, 0), now };
  };
  test('night: doses counted in a row, with the dose before a change', () => {
    const d = N.doseRows(build().events as any);
    assert.deepEqual(d.filter((x) => x.nth === 1).map((x) => [x.units, x.prev]), [[11, null], [10, 11], [9, 10]]);
    assert.equal(d[d.length - 1].nth, 4);
  });
  test('night: a clean night has its rate of fall; nights 1–3 on a new dose are settling and grouped apart', () => {
    const r = N.nightReport(build() as any);
    const n12 = r.nights.find((n) => n.dose?.units === 9 && n.dose.nth === 3)!;
    assert.equal(n12.cls, 'clean'); close(n12.rate, -20, 0.5); assert.equal(n12.dose!.units, 9); assert.equal(n12.settling, true);
    assert.ok(n12.min! < 70 && n12.below70 > 0, 'the low is counted');
    const n13 = r.nights.find((n) => n.dose?.nth === 4 && n.dose.units === 9)!;
    assert.equal(n13.settling, false);
    const g9s = r.groups.find((g) => g.units === 9 && g.settling)!, g9 = r.groups.find((g) => g.units === 9 && !g.settling)!;
    assert.equal(g9s.clean, 3); assert.equal(g9.clean, 1); assert.equal(g9.conf, 'too_few');
  });
  test('night: NovoRapid at 22:00 leaves too little long-acting-only time: nights affected by insulin or food', () => {
    const r = N.nightReport(build({ extra: [{ kind: 'insulin', insulin_type: 'rapid', insulin_units: 1, occurred_at: new Date(kw(7, 22)).toISOString() }] }) as any);
    const n = r.nights.find((x) => x.dose?.units === 10 && x.dose.nth === 4)!;
    assert.equal(n.cls, 'insulin_food'); assert.equal(n.tags.rapid, kw(7, 22));
  });
  test('night: before each juice: the level, the fall since the last entry and its fasting part; the rise after is never used', () => {
    const r = N.nightReport(build({ juice: kw(9, 3), extra: [{ kind: 'treatment', carbs_g: 15, treatment: 'juice', occurred_at: new Date(kw(9, 3)).toISOString() }] }) as any);
    const n = r.nights.find((x) => x.episodes.length)!, e = n.episodes[0];
    assert.equal(n.cls, 'treated'); assert.equal(e.libre, 120); close(e.trend, -20 / 60, 0.05);
    assert.equal(e.fall!.from, kw(9, 0)); assert.equal(e.fall!.minutes, 180); close(e.fall!.rate, -20, 1);
    assert.equal(e.fasting!.minutes, 180, 'six hours after the 17:30 NovoRapid, the whole fall is fasting'); close(e.fasting!.rate, -20, 1);
    assert.equal(e.evidence, 'preventive', 'the sensor was not low and there was no finger-prick');
    const g = r.groups.find((x) => x.units === 10 && !x.settling)!;
    assert.equal(g.treated, 1); assert.equal(g.clean, 2, 'a treated night is not a clean night'); assert.equal(g.before.n, 1, 'its fall before the juice is counted on its own');
    assert.ok(!('untreated' in e), 'no guess of where glucose would have gone');
  });
  test('night: a drink logged as food counts as a treatment only when the readings or timing say so; others stay food, flagged', () => {
    const b = build({ juice: kw(9, 3), extra: [{ kind: 'treatment', carbs_g: 15, treatment: 'juice', occurred_at: new Date(kw(9, 3)).toISOString() }] });
    b.history.push({ id: 'jb', kind: 'snack', name: 'عصير علبة', recipe_id: null, total_carbs: 15, eaten_at: new Date(kw(9, 3, 20)).toISOString() });   // 20 min after a juice
    const r = N.nightReport(b as any);
    const e = r.nights.find((x) => x.episodes.length && x.dose?.nth === 5)!.episodes;
    assert.equal(e.length, 1, 'one episode'); assert.equal(e[0].juices.length, 2, 'two separate treatments'); assert.equal(e[0].juices[1].why, 'after_treatment');
    assert.equal(e[0].followUps.length, 1); assert.equal(e[0].followUps[0].afterMin, 20); assert.equal(e[0].followUps[0].lowest, 120, 'the readings between the two are kept');
    assert.equal(e[0].fall!.minutes, 180, 'the fall is measured before the first treatment only');
    const c = build();
    c.history.push({ id: 'jc', kind: 'snack', name: '1.2.3 Cocktail Drink (Kids) 125ml', recipe_id: null, total_carbs: 15, eaten_at: new Date(kw(10, 5)).toISOString() }); // sensor 80
    c.history.push({ id: 'jd', kind: 'snack', name: 'عصير', recipe_id: null, total_carbs: 15, eaten_at: new Date(kw(11, 22)).toISOString() }); // sensor 140, nothing else
    const r2 = N.nightReport(c as any);
    assert.equal(r2.nights.find((x) => x.dose?.nth === 6 && x.dose.units === 10)!.episodes[0].juices[0].why, 'low_reading');
    assert.equal(r2.unsure.length, 1, 'a drink at 140 with nothing else is not assumed to be a treatment'); assert.equal(r2.unsure[0].libre, 140);
    assert.equal(c.history.length, 15, 'the food log itself is untouched');
    assert.equal(N.juicesOf([{ id: 'm', kind: 'meal', name: 'حليب', total_carbs: 12, eaten_at: new Date(kw(9, 7, 10)).toISOString() }, { id: 'b', kind: 'meal', name: 'توست', total_carbs: 30, eaten_at: new Date(kw(9, 7, 15)).toISOString() }] as any, [], b.series).juices.length, 0, 'milk with breakfast is food');
  });
  test('night: why a juice was given comes from the finger-prick when there is one; the sensor alone never confirms a low', () => {
    const at = (bg: number | null, sensorLow: boolean) => {
      const b = build({ juice: kw(9, sensorLow ? 5 : 3, sensorLow ? 45 : 0), extra: [{ kind: 'treatment', carbs_g: 15, treatment: 'juice', occurred_at: new Date(kw(9, sensorLow ? 5 : 3, sensorLow ? 45 : 0)).toISOString() }], pricks: bg === null ? [] : [{ d: 9, h: sensorLow ? 5 : 2, m: sensorLow ? 35 : 50, bg }] });
      return N.nightReport(b as any).nights.find((x) => x.episodes.length)!.episodes[0].evidence;
    };
    assert.equal(at(null, true), 'sensor_low'); assert.equal(at(62, true), 'confirmed_low'); assert.equal(at(88, true), 'sensor_low_finger_higher');
    assert.equal(at(null, false), 'preventive'); assert.equal(at(130, false), 'preventive_finger');
  });
  test('night: an implausibly fast dip is questioned, kept out of the rate, and its low still counts', () => {
    const r = N.nightReport(build({ dip: kw(10, 5, 30) }) as any);
    const n = r.nights.find((x) => x.dose?.units === 10 && x.dose.nth === 6)!;
    assert.equal(n.cls, 'sensor'); assert.ok(n.tags.sensor.includes('fast_fall') && n.tags.sensor.includes('v_shape'));
    close(n.min, 180 - 20 * 5.75 - 40, 0.01); assert.equal(n.minQuestioned, true); assert.equal(n.below70, 25, 'the low minutes are kept');
    close(n.rate, -20, 0.5);
  });
  test('night: a finger-prick that disagrees is shown beside the sensor value as it was, never corrected', () => {
    const r = N.nightReport(build({ pricks: [{ d: 13, h: 0, m: 15, bg: 227 }, { d: 13, h: 3, m: 0, bg: 120 }] }) as any);
    const n = r.nights.find((x) => x.pricks.length)!;
    assert.equal(n.pricks[0].bg, 227); assert.equal(n.pricks[0].libre, 175); assert.equal(n.pricks[0].agrees, false);
    assert.equal(n.pricks[1].libre, 120); assert.equal(n.pricks[1].agrees, true);
    assert.equal(n.cls, 'sensor'); assert.ok(n.tags.sensor.includes('prick'));
  });
  test('night: daily insulin and carbs by Tresiba dose', () => {
    const r = N.nightReport(build() as any);
    const g9 = r.dayGroups.find((g) => g.units === 9)!, g10 = r.dayGroups.find((g) => g.units === 10)!;
    assert.deepEqual([g9.days, g9.long, g9.rapid, g9.total, g9.carbs], [4, 9, 3, 12, 40]);
    assert.equal(g10.days, 6);
  });
  const G = await import('../../engine/nightGrid');
  test('night grid: 00:00–07:00 in 15-minute strips, oldest first; the first reading under 3.9 by hour and by dose', () => {
    const b = build({ juice: kw(9, 3), extra: [{ kind: 'treatment', carbs_g: 15, treatment: 'juice', occurred_at: new Date(kw(9, 3)).toISOString() }], pricks: [{ d: 9, h: 2, m: 40, bg: 125 }] });
    const r = N.nightReport(b as any), g = G.nightGrid(r, b.series as any);
    assert.equal(g.nights.length, r.nights.length);
    assert.ok(g.nights.every((n, i) => i === 0 || n.from > g.nights[i - 1].from), 'oldest first');
    const n = g.nights[0];
    assert.equal(n.bins.length, 28); close(n.bins[0], 180 - 20 * 10 / 60, 0.1);
    assert.equal(n.firstLow, n.from + 5 * H + 35 * M, 'the sensor as it read: first under 70 at 05:35');
    const held = g.nights.find((x) => x.juices.length)!;
    assert.deepEqual(held.juices, [kw(9, 3)]); assert.equal(held.prickBefore, true); assert.equal(held.pricks[0].bg, 125);
    assert.equal(held.firstLow, null, 'held at 120 after the juice: no low that night');
    assert.ok(g.onset[5] > 0); assert.equal(g.onset.reduce((a, k) => a + k, 0), g.nights.filter((x) => x.firstLow !== null).length);
    assert.equal(g.byDose.reduce((a, d) => a + d.nights, 0), g.nights.filter((x) => x.units !== null).length);
    assert.equal(g.byDose[g.byDose.length - 1].units, 9);
  });
  test('last night on the home screens: 07:00–13:00 only; lowest reading, treatments, finger-prick first', () => {
    const b = build({ extra: [{ kind: 'treatment', carbs_g: 15, treatment: 'juice', occurred_at: new Date(kw(13, 5, 40)).toISOString() }, { kind: 'treatment', carbs_g: 15, treatment: 'juice', occurred_at: new Date(kw(13, 5, 58)).toISOString() }] });
    const L = G.lastNight(b.series as any, b.events as any, kw(13, 9))!;
    close(L.min, 180 - 20 * (5 + 55 / 60), 0.1); assert.equal(L.firstLow, kw(13, 5, 35)); assert.equal(L.units, 9);
    assert.equal(L.juices, 2); assert.equal(L.prickBefore, false, 'no finger-prick before the first; the 15-minute repeat is not asked for one');
    assert.equal(G.lastNight(b.series as any, b.events as any, kw(13, 6)), null);
    assert.equal(G.lastNight(b.series as any, b.events as any, kw(13, 14)), null);
    const p = build({ pricks: [{ d: 13, h: 5, m: 30, bg: 80 }], extra: [{ kind: 'treatment', carbs_g: 15, treatment: 'juice', occurred_at: new Date(kw(13, 5, 40)).toISOString() }] });
    assert.equal(G.lastNight(p.series as any, p.events as any, kw(13, 9))!.prickBefore, true);
  });
}

console.log('basal check');
{
  const B = await import('../../engine/basalCheck');
  const M = 60000, H = 3600000;
  const kw = (d: number, h: number, m = 0) => Date.UTC(2026, 9, d, h - 3, m); // Kuwait clock
  // a log: Tresiba at 17:00 every day (units by day), breakfast 07:00, lunch 13:00, dinner 18:00 with NovoRapid; glucose from a function
  const mk = (o: { units?: (d: number) => number; g?: (t: number) => number; extra?: any[]; hist?: any[]; skip?: (t: number) => boolean; days?: number } = {}) => {
    const events: any[] = [], history: any[] = []; let id = 0;
    const ev = (x: any) => events.push({ id: 'e' + ++id, client_id: 'c' + id, deleted_at: null, insulin_type: null, insulin_units: null, carbs_g: null, treatment: null, bg_mgdl: null, ...x });
    const days = o.days ?? 10;
    for (let d = 1; d <= days; d++) {
      ev({ kind: 'insulin', insulin_type: 'long', insulin_units: o.units ? o.units(d) : 9, occurred_at: new Date(kw(d, 17)).toISOString() });
      for (const [h, c] of [[7, 30], [13, 40], [18, 40]]) {
        history.push({ id: `h${d}-${h}`, kind: 'meal', name: 'meal', recipe_id: null, total_carbs: c, eaten_at: new Date(kw(d, h)).toISOString() });
        ev({ kind: 'insulin', insulin_type: 'rapid', insulin_units: 2, occurred_at: new Date(kw(d, h)).toISOString() });
      }
    }
    for (const x of o.extra ?? []) ev(x);
    history.push(...(o.hist ?? []));
    const T: number[] = [], V: number[] = [];
    for (let x = kw(1, 0); x <= kw(days, 23, 55); x += 5 * M) { if (o.skip?.(x)) continue; T.push(x); V.push(o.g ? o.g(x) : 140); }
    return { series: { t: Float64Array.from(T), v: Float64Array.from(V) }, history, events, from: kw(2, 0), now: kw(days, 23, 59), iob: { dia: 300, peak: 75 } };
  };
  const clock = (x: number) => ((x + 3 * H) % 86400000) / H;
  // glucose falls 20 mg/dL an hour from midnight to 07:00, otherwise 140
  const fall = (x: number) => { const k = clock(x); return k < 7 ? 160 - 20 * k : 140; };
  const nightOf = (r: any, d: number) => r.periods.find((p: any) => p.from >= kw(d - 1, 20) && p.from < kw(d, 7) && p.win === 'night');

  test('basal check: a fasting night after dinner NovoRapid starts 4 h after it, is clean, and its change is measured', () => {
    const r = B.basalCheck(mk({ g: fall }) as any);
    const p = r.periods.find((x) => x.from === kw(5, 22))!;
    assert.equal(p.to, kw(6, 7), '18:00 NovoRapid + 4 h, ends at breakfast'); assert.equal(p.win, 'night', 'most of 22:00–07:00 is in 00–06');
    assert.equal(p.status, 'clean'); assert.equal(p.endedBy, 'food');
    assert.ok(p.trend! < -10 && p.perHour! < -10); assert.equal(p.dir, 'falling');
    assert.ok(p.change! < -100 && p.low! < 30 + 5);
    assert.equal(p.dose!.units, 9); assert.equal(p.dose!.phase, 'stable');
  });
  test('basal check: the first 4 h after NovoRapid are never analysed; only the part after the mark is, and the rest stays listed', () => {
    const corr = (h: number, m = 0) => [{ kind: 'insulin', insulin_type: 'rapid', insulin_units: 1, occurred_at: new Date(kw(6, h, m)).toISOString() }];
    const r = B.basalCheck(mk({ g: fall, extra: corr(1) }) as any);
    const after = r.periods.find((x: any) => x.from === kw(6, 5))!;
    assert.equal(after.status, 'clean', '01:00 correction + 4 h = 05:00, two hours to breakfast'); assert.equal(after.to, kw(6, 7));
    const inside = r.periods.find((x: any) => x.from === kw(6, 1))!;
    assert.equal(inside.status, 'excluded'); assert.ok(inside.reasons.includes('rapid_recent')); assert.equal(inside.to, kw(6, 5)); assert.equal(inside.endedBy, 'rapid_mark');
    assert.ok(!r.periods.some((x: any) => x.status === 'clean' && x.from < kw(6, 5) && x.to > kw(6, 1)), 'nothing clean overlaps the first 4 h');
    const r2 = B.basalCheck(mk({ g: fall, extra: corr(2, 30) }) as any);
    const p2 = r2.periods.find((x: any) => x.from === kw(6, 2, 30))!;
    assert.equal(p2.status, 'excluded', 'only 30 min after the mark before breakfast: all of it excluded'); assert.ok(p2.reasons.includes('rapid_recent'));
    assert.ok(!B.doseStats(r2, 'all').some((g) => g.clean && r2.periods.filter((x) => x.status === 'clean').some((x) => x.from === kw(6, 2, 30))));
  });
  test('basal check: when the insulin model still shows NovoRapid after 4 h, the period is uncertain, not clean', () => {
    const b = mk({ g: fall }); (b as any).iob = { dia: 420, peak: 90 };
    const p = B.basalCheck(b as any).periods.find((x) => x.from === kw(5, 22))!;
    assert.ok(p.iobAtStart! >= 0.1); assert.equal(p.status, 'uncertain'); assert.ok(p.reasons.includes('iob_residual'));
    const q = B.basalCheck(mk({ g: fall }) as any).periods.find((x) => x.from === kw(5, 22))!;
    assert.ok(q.iobAtStart! < 0.1, 'a 5-hour model has almost nothing left at 4 h'); assert.equal(q.status, 'clean');
  });
  test('basal check: a juice ends the period; the finger-prick before it confirms the low, or the low is CGM-only', () => {
    const juice = { kind: 'treatment', carbs_g: 15, treatment: 'juice', occurred_at: new Date(kw(6, 4)).toISOString() };
    const r1 = B.basalCheck(mk({ g: fall, extra: [juice, { kind: 'bg_check', bg_mgdl: 65, occurred_at: new Date(kw(6, 3, 55)).toISOString() }] }) as any);
    const p1 = nightOf(r1, 6);
    assert.equal(p1.to, kw(6, 4)); assert.equal(p1.endedBy, 'treatment'); assert.equal(p1.treatment.evidence, 'confirmed');
    assert.ok(!r1.periods.some((x: any) => x.from > kw(6, 4) && x.from < kw(6, 7)), 'nothing after the juice until breakfast + 3 h');
    const low = (x: number) => { const k = clock(x); return k < 7 ? 120 - 20 * k : 140; }; // 60 at 03:00
    const r2 = B.basalCheck(mk({ g: low, extra: [juice] }) as any);
    assert.equal(nightOf(r2, 6).treatment.evidence, 'cgm_low');
    const r3 = B.basalCheck(mk({ g: fall, extra: [juice, { kind: 'bg_check', bg_mgdl: 110, occurred_at: new Date(kw(6, 3, 55)).toISOString() }] }) as any);
    assert.equal(nightOf(r3, 6).treatment.evidence, 'finger_not_low');
  });
  test('basal check: Tresiba doses 1–3 at new units are a transition; the 4th is stable; comparison keeps them apart', () => {
    const r = B.basalCheck(mk({ g: fall, units: (d) => (d <= 4 ? 10 : 9) }) as any);
    assert.deepEqual([6, 7, 8, 9].map((d) => nightOf(r, d).dose.phase), ['transition', 'transition', 'transition', 'stable']);
    const st = B.doseStats(r, 'night');
    assert.deepEqual(st.map((g) => `${g.units}${g.phase[0]}`), ['10u', '10s', '9t', '9s'], 'the record\'s first dose is unknown history; doses in order of first use');
    const s9 = st.find((g) => g.units === 9 && g.phase === 'stable')!;
    assert.equal(s9.clean, 2); assert.equal(s9.target, 7, 'app-defined target'); assert.equal(s9.insufficient, true, 'under 3 clean periods: insufficient evidence');
  });
  test('basal check: rising and stable periods count too; the night/day split never counts a period twice', () => {
    const g = (x: number) => { const k = clock(x); return k < 7 ? 100 + 10 * k : k >= 21 ? 100 : 140; };
    const r = B.basalCheck(mk({ g }) as any);
    const p = nightOf(r, 6); assert.equal(p.dir, 'rising');
    const s = B.summary(r, 'all'), n = B.summary(r, 'night'), d = B.summary(r, 'day');
    assert.equal(n.eligible + d.eligible, s.eligible); assert.ok(s.rising > 0);
    assert.ok(r.periods.filter((x) => x.status !== 'excluded').every((x) => (x.win === 'night') === (x.nightMin * 2 >= x.minutes)));
  });
  test('basal check: the 24-hour overview: Night + Day = All for every count, no period counted twice', () => {
    const r = B.basalCheck(mk({ g: fall, extra: [{ kind: 'insulin', insulin_type: 'rapid', insulin_units: 1, occurred_at: new Date(kw(6, 1)).toISOString() }] }) as any);
    const o = B.overview(r);
    for (const k of ['total', 'clean', 'affected', 'uncertain', 'excluded', 'cleanStable', 'below'] as const) assert.equal(o.night[k] + o.day[k], o.all[k], k);
    assert.equal(new Set(r.periods.map((p) => p.id)).size, r.periods.length);
    assert.ok(o.day.total > 0 && o.night.total > 0);
  });
  test('basal check: a period under an hour is listed as excluded with its reason, not dropped', () => {
    const r = B.basalCheck(mk({ g: fall, hist: [{ id: 'snack', kind: 'snack', name: 'snack', recipe_id: null, total_carbs: 10, eaten_at: new Date(kw(5, 21, 30)).toISOString() }] }) as any);
    const p = r.periods.find((x) => x.from === kw(5, 21))!;
    assert.equal(p.minutes, 30); assert.equal(p.status, 'excluded'); assert.ok(p.reasons.includes('short'));
  });
  test('basal check: missing readings or a dip that comes straight back make a period uncertain; readings are never changed', () => {
    const r = B.basalCheck(mk({ g: fall, skip: (x) => x > kw(6, 1) && x < kw(6, 4) }) as any);
    const p = nightOf(r, 6); assert.equal(p.status, 'uncertain'); assert.ok(p.reasons.includes('coverage')); assert.ok(p.gaps.n >= 1);
    const dip = (x: number) => { const m = (x - kw(6, 3)) / M; const base = 120; return m >= 0 && m <= 25 ? base - (m <= 10 ? 5 * m : m <= 15 ? 50 : 50 - 5 * (m - 15)) : x >= kw(5, 20) && x < kw(6, 7) ? base : 140; };
    const b = mk({ g: dip }), r2 = B.basalCheck(b as any), q = nightOf(r2, 6);
    assert.equal(q.status, 'uncertain'); assert.ok(q.reasons.includes('artifact')); assert.equal(q.low, 70, 'the low stays as the sensor read it');
    assert.equal(q.dir, 'stable', 'a dip that recovers is not a fall');
  });
  test('basal check: a finger-prick that disagrees with the sensor is a note; the sensor is relied on and the period stays clean', () => {
    const r = B.basalCheck(mk({ g: fall, extra: [{ kind: 'bg_check', bg_mgdl: 160, occurred_at: new Date(kw(6, 3)).toISOString() }] }) as any);
    const p = r.periods.find((x) => x.from === kw(5, 22))!;
    assert.ok(p.reasons.includes('prick_disagrees')); assert.equal(p.status, 'clean'); assert.equal(p.pricks[0].bg, 160);
  });
  test('basal check: no Tresiba recorded in the 30 h before: dosing history incomplete, uncertain', () => {
    const b = mk({ g: fall }); b.events = b.events.filter((e: any) => !(e.insulin_type === 'long' && [kw(4, 17), kw(5, 17)].some((x) => e.occurred_at === new Date(x).toISOString())));
    const p = nightOf(B.basalCheck(b as any), 6);
    assert.equal(p.status, 'uncertain'); assert.ok(p.reasons.includes('no_dose'));
  });
  test('basal check: CGM lows of 15 minutes or more, confirmed by a finger-prick or CGM-only', () => {
    const low = (x: number) => { const k = clock(x); return k >= 3 && k < 4 ? 60 : 140; };
    const r = B.basalCheck(mk({ g: low, extra: [{ kind: 'bg_check', bg_mgdl: 62, occurred_at: new Date(kw(6, 3, 30)).toISOString() }] }) as any);
    const s = B.summary(r, 'night');
    assert.equal(s.lows.finger, 1); assert.equal(s.lows.cgmOnly, s.lows.all - 1); assert.equal(B.summary(r, 'day').lows.all, 0);
  });
  test('basal check: the robust slope ignores one wild reading', () => {
    const t = Array.from({ length: 30 }, (_, i) => i * 5 * M), v = t.map((x) => 150 - 12 * (x / H));
    v[15] = 40;
    close(B.robustSlope(t, v), -12, 0.01);
  });
}

console.log('simple-mode graph');
{
  const G = await import('../../engine/mom');
  const S = await import('../../engine/series');
  const M = 60000;
  test('simple-mode graph: every reading at its own time, peaks and lows kept; only a real 20-minute gap breaks the line', () => {
    const T: number[] = [], V: number[] = [];
    for (let m = 0; m <= 30; m++) { T.push(m * M); V.push(200 - Math.abs(m - 15) * 4); } // a sharp 200 peak at 00:15
    T.push(45 * M, 60 * M); V.push(150, 69);              // Libre's 15-minute history while the phone was not streaming, a 69 low
    T.push(95 * M); V.push(110);                          // 35 minutes with nothing: a real gap
    const p = G.curvePoints({ t: Float64Array.from(T), v: Float64Array.from(V) } as any, 0, 100 * M);
    assert.equal(p.length, T.length, 'no reading averaged away or added');
    assert.equal(Math.max(...p.map((x) => x.v)), 200, 'the peak is drawn at its real value');
    assert.equal(Math.min(...p.map((x) => x.v)), 69, 'the low is drawn at its real value');
    assert.deepEqual(p.map((x) => x.t), T, 'each at its own time');
    assert.deepEqual(p.map((x) => x.brk), T.map((t) => t === 95 * M), 'the only break is after the 35-minute gap');
  });
  test('simple-mode graph: a history row beside a minute reading is left out; one with no minute reading near is kept', () => {
    const { withoutHistoryTwins } = S;
    const t = [0, 60, 71, 120, 1200, 2100, 2160].map((x) => x * 1000), v = [100, 101, 137, 102, 120, 130, 131];
    const h = [0, 0, 1, 0, 1, 0, 0];                      // 71 s: a twin of the minute reading at 60 s; 1200 s: alone
    const r = withoutHistoryTwins(t, v, h);
    assert.deepEqual(Array.from(r.v), [100, 101, 102, 120, 130, 131]);
    assert.deepEqual(Array.from(withoutHistoryTwins(t, v, undefined).v), v, 'without the flag nothing is dropped');
  });
  test('measure: A and B snap to real readings; change, per hour, missing readings and the same reading', () => {
    const { measureBetween } = S, M = 60000;
    const t = [0, 5, 10, 15, 63, 68].map((m) => m * M), v = [200, 190, 180, 170, 70, 80];
    const s = { t: Float64Array.from(t), v: Float64Array.from(v) };
    const r = measureBetween(s, 1 * M, 14 * M)!;               // snaps to 0 and 15 min
    assert.equal(r.ta, 0); assert.equal(r.tb, 15 * M); assert.equal(r.change, -30);
    assert.equal(r.perHour, -120, '−30 in a quarter of an hour'); assert.equal(r.missingMs, 0);
    const back = measureBetween(s, 15 * M, 0)!;               // B before A: B − A over a negative time, the same slope
    assert.equal(back.change, 30); assert.equal(back.dt, -15 * M); assert.equal(back.perHour, -120);
    const gap = measureBetween(s, 10 * M, 68 * M)!;           // across the 48-minute gap: no average
    assert.equal(gap.missingMs, 48 * M); assert.equal(gap.perHour, null); assert.equal(gap.change, -100);
    const same = measureBetween(s, 4 * M, 6 * M)!;            // both snap to the 5-minute reading
    assert.equal(same.dt, 0); assert.equal(same.perHour, null, 'no rate with no time between them');
    assert.equal(measureBetween({ t: new Float64Array(), v: new Float64Array() }, 0, M), null);
  });
}

console.log('log search');
{
  const { matches, mealHay } = await import('../search');
  test('a meal is found by its foods\' restaurant, in Arabic or English, even when it is named «سناك»', () => {
    const h = { name: 'سناك', brand: null, place: null, notes: null, lines: [
      { name: 'Chicken McNuggets 6 pcs', product: "Chicken McNuggets 6 pcs — McDonald's" }, { name: 'World Famous Fries (Regular)', product: "World Famous Fries (Regular) — McDonald's" }] };
    for (const q of ['ماك', 'ماكدونالدز', 'mcdonald', 'fries', 'nuggets']) assert.ok(matches(mealHay(h), q), q);
    assert.ok(!matches(mealHay(h), 'كنتاكي'), 'not another restaurant');
  });
}

console.log('sun');
{
  const { sunTimes } = await import('../sun');
  const kw = (ms: number) => { const d = new Date(ms + 3 * 3600000); return d.getUTCHours() * 60 + d.getUTCMinutes(); };
  const near = (got: number, h: number, m: number) => Math.abs(kw(got) - (h * 60 + m)) <= 3;
  test('Kuwait sunrise and sunset match the published times within 3 minutes', () => {
    const jun = sunTimes(Date.parse('2026-06-21T12:00:00+03:00')), dec = sunTimes(Date.parse('2026-12-21T12:00:00+03:00'));
    assert.ok(near(jun.rise, 4, 48) && near(jun.set, 18, 50), 'longest day');
    assert.ok(near(dec.rise, 6, 37) && near(dec.set, 16, 53), 'shortest day');
    const a = sunTimes(Date.parse('2026-10-16T00:30:00+03:00')), b = sunTimes(Date.parse('2026-10-16T23:30:00+03:00'));
    assert.equal(a.set, b.set, 'any moment of the Kuwait day gives that day (not the UTC day)');
  });
}

console.log('repeat meal');
{
  const { repeatPlate } = await import('../repeatMeal');
  test('repeat meal: every food kept at its amount (a cooked weight stays cooked); an unmatched one is flagged, never dropped; the logged meal is not changed', () => {
    const P = (id: string, name: string, c100: number, o: Record<string, unknown> = {}) => ({ id, name, brand: null, carbs_per_100: c100, unit: 'g', label_basis: 'cooked', kind: 'natural', ...o }) as any;
    const products = [P('rice', 'رز أبيض مطبوخ', 28.2), P('pasta', 'Spaghetti', 72, { label_basis: 'as_sold', kind: 'commercial', cooked_yield: 2.4 }), P('chick', 'دجاج مطبوخ', 0)];
    // the plate's own carbs: per 100 g, a cooked weight of a dry-label food divided by its yield
    const itemCarbs = (it: any) => { const p = products.find((x) => x.id === it.id); return p ? Math.round((it.amount * p.carbs_per_100 / 100 / (it.cooked ? p.cooked_yield : 1)) * 10) / 10 : null; };
    const L = (name: string, quantity: number, carbs: number | null, state = 'as_is', unit = 'g') => ({ name, product: null, quantity, unit, state, role: 'main', carbs });
    const h = { id: 'm1', name: 'غدا', lines: [L('رز أبيض مطبوخ', 150, 42.3), L('Spaghetti', 120, 36, 'cooked'), L('دجاج مطبوخ', 100, 0), L('مرق المطعم', 1, 15, 'as_is', 'serving'), L('رز أبيض مطبوخ', 100, 40)] } as any;
    const before = JSON.stringify(h);
    const r = repeatPlate(h, products, itemCarbs);
    assert.deepEqual(r.items.map((i) => [i.id, i.amount, !!i.cooked]), [['rice', 150, false], ['pasta', 120, true], ['chick', 100, false]]);
    assert.deepEqual(r.review.map((x) => [x.name, x.why]), [['مرق المطعم', 'no_product'], ['رز أبيض مطبوخ', 'carbs']], 'unmatched foods are listed for review');
    assert.equal(r.items.length + r.review.length, h.lines.length, 'nothing left out');
    assert.equal(r.items.reduce((s, i) => s + itemCarbs(i)!, 0), 42.3 + 36 + 0, 'the plate counts the same carbs as the logged foods it took');
    assert.ok(r.items.every((i) => !('units' in i) && !('insulin' in i)), 'no insulin is carried');
    assert.equal(JSON.stringify(h), before, 'the logged meal is unchanged');
  });
}

console.log('add food tiles');
{
  const G = await import('../productGroups');
  test('add food: each of the nine tiles opens a group (or groups joined with +) and sub-group that exist, or a browse page', () => {
    assert.equal(G.ADD_TILES.length, 9);
    for (const x of G.ADD_TILES) {
      if (x.to.startsWith('?browse=')) continue;
      const [, , keys, sub] = x.to.split('/');
      for (const k of keys.split('+')) assert.ok(G.groupByKey(k), `${x.label}: group ${k}`);
      if (sub) assert.ok(G.SUB_GROUPS[keys.split('+')[0]].some((s) => s.key === sub), `${x.label}: sub-group ${sub}`);
    }
  });
}

console.log('P0: food sources, eaten part, injections untouched');
{
  const S = await import('../../engine/source');
  test('a food\'s carb source comes from its stored note, nothing is rewritten', () => {
    assert.equal(S.carbSource({ notes: 'من صورة (تقدير): شاورما 18 غ · راجعته ماما' }), 'estimate');
    assert.equal(S.carbSource({ notes: 'من ماما: الكارب من الملصق (11 غ للحبة) · بابا يراجع الصورة' }), 'mom_label');
    assert.equal(S.carbSource({ notes: 'قيمة مرجعية من برجر كنج تركيا (الجدول الرسمي، 17 أكتوبر 2026). غير مؤكدة للكويت' }), 'reference');
    assert.equal(S.carbSource({ notes: 'من موقع ماكدونالدز الكويت الرسمي: الحصة 57 غ = 17 غ كارب.' }), null, 'official values carry no tag');
    assert.equal(S.carbSource({ notes: 'من ماما: ينتظر بابا يكمّل الملصق والكميات' }), null, 'a food sent to Dad without a number is not a label reading');
    assert.equal(S.carbSource(null), null);
    assert.deepEqual(S.plateSources(['mom_label', null, 'estimate', 'estimate']), ['estimate', 'mom_label'], 'once each, most uncertain first');
  });
  const E = await import('../../engine/eaten');
  const logged = { lines: [{ name: 'رز', quantity: 150, carbs: 42 }, { name: 'كباب', quantity: 2, carbs: 2 }], total_carbs: 44, total_fat: 18, total_protein: null };
  test('«شكثر أكلت؟» halves the meal as corrected, not the plan it came from', () => {
    const r = E.eatenFromLogged(logged, 0.5);
    assert.equal(r.carbs, 22); assert.deepEqual(r.lines.map((l) => [l.quantity, l.carbs]), [[75, 21], [1, 1]]);
    assert.equal(r.totals.total_fat, 9); assert.equal(r.totals.total_protein, null, 'unknown stays unknown');
  });
  test('changing the answer later scales from the earlier part, never twice', () => {
    const half = E.eatenFromLogged(logged, 0.5);
    const back = E.eatenFromLogged({ ...half.totals, lines: half.lines }, 1, 0.5);
    assert.equal(back.carbs, 44); assert.deepEqual(back.lines.map((l) => l.quantity), [150, 2]);
  });
  test('the same meal as in the screen check: edited, «نصها», then «كلها» gives back exactly what was served', () => {
    const served = { lines: [{ name: 'تفاح', quantity: 170, carbs: 23.5 }, { name: 'أرز أبيض مطبوخ', quantity: 100, carbs: 28.2 }], total_carbs: 51.7 };
    const half = E.eatenFromLogged(served, 0.5);
    assert.deepEqual(half.lines.map((l) => l.quantity), [85, 50]); assert.equal(half.carbs, 25.85);
    const all = E.eatenFromLogged({ ...half.totals, lines: half.lines }, 1, 0.5);
    assert.deepEqual(all.lines.map((l) => [l.quantity, l.carbs]), [[170, 23.5], [100, 28.2]]); assert.equal(all.carbs, 51.7);
  });
  test('a label read by the mother: per 100 g, per 100 ml, per serving, per piece', async () => {
    const LM = await import('../../engine/labelMath');
    assert.deepEqual(LM.labelCarbs('per100ml', 12, 200), { total: 24, problem: null }, 'cocoa drink 12 g/100 ml, a 200 ml box');
    assert.deepEqual(LM.labelCarbs('per100g', 60, 45), { total: 27, problem: null });
    assert.deepEqual(LM.labelCarbs('serving', 18, 2), { total: 36, problem: null });
    assert.deepEqual(LM.labelCarbs('piece', 11, 1), { total: 11, problem: null });
    assert.equal(LM.labelCarbs('per100g', 120, 50).problem, 'carbs', 'more than 100 g in 100 g cannot be right');
    assert.equal(LM.labelCarbs('per100g', null, 50).problem, 'carbs', 'an unread number is never used');
    assert.equal(LM.labelCarbs('serving', 20, 0).problem, 'amount');
    assert.equal(LM.labelCarbs('per100g', 80, 400).problem, 'too_much', '320 g of carbs on one plate is shown, not passed on');
  });
  test('a photo item takes its carbs from our food list when the name matches', async () => {
    const M = await import('../../engine/estimateMatch');
    const list = [
      { id: 'r1', name: 'رز بسمتي مطبوخ', name_en: 'Basmati rice, cooked', carbs_per_100: '29.7', approved: true },
      { id: 'r2', name: 'رز', name_en: 'Rice', carbs_per_100: 28, approved: true },
      { id: 'b1', name: 'برجر كنج بطاطا (صغير)', carbs_per_100: 44, per_item: true, approved: true },
      { id: 'x', name: 'بطاطس مقلية', name_en: 'French fries', carbs_per_100: 41, approved: false },
      { id: 'm', name: 'Fries (Small)', brand: "McDonald's", carbs_per_100: 36, approved: true },
    ];
    assert.equal(M.listMatch({ name_ar: 'رز', name_en: 'rice' }, list)?.id, 'r2', 'the exact name wins');
    assert.equal(M.listMatch({ name_ar: 'أرز بسمتي', name_en: 'basmati rice' }, list)?.id, 'r1', 'English name begins it');
    assert.equal(M.listMatch({ name_ar: 'بطاطس مقلية', name_en: 'fries' }, list), null, 'unapproved, branded and by-the-piece foods are not used');
    assert.equal(M.listMatch({ name_ar: 'روبيان', name_en: 'shrimp' }, list), null);
    assert.equal(M.carbsFromList(150, '29.7'), 44.6);
  });
  const body = (file: string, fn: string) => {
    const src = readFileSync(new URL(file, import.meta.url), 'utf8');
    const a = src.indexOf(`export async function ${fn}(`); assert.ok(a >= 0, `${fn} not found`);
    const b = src.indexOf('\nexport ', a + 10); return src.slice(a, b < 0 ? undefined : b);
  };
  test('no food edit and no «شكثر أكلت؟» answer writes to an insulin entry', () => {
    for (const [file, fn] of [['../editSave.ts', 'updateMealItems'], ['../editSave.ts', 'setMealCarbs'], ['../plans.ts', 'ate']] as const) {
      const b = body(file, fn);
      assert.ok(!/from\('events'\)/.test(b) && !/saveEvent\(/.test(b), `${fn} must not touch events`);
    }
  });
}

{
  const { slowShare, isDrink, absorbing, stillToAbsorb, foodEnd, foodLane, foodsFrom } = await import('../../engine/absorb');
  const T = Date.UTC(2026, 9, 21, 16, 20), M = 60000;
  test('fatty meals: the slow share grows with fat (none under 8 g, fat ÷ 50, at most 60 %); drinks are a quick pulse', () => {
    assert.equal(slowShare(null), 0); assert.equal(slowShare(5), 0); assert.equal(slowShare(10), 0.2); assert.equal(slowShare(20), 0.4); assert.equal(slowShare(32), 0.6);
    assert.ok(isDrink('1.2.3 Mango Nectar (Kids) 125ml') && isDrink('مشروب كوكتيل') && !isDrink('مرق ملوخية مع عيش'));
  });
  test('absorption: every gram is counted once; a fatty meal keeps more for later; a drink is done in about an hour', () => {
    const lean = [{ t: T, carbs: 37, fat: 2 }], fatty = [{ t: T, carbs: 37, fat: 32 }], drink = [{ t: T, carbs: 15, drink: true }];
    // the area under the rate is the carbs (minute steps over 12 hours)
    let area = 0; for (let m = 0; m < 720; m++) { const r = absorbing(fatty, T + m * M); area += (r.fast + r.slow) / 60; }
    assert.ok(Math.abs(area - 37) < 0.5, `area ${area}`);
    assert.ok(Math.abs(stillToAbsorb(fatty, T) - 37) < 1e-9 && stillToAbsorb(fatty, T - M) === 0);
    const at3 = (f: typeof lean) => stillToAbsorb(f, T + 180 * M) / 37;
    assert.ok(at3(lean) < 0.08 && at3(fatty) > 0.3 && at3(fatty) < 0.4, `${at3(lean)} ${at3(fatty)}`);
    assert.ok(stillToAbsorb(drink, T + 60 * M) / 15 < 0.1);
    assert.equal(absorbing(lean, T + 60 * M).slow, 0);
  });
  test('the end of absorption is a range around the estimate (85 % to 95 % absorbed), never before now', async () => {
    const { foodEndRange } = await import('../../engine/absorb');
    const fatty = [{ t: T, carbs: 37, fat: 32 }], at = T + 60 * M, r = foodEndRange(fatty, at)!, mid = foodEnd(fatty, at)!;
    assert.ok(r.from <= mid && mid <= r.to && r.to - r.from >= 60 * M, `${(r.from - T) / M} ${(mid - T) / M} ${(r.to - T) / M}`);
    assert.equal(foodEndRange(fatty, T + 11 * 3600000), null); assert.ok(foodEndRange([{ t: T, carbs: 20 }], T + 140 * M)!.from >= T + 140 * M);
  });
  test('one engine: active carbs, the strip and COB give the same grams; the end is later for a fatty meal', () => {
    const lean = [{ t: T, carbs: 37, fat: 2 }], fatty = [{ t: T, carbs: 37, fat: 32 }];
    const endL = (foodEnd(lean, T + M)! - T) / M, endF = (foodEnd(fatty, T + M)! - T) / M;
    assert.ok(endL >= 140 && endL <= 170 && endF > 300 && endF < 480, `${endL} ${endF}`);
    const at = T + 90 * M, l = foodLane(fatty, at)!;
    assert.equal(l.left, stillToAbsorb(fatty, at)); assert.equal(l.end, foodEnd(fatty, at)); assert.equal(l.first, T);
    assert.equal(foodLane(lean, T + 200 * M), null, 'nothing once absorbed'); assert.equal(foodEnd(lean, T - M), null, 'nothing before eating');
    const fs = foodsFrom([{ eaten_at: new Date(T).toISOString(), total_carbs: 20, total_fat: 10, name: 'x', deleted_at: null, intake: 'pending' },
      { eaten_at: new Date(T).toISOString(), total_carbs: 30, total_fat: 10, name: 'x', deleted_at: null }] as never,
      [{ kind: 'treatment', carbs_g: 15, occurred_at: new Date(T).toISOString(), deleted_at: null }] as never);
    assert.deepEqual(fs.map((f) => [f.carbs, !!f.drink]), [[30, false], [15, true]], 'a pending meal is not eaten yet; a treatment is a drink');
  });
}

{
  const B = await import('../../engine/benchmark');
  const M = 60000, T0 = Date.UTC(2026, 9, 1, 0, 0);
  const P = [{ from: 0, dia: 240, peak: 65, absorb: 180, cr: 13, isf: 90 }];
  const flat = (from: number, to: number, v: (t: number) => number) => { const r = []; for (let t = from; t <= to; t += 5 * M) r.push({ t, v: v(t), trend: 3 }); return r; };
  test('benchmark: persistence is the last reading; a reading older than 10 minutes gives no forecast', () => {
    const d = { readings: flat(T0, T0 + 120 * M, () => 120), doses: [], foods: [], params: P };
    const f = B.forecastAt(d, T0 + 60 * M)!;
    assert.deepEqual(f.pred.persist, [120, 120, 120, 120]); assert.deepEqual(f.pred.v2, [120, 120, 120, 120], 'nothing logged: no change');
    assert.equal(B.forecastAt(d, T0 + 135 * M), null);
  });
  test('benchmark: an entry logged later than the origin is not used, even with an earlier time (no leakage)', () => {
    const meal = { t: T0 + 50 * M, carbs: 39, fat: 2, meal: true };
    const d = (known: number) => ({ readings: flat(T0, T0 + 600 * M, () => 120), doses: [], foods: [{ ...meal, known }], params: P });
    const at = T0 + 60 * M;
    assert.equal(B.forecastAt(d(T0 + 90 * M), at)!.pred.v2[3], 120, 'logged at 90 min: unknown at 60');
    const seen = B.forecastAt(d(T0 + 55 * M), at)!.pred.v2;
    assert.ok(seen[3] > 120 + 0.8 * 39 / 13 * 90 * 0.9, `known: rises by most of 39 g ÷ CR × ISF (${seen[3]})`);
    assert.ok(seen[0] < seen[3], 'still rising later');
  });
  test('benchmark: v1 is linear over the absorption time; insulin pulls down by units × ISF over its duration', () => {
    const d = { readings: flat(T0, T0 + 600 * M, () => 200), doses: [{ t: T0 + 59 * M, known: T0 + 59 * M, units: 1 }], foods: [{ t: T0 + 59 * M, known: T0 + 59 * M, carbs: 26, meal: true }], params: P };
    const f = B.forecastAt(d, T0 + 60 * M)!;
    const want = 200 + (26 * 179 / 180 / 13) * 90 - 1 * 90 * (1 - 0) ; // at 240 min: carbs done, insulin almost done
    assert.ok(Math.abs(f.pred.v1[3] - want) < 6, `${f.pred.v1[3]} vs ${want}`);
  });
  test('benchmark: retrospective correction carries an unexplained rise, fading over 60 minutes', () => {
    const d = { readings: flat(T0, T0 + 600 * M, (t) => (t <= T0 + 60 * M ? 100 + Math.max(0, (t - T0 - 30 * M) / M) : 130)), doses: [], foods: [], params: P };
    const f = B.forecastAt(d, T0 + 60 * M)!;
    assert.equal(f.pred.v2[0], 130); assert.ok(Math.abs(f.pred.v2rc[1] - 160) < 1 && Math.abs(f.pred.v2rc[3] - 160) < 1, `${f.pred.v2rc}`);
  });
  test('benchmark: scores in mmol/L; a low forecast as safe counts as false reassurance', () => {
    const r = (pred: number, actual: number) => ({ o: 0, h: 30, model: 'trend' as const, pred, actual, g0: 100, ctx: 'other' as const, night: false, clean: true });
    const s = B.score([r(100, 60), r(60, 65), r(120, 120)], { lo: -10, hi: 10 });
    assert.equal(s.n, 3); assert.equal(s.lowN, 2); assert.equal(s.missedLow, 0.5); assert.equal(s.lowAlarms, 1); assert.equal(s.falseLowAlarm, 0);
    assert.equal(s.mae, Math.round(((40 + 5 + 0) / 18.016 / 3) * 100) / 100); assert.equal(s.coverage, 0.67);
  });
  test('benchmark: the test week is untouched by the training band and no window spans both', () => {
    const d = { readings: flat(T0, T0 + 12 * 86400000, (t) => 120 + 40 * Math.sin(t / 3600000)), doses: [], foods: [], params: P };
    const res = B.benchmark(d)!;
    assert.equal(res.days.test, 7); assert.ok(res.days.train >= 4);
    assert.ok(res.test['persist:30'].n > 500 && res.bands['trend:30'] && res.test['trend:30'].coverage !== null);
    assert.ok(['better', 'no_different', 'worse'].includes(res.verdict['trend:30']));
    const sh = B.shadowNow(d, T0 + 12 * 86400000, res.bands);
    assert.equal(sh.length, 5 * 4); assert.ok(sh.every((x) => x.model_version && x.lo_mgdl !== null));
  });
}

{
  // the master plan's non-negotiable tests (§11) not already covered above
  const A = await import('../../engine/absorb'), N = await import('../../engine/nightTresiba'), I = await import('../../engine/iob');
  const M = 60000, T = Date.UTC(2026, 9, 20, 15, 0), iso = (t: number) => new Date(t).toISOString();
  test('§11: 37 g with 32 g fat keeps 37 g; what is left is never negative and never more than what was eaten', () => {
    const f = [{ t: T, carbs: 37, fat: 32 }];
    for (let m = -30; m <= 13 * 60; m += 5) { const l = A.stillToAbsorb(f, T + m * M); assert.ok(l >= 0 && l <= 37 + 1e-9, `${m}: ${l}`); }
    assert.equal(A.stillToAbsorb(f, T), 37);
  });
  test('§11: overlapping meals and doses are each counted once; a deleted meal and a pending one are not counted', () => {
    const h = (id: string, g: number, x: object = {}) => ({ id, eaten_at: iso(T), total_carbs: g, total_fat: 2, name: 'x', deleted_at: null, ...x });
    const foods = A.foodsFrom([h('a', 30), h('b', 20), h('c', 50, { deleted_at: iso(T) }), h('d', 40, { intake: 'pending' })] as never,
      [{ kind: 'treatment', carbs_g: 15, occurred_at: iso(T), deleted_at: null }, { kind: 'carbs', carbs_g: 10, occurred_at: iso(T), deleted_at: iso(T) }] as never);
    assert.equal(A.stillToAbsorb(foods, T), 30 + 20 + 15);
    const doses = I.dosesFrom([{ kind: 'insulin', insulin_type: 'rapid', insulin_units: 2, occurred_at: iso(T - 10 * M), deleted_at: null },
      { kind: 'insulin', insulin_type: 'rapid', insulin_units: 1, occurred_at: iso(T + 60 * M), deleted_at: null },
      { kind: 'insulin', insulin_type: 'long', insulin_units: 7, occurred_at: iso(T), deleted_at: null }] as never);
    assert.deepEqual(doses.map((d) => [d.units, d.t]), [[2, T - 10 * M], [1, T + 60 * M]], 'the recorded injection times, Tresiba apart');
  });
  test('§11: a dose change to 7 U starts a new transition; the 9 U nights before keep their own label', () => {
    const ev = [9, 9, 9, 9, 7, 7].map((u, i) => ({ kind: 'insulin', insulin_type: 'long', insulin_units: u, occurred_at: iso(T + i * 86400000), deleted_at: null }));
    const rows = N.doseRows(ev as never);
    assert.deepEqual(rows.map((r) => [r.units, r.nth, r.nth >= N.STEADY_DOSES]), [[9, 1, false], [9, 2, false], [9, 3, false], [9, 4, true], [7, 1, false], [7, 2, false]]);
    assert.equal(rows[4].prev, 9);
  });
}

{
  const { servingWeight } = await import('../mealItems');
  const row = (unit: string, q: number, p: object | null) => ({ line: { name: 'x', unit, quantity: q }, q0: q, carbs0: 0, product: p }) as never;
  test('Edit the food: servings show what one weighs and the amount in all; grams, per-piece and unknown weights show nothing', () => {
    assert.deepEqual(servingWeight(row('serving', 1.5, { serving_size: 30, unit: 'g', per_item: false })), { each: 30, total: 45, unit: 'g' });
    assert.equal(servingWeight(row('serving', 2, { serving_size: 100, unit: 'g', per_item: true })), null, 'a per-piece product stores a placeholder 100');
    assert.equal(servingWeight(row('serving', 2, { serving_size: null, unit: 'g' })), null);
    assert.equal(servingWeight(row('g', 50, { serving_size: 30, unit: 'g' })), null);
    assert.equal(servingWeight(row('serving', 1, { serving_size: 200, unit: 'ml' }))!.unit, 'ml');
  });
}

{
  const { brandMark, brandLook, BRAND_COLOURS } = await import('../brandLook');
  test('brand badges: initials, a colour that stays the same, a picture from its own food, the family\'s choice first', () => {
    assert.equal(brandMark('KDD'), 'KDD'); assert.equal(brandMark('PICK'), 'PICK'); assert.equal(brandMark('Diet Care'), 'DC');
    assert.equal(brandMark('Almarai'), 'AL'); assert.equal(brandMark("Lay's"), 'LA'); assert.equal(brandMark('المطاحن'), 'مط');
    const milk = [{ category: 'حليب' }, { category: 'لبن' }, { category: 'عصير طبيعي' }];
    const a = brandLook('KDD', milk), b = brandLook('KDD', milk);
    assert.equal(a.emoji, '🥛'); assert.equal(a.bg, b.bg); assert.ok(BRAND_COLOURS.includes(a.bg)); assert.equal(a.kind, 'brand');
    const c = brandLook('KDD', milk, { brand: 'KDD', kind: 'restaurant', bg: '#123456', emoji: '🍦', photo_path: 'brands/x.jpg' });
    assert.deepEqual([c.bg, c.emoji, c.photo, c.kind], ['#123456', '🍦', 'brands/x.jpg', 'restaurant']);
    assert.equal(brandLook('X', []).emoji, '🛒');
  });
}

await Promise.all(pending);
console.log(`\n${n} tests passed`);
