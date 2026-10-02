-- Importing from other apps (Gluroo first), finger-prick checks, and one-tap quick items.

-- 1. imports: where an entry came from, and a key so the same export can be imported twice without doubling
alter table carb.meal_history add column source text, add column source_key text unique;
alter table carb.events add column source text;

-- 2. finger-prick checks as their own event kind (the model can compare them with the sensor)
alter table carb.events drop constraint events_kind_check;
alter table carb.events add constraint events_kind_check
  check (kind = any (array['insulin','carbs','treatment','note','exercise','sleep','bg_check']));
alter table carb.events add column bg_mgdl int check (bg_mgdl between 20 and 600);
alter table carb.events add constraint events_bg_check_value check (kind <> 'bg_check' or bg_mgdl is not null);

-- 3. quick items: foods she has often, logged with one tap (carbs as the family logs them)
create table carb.quick_items (
  id         uuid primary key default gen_random_uuid(),
  name       text not null,
  carbs      numeric not null check (carbs >= 0 and carbs < 300),
  fat        numeric check (fat >= 0),
  protein    numeric check (protein >= 0),
  kcal       numeric check (kcal >= 0),
  kind       text not null default 'snack' check (kind in ('meal','snack','treatment')),
  barcode    text,
  note       text,
  source     text,
  uses       int not null default 0,
  last_used  timestamptz,
  created_at timestamptz not null default now(),
  unique (name)
);
alter table carb.quick_items enable row level security;
create policy quick_items_members on carb.quick_items for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update, delete on carb.quick_items to authenticated;
