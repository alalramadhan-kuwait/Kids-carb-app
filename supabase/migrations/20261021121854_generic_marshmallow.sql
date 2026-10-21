-- A generic marshmallow for the food list (USDA SR Legacy 19116, Candies, marshmallows), values per 100 g as sold.
-- One regular marshmallow is about 7.2 g. The Open Food Facts brand record stays as it is (hidden).
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, label_basis,
  carbs_per_100, sugar_per_100, fat_per_100, sat_fat_per_100, fiber_per_100, protein_per_100, kcal_per_100,
  sodium_mg_per_100, calcium_mg_per_100, iron_mg_per_100, potassium_mg_per_100,
  serving_size, carbs_per_serving, per_item, available, approved, emoji, notes, label_updated_at)
select 'Marshmallows', 'مارشميلو', 'Marshmallows', null, 'حلويات', 'natural', 'g', 'as_sold',
  81.3, 57.6, 0.2, 0.1, 0.1, 1.8, 318,
  80, 3, 0.23, 5,
  7.2, 5.9, false, true, true, '🍬', 'USDA SR Legacy 19116: Candies, marshmallows · الحبة العادية حوالي 7.2 غ', current_date
where not exists (select 1 from carb.products where name_en = 'Marshmallows' and brand is null);
