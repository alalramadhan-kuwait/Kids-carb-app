-- «No reading» alert can be switched off by the parents (push and the full-screen alarm); switched off at their request.
alter table carb.settings add column if not exists alert_nodata_on boolean not null default true;
comment on column carb.settings.alert_nodata_on is 'No-reading alert (push and full-screen alarm); the parents can switch it off';
update carb.settings set alert_nodata_on = false where alert_nodata_on is distinct from false;
