// Mom mode data: portions (household measures), saved meals, the meal being built (kept on the phone until it is
// saved, so going back and forth between pages never loses it), and the simple-mode switch.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import { withCompared, type FoodRef, type MomItem } from '../engine/mom';
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
export async function deletePortion(id: string) { await ok(supabase.from('portions').delete().eq('id', id)); await portionsT.load(); }

export async function saveMeal(m: Omit<SavedMeal, 'id' | 'sort'> & { id?: string }) {
  const row = { name: m.name.trim(), emoji: m.emoji, items: m.items, updated_at: new Date().toISOString() };
  await ok(m.id ? supabase.from('saved_meals').update(row).eq('id', m.id) : supabase.from('saved_meals').insert(row));
  await mealsT.load();
}
export async function deleteMeal(id: string) { await ok(supabase.from('saved_meals').delete().eq('id', id)); await mealsT.load(); }

export const setSimpleMode = (user: string, on: boolean) => ok(supabase.rpc('set_simple_mode', { p_user: user, p_on: on }));

// ── the meal being built on this phone ─────────────────────────────────────────────────────────────
const KEY = 'mom-draft-v1';
/** left: foods sent to Dad and eaten anyway; they are not in the dose and the dose page says so. */
/** mode: 'now' — she eats now (dose next); 'plan' — a meal planned for later (on hold until its time). */
export interface Draft { items: MomItem[]; savedId: string | null; name: string | null; left: string[]; mode: 'now' | 'plan' }
const empty: Draft = { items: [], savedId: null, name: null, left: [], mode: 'now' };
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
  add: (it: MomItem) => setDraft({ ...draft, items: [...draft.items, it] }),
  replace: (k: number, it: MomItem) => setDraft({ ...draft, items: draft.items.map((x, i) => (i === k ? it : x)) }),
  remove: (k: number) => setDraft({ ...draft, items: draft.items.filter((_, i) => i !== k) }),
  /** A meal from the Log on the plate, to change into a new one (named by the time it is eaten, like any meal). */
  loadItems: (items: MomItem[], left: string[]) => setDraft({ items, savedId: null, name: null, left, mode: 'now' }),
  load: (m: SavedMeal) => setDraft({ items: m.items.map((i) => ({ ...i })), savedId: m.id, name: m.name, left: draft.left, mode: draft.mode }),
  leaveOut: (name: string) => setDraft({ ...draft, left: [...draft.left.filter((x) => x !== name), name] }),
  clear: () => setDraft(empty),
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
