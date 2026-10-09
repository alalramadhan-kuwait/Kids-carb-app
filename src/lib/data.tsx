import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { computeMeal } from './carbs';
import { candidatesOf, type Candidate } from './suggest';
import { t } from '../i18n';
import {
  DEFAULT_SETTINGS, type EventRow, type HistoryEntry, type Ingredient, type Member, type Product, type Recipe, type Settings,
} from './types';

interface Data {
  loading: boolean;
  error: string | null;
  settings: Settings;
  products: Product[];
  recipes: Recipe[];
  history: HistoryEntry[];
  /** meals saved with their dose whose eaten amount is not confirmed yet: shown in the Logs, counted nowhere */
  pendingMeals: HistoryEntry[];
  events: EventRow[];
  members: Member[];
  me: string | null;
  nameOf: (userId: string | null | undefined) => string;
  ingsByRecipe: Map<string, Ingredient[]>;
  candidates: Candidate[];
  reload: () => Promise<void>;
}

const Ctx = createContext<Data | null>(null);
export const useData = () => {
  const d = useContext(Ctx);
  if (!d) throw new Error('DataProvider missing');
  return d;
};

const num = (v: unknown) => (v === null || v === undefined ? null : Number(v));
// Postgres returns numeric as text in some setups; make everything a number once, here.
const fixProduct = (p: any): Product => ({
  ...p,
  pack_size: num(p.pack_size), carbs_per_100: Number(p.carbs_per_100), fat_per_100: num(p.fat_per_100),
  fiber_per_100: num(p.fiber_per_100), protein_per_100: num(p.protein_per_100), kcal_per_100: num(p.kcal_per_100),
  serving_size: num(p.serving_size), carbs_per_serving: num(p.carbs_per_serving), cooked_yield: num(p.cooked_yield),
  sat_fat_per_100: num(p.sat_fat_per_100), sugar_per_100: num(p.sugar_per_100), sugar_added_per_100: num(p.sugar_added_per_100), sodium_mg_per_100: num(p.sodium_mg_per_100),
  calcium_mg_per_100: num(p.calcium_mg_per_100), iron_mg_per_100: num(p.iron_mg_per_100), potassium_mg_per_100: num(p.potassium_mg_per_100), vit_d_ug_per_100: num(p.vit_d_ug_per_100),
});
const fixIng = (i: any): Ingredient => ({ ...i, quantity: Number(i.quantity) });
const fixHist = (h: any): HistoryEntry => ({
  ...h, total_carbs: Number(h.total_carbs), total_fat: num(h.total_fat), total_fiber: num(h.total_fiber),
  total_protein: num(h.total_protein), total_kcal: num(h.total_kcal),
  total_sat_fat: num(h.total_sat_fat), total_sugar_added: num(h.total_sugar_added), total_sodium: num(h.total_sodium), total_calcium: num(h.total_calcium),
  total_iron: num(h.total_iron), total_potassium: num(h.total_potassium), total_vit_d: num(h.total_vit_d),
  glucose_mgdl: num(h.glucose_mgdl), glucose_trend: num(h.glucose_trend),
});

/** Confirmed meals are what every calculation reads; pending ones (amount eaten not said yet) only the Logs show. */
const splitMeals = (all: HistoryEntry[]) => ({ history: all.filter((h) => h.intake !== 'pending'), pendingMeals: all.filter((h) => h.intake === 'pending') });

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Data, 'reload' | 'ingsByRecipe' | 'candidates' | 'nameOf'>>({
    loading: true, error: null, settings: DEFAULT_SETTINGS, products: [], recipes: [], history: [], pendingMeals: [],
    events: [], members: [], me: null,
  });
  const [ings, setIngs] = useState<Ingredient[]>([]);

  const reload = useCallback(async () => {
    const q = (t: string) => supabase.from(t).select('*');
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const [s, p, r, i, h, ev, mem, au] = await Promise.all([
      q('settings').maybeSingle(), q('products').order('name'), q('recipes').order('created_at'),
      q('recipe_ingredients').order('sort'),
      q('meal_history').is('deleted_at', null).order('eaten_at', { ascending: false }).limit(1000),
      supabase.from('events').select('*').is('deleted_at', null).gte('occurred_at', since).order('occurred_at', { ascending: false }).limit(1000),
      supabase.from('members').select('user_id,display_name,alert_role,simple_mode,activity_push'),
      supabase.auth.getUser(),
    ]);
    const err = [s, p, r, i, h, ev, mem].find((x) => x.error)?.error;
    if (err) { setState((x) => ({ ...x, loading: false, error: err.message })); return; }
    setIngs((i.data ?? []).map(fixIng));
    setState({
      loading: false, error: null,
      settings: s.data ? { ...DEFAULT_SETTINGS, ...(s.data as any),
        max_meal_carbs: Number((s.data as any).max_meal_carbs), preferred_min: Number((s.data as any).preferred_min),
        preferred_max: Number((s.data as any).preferred_max), tbsp_size: Number((s.data as any).tbsp_size),
        glucose_low_mgdl: num((s.data as any).glucose_low_mgdl), glucose_high_mgdl: num((s.data as any).glucose_high_mgdl),
        alert_rapid_rate: num((s.data as any).alert_rapid_rate), alert_fall_rate: num((s.data as any).alert_fall_rate), alert_rise_rate: num((s.data as any).alert_rise_rate), pen_step: Number((s.data as any).pen_step ?? 1) } : DEFAULT_SETTINGS,
      products: (p.data ?? []).map(fixProduct),
      recipes: (r.data ?? []).map((x: any) => ({ ...x, saved_total_carbs: num(x.saved_total_carbs) })),
      ...splitMeals((h.data ?? []).map(fixHist)),
      events: (ev.data ?? []).map((e: any) => ({ ...e, insulin_units: num(e.insulin_units), carbs_g: num(e.carbs_g) })),
      members: (mem.data ?? []) as Member[],
      me: au.data.user?.id ?? null,
    });
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  /** Only what the Logs and the graph show (meals and entries, a few dozen small rows), not the 700-product
   *  catalogue: what the automatic refreshes use, so a new entry appears in a moment even on a slow phone network. */
  const reloadEntries = useCallback(async () => {
    const since = new Date(Date.now() - 60 * 86400000).toISOString();
    const [h, ev] = await Promise.all([
      supabase.from('meal_history').select('*').is('deleted_at', null).order('eaten_at', { ascending: false }).limit(1000),
      supabase.from('events').select('*').is('deleted_at', null).gte('occurred_at', since).order('occurred_at', { ascending: false }).limit(1000),
    ]);
    if (h.error || ev.error) return;
    setState((x) => ({ ...x, ...splitMeals((h.data ?? []).map(fixHist)), events: (ev.data ?? []).map((e: any) => ({ ...e, insulin_units: num(e.insulin_units), carbs_g: num(e.carbs_g) })) }));
  }, []);

  // the other parent's entries appear without refreshing. A phone that sleeps or switches apps drops the live
  // connection without a word, so the list is also reloaded when the app comes back to the screen, when the network
  // returns, whenever the live connection (re)connects, and every minute while it is open: an entry never waits for a restart.
  useEffect(() => {
    let t: number | undefined, last = 0;
    const soon = () => { window.clearTimeout(t); t = window.setTimeout(() => { last = Date.now(); void reloadEntries(); }, 150); };
    const ch = supabase.channel('events-live')
      .on('postgres_changes', { event: '*', schema: 'carb', table: 'events' }, soon)
      .on('postgres_changes', { event: '*', schema: 'carb', table: 'meal_history' }, soon)
      .subscribe((status) => { if (status === 'SUBSCRIBED' && Date.now() - last > 3000) soon(); });
    const wake = () => { if (document.visibilityState === 'visible' && Date.now() - last > 3000) soon(); };
    const tick = window.setInterval(() => { if (document.visibilityState === 'visible' && Date.now() - last > 55000) soon(); }, 60000);
    document.addEventListener('visibilitychange', wake);
    window.addEventListener('focus', wake); window.addEventListener('online', wake); window.addEventListener('pageshow', wake);
    return () => {
      window.clearTimeout(t); window.clearInterval(tick); void supabase.removeChannel(ch);
      document.removeEventListener('visibilitychange', wake);
      window.removeEventListener('focus', wake); window.removeEventListener('online', wake); window.removeEventListener('pageshow', wake);
    };
  }, [reloadEntries]);

  const nameOf = useCallback((id: string | null | undefined) => {
    if (!id) return '';
    if (id === state.me) return t('أنت');
    return state.members.find((m) => m.user_id === id)?.display_name || t('أحد الوالدين');
  }, [state.members, state.me]);

  const ingsByRecipe = useMemo(() => {
    const m = new Map<string, Ingredient[]>();
    for (const i of ings) m.set(i.recipe_id!, [...(m.get(i.recipe_id!) ?? []), i]);
    return m;
  }, [ings]);
  const candidates = useMemo(
    () => candidatesOf(state.recipes, ingsByRecipe, state.products, state.settings),
    [state.recipes, ingsByRecipe, state.products, state.settings],
  );

  return <Ctx.Provider value={{ ...state, ingsByRecipe, candidates, reload, nameOf }}>{children}</Ctx.Provider>;
}
