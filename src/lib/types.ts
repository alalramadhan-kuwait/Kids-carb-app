import type { Ratio } from '../engine/status';
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
  /** alert thresholds, parent-entered (mg/dL); null = that alert is off */
  alert_urgent_low_mgdl: number | null;
  alert_low_mgdl: number | null;
  alert_high_mgdl: number | null;
  alert_low_delay_min: number;
  alert_high_delay_min: number;
  alert_nodata_min: number;
  alert_renotify_min: number;
  alert_high_renotify_min: number;
  child_name: string;
  alert_rapid_rate: number | null;
  night_start: string | null; night_end: string | null;
  night_low_mgdl: number | null; night_high_mgdl: number | null;
  night_high_silent: boolean; night_theme: boolean;
  school_days: number[]; school_start: string | null; school_end: string | null;
  school_low_mgdl: number | null; school_high_mgdl: number | null;
  escalate_min: number;
  /** display-only IOB / COB, from the care team; null = off */
  iob_dia_min: number | null; iob_peak_min: number | null; cob_absorb_min: number | null;
  /** the doctor's carb ratio and correction factor by time of day; empty = no estimate */
  ratios: Ratio[];
  sensor_days: 14 | 15;
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
  alert_urgent_low_mgdl: null,
  alert_low_mgdl: null,
  alert_high_mgdl: null,
  alert_low_delay_min: 5,
  alert_high_delay_min: 30,
  alert_nodata_min: 20,
  alert_renotify_min: 10,
  alert_high_renotify_min: 60,
  child_name: 'ليان', // i18n-ok: stored name; shown through t() where it is the default
  alert_rapid_rate: null,
  night_start: null, night_end: null, night_low_mgdl: null, night_high_mgdl: null, night_high_silent: false, night_theme: true,
  school_days: [0, 1, 2, 3, 4], school_start: null, school_end: null, school_low_mgdl: null, school_high_mgdl: null,
  escalate_min: 10,
  iob_dia_min: null, iob_peak_min: null, cob_absorb_min: null,
  ratios: [], sensor_days: 14,
};

export type AlertKind = 'urgent_low' | 'low' | 'high' | 'no_data' | 'rapid_fall' | 'rapid_rise';
export interface AlertRow {
  id: string;
  kind: AlertKind;
  state: 'pending' | 'active' | 'acknowledged' | 'resolved';
  started_at: string;
  active_at: string | null;
  value_mgdl: number | null;
  worst_mgdl: number | null;
  acknowledged_by: string | null;
  acknowledged_at: string | null;
  ack_action: 'on_it' | 'treated' | null;
  snoozed_until: string | null;
  resolved_at: string | null;
}

export interface CarePlan { hypo: string | null; hyper: string | null; sick_day: string | null; contacts: string | null; updated_by: string | null; updated_at: string }

export type EventKind = 'insulin' | 'carbs' | 'treatment' | 'note' | 'exercise' | 'sleep';
export interface EventRow {
  id: string;
  client_id: string;
  kind: EventKind;
  occurred_at: string;
  insulin_units: number | null;
  insulin_type: 'rapid' | 'long' | null;
  bolus_purpose: 'meal' | 'correction' | 'both' | null;
  carbs_g: number | null;
  treatment: string | null;
  note: string | null;
  activity_min?: number | null;
  activity_level?: 'light' | 'moderate' | 'hard' | null;
  ends_at?: string | null;
  created_by: string;
  deleted_at: string | null;
}
export interface Member { user_id: string; display_name: string | null; alert_role?: 'primary' | 'backup' | 'off' }
