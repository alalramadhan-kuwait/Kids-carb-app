-- Meal plans become a permanent record: plan -> what happened -> review -> what we learned.
alter table carb.planned_meals
  add column if not exists calc_units numeric,          -- the doctor's-settings dose shown at approval
  add column if not exists given_units numeric,         -- the dose the parent decided to give
  add column if not exists dose_reason text,            -- why it differs, if they said
  add column if not exists dose_snapshot jsonb,         -- glucose, trend, active insulin, ICR, ISF, target, insulin duration at approval
  add column if not exists eating_at timestamptz,       -- when she started eating
  add column if not exists part_eaten numeric,          -- 1, 0.75, 0.5, 0.25
  add column if not exists carbs_planned numeric,
  add column if not exists carbs_eaten numeric,
  add column if not exists review jsonb,                -- the latest computed review (outcome, numbers), kept for history, patterns and reports
  add column if not exists review_note text,            -- what the parent learned / wants to watch next time
  add column if not exists reviewed_at timestamptz,
  add column if not exists reviewed_by uuid;

alter table carb.planned_meals drop constraint if exists planned_meals_part_eaten_check;
alter table carb.planned_meals add constraint planned_meals_part_eaten_check check (part_eaten is null or (part_eaten > 0 and part_eaten <= 2));

create index if not exists planned_meals_history_idx on carb.planned_meals (status, eating_at desc);

-- the review rules, kept in the database so they can be tuned after seeing real data
alter table carb.settings add column if not exists plan_review_rules jsonb not null default '{
  "early_min": 120,
  "min_clean_min": 120,
  "small_food_g": 5,
  "high_min": 30,
  "very_high_mgdl": 250,
  "very_low_mgdl": 54,
  "low_min": 10,
  "coverage_high": 0.9,
  "early_rise_mgdl": 36,
  "early_rise_min": 30,
  "late_rise_mgdl": 30,
  "comparable": { "carbs_pct": 25, "start_mmol": 2.0, "iob_u": 0.5, "min_part": 0.75 },
  "pattern_min": 3
}'::jsonb;
