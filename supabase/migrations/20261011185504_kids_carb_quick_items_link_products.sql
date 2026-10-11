-- «أكل متكرر» (quick items) become shortcuts to products in the catalogue: a food added from the Log sheet is a
-- product like any other (it shows in Products, in simple mode once approved, and can be weighed), and its one-tap
-- shortcut points at it. Nothing about how a quick item logs changes: it still logs its own usual carbs.
alter table carb.quick_items add column if not exists product_id uuid; -- the catalogue product it is a shortcut to (a missing one is treated as no link)
create index if not exists quick_items_product on carb.quick_items (product_id);

-- the ones already there: linked to the same product when the catalogue has it (same name and brand)
update carb.quick_items q set product_id = p.id
from carb.products p
where q.product_id is null and lower(trim(p.name)) = lower(trim(q.name)) and coalesce(lower(trim(p.brand)), '') = coalesce(lower(trim(q.brand)), '');

-- otherwise added to the catalogue, NOT approved: their numbers come from logging or an import, not a checked label.
-- Labelled ones (per 100 g or ml) keep their label; the rest are one item each (per_item: values are per item).
with made as (
  insert into carb.products (name, brand, category, kind, unit, per_item, carbs_per_100, fat_per_100, protein_per_100, fiber_per_100, kcal_per_100,
    serving_size, carbs_per_serving, label_basis, available, approved, notes)
  select q.name, q.brand, case when q.kind = 'snack' then 'سناكات' else 'أخرى' end, 'commercial',
    coalesce(q.amount_unit, 'g'), q.per100 is null,
    coalesce((q.per100->>'carbs')::numeric, q.carbs), coalesce((q.per100->>'fat')::numeric, q.fat), coalesce((q.per100->>'protein')::numeric, q.protein),
    coalesce((q.per100->>'fiber')::numeric, q.fiber), coalesce((q.per100->>'kcal')::numeric, q.kcal),
    case when q.per100 is null then 100 else q.amount end, q.carbs, 'as_sold', true, false,
    'من «أكل متكرر» في السجل (' || coalesce(q.source, 'app') || '): راجعوا الملصق ثم اعتمدوه.'
  from carb.quick_items q where q.product_id is null
  returning id, name, brand
)
update carb.quick_items q set product_id = m.id from made m
where q.product_id is null and m.name = q.name and coalesce(m.brand, '') = coalesce(q.brand, '');

-- Applied right after, as a one-off data fix (11 Oct 2026): the shrimp quick item was spelled «روبيان بالقسمات», so it
-- got its own unapproved duplicate. It now points at the approved product added from the label (Seara «روبيان بالبقسماط»,
-- 16cb8d00-72b4-4f18-aeb7-89b7f8cbb92b) under the correct name, and the duplicate made a moment before was removed.
