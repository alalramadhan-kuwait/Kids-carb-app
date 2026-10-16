-- Stuffed vine leaves with rice (home style, cooked in oil and lemon): a generic estimate, per 100 g, with per-piece portions.
with p as (
  insert into carb.products (name, name_ar, name_en, brand, category, kind, unit, carbs_per_100, fat_per_100, protein_per_100, fiber_per_100, kcal_per_100,
    serving_size, carbs_per_serving, label_basis, available, approved, per_item, emoji, notes, label_updated_at)
  select 'ورق عنب محشي رز', 'ورق عنب محشي رز', 'Stuffed vine leaves (rice)', null, 'رز', 'natural', 'g', 21, 8, 3, 2.5, 168,
    30, 6.3, 'as_sold', true, true, false, '🍃',
    'تقدير: ورق عنب بيتي محشي رز مطبوخ بالزيت والليمون. ما في قيمة رسمية مطابقة؛ القيم تقريبية (الحبة ~30 غ ≈ 6 غ كارب). إذا الحشوة فيها لحم، الكارب أقل شوي والدهون أكثر.',
    current_date
  where not exists (select 1 from carb.products where name = 'ورق عنب محشي رز')
  returning id
)
insert into carb.portions (product_id, label, amount, sort)
select p.id, x.label, x.amount, x.sort from p, (values ('حبة (30 غ)', 30, 0), ('5 حبات (150 غ)', 150, 1), ('10 حبات (300 غ)', 300, 2)) as x(label, amount, sort);
