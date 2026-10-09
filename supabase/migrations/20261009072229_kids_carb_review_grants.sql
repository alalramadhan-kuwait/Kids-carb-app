-- The signed-in parents read and add dose reviews (rows are never changed: no update or delete grant or policy),
-- and can read the audit trail (only the database writes it).
grant select, insert on carb.dose_recalcs to authenticated;
grant select on carb.entry_audit to authenticated;
