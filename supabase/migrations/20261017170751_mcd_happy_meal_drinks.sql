-- Happy Meal drinks without carbs (water by default). New rows only.
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, emoji, label_basis, per_item, serving_size,
  carbs_per_100, carbs_per_serving, fat_per_100, protein_per_100, kcal_per_100, approved, available, notes, label_updated_at)
select v.ar, v.ar, v.en, 'McDonald''s', 'مشروبات', 'commercial', 'ml', v.emoji, 'as_sold', true, 100, 0, 0, 0, 0, 0, true, true, v.note, current_date
from (values ('ماكدونالدز ماء', 'McDonald''s water', '💧', 'ماء: بدون كارب.'),
             ('ماكدونالدز كوك زيرو', 'McDonald''s Coke Zero', '🥤', 'كوك زيرو: بدون كارب.')) as v(ar, en, emoji, note)
where not exists (select 1 from carb.products p where p.brand = 'McDonald''s' and p.name = v.ar);
