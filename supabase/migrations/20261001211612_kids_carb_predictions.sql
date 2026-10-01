-- Prediction tracking: the estimate made at the start of a meal (or a correction) is frozen, then compared with
-- the sensor at 1 h, 2 h and the end, so the family can see how far off it usually is and why.
create table carb.predictions (
  id         uuid primary key default gen_random_uuid(),
  key        text not null unique,                 -- 'h:<meal_history id>' or 'e:<event id>': one per meal or dose
  t0         timestamptz not null,                 -- start of the meal or dose
  name       text,
  recipe_id  uuid,
  carbs      numeric not null default 0,           -- grams in the plan (entries up to 15 min after t0)
  units      numeric not null default 0,           -- rapid units in the plan
  start_mg   int not null,
  params     jsonb not null,                       -- {cr, isf, dia, peak, absorb, onboard_iob, onboard_cob}
  curve      jsonb not null,                       -- predicted mg/dL every 15 min from t0
  end_min    int not null,
  checks     jsonb not null default '{}'::jsonb,   -- {"60": {"pred", "actual"} | {"skip": reason}, "120": …, "end": …}
  excluded   text,                                 -- why it does not count toward accuracy (e.g. sensor's first day)
  done       boolean not null default false,
  created_at timestamptz not null default now()
);
create index predictions_t0 on carb.predictions (t0 desc);
alter table carb.predictions enable row level security;
create policy predictions_members on carb.predictions for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update on carb.predictions to authenticated;
