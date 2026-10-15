-- Iranian koobideh kebab (estimated, per 100 g cooked), its skewer sizes, a quarter cup of the existing cooked white
-- rice, and the saved meal «عيش وكباب إيراني» for simple mode. Additive only: no existing food or entry is changed
-- except the order of the rice cup sizes (¼ first).
insert into carb.products (name, name_ar, name_en, brand, category, kind, image_path, emoji, unit, label_basis,
  carbs_per_100, protein_per_100, fat_per_100, sat_fat_per_100, sugar_per_100, fiber_per_100, kcal_per_100,
  per_item, approved, available, notes)
select 'كباب إيراني', 'كباب إيراني', 'Iranian koobideh kebab', null, 'لحوم ودجاج', 'natural',
  'products/632ee296-a456-4742-9a1d-259ecae219ed.jpg', '🍢', 'g', 'as_sold',
  2, 21, 18, 7, 1, 0, 250, false, true, true,
  'كوبيده: قيم تقديرية لكل 100 غ مطبوخ. السيخ ~100 غ (تقدير، يتعدل من الوضع المتقدم).'
where not exists (select 1 from carb.products where name = 'كباب إيراني');

insert into carb.portions (product_id, label, amount, sort)
select p.id, v.label, v.amount, v.sort
from carb.products p, (values ('نص سيخ (50 غ)', 50, 0), ('سيخ (100 غ)', 100, 1), ('سيخين (200 غ)', 200, 2)) v(label, amount, sort)
where p.name = 'كباب إيراني'
  and not exists (select 1 from carb.portions x where x.product_id = p.id and x.label = v.label);

-- ¼ cup of the existing cooked white rice (158 g a cup), first in the list
update carb.portions set sort = sort + 1
where product_id = (select id from carb.products where name = 'رز أبيض مطبوخ' and category = 'رز')
  and not exists (select 1 from carb.portions x where x.product_id = carb.portions.product_id and x.label = 'ربع كوب (40 غ)');
insert into carb.portions (product_id, label, amount, sort)
select id, 'ربع كوب (40 غ)', 39.5, 0 from carb.products
where name = 'رز أبيض مطبوخ' and category = 'رز'
  and not exists (select 1 from carb.portions x where x.product_id = carb.products.id and x.label = 'ربع كوب (40 غ)');

-- the saved meal: half a cup of rice and one skewer (both changeable on the plate)
insert into carb.saved_meals (name, emoji, items, sort)
select 'عيش وكباب إيراني', '🍢', jsonb_build_array(
    jsonb_build_object('id', r.id, 'kind', 'product', 'portion_id', (select id from carb.portions where product_id = r.id and label like 'نصف كوب%')),
    jsonb_build_object('id', k.id, 'kind', 'product', 'portion_id', (select id from carb.portions where product_id = k.id and label = 'سيخ (100 غ)'))),
  coalesce((select max(sort) from carb.saved_meals), 0) + 1
from carb.products r, carb.products k
where r.name = 'رز أبيض مطبوخ' and r.category = 'رز' and k.name = 'كباب إيراني'
  and not exists (select 1 from carb.saved_meals where name = 'عيش وكباب إيراني');
