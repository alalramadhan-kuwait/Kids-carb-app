-- Mom mode: portions in household measures, saved meals, a simple mode per person, injection sites.
create table if not exists carb.portions (
  id uuid primary key default gen_random_uuid(),
  product_id uuid references carb.products(id) on delete cascade,
  recipe_id uuid references carb.recipes(id) on delete cascade,
  label text not null check (length(trim(label)) between 1 and 60),
  amount numeric not null check (amount > 0 and amount <= 3000),   -- g or ml of a product; for a recipe, how many of its plates
  photo_path text,
  sort int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  check ((product_id is null) <> (recipe_id is null))
);
create index if not exists portions_product on carb.portions(product_id);
create index if not exists portions_recipe on carb.portions(recipe_id);
alter table carb.portions enable row level security;
create policy portions_members on carb.portions for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update, delete on carb.portions to authenticated;

create table if not exists carb.saved_meals (
  id uuid primary key default gen_random_uuid(),
  name text not null check (length(trim(name)) between 1 and 60),
  emoji text,
  items jsonb not null default '[]',     -- [{kind:'product'|'recipe', id, portion_id}] — carbs always recomputed
  sort int not null default 0,
  created_by uuid default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
alter table carb.saved_meals enable row level security;
create policy saved_meals_members on carb.saved_meals for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update, delete on carb.saved_meals to authenticated;

alter table carb.members add column if not exists simple_mode boolean not null default false;
create or replace function carb.set_simple_mode(p_user uuid, p_on boolean) returns void
language plpgsql security definer set search_path to '' as $$
begin
  if not carb.is_member() then raise exception 'not allowed'; end if;
  update carb.members set simple_mode = p_on where user_id = p_user;
end $$;
grant execute on function carb.set_simple_mode(uuid, boolean) to authenticated;

alter table carb.events add column if not exists injection_site text
  check (injection_site in ('belly_r','belly_l','thigh_r','thigh_l','arm_r','arm_l','buttock_r','buttock_l'));
alter table carb.settings add column if not exists injection_sites jsonb not null
  default '{"rapid":["belly_r","belly_l","thigh_r","thigh_l","arm_r","arm_l"],"long":["belly_r","belly_l","thigh_r","thigh_l","arm_r","arm_l"]}';

alter publication supabase_realtime add table carb.portions, carb.saved_meals;
