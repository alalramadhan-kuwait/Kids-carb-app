-- The doctor's correction target is a range: no correction inside it; above it, correct down to its top;
-- below it, lower the dose up to its bottom (the insulin-pump convention). target_mgdl is the bottom.
alter table carb.settings
  add column target_high_mgdl int check (target_high_mgdl between 70 and 220),
  add constraint settings_target_range_check check (target_high_mgdl is null or target_mgdl is null or target_high_mgdl >= target_mgdl);

-- values entered at the parents' request (2026-10-01), from the doctor's plan in Gluroo:
-- CR 15 g/unit, ISF 3.0 mmol/L (54 mg/dL) all day, target 5.5–6.5 mmol/L (99–117 mg/dL)
-- update carb.settings set ratios = '[{"from":"00:00","cr":15,"isf":54}]', target_mgdl = 99, target_high_mgdl = 117 where id;
