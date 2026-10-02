-- Readings stay read-only for the app; an import from another app (Gluroo) goes through this one function:
-- members only, past times only, plausible values, never over an existing reading (90 s), marked with its source.
alter table carb.glucose_readings add column source text;

create or replace function carb.import_readings(p_t bigint[], p_mg int[], p_tr smallint[], p_source text)
returns int language plpgsql security definer set search_path to '' as $$
declare n int;
begin
  if not carb.is_member() then raise exception 'not_allowed'; end if;
  if coalesce(array_length(p_t, 1), 0) > 20000 or array_length(p_t, 1) <> array_length(p_mg, 1) or array_length(p_t, 1) <> array_length(p_tr, 1) then
    raise exception 'bad_input';
  end if;
  if p_source !~ '^[a-z]{2,20}$' then raise exception 'bad_source'; end if;
  insert into carb.glucose_readings (taken_at, mg_dl, trend, source)
  select v.t, v.mg, case when v.tr between 1 and 5 then v.tr end, p_source
  from (select to_timestamp(t) t, mg, tr from unnest(p_t, p_mg, p_tr) x(t, mg, tr)) v
  where v.t < now() and v.mg between 20 and 600
    and not exists (select 1 from carb.glucose_readings g where g.taken_at between v.t - interval '90 seconds' and v.t + interval '90 seconds')
  on conflict (taken_at) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function carb.import_readings(bigint[], int[], smallint[], text) from public, anon;
grant execute on function carb.import_readings(bigint[], int[], smallint[], text) to authenticated;
