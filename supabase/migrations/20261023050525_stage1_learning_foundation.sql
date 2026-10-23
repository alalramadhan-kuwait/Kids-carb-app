-- Stage 1 of the learning plan (docs/AUDIT_STAGE0.md §6): additive only. No column or table dropped, no existing row of
-- events or meal_history rewritten (an update there would fire the audit and mark old entries edited).

-- 1. Every frozen prediction says which model made it. All rows so far are the linear-carb v1.
alter table carb.predictions add column if not exists model_version text not null default 'v1-linear';
comment on column carb.predictions.model_version is 'Model that froze this prediction; v1-linear = linear COB over cob_absorb_min, exponential IOB, doctor''s CR/ISF';

-- 2. A treatment's purpose: a low rescue or a drink with food. Null = not said (all past rows).
alter table carb.events add column if not exists treat_purpose text check (treat_purpose in ('low', 'drink'));
comment on column carb.events.treat_purpose is 'For kind=treatment: low (rescue) or drink (with food). Null = unknown; never inferred.';

-- 3. Influences entered by a parent (illness, stress). Empty = nothing said, not "none".
alter table carb.events add column if not exists tags text[] check (tags <@ array['illness', 'stress']::text[]);
comment on column carb.events.tags is 'User-entered influences on the day/entry. Absent = not recorded.';

-- 4. Which rapid dose went with which meal, kept apart from the originals. 'inferred' = the only meal and the only dose
--    near each other (meal 30 min before to 20 min after the dose); 'user' = a parent said so.
create table if not exists carb.dose_meal_links (
  event_id   uuid not null references carb.events(id),
  meal_id    uuid not null references carb.meal_history(id),
  source     text not null check (source in ('inferred', 'user')),
  rule       text,
  created_at timestamptz not null default now(),
  primary key (event_id, meal_id)
);
alter table carb.dose_meal_links enable row level security;
create policy dose_meal_links_members on carb.dose_meal_links for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update, delete on carb.dose_meal_links to authenticated;

with d as (
  select e.id, e.occurred_at t from carb.events e
  where e.deleted_at is null and e.kind = 'insulin' and e.insulin_type = 'rapid' and coalesce(e.bolus_purpose, 'meal') <> 'correction'),
m as (
  select h.id, h.eaten_at t from carb.meal_history h
  where h.deleted_at is null and coalesce(h.intake, '') <> 'pending' and h.kind is distinct from 'treatment'),
pairs as (
  select d.id event_id, m.id meal_id from d join m on m.t between d.t - interval '30 min' and d.t + interval '20 min'),
one as (
  select p.* from pairs p
  where (select count(*) from pairs q where q.event_id = p.event_id) = 1
    and (select count(*) from pairs q where q.meal_id = p.meal_id) = 1)
insert into carb.dose_meal_links (event_id, meal_id, source, rule)
select event_id, meal_id, 'inferred', 'only meal -30/+20 min of the only non-correction rapid dose' from one
on conflict do nothing;

-- 5. Care-team parameters with dates. From now on every change in settings is recorded by a trigger; the past is
--    rebuilt from the frozen predictions (the parameters each one was made with) and marked approximate.
create table if not exists carb.param_history (
  id             bigint generated always as identity primary key,
  effective_from timestamptz not null,
  seen_until     timestamptz,
  dia            integer, peak integer, absorb integer,
  ratios         jsonb,
  target_mgdl    integer, target_high_mgdl integer, dose_to_meal_min integer,
  source         text not null check (source in ('settings', 'reconstructed')),
  approximate    boolean not null default false,
  n_predictions  integer,
  changed_by     uuid,
  created_at     timestamptz not null default now()
);
comment on table carb.param_history is 'Care-team parameters over time. reconstructed = observed in frozen predictions (one CR/ISF block each, first/last seen), approximate.';
alter table carb.param_history enable row level security;
create policy param_history_members on carb.param_history for select using (carb.is_member());
grant select on carb.param_history to authenticated;

insert into carb.param_history (effective_from, seen_until, dia, peak, absorb, ratios, source, approximate, n_predictions)
select min(t0), max(t0), (params->>'dia')::int, (params->>'peak')::int, (params->>'absorb')::int,
       jsonb_build_array(jsonb_build_object('cr', (params->>'cr')::numeric, 'isf', (params->>'isf')::numeric)),
       'reconstructed', true, count(*)
from carb.predictions group by params->>'dia', params->>'peak', params->>'absorb', params->>'cr', params->>'isf';

insert into carb.param_history (effective_from, dia, peak, absorb, ratios, target_mgdl, target_high_mgdl, dose_to_meal_min, source)
select now(), iob_dia_min, iob_peak_min, cob_absorb_min, ratios, target_mgdl, target_high_mgdl, dose_to_meal_min, 'settings'
from carb.settings;

create or replace function carb.param_history_record() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if (new.iob_dia_min, new.iob_peak_min, new.cob_absorb_min, new.ratios, new.target_mgdl, new.target_high_mgdl, new.dose_to_meal_min)
     is distinct from (old.iob_dia_min, old.iob_peak_min, old.cob_absorb_min, old.ratios, old.target_mgdl, old.target_high_mgdl, old.dose_to_meal_min) then
    insert into carb.param_history (effective_from, dia, peak, absorb, ratios, target_mgdl, target_high_mgdl, dose_to_meal_min, source, changed_by)
    values (now(), new.iob_dia_min, new.iob_peak_min, new.cob_absorb_min, new.ratios, new.target_mgdl, new.target_high_mgdl, new.dose_to_meal_min, 'settings', auth.uid());
  end if;
  return new;
end $$;
create trigger settings_param_history after update on carb.settings for each row execute function carb.param_history_record();

-- 6. Reading quality, derived on read (nothing stored or corrected): seconds since the previous reading, a jump of more
--    than 30 mg/dL within 2 minutes, a gap of more than 20 minutes before it, and the sensor's first hour.
create or replace view carb.glucose_quality with (security_invoker = true) as
select r.taken_at, r.mg_dl, r.source,
       extract(epoch from r.taken_at - lag(r.taken_at) over w)::int as sec_since_prev,
       coalesce(abs(r.mg_dl - lag(r.mg_dl) over w) > 30 and r.taken_at - lag(r.taken_at) over w < interval '2 min', false) as jump,
       coalesce(r.taken_at - lag(r.taken_at) over w > interval '20 min', false) as gap_before,
       s.sn as sensor_sn,
       coalesce(r.taken_at < s.started_at + interval '60 min', false) as warmup
from carb.glucose_readings r
left join lateral (select sn, started_at from carb.sensors x where x.started_at <= r.taken_at order by x.started_at desc limit 1) s on true
window w as (order by r.taken_at);
grant select on carb.glucose_quality to authenticated;
