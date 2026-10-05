-- A planned meal points to the entry logged when she ate it. If that entry is deleted (e.g. undo, then logged again),
-- the link is cleared instead of pointing at nothing; the dietitian sheet then matches the plan by its eating time.
-- 1. repair the one broken link (4 Oct dinner, re-logged as a new entry at the same minute)
update carb.planned_meals p set history_id = m.id
from carb.meal_history m
where p.history_id is not null
  and not exists (select 1 from carb.meal_history x where x.id = p.history_id)
  and p.eating_at is not null
  and abs(extract(epoch from (m.eaten_at - p.eating_at))) <= 600
  and not exists (select 1 from carb.planned_meals q where q.history_id = m.id);
-- 2. anything still pointing at a missing entry is cleared
update carb.planned_meals p set history_id = null
where p.history_id is not null and not exists (select 1 from carb.meal_history x where x.id = p.history_id);
-- 3. from now on the database keeps the link honest
alter table carb.planned_meals
  add constraint planned_meals_history_id_fkey foreign key (history_id) references carb.meal_history(id) on delete set null;
