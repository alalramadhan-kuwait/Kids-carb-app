-- A frequent food can keep the label as printed (per 100 ml or g) and the pack size; the per-serving values are computed from them.
alter table carb.quick_items
  add column if not exists per100 jsonb,
  add column if not exists amount numeric check (amount is null or (amount > 0 and amount <= 5000)),
  add column if not exists amount_unit text check (amount_unit is null or amount_unit in ('ml','g'));
