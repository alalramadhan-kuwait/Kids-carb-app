-- The high alert can be a notification only, without the full-screen alarm in the app; switched to notification-only at the parents' request.
alter table carb.settings add column if not exists alert_high_screen boolean not null default true;
comment on column carb.settings.alert_high_screen is 'High alert as the full-screen alarm in the app; off = notification only';
update carb.settings set alert_high_screen = false where alert_high_screen is distinct from false;
