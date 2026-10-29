-- The later part of a split meal dose: every minute, wake carb-split only when one is due (its own function, so the
-- alarm function carb-glucose is not touched). Same pattern as carb.activity_wake.
create or replace function carb.split_wake()
returns void language sql security definer set search_path to 'carb', 'public' as $$
  select null::void from (select net.http_post(
    url := 'https://fhnqaurtryfmmomvzrpl.supabase.co/functions/v1/carb-split',
    headers := jsonb_build_object('Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZobnFhdXJ0cnlmbW1vbXZ6cnBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMzkyNjEsImV4cCI6MjEwNTcxNTI2MX0.cgQifC42MiuWHuKRUkxHF-AdPdWNwZvK2CQAYEJl_68',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'carb_cron_secret')),
    body := '{}'::jsonb,
    timeout_milliseconds := 20000)) x;
$$;
revoke all on function carb.split_wake() from public, anon, authenticated;

select cron.schedule('carb-split', '* * * * *', $$select carb.split_wake() where exists (
  select 1 from carb.planned_meals where split_at is not null and split_done_at is null and status in ('dosed', 'eaten')
    and split_at <= now() and split_at > now() - interval '30 minutes'
    and (notified->>'split') is distinct from to_char(split_at at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'))$$);
