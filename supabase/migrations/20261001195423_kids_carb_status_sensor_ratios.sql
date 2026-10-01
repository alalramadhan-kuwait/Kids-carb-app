-- Status page: the doctor's carb ratio / correction factor (display-only estimate), and the CGM sensor's life.
-- ratios: [{from:'HH:MM', cr: g per unit, isf: mg/dL per unit}], empty = no estimate shown.
alter table carb.settings
  add column ratios jsonb not null default '[]'::jsonb check (jsonb_typeof(ratios) = 'array' and jsonb_array_length(ratios) <= 8),
  add column sensor_days int not null default 14 check (sensor_days in (14, 15));

-- written by carb-glucose from LibreLinkUp (activation time and serial); readable by members through cgm_state_read
alter table carb.cgm_state
  add column sensor_sn text,
  add column sensor_started_at timestamptz,
  add column sensor_reminded text; -- '<sn>:24' / '<sn>:2' once that reminder went out
