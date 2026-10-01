-- Stage 7: readings around several moments in one call (meal response). For each time t0, the readings from
-- p_before minutes before to p_after minutes after, as minutes-from-t0 and mg/dL. At most 200 moments. RLS applies.
create function carb.glucose_windows(p_times timestamptz[], p_before int default 60, p_after int default 240)
returns json language sql stable set search_path = '' as $$
  select coalesce(json_agg(json_build_object('t0', t0, 'o', w.o, 'v', w.v) order by t0), '[]'::json)
  from unnest(p_times[1:200]) as t0
  cross join lateral (
    select coalesce(json_agg(round((extract(epoch from (g.taken_at - t0)) / 60.0)::numeric, 2) order by g.taken_at), '[]'::json) as o,
           coalesce(json_agg(g.mg_dl order by g.taken_at), '[]'::json) as v
    from carb.glucose_readings g
    where g.taken_at >= t0 - make_interval(mins => p_before) and g.taken_at <= t0 + make_interval(mins => p_after)
  ) w
$$;
revoke all on function carb.glucose_windows(timestamptz[], int, int) from public, anon;
grant execute on function carb.glucose_windows(timestamptz[], int, int) to authenticated;
