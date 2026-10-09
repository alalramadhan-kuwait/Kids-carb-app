-- Release 2.
-- 1. The kind of meal (breakfast, lunch, dinner, snack) is its own field: choosing it never replaces the food's name.
alter table carb.meal_history add column if not exists meal_slot text check (meal_slot in ('breakfast', 'lunch', 'dinner', 'snack'));
-- meals simple mode logged under a slot name get that slot (their names stay as they are)
update carb.meal_history set meal_slot = case name when 'فطور' then 'breakfast' when 'غدا' then 'lunch' when 'عشا' then 'dinner' when 'سناك' then 'snack' end
  where meal_slot is null and name in ('فطور', 'غدا', 'عشا', 'سناك');

-- 2. A meal is saved as soon as its dose is: 'pending' until a parent says how much she ate. A pending meal is in the
--    Log, but is never counted as eaten (nutrition, carbs on board, reports, sharing read only 'confirmed').
alter table carb.meal_history add column if not exists intake text not null default 'confirmed' check (intake in ('confirmed', 'pending'));

-- 3. A meal corrected after its dose: the dose recalculated for review, with the settings saved with that dose (never
--    today's). Rows are only ever added: the history of each correction stays, with who and when. The dose actually
--    given is read from its own entry and is never changed by this.
create table if not exists carb.dose_recalcs (
  id uuid primary key default gen_random_uuid(),
  at timestamptz not null default now(),
  by uuid default auth.uid(),
  history_id uuid not null references carb.meal_history(id) on delete cascade,
  plan_id uuid references carb.planned_meals(id) on delete set null,
  event_id uuid references carb.events(id) on delete set null,
  carbs_at_dose numeric,           -- the carbs the dose was calculated for
  dose_at_dose numeric,            -- what the calculator showed then
  carbs_before numeric not null,   -- the meal before this correction
  carbs_after numeric not null,    -- the meal after it
  dose_after numeric not null,     -- the same calculation with the corrected carbs (review only)
  given_units numeric,             -- what was actually given, as recorded at the time of this correction
  inputs jsonb not null,           -- the saved calculation inputs used (ratio, correction factor, target, glucose, insulin on board, pen step)
  reason text                      -- 'items', 'carbs', 'part' (how much she ate)
);
create index if not exists dose_recalcs_meal_idx on carb.dose_recalcs (history_id, at desc);
alter table carb.dose_recalcs enable row level security;
create policy dose_recalcs_read on carb.dose_recalcs for select using (carb.is_member());
create policy dose_recalcs_add on carb.dose_recalcs for insert with check (carb.is_member());
-- no update or delete policy: the review history cannot be rewritten

-- 4. Shared views count only meals she is known to have eaten.
create or replace function carb.share_view(p_token text) returns json
language plpgsql security definer set search_path = '' as $function$
declare l carb.share_links; s carb.settings; cp carb.care_plan; res json;
begin
  select * into l from carb.share_links
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null and expires_at > now();
  if not found then return json_build_object('error', 'invalid'); end if;
  update carb.share_links set last_used_at = now() where id = l.id;
  select * into s from carb.settings where id;
  select * into cp from carb.care_plan where id;
  select json_build_object(
    'scope', l.scope, 'label', l.label, 'expires_at', l.expires_at,
    'child', s.child_name, 'unit', s.glucose_unit, 'low', coalesce(s.glucose_low_mgdl, 70), 'high', coalesce(s.glucose_high_mgdl, 180),
    'alarm_high', s.alert_high_mgdl,
    'reference', s.glucose_low_mgdl is null and s.glucose_high_mgdl is null,
    'readings', (select coalesce(json_agg(json_build_object('t', taken_at, 'v', mg_dl, 'trend', trend) order by taken_at), '[]'::json)
                 from carb.glucose_readings where taken_at > now() - interval '12 hours'),
    'care_plan', case when l.scope = 'school' then json_build_object('hypo', cp.hypo, 'hyper', cp.hyper, 'contacts', cp.contacts) end,
    'onboard', case when l.onboard then json_build_object(
      'dia', s.iob_dia_min, 'peak', s.iob_peak_min, 'absorb', s.cob_absorb_min,
      'doses', (select coalesce(json_agg(json_build_object('t', occurred_at, 'u', insulin_units) order by occurred_at), '[]'::json)
                from carb.events where deleted_at is null and kind = 'insulin' and coalesce(insulin_type, 'rapid') <> 'long'
                and insulin_units is not null and occurred_at > now() - interval '12 hours' and occurred_at <= now()),
      'carbs', (select coalesce(json_agg(json_build_object('t', x.t, 'g', x.g) order by x.t), '[]'::json) from (
                  select eaten_at t, total_carbs g from carb.meal_history where deleted_at is null and intake = 'confirmed' and eaten_at > now() - interval '12 hours' and eaten_at <= now()
                  union all
                  select occurred_at, carbs_g from carb.events where deleted_at is null and kind in ('carbs', 'treatment') and carbs_g > 0
                  and occurred_at > now() - interval '12 hours' and occurred_at <= now()) x)
    ) end
  ) into res;
  return res;
end $function$;
