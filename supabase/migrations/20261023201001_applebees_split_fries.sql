-- Applebee's kids meals split into the main and the fries, as the family asked (23 Oct 2026). Neither meal row was used yet.
-- Fries: CalorieKing / MyFoodDiary kids fries (430 kcal, 57 g carbs, 20 g fat, 4 g fiber, 5 g protein, 960 mg sodium).
-- Mains: the Nutritionix meal minus its fries (400 kcal there, so the fries values scaled to 400 kcal: 53 g carbs, 19 g fat,
-- 4 g fiber, 5 g protein, 890 mg sodium). Saturated fat of the fries is not known, so the mains' saturated fat is left empty.
update carb.products set name = 'أبل بيز تشيز برجر أطفال', name_ar = 'أبل بيز تشيز برجر أطفال', name_en = 'Applebee''s Kids Cheeseburger',
  category = 'وجبات سريعة', carbs_per_100 = 38, carbs_per_serving = 38, fat_per_100 = 35, sat_fat_per_100 = null, fiber_per_100 = 3,
  sugar_per_100 = 7, protein_per_100 = 26, kcal_per_100 = 560, sodium_mg_per_100 = 1280,
  notes = 'أبل بيز (Nutritionix، القيم الأمريكية): لحم بقري 180، خبز بريوش 320، جبن أمريكي 60، خس وطماطم ومخلل · بدون البطاطا (الوجبة ناقص بطاطا 400 سعرة). غير مؤكد للكويت.'
where brand = 'Applebee''s' and name_en = 'Applebee''s Kids Cheeseburger (with fries)';

update carb.products set name = 'أبل بيز تشيكن تندرز أطفال', name_ar = 'أبل بيز تشيكن تندرز أطفال', name_en = 'Applebee''s Kids Chicken Tenders',
  category = 'وجبات سريعة', carbs_per_100 = 16, carbs_per_serving = 16, fat_per_100 = 16, sat_fat_per_100 = null, fiber_per_100 = 2,
  sugar_per_100 = 0, protein_per_100 = 20, kcal_per_100 = 290, sodium_mg_per_100 = 820,
  notes = 'أبل بيز (Nutritionix، القيم الأمريكية): تشيكن تندرز 290 سعرة · بدون البطاطا (الوجبة ناقص بطاطا 400 سعرة). غير مؤكد للكويت.'
where brand = 'Applebee''s' and name_en = 'Applebee''s Kids Chicken Tenders (with fries)';

insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, label_basis,
  carbs_per_100, fat_per_100, sat_fat_per_100, fiber_per_100, sugar_per_100, protein_per_100, kcal_per_100, sodium_mg_per_100,
  serving_size, carbs_per_serving, per_item, available, approved, emoji, notes, source_url, label_updated_at)
select 'أبل بيز بطاطا أطفال', 'أبل بيز بطاطا أطفال', 'Applebee''s Kids Fries', 'Applebee''s', 'وجبات سريعة', 'commercial', 'g', 'as_sold',
  57, 20, null, 4, null, 5, 430, 960, 100, 57, true, true, true, '🍟',
  'أبل بيز بطاطا الأطفال (CalorieKing و MyFoodDiary، القيم الأمريكية): الحصة 430 سعرة. غير مؤكد للكويت.',
  'https://www.calorieking.com/us/en/foods/f/calories-in-kids-menu-kids-french-fries/tWKVMioNRUyOAQKmOnC-yg', '2026-10-23'
where not exists (select 1 from carb.products where brand = 'Applebee''s' and name_en = 'Applebee''s Kids Fries');
