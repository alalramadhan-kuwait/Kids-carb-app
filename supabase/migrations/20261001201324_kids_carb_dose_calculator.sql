-- Dose calculator (parents' decision, 2026-10-01): target from the doctor, pen step, minimum time between rapid doses.
alter table carb.settings
  add column target_mgdl  int check (target_mgdl between 70 and 200),             -- empty = calculator off
  add column pen_step     numeric not null default 1 check (pen_step in (0.5, 1)),
  add column dose_gap_min int not null default 120 check (dose_gap_min between 0 and 360);

-- what the calculator showed when a dose was logged from it: the inputs and the suggestion, next to what was given
alter table carb.events
  add column dose_calc jsonb;
