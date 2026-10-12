-- A recipe's pot, measured once after cooking: its whole weight (so a weighed plate is a share of it even when
-- the grains drank water) and how many cups it fills (so a cup is a share of it).
alter table carb.recipes
  add column if not exists cooked_weight_g numeric check (cooked_weight_g > 0),
  add column if not exists yield_cups numeric check (yield_cups > 0);
