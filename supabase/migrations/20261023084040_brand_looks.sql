-- How a brand or restaurant looks on the Nutrition page (a colour badge with its initials and a food picture, or a
-- photo of its logo the family took), and which button it sits under. Without a row the app works one out from the
-- brand's own products. Additive only.
create table if not exists carb.brand_looks (
  brand      text primary key,
  kind       text check (kind in ('restaurant', 'brand')),
  bg         text check (bg ~ '^#[0-9A-Fa-f]{6}$'),
  emoji      text check (char_length(emoji) <= 8),
  photo_path text,
  updated_by uuid default auth.uid(),
  updated_at timestamptz not null default now()
);
alter table carb.brand_looks enable row level security;
create policy brand_looks_members on carb.brand_looks for all using (carb.is_member()) with check (carb.is_member());
grant select, insert, update, delete on carb.brand_looks to authenticated;
grant select, insert, update, delete on carb.brand_looks to service_role;
