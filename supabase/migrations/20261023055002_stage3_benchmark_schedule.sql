-- Stage 3 shadow mode: every 15 minutes each candidate's forecast is stored (never shown); once a day (05:17 Kuwait)
-- every candidate is scored again with the latest week held out. Same caller pattern as carb-glucose-poll.
select cron.schedule('carb-benchmark-shadow', '*/15 * * * *', $job$
  select net.http_post(
    url := 'https://fhnqaurtryfmmomvzrpl.supabase.co/functions/v1/carb-benchmark',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZobnFhdXJ0cnlmbW1vbXZ6cnBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMzkyNjEsImV4cCI6MjEwNTcxNTI2MX0.cgQifC42MiuWHuKRUkxHF-AdPdWNwZvK2CQAYEJl_68',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'carb_cron_secret')
    ),
    body := '{"action":"shadow"}'::jsonb,
    timeout_milliseconds := 30000
  );
$job$);

select cron.schedule('carb-benchmark-daily', '17 2 * * *', $job$
  select net.http_post(
    url := 'https://fhnqaurtryfmmomvzrpl.supabase.co/functions/v1/carb-benchmark',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6ImZobnFhdXJ0cnlmbW1vbXZ6cnBsIiwicm9sZSI6ImFub24iLCJpYXQiOjE3OTAxMzkyNjEsImV4cCI6MjEwNTcxNTI2MX0.cgQifC42MiuWHuKRUkxHF-AdPdWNwZvK2CQAYEJl_68',
      'x-cron-secret', (select decrypted_secret from vault.decrypted_secrets where name = 'carb_cron_secret')
    ),
    body := '{"action":"benchmark"}'::jsonb,
    timeout_milliseconds := 120000
  );
$job$);
