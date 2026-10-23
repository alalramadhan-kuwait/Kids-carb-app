-- Stage 3 of the learning plan: where the forecast benchmark and the shadow forecasts are kept (carb-benchmark).
-- Additive only. Shadow forecasts are written once and never shown to anyone; results are summary numbers.

create table if not exists carb.benchmark_runs (
  id            bigint generated always as identity primary key,
  created_at    timestamptz not null default now(),
  bench_version text not null,
  data_from     timestamptz not null,
  data_to       timestamptz not null,
  test_from     timestamptz not null,
  result        jsonb not null
);
comment on table carb.benchmark_runs is 'Daily forecast benchmark (src/engine/benchmark.ts): per model and horizon, test-week scores, error bands from the training period, and the gap to "no change" with a day-resampled 95% interval.';
alter table carb.benchmark_runs enable row level security;
create policy benchmark_runs_members on carb.benchmark_runs for select using (carb.is_member());
grant select on carb.benchmark_runs to authenticated;

create table if not exists carb.forecast_shadow (
  model         text not null,
  model_version text not null,
  bench_version text not null,
  origin        timestamptz not null,
  horizon_min   integer not null check (horizon_min in (30, 60, 120, 240)),
  g0            numeric not null,
  value_mgdl    integer not null,
  lo_mgdl       integer,
  hi_mgdl       integer,
  context       text,
  created_at    timestamptz not null default now(),
  primary key (model, origin, horizon_min)
);
comment on table carb.forecast_shadow is 'Shadow mode: each candidate''s forecast stored at the time it was made, from what was known then. Never shown, never rewritten.';
alter table carb.forecast_shadow enable row level security;
create policy forecast_shadow_members on carb.forecast_shadow for select using (carb.is_member());
grant select on carb.forecast_shadow to authenticated;

-- each shadow forecast beside the reading that came true (nearest within 5 minutes), once it exists
create or replace view carb.forecast_shadow_scored with (security_invoker = true) as
select f.*, r.mg_dl as actual_mgdl, f.value_mgdl - r.mg_dl as error_mgdl,
       (r.mg_dl between f.lo_mgdl and f.hi_mgdl) as in_band
from carb.forecast_shadow f
left join lateral (
  select g.mg_dl from carb.glucose_readings g
  where g.taken_at between f.origin + make_interval(mins => f.horizon_min) - interval '5 min' and f.origin + make_interval(mins => f.horizon_min) + interval '5 min'
  order by abs(extract(epoch from g.taken_at - (f.origin + make_interval(mins => f.horizon_min)))) limit 1) r on true;
grant select on carb.forecast_shadow_scored to authenticated;
