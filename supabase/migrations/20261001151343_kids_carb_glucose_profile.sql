-- Stage 6: the 24-hour percentile profile (AGP / Patterns). Readings in [p_from, p_to), optionally only on
-- some Kuwait weekdays (0 = Sunday), grouped into p_bin_min-minute bins of the local clock. Each bin gives
-- the 10th/25th/50th/75th/90th percentiles and how many distinct days contributed. RLS applies.
create function carb.glucose_profile(p_from timestamptz, p_to timestamptz, p_dows int[] default null, p_bin_min int default 15)
returns json language sql stable set search_path = '' as $$
  with r as (
    select (taken_at at time zone 'Asia/Kuwait') as lt, mg_dl
    from carb.glucose_readings
    where taken_at >= p_from and taken_at < p_to and p_to - p_from <= interval '100 days'
  ), b as (
    select floor((extract(hour from lt) * 60 + extract(minute from lt)) / p_bin_min)::int as bin, lt::date as d, mg_dl
    from r where p_dows is null or extract(dow from lt)::int = any (p_dows)
  )
  select coalesce(json_agg(x order by x.bin), '[]'::json) from (
    select bin, count(distinct d) as days, count(*) as n,
      round(percentile_cont(0.10) within group (order by mg_dl)::numeric, 1) as p10,
      round(percentile_cont(0.25) within group (order by mg_dl)::numeric, 1) as p25,
      round(percentile_cont(0.50) within group (order by mg_dl)::numeric, 1) as p50,
      round(percentile_cont(0.75) within group (order by mg_dl)::numeric, 1) as p75,
      round(percentile_cont(0.90) within group (order by mg_dl)::numeric, 1) as p90
    from b group by bin
  ) x
$$;
revoke all on function carb.glucose_profile(timestamptz, timestamptz, int[], int) from public, anon;
grant execute on function carb.glucose_profile(timestamptz, timestamptz, int[], int) to authenticated;
