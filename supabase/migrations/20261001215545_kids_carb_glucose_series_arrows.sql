-- Readings with Abbott's trend arrow (1–5, null when none), to score Libre's arrow against the app's own trend.
create or replace function carb.glucose_series_arrows(p_from timestamptz, p_to timestamptz)
returns json language sql stable set search_path to '' as $$
  select json_build_object(
    't', coalesce(json_agg(extract(epoch from taken_at)::bigint order by taken_at), '[]'::json),
    'v', coalesce(json_agg(mg_dl order by taken_at), '[]'::json),
    'a', coalesce(json_agg(trend order by taken_at), '[]'::json))
  from carb.glucose_readings
  where taken_at >= p_from and taken_at < p_to and p_to - p_from <= interval '31 days'
$$;
revoke all on function carb.glucose_series_arrows(timestamptz, timestamptz) from public, anon;
grant execute on function carb.glucose_series_arrows(timestamptz, timestamptz) to authenticated;
