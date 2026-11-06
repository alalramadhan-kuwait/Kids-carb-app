-- A meal dose logged from a food ("سجّل الأكل + إنسولين") keeps which meal it was for, so the meal and its dose are one
-- record for the reviews and the calculator, whatever order or time they were entered in.
alter table carb.events add column if not exists meal_id uuid references carb.meal_history(id) on delete set null;
create index if not exists events_meal_id_idx on carb.events (meal_id) where meal_id is not null;
comment on column carb.events.meal_id is 'The meal (meal_history) this dose was given for, when it was logged from that meal';
