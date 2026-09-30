-- The first setup code was exposed in a public repo (as a hash). Replace it with a much longer one.
-- Only allowed while nobody has claimed the app yet.
do $$
begin
  if exists (select 1 from carb.members) then
    raise exception 'app already claimed; not rotating';
  end if;
  update carb.setup set code_hash = 'a4b153d89ccb4753c15e659d1f30b79dd9f6968a573ddee3b4906aaf74365850' where id;
end $$;
