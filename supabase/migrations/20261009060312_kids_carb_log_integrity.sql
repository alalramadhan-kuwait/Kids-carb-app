-- Release 1, part 1: a deleted meal can be brought back and says who deleted it; a retried meal save is saved once.
alter table carb.meal_history
  add column if not exists deleted_at timestamptz,
  add column if not exists deleted_by uuid,
  add column if not exists created_at timestamptz default now(),
  add column if not exists client_id uuid unique;
create index if not exists meal_history_live_idx on carb.meal_history (eaten_at desc) where deleted_at is null;
