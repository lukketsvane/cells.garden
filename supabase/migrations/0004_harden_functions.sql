-- cells.garden: close two gaps the database linter found in 0001
--
-- 1. `handle_new_user` is SECURITY DEFINER, so it runs as its owner. It is only
--    ever meant to fire from the trigger on auth.users, but PostgREST exposes
--    every function in `public`, so `anon` could reach it at
--    /rest/v1/rpc/handle_new_user. Postgres refuses to run a trigger function
--    called directly, so there was nothing to steal, but a definer function
--    should not be on the public API surface at all.
--
-- 2. `touch_updated_at` had no `search_path`. A function without one resolves
--    unqualified names through the caller's path, which is how a definer
--    function gets tricked into calling someone else's `now()`. This one is
--    not SECURITY DEFINER, so it was not exploitable either, but both are
--    pinned here so the linter comes back clean.
--
-- Safe to run more than once.

-- ---------------------------------------------------------------------------
-- 1. Keep the sign-up trigger off the REST surface.
-- ---------------------------------------------------------------------------
revoke all on function public.handle_new_user() from public, anon, authenticated;

-- The trigger itself runs as the table owner, so it is unaffected by the revoke.

-- ---------------------------------------------------------------------------
-- 2. Pin both functions to an empty search_path.
--    `now()` and `greatest()` live in pg_catalog, which Postgres always
--    searches first, so the bodies need no other change.
-- ---------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = ''
as $$
begin
    insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
    on conflict (id) do nothing;
    return new;
end;
$$;

-- `create or replace` resets the grants, so revoke again after redefining.
revoke all on function public.handle_new_user() from public, anon, authenticated;

create or replace function public.touch_updated_at()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    new.updated_at = greatest(coalesce(new.updated_at, now()), old.updated_at);
    return new;
end;
$$;
