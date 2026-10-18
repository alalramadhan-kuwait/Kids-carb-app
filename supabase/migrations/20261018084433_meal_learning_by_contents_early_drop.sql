-- Learn from Layan's own readings, by what the meal was (its foods), not its name: «فطور» and «ريوق» with the same
-- toast, egg and cheese are one meal. Two signals, each at least twice and in most of the times it can be judged:
--   early: below 3.9 (70 mg/dL), or a low treated, 30–150 min after eating (judged even when a juice followed);
--   late:  a rise ≥ 36 mg/dL from the 2–3 h low to the 3–5 h high, only when nothing else was eaten or treated.
-- Read by the app for notices only; it never changes a dose. Replaces carb.late_rise_meals() (by name, late only).
create or replace function carb.meal_key(p_lines jsonb, p_name text)
returns text language sql immutable set search_path = carb, public as $$
  select coalesce(
    (select string_agg(k, ' + ' order by k collate "C") from (
       select distinct lower(trim(coalesce(nullif(trim(l->>'product'), ''), l->>'name'))) k
       from jsonb_array_elements(case when jsonb_typeof(p_lines) = 'array' then p_lines else '[]'::jsonb end) l) s
     where k <> ''),
    case when lower(trim(coalesce(p_name, ''))) in ('', 'فطور','ريوق','غدا','غداء','عشا','عشاء','سناك','وجبة','breakfast','lunch','dinner','snack','meal') then null
         else 'n:' || lower(trim(p_name)) end)
$$;

create or replace function carb.meal_learning()
returns table (key text, early boolean, late boolean, early_n int, late_n int, seen_n int)
language sql stable security invoker set search_path = carb, public as $$
  with m as (
    select h.id, carb.meal_key(h.lines, h.name) k, h.eaten_at from carb.meal_history h
    where h.deleted_at is null and coalesce(h.intake, 'confirmed') <> 'pending'
      and h.eaten_at > now() - interval '120 days' and h.eaten_at < now() - interval '5 hours'),
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
  select k, e_n >= 2 and e_n >= 0.5 * e_seen, l_n >= 2 and l_n >= 0.6 * l_seen, e_n::int, l_n::int, greatest(e_seen, l_seen)::int
  from g where (e_n >= 2 and e_n >= 0.5 * e_seen) or (l_n >= 2 and l_n >= 0.6 * l_seen)
$$;
grant execute on function carb.meal_key(jsonb, text) to authenticated;
grant execute on function carb.meal_learning() to authenticated;
