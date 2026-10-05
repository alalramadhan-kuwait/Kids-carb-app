-- Each food and recipe can carry its name in Arabic and in English, so reports show one language.
-- `name` stays the main name as entered; the two new columns are optional and curated.
alter table carb.products add column if not exists name_ar text, add column if not exists name_en text;
alter table carb.recipes add column if not exists name_ar text, add column if not exists name_en text;
comment on column carb.products.name_ar is 'Arabic display name (curated); falls back to name';
comment on column carb.products.name_en is 'English display name (curated); falls back to name';
comment on column carb.recipes.name_ar is 'Arabic display name (curated); falls back to name';
comment on column carb.recipes.name_en is 'English display name (curated); falls back to name';
