-- 1. Every imported entry kept as it was in the export, with the importer's decision (reversible by a parent).
create table carb.import_entries (
  id          uuid primary key default gen_random_uuid(),
  source      text not null,                         -- 'gluroo'
  source_key  text not null,                         -- stable per export row
  occurred_at timestamptz not null,
  entry_type  text not null,                         -- ANNOUNCE_MEAL, DOSE_INSULIN, BGL_FP_READING, …
  sender      text,
  raw         jsonb not null,                        -- the row exactly as exported
  food_key    text, food_name text, carbs numeric, units numeric,
  status      text not null check (status in ('accepted','probable_duplicate','replaced','low_treatment','uncertain','info')),
  reason      text,                                  -- why the importer decided this (plain words)
  related_key text,                                  -- the entry it duplicates or that replaced it
  decided_by  text not null default 'importer' check (decided_by in ('importer','parent')),
  decided_at  timestamptz not null default now(),
  unique (source, source_key)
);
create index import_entries_time on carb.import_entries (occurred_at);
alter table carb.import_entries enable row level security;
create policy import_entries_members on carb.import_entries for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update on carb.import_entries to authenticated;

-- 2. Sensors: one row per Libre sensor, so accuracy can be kept per sensor and compared over time.
create table carb.sensors (
  sn         text primary key,
  started_at timestamptz not null,
  days       int,
  source     text,
  created_at timestamptz not null default now()
);
alter table carb.sensors enable row level security;
create policy sensors_members on carb.sensors for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update on carb.sensors to authenticated;

-- 3. Finger-prick vs sensor: one comparison per finger-prick entry, filled in as the later readings arrive.
create table carb.bg_comparisons (
  event_id          uuid primary key references carb.events(id) on delete cascade,
  taken_at          timestamptz not null,
  bg_mgdl           int not null,
  entered_late_min  int,                -- minutes between the test and when it was logged
  hands_clean       boolean,
  libre_now         int, libre_now_at timestamptz,
  libre_5           int, libre_10 int,
  app_est           int,                -- the app's fitted value at that moment
  arrow             smallint,           -- Libre's arrow then (1–5)
  rate              numeric,            -- mg/dL per minute (fitted)
  state             text check (state in ('stable','rising','falling','unknown')),
  diff_mgdl         int,                -- Libre now − finger-prick
  diff_pct          numeric,
  best              text check (best in ('now','plus5','plus10')),
  best_diff_mgdl    int,
  sensor_sn         text references carb.sensors(sn),
  sensor_day        int,                -- 1 = first day
  since_meal_min    int, since_insulin_min int,
  night             boolean,
  quality           text check (quality in ('good','fair','poor')),
  cause             text check (cause in ('agrees','sensor_bias','cgm_lag','rapid_change','compression','insufficient')),
  complete          boolean not null default false,  -- the +10 min reading is in
  computed_at       timestamptz not null default now()
);
alter table carb.bg_comparisons enable row level security;
create policy bg_comparisons_members on carb.bg_comparisons for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update, delete on carb.bg_comparisons to authenticated;

-- the sensor in use now (from LibreLinkUp), and the one in the Gluroo export
insert into carb.sensors (sn, started_at, days, source)
select sensor_sn, sensor_started_at, 14, 'librelinkup' from carb.cgm_state where sensor_sn is not null and sensor_started_at is not null
on conflict (sn) do nothing;
