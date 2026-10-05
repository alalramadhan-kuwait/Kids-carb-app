-- Shared activity pushes get their own edge function (carb-activity), so the alert function is untouched.
-- The trigger wakes it at once; a once-a-minute job sends anything the wake-up missed.
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
    perform carb.activity_wake();
  exception when others then
    raise warning 'activity_enqueue: %', sqlerrm;
  end;
  return new;
end $$;

-- One call to carb-activity, authorised by the cron secret in Vault (the anon key only passes the gateway).
create or replace function carb.activity_wake() returns void
language sql security definer set search_path = carb, public as $$
  select null::void from (select net.http_post(
    url := 'https://fhnqaurtryfmmomvzrpl.supabase.co/functions/v1/carb-activity',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZobnFhdXJ0cnlmbW1vbXZ6cnBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMzkyNjEsImV4cCI6MjEwNTcxNTI2MX0.cgQifC42MiuWHuKRUkxHF-AdPdWNwZvK2CQAYEJl_68',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'carb_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)) x;
$$;
revoke all on function carb.activity_wake() from public, anon, authenticated;

-- backup: only calls out when something is waiting
select cron.schedule('carb-activity', '* * * * *',
  $$select carb.activity_wake() where exists (select 1 from carb.activity_feed where sent_at is null)$$);
