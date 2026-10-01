-- Live glucose (display only): readings pulled from LibreLinkUp by the carb-glucose edge function.
-- The LibreLinkUp login lives in Supabase Vault, reachable only by the service role through the
-- three carb.cgm_secret_* functions; the browser can never read it back.

alter table carb.settings
  add column glucose_unit text not null default 'mmol' check (glucose_unit in ('mmol', 'mgdl')),
  add column glucose_low_mgdl numeric check (glucose_low_mgdl > 0),    -- parent-entered, for colouring only
  add column glucose_high_mgdl numeric check (glucose_high_mgdl > 0);

alter table carb.meal_history
  add column glucose_mgdl int,
  add column glucose_trend smallint,
  add column glucose_at timestamptz;

create table carb.cgm_state (
  id           boolean primary key default true check (id),
  connected    boolean not null default false,
  account_hint text,                 -- masked login, e.g. m***@gmail.com
  last_fetch_at timestamptz,
  last_ok_at   timestamptz,
  last_error   text,
  updated_at   timestamptz not null default now()
);
insert into carb.cgm_state (id) values (true);

create table carb.glucose_readings (
  taken_at   timestamptz primary key,
  mg_dl      int not null check (mg_dl between 10 and 900),
  trend      smallint check (trend between 1 and 5),   -- 1 falling fast … 3 steady … 5 rising fast
  created_at timestamptz not null default now()
);

alter table carb.cgm_state enable row level security;
alter table carb.glucose_readings enable row level security;
create policy cgm_state_read on carb.cgm_state for select to authenticated using (carb.is_member());
create policy glucose_read on carb.glucose_readings for select to authenticated using (carb.is_member());
grant select on carb.cgm_state, carb.glucose_readings to authenticated;

grant usage on schema carb to service_role;
grant select, insert, update, delete on carb.cgm_state, carb.glucose_readings to service_role;

create function carb.cgm_secret_get() returns jsonb
language sql security definer set search_path = '' as $$
  select decrypted_secret::jsonb from vault.decrypted_secrets where name = 'carb_cgm'
$$;

create function carb.cgm_secret_put(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'carb_cgm';
  if sid is null then
    perform vault.create_secret(p::text, 'carb_cgm', 'LibreLinkUp login and session for the kids carb app');
  else
    perform vault.update_secret(sid, p::text);
  end if;
end $$;

create function carb.cgm_secret_clear() returns void
language sql security definer set search_path = '' as $$
  delete from vault.secrets where name = 'carb_cgm'
$$;

revoke all on function carb.cgm_secret_get(), carb.cgm_secret_put(jsonb), carb.cgm_secret_clear() from public, anon, authenticated;
grant execute on function carb.cgm_secret_get(), carb.cgm_secret_put(jsonb), carb.cgm_secret_clear() to service_role;
