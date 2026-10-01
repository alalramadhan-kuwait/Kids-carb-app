-- Step 2/3: one log for insulin, carbs, hypo treatment and notes, and time-in-range statistics.

create table carb.events (
  id            uuid primary key default gen_random_uuid(),
  client_id     uuid not null unique,                 -- generated on the phone: a double tap saves once
  kind          text not null check (kind in ('insulin', 'carbs', 'treatment', 'note')),
  occurred_at   timestamptz not null default now(),
  insulin_units numeric check (insulin_units > 0 and insulin_units < 100),
  insulin_type  text check (insulin_type in ('rapid', 'long')),
  bolus_purpose text check (bolus_purpose in ('meal', 'correction', 'both')),
  carbs_g       numeric check (carbs_g >= 0 and carbs_g < 500),
  treatment     text,                                 -- juice, tablets, other
  note          text,
  created_by    uuid not null default auth.uid(),
  created_at    timestamptz not null default now(),
  edited_by     uuid,
  edited_at     timestamptz,
  deleted_by    uuid,
  deleted_at    timestamptz,
  check (kind <> 'insulin' or (insulin_units is not null and insulin_type is not null)),
  check (kind not in ('carbs', 'treatment') or carbs_g is not null),
  check (kind <> 'note' or coalesce(trim(note), '') <> '')
);
create index events_time_idx on carb.events (occurred_at desc);

alter table carb.events enable row level security;
create policy events_members on carb.events for all to authenticated using (carb.is_member()) with check (carb.is_member());
grant select, insert, update, delete on carb.events to authenticated;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'carb' and tablename = 'events') then
    alter publication supabase_realtime add table carb.events;
  end if;
end $$;

-- Time-weighted glucose statistics for a period. Each reading counts until the next one, capped at 15 min,
-- so a gap is never counted as time in any band. Bands are the international reporting bands (mg/dL);
-- p_low / p_high are the parents' own range for "in her target". Runs with the caller's rights (RLS).
create function carb.glucose_stats(p_from timestamptz, p_to timestamptz, p_low numeric default null, p_high numeric default null)
returns table (n bigint, covered_min numeric, period_min numeric, coverage numeric,
               pct_vlow numeric, pct_low numeric, pct_in numeric, pct_high numeric, pct_vhigh numeric, pct_target numeric,
               mean_mgdl numeric, sd_mgdl numeric, min_mgdl int, max_mgdl int)
language sql stable set search_path = '' as $$
  with r as (
    select taken_at, mg_dl, lead(taken_at) over (order by taken_at) as nxt
    from carb.glucose_readings where taken_at >= p_from and taken_at < p_to
  ), w as (
    select mg_dl,
      greatest(0, extract(epoch from least(coalesce(nxt, least(p_to, now())), taken_at + interval '15 minutes', p_to) - taken_at) / 60.0)::numeric as mins
    from r
  ), m as (
    select sum(mins) as tot, sum(mg_dl * mins) / nullif(sum(mins), 0) as mean from w
  )
  select count(*)::bigint,
    round(coalesce(m.tot, 0), 1),
    round((extract(epoch from (least(p_to, now()) - p_from)) / 60.0)::numeric, 1),
    round(100 * coalesce(m.tot, 0) / nullif((extract(epoch from (least(p_to, now()) - p_from)) / 60.0)::numeric, 0), 1),
    round(100 * sum(w.mins) filter (where w.mg_dl < 54) / nullif(m.tot, 0), 1),
    round(100 * sum(w.mins) filter (where w.mg_dl >= 54 and w.mg_dl < 70) / nullif(m.tot, 0), 1),
    round(100 * sum(w.mins) filter (where w.mg_dl >= 70 and w.mg_dl <= 180) / nullif(m.tot, 0), 1),
    round(100 * sum(w.mins) filter (where w.mg_dl > 180 and w.mg_dl <= 250) / nullif(m.tot, 0), 1),
    round(100 * sum(w.mins) filter (where w.mg_dl > 250) / nullif(m.tot, 0), 1),
    case when p_low is null and p_high is null then null else
      round(100 * sum(w.mins) filter (where w.mg_dl >= coalesce(p_low, 0) and w.mg_dl <= coalesce(p_high, 1000)) / nullif(m.tot, 0), 1) end,
    round(m.mean, 1),
    round(sqrt(sum(w.mins * power(w.mg_dl - m.mean, 2)) / nullif(m.tot, 0)), 1),
    min(w.mg_dl), max(w.mg_dl)
  from w cross join m
  group by m.tot, m.mean
$$;
grant execute on function carb.glucose_stats(timestamptz, timestamptz, numeric, numeric) to authenticated;
