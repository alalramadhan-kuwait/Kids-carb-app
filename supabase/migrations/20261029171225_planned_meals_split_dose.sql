-- A meal dose given in two parts: the part now is the plan's dose event; the later part (units and time chosen by the
-- parent, never by the app) is remembered here so both phones show it and the server reminds them when it is due.
alter table carb.planned_meals
  add column if not exists split_units numeric,
  add column if not exists split_at timestamptz,
  add column if not exists split_event_id uuid,
  add column if not exists split_done_at timestamptz;
comment on column carb.planned_meals.split_units is 'Later part of a split meal dose, units as the parent entered them';
comment on column carb.planned_meals.split_at is 'When the later part is due (parent''s choice)';
comment on column carb.planned_meals.split_event_id is 'The insulin event recorded for the later part';
comment on column carb.planned_meals.split_done_at is 'When the later part was recorded or dismissed';
