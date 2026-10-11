-- A food asked for from simple mode («مو موجود ← أرسليه لبابا») tells the other parents at once, like the other shared
-- pushes: the row is queued in activity_feed and carb-activity sends it; tapping it opens the food to finish its label.
-- The request is the unapproved product the app already saves (its note starts «من ماما:»); nothing about it changes.
alter table carb.activity_feed drop constraint if exists activity_feed_kind_check;
alter table carb.activity_feed add constraint activity_feed_kind_check check (kind in ('meal', 'rapid', 'long', 'treatment', 'finger', 'request'));
alter table carb.activity_feed drop constraint if exists activity_feed_ref_table_check;
alter table carb.activity_feed add constraint activity_feed_ref_table_check check (ref_table in ('events', 'meal_history', 'products'));

create or replace function carb.food_request_enqueue() returns trigger
language plpgsql security definer set search_path to 'carb', 'public' as $$
begin
  begin
    if new.approved or auth.uid() is null or coalesce(new.notes, '') not like 'من ماما:%' then return new; end if;
    insert into carb.activity_feed (kind, ref_table, ref_id, by_user, occurred_at, name)
      values ('request', 'products', new.id, auth.uid(), now(), new.name) on conflict do nothing;
    perform carb.activity_wake();
  exception when others then
    raise warning 'food_request_enqueue: %', sqlerrm; -- never block saving the request
  end;
  return new;
end $$;
revoke all on function carb.food_request_enqueue() from public, anon, authenticated;
create or replace trigger food_request_push after insert on carb.products for each row execute function carb.food_request_enqueue();

-- each person can switch these off too (on unless switched off)
create or replace function carb.set_activity_push(p jsonb) returns void
language plpgsql security definer set search_path = carb, public as $$
begin
  if not carb.is_member() then raise exception 'not_allowed'; end if;
  update carb.members set activity_push = jsonb_build_object(
    'meal', coalesce((p->>'meal')::boolean, true), 'rapid', coalesce((p->>'rapid')::boolean, true),
    'long', coalesce((p->>'long')::boolean, true), 'treatment', coalesce((p->>'treatment')::boolean, true),
    'finger', coalesce((p->>'finger')::boolean, true), 'request', coalesce((p->>'request')::boolean, true))
  where user_id = auth.uid();
end $$;
