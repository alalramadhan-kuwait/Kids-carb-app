-- Weighing a home dish: an ingredient served next to the dish (the yogurt with the pasta) is not in the pot, so it is
-- left out when a weighed plate is turned into carbs. Plates still count it.
alter table carb.recipe_ingredients add column if not exists on_side boolean not null default false;

update carb.recipe_ingredients i set on_side = true
from carb.recipes r
where i.recipe_id = r.id and r.name = 'باستا باللحم المفروم' and i.label = 'روب يوناني';
