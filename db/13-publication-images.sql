-- Deliberately private. Public reads must pass through the current-publication gate.
insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values ('publication-images','publication-images',false,8388608,array['image/png']);
-- No anon/authenticated storage policies. Service role copies only reviewed bytes.
