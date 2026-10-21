-- KFC items, per piece or per portion (per_item: the *_per_100 columns hold the values for one piece, as for the other
-- restaurants). From screenshots of a carb-counting app's KFC list sent by the family, not KFC Kuwait's own table.
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, label_basis,
  carbs_per_100, sugar_per_100, fat_per_100, protein_per_100, kcal_per_100, serving_size, carbs_per_serving,
  per_item, available, approved, emoji, notes, label_updated_at, gi, gi_match, gi_note)
select v.ar, v.ar, v.en, 'KFC', v.cat, 'commercial', 'g', 'as_sold',
  v.c, v.s, v.f, v.p, v.k, 100, v.c, true, true, true, v.e,
  'قيم لقطعة/حصة واحدة من تطبيق عدّ كارب (صور أرسلتها العائلة)، مو جدول كنتاكي الكويت الرسمي.' || coalesce(' ' || v.n, ''),
  current_date, v.gi, case when v.gi is not null then 'estimate' end, case when v.gi is not null then 'تقدير من أطعمة مشابهة' end
from (values
  ('كنتاكي ساق دجاج (درمستك)', 'KFC Chicken Drumstick', 'دجاج', 4.0, null::numeric, 10.0, 19.0, 130, '🍗', 'قطعة واحدة عادية.', null::smallint),
  ('كنتاكي فخذ دجاج', 'KFC Chicken Thigh', 'دجاج', 8.0, null, 14.0, 22.0, 280, '🍗', 'قطعة واحدة عادية.', null),
  ('كنتاكي صدر دجاج', 'KFC Chicken Breast', 'دجاج', 11.0, null, 15.0, 36.0, 390, '🍗', 'قطعة واحدة عادية.', null),
  ('كنتاكي جناح دجاج', 'KFC Chicken Wing', 'دجاج', 3.0, null, null, null, 130, '🍗', 'قطعة واحدة عادية.', null),
  ('كنتاكي ستربس دجاج', 'KFC Chicken Strip', 'دجاج', 8.0, null, null, null, 140, '🍗', 'قطعة واحدة عادية.', null),
  ('كنتاكي تويستر راب', 'KFC Twister Wrap', 'سندويشات', 53.0, 4.0, 22.0, 24.0, 630, '🌯', 'السعرات (630) أعلى مما تعطيه الأرقام (حوالي 510): راجعوا الكارب على التطبيق.', 55),
  ('كنتاكي زنجر ساندويتش', 'KFC Zinger Sandwich', 'سندويشات', 43.8, 5.0, 25.0, 24.0, 450, '🍔', null, 55),
  ('كنتاكي مايتي زنجر ساندويتش', 'KFC Mighty Zinger Sandwich', 'سندويشات', 58.8, 5.0, 30.0, 32.0, 780, '🍔', null, 55),
  ('كنتاكي بطاطا (عادي)', 'KFC Fries (regular)', 'نشويات', 30.2, null, null, null, 250, '🍟', 'الحجم العادي.', 70),
  ('كنتاكي حلقات بصل (كبير)', 'KFC Onion Rings (large)', 'سناكات', 51.0, 8.0, 24.0, 7.0, 400, '🧅', 'الحجم الكبير.', 70)
) v(ar, en, cat, c, s, f, p, k, e, n, gi)
where not exists (select 1 from carb.products x where x.brand = 'KFC' and x.name_en = v.en);
