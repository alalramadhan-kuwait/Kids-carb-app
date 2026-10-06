-- The by-weight list for Mom (2026-10-06): everything on it was already in the database (approved, shown in simple
-- mode, weighable in grams) except mashed potato. Values: USDA SR Legacy "Potatoes, mashed, home-prepared, whole milk
-- and butter added", per 100 g.
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, emoji, carbs_per_100, fat_per_100, protein_per_100, fiber_per_100, kcal_per_100,
  serving_size, carbs_per_serving, label_basis, approved, available, per_item, notes, label_updated_at)
select 'بطاط مهروس (بيتي بالحليب والزبدة)', 'بطاط مهروس', 'Mashed Potato (Home-made)', null, 'خضار', 'natural', 'g', '🥔', 16.8, 4.2, 1.9, 1.5, 113,
  210, 35.3, 'cooked', true, false, false,
  'USDA SR Legacy: Potatoes, mashed, home-prepared, whole milk and butter added — لكل 100 غ. الحصة = كوب (210 غ).', current_date
where not exists (select 1 from carb.products where name_ar = 'بطاط مهروس');
