-- Applebee's kids meals, each a whole meal with its fries, from Applebee's nutrition on Nutritionix
-- (restaurant.nutritionix.com/applebees, screenshots sent by the family 23 Oct 2026). US values, not confirmed for Kuwait.
-- Values are per meal (per_item; the per-100 fields hold the whole meal, like the other restaurant meals).
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, label_basis,
  carbs_per_100, fat_per_100, sat_fat_per_100, fiber_per_100, sugar_per_100, protein_per_100, kcal_per_100, sodium_mg_per_100,
  serving_size, carbs_per_serving, per_item, available, approved, emoji, notes, source_url, label_updated_at)
select v.ar, v.ar, v.en, 'Applebee''s', 'وجبات', 'commercial', 'g', 'as_sold',
  v.carb, v.fat, v.sat, v.fiber, v.sugar, v.prot, v.kcal, v.na,
  100, v.carb, true, true, true, v.emoji,
  'أبل بيز (Nutritionix، القيم الأمريكية): ' || v.parts || ' · القيم للوجبة كاملة مع البطاطا. غير مؤكد للكويت.',
  v.url, '2026-10-23'
from (values
  ('أبل بيز وجبة تشيز برجر أطفال', 'Applebee''s Kids Cheeseburger (with fries)', 91.0, 54.0, 16.0, 7.0, 7.0, 31.0, 970.0, 2170.0, '🍔',
   'لحم بقري 180، خبز بريوش 320، جبن أمريكي 60، خس وطماطم ومخلل، بطاطا 400 سعرة', 'https://restaurant.nutritionix.com/applebees/item/675413'),
  ('أبل بيز وجبة تشيكن تندرز أطفال', 'Applebee''s Kids Chicken Tenders (with fries)', 69.0, 35.0, 6.0, 6.0, 0.0, 25.0, 690.0, 1710.0, '🍗',
   'تشيكن تندرز 290، بطاطا 400 سعرة', 'https://restaurant.nutritionix.com/applebees')
) as v(ar, en, carb, fat, sat, fiber, sugar, prot, kcal, na, emoji, parts, url)
where not exists (select 1 from carb.products p where p.brand = 'Applebee''s' and p.name_en = v.en);
