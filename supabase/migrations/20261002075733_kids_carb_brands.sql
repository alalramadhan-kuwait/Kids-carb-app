-- Brand on frequent foods and logged meals, so a family can pull up all of one brand's products (e.g. KDD) and log one with a tap.
alter table carb.quick_items add column if not exists brand text, add column if not exists fiber numeric;
alter table carb.meal_history add column if not exists brand text;
create index if not exists quick_items_brand on carb.quick_items (lower(brand)) where brand is not null;
-- the brands the Gluroo import already names
update carb.quick_items set brand = 'National Food' where brand is null and name like '%National Food%';
update carb.quick_items set brand = 'KDD' where brand is null and name like '%KDD%';
