-- Stage 3: exercise and sleep join the event log, so the timeline rail can show them.
alter table carb.events drop constraint events_kind_check;
alter table carb.events add constraint events_kind_check check (kind in ('insulin', 'carbs', 'treatment', 'note', 'exercise', 'sleep'));
alter table carb.events
  add column activity_min   int check (activity_min > 0 and activity_min <= 600),
  add column activity_level text check (activity_level in ('light', 'moderate', 'hard')),
  add column ends_at        timestamptz,
  add constraint events_exercise_minutes check (kind <> 'exercise' or activity_min is not null),
  add constraint events_sleep_window check (kind <> 'sleep' or (ends_at is not null and ends_at > occurred_at and ends_at - occurred_at <= interval '16 hours'));
