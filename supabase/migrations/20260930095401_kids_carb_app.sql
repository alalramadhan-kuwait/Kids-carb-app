-- Kids carb app: everything lives in its own schema `carb`.
-- No foreign keys into the manpower tables in `public`; the only link to the
-- rest of the project is auth.users (members.user_id), and access is decided
-- by carb.members alone, so a login that belongs to the other app sees nothing.

create schema if not exists carb;
revoke all on schema carb from public, anon;
grant usage on schema carb to authenticated;

-- ── who may use the app ─────────────────────────────────────────────────────
create table carb.members (
  user_id      uuid primary key references auth.users(id) on delete cascade,
  display_name text,
  created_at   timestamptz not null default now()
);

-- one-row table holding the hash of the setup code that lets the first parent in
create table carb.setup (
  id        boolean primary key default true check (id),
  code_hash text not null
);
insert into carb.setup (id, code_hash)
values (true, '44dc2e08a50bf58eb9bd63ab3125601387478e2256927ff8732cac1ab928bac3');

create function carb.is_member() returns boolean
language sql stable security definer set search_path = '' as $$
  select exists (select 1 from carb.members where user_id = (select auth.uid()))
$$;

create function carb.claim_household(p_code text, p_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if (select auth.uid()) is null then raise exception 'not signed in'; end if;
  if exists (select 1 from carb.members) then raise exception 'already set up'; end if;
  if encode(extensions.digest(coalesce(p_code, ''), 'sha256'), 'hex')
       <> (select code_hash from carb.setup) then
    raise exception 'wrong setup code';
  end if;
  insert into carb.members (user_id, display_name) values ((select auth.uid()), p_name);
end $$;

create function carb.add_member_by_email(p_email text, p_name text default null) returns void
language plpgsql security definer set search_path = '' as $$
declare uid uuid;
begin
  if not carb.is_member() then raise exception 'not allowed'; end if;
  select id into uid from auth.users where lower(email) = lower(trim(p_email));
  if uid is null then raise exception 'no account with that email yet'; end if;
  insert into carb.members (user_id, display_name) values (uid, p_name)
  on conflict (user_id) do nothing;
end $$;

revoke all on function carb.is_member(), carb.claim_household(text, text),
  carb.add_member_by_email(text, text) from public, anon;
grant execute on function carb.is_member(), carb.claim_household(text, text),
  carb.add_member_by_email(text, text) to authenticated;

-- ── settings (every number the rules use is editable) ───────────────────────
create table carb.settings (
  id               boolean primary key default true check (id),
  max_meal_carbs   numeric not null default 60 check (max_meal_carbs > 0),
  preferred_min    numeric not null default 40,
  preferred_max    numeric not null default 55,
  tbsp_size        numeric not null default 15 check (tbsp_size > 0),
  category_targets jsonb   not null default '[]'::jsonb,
  updated_at       timestamptz not null default now()
);

-- ── products ────────────────────────────────────────────────────────────────
create table carb.products (
  id               uuid primary key default gen_random_uuid(),
  name             text not null,
  brand            text,
  category         text not null,
  kind             text not null default 'commercial' check (kind in ('natural', 'commercial')),
  image_path       text,
  pack_size        numeric check (pack_size > 0),
  unit             text not null default 'g' check (unit in ('g', 'ml')),
  carbs_per_100    numeric not null check (carbs_per_100 >= 0),   -- Total Carbohydrate
  fat_per_100      numeric check (fat_per_100 >= 0),
  fiber_per_100    numeric check (fiber_per_100 >= 0),
  protein_per_100  numeric check (protein_per_100 >= 0),
  kcal_per_100     numeric check (kcal_per_100 >= 0),
  serving_size     numeric check (serving_size > 0),              -- also what "1 piece" means
  carbs_per_serving numeric check (carbs_per_serving >= 0),
  label_basis      text not null default 'as_sold' check (label_basis in ('as_sold', 'cooked')),
  cooked_yield     numeric check (cooked_yield > 0),              -- cooked g per 1 g as sold (pasta, rice)
  available        boolean not null default false,                -- in the pantry now
  approved         boolean not null default false,
  label_updated_at date not null default current_date,
  notes            text,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now()
);
create index products_category_idx on carb.products (category);

-- ── recipes ─────────────────────────────────────────────────────────────────
create table carb.recipes (
  id                uuid primary key default gen_random_uuid(),
  name              text not null,
  category          text,
  image_path        text,
  instructions      text,
  notes             text,
  approved          boolean not null default false,
  favorite          boolean not null default false,
  carb_pending      boolean not null default false,  -- carbs known to be incomplete (e.g. pot sauce not yet worked out)
  pending_note      text,
  saved_total_carbs numeric,                          -- last total the parents accepted; drives Previous / New
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);

create table carb.recipe_ingredients (
  id             uuid primary key default gen_random_uuid(),
  recipe_id      uuid not null references carb.recipes(id) on delete cascade,
  role           text not null default 'main' check (role in ('main', 'drink', 'snack')),
  product_id     uuid references carb.products(id) on delete set null,
  slot_category  text,          -- "any registered product of this category" (prefers what is in the pantry)
  label          text,
  quantity       numeric not null check (quantity > 0),
  unit           text not null default 'g' check (unit in ('g', 'ml', 'serving', 'tbsp')),
  state          text not null default 'as_is' check (state in ('raw', 'cooked', 'as_is')),
  qty_confirmed  boolean not null default true,   -- false = starting amount nobody has confirmed yet
  note           text,
  sort           int not null default 0,
  check (product_id is not null or slot_category is not null)
);
create index recipe_ingredients_recipe_idx on carb.recipe_ingredients (recipe_id);

create table carb.recipe_versions (
  id          uuid primary key default gen_random_uuid(),
  recipe_id   uuid not null references carb.recipes(id) on delete cascade,
  total_carbs numeric,
  snapshot    jsonb not null,
  created_at  timestamptz not null default now()
);
create index recipe_versions_recipe_idx on carb.recipe_versions (recipe_id, created_at desc);

-- ── snacks ──────────────────────────────────────────────────────────────────
create table carb.snacks (
  id            uuid primary key default gen_random_uuid(),
  name          text not null,
  image_path    text,
  product_id    uuid references carb.products(id) on delete set null,
  slot_category text,
  quantity      numeric not null check (quantity > 0),
  unit          text not null default 'g' check (unit in ('g', 'ml', 'serving', 'tbsp')),
  state         text not null default 'as_is' check (state in ('raw', 'cooked', 'as_is')),
  qty_confirmed boolean not null default true,
  note          text,
  created_at    timestamptz not null default now(),
  check (product_id is not null or slot_category is not null)
);

-- ── history & plan ──────────────────────────────────────────────────────────
create table carb.meal_history (
  id            uuid primary key default gen_random_uuid(),
  kind          text not null default 'meal' check (kind in ('meal', 'snack')),
  recipe_id     uuid references carb.recipes(id) on delete set null,
  name          text not null,
  category      text,
  eaten_at      timestamptz not null default now(),
  total_carbs   numeric not null,
  total_fat     numeric,
  total_fiber   numeric,
  total_protein numeric,
  total_kcal    numeric,
  modified      boolean not null default false,
  lines         jsonb not null default '[]'::jsonb,   -- what was actually used, frozen at the time
  notes         text,
  created_by    uuid default auth.uid()
);
create index meal_history_eaten_idx on carb.meal_history (eaten_at desc);

create table carb.meal_plan (
  id         uuid primary key default gen_random_uuid(),
  plan_date  date not null,
  recipe_id  uuid not null references carb.recipes(id) on delete cascade,
  people     int not null default 1 check (people >= 1),
  created_at timestamptz not null default now(),
  unique (plan_date, recipe_id)
);

-- ── access: members only, on every table ────────────────────────────────────
do $$
declare t text;
begin
  foreach t in array array['settings', 'products', 'recipes', 'recipe_ingredients',
    'recipe_versions', 'snacks', 'meal_history', 'meal_plan'] loop
    execute format('alter table carb.%I enable row level security', t);
    execute format('create policy %I on carb.%I for all to authenticated using (carb.is_member()) with check (carb.is_member())',
      t || '_members', t);
    execute format('grant select, insert, update, delete on carb.%I to authenticated', t);
  end loop;
end $$;

alter table carb.members enable row level security;
create policy members_read on carb.members for select to authenticated using (carb.is_member());
grant select on carb.members to authenticated;
alter table carb.setup enable row level security;   -- no policy, no grant: functions only

-- ── photos ──────────────────────────────────────────────────────────────────
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('carb-photos', 'carb-photos', true, 2097152, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do nothing;

create policy carb_photos_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'carb-photos' and carb.is_member());
create policy carb_photos_update on storage.objects for update to authenticated
  using (bucket_id = 'carb-photos' and carb.is_member());
create policy carb_photos_delete on storage.objects for delete to authenticated
  using (bucket_id = 'carb-photos' and carb.is_member());

-- ── seed data ───────────────────────────────────────────────────────────────
-- Natural foods carry reference values (editable). Commercial products are NOT
-- seeded: recipes point at a category and stay incomplete until the label of a
-- real product is entered. The one exception is the yoghurt drink, entered as
-- unapproved because the 4 g/100 ml came from memory, not from a label.
do $$
declare rid uuid;
begin
  insert into carb.settings (id, category_targets) values (true, '[
    {"category":"ناجت","basis":"per100","max":15},
    {"category":"بطاط مجمد","basis":"per100","max":30},
    {"category":"توست","basis":"serving","max":14},
    {"category":"صمون","basis":"serving","max":30}
  ]'::jsonb);

  insert into carb.products (name, category, kind, unit, carbs_per_100, fat_per_100, fiber_per_100,
                             protein_per_100, kcal_per_100, serving_size, label_basis, approved, available, notes) values
    ('أرز أبيض مطبوخ', 'نشويات',      'natural', 'g', 28.2, 0.3, 0.4, 2.7, 130, null, 'cooked', true, true, 'قيمة مرجعية. الوزن بعد الطبخ.'),
    ('بطاط مسلوق',     'نشويات',      'natural', 'g', 20.1, 0.1, 1.8, 1.9,  87, null, 'cooked', true, true, 'قيمة مرجعية.'),
    ('بيض',            'بيض',         'natural', 'g',  0.7, 9.5, 0.0, 12.6, 143, 50,   'as_sold', true, true, 'قيمة مرجعية. الحصة = بيضة واحدة تقريبًا.'),
    ('دجاج مطبوخ',     'لحوم ودجاج',  'natural', 'g',  0.0, 7.2, 0.0, 28.5, 187, null, 'cooked', true, true, 'قيمة مرجعية (خليط صدر وفخذ بدون جلد).'),
    ('لحم مفروم مطبوخ','لحوم ودجاج',  'natural', 'g',  0.0, 15.0, 0.0, 26.0, 250, null, 'cooked', true, true, 'قيمة مرجعية.'),
    ('تفاح',           'فواكه',       'natural', 'g', 13.8, 0.2, 2.4, 0.3,  52, null, 'as_sold', true, true, 'قيمة مرجعية.'),
    ('فراولة',         'فواكه',       'natural', 'g',  7.7, 0.3, 2.0, 0.7,  32, null, 'as_sold', true, true, 'قيمة مرجعية.'),
    ('موز',            'فواكه',       'natural', 'g', 22.8, 0.3, 2.6, 1.1,  89, null, 'as_sold', true, true, 'قيمة مرجعية.'),
    ('بصل',            'خضار',        'natural', 'g',  9.3, 0.1, 1.7, 1.1,  40, null, 'as_sold', true, true, 'قيمة مرجعية.'),
    ('طماط',           'خضار',        'natural', 'g',  3.9, 0.2, 1.2, 0.9,  18, null, 'as_sold', true, true, 'قيمة مرجعية.');

  insert into carb.products (name, category, kind, unit, carbs_per_100, approved, available, notes)
  values ('لبن (المنتج الحالي — حدّث الاسم من الملصق)', 'لبن', 'commercial', 'ml', 4, false, true,
          'الرقم 4غ/100مل ذكرته الأم ولم يؤخذ من الملصق بعد. أدخل الملصق ثم اعتمده.');

  -- 1
  insert into carb.recipes (name, category, approved, carb_pending, pending_note, instructions, notes)
  values ('مرق دجاج كويتي مع عيش', 'دجاج', true, true,
    'الكارب هنا لا يشمل صلصة المرق (معجون الطماط والبصل والطماط). أدخل وصفة القدر كاملة ثم أزل هذا التنبيه.',
    E'١. يُقلّى البصل ثم يُضاف الدجاج والبهارات الكويتية.\n٢. يُضاف الطماط ومعجون الطماط والماء ويُترك حتى ينضج.\n٣. يُضاف البطاط ويُطهى حتى يطرى.\n٤. يُقدَّم فوق الأرز المطبوخ.',
    'الهدف الأولي 53–55غ كارب.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, product_id, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', (select id from carb.products where name = 'أرز أبيض مطبوخ'), 140, 'g', 'cooked', true, null, 1),
    (rid, 'main', (select id from carb.products where name = 'بطاط مسلوق'), 50, 'g', 'cooked', true, 'بطاط داخل المرق', 2),
    (rid, 'main', (select id from carb.products where name = 'دجاج مطبوخ'), 90, 'g', 'cooked', true, '80–100غ', 3),
    (rid, 'main', (select id from carb.products where name = 'بصل'), 30, 'g', 'raw', false, 'كمية مبدئية', 4),
    (rid, 'main', (select id from carb.products where name = 'طماط'), 50, 'g', 'raw', false, 'كمية مبدئية', 5);

  -- 2
  insert into carb.recipes (name, category, approved, instructions, notes)
  values ('توست أبيض مع بيض وجبن', 'فطور', true,
    E'١. يُحمّص التوست.\n٢. يُسلق البيض أو يُقلى.\n٣. تُوضع شريحة الجبن مع التوست.',
    'الهدف الأولي ≈40غ كارب مع سناك التفاح. الكارب النهائي يعتمد على التوست والجبن المسجّلين.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', 'توست', 'توست أبيض', 2, 'serving', 'as_is', true, '2 شريحة', 1);
  insert into carb.recipe_ingredients (recipe_id, role, product_id, quantity, unit, state, sort) values
    (rid, 'main', (select id from carb.products where name = 'بيض'), 100, 'g', 'as_is', 2);
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', 'جبن', 'جبن', 20, 'g', 'as_is', false, 'كمية مبدئية', 3);
  insert into carb.recipe_ingredients (recipe_id, role, product_id, quantity, unit, state, note, sort) values
    (rid, 'snack', (select id from carb.products where name = 'تفاح'), 100, 'g', 'as_is', 'سناك', 4);

  -- 3
  insert into carb.recipes (name, category, approved, instructions, notes)
  values ('باستا باللحم المفروم', 'باستا', true,
    E'١. تُسلق الباستا وتُوزن بعد الطبخ.\n٢. يُطهى اللحم المفروم مع صلصة الطماط.\n٣. تُقدَّم مع الروب اليوناني.',
    'الهدف الأولي 45–50غ كارب. الحساب النهائي يعتمد على نوع الباستا والصلصة والروب.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, note, sort) values
    (rid, 'main', 'باستا', 'باستا', 120, 'g', 'cooked', 'الوزن بعد الطبخ', 1);
  insert into carb.recipe_ingredients (recipe_id, role, product_id, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', (select id from carb.products where name = 'لحم مفروم مطبوخ'), 80, 'g', 'cooked', false, 'كمية مبدئية', 2);
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', 'صلصة', 'صلصة طماط', 80, 'g', 'as_is', false, 'كمية مبدئية', 3),
    (rid, 'main', 'روب', 'روب يوناني', 100, 'g', 'as_is', true, null, 4);

  -- 4
  insert into carb.recipes (name, category, approved, instructions, notes)
  values ('ناجت وبطاط Air Fryer', 'ناجت', true,
    E'١. يُرتَّب الناجت والبطاط المجمد في الـ Air Fryer.\n٢. يُطهى حسب تعليمات العبوة.',
    'الأوزان بحالة التجميد كما في العبوة. المنتجات المفضّلة: ناجت ≤15غ/100غ، بطاط ≤30غ/100غ.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', 'ناجت', 'Chicken Nuggets', 100, 'g', 'as_is', true, 'وزن مجمد', 1),
    (rid, 'main', 'بطاط مجمد', 'French Fries مجمد', 85, 'g', 'as_is', true, '80–90غ، وزن مجمد', 2);

  -- 5
  insert into carb.recipes (name, category, approved, carb_pending, pending_note, instructions, notes)
  values ('مجبوس دجاج كويتي', 'دجاج', true, true,
    'الكارب هنا لا يشمل بهارات وصلصة القدر. أدخل وصفة المجبوس كاملة (كارب القدر ثم الحصة) ثم أزل هذا التنبيه.',
    E'١. يُقلى البصل ثم يُضاف الدجاج وبهارات المجبوس.\n٢. يُضاف الطماط والماء ويُطهى.\n٣. يُطهى الأرز في المرق.',
    'الأرز المطبوخ ≈140غ للحصة.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, product_id, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', (select id from carb.products where name = 'أرز أبيض مطبوخ'), 140, 'g', 'cooked', true, null, 1),
    (rid, 'main', (select id from carb.products where name = 'دجاج مطبوخ'), 100, 'g', 'cooked', false, 'كمية مبدئية', 2),
    (rid, 'main', (select id from carb.products where name = 'بصل'), 50, 'g', 'raw', false, 'كمية مبدئية', 3),
    (rid, 'main', (select id from carb.products where name = 'طماط'), 40, 'g', 'raw', false, 'كمية مبدئية', 4);

  -- 5B
  insert into carb.recipes (name, category, approved, carb_pending, pending_note, instructions, notes)
  values ('مجبوس لحم كويتي', 'لحم', true, true,
    'الكارب هنا لا يشمل بهارات وصلصة القدر. أدخل وصفة المجبوس كاملة ثم أزل هذا التنبيه.',
    E'١. يُقلى البصل ثم يُضاف اللحم وبهارات المجبوس.\n٢. يُضاف الطماط والماء ويُطهى حتى ينضج.\n٣. يُطهى الأرز في المرق.',
    'الأرز المطبوخ 130–140غ، يُضبط بعد حساب وصفة المجبوس الكاملة.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, product_id, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', (select id from carb.products where name = 'أرز أبيض مطبوخ'), 135, 'g', 'cooked', true, '130–140غ', 1),
    (rid, 'main', (select id from carb.products where name = 'لحم مفروم مطبوخ'), 100, 'g', 'cooked', false, 'كمية مبدئية', 2),
    (rid, 'main', (select id from carb.products where name = 'بصل'), 50, 'g', 'raw', false, 'كمية مبدئية', 3),
    (rid, 'main', (select id from carb.products where name = 'طماط'), 40, 'g', 'raw', false, 'كمية مبدئية', 4);

  -- 6
  insert into carb.recipes (name, category, approved, instructions, notes)
  values ('برغر لحم مع بطاط', 'برغر', true,
    E'١. يُشوى البرغر وتُوضع عليه شريحة الجبن.\n٢. يُحمّص الصمون ويُدهن بالكاتشب والمايونيز.\n٣. يُقلى البطاط أو يُطهى في الـ Air Fryer.',
    'الهدف الأولي 50–58غ كارب. المايونيز والكاتشب والجبن تُحسب من ملصقاتها الفعلية.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', 'صمون', 'صمون برغر', 1, 'serving', 'as_is', true, 'صمونة كاملة', 1),
    (rid, 'main', 'برغر لحم', 'برغر لحم', 1, 'serving', 'as_is', false, 'كمية مبدئية', 2),
    (rid, 'main', 'جبن', 'شريحة جبن', 1, 'serving', 'as_is', false, 'شريحة واحدة', 3),
    (rid, 'main', 'كاتشب', 'كاتشب', 1, 'tbsp', 'as_is', true, null, 4),
    (rid, 'main', 'مايونيز', 'مايونيز', 1, 'tbsp', 'as_is', true, null, 5),
    (rid, 'main', 'بطاط مجمد', 'بطاط مقلي / Air Fryer', 70, 'g', 'as_is', true, 'وزن مجمد', 6);

  -- 7
  insert into carb.recipes (name, category, approved, carb_pending, pending_note, instructions, notes)
  values ('ملوخية مع عيش أبيض', 'دجاج', true, true,
    'مكونات الملوخية الفعلية لم تُسجَّل بعد. سجّلها (ملوخية، وأي إضافات) ثم أزل هذا التنبيه.',
    E'١. تُطهى الملوخية مع الثوم والكزبرة.\n٢. يُضاف الدجاج المطبوخ.\n٣. تُقدَّم مع الأرز المطبوخ.',
    'الهدف الأولي 40–45غ كارب.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, product_id, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', (select id from carb.products where name = 'أرز أبيض مطبوخ'), 120, 'g', 'cooked', true, null, 1),
    (rid, 'main', (select id from carb.products where name = 'دجاج مطبوخ'), 90, 'g', 'cooked', false, 'كمية مبدئية', 2);
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', 'ملوخية', 'ملوخية', 150, 'g', 'cooked', false, 'كمية مبدئية', 3);

  -- 8
  insert into carb.recipes (name, category, approved, instructions, notes)
  values ('سباغيتي باللحم المفروم', 'باستا', true,
    E'١. تُسلق السباغيتي وتُوزن بعد الطبخ.\n٢. يُطهى اللحم المفروم ثم تُضاف الصلصة الجاهزة.\n٣. تُخلط مع السباغيتي.',
    'الهدف أقل من 50غ تقريبًا مع هامش أمان. الصلصة من المنتج الفعلي المسجّل.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, note, sort) values
    (rid, 'main', 'باستا', 'سباغيتي', 120, 'g', 'cooked', 'الوزن بعد الطبخ', 1);
  insert into carb.recipe_ingredients (recipe_id, role, product_id, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', (select id from carb.products where name = 'لحم مفروم مطبوخ'), 80, 'g', 'cooked', false, 'كمية مبدئية', 2);
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', 'صلصة', 'صلصة باستا جاهزة', 100, 'g', 'as_is', false, 'كمية مبدئية', 3);

  -- 9
  insert into carb.recipes (name, category, approved, instructions, notes)
  values ('Chicken Alfredo Pasta', 'باستا', true,
    E'١. تُسلق الباستا وتُوزن بعد الطبخ.\n٢. يُطهى الدجاج ثم تُضاف كريمة الطبخ.\n٣. تُخلط مع الباستا. الجبن اختياري: أضفه كمكوّن إن استُخدم.',
    'الهدف الأولي 40–45غ كارب. الحساب النهائي حسب الباستا والكريمة والجبن المسجّلة.') returning id into rid;
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, note, sort) values
    (rid, 'main', 'باستا', 'باستا', 108, 'g', 'cooked', '105–110غ بعد الطبخ', 1);
  insert into carb.recipe_ingredients (recipe_id, role, product_id, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', (select id from carb.products where name = 'دجاج مطبوخ'), 80, 'g', 'cooked', false, 'كمية مبدئية', 2);
  insert into carb.recipe_ingredients (recipe_id, role, slot_category, label, quantity, unit, state, qty_confirmed, note, sort) values
    (rid, 'main', 'كريمة طبخ', 'كريمة طبخ', 50, 'ml', 'as_is', false, 'كمية مبدئية', 3);

  -- snacks
  insert into carb.snacks (name, product_id, slot_category, quantity, unit, qty_confirmed) values
    ('تفاح', (select id from carb.products where name = 'تفاح'), null, 100, 'g', true),
    ('فراولة', (select id from carb.products where name = 'فراولة'), null, 100, 'g', true),
    ('موز', (select id from carb.products where name = 'موز'), null, 100, 'g', true);
  insert into carb.snacks (name, slot_category, quantity, unit, qty_confirmed) values
    ('لبن', 'لبن', 200, 'ml', false),
    ('روب', 'روب', 100, 'g', false),
    ('توست', 'توست', 1, 'serving', true),
    ('جبن', 'جبن', 1, 'serving', false);
end $$;
