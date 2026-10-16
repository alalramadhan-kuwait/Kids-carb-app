-- Khazan Breaded Chicken Burger, Original (frozen): values per 100 g from the pack label; one burger = 60 g.
with p as (
  insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, carbs_per_100, fat_per_100, protein_per_100, fiber_per_100, kcal_per_100,
    sugar_per_100, sugar_added_per_100, sat_fat_per_100, sodium_mg_per_100, potassium_mg_per_100,
    serving_size, carbs_per_serving, label_basis, available, approved, per_item, emoji, notes, label_updated_at)
  select 'برجر دجاج بالبقسماط أوريجنال', 'برجر دجاج بالبقسماط أوريجنال', 'Breaded Chicken Burger Original', 'Khazan', 'لحوم ودجاج', 'commercial', 'g',
    25.6, 10.2, 12.4, 2.3, 226, 2.7, 0, 6.4, 345, 288.4,
    60, 15.4, 'as_sold', true, true, false, '🍔',
    'من ملصق العبوة (لكل 100 غ، الحصة 60 غ = قطعة وحدة، 14 قطعة بالعبوة). القيم للقطعة نفسها قبل الطبخ، بدون خبز.', current_date
  where not exists (select 1 from carb.products where name = 'برجر دجاج بالبقسماط أوريجنال' and brand = 'Khazan')
  returning id
)
insert into carb.portions (product_id, label, amount, sort)
select p.id, x.label, x.amount, x.sort from p, (values ('قطعة (60 غ)', 60, 0), ('قطعتين (120 غ)', 120, 1)) as x(label, amount, sort);
