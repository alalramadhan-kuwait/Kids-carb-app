-- A new sensor seen by the server (cgm_state.sensor_sn changes) is added to carb.sensors right away, instead of
-- waiting for a phone to open the Status page. Insert-only: earlier sensors and their sites are kept as history.
create or replace function carb.sensor_from_state() returns trigger language plpgsql security definer set search_path = carb, public as $$
begin
  if new.sensor_sn is not null and new.sensor_started_at is not null and new.sensor_sn is distinct from old.sensor_sn then
    insert into carb.sensors (sn, started_at, days, source)
    values (new.sensor_sn, new.sensor_started_at, coalesce((select sensor_days from carb.settings where id), 14), 'librelinkup')
    on conflict (sn) do nothing;
  end if;
  return new;
end $$;
revoke all on function carb.sensor_from_state() from public, anon, authenticated;

create trigger cgm_state_sensor_history after update of sensor_sn on carb.cgm_state
  for each row execute function carb.sensor_from_state();

-- the sensor fitted on 10 Oct 2026, already in cgm_state
insert into carb.sensors (sn, started_at, days, source)
select sensor_sn, sensor_started_at, coalesce((select sensor_days from carb.settings where id), 14), 'librelinkup'
from carb.cgm_state where id and sensor_sn is not null and sensor_started_at is not null
on conflict (sn) do nothing;
