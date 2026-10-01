import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import { supabase } from './supabase';
import { computeMeal } from './carbs';
import { candidatesOf, type Candidate } from './suggest';
import {
  DEFAULT_SETTINGS, type HistoryEntry, type Ingredient, type PlanRow, type Product, type Recipe, type Settings, type Snack,
} from './types';

interface Data {
  loading: boolean;
  error: string | null;
  settings: Settings;
  products: Product[];
  recipes: Recipe[];
  snacks: Snack[];
  history: HistoryEntry[];
  plan: PlanRow[];
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
});
const fixIng = (i: any): Ingredient => ({ ...i, quantity: Number(i.quantity) });
const fixHist = (h: any): HistoryEntry => ({
  ...h, total_carbs: Number(h.total_carbs), total_fat: num(h.total_fat), total_fiber: num(h.total_fiber),
  total_protein: num(h.total_protein), total_kcal: num(h.total_kcal),
  glucose_mgdl: num(h.glucose_mgdl), glucose_trend: num(h.glucose_trend),
});

export function DataProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<Data, 'reload' | 'ingsByRecipe' | 'candidates'>>({
    loading: true, error: null, settings: DEFAULT_SETTINGS, products: [], recipes: [], snacks: [], history: [], plan: [],
  });
  const [ings, setIngs] = useState<Ingredient[]>([]);

  const reload = useCallback(async () => {
    const q = (t: string) => supabase.from(t).select('*');
    const [s, p, r, i, sn, h, pl] = await Promise.all([
      q('settings').maybeSingle(), q('products').order('name'), q('recipes').order('created_at'),
      q('recipe_ingredients').order('sort'), q('snacks').order('created_at'),
      q('meal_history').order('eaten_at', { ascending: false }).limit(1000), q('meal_plan').order('plan_date'),
    ]);
    const err = [s, p, r, i, sn, h, pl].find((x) => x.error)?.error;
    if (err) { setState((x) => ({ ...x, loading: false, error: err.message })); return; }
    setIngs((i.data ?? []).map(fixIng));
    setState({
      loading: false, error: null,
      settings: s.data ? { ...DEFAULT_SETTINGS, ...(s.data as any),
        max_meal_carbs: Number((s.data as any).max_meal_carbs), preferred_min: Number((s.data as any).preferred_min),
        preferred_max: Number((s.data as any).preferred_max), tbsp_size: Number((s.data as any).tbsp_size),
        glucose_low_mgdl: num((s.data as any).glucose_low_mgdl), glucose_high_mgdl: num((s.data as any).glucose_high_mgdl) } : DEFAULT_SETTINGS,
      products: (p.data ?? []).map(fixProduct),
      recipes: (r.data ?? []).map((x: any) => ({ ...x, saved_total_carbs: num(x.saved_total_carbs) })),
      snacks: (sn.data ?? []).map((x: any) => ({ ...x, quantity: Number(x.quantity) })),
      history: (h.data ?? []).map(fixHist),
      plan: pl.data ?? [],
    });
  }, []);

  useEffect(() => { void reload(); }, [reload]);

  const ingsByRecipe = useMemo(() => {
    const m = new Map<string, Ingredient[]>();
    for (const i of ings) m.set(i.recipe_id!, [...(m.get(i.recipe_id!) ?? []), i]);
    return m;
  }, [ings]);
  const candidates = useMemo(
    () => candidatesOf(state.recipes, ingsByRecipe, state.products, state.settings),
    [state.recipes, ingsByRecipe, state.products, state.settings],
  );

  return <Ctx.Provider value={{ ...state, ingsByRecipe, candidates, reload }}>{children}</Ctx.Provider>;
}

/** Look at one recipe with today's products. */
export function useMeal(ings: Ingredient[]) {
  const { products, settings } = useData();
  return useMemo(() => computeMeal(ings, products, settings), [ings, products, settings]);
}
