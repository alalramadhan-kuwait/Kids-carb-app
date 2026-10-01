-- Stage 9: read-only share links (school nurse, grandparents). The token is made in the database, shown once,
-- and only its SHA-256 is kept. A link expires, can be revoked, and shows only what its scope allows.
create table carb.share_links (
  id           uuid primary key default gen_random_uuid(),
  token_hash   text not null unique,
  scope        text not null check (scope in ('school', 'viewer')),
  label        text not null,
  created_by   uuid not null default auth.uid(),
  created_at   timestamptz not null default now(),
  expires_at   timestamptz not null,
  revoked_at   timestamptz,
  last_used_at timestamptz
);
alter table carb.share_links enable row level security;
create policy share_links_read on carb.share_links for select to authenticated using (carb.is_member());
grant select on carb.share_links to authenticated;

create function carb.create_share_link(p_scope text, p_label text, p_days int) returns text
language plpgsql security definer set search_path = '' as $$
declare tok text := encode(extensions.gen_random_bytes(24), 'hex');
begin
  if not carb.is_member() then raise exception 'not allowed'; end if;
  if p_scope not in ('school', 'viewer') or p_days not between 1 and 365 or coalesce(trim(p_label), '') = '' then raise exception 'bad input'; end if;
  insert into carb.share_links (token_hash, scope, label, expires_at)
  values (encode(extensions.digest(tok, 'sha256'), 'hex'), p_scope, trim(p_label), now() + make_interval(days => p_days));
  return tok;
end $$;

create function carb.revoke_share_link(p_id uuid) returns void
language plpgsql security definer set search_path = '' as $$
begin
  if not carb.is_member() then raise exception 'not allowed'; end if;
  update carb.share_links set revoked_at = now() where id = p_id and revoked_at is null;
end $$;

-- What a link holder sees. Callable without signing in; everything is decided by the token.
create function carb.share_view(p_token text) returns json
language plpgsql security definer set search_path = '' as $$
declare l carb.share_links; s carb.settings; cp carb.care_plan; res json;
begin
  select * into l from carb.share_links
  where token_hash = encode(extensions.digest(coalesce(p_token, ''), 'sha256'), 'hex') and revoked_at is null and expires_at > now();
  if not found then return json_build_object('error', 'invalid'); end if;
  update carb.share_links set last_used_at = now() where id = l.id;
  select * into s from carb.settings where id;
  select * into cp from carb.care_plan where id;
  select json_build_object(
    'scope', l.scope, 'label', l.label, 'expires_at', l.expires_at,
    'child', s.child_name, 'unit', s.glucose_unit, 'low', coalesce(s.glucose_low_mgdl, 70), 'high', coalesce(s.glucose_high_mgdl, 180),
    'reference', s.glucose_low_mgdl is null and s.glucose_high_mgdl is null,
    'readings', (select coalesce(json_agg(json_build_object('t', taken_at, 'v', mg_dl, 'trend', trend) order by taken_at), '[]'::json)
                 from carb.glucose_readings where taken_at > now() - interval '3 hours'),
    'care_plan', case when l.scope = 'school' then json_build_object('hypo', cp.hypo, 'hyper', cp.hyper, 'contacts', cp.contacts) end
  ) into res;
  return res;
end $$;

revoke all on function carb.create_share_link(text, text, int), carb.revoke_share_link(uuid), carb.share_view(text) from public;
grant execute on function carb.create_share_link(text, text, int), carb.revoke_share_link(uuid) to authenticated;
grant execute on function carb.share_view(text) to anon, authenticated;
