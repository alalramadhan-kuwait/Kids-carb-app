-- 2. Who changed what, before and after: written by the database itself (the phone cannot forge or skip it).
create table if not exists carb.entry_audit (
  id bigint generated always as identity primary key,
  at timestamptz not null default now(),
  actor uuid default auth.uid(),
  tbl text not null,
  row_id uuid not null,
  action text not null check (action in ('update', 'delete', 'soft_delete', 'restore')),
  old jsonb,
  new jsonb
);
create index if not exists entry_audit_row_idx on carb.entry_audit (row_id, at desc);
alter table carb.entry_audit enable row level security;
create policy entry_audit_read on carb.entry_audit for select using (carb.is_member());
-- no insert/update/delete policy: only the trigger (security definer) writes it, and nobody edits it

create or replace function carb.audit_entry() returns trigger
language plpgsql security definer set search_path = '' as $$
declare a text;
begin
  if tg_op = 'DELETE' then
    insert into carb.entry_audit (tbl, row_id, action, old) values (tg_table_name, old.id, 'delete', to_jsonb(old));
    return old;
  end if;
  -- plans: only the moments that matter (dosed, eaten, skipped, the dose and meal links), not every reminder flag
  if tg_table_name = 'planned_meals' and (to_jsonb(new) - array['notified', 'updated_at', 'review', 'recheck_at'])
     = (to_jsonb(old) - array['notified', 'updated_at', 'review', 'recheck_at']) then return new; end if;
  if to_jsonb(new) = to_jsonb(old) then return new; end if;
  -- (read through jsonb: plans have no deleted_at column)
  a := case
    when to_jsonb(old)->>'deleted_at' is null and to_jsonb(new)->>'deleted_at' is not null then 'soft_delete'
    when to_jsonb(old)->>'deleted_at' is not null and to_jsonb(new)->>'deleted_at' is null then 'restore'
    else 'update' end;
  insert into carb.entry_audit (tbl, row_id, action, old, new) values (tg_table_name, new.id, a, to_jsonb(old), to_jsonb(new));
  return new;
end $$;
revoke all on function carb.audit_entry() from public, anon, authenticated;

-- deleted_by is the signed-in parent, whatever the phone sent
create or replace function carb.stamp_delete() returns trigger
language plpgsql set search_path = '' as $$
begin
  if new.deleted_at is not null and old.deleted_at is null and auth.uid() is not null then new.deleted_by := auth.uid(); end if;
  if new.deleted_at is null then new.deleted_by := null; end if;
  return new;
end $$;

create or replace trigger meal_history_audit after update or delete on carb.meal_history for each row execute function carb.audit_entry();
create or replace trigger events_audit after update or delete on carb.events for each row execute function carb.audit_entry();
create or replace trigger planned_meals_audit after update or delete on carb.planned_meals for each row execute function carb.audit_entry();
create or replace trigger meal_history_stamp_delete before update on carb.meal_history for each row execute function carb.stamp_delete();
create or replace trigger events_stamp_delete before update on carb.events for each row execute function carb.stamp_delete();
