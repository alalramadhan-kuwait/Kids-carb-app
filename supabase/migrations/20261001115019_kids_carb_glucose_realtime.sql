-- Push new glucose readings to open phones the moment they are stored (Supabase Realtime).
-- Realtime applies the table's RLS, so only family members receive them.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'carb' and tablename = 'glucose_readings') then
    alter publication supabase_realtime add table carb.glucose_readings;
  end if;
end $$;
