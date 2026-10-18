-- Meals eaten while already low (a juice, a snack for a low) are not judged; a signal needs at least twice and
-- 30% (early drop) or 50% (late rise) of the times it could be judged. The app says how many times («مرتين»).
create or replace function carb.meal_learning()
returns table (key text, early boolean, late boolean, early_n int, late_n int, seen_n int)
language sql stable security invoker set search_path = carb, public as $$
  with m as (
    select h.id, carb.meal_key(h.lines, h.name) k, h.eaten_at from carb.meal_history h
    where h.deleted_at is null and coalesce(h.intake, 'confirmed') <> 'pending'
      and h.eaten_at > now() - interval '120 days' and h.eaten_at < now() - interval '5 hours'
      and coalesce((select min(mg_dl) from carb.glucose_readings r where r.taken_at between h.eaten_at - interval '15 minutes' and h.eaten_at + interval '15 minutes'), 999) >= 80),
  w as (
    select m.k,
      case when exists (select 1 from carb.meal_history x where x.deleted_at is null and x.id <> m.id and x.eaten_at > m.eaten_at + interval '30 minutes' and x.eaten_at < m.eaten_at + interval '150 minutes') then null
           when exists (select 1 from carb.events e where e.deleted_at is null and e.kind = 'treatment' and e.occurred_at > m.eaten_at + interval '30 minutes' and e.occurred_at < m.eaten_at + interval '150 minutes') then true
           else (select min(mg_dl) < 70 from carb.glucose_readings r where r.taken_at between m.eaten_at + interval '30 minutes' and m.eaten_at + interval '150 minutes') end early,
      case when exists (select 1 from carb.meal_history x where x.deleted_at is null and x.id <> m.id and x.eaten_at > m.eaten_at + interval '90 minutes' and x.eaten_at < m.eaten_at + interval '5 hours')
             or exists (select 1 from carb.events e where e.deleted_at is null and e.kind = 'treatment' and e.occurred_at > m.eaten_at and e.occurred_at < m.eaten_at + interval '5 hours') then null
           else (select max(mg_dl) from carb.glucose_readings r where r.taken_at between m.eaten_at + interval '3 hours' and m.eaten_at + interval '5 hours')
              - (select min(mg_dl) from carb.glucose_readings r where r.taken_at between m.eaten_at + interval '2 hours' and m.eaten_at + interval '3 hours') >= 36 end late
    from m where m.k is not null),
  g as (
    select k, count(*) filter (where early) e_n, count(early) e_seen, count(*) filter (where late) l_n, count(late) l_seen from w group by k)
  select k, e_n >= 2 and e_n >= 0.3 * e_seen, l_n >= 2 and l_n >= 0.5 * l_seen, e_n::int, l_n::int, greatest(e_seen, l_seen)::int
  from g where (e_n >= 2 and e_n >= 0.3 * e_seen) or (l_n >= 2 and l_n >= 0.5 * l_seen)
$$;
