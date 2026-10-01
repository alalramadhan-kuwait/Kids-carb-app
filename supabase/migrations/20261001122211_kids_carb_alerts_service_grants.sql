-- The alert evaluator (edge function, service role) writes alerts, notifications and the VAPID public key.
grant select, insert, update, delete on carb.alerts, carb.notifications, carb.push_subscriptions, carb.push_config, carb.care_plan to service_role;
