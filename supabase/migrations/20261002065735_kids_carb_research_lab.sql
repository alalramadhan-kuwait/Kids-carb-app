-- The research lab: runs on its own every 12 hours (from the app, one phone per 12-hour slot), keeps every run,
-- the model registry with versions, unexplained glucose movements with an automatic cause, and the few questions
-- worth asking a parent. Research never changes doses, displayed readings or treatment rules.

-- 1. Models and their versions; status follows the latest run's verdict (kept, never deleted).
create table carb.research_models (
  key           text not null,
  version       int  not null,
  name          text not null,
  note          text,
  params        jsonb,
  role          text not null check (role in ('production','reference','candidate')),
  status        text not null default 'collecting' check (status in ('production','reference','collecting','not_better','ready','rejected','retired')),
  status_reason text,
  status_at     timestamptz not null default now(),
  created_at    timestamptz not null default now(),
  primary key (key, version)
);
alter table carb.research_models enable row level security;
create policy research_models_members on carb.research_models for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update on carb.research_models to authenticated;

-- 2. Every run, with what was kept out and why, the scores on unseen data, and the verdicts.
create table carb.research_runs (
  id           uuid primary key default gen_random_uuid(),
  slot         timestamptz,                       -- the 12-hour slot of an automatic run
  trigger      text not null default 'auto' check (trigger in ('auto','manual','baseline')),
  label        text,
  status       text not null check (status in ('running','done','failed')),
  attempts     int not null default 1,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  started_by   uuid,
  window_from  timestamptz, window_to timestamptz,
  unseen_from  timestamptz,                       -- data after this was never seen by Baseline v1
  data         jsonb,                             -- moments kept / excluded by reason
  metrics      jsonb,                             -- per model, overall and per situation (mg/dL)
  choices      jsonb,                             -- what the refit candidates chose each day
  verdicts     jsonb,
  code_version int,
  error        text
);
create unique index research_runs_slot on carb.research_runs (slot) where trigger = 'auto';
create index research_runs_time on carb.research_runs (started_at desc);
alter table carb.research_runs enable row level security;
create policy research_runs_members on carb.research_runs for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update on carb.research_runs to authenticated;

-- 3. Glucose movements the log does not explain, with the cause decided from the data (and a parent's answer).
create table carb.unexplained_events (
  key           text primary key,                -- 'rise:<start>' / 'fall:<start>'
  start_at      timestamptz not null,
  end_at        timestamptz not null,
  direction     text not null check (direction in ('rise','fall')),
  g_from        int, g_to int,
  expected_mgdl int,                             -- what logged carbs and insulin explain
  resid_mgdl    int,                             -- the part they do not
  iob           numeric, cob numeric,
  night         boolean,
  auto_cause    text not null check (auto_cause in ('model_error','missing_event','cgm','bad_input')),
  cause         text not null check (cause in ('model_error','missing_event','cgm','bad_input')),
  confidence    text check (confidence in ('high','medium','low')),
  evidence      jsonb,
  info          numeric,                         -- how much an answer would teach
  answer        jsonb,                           -- {choice, note}
  answered_by   uuid, answered_at timestamptz,
  first_run     uuid references carb.research_runs(id) on delete set null,
  updated_at    timestamptz not null default now()
);
create index unexplained_events_time on carb.unexplained_events (start_at desc);
alter table carb.unexplained_events enable row level security;
create policy unexplained_events_members on carb.unexplained_events for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update on carb.unexplained_events to authenticated;

-- 4. Questions for a parent: at most 3 a day, only what the data cannot tell.
create table carb.research_questions (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('unexplained','duplicate')),
  ref         text not null,                     -- unexplained_events.key or import_entries.id
  info        numeric,
  status      text not null default 'open' check (status in ('open','answered','skipped','expired')),
  created_at  timestamptz not null default now(),
  answer      jsonb,
  answered_by uuid, answered_at timestamptz,
  unique (kind, ref)
);
alter table carb.research_questions enable row level security;
create policy research_questions_members on carb.research_questions for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update on carb.research_questions to authenticated;

-- 5. One phone runs each 12-hour slot; a run abandoned for 20 minutes, or failed, is retried (3 attempts).
create or replace function carb.claim_research_run(p_slot timestamptz)
returns uuid language plpgsql security invoker set search_path to '' as $$
declare v uuid;
begin
  if not carb.is_member() then return null; end if;
  update carb.research_runs set status = 'failed', error = 'abandoned'
   where status = 'running' and started_at < now() - interval '20 minutes';
  insert into carb.research_runs (slot, trigger, status, started_by) values (p_slot, 'auto', 'running', auth.uid())
  on conflict (slot) where trigger = 'auto' do nothing
  returning id into v;
  if v is null then
    update carb.research_runs set status = 'running', started_at = now(), started_by = auth.uid(), error = null, attempts = attempts + 1
     where slot = p_slot and trigger = 'auto' and status = 'failed' and attempts < 3
    returning id into v;
  end if;
  return v;
end $$;
revoke all on function carb.claim_research_run(timestamptz) from public, anon;
grant execute on function carb.claim_research_run(timestamptz) to authenticated;

-- 6. The registry, version 1
insert into carb.research_models (key, version, name, note, params, role, status) values
  ('none', 1, 'No change', 'glucose stays where it is', null, 'reference', 'reference'),
  ('libre', 1, 'Libre arrow', 'the arrow''s speed band carried forward (what the app shows)', null, 'production', 'production'),
  ('trend', 1, 'App trend', 'least-squares rate over 20 min carried forward', null, 'reference', 'reference'),
  ('context', 1, 'Context v1', 'carbs + insulin with the doctor''s ratios + half the unexplained trend; fixed, as in Baseline v1', '{"w":0.5,"absorb":"settings"}', 'candidate', 'collecting'),
  ('context_fit', 1, 'Context, refit daily', 'Context with the trend share and absorption time chosen each day from older days only', '{"w":[0,0.25,0.5,0.75],"absorb":[120,180,240]}', 'candidate', 'collecting'),
  ('damped', 1, 'Damped trend', 'the app trend scaled down, the scale chosen each day from older days only', '{"k":[0.25,0.5,0.75,1]}', 'candidate', 'collecting')
on conflict do nothing;

-- 7. Baseline v1, kept as reported (27 Sep 22:00 – 2 Oct 05:23 Kuwait, 641 shared moments; mg/dL)
insert into carb.research_runs (trigger, label, status, started_at, finished_at, window_from, window_to, unseen_from, data, metrics, code_version)
values ('baseline', 'Baseline v1', 'done', '2026-10-02T06:00:00Z', '2026-10-02T06:00:00Z',
  '2026-09-27T19:00:00Z', '2026-10-02T02:23:00Z', '2026-10-02T02:23:00Z',
  '{"moments":759,"excluded":118,"excludedBy":{"uncertain_entry":118},"shared":641,"days":3.8}',
  '{"all":{
     "none":   {"n":641,"mae15":14.77,"mae30":22.70,"direction":0.59,"arrow":0.59,"fall":{"truth":41,"caught":0,"falseAlarms":0},"rise":{"truth":52,"caught":0,"falseAlarms":0}},
     "libre":  {"n":641,"mae15":15.85,"mae30":27.02,"direction":0.54,"arrow":0.53,"fall":{"truth":41,"caught":1,"falseAlarms":4},"rise":{"truth":52,"caught":5,"falseAlarms":7}},
     "trend":  {"n":641,"mae15":19.28,"mae30":35.49,"direction":0.48,"arrow":0.44,"fall":{"truth":41,"caught":3,"falseAlarms":22},"rise":{"truth":52,"caught":8,"falseAlarms":26}},
     "context":{"n":641,"mae15":15.49,"mae30":26.30,"direction":0.56,"arrow":0.55,"fall":{"truth":41,"caught":1,"falseAlarms":2},"rise":{"truth":52,"caught":6,"falseAlarms":1}}},
    "after_food_mae15":{"none":20.72,"context":18.92}}',
  1);
