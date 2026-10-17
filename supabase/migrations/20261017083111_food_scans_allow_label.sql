-- Nutrition label reading: the carb-food function records each label read as kind 'label'.
alter table carb.food_scans drop constraint food_scans_kind_check;
alter table carb.food_scans add constraint food_scans_kind_check check (kind = any (array['photo','barcode','label']));
