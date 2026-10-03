-- A photo kept with a food entry for reference (AI estimate on hold): the parents can re-estimate the carbs later.
alter table carb.meal_history add column if not exists photo_path text;
alter table carb.meal_history add constraint meal_history_photo_path_len check (photo_path is null or length(photo_path) <= 300);
comment on column carb.meal_history.photo_path is 'carb-photos storage path of a photo taken with the entry, for re-estimating its carbs later';
