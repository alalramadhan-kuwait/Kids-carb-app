-- The basic food database: total sugars per 100 g (labels and USDA give total sugars; added sugar stays separate),
-- and a picture word (emoji) for generic foods that have no photo.
alter table carb.products add column if not exists sugar_per_100 numeric;
alter table carb.products add column if not exists emoji text;
