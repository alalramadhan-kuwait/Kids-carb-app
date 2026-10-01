-- Stage 10: parameters for the display-only IOB / COB tracks, entered by the parents from the care team.
-- All empty = the tracks stay off. Nothing in the app uses them to suggest anything.
alter table carb.settings
  add column iob_dia_min    int check (iob_dia_min between 120 and 480),     -- rapid insulin duration of action
  add column iob_peak_min   int check (iob_peak_min between 35 and 120),     -- rapid insulin peak activity
  add column cob_absorb_min int check (cob_absorb_min between 60 and 360);   -- carb absorption time (linear)
