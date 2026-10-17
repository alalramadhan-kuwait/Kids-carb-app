-- Burger King kids fries for the King Jr meals (the regular small fries stay for regular meals). Value from Burger
-- King US (Kids Fries, 18 g carbs), not verified for Kuwait; the app asks to confirm the kids portion before counting.
insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, emoji, label_basis, per_item, serving_size,
  carbs_per_100, carbs_per_serving, approved, available, gi, gi_match, gi_note, source_url, notes, label_updated_at)
select 'برجر كنج بطاطا أطفال', 'برجر كنج بطاطا أطفال', 'Burger King Kids Fries', 'Burger King', 'نشويات', 'commercial', 'g', '🍟', 'as_sold', true, 100,
  18, 18, true, true, 70, 'estimate', 'تقدير من أطعمة مشابهة', 'https://www.bk.com/menu',
  'بطاطا وجبة كنغ جونيور. قيمة مرجعية من برجر كنج أمريكا (Kids Fries 18 غ كارب)، غير مؤكدة للكويت. البطاطا الصغيرة العادية تبقى للوجبات العادية.', current_date
where not exists (select 1 from carb.products where brand = 'Burger King' and name = 'برجر كنج بطاطا أطفال');
