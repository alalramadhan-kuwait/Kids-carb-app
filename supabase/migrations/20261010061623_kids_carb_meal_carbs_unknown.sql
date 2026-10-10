-- Meals eaten out with their carbs not known (2.62.0). The carbs are marked unknown, never guessed: total_carbs stays
-- 0 (the column is required) and carbs_unknown says it means "not known"; the app reads it back as no number at all.
-- What was eaten (kinds of food), where, how big a plate, how much of it, and the parent's own guess (kept apart, never
-- used in a calculation). Typing the real carbs later clears carbs_unknown.
set local lock_timeout = '5s';

alter table carb.meal_history
  add column if not exists carbs_unknown boolean not null default false,
  add column if not exists foods text[],
  add column if not exists place text,
  add column if not exists plate_size text,
  add column if not exists ate text,
  add column if not exists carbs_guess numeric;

alter table carb.meal_history
  add constraint meal_history_unknown_zero check (not carbs_unknown or total_carbs = 0),
  add constraint meal_history_plate_size_check check (plate_size is null or plate_size in ('small', 'medium', 'large')),
  add constraint meal_history_ate_check check (ate is null or ate in ('all', 'half', 'little')),
  add constraint meal_history_carbs_guess_check check (carbs_guess is null or (carbs_guess >= 0 and carbs_guess <= 300)),
  add constraint meal_history_place_len check (place is null or length(place) <= 80),
  add constraint meal_history_foods_len check (foods is null or cardinality(foods) <= 20);

comment on column carb.meal_history.carbs_unknown is 'Ate out, carbs not known: total_carbs is 0 only because the column is required; it is not a meal with no carbs.';
comment on column carb.meal_history.carbs_guess is 'The parent''s own guess for a meal whose carbs are not known. Never used in any calculation.';

-- the push to the other parent: no carbs number for a meal whose carbs are not known (it says "carbs unknown")
create or replace function carb.activity_enqueue()
 returns trigger
 language plpgsql
 security definer
 set search_path to 'carb', 'public'
as $function$
declare k text; at timestamptz; c numeric; u numeric; g integer; nm text;
begin
  begin
    if new.source is not null or new.created_by is null then return new; end if;
    if tg_table_name = 'events' then
      if new.deleted_at is not null then return new; end if;
      at := new.occurred_at; c := new.carbs_g; u := new.insulin_units; g := new.bg_mgdl; nm := new.treatment;
      k := case new.kind when 'insulin' then case when new.insulin_type = 'long' then 'long' else 'rapid' end
                         when 'treatment' then 'treatment' when 'bg_check' then 'finger' when 'carbs' then 'meal' end;
    else
      at := new.eaten_at; c := case when new.carbs_unknown then null else new.total_carbs end; nm := new.name;
      k := case when new.kind = 'treatment' then 'treatment' else 'meal' end;
    end if;
    -- something entered for long ago is a record, not news
    if k is null or at < now() - interval '3 hours' or at > now() + interval '1 hour' then return new; end if;
    insert into carb.activity_feed (kind, ref_table, ref_id, by_user, occurred_at, carbs, units, mgdl, name)
      values (k, tg_table_name, new.id, new.created_by, at, c, u, g, nm) on conflict do nothing;
    perform carb.activity_wake();
  exception when others then
    raise warning 'activity_enqueue: %', sqlerrm;
  end;
  return new;
end $function$;

-- the shared view's carbs on board: a meal whose carbs are not known adds nothing it can count
create or replace function carb.share_view(p_token text)
 returns json
 language plpgsql
 security definer
 set search_path to ''
as $function$
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
                  select eaten_at t, total_carbs g from carb.meal_history where deleted_at is null and intake = 'confirmed' and not carbs_unknown
                  and eaten_at > now() - interval '12 hours' and eaten_at <= now()
                  union all
                  select occurred_at, carbs_g from carb.events where deleted_at is null and kind in ('carbs', 'treatment') and carbs_g > 0
                  and occurred_at > now() - interval '12 hours' and occurred_at <= now()) x)
    ) end
  ) into res;
  return res;
end $function$;
