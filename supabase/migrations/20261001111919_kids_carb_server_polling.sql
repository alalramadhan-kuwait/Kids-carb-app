-- Step 1: keep glucose flowing when no phone has the app open.
-- pg_cron calls the carb-glucose edge function every minute. The call proves itself with a random secret
-- that is generated here, inside Vault, and never leaves the database.

alter table carb.cgm_state add column if not exists last_cron_at timestamptz;

do $$
begin
  if not exists (select 1 from vault.secrets where name = 'carb_cron_secret') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'carb_cron_secret',
      'Shared secret between pg_cron and the carb-glucose edge function');
  end if;
end $$;

create or replace function carb.cron_secret_matches(p text) returns boolean
language sql stable security definer set search_path = '' as $$
  select coalesce(p = (select decrypted_secret from vault.decrypted_secrets where name = 'carb_cron_secret'), false)
$$;
revoke all on function carb.cron_secret_matches(text) from public, anon, authenticated;
grant execute on function carb.cron_secret_matches(text) to service_role;

do $$
begin
  if exists (select 1 from cron.job where jobname = 'carb-glucose-poll') then
    perform cron.unschedule('carb-glucose-poll');
  end if;
end $$;

select cron.schedule('carb-glucose-poll', '* * * * *', $job$
  select net.http_post(
    url := 'https://fhnqaurtryfmmomvzrpl.supabase.co/functions/v1/carb-glucose',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      -- public anon key: only to pass the gateway's JWT check; the secret below is what authorises the call
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZobnFhdXJ0cnlmbW1vbXZ6cnBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMzkyNjEsImV4cCI6MjEwNTcxNTI2MX0.cgQifC42MiuWHuKRUkxHF-AdPdWNwZvK2CQAYEJl_68',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'carb_cron_secret')
    ),
    body := '{"action":"read"}'::jsonb,
    timeout_milliseconds := 20000
  );
$job$);
