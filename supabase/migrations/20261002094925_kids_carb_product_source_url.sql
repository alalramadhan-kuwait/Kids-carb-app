-- A product can keep the maker's page it came from, and where its picture was taken from.
alter table carb.products add column if not exists source_url text, add column if not exists image_source text;
update carb.products set source_url = substring(notes from '(https://[^ ]+)') where source_url is null and notes ~ 'https://';
