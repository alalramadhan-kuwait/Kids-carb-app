-- King Jr meals (Burger King Kuwait) built from separate items, and one insulin entry per planned meal.
-- New rows only: no existing product is changed. The three kids mains are separate items on the Kuwait menu
-- (HAMBURGER - KIDS, CHEESEBURGER - KIDS, CHICKEN BURGER KIDS); their values are Burger King Turkey's official
-- table (other-market reference), not verified for Kuwait. Water and Coke Zero have no carbs. The kids meal side is
-- the menu's SMALL FRIES (same item), already in the database, so no separate kids fries row is added.
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, emoji, label_basis, per_item, serving_size,
  carbs_per_100, carbs_per_serving, fat_per_100, protein_per_100, kcal_per_100, gi, gi_match, gi_note, approved, available, source_url, notes, label_updated_at)
select v.ar, v.ar, v.en, 'Burger King', v.cat, 'commercial', v.unit, v.emoji, 'as_sold', true, 100,
  v.carbs, v.carbs, v.fat, v.protein, v.kcal, v.gi, case when v.gi is null then null else 'estimate' end, case when v.gi is null then null else 'تقدير من أطعمة مشابهة' end,
  true, true, v.src,
  v.note, current_date
from (values
  ('برجر كنج هامبرغر كيدز', 'Burger King Kids Hamburger', 'سندويشات', 'g', '🍔', 28.81, 14.80, 10.48, 243, 55, 'https://www.burgerking.com.tr/besin-degerleri',
   'قيمة مرجعية من برجر كنج تركيا (الجدول الرسمي، 17 أكتوبر 2026). غير مؤكدة للكويت: وجبة كنغ جونيور.'),
  ('برجر كنج تشيز برجر كيدز', 'Burger King Kids Cheeseburger', 'سندويشات', 'g', '🍔', 29.33, 20.67, 12.95, 287, 55, 'https://www.burgerking.com.tr/besin-degerleri',
   'قيمة مرجعية من برجر كنج تركيا (الجدول الرسمي، 17 أكتوبر 2026). غير مؤكدة للكويت: وجبة كنغ جونيور.'),
  ('برجر كنج تشيكن برجر كيدز', 'Burger King Kids Chicken Burger', 'سندويشات', 'g', '🍔', 36.34, 12.18, 15.43, 295, 55, 'https://www.burgerking.com.tr/besin-degerleri',
   'قيمة مرجعية من برجر كنج تركيا (الجدول الرسمي، 17 أكتوبر 2026). غير مؤكدة للكويت: وجبة كنغ جونيور.'),
  ('برجر كنج ماء معدني', 'Burger King mineral water', 'مشروبات', 'ml', '💧', 0, 0, 0, 0, null, null, 'ماء: بدون كارب.'),
  ('برجر كنج كوك زيرو (علبة)', 'Burger King Coke Zero (can)', 'مشروبات', 'ml', '🥤', 0, 0, 0, 0, null, null, 'كوك زيرو: بدون كارب.')
) as v(ar, en, cat, unit, emoji, carbs, fat, protein, kcal, gi, src, note)
where not exists (select 1 from carb.products p where p.brand = 'Burger King' and p.name = v.ar);

-- One insulin entry can belong to one planned meal only (checked 17 Oct: no plan shares a dose today).
create unique index if not exists planned_meals_dose_event_once on carb.planned_meals (dose_event_id) where dose_event_id is not null;
