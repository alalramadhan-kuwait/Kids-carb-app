// Mom mode data: portions (household measures), saved meals, the meal being built (kept on the phone until it is
// saved, so going back and forth between pages never loses it), and the simple-mode switch.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { addToDraft, withCompared, type FoodRef, type MomItem } from '../engine/mom';
import type { ReviewItem } from './repeatMeal';
import type { InjectionSite, Portion, SavedMeal } from './types';
import { useData } from './data';
import { sensorLife } from '../engine/status';

function liveTable<T>(table: string, order: string) {
  let cache: T[] | null = null;
  const subs = new Set<(l: T[]) => void>();
  let channel: ReturnType<typeof supabase.channel> | null = null;
  const load = async () => {
    const { data } = await supabase.from(table).select('*').order(order);
    cache = (data ?? []) as T[];
    subs.forEach((f) => f(cache!));
  };
  const use = () => {
    const [list, setList] = useState<T[] | null>(cache);
    useEffect(() => {
      subs.add(setList);
      if (!cache) void load();
      if (!channel) channel = supabase.channel(table).on('postgres_changes', { event: '*', schema: 'carb', table }, () => void load()).subscribe();
      return () => { subs.delete(setList); };
    }, []);
    return { list: list ?? [], loaded: list !== null, reload: load };
  };
  return { use, load };
}

const portionsT = liveTable<Portion>('portions', 'sort');
const mealsT = liveTable<SavedMeal>('saved_meals', 'sort');
const sensorsT = liveTable<{ sn: string; started_at: string; days: number | null; site: InjectionSite | null }>('sensors', 'started_at');

/** The sensor she wears now (from LibreLinkUp): when it ends, and where it is (that site gets no injections). */
export function useSensor() {
  const { settings } = useData();
  const { list } = sensorsT.use();
  const s = list.length ? list[list.length - 1] : null; // the newest sensor (LibreLinkUp adds each new serial)
  if (!s) return null;
  const life = sensorLife(s.started_at, s.days ?? settings.sensor_days ?? 14, Date.now());
  if (life.state === 'ended') return null;
  return { sn: s.sn, startedAt: s.started_at, days: s.days ?? settings.sensor_days ?? 14, life, site: s.site };
}
/** Where the current sensor is worn (one row per sensor serial). */
export async function setSensorSite(sn: string, startedAt: string, days: number, site: InjectionSite) {
  const patch = { site, site_at: new Date().toISOString() };
  const r = await supabase.from('sensors').update(patch).eq('sn', sn).select('sn');
  if (r.error) throw new Error(r.error.message);
  if (!r.data?.length) { const i = await supabase.from('sensors').insert({ sn, started_at: startedAt, days, source: 'librelinkup', ...patch }); if (i.error) throw new Error(i.error.message); }
  await sensorsT.load();
}
export const usePortions = () => { const r = portionsT.use(); return { portions: r.list.map((p) => ({ ...p, amount: Number(p.amount) })), loaded: r.loaded }; };
export const useSavedMeals = () => { const r = mealsT.use(); return { meals: r.list, loaded: r.loaded }; };

const ok = async <T,>(p: PromiseLike<{ error: { message: string } | null; data?: T }>) => { const r = await p; if (r.error) throw new Error(r.error.message); return r.data as T; };

export async function savePortion(p: Omit<Portion, 'id'> & { id?: string }) {
  const row = { product_id: p.product_id, recipe_id: p.recipe_id, label: p.label.trim(), amount: p.amount, photo_path: p.photo_path, sort: p.sort };
  await ok(p.id ? supabase.from('portions').update(row).eq('id', p.id) : supabase.from('portions').insert(row));
  await portionsT.load();
}
/** Mom gives a food that is not in the list, with its label in hand: the food is kept with its label photo and its
 *  carbs for one piece (as written on the label), and one portion «حبة», so it counts like any food on the plate and
 *  is found by name next time (never entered twice). Dad can check it against the photo. */
export async function saveLabelFood(f: { name: string; carbs: number; photo: string; note?: string }): Promise<{ productId: string; portionId: string }> {
  const prod: { id: string } = await ok<any>(supabase.from('products').insert({ name: f.name.trim(), brand: null, category: 'أخرى', kind: 'commercial', image_path: f.photo, unit: 'g', // i18n-ok: stored value
    per_item: true, carbs_per_100: f.carbs, approved: true, available: true, label_basis: 'as_sold',
    notes: f.note ?? `من ماما: الكارب من الملصق (${f.carbs} غ للحبة) · بابا يراجع الصورة` }).select('id').single()); // i18n-ok: stored note
  const portion: { id: string } = await ok<any>(supabase.from('portions').insert({ product_id: prod.id, recipe_id: null, label: 'حبة', amount: 100, photo_path: null, sort: 0 }).select('id').single()); // i18n-ok: stored value
  await portionsT.load();
  return { productId: prod.id, portionId: portion.id };
}
/** A packaged food the mother read off its label herself (photo kept, «قراءة ماما» on every screen): the printed carbs
 *  for 100 g / 100 ml, a serving or a piece, so it is found and counted the same way next time. */
export async function saveMomLabelFood(f: { name: string; photo: string | null; basis: import('../engine/labelMath').LabelBasis; carbs: number }): Promise<{ productId: string; portionId: string | null }> {
  const per100 = f.basis === 'per100g' || f.basis === 'per100ml';
  const word = f.basis === 'per100g' ? 'لكل 100 غ' : f.basis === 'per100ml' ? 'لكل 100 مل' : f.basis === 'serving' ? 'للحصة' : 'للحبة'; // i18n-ok: stored note
  const prod: { id: string } = await ok<any>(supabase.from('products').insert({ name: f.name.trim(), brand: null, category: 'أخرى', kind: 'commercial', image_path: f.photo, // i18n-ok: stored value
    unit: f.basis === 'per100ml' ? 'ml' : 'g', per_item: !per100, carbs_per_100: f.carbs, approved: true, available: true, label_basis: 'as_sold',
    notes: `من ماما: الكارب من الملصق (${f.carbs} غ ${word})${f.photo ? '' : ' · بدون صورة للملصق'}` }).select('id').single()); // i18n-ok: stored note
  let portionId: string | null = null;
  if (!per100) {
    const portion: { id: string } = await ok<any>(supabase.from('portions').insert({ product_id: prod.id, recipe_id: null, label: f.basis === 'serving' ? 'حصة' : 'حبة', amount: 100, photo_path: null, sort: 0 }).select('id').single()); // i18n-ok: stored value
    portionId = portion.id;
  }
  await portionsT.load();
  return { productId: prod.id, portionId };
}
export async function deletePortion(id: string) { await ok(supabase.from('portions').delete().eq('id', id)); await portionsT.load(); }

export async function saveMeal(m: Omit<SavedMeal, 'id' | 'sort'> & { id?: string }) {
  const row = { name: m.name.trim(), emoji: m.emoji, items: m.items, updated_at: new Date().toISOString() };
  await ok(m.id ? supabase.from('saved_meals').update(row).eq('id', m.id) : supabase.from('saved_meals').insert(row));
  await mealsT.load();
}

export const setSimpleMode = (user: string, on: boolean) => ok(supabase.rpc('set_simple_mode', { p_user: user, p_on: on }));

// ── the meal being built on this phone ─────────────────────────────────────────────────────────────
const KEY = 'mom-draft-v1';
/** left: foods sent to Dad and eaten anyway; they are not in the dose and the dose page says so. */
/** mode: 'now' — she eats now (dose next); 'plan' — a meal planned for later (on hold until its time). */
/** planId: a planned meal being changed (its plate was loaded here); saving it updates that plan. */
/** review: foods of a repeated meal that could not be matched (lib/repeatMeal): flagged on the plate, and the plate
 *  goes on to the dose only once each is found again or removed. fixing: the one being searched for now. */
export interface Draft { items: MomItem[]; savedId: string | null; name: string | null; left: string[]; mode: 'now' | 'plan'; planId?: string | null; review?: ReviewItem[]; fixing?: number | null }
const empty: Draft = { items: [], savedId: null, name: null, left: [], mode: 'now', review: [], fixing: null };
let draft: Draft = (() => { try { return { ...empty, ...JSON.parse(localStorage.getItem(KEY) ?? 'null') }; } catch { return empty; } })();
const draftSubs = new Set<(d: Draft) => void>();
function setDraft(d: Draft) {
  draft = d;
  try { localStorage.setItem(KEY, JSON.stringify(d)); } catch { /* storage blocked: kept in memory */ }
  draftSubs.forEach((f) => f(d));
}
export function useDraft() {
  const [d, setD] = useState(draft);
  useEffect(() => { draftSubs.add(setD); return () => { draftSubs.delete(setD); }; }, []);
  return d;
}
export const draftOps = {
  // a food added while one under review was being searched for takes its place: that one is done
  add: (it: MomItem) => setDraft({ ...draft, items: [...draft.items, it], ...(draft.fixing != null ? { review: (draft.review ?? []).filter((_, i) => i !== draft.fixing), fixing: null } : {}) }),
  replace: (k: number, it: MomItem) => setDraft({ ...draft, items: draft.items.map((x, i) => (i === k ? it : x)) }),
  remove: (k: number) => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== k) }),
  /** A meal from the Log on the plate, to change into a new one (named by the time it is eaten, like any meal). */
  loadItems: (items: MomItem[], review: ReviewItem[]) => setDraft({ items, savedId: null, name: null, left: [], mode: 'now', review, fixing: null }),
  /** A meal from the Log as a plan («خططيها بكرة»): the same foods and name, to give a day and a time. */
  planItems: (items: MomItem[], review: ReviewItem[], name: string | null) => setDraft({ items, savedId: null, name, left: [], mode: 'plan', review, fixing: null }),
  /** An earlier meal's foods added to the plate (a plan stays a plan). */
  addItems: (items: MomItem[], review: ReviewItem[]) => setDraft(addToDraft(draft, items, review)),
  /** A food under review: look for it again (the next food added takes its place), or remove it from the plate. */
  fix: (i: number | null) => setDraft({ ...draft, fixing: i }),
  dropReview: (i: number) => setDraft({ ...draft, review: (draft.review ?? []).filter((_, k) => k !== i), fixing: null }),
  load: (m: SavedMeal) => setDraft({ items: m.items.map((i) => ({ ...i })), savedId: m.id, name: m.name, left: draft.left, mode: draft.mode, review: draft.review, fixing: null }),
  leaveOut: (name: string) => setDraft({ ...draft, left: [...draft.left.filter((x) => x !== name), name] }),
  clear: () => setDraft(empty),
  /** A planned meal's plate, to change it before its dose. */
  editPlan: (items: MomItem[], name: string, planId: string) => setDraft({ items: items.map((i) => ({ ...i })), savedId: null, name, left: [], mode: 'plan', planId }),
  /** «الحين» or «وقت ثاني» chosen at the end: the same plate, now for eating now or for later. */
  setMode: (mode: Draft['mode']) => { if (draft.mode !== mode) setDraft({ ...draft, mode }); },
  /** Start building for now or for a plan; switching between them starts a fresh plate. */
  start: (mode: Draft['mode']) => { if (draft.mode !== mode) setDraft({ ...empty, mode }); },
  get: () => draft,
};

// ── the foods being compared on this phone (up to three, kept like the meal being built) ──────────────
const CMP = 'mom-compare-v1';
let compared: FoodRef[] = (() => { try { const l = JSON.parse(localStorage.getItem(CMP) ?? '[]'); return Array.isArray(l) ? l : []; } catch { return []; } })();
const cmpSubs = new Set<(l: FoodRef[]) => void>();
function setCompared(l: FoodRef[]) {
  compared = l;
  try { localStorage.setItem(CMP, JSON.stringify(l)); } catch { /* storage blocked: kept in memory */ }
  cmpSubs.forEach((f) => f(l));
}
export function useCompare() {
  const [l, setL] = useState(compared);
  useEffect(() => { cmpSubs.add(setL); return () => { cmpSubs.delete(setL); }; }, []);
  return l;
}
export const compareOps = {
  add: (x: FoodRef) => setCompared(withCompared(compared, x)),
  remove: (x: FoodRef) => setCompared(compared.filter((r) => !(r.kind === x.kind && r.id === x.id))),
  clear: () => setCompared([]),
};

/** Full mode on a simple-mode phone, for this visit only (the switch at the bottom of mom mode). */
const FULL = 'mom-full-v1';
export const fullModeNow = () => { try { return sessionStorage.getItem(FULL) === '1'; } catch { return false; } };
export const setFullModeNow = (on: boolean) => { try { if (on) sessionStorage.setItem(FULL, '1'); else sessionStorage.removeItem(FULL); } catch { /* blocked */ } };
