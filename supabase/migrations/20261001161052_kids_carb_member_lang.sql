-- Each parent's app language, so push alerts arrive in the language they read the app in.
alter table carb.members add column lang text not null default 'ar' check (lang in ('ar', 'en'));

create or replace function carb.set_my_lang(p_lang text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_lang not in ('ar', 'en') then raise exception 'bad language'; end if;
  update carb.members set lang = p_lang where user_id = auth.uid();
end $$;
revoke all on function carb.set_my_lang(text) from public, anon;
grant execute on function carb.set_my_lang(text) to authenticated;
