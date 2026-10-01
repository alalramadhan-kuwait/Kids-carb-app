-- Stage 5: alert profiles (night, school), rapid rise/fall alerts, escalation to a backup parent.
-- Every threshold stays parent-entered; empty = same as the day profile (or off for rapid change).
alter table carb.settings
  add column alert_rapid_rate   numeric check (alert_rapid_rate between 1 and 6),        -- mg/dL per minute; null = off
  add column night_start        time,                                                    -- null = no night profile
  add column night_end          time,
  add column night_low_mgdl     int check (night_low_mgdl between 50 and 150),
  add column night_high_mgdl    int check (night_high_mgdl between 120 and 450),
  add column night_high_silent  boolean not null default false,
  add column night_theme        boolean not null default true,
  add column school_days        int[] not null default '{0,1,2,3,4}',                    -- 0 = Sunday (Kuwait week)
  add column school_start       time,                                                    -- null = no school profile
  add column school_end         time,
  add column school_low_mgdl    int check (school_low_mgdl between 50 and 150),
  add column school_high_mgdl   int check (school_high_mgdl between 120 and 450),
  add column escalate_min       int not null default 10 check (escalate_min between 3 and 60);

alter table carb.members
  add column alert_role text not null default 'primary' check (alert_role in ('primary', 'backup', 'off'));

alter table carb.alerts drop constraint alerts_kind_check;
alter table carb.alerts
  add constraint alerts_kind_check check (kind in ('urgent_low', 'low', 'high', 'no_data', 'rapid_fall', 'rapid_rise')),
  add column profile      text check (profile in ('day', 'night', 'school')),
  add column escalated_at timestamptz;

-- any parent may set who gets alerts first and who is the backup
create function carb.set_alert_role(p_user uuid, p_role text) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not carb.is_member() then raise exception 'not allowed'; end if;
  if p_role not in ('primary', 'backup', 'off') then raise exception 'bad role'; end if;
  update carb.members set alert_role = p_role where user_id = p_user;
end $$;
revoke all on function carb.set_alert_role(uuid, text) from public, anon;
grant execute on function carb.set_alert_role(uuid, text) to authenticated;
