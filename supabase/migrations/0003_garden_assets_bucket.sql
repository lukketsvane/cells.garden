-- cells.garden: M3 storage for custom art
--
-- Cells can point at art the user supplied rather than at the bundled pack.
-- That art is too big for the garden's JSON blob, so it lives in Storage, one
-- private folder per user:
--
--   garden-assets/<uid>/custom/<hash>.png
--
-- `<hash>` is content-addressed, so the same picture on two plants is stored
-- once and a re-upload is a no-op. The path after `<uid>/` is exactly the
-- `imagePath` a cell carries, which is also what the markdown export writes.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- The bucket. Private: every read goes through a signed URL, never a public one.
-- ---------------------------------------------------------------------------
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values (
    'garden-assets',
    'garden-assets',
    false,
    5242880, -- 5 MB; sprite art is tiny and this stops an accidental raw photo
    array['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/svg+xml']
)
on conflict (id) do update
set public             = excluded.public,
    file_size_limit    = excluded.file_size_limit,
    allowed_mime_types = excluded.allowed_mime_types;

-- ---------------------------------------------------------------------------
-- RLS: a user sees only the folder named after their own uid.
-- storage.objects already has row level security enabled by Supabase.
-- ---------------------------------------------------------------------------
drop policy if exists "garden assets: owner can read" on storage.objects;
create policy "garden assets: owner can read"
    on storage.objects for select
    using (
        bucket_id = 'garden-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "garden assets: owner can upload" on storage.objects;
create policy "garden assets: owner can upload"
    on storage.objects for insert
    with check (
        bucket_id = 'garden-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "garden assets: owner can replace" on storage.objects;
create policy "garden assets: owner can replace"
    on storage.objects for update
    using (
        bucket_id = 'garden-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    )
    with check (
        bucket_id = 'garden-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );

drop policy if exists "garden assets: owner can delete" on storage.objects;
create policy "garden assets: owner can delete"
    on storage.objects for delete
    using (
        bucket_id = 'garden-assets'
        and (storage.foldername(name))[1] = auth.uid()::text
    );
