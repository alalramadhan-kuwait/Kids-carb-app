-- Entries can be edited from the log; an edited imported entry is never overwritten by a later re-sync.
alter table carb.meal_history add column if not exists edited_at timestamptz, add column if not exists edited_by uuid;
