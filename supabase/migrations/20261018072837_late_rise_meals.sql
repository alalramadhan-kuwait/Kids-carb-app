-- Meals that rose late in Layan's own readings: by name, at least twice and in at least 60% of the clean times
-- (no other food from 90 min to 5 h, no low treatment), rise ≥ 36 mg/dL from the 2–3 h low to the 3–5 h high.
-- Read by the app for the «ممكن تأثير متأخر» notice only; never a dose.
create or replace function carb.late_rise_meals()
returns table (name text, late_n int, clean_n int)
language sql stable security invoker set search_path = carb, public as $$
  with m as (
    select id, lower(trim(h.name)) nm, eaten_at, total_fat, total_protein from carb.meal_history h
    where deleted_at is null and coalesce(intake, 'confirmed') <> 'pending'
      and eaten_at > now() - interval '120 days' and eaten_at < now() - interval '5 hours'
      and lower(trim(h.name)) not in ('فطور','غدا','غداء','عشا','عشاء','سناك','وجبة','breakfast','lunch','dinner','snack','meal')
      and (coalesce(total_fat, 0) >= 10 or coalesce(total_protein, 0) >= 15)),
  w as (
    select m.nm,
      (select min(mg_dl) from carb.glucose_readings r where r.taken_at between m.eaten_at + interval '2 hours' and m.eaten_at + interval '3 hours') lo,
      (select max(mg_dl) from carb.glucose_readings r where r.taken_at between m.eaten_at + interval '3 hours' and m.eaten_at + interval '5 hours') hi
    from m
    where not exists (select 1 from carb.meal_history x where x.deleted_at is null and x.id <> m.id and x.eaten_at > m.eaten_at + interval '90 minutes' and x.eaten_at < m.eaten_at + interval '5 hours')
      and not exists (select 1 from carb.events e where e.deleted_at is null and e.kind = 'treatment' and e.occurred_at > m.eaten_at and e.occurred_at < m.eaten_at + interval '5 hours'))
  select nm, (count(*) filter (where hi - lo >= 36))::int, count(*)::int
  from w where lo is not null and hi is not null
  group by nm
  having count(*) filter (where hi - lo >= 36) >= 2 and count(*) filter (where hi - lo >= 36) >= 0.6 * count(*)
$$;
grant execute on function carb.late_rise_meals() to authenticated;
