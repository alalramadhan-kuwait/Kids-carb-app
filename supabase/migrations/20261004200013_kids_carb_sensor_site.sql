-- Where each CGM sensor is worn: that site is blocked for injections while the sensor is on.
alter table carb.sensors add column if not exists site text
  check (site in ('belly_r','belly_l','thigh_r','thigh_l','arm_r','arm_l','buttock_r','buttock_l'));
alter table carb.sensors add column if not exists site_at timestamptz;
do $$ begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'carb' and tablename = 'sensors') then
    alter publication supabase_realtime add table carb.sensors;
  end if;
end $$;
