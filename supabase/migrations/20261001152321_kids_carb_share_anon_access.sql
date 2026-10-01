-- Share links are opened without signing in, so the anon role needs to reach the schema. It can then call
-- only carb.share_view: it has no table rights, and glucose_stats (left open to PUBLIC) is closed here.
revoke all on function carb.glucose_stats(timestamptz, timestamptz, numeric, numeric) from public, anon;
grant execute on function carb.glucose_stats(timestamptz, timestamptz, numeric, numeric) to authenticated;
grant usage on schema carb to anon;
