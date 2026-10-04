-- Growth & nutrition (2026-10-04): weight and height history, the child's profile for the references (birth date,
-- sex, activity), the dietitian's targets, more label nutrients on products (all optional), their totals on logged
-- meals (null = some ingredient's label did not give it; never zero), and a food-group override per product.
-- The measurements themselves are entered in the app, never in a migration.

-- 1. Measurements, kept as entered; either value may be missing (weigh at home, measure height at the clinic).
create table carb.growth_measurements (
  id          uuid primary key default gen_random_uuid(),
  measured_on date not null,
  weight_kg   numeric(5,2) check (weight_kg between 5 and 150),
  height_cm   numeric(5,1) check (height_cm between 50 and 220),
  place       text check (place in ('home','clinic')),
  note        text,
  created_by  uuid default auth.uid(),
  created_at  timestamptz not null default now(),
  updated_at  timestamptz not null default now(),
  check (weight_kg is not null or height_cm is not null)
);
create index growth_measurements_on on carb.growth_measurements (measured_on);
alter table carb.growth_measurements enable row level security;
create policy growth_measurements_members on carb.growth_measurements for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update, delete on carb.growth_measurements to authenticated;

-- 2. The profile behind the references, and the dietitian's targets (any key replaces the general reference).
alter table carb.settings
  add column child_birth_date   date,
  add column child_birth_approx boolean not null default true,
  add column child_sex          text check (child_sex in ('female','male')),
  add column activity_level     text check (activity_level in ('inactive','low_active','active','very_active')),
  add column nutrition_targets  jsonb not null default '{}'::jsonb;

-- 3. More label nutrients per 100 g / ml (optional), and a food group when the category's default is wrong.
alter table carb.products
  add column sat_fat_per_100     numeric check (sat_fat_per_100 >= 0),
  add column sugar_added_per_100 numeric check (sugar_added_per_100 >= 0),
  add column sodium_mg_per_100   numeric check (sodium_mg_per_100 >= 0),
  add column calcium_mg_per_100  numeric check (calcium_mg_per_100 >= 0),
  add column iron_mg_per_100     numeric check (iron_mg_per_100 >= 0),
  add column potassium_mg_per_100 numeric check (potassium_mg_per_100 >= 0),
  add column vit_d_ug_per_100    numeric check (vit_d_ug_per_100 >= 0),
  add column food_group          text check (food_group in ('vegetables','fruit','grains','protein','dairy','legumes_nuts','extras','fats','mixed'));

-- 4. Their totals on each logged meal: null when any ingredient's label lacks it.
alter table carb.meal_history
  add column total_sat_fat     numeric,
  add column total_sugar_added numeric,
  add column total_sodium      numeric,
  add column total_calcium     numeric,
  add column total_iron        numeric,
  add column total_potassium   numeric,
  add column total_vit_d       numeric;
