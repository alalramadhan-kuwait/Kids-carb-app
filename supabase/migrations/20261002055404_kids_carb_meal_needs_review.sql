-- An imported meal next to an entry the parents have not decided on yet: shown as "needs confirmation" and left
-- out of prediction research until decided.
alter table carb.meal_history add column needs_review boolean not null default false;
grant delete on carb.import_entries to authenticated;
