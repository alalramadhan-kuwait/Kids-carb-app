-- Fast fall and fast rise get their own thresholds (mg/dL per minute); the shared alert_rapid_rate stays as a fallback.
alter table carb.settings
  add column if not exists alert_fall_rate numeric check (alert_fall_rate between 1 and 6),
  add column if not exists alert_rise_rate numeric check (alert_rise_rate between 1 and 6),
  -- "low expected": warn when the last 15 minutes' fall would reach the low limit within this many minutes; null = off
  add column if not exists alert_predict_low_min integer check (alert_predict_low_min between 10 and 40);

update carb.settings set alert_fall_rate = coalesce(alert_fall_rate, alert_rapid_rate), alert_rise_rate = coalesce(alert_rise_rate, alert_rapid_rate)
where alert_rapid_rate is not null;

alter table carb.alerts drop constraint if exists alerts_kind_check;
alter table carb.alerts add constraint alerts_kind_check
  check (kind = any (array['urgent_low','low','predicted_low','high','no_data','rapid_fall','rapid_rise']));
