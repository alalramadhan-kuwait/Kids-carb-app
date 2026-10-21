-- KFC values from KFC's own nutrition table (KFC Estonia, kfc.ee, 2 March 2023), per portion. Items that match a
-- product and portion in that table replace the earlier app values; thigh, bone-in breast, Mighty Zinger and onion
-- rings are not in the table and keep their earlier values. More items from the table are added.
-- Not confirmed for Kuwait (recipes and portions can differ).
with t(en, ar, cat, w, kcal, fat, carb, prot, salt_g, emoji, gi, note) as (values
  ('KFC Chicken Drumstick', null, null, 100, 223.0, 12.5, 8.4, 19.3, 1.3, null, null::smallint, 'Original Drumstick'),
  ('KFC Chicken Wing', null, null, 46, 156.4, 10.9, 6.7, 7.9, 0.5, null, null, 'Hot & Spicy Wing (الجدول ما فيه جناح أوريجينال)'),
  ('KFC Chicken Strip', null, null, 46, 112.2, 5.4, 5.9, 10.0, 0.8, null, null, 'Original Strip'),
  ('KFC Twister Wrap', null, null, 239, 514.8, 22.0, 53.2, 26.1, 2.9, null, null, 'Twister (Original)'),
  ('KFC Zinger Sandwich', null, null, 193, 593.2, 36.4, 43.1, 20.4, 2.4, null, null, 'Zinger burger'),
  ('KFC Fries (regular)', 'كنتاكي بطاطا (وسط)', null, 100, 255.0, 11.0, 34.0, 2.6, 0.6, null, null, 'Fries M')
)
update carb.products p set
  name = coalesce(t.ar, p.name), name_ar = coalesce(t.ar, p.name_ar),
  carbs_per_100 = t.carb, carbs_per_serving = t.carb, fat_per_100 = t.fat, protein_per_100 = t.prot, kcal_per_100 = t.kcal,
  sugar_per_100 = null, sodium_mg_per_100 = round(t.salt_g * 400),
  source_url = 'https://kfc.ee/wp-content/uploads/2023/03/KFC-Nutrition-values.pdf', label_updated_at = '2023-03-02',
  notes = 'جدول كنتاكي الرسمي (إستونيا، مارس 2023): ' || t.note || ' · الحصة ' || t.w || ' غ · القيم للحصة كاملة. غير مؤكد للكويت.',
  updated_at = now()
from t where p.brand = 'KFC' and p.name_en = t.en;

insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, label_basis,
  carbs_per_100, fat_per_100, protein_per_100, kcal_per_100, sodium_mg_per_100, serving_size, carbs_per_serving,
  per_item, available, approved, emoji, notes, source_url, label_updated_at, gi, gi_match, gi_note)
select v.ar, v.ar, v.en, 'KFC', v.cat, 'commercial', 'g', 'as_sold',
  v.carb, v.fat, v.prot, v.kcal, round(v.salt_g * 400), 100, v.carb, true, true, true, v.emoji,
  'جدول كنتاكي الرسمي (إستونيا، مارس 2023): ' || v.orig || ' · الحصة ' || v.w || ' غ · القيم للحصة كاملة. غير مؤكد للكويت.',
  'https://kfc.ee/wp-content/uploads/2023/03/KFC-Nutrition-values.pdf', '2023-03-02',
  v.gi, case when v.gi is not null then 'estimate' end, case when v.gi is not null then 'تقدير من أطعمة مشابهة' end
from (values
  ('كنتاكي فيليه دجاج أوريجينال', 'KFC Original Fillet', 'دجاج', 'Original Fillet', 95, 253.7, 15.2, 9.5, 19.0, 1.8, '🍗', null::smallint),
  ('كنتاكي ستربس حار (قطعة)', 'KFC Hot & Spicy Strip', 'دجاج', 'Hot & Spicy Strips', 48, 126.7, 7.0, 6.2, 9.8, 0.7, '🍗', null),
  ('كنتاكي فيليه زنجر', 'KFC Zinger Fillet', 'دجاج', 'Hot & Spicy Zinger Fillet', 105, 339.2, 24.2, 17.9, 22.1, 2.2, '🍗', null),
  ('كنتاكي كرسبي برجر', 'KFC Crispy Burger', 'سندويشات', 'Crispy Burger', 121, 361.1, 16.1, 38.1, 14.5, 1.6, '🍔', 55),
  ('كنتاكي تشيز برجر', 'KFC Cheeseburger', 'سندويشات', 'Cheeseburger', 140, 351.5, 12.0, 43.6, 17.0, 2.2, '🍔', 55),
  ('كنتاكي فيليه برجر', 'KFC Fillet Burger', 'سندويشات', 'Fillet burger (Original)', 183, 507.7, 27.5, 38.9, 23.7, 2.6, '🍔', 55),
  ('كنتاكي ديلوكس زنجر برجر', 'KFC Deluxe Zinger Burger', 'سندويشات', 'Deluxe Zinger burger', 254, 687.8, 43.8, 46.6, 25.6, 3.2, '🍔', 55),
  ('كنتاكي بوكسماستر', 'KFC Boxmaster', 'سندويشات', 'Boxmaster (Original)', 291, 645.3, 32.5, 59.8, 28.2, 3.9, '🌯', 55),
  ('كنتاكي بطاطا (صغير)', 'KFC Fries (small)', 'نشويات', 'Fries S', 60, 153.0, 6.6, 20.4, 1.6, 0.4, '🍟', 70),
  ('كنتاكي بطاطا (كبير)', 'KFC Fries (large)', 'نشويات', 'Fries L', 140, 357.0, 15.4, 47.6, 3.6, 0.8, '🍟', 70),
  ('كنتاكي كول سلو', 'KFC Coleslaw', 'خضار', 'Coleslaw', 120, 155.1, 10.7, 12.3, 1.1, 0.4, '🥗', null),
  ('كنتاكي صوص كاتشب', 'KFC Ketchup dip', 'صلصة', 'Ketchup dip', 25, 25.5, 0.0, 5.8, 0.3, 0.5, '🍅', null),
  ('كنتاكي صوص ثوم', 'KFC Garlic dip', 'صلصة', 'Garlic dip', 25, 101.5, 9.8, 3.0, 0.2, 0.4, '🧄', null),
  ('كنتاكي صوص باربكيو', 'KFC BBQ dip', 'صلصة', 'BBQ dip', 25, 34.5, 0.1, 8.0, 0.2, 0.3, '🥫', null),
  ('كنتاكي آيس كريم بالبسكوت', 'KFC Ice-cream in waffle', 'آيس كريم', 'Ice-cream in waffle', 86, 165.4, 3.4, 22.4, 3.8, 0.1, '🍦', null),
  ('كنتاكي ميلك شيك شوكولاتة 250 مل', 'KFC Chocolate Milkshake 250 ml', 'مشروبات', 'Milkshake Chocolate 250ml', 210, 269.8, 4.6, 48.9, 5.7, 0.2, '🥤', null)
) v(ar, en, cat, orig, w, kcal, fat, carb, prot, salt_g, emoji, gi)
where not exists (select 1 from carb.products x where x.brand = 'KFC' and x.name_en = v.en);
