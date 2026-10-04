// Mom mode data: portions (household measures), saved meals, the meal being built (kept on the phone until it is
// saved, so going back and forth between pages never loses it), and the simple-mode switch.
import { useEffect, useState } from 'react';
import { supabase } from './supabase';
import type { MomItem } from '../engine/mom';
import type { Portion, SavedMeal } from './types';

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
export interface Draft { items: MomItem[]; savedId: string | null; name: string | null }
const empty: Draft = { items: [], savedId: null, name: null };
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
  load: (m: SavedMeal) => setDraft({ items: m.items.map((i) => ({ ...i })), savedId: m.id, name: m.name }),
  clear: () => setDraft(empty),
  get: () => draft,
};

/** Full mode on a simple-mode phone, for this visit only (the switch at the bottom of mom mode). */
const FULL = 'mom-full-v1';
export const fullModeNow = () => { try { return sessionStorage.getItem(FULL) === '1'; } catch { return false; } };
export const setFullModeNow = (on: boolean) => { try { if (on) sessionStorage.setItem(FULL, '1'); else sessionStorage.removeItem(FULL); } catch { /* blocked */ } };
