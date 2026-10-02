-- The insulin brands, for clinical reports (the insulin curve itself stays in iob_dia_min / iob_peak_min).
alter table carb.settings add column if not exists rapid_insulin text;
alter table carb.settings add column if not exists basal_insulin text;
alter table carb.settings add constraint settings_insulin_names_len check (coalesce(length(rapid_insulin), 0) <= 60 and coalesce(length(basal_insulin), 0) <= 60);
update carb.settings set rapid_insulin = coalesce(rapid_insulin, 'NovoRapid (insulin aspart)'), basal_insulin = coalesce(basal_insulin, 'Tresiba (insulin degludec)') where id = true;
