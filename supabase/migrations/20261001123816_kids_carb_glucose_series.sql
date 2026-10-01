-- Stage 2: the timeline engine loads readings for any window in one call, as two compact arrays
-- (epoch seconds, mg/dL). Returning one json value avoids the API row limit; RLS applies (invoker rights).
create function carb.glucose_series(p_from timestamptz, p_to timestamptz) returns json
language sql stable set search_path = '' as $$
  select json_build_object(
    't', coalesce(json_agg(extract(epoch from taken_at)::bigint order by taken_at), '[]'::json),
    'v', coalesce(json_agg(mg_dl order by taken_at), '[]'::json))
  from carb.glucose_readings
  where taken_at >= p_from and taken_at < p_to and p_to - p_from <= interval '100 days'
$$;
revoke all on function carb.glucose_series(timestamptz, timestamptz) from public, anon;
grant execute on function carb.glucose_series(timestamptz, timestamptz) to authenticated;
