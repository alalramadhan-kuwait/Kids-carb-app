-- Shared activity notifications: when one parent logs something that shows on Layan's graph (meal, NovoRapid,
-- Tresiba, low treatment, finger-prick), the other parent's phones get a push. Only manual entries made in the
-- app (source is null, a signed-in author); imports and CGM readings never notify. Each person can switch
-- every kind off for themselves.

alter table carb.members add column if not exists activity_push jsonb not null
  default '{"meal": true, "rapid": true, "long": true, "treatment": true, "finger": true}'::jsonb;

create table if not exists carb.activity_feed (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('meal', 'rapid', 'long', 'treatment', 'finger')),
  ref_table text not null check (ref_table in ('events', 'meal_history')),
  ref_id uuid not null,
  by_user uuid not null,
  occurred_at timestamptz not null,
  carbs numeric, units numeric, mgdl integer, name text,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (ref_table, ref_id)
);
create index if not exists activity_feed_unsent on carb.activity_feed (created_at) where sent_at is null;
alter table carb.activity_feed enable row level security; -- server only (service role); no policies

-- Queues the entry and wakes the push job at once (pg_net sends after the insert commits). Never blocks the
-- insert: any failure here is only a warning, and the every-minute job picks up what is queued.
create or replace function carb.activity_enqueue() returns trigger
language plpgsql security definer set search_path = carb, public as $$
declare k text; at timestamptz; c numeric; u numeric; g integer; nm text;
begin
  begin
    if new.source is not null or new.created_by is null then return new; end if;
    if tg_table_name = 'events' then
      if new.deleted_at is not null then return new; end if;
      at := new.occurred_at; c := new.carbs_g; u := new.insulin_units; g := new.bg_mgdl; nm := new.treatment;
      k := case new.kind when 'insulin' then case when new.insulin_type = 'long' then 'long' else 'rapid' end
                         when 'treatment' then 'treatment' when 'bg_check' then 'finger' when 'carbs' then 'meal' end;
    else
      at := new.eaten_at; c := new.total_carbs; nm := new.name;
      k := case when new.kind = 'treatment' then 'treatment' else 'meal' end;
    end if;
    -- something entered for long ago is a record, not news
    if k is null or at < now() - interval '3 hours' or at > now() + interval '1 hour' then return new; end if;
    insert into carb.activity_feed (kind, ref_table, ref_id, by_user, occurred_at, carbs, units, mgdl, name)
      values (k, tg_table_name, new.id, new.created_by, at, c, u, g, nm) on conflict do nothing;
    perform net.http_post(
      url := 'https://fhnqaurtryfmmomvzrpl.supabase.co/functions/v1/carb-glucose',
      headers := jsonb_build_object('Content-Type', 'application/json',
        -- public anon key: only to pass the gateway's JWT check; the secret below is what authorises the call
        'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZobnFhdXJ0cnlmbW1vbXZ6cnBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMzkyNjEsImV4cCI6MjEwNTcxNTI2MX0.cgQifC42MiuWHuKRUkxHF-AdPdWNwZvK2CQAYEJl_68',
        'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'carb_cron_secret')),
      body := '{"action":"activity"}'::jsonb,
      timeout_milliseconds := 20000);
  exception when others then
    raise warning 'activity_enqueue: %', sqlerrm;
  end;
  return new;
end $$;
revoke all on function carb.activity_enqueue() from public, anon, authenticated;

create trigger activity_push after insert on carb.events for each row execute function carb.activity_enqueue();
create trigger activity_push after insert on carb.meal_history for each row execute function carb.activity_enqueue();

-- Each person switches their own kinds on or off.
create or replace function carb.set_activity_push(p jsonb) returns void
language plpgsql security definer set search_path = carb, public as $$
begin
  if not carb.is_member() then raise exception 'not_allowed'; end if;
  update carb.members set activity_push = jsonb_build_object(
    'meal', coalesce((p->>'meal')::boolean, true), 'rapid', coalesce((p->>'rapid')::boolean, true),
    'long', coalesce((p->>'long')::boolean, true), 'treatment', coalesce((p->>'treatment')::boolean, true),
    'finger', coalesce((p->>'finger')::boolean, true))
  where user_id = auth.uid();
end $$;
revoke all on function carb.set_activity_push(jsonb) from public, anon;
grant execute on function carb.set_activity_push(jsonb) to authenticated;
