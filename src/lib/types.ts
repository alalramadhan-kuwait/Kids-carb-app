import type { Ratio } from '../engine/status';

export interface DoseCalc { suggested: number; carbs: number; glucose: number; iob: number; cr: number; isf: number; target: [number, number]; food: number; correction: number }
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
  /** the maker's page it came from, and where its picture was fetched from */
  source_url?: string | null; image_source?: string | null;
  pack_size: number | null;
  unit: 'g' | 'ml';
  carbs_per_100: number; // Total Carbohydrate
  fat_per_100: number | null;
  fiber_per_100: number | null;
  protein_per_100: number | null;
  kcal_per_100: number | null;
  /** more label nutrients per 100 (all optional; null = not on the label, never zero) */
  sat_fat_per_100?: number | null; sugar_added_per_100?: number | null; sodium_mg_per_100?: number | null; calcium_mg_per_100?: number | null;
  iron_mg_per_100?: number | null; potassium_mg_per_100?: number | null; vit_d_ug_per_100?: number | null;
  /** food group when the category's default is wrong (e.g. water among drinks) */
  food_group?: string | null;
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
  alert_fall_rate: number | null;    // mg/dL per minute
  alert_rise_rate: number | null;    // mg/dL per minute
  alert_predict_low_min: number | null;
  night_start: string | null; night_end: string | null;
  night_low_mgdl: number | null; night_high_mgdl: number | null;
  night_high_silent: boolean; night_theme: boolean;
  school_days: number[]; school_start: string | null; school_end: string | null;
  school_low_mgdl: number | null; school_high_mgdl: number | null;
  escalate_min: number;
  /** display-only IOB / COB, from the care team; null = off */
  iob_dia_min: number | null; iob_peak_min: number | null; cob_absorb_min: number | null;
  plan_review_rules?: Record<string, unknown> | null;
  /** the doctor's carb ratio and correction factor by time of day; empty = no estimate */
  ratios: Ratio[];
  sensor_days: 14 | 15;
  /** dose calculator: the doctor's correction target range (mg/dL), pen step, minimum minutes between rapid doses */
  target_mgdl: number | null; target_high_mgdl: number | null;
  pen_step: number; dose_gap_min: number;
  /** the insulin brands, for clinical reports */
  rapid_insulin: string | null; basal_insulin: string | null;
  /** growth & nutrition: the child's profile for the WHO and energy references, and the dietitian's targets */
  child_birth_date?: string | null; child_birth_approx?: boolean; child_sex?: 'female' | 'male' | null;
  activity_level?: 'inactive' | 'low_active' | 'active' | 'very_active' | null;
  nutrition_targets?: import('../engine/nutrition').Targets;
  /** care team: minutes between the rapid dose and eating (planned meals' eat time); null = eat right after */
  dose_to_meal_min?: number | null;
}

/** One item of a planned meal: what a recipe ingredient holds, recomputed from the products when it is checked. */
export type PlanItem = Pick<Ingredient, 'product_id' | 'slot_category' | 'label' | 'quantity' | 'unit' | 'state' | 'role'>;
export interface PlannedMeal {
  id: string; for_date: string; slot: 'breakfast' | 'lunch' | 'dinner' | 'snack'; name: string; recipe_id: string | null;
  items: PlanItem[]; dose_at: string; eat_after_min: number; remind_min: number;
  status: 'planned' | 'dosed' | 'eaten' | 'skipped';
  dose_event_id: string | null; treatment_event_id: string | null; history_id: string | null;
  recheck_at: string | null; dosed_at: string | null; eaten_at: string | null; note: string | null; created_by: string | null;
  // the permanent record (plan → what happened → review → what we learned)
  calc_units?: number | null; given_units?: number | null; dose_reason?: string | null; dose_snapshot?: DoseSnapshot | null;
  eating_at?: string | null; part_eaten?: number | null; carbs_planned?: number | null; carbs_eaten?: number | null;
  review?: Record<string, unknown> | null; review_note?: string | null; reviewed_at?: string | null; reviewed_by?: string | null;
}
/** Everything the doctor's-settings calculation used at approval, kept with the plan. */
export interface DoseSnapshot extends DoseCalc { at: string; level: number | null; reading_at: string | null; dia_min: number | null; peak_min: number | null; pen_step: number }

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
  /** more nutrients, each null when an ingredient's label lacks it */
  total_sat_fat?: number | null; total_sugar_added?: number | null; total_sodium?: number | null; total_calcium?: number | null;
  total_iron?: number | null; total_potassium?: number | null; total_vit_d?: number | null;
  modified: boolean;
  glucose_mgdl: number | null;
  glucose_trend: number | null;
  glucose_at: string | null;
  lines: HistoryLine[];
  notes: string | null;
  /** imported from another app (e.g. 'gluroo'); needs_review: next to an entry the parents have not decided on */
  source?: string | null; needs_review?: boolean;
  /** the maker, e.g. KDD, so the family can find all of one brand's products */
  brand?: string | null;
  /** a photo of the food kept for reference, to re-estimate the carbs later (carb-photos path) */
  photo_path?: string | null;
  edited_at?: string | null; edited_by?: string | null;
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
  alert_fall_rate: null,
  alert_rise_rate: null,
  alert_predict_low_min: null,
  night_start: null, night_end: null, night_low_mgdl: null, night_high_mgdl: null, night_high_silent: false, night_theme: true,
  school_days: [0, 1, 2, 3, 4], school_start: null, school_end: null, school_low_mgdl: null, school_high_mgdl: null,
  escalate_min: 10,
  iob_dia_min: null, iob_peak_min: null, cob_absorb_min: null,
  ratios: [], sensor_days: 14,
  target_mgdl: null, target_high_mgdl: null, pen_step: 1, dose_gap_min: 120,
  rapid_insulin: null, basal_insulin: null,
};

export type AlertKind = 'urgent_low' | 'low' | 'predicted_low' | 'high' | 'no_data' | 'rapid_fall' | 'rapid_rise';
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

export type EventKind = 'insulin' | 'carbs' | 'treatment' | 'note' | 'exercise' | 'sleep' | 'bg_check';
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
  /** what the dose calculator showed when this dose was logged from it */
  dose_calc?: DoseCalc | null;
  /** finger-prick value (kind bg_check), mg/dL */
  bg_mgdl?: number | null;
  /** where an imported entry came from (e.g. 'gluroo'); null when logged in the app */
  source?: string | null;
  edited_at?: string | null; edited_by?: string | null;
  ends_at?: string | null;
  created_by: string;
  deleted_at: string | null;
}
export interface Member { user_id: string; display_name: string | null; alert_role?: 'primary' | 'backup' | 'off' }
