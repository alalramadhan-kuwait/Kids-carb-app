-- The widget's food strip splits a fatty meal into a quick and a slow part, and shows a drink as a quick pulse
-- (app engine/absorb.ts): each carb entry in the widget link now carries its fat ('f', grams, null if unknown) and
-- whether it is a drink ('d'). Nothing else in the reply changes.
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
      'carbs', (select coalesce(json_agg(json_build_object('t', x.t, 'g', x.g, 'f', x.f, 'd', x.d) order by x.t), '[]'::json) from (
                  select eaten_at t, total_carbs g, total_fat f,
                    name ~* '(عصير|كوكتيل|مشروب|نكتار|juice|drink|nectar|smoothie)' d
                  from carb.meal_history where deleted_at is null and intake = 'confirmed' and not carbs_unknown
                  and eaten_at > now() - interval '12 hours' and eaten_at <= now()
                  union all
                  select occurred_at, carbs_g, null::numeric, kind = 'treatment' from carb.events where deleted_at is null and kind in ('carbs', 'treatment') and carbs_g > 0
                  and occurred_at > now() - interval '12 hours' and occurred_at <= now()) x)
    ) end
  ) into res;
  return res;
end $function$;
