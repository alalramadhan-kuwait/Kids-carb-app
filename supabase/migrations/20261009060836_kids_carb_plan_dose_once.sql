-- 3. A planned meal's dose, recorded in one step: the plan and its insulin entry change together or not at all.
--    The same submission sent twice (a retry after a weak connection) saves once. A plan already dosed, or a rapid
--    dose in the last 15 minutes, is never saved over or silently dropped: it is returned so the parent can see it
--    and decide (p_separate = true records it as a separate dose that was also given).
create or replace function carb.record_plan_dose(
  p_plan uuid, p_client uuid, p_units numeric, p_purpose text, p_reason text, p_snapshot jsonb,
  p_calc numeric, p_carbs numeric, p_site text default null, p_separate boolean default false
) returns json
language plpgsql set search_path = '' as $$
declare pl carb.planned_meals; ev carb.events; prev carb.events; nowt timestamptz := now();
begin
  if not carb.is_member() then raise exception 'not allowed'; end if;
  select * into pl from carb.planned_meals where id = p_plan for update;
  if not found then return json_build_object('status', 'no_plan'); end if;
  -- this exact submission already went through (the answer was lost on the way back)
  select * into ev from carb.events where client_id = p_client;
  if found then return json_build_object('status', 'ok', 'event_id', ev.id, 'repeat', true); end if;
  if not p_separate then
    if pl.status <> 'planned' and pl.dose_event_id is not null then
      select * into prev from carb.events where id = pl.dose_event_id and deleted_at is null;
      if found then
        return json_build_object('status', 'already_dosed', 'event', json_build_object('id', prev.id, 'units', prev.insulin_units, 'at', prev.occurred_at, 'by', prev.created_by));
      end if;
    end if;
    select * into prev from carb.events where kind = 'insulin' and insulin_type = 'rapid' and deleted_at is null
      and occurred_at between nowt - interval '15 minutes' and nowt + interval '5 minutes' order by occurred_at desc limit 1;
    if found then
      return json_build_object('status', 'recent_dose', 'event', json_build_object('id', prev.id, 'units', prev.insulin_units, 'at', prev.occurred_at, 'by', prev.created_by));
    end if;
  end if;
  insert into carb.events (client_id, kind, occurred_at, insulin_units, insulin_type, bolus_purpose, note, dose_calc, injection_site)
    values (p_client, 'insulin', nowt, p_units, 'rapid', p_purpose, p_reason, p_snapshot, p_site) returning * into ev;
  if pl.status = 'planned' or pl.dose_event_id is null then
    update carb.planned_meals set status = case when status = 'planned' then 'dosed' else status end, dose_event_id = ev.id,
      dosed_at = nowt, dose_at = nowt, recheck_at = null, calc_units = p_calc, given_units = p_units,
      dose_reason = nullif(trim(coalesce(p_reason, '')), ''), dose_snapshot = p_snapshot, carbs_planned = round(p_carbs, 1), updated_at = nowt
      where id = p_plan;
  end if;
  return json_build_object('status', 'ok', 'event_id', ev.id);
end $$;
revoke all on function carb.record_plan_dose(uuid, uuid, numeric, text, text, jsonb, numeric, numeric, text, boolean) from public, anon;
grant execute on function carb.record_plan_dose(uuid, uuid, numeric, text, text, jsonb, numeric, numeric, text, boolean) to authenticated;

-- 5. Shared views leave deleted meals out.
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
    -- the same inputs as the app's IOB / COB (engine/iob.ts): rapid doses, and carbs from meals and from carb or
    -- low-treatment entries, over the last 12 hours; the care team's parameters (null when not set)
    'onboard', case when l.onboard then json_build_object(
      'dia', s.iob_dia_min, 'peak', s.iob_peak_min, 'absorb', s.cob_absorb_min,
      'doses', (select coalesce(json_agg(json_build_object('t', occurred_at, 'u', insulin_units) order by occurred_at), '[]'::json)
                from carb.events where deleted_at is null and kind = 'insulin' and coalesce(insulin_type, 'rapid') <> 'long'
                and insulin_units is not null and occurred_at > now() - interval '12 hours' and occurred_at <= now()),
      'carbs', (select coalesce(json_agg(json_build_object('t', x.t, 'g', x.g) order by x.t), '[]'::json) from (
                  select eaten_at t, total_carbs g from carb.meal_history where deleted_at is null and eaten_at > now() - interval '12 hours' and eaten_at <= now()
                  union all
                  select occurred_at, carbs_g from carb.events where deleted_at is null and kind in ('carbs', 'treatment') and carbs_g > 0
                  and occurred_at > now() - interval '12 hours' and occurred_at <= now()) x)
    ) end
  ) into res;
  return res;
end $function$;

-- 4. The other parent sees a new meal at once, as insulin already is.
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'carb' and tablename = 'meal_history') then
    alter publication supabase_realtime add table carb.meal_history;
  end if;
end $$;
