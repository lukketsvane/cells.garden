-- cells.garden: keep the policy helpers from 0005 out of the API. Safe to run more than once.
--
-- Functions in `public` are reachable as /rest/v1/rpc/<name>. The helpers only
-- answer about the caller, but nothing needs to call them directly, so they move
-- to a schema PostgREST does not expose. join_garden stays in public: it is the
-- one RPC the client calls. Also evaluates auth.uid() once per statement in the
-- three older policies the performance advisor flags.

create schema if not exists private;
revoke all on schema private from public, anon;
grant usage on schema private to authenticated;

create or replace function private.is_garden_owner(gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.gardens g where g.id = gid and g.user_id = (select auth.uid()));
$$;

create or replace function private.can_access_garden(gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select private.is_garden_owner(gid)
        or exists (select 1 from public.garden_members m
                   where m.garden_id = gid and m.user_id = (select auth.uid()));
$$;

create or replace function private.shares_garden_with(other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.gardens g
        where (g.user_id = (select auth.uid())
               or exists (select 1 from public.garden_members m where m.garden_id = g.id and m.user_id = (select auth.uid())))
          and (g.user_id = other
               or exists (select 1 from public.garden_members m where m.garden_id = g.id and m.user_id = other))
    );
$$;

revoke all on function private.is_garden_owner(uuid), private.can_access_garden(uuid), private.shares_garden_with(uuid) from public, anon;
grant execute on function private.is_garden_owner(uuid), private.can_access_garden(uuid), private.shares_garden_with(uuid) to authenticated;

-- Policies now point at the private helpers.
drop policy if exists "gardens: owner and members can select" on public.gardens;
create policy "gardens: owner and members can select"
    on public.gardens for select to authenticated
    using (private.can_access_garden(id));

drop policy if exists "gardens: owner and members can update" on public.gardens;
create policy "gardens: owner and members can update"
    on public.gardens for update to authenticated
    using (private.can_access_garden(id))
    with check (private.can_access_garden(id));

drop policy if exists "garden_members: peers can select" on public.garden_members;
create policy "garden_members: peers can select"
    on public.garden_members for select to authenticated
    using (private.can_access_garden(garden_id));

drop policy if exists "garden_members: leave or be removed" on public.garden_members;
create policy "garden_members: leave or be removed"
    on public.garden_members for delete to authenticated
    using (user_id = (select auth.uid()) or private.is_garden_owner(garden_id));

drop policy if exists "garden_invites: owner only" on public.garden_invites;
create policy "garden_invites: owner only"
    on public.garden_invites for all to authenticated
    using (private.is_garden_owner(garden_id))
    with check (private.is_garden_owner(garden_id));

drop policy if exists "profiles: owner and garden peers can read" on public.profiles;
create policy "profiles: owner and garden peers can read"
    on public.profiles for select to authenticated
    using (id = (select auth.uid()) or private.shares_garden_with(id));

-- Older owner-only policies from 0001, rewritten with (select auth.uid()).
drop policy if exists "gardens: owner can insert" on public.gardens;
create policy "gardens: owner can insert"
    on public.gardens for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists "gardens: owner can delete" on public.gardens;
create policy "gardens: owner can delete"
    on public.gardens for delete to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "profiles: owner can update" on public.profiles;
create policy "profiles: owner can update"
    on public.profiles for update to authenticated
    using (id = (select auth.uid()))
    with check (id = (select auth.uid()));

-- The public copies are no longer referenced.
drop function if exists public.shares_garden_with(uuid);
drop function if exists public.can_access_garden(uuid);
drop function if exists public.is_garden_owner(uuid);
