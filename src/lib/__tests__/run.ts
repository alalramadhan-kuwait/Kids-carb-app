import assert from 'node:assert/strict';
import { computeLine, computeMeal, deriveLabel, labelMismatch, levelFor, targetMiss } from '../carbs';
import { blocker, candidatesOf, suggest } from '../suggest';
import { shoppingList } from '../shopping';
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
  total_protein: null, total_kcal: null, modified: false, lines: [], notes: null,
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

console.log(`\n${n} tests passed`);
