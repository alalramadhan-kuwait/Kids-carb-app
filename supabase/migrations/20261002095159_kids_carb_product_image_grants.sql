-- The product-picture function (service role) reads products and saves the picture it found.
grant usage on schema carb to service_role;
grant select, update (image_path, image_source) on carb.products to service_role;
