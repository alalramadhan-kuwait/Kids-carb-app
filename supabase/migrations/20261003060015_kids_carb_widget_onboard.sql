-- The iPhone widget shows insulin and carbs on board. Only links made for the widget carry the doses and carbs
-- behind them (onboard = true); family and school links show exactly what they did before.
alter table carb.share_links add column if not exists onboard boolean not null default false;

create or replace function carb.create_widget_link(p_label text) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not carb.is_member() then raise exception 'not allowed'; end if;
  if coalesce(trim(p_label), '') = '' then raise exception 'bad input'; end if;
  insert into carb.share_links (token_hash, scope, label, expires_at, onboard)
  values (encode(extensions.digest(tok, 'sha256'), 'hex'), 'viewer', trim(p_label), now() + interval '365 days', true);
  return tok;
end $$;
revoke all on function carb.create_widget_link(text) from public;
grant execute on function carb.create_widget_link(text) to authenticated;

create or replace function carb.share_view(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
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
    'reference', s.glucose_low_mgdl is null and s.glucose_high_mgdl is null,
    'readings', (select coalesce(json_agg(json_build_object('t', taken_at, 'v', mg_dl, 'trend', trend) order by taken_at), '[]'::json)
                 from carb.glucose_readings where taken_at > now() - interval '3 hours'),
    'care_plan', case when l.scope = 'school' then json_build_object('hypo', cp.hypo, 'hyper', cp.hyper, 'contacts', cp.contacts) end,
    -- the same inputs as the app's IOB / COB (engine/iob.ts): rapid doses, and carbs from meals and from carb or
    -- low-treatment entries, over the last 12 hours; the care team's parameters (null when not set)
    'onboard', case when l.onboard then json_build_object(
      'dia', s.iob_dia_min, 'peak', s.iob_peak_min, 'absorb', s.cob_absorb_min,
      'doses', (select coalesce(json_agg(json_build_object('t', occurred_at, 'u', insulin_units) order by occurred_at), '[]'::json)
                from carb.events where deleted_at is null and kind = 'insulin' and coalesce(insulin_type, 'rapid') <> 'long'
                and insulin_units is not null and occurred_at > now() - interval '12 hours' and occurred_at <= now()),
      'carbs', (select coalesce(json_agg(json_build_object('t', x.t, 'g', x.g) order by x.t), '[]'::json) from (
                  select eaten_at t, total_carbs g from carb.meal_history where eaten_at > now() - interval '12 hours' and eaten_at <= now()
                  union all
                  select occurred_at, carbs_g from carb.events where deleted_at is null and kind in ('carbs', 'treatment') and carbs_g > 0
                  and occurred_at > now() - interval '12 hours' and occurred_at <= now()) x)
    ) end
  ) into res;
  return res;
end $$;
