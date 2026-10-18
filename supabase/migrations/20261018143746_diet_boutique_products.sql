-- Diet Boutique (دايت بوتيك): 10 products from the brand's label photos (Instagram story, 27 Sep 2025).
-- Labels give values per 100 g after cooking, so label_basis = 'cooked' (weigh the cooked food).
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, carbs_per_100, fat_per_100, protein_per_100, kcal_per_100, sodium_mg_per_100, serving_size, carbs_per_serving, label_basis, approved, available, emoji, notes)
select 'Diet Boutique ' || en, 'دايت بوتيك ' || ar, en, 'Diet Boutique', cat, 'commercial', 'g', c, f, p, k, na, 100, c, 'cooked', true, true, e,
  'من الملصق (صور دايت بوتيك، 27 سبتمبر 2025) · القيم لكل 100 غ بعد الطبخ · 10 حصص بالعلبة' || coalesce(' · ' || extra, '')
from (values
  ('Original Shrimp', 'روبيان أوريجينال', 'سمك وروبيان', 0.9, 2.9, 28, 140, 188, '🍤', null),
  ('Spicy Shrimp', 'روبيان حار', 'سمك وروبيان', 0.9, 2.9, 28, 140, 188, '🍤', 'الملصق الإنجليزي 0.9 غ والعربي 0.8 غ؛ استخدمنا 0.9'),
  ('Chicken Breast Fillet', 'صدر الدجاج فيليه', 'لحوم ودجاج', 0.8, 5.9, 35, 198, 98, '🍗', null),
  ('Spicy Chicken Breast Fillet', 'صدر دجاج فيليه حار', 'لحوم ودجاج', 0.8, 5.9, 35, 198, 98, '🍗', null),
  ('Chicken Breast Strips Special Flavour', 'ستربس صدر الدجاج نكهة خاصة', 'لحوم ودجاج', 0.8, 5.9, 35, 198, 98, '🍗', null),
  ('Chicken Breast Strips Spicy', 'ستربس صدر الدجاج سبايسي', 'لحوم ودجاج', 0.8, 5.9, 35, 198, 98, '🍗', null),
  ('Chicken Nuggets', 'تشكن ناجتس', 'لحوم ودجاج', 0.8, 5.9, 35, 198, 98, '🍗', null),
  ('Chicken Breast Popcorn', 'بوبكورن صدور الدجاج', 'لحوم ودجاج', 0.8, 5.9, 35, 198, 98, '🍗', null),
  ('Steak Escalope', 'ستيك اسكالوب', 'لحوم ودجاج', 0.8, 8.9, 34, 236, 97, '🥩', null),
  ('Tortilla Meat', 'تورتيلا اللحم', 'سندويشات', 14.7, 7.5, 31, 239, 167, '🌯', 'خبز بروتين')
) v(en, ar, cat, c, f, p, k, na, e, extra)
where not exists (select 1 from carb.products x where x.brand = 'Diet Boutique' and x.name_en = v.en);
