-- cells.garden — M2: exactly one garden row per user
-- Two pages signing in at the same moment (New Tab + Side Panel, or two tabs)
-- could each insert a row, because gardens(user_id) had no unique constraint.
-- Keep the most recently updated row per user, then make duplicates impossible.
-- Safe to run more than once.

-- 1. Remove duplicates: delete every row that has a newer sibling for the same user.
delete from public.gardens g
using public.gardens newer
where newer.user_id = g.user_id
  and (newer.updated_at, newer.id) > (g.updated_at, g.id);

-- 2. One garden per user (the unique index also replaces the plain index from 0001).
drop index if exists public.gardens_user_id_idx;
create unique index if not exists gardens_user_id_key on public.gardens (user_id);
