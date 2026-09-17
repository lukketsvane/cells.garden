-- cells.garden: M4 shared gardens. Safe to run more than once.
--
-- An owner shares their one garden row by link. Members read and update that
-- row; nothing else about the owner's row, the unique index from 0002 or the
-- insert/delete policies changes. A server-owned revision lets clients save
-- with compare-and-swap and merge instead of overwriting each other.

-- ---------------------------------------------------------------------------
-- 1. gardens.rev: a server-owned version for compare-and-swap.
--    The trigger overwrites whatever the client sends, so a client can neither
--    skip ahead nor roll back. It also makes user_id immutable, because members
--    get UPDATE below and must not be able to take a garden over.
-- ---------------------------------------------------------------------------
alter table public.gardens add column if not exists rev bigint not null default 0;

create or replace function public.gardens_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.user_id <> old.user_id then
        raise exception 'gardens.user_id is immutable' using errcode = '42501';
    end if;
    new.updated_at = greatest(coalesce(new.updated_at, now()), old.updated_at);
    new.created_at = old.created_at;
    new.rev = old.rev + 1;
    return new;
end;
$$;

drop trigger if exists gardens_touch_updated_at on public.gardens;
drop trigger if exists gardens_before_update on public.gardens;
create trigger gardens_before_update
    before update on public.gardens
    for each row execute function public.gardens_before_update();
drop function if exists public.touch_updated_at();

-- ---------------------------------------------------------------------------
-- 2. Who may open a garden besides its owner. Everyone here is an editor.
--    user_id references profiles so PostgREST can embed display_name.
-- ---------------------------------------------------------------------------
create table if not exists public.garden_members (
    garden_id  uuid not null references public.gardens (id) on delete cascade,
    user_id    uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (garden_id, user_id)
);
create index if not exists garden_members_user_id_idx on public.garden_members (user_id);
alter table public.garden_members enable row level security;

-- ---------------------------------------------------------------------------
-- 3. One invite link per garden. The token is the secret (uuid v4, 122 bits).
--    The owner rotates it by writing a new one and turns the link off by
--    deleting the row. Members never see this table.
-- ---------------------------------------------------------------------------
create table if not exists public.garden_invites (
    garden_id  uuid primary key references public.gardens (id) on delete cascade,
    token      uuid not null unique default gen_random_uuid(),
    created_at timestamptz not null default now()
);
alter table public.garden_invites enable row level security;

-- ---------------------------------------------------------------------------
-- 4. Helpers. SECURITY DEFINER so policies on gardens and garden_members can
--    look at each other without RLS recursion. They only ever answer about
--    the caller (auth.uid()).
-- ---------------------------------------------------------------------------
create or replace function public.is_garden_owner(gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.gardens g where g.id = gid and g.user_id = (select auth.uid()));
$$;

create or replace function public.can_access_garden(gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select public.is_garden_owner(gid)
        or exists (select 1 from public.garden_members m
                   where m.garden_id = gid and m.user_id = (select auth.uid()));
$$;

-- True when the caller and `other` are owner or member of at least one common garden.
create or replace function public.shares_garden_with(other uuid)
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

revoke all on function public.is_garden_owner(uuid), public.can_access_garden(uuid), public.shares_garden_with(uuid) from public, anon;
grant execute on function public.is_garden_owner(uuid), public.can_access_garden(uuid), public.shares_garden_with(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 5. The only way in: present the token, become a member. Returns the garden
--    so the client can open it at once. The owner following their own link
--    is a no-op that still returns the garden. At most 20 members per garden.
-- ---------------------------------------------------------------------------
create or replace function public.join_garden(invite uuid)
returns table (garden_id uuid, name text)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
    uid uuid := (select auth.uid());
    gid uuid;
begin
    if uid is null then
        raise exception 'sign in first' using errcode = '28000';
    end if;
    select i.garden_id into gid from public.garden_invites i where i.token = invite;
    if gid is null then
        raise exception 'invalid invite' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.gardens g where g.id = gid and g.user_id = uid)
       and not exists (select 1 from public.garden_members m where m.garden_id = gid and m.user_id = uid) then
        if (select count(*) from public.garden_members m where m.garden_id = gid) >= 20 then
            raise exception 'garden is full' using errcode = '53400';
        end if;
        insert into public.garden_members (garden_id, user_id) values (gid, uid)
        on conflict do nothing;
    end if;
    return query select g.id, g.name from public.gardens g where g.id = gid;
end;
$$;
revoke all on function public.join_garden(uuid) from public, anon;
grant execute on function public.join_garden(uuid) to authenticated;

-- ---------------------------------------------------------------------------
-- 6. Policies
-- ---------------------------------------------------------------------------
-- gardens: SELECT and UPDATE open up to members. INSERT and DELETE stay owner-only.
drop policy if exists "gardens: owner can select" on public.gardens;
drop policy if exists "gardens: owner and members can select" on public.gardens;
create policy "gardens: owner and members can select"
    on public.gardens for select
    to authenticated
    using (public.can_access_garden(id));

drop policy if exists "gardens: owner can update" on public.gardens;
drop policy if exists "gardens: owner and members can update" on public.gardens;
create policy "gardens: owner and members can update"
    on public.gardens for update
    to authenticated
    using (public.can_access_garden(id))
    with check (public.can_access_garden(id));

-- garden_members: peers see the list; a member may leave, the owner may remove.
-- No INSERT or UPDATE policy: rows are created only by join_garden().
drop policy if exists "garden_members: peers can select" on public.garden_members;
create policy "garden_members: peers can select"
    on public.garden_members for select
    to authenticated
    using (public.can_access_garden(garden_id));

drop policy if exists "garden_members: leave or be removed" on public.garden_members;
create policy "garden_members: leave or be removed"
    on public.garden_members for delete
    to authenticated
    using (user_id = (select auth.uid()) or public.is_garden_owner(garden_id));

-- garden_invites: owner only, every verb.
drop policy if exists "garden_invites: owner only" on public.garden_invites;
create policy "garden_invites: owner only"
    on public.garden_invites for all
    to authenticated
    using (public.is_garden_owner(garden_id))
    with check (public.is_garden_owner(garden_id));

-- profiles: people who share a garden may read each other's display_name.
drop policy if exists "profiles: owner can read" on public.profiles;
drop policy if exists "profiles: owner and garden peers can read" on public.profiles;
create policy "profiles: owner and garden peers can read"
    on public.profiles for select
    to authenticated
    using (id = (select auth.uid()) or public.shares_garden_with(id));

-- Realtime: gardens is already in the publication (0001). Nothing else is added.
