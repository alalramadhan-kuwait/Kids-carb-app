-- The sensor sync re-sends the last 12 hours every minute (an upsert on taken_at), so each reading was rewritten
-- about 44 times. A reading never changes: an identical one is now skipped (no write, no live-update message), and a
-- trend already known is not wiped by a later copy without one.
create or replace function carb.readings_skip_same() returns trigger
language plpgsql set search_path = '' as $$
begin
  new.trend := coalesce(new.trend, old.trend);
  if new.mg_dl is not distinct from old.mg_dl and new.trend is not distinct from old.trend then
    return null;
  end if;
  return new;
end $$;
create or replace trigger glucose_readings_skip_same before update on carb.glucose_readings
  for each row execute function carb.readings_skip_same();
