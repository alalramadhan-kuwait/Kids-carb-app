-- KDD Ice Cream Sandwich (vanilla ice cream in biscuit sandwich), from the pack's nutrition table (photo from the family):
-- per piece, no published weight, so sold by the item (one piece stored as 100 units, as for the PICK cups).
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, per_item, carbs_per_100, fat_per_100, protein_per_100, fiber_per_100, kcal_per_100,
  sugar_per_100, sugar_added_per_100, sat_fat_per_100, sodium_mg_per_100, serving_size, carbs_per_serving, label_basis, approved, available, emoji, notes, label_updated_at)
select 'Ice Cream Sandwich', 'آيس كريم ساندويتش', 'Ice Cream Sandwich', 'KDD', 'آيس كريم', 'commercial', 'g', true, 15, 3, 1, 0, 90,
  8, 7, 2.5, 75, 100, 15, 'as_sold', true, true, '🍦',
  'من جدول التغذية على العبوة (صورة من العائلة): للحبة 15 غ كارب، منها سكريات 8 غ (مضاف 7)، 90 سعرة، دهون 3 غ، بروتين 1 غ.',
  date '2026-10-07'
where not exists (select 1 from carb.products p where p.brand = 'KDD' and p.name = 'Ice Cream Sandwich');
