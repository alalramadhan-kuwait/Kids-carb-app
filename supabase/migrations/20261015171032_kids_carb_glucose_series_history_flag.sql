-- glucose_series also says which rows have no trend arrow (Libre's 15-minute history rows), so the home graph can
-- draw the minute readings and use a history row only where no minute reading exists. Same rows, same order; 'h' is new.
create or replace function carb.glucose_series(p_from timestamptz, p_to timestamptz)
returns json language sql stable set search_path to '' as $function$
  select json_build_object(
    't', coalesce(json_agg(extract(epoch from taken_at)::bigint order by taken_at), '[]'::json),
    'v', coalesce(json_agg(mg_dl order by taken_at), '[]'::json),
    'h', coalesce(json_agg((trend is null)::int order by taken_at), '[]'::json))
  from carb.glucose_readings
  where taken_at >= p_from and taken_at < p_to and p_to - p_from <= interval '100 days'
$function$;
