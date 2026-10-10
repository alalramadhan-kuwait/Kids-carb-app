// Tests for logging, corrections and the dose review (the 2026-10 log releases). Run after run.ts by `npm test`.
import assert from 'node:assert/strict';
import { matchDose, recalcRow, reviewDose, type Recalc } from '../../engine/doseReview';
import { recompute, rowsOf, scaledRows } from '../mealItems';
import { DEFAULT_SETTINGS, type DoseSnapshot, type EventRow, type HistoryEntry, type Product } from '../types';
import { recentUnknownMeal } from '../unknownMeal';
import { dayTotals } from '../../engine/day';
import { entriesFrom, predict, triggers } from '../../engine/predict';
import { carbsFrom } from '../../engine/iob';
import { sameMeals, sittings } from '../../engine/sameMeal';
import { editProblem } from '../edit';
import { usualLowTreatments } from '../lowUsual';
import { activityMessage } from '../../../supabase/functions/carb-activity/activity';

let n = 0;
const test = (name: string, fn: () => void) => { fn(); n++; console.log('  ok', name); };
console.log('dose review after a meal correction');

// the inputs saved with a dose: carb ratio 1:13, correction 1:54, target 99–117, glucose 110 (in range), nothing on board
const snap: DoseSnapshot = { suggested: 3, carbs: 40, glucose: 110, iob: 0, cr: 13, isf: 54, target: [99, 117], food: 40 / 13, correction: 0,
  at: '2026-10-09T08:00:00Z', level: 0, reading_at: null, dia_min: 300, peak_min: 75, pen_step: 1 };
const meal = (o: Partial<HistoryEntry> = {}): HistoryEntry => ({ id: 'm1', kind: 'meal', recipe_id: null, name: 'Lunch', category: null, eaten_at: '2026-10-09T08:10:00Z',
  total_carbs: 40, total_fat: null, total_fiber: null, total_protein: null, total_kcal: null, modified: false, glucose_mgdl: null, glucose_trend: null, glucose_at: null, lines: [], notes: null, ...o });

test('40 g corrected to 25 g: calculated 3 U then, 1 U for the corrected meal, given stays 3 U', () => {
  const row = recalcRow(meal(), { plan_id: 'p1', event_id: 'e1', snapshot: snap }, 25, 3, 'carbs');
  assert.equal(row.dose_at_dose, 3, 'what the calculator showed then');
  assert.equal(row.carbs_at_dose, 40);
  assert.equal(row.dose_after, 1, '25 ÷ 13 = 1.9, rounded down to the pen step');
  assert.equal(row.given_units, 3, 'the dose given is carried as it was, never changed');
  assert.equal(row.carbs_before, 40); assert.equal(row.carbs_after, 25);
  assert.deepEqual(row.inputs, snap, 'the saved inputs are kept with the review');
});

test('the review uses the settings saved with the dose, not today\'s', () => {
  // the same 25 g with a different (later) ratio would give 2 U; the review must still say 1 U
  assert.equal(reviewDose({ ...snap, cr: 10 }, 25), 2);
  assert.equal(reviewDose(snap, 25), 1);
  // a correction part saved then stays in: glucose 171 above 117 → +1 U
  assert.equal(reviewDose({ ...snap, glucose: 171 }, 25), 2);
  // insulin on board then covers that correction first
  assert.equal(reviewDose({ ...snap, glucose: 171, iob: 1 }, 25), 1);
});

test('which dose a meal had: only when certain', () => {
  const h = meal();
  const plan = { id: 'p1', history_id: 'm1', dose_event_id: 'e1', dose_snapshot: snap };
  assert.equal(matchDose(h, [], [plan], [])?.plan_id, 'p1', 'the plan it came from');
  assert.equal(matchDose({ ...h, client_id: 'p1' }, [], [{ ...plan, history_id: null }], [])?.plan_id, 'p1', 'a pending meal is linked by its plan id');
  const ev = (id: string, min: number, carbs: number, o = {}) => ({ id, kind: 'insulin' as const, insulin_type: 'rapid' as const, bolus_purpose: 'meal' as const, deleted_at: null,
    occurred_at: new Date(Date.parse(h.eaten_at) + min * 60000).toISOString(), dose_calc: { ...snap, carbs }, ...o });
  assert.equal(matchDose(h, [], [], [ev('e1', -10, 40)])?.event_id, 'e1', 'a calculator dose for these carbs, 10 min before');
  assert.equal(matchDose(h, [], [], [ev('e1', -10, 30)]), null, 'other carbs: not this meal');
  assert.equal(matchDose(h, [], [], [ev('e1', -60, 40)]), null, 'too long before');
  assert.equal(matchDose(h, [], [], [ev('e1', -10, 40), ev('e2', -5, 40)]), null, 'two candidates: not certain, nothing shown');
  assert.equal(matchDose(h, [], [], [ev('e1', -10, 40, { bolus_purpose: 'correction' })]), null, 'a correction is not a meal dose');
  assert.equal(matchDose(h, [], [], [{ ...ev('e1', -10, 40), dose_calc: null }]), null, 'no saved inputs: no recalculation');
  // after the first correction the meal's carbs changed; the earlier review keeps the link
  const prior: Recalc[] = [{ id: 'r1', at: '2026-10-09T09:00:00Z', by: 'u1', history_id: 'm1', plan_id: null, event_id: 'e1', carbs_at_dose: 40, dose_at_dose: 3,
    carbs_before: 40, carbs_after: 25, dose_after: 1, given_units: 3, inputs: snap, reason: 'carbs' }];
  assert.equal(matchDose({ ...h, total_carbs: 25 }, prior, [], [])?.event_id, 'e1');
});

console.log('simple-mode meal edit');
const P = (id: string, name: string, c100: number): Product => ({ id, name, brand: null, category: 'x', kind: 'natural', image_path: null, pack_size: null, unit: 'g', carbs_per_100: c100,
  fat_per_100: 2, fiber_per_100: 1, protein_per_100: 3, kcal_per_100: 100, serving_size: null, carbs_per_serving: null, label_basis: 'as_sold', cooked_yield: null, available: true, approved: true,
  label_updated_at: null, notes: null } as unknown as Product);
test('how much she ate scales every food; the saved meal is the same entry with new carbs', () => {
  const products = [P('rice', 'Rice', 28), P('apple', 'Apple', 14)];
  const h = meal({ total_carbs: 42, total_fat: 3, total_fiber: 1.5, total_protein: 4.5, total_kcal: 150, lines: [
    { name: 'Rice', product: 'Rice', quantity: 100, unit: 'g', state: 'as_is', role: 'main', carbs: 28 },
    { name: 'Apple', product: 'Apple', quantity: 100, unit: 'g', state: 'as_is', role: 'snack', carbs: 14 }] });
  const rows = rowsOf(h, products);
  const half = recompute(h, scaledRows(rows, 0.5), DEFAULT_SETTINGS);
  assert.equal(half.carbs, 21);
  assert.deepEqual(half.lines.map((l) => l.quantity), [50, 50]);
  assert.equal(half.totals.kcal, 50, 'nutrition follows the labels');
  const noApple = recompute(h, rows.map((x) => (x.line.name === 'Apple' ? { ...x, line: { ...x.line, quantity: 0 } } : x)), DEFAULT_SETTINGS);
  assert.equal(noApple.carbs, 28); assert.equal(noApple.lines.length, 1, 'a removed food is dropped');
  assert.equal(scaledRows(rows, 1), rows, 'all of it: unchanged');
});

console.log('ate out, carbs not known');
const H = 3600000, T0 = Date.parse('2026-10-09T15:00:00Z');
const out = (o: Partial<HistoryEntry> = {}) => meal({ id: 'out1', name: 'دجاج + رز + نودلز', eaten_at: new Date(T0).toISOString(), total_carbs: null, carbs_unknown: true,
  foods: ['دجاج', 'رز', 'نودلز'], place: 'Noodle House', ...o });
test('a meal with unknown carbs is counted as unknown, never as 0 g', () => {
  const day = dayTotals([out(), meal({ id: 'k', eaten_at: new Date(T0 - 3 * H).toISOString(), total_carbs: 30 })], [], T0 - 10 * H, T0 + 10 * H);
  assert.equal(day.carbs, 30, 'only the known meal is in the total');
  assert.equal(day.unknown, 1, 'the unknown one is counted apart');
  assert.equal(day.meals, 2);
  assert.deepEqual(carbsFrom([out()], []), [], 'nothing it can count as carbs on board');
  assert.deepEqual(usualLowTreatments([{ name: 'x', total_carbs: null, glucose_mgdl: 60 }], []), [], 'never a usual low treatment');
});
test('every dose screen is told about it for 4 hours', () => {
  assert.equal(recentUnknownMeal([out()], T0 + 30 * 60000)?.name, 'دجاج + رز + نودلز');
  assert.equal(recentUnknownMeal([out()], T0 + 3.9 * H) !== null, true);
  assert.equal(recentUnknownMeal([out()], T0 + 4.1 * H), null, 'after 4 hours it is no longer news');
  assert.equal(recentUnknownMeal([out({ total_carbs: 50, carbs_unknown: false })], T0 + H), null, 'once its carbs are known, no warning');
});
test('no prediction starts from it or runs through it', () => {
  const dose = (min: number) => ({ id: 'd' + min, kind: 'insulin', occurred_at: new Date(T0 + min * 60000).toISOString(), insulin_units: 2, insulin_type: 'rapid', deleted_at: null }) as unknown as EventRow;
  const m = { iob: { dia: 240, peak: 65 }, absorb: 180, ratios: [{ from: '00:00', cr: 15, isf: 72 }] };
  const after = entriesFrom([out()], [dose(60)]);
  assert.equal(triggers(after).some((e) => e.kind === 'meal'), false, 'the unknown meal never starts a prediction');
  assert.equal(predict(after.find((e) => e.kind === 'dose')!, after, 120, m as never), null, 'a dose an hour after it: its carbs are still on board, unknown');
  const before = entriesFrom([out()], [dose(-60)]);
  assert.notEqual(predict(before.find((e) => e.kind === 'dose')!, before, 120, m as never), null, 'a dose an hour before it is predicted as usual (the meal then ends its checks)');
});
test('the same restaurant is the same meal; never compared with a meal whose carbs are known', () => {
  const before = out({ id: 'out0', eaten_at: new Date(T0 - 7 * 86400000).toISOString(), foods: ['دجاج', 'بطاط'] });
  const known = meal({ id: 'k', name: 'دجاج + رز + نودلز', eaten_at: new Date(T0 - 3 * 86400000).toISOString(), total_carbs: 60,
    lines: [{ name: 'دجاج + رز + نودلز', product: null, quantity: 1, unit: 'serving', state: 'as_is', role: 'main', carbs: 60 }] });
  const all = sittings([before, known, out()]);
  const now = all.find((s) => s.ids.includes('out1'))!;
  assert.equal(now.unknown, true);
  const same = sameMeals(now, all).map((x) => x.s.id);
  assert.deepEqual(same, ['out0'], 'same place counts; the known-carbs meal with the same name does not');
  const elsewhere = sittings([out({ id: 'out0', eaten_at: before.eaten_at, place: 'Other', foods: ['سمك'] }), out()]);
  assert.deepEqual(sameMeals(elsewhere.find((s) => s.ids.includes('out1'))!, elsewhere), [], 'another place with other food: not the same');
});
test('the dose review never matches a calculator dose to unknown carbs', () => {
  const ev = { id: 'e9', kind: 'insulin', insulin_type: 'rapid', bolus_purpose: 'meal', occurred_at: new Date(T0 - 5 * 60000).toISOString(), deleted_at: null, dose_calc: { ...snap, carbs: 0 } };
  assert.equal(matchDose(out(), [], [], [ev as never]), null);
});
test('editing it: the time can change without carbs; carbs typed in must be real numbers', () => {
  const d = { t: T0, carbs: null, name: 'x' };
  assert.equal(editProblem('meal', d, T0 + H, true), null, 'carbs may stay unknown');
  assert.equal(editProblem('meal', d, T0 + H, false), 'carbs', 'any other meal still needs its carbs');
  assert.equal(editProblem('meal', { ...d, carbs: 900 }, T0 + H, true), 'carbs', 'a typo is still caught');
});
test('the other parent is told "carbs unknown", not "0 g"', () => {
  const row = { kind: 'meal' as const, by_user: 'u', occurred_at: new Date(T0).toISOString(), carbs: null, units: null, mgdl: null, name: 'دجاج + رز + نودلز' };
  const strip = (x: string) => x.replace(/[⁦-⁩]/g, '');
  assert.equal(strip(activityMessage(row, 'Rawan', 'en').title), '🍽️ Rawan added a meal · carbs unknown');
  assert.match(strip(activityMessage(row, 'Rawan', 'ar').title), /الكارب غير معروف/);
  assert.match(strip(activityMessage({ ...row, carbs: 30 }, 'Rawan', 'en').title), /30 g carbs/);
});

console.log(`\n${n} log tests passed`);
