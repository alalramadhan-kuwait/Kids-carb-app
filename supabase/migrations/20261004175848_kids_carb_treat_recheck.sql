-- A "check again" push after every logged low treatment (carb-glucose, every minute): claimed per event.
alter table carb.events add column if not exists recheck_sent_at timestamptz;
alter table carb.settings add column if not exists treat_recheck_min int not null default 15 check (treat_recheck_min between 5 and 60);
