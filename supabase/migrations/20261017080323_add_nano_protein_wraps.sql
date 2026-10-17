-- Nano Supps (Nano ä) Protein Wraps: values per 100 g from the pack label (EU label: carbohydrate excludes fibre); one wrap = 40 g.
with p as (
  insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, carbs_per_100, fat_per_100, protein_per_100, fiber_per_100, kcal_per_100,
    sugar_per_100, sat_fat_per_100, sodium_mg_per_100, pack_size, serving_size, carbs_per_serving, label_basis, available, approved, per_item, emoji, notes, label_updated_at)
  select 'Protein Wraps', 'خبز تورتيلا بروتين (لو كارب)', 'Protein Wraps', 'Nano Supps', 'خبز', 'commercial', 'g',
    11, 13, 22, 26, 308, 0.7, 6, 680, 240, 40, 4.4, 'as_sold', true, true, false, '🌯',
    'من ملصق العبوة (أوروبي: الكارب بدون الألياف). الرغيف 40 غ = 4.4 غ كارب، 10 غ ألياف. 6 أرغفة بالعبوة.', current_date
  where not exists (select 1 from carb.products where name = 'Protein Wraps' and brand = 'Nano Supps')
  returning id
)
insert into carb.portions (product_id, label, amount, sort)
select p.id, x.label, x.amount, x.sort from p, (values ('رغيف (40 غ)', 40, 0), ('نص رغيف (20 غ)', 20, 1)) as x(label, amount, sort);
