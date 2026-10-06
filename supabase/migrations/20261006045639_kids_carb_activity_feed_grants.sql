-- carb-activity reads and claims the queue with the service role; the table was created without its grants, so every
-- read failed and nothing was ever sent. (No grants for app users: the queue is server-only.)
grant select, update on carb.activity_feed to service_role;
