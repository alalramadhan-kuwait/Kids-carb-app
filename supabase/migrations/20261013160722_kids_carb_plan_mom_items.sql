-- Simple mode: a planned meal keeps the plate as chosen (foods and portions), so it can be changed before its dose.
alter table carb.planned_meals add column if not exists mom_items jsonb;
comment on column carb.planned_meals.mom_items is 'Simple mode: the plate as chosen (foods with their portions), so the plan can be edited later';
