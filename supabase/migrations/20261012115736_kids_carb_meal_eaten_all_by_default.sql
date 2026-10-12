-- A planned meal saved with its dose waits as 'pending' until someone says how much she ate. Families often forget,
-- so it now counts as all of it by default: 10 minutes after its eat time (after the "time to eat" push has gone),
-- the meal is confirmed as eaten in full and the plan marked eaten (part 1, part_auto = true). A parent can still
-- change the part afterwards in the app. Nothing about the dose changes.
alter table carb.planned_meals add column if not exists part_auto boolean not null default false;

create or replace function carb.confirm_pending_meals() returns integer
language plpgsql security definer set search_path = carb, public as $$
declare n integer := 0; r record; g record;
begin
  for r in
    select h.id, h.client_id, h.eaten_at, h.total_carbs from carb.meal_history h
    where h.intake = 'pending' and h.deleted_at is null and h.eaten_at <= now() - interval '10 minutes'
    for update skip locked
  loop
    select taken_at, mg_dl, trend into g from carb.glucose_readings
      where taken_at between r.eaten_at - interval '10 minutes' and r.eaten_at + interval '10 minutes'
      order by abs(extract(epoch from taken_at - r.eaten_at)) limit 1;
    update carb.meal_history set intake = 'confirmed',
      glucose_mgdl = coalesce(glucose_mgdl, g.mg_dl), glucose_trend = coalesce(glucose_trend, g.trend), glucose_at = coalesce(glucose_at, g.taken_at)
      where id = r.id;
    update carb.planned_meals set status = 'eaten', history_id = r.id, eaten_at = now(), eating_at = coalesce(eating_at, r.eaten_at),
      part_eaten = 1, part_auto = true, carbs_planned = coalesce(carbs_planned, r.total_carbs), carbs_eaten = r.total_carbs
      where id = r.client_id and status = 'dosed';
    n := n + 1;
  end loop;
  return n;
end $$;
revoke all on function carb.confirm_pending_meals() from public, anon, authenticated;

select cron.schedule('carb-confirm-meals', '* * * * *', 'select carb.confirm_pending_meals()');
