-- The server functions (service_role) read and write the Stage 1 and Stage 3 tables; like every other carb table,
-- they need it granted explicitly.
grant select, insert, update, delete on carb.param_history, carb.dose_meal_links, carb.benchmark_runs, carb.forecast_shadow to service_role;
grant select on carb.glucose_quality, carb.forecast_shadow_scored to service_role;
