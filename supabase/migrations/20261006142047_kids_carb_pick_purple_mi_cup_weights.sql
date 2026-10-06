-- PICK gave the family its cup weights (2026-10-06): Mini 100 g, Small 140 g, Medium 200 g, Large 320 g.
-- Purple Mi per cup = weight × PICK's own card per 100 g (91 kcal, 18 g carbs, 4 g protein, 0 fat). Replaces the
-- estimates made from Vanilla Mi's calories. Per-item products store one cup as 100 units, so the per-100 columns
-- hold the per-cup values. Parfaits keep their estimates: PICK gave no parfait weights.
update carb.products p set
  carbs_per_100 = round(18 * w.g / 100.0, 1),
  kcal_per_100 = round(91 * w.g / 100.0),
  protein_per_100 = round(4 * w.g / 100.0, 1),
  fat_per_100 = 0,
  notes = format('وزن الكوب من بيك (رد بيك للأهل 2026-10-06): %s غ × بطاقة بيك الرسمية لكل 100 غ (91 سعرة، 18 غ كارب، 4 غ بروتين، 0 دهون).', w.g),
  label_updated_at = now()
from (values ('Purple Mi (Mini cup)', 100), ('Purple Mi (Small cup)', 140), ('Purple Mi (Medium cup)', 200), ('Purple Mi (Large cup)', 320)) as w(name, g)
where p.brand = 'PICK' and p.name = w.name;
