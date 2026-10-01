-- Stage 1: companion alerts (low, urgent low, high, no data), Web Push, "I'm on it", and the care plan.
-- Thresholds are entered by the parents; empty = that alert is off. Evaluated on the server every minute.

alter table carb.settings
  add column alert_urgent_low_mgdl int check (alert_urgent_low_mgdl between 40 and 100),
  add column alert_low_mgdl        int check (alert_low_mgdl between 50 and 150),
  add column alert_high_mgdl       int check (alert_high_mgdl between 120 and 450),
  add column alert_low_delay_min   int not null default 5  check (alert_low_delay_min between 0 and 30),
  add column alert_high_delay_min  int not null default 30 check (alert_high_delay_min between 0 and 240),
  add column alert_nodata_min      int not null default 20 check (alert_nodata_min between 10 and 120),
  add column alert_renotify_min    int not null default 10 check (alert_renotify_min between 5 and 60),
  add column alert_high_renotify_min int not null default 60 check (alert_high_renotify_min between 15 and 240),
  add column child_name            text not null default 'ليان';

create table carb.care_plan (
  id         boolean primary key default true check (id),
  hypo       text, hyper text, sick_day text, contacts text,
  updated_by uuid, updated_at timestamptz not null default now()
);
insert into carb.care_plan (id) values (true);
alter table carb.care_plan enable row level security;
create policy care_plan_members on carb.care_plan for all to authenticated using (carb.is_member()) with check (carb.is_member());
grant select, update on carb.care_plan to authenticated;

create table carb.alerts (
  id               uuid primary key default gen_random_uuid(),
  kind             text not null check (kind in ('urgent_low', 'low', 'high', 'no_data')),
  state            text not null check (state in ('pending', 'active', 'acknowledged', 'resolved')),
  started_at       timestamptz not null default now(),
  active_at        timestamptz,
  value_mgdl       int,
  worst_mgdl       int,
  last_notified_at timestamptz,
  acknowledged_by  uuid,
  acknowledged_at  timestamptz,
  ack_action       text check (ack_action in ('on_it', 'treated')),
  snoozed_until    timestamptz,
  clear_since      timestamptz,
  resolved_at      timestamptz
);
create unique index alerts_one_open_per_kind on carb.alerts (kind) where state <> 'resolved';
create index alerts_started_idx on carb.alerts (started_at desc);
alter table carb.alerts enable row level security;
create policy alerts_read on carb.alerts for select to authenticated using (carb.is_member());
grant select on carb.alerts to authenticated;   -- written by the server only; acknowledged through the edge function

create table carb.push_subscriptions (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null default auth.uid(),
  endpoint     text not null unique,
  p256dh       text not null,
  auth         text not null,
  device_label text,
  created_at   timestamptz not null default now(),
  last_ok_at   timestamptz,
  last_error   text
);
alter table carb.push_subscriptions enable row level security;
create policy push_read on carb.push_subscriptions for select to authenticated using (carb.is_member());
create policy push_own_insert on carb.push_subscriptions for insert to authenticated with check (carb.is_member() and user_id = auth.uid());
create policy push_own_update on carb.push_subscriptions for update to authenticated using (carb.is_member() and user_id = auth.uid()) with check (user_id = auth.uid());
create policy push_own_delete on carb.push_subscriptions for delete to authenticated using (carb.is_member() and user_id = auth.uid());
grant select, insert, update, delete on carb.push_subscriptions to authenticated;

create table carb.notifications (
  id              uuid primary key default gen_random_uuid(),
  alert_id        uuid references carb.alerts (id) on delete cascade,
  subscription_id uuid references carb.push_subscriptions (id) on delete set null,
  user_id         uuid,
  kind            text not null,           -- alert, repeat, resolved, ack, test
  sent_at         timestamptz not null default now(),
  status          int,
  error           text
);
create index notifications_sent_idx on carb.notifications (sent_at desc);
alter table carb.notifications enable row level security;
create policy notifications_read on carb.notifications for select to authenticated using (carb.is_member());
grant select on carb.notifications to authenticated;

-- VAPID key for Web Push: the public half is readable by members, the private half lives in Vault,
-- created by the edge function and readable only by the service role.
create table carb.push_config (
  id         boolean primary key default true check (id),
  vapid_public text,
  subject    text not null default 'https://alalramadhan-kuwait.github.io/Kids-carb-app/'
);
insert into carb.push_config (id) values (true);
alter table carb.push_config enable row level security;
create policy push_config_read on carb.push_config for select to authenticated using (carb.is_member());
grant select on carb.push_config to authenticated;

create function carb.vapid_get() returns jsonb
language sql security definer set search_path = '' as $$
  select decrypted_secret::jsonb from vault.decrypted_secrets where name = 'carb_vapid'
$$;
create function carb.vapid_put(p jsonb) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from vault.secrets where name = 'carb_vapid') then
    raise exception 'vapid key already exists';
  end if;
  perform vault.create_secret(p::text, 'carb_vapid', 'Web Push VAPID private key for the kids carb app');
end $$;
revoke all on function carb.vapid_get(), carb.vapid_put(jsonb) from public, anon, authenticated;
grant execute on function carb.vapid_get(), carb.vapid_put(jsonb) to service_role;

do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname = 'supabase_realtime' and schemaname = 'carb' and tablename = 'alerts') then
    alter publication supabase_realtime add table carb.alerts;
  end if;
end $$;
