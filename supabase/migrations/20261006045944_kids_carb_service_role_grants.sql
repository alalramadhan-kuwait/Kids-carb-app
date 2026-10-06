-- The server functions (carb-glucose, carb-activity) act as service_role, which had no table privileges on these
-- three tables. Every read failed quietly: planned-meal reminders, the recheck after a low treatment and the shared
-- activity pushes were never sent. Read for all three; update where the server records what it sent.
grant select, update on carb.events to service_role;        -- recheck_sent_at; activity: was the entry deleted
grant select, update on carb.planned_meals to service_role; -- notified: each reminder once
grant select on carb.meal_history to service_role;          -- activity: was the meal deleted
