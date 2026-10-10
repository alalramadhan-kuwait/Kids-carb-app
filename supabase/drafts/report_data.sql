-- DRAFT, not applied: applied only after the Phase 0 review. The doctor reports' own query, so a 30- or 90-day report
-- reads exactly its period from the database (the app's shared cache holds only 60 days and 1,000 entries).
-- Read-only; runs as the signed-in member, so the existing row security applies. Stored rows are returned as they
-- are: original timestamps, values and the sensor source. Finger-pricks come back as events of kind bg_check and are
-- kept apart by the engine.
create or replace function carb.report_data(p_from timestamptz, p_to timestamptz) returns jsonb
language plpgsql stable security invoker set search_path = '' as $$
begin
  if p_to <= p_from or p_to - p_from > interval '100 days' then raise exception 'report period must be 1 to 100 days'; end if;
  return jsonb_build_object(
    'readings', (select jsonb_build_object(
        't', coalesce(jsonb_agg(extract(epoch from r.taken_at)::bigint order by r.taken_at), '[]'::jsonb),
        'mg', coalesce(jsonb_agg(r.mg_dl order by r.taken_at), '[]'::jsonb),
        'src', coalesce(jsonb_agg(r.source order by r.taken_at), '[]'::jsonb))
      from carb.glucose_readings r where r.taken_at >= p_from - interval '15 minutes' and r.taken_at < p_to),
    'events', (select coalesce(jsonb_agg(jsonb_build_object('id', e.id, 'kind', e.kind, 'at', e.occurred_at, 'units', e.insulin_units,
        'type', e.insulin_type, 'purpose', e.bolus_purpose, 'carbs', e.carbs_g, 'treatment', e.treatment, 'bg', e.bg_mgdl) order by e.occurred_at), '[]'::jsonb)
      from carb.events e where e.deleted_at is null and e.occurred_at >= p_from and e.occurred_at < p_to and e.kind in ('insulin', 'treatment', 'bg_check', 'carbs')),
    'meals', (select coalesce(jsonb_agg(jsonb_build_object('id', m.id, 'at', m.eaten_at, 'carbs', m.total_carbs, 'unknown', m.carbs_unknown,
        'pending', m.intake = 'pending', 'name', m.name, 'slot', m.meal_slot) order by m.eaten_at), '[]'::jsonb)
      from carb.meal_history m where m.deleted_at is null and m.eaten_at >= p_from and m.eaten_at < p_to),
    'sensors', (select coalesce(jsonb_agg(jsonb_build_object('sn', s.sn, 'started_at', s.started_at, 'days', s.days, 'source', s.source) order by s.started_at), '[]'::jsonb)
      from carb.sensors s where s.started_at < p_to));
end $$;
revoke all on function carb.report_data(timestamptz, timestamptz) from public, anon;
grant execute on function carb.report_data(timestamptz, timestamptz) to authenticated;
