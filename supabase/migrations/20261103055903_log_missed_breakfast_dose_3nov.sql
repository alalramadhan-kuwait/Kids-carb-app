-- 3 Nov 2026 breakfast «توست أبيض مع بيض وجبن» was logged later without its injection. The parent said: NovoRapid
-- 2 U at 07:35 Kuwait time. Recorded at that time (by the parent who asked) and linked to the plan; the meal is untouched.
with ev as (
  insert into carb.events (client_id, kind, occurred_at, insulin_units, insulin_type, bolus_purpose, note, created_by)
  select gen_random_uuid(), 'insulin', '2026-11-03 07:35:00+03', 2, 'rapid', 'meal', 'سُجّلت بعدين', '81a74fd8-99f7-42cd-98b8-45e7ea65a46e'
  where not exists (select 1 from carb.events where kind = 'insulin' and insulin_type = 'rapid' and deleted_at is null
                    and occurred_at between '2026-11-03 07:20:00+03' and '2026-11-03 07:50:00+03')
  returning id
)
update carb.planned_meals p set dose_event_id = ev.id, dosed_at = '2026-11-03 07:35:00+03', dose_at = '2026-11-03 07:35:00+03',
  given_units = 2, dose_reason = 'سُجّلت بعدين', updated_at = now()
from ev where p.id = '7bd43611-dc08-4a87-9078-dbd026267086' and p.dose_event_id is null;
