export type Unit = 'g' | 'ml' | 'serving' | 'tbsp';
export type State = 'raw' | 'cooked' | 'as_is';
export type Role = 'main' | 'drink' | 'snack';

export interface Product {
  id: string;
  name: string;
  brand: string | null;
  category: string;
  kind: 'natural' | 'commercial';
  image_path: string | null;
  pack_size: number | null;
  unit: 'g' | 'ml';
  carbs_per_100: number; // Total Carbohydrate
  fat_per_100: number | null;
  fiber_per_100: number | null;
  protein_per_100: number | null;
  kcal_per_100: number | null;
  serving_size: number | null; // also what "1 piece" means
  carbs_per_serving: number | null;
  label_basis: 'as_sold' | 'cooked';
  cooked_yield: number | null; // cooked g per 1 g as sold
  available: boolean;
  approved: boolean;
  label_updated_at: string;
  notes: string | null;
}

export interface Ingredient {
  id: string;
  recipe_id?: string;
  role: Role;
  product_id: string | null;
  slot_category: string | null;
  label: string | null;
  quantity: number;
  unit: Unit;
  state: State;
  qty_confirmed: boolean;
  note: string | null;
  sort: number;
}

export interface Recipe {
  id: string;
  name: string;
  category: string | null;
  image_path: string | null;
  instructions: string | null;
  notes: string | null;
  approved: boolean;
  favorite: boolean;
  carb_pending: boolean;
  pending_note: string | null;
  saved_total_carbs: number | null;
}

export interface Snack {
  id: string;
  name: string;
  image_path: string | null;
  product_id: string | null;
  slot_category: string | null;
  quantity: number;
  unit: Unit;
  state: State;
  qty_confirmed: boolean;
  note: string | null;
}

export interface CategoryTarget {
  category: string;
  basis: 'per100' | 'serving';
  max: number;
}

export interface Settings {
  max_meal_carbs: number;
  preferred_min: number;
  preferred_max: number;
  tbsp_size: number;
  category_targets: CategoryTarget[];
  glucose_unit: 'mmol' | 'mgdl';
  /** parent-entered, only used to colour the reading; null = no colouring */
  glucose_low_mgdl: number | null;
  glucose_high_mgdl: number | null;
}

export interface HistoryLine {
  name: string;
  product: string | null;
  quantity: number;
  unit: Unit;
  state: State;
  role: Role;
  carbs: number | null;
}

export interface HistoryEntry {
  id: string;
  kind: 'meal' | 'snack';
  recipe_id: string | null;
  name: string;
  category: string | null;
  eaten_at: string;
  total_carbs: number;
  total_fat: number | null;
  total_fiber: number | null;
  total_protein: number | null;
  total_kcal: number | null;
  modified: boolean;
  glucose_mgdl: number | null;
  glucose_trend: number | null;
  glucose_at: string | null;
  lines: HistoryLine[];
  notes: string | null;
}

export interface PlanRow {
  id: string;
  plan_date: string;
  recipe_id: string;
  people: number;
  }

export const DEFAULT_SETTINGS: Settings = {
  max_meal_carbs: 60,
  preferred_min: 40,
  preferred_max: 55,
  tbsp_size: 15,
  category_targets: [],
  glucose_unit: 'mmol',
  glucose_low_mgdl: null,
  glucose_high_mgdl: null,
};
