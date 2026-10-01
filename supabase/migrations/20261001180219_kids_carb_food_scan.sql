-- Food photo estimates (carb-food edge function). The Anthropic API key lives in Vault and only the service role
-- can read it; the app can save or clear it through the function but never read it back.
create or replace function carb.ai_secret_put(p text)
returns void language plpgsql security definer set search_path = '' as $$
declare sid uuid;
begin
  select id into sid from vault.secrets where name = 'carb_ai';
  if sid is null then perform vault.create_secret(p, 'carb_ai', 'Anthropic API key for food photo estimates (kids carb app)');
  else perform vault.update_secret(sid, p); end if;
end $$;
create or replace function carb.ai_secret_get()
returns text language sql security definer set search_path = '' as $$
  select decrypted_secret from vault.decrypted_secrets where name = 'carb_ai'
$$;
create or replace function carb.ai_secret_clear()
returns void language sql security definer set search_path = '' as $$
  delete from vault.secrets where name = 'carb_ai'
$$;
revoke all on function carb.ai_secret_put(text), carb.ai_secret_get(), carb.ai_secret_clear() from public, anon, authenticated;
grant execute on function carb.ai_secret_put(text), carb.ai_secret_get(), carb.ai_secret_clear() to service_role;

-- every estimate is kept: what the model said, what it cost, and whether the parents logged it
create table carb.food_scans (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  created_by uuid not null references auth.users(id) on delete cascade,
  kind text not null check (kind in ('photo', 'barcode')),
  model text,
  result jsonb not null,
  input_tokens int, output_tokens int,
  history_id uuid references carb.meal_history(id) on delete set null
);
create index food_scans_day on carb.food_scans (created_at desc);
alter table carb.food_scans enable row level security;
create policy food_scans_read on carb.food_scans for select to authenticated using (carb.is_member());
create policy food_scans_link on carb.food_scans for update to authenticated using (carb.is_member()) with check (carb.is_member());
grant select, update (history_id) on carb.food_scans to authenticated;
grant select, insert, update on carb.food_scans to service_role;
