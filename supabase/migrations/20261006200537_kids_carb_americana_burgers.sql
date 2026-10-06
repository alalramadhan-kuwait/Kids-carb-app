-- Americana frozen burgers (Gulf versions, GS1 628105…): values per 100 g as transcribed from the pack label by Open
-- Food Facts. Not yet checked against the family's own pack, so approved = false: the products stay out of simple
-- mode until a parent compares the carbs with the nutrition table on the pack and approves them. Salt g × 400 = sodium mg.
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, emoji, carbs_per_100, fat_per_100, protein_per_100, fiber_per_100, kcal_per_100,
  sugar_per_100, sat_fat_per_100, sodium_mg_per_100, serving_size, carbs_per_serving, label_basis, approved, available, per_item, source_url, notes, label_updated_at)
select v.name, v.name_ar, v.name, 'Americana', v.category, 'commercial', 'g', '🍔', v.carbs, v.fat, v.protein, v.fiber, v.kcal,
  v.sugar, v.sat, v.sodium, null, null, 'as_sold', false, false, false,
  'https://world.openfoodfacts.org/product/' || v.code,
  'من ملصق عبوة أمريكانا كما سجّلته Open Food Facts (باركود ' || v.code || '). لم يُراجع على عبوتكم بعد: قارنوا الكارب بالجدول الغذائي على العبوة ثم اعتمدوه. الأرقام تختلف قليلًا بين نسخ العبوات.',
  current_date
from (values
  ('Beef Burger (Arabic Spices)',          'برغر لحم بالبهارات العربية', 'برغر لحم', '6281050113054',  6.0, 15.0, 14.0, 0.0,   210, 1.0, 5.0, 480),
  ('Beef Burger BBQ',                      'برغر لحم باربكيو',           'برغر لحم', '6281050113177',  4.0, 17.0, 16.0, 0.0,   230, 1.0, 5.0, 650),
  ('Beef Burger Jumbo',                    'برغر لحم جامبو',             'برغر لحم', '6281050113207',  6.0, 13.0, 14.0, 0.0,   200, 1.0, 5.0, 460),
  ('Angus Beef Burger',                    'برغر لحم أنغوس',             'برغر لحم', '6281050826688',  2.0, 10.0, 17.0, null,  170, null, 4.0, null),
  ('Chicken Burger',                       'برغر دجاج',                  'لحوم ودجاج', '6281050114242', 5.0, 9.0, 16.0, 0.0,   170, 1.0, 2.5, 300),
  ('Breaded Chicken Burger',               'برغر دجاج مقرمش',            'لحوم ودجاج', '6281050114013', 17.0, 9.0, 16.0, 1.0,  210, 1.0, 5.0, 670),
  ('Breaded Chicken Burger (Air Fryer)',   'برغر دجاج مقرمش للإير فراير', 'لحوم ودجاج', '6281050831743', 18.0, 7.0, 16.0, 1.0, 156, 1.0, 2.5, 360),
  ('Crunchy Chicken Burger Fillet',        'برغر فيليه دجاج كرنشي',      'لحوم ودجاج', '6281050829948', 17.0, 6.0, 16.0, 1.0,  190, 0.0, 2.5, 380),
  ('Craves Chicken Fillet Burger BBQ',     'برغر فيليه دجاج كريفز باربكيو', 'لحوم ودجاج', '6281050826756', 4.0, 10.0, 14.0, null, 160, 2.0, 2.0, 410)
) as v(name, name_ar, category, code, carbs, fat, protein, fiber, kcal, sugar, sat, sodium)
where not exists (select 1 from carb.products p where p.brand = 'Americana' and p.name = v.name);
