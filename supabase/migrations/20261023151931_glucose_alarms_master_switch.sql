-- One master switch for glucose alarms (low, very low, low expected, high, no reading, fast fall/rise). The family
-- turned them off on 23 Oct 2026: the LibreLink app gives the alarms. While off, the server's alarm check (carb-glucose,
-- unchanged) cannot open an alarm: the insert is skipped here, so nothing rings in the app and nothing is pushed.
-- Meal-plan, recheck and sensor reminders are separate and unaffected. Turning it back on restores everything as before.
alter table carb.settings add column if not exists glucose_alarms_on boolean not null default true;
comment on column carb.settings.glucose_alarms_on is 'Master switch for glucose alarms. Off: no alert rows are created (LibreLink gives the alarms).';

create or replace function carb.alerts_only_when_on() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if not coalesce((select glucose_alarms_on from carb.settings where id), true) then return null; end if;
  return new;
end $$;
create trigger alerts_only_when_on before insert on carb.alerts for each row execute function carb.alerts_only_when_on();

-- turning it off also ends whatever is open now, so nothing keeps ringing
create or replace function carb.alerts_close_when_off() returns trigger
language plpgsql security definer set search_path to '' as $$
begin
  if old.glucose_alarms_on and not new.glucose_alarms_on then
    update carb.alerts set state = 'resolved', resolved_at = now() where state <> 'resolved';
  end if;
  return new;
end $$;
create trigger alerts_close_when_off after update of glucose_alarms_on on carb.settings for each row execute function carb.alerts_close_when_off();

update carb.settings set glucose_alarms_on = false where id;
