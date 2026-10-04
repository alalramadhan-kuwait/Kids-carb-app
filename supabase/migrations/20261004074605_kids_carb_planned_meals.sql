-- Planned meals (2026-10-04): a meal prepared ahead (e.g. breakfast planned at 10 pm) with a dose time and an eat time,
-- kept ON HOLD until a parent approves the dose and confirms she ate. A plan never feeds insulin/carbs on board,
-- predictions, nutrition or research: only the dose, meal and treatment entries it creates do, when they are logged.
-- The care team's minutes between rapid insulin and eating live in settings.

create table carb.planned_meals (
  id             uuid primary key default gen_random_uuid(),
  for_date       date not null,
  slot           text not null check (slot in ('breakfast','lunch','dinner','snack')),
  name           text not null,
  recipe_id      uuid references carb.recipes(id) on delete set null,
  items          jsonb not null default '[]'::jsonb,    -- ingredient drafts: product_id / slot_category, quantity, unit, state, role, label
  dose_at        timestamptz not null,                   -- planned time of the rapid dose
  eat_after_min  int not null default 10 check (eat_after_min between 0 and 60),
  remind_min     int not null default 10 check (remind_min between 0 and 60),  -- the check reminder, minutes before dose_at
  status         text not null default 'planned' check (status in ('planned','dosed','eaten','skipped')),
  dose_event_id  uuid,                                   -- the rapid dose it logged
  treatment_event_id uuid,                               -- a low treated from the plan (e.g. its juice)
  history_id     uuid,                                   -- the meal it logged
  recheck_at     timestamptz,                            -- after a treatment: when to check again
  dosed_at       timestamptz,
  eaten_at       timestamptz,
  notified       jsonb not null default '{}'::jsonb,     -- which reminders went out (check / eat / recheck)
  note           text,
  created_by     uuid default auth.uid(),
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now()
);
create index planned_meals_open on carb.planned_meals (dose_at) where status in ('planned','dosed');
alter table carb.planned_meals enable row level security;
create policy planned_meals_members on carb.planned_meals for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update, delete on carb.planned_meals to authenticated;
alter publication supabase_realtime add table carb.planned_meals;

alter table carb.settings add column dose_to_meal_min int check (dose_to_meal_min between 0 and 60);
