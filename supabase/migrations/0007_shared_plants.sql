-- cells.garden: collaborative plants. Safe to run more than once.
--
-- One plant shared by link into other people's own gardens. The plant's cells
-- live in `plants.data` (a ProjectData without its garden-specific `order`);
-- every garden that holds the plant keeps a copy in its blob for offline use and
-- points at the row with `sharedPlantId`. Members read and update the row; only
-- the owner creates it, deletes it, makes the link and removes people.

create table if not exists public.plants (
    id         uuid primary key default gen_random_uuid(),
    owner_id   uuid not null references public.profiles (id) on delete cascade,
    data       jsonb not null default '{}'::jsonb,
    rev        bigint not null default 0,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);
create index if not exists plants_owner_id_idx on public.plants (owner_id);
alter table public.plants enable row level security;

create or replace function public.plants_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.owner_id <> old.owner_id then
        raise exception 'plants.owner_id is immutable' using errcode = '42501';
    end if;
    new.created_at = old.created_at;
    new.updated_at = now();
    new.rev = old.rev + 1;
    return new;
end;
$$;

drop trigger if exists plants_before_update on public.plants;
create trigger plants_before_update
    before update on public.plants
    for each row execute function public.plants_before_update();

create table if not exists public.plant_members (
    plant_id   uuid not null references public.plants (id) on delete cascade,
    user_id    uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (plant_id, user_id)
);
create index if not exists plant_members_user_id_idx on public.plant_members (user_id);
alter table public.plant_members enable row level security;

create table if not exists public.plant_invites (
    plant_id   uuid primary key references public.plants (id) on delete cascade,
    token      uuid not null unique default gen_random_uuid(),
    created_at timestamptz not null default now()
);
alter table public.plant_invites enable row level security;

create schema if not exists private;

create or replace function private.is_plant_owner(pid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.plants p where p.id = pid and p.owner_id = (select auth.uid()));
$$;

create or replace function private.can_access_plant(pid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select private.is_plant_owner(pid)
        or exists (select 1 from public.plant_members m
                   where m.plant_id = pid and m.user_id = (select auth.uid()));
$$;

-- True when the caller and `other` are owner or member of at least one common plant.
create or replace function private.shares_plant_with(other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.plants p
        where (p.owner_id = (select auth.uid())
               or exists (select 1 from public.plant_members m where m.plant_id = p.id and m.user_id = (select auth.uid())))
          and (p.owner_id = other
               or exists (select 1 from public.plant_members m where m.plant_id = p.id and m.user_id = other))
    );
$$;

revoke all on function private.is_plant_owner(uuid), private.can_access_plant(uuid), private.shares_plant_with(uuid) from public, anon;
grant execute on function private.is_plant_owner(uuid), private.can_access_plant(uuid), private.shares_plant_with(uuid) to authenticated;

-- The only way in. Returns the plant so the client can add it to the garden.
create or replace function public.join_plant(invite uuid)
returns table (plant_id uuid, data jsonb, rev bigint)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
    uid uuid := (select auth.uid());
    pid uuid;
begin
    if uid is null then
        raise exception 'sign in first' using errcode = '28000';
    end if;
    select i.plant_id into pid from public.plant_invites i where i.token = invite;
    if pid is null then
        raise exception 'invalid invite' using errcode = 'P0002';
    end if;
    if not exists (select 1 from public.plants p where p.id = pid and p.owner_id = uid)
       and not exists (select 1 from public.plant_members m where m.plant_id = pid and m.user_id = uid) then
        if (select count(*) from public.plant_members m where m.plant_id = pid) >= 20 then
            raise exception 'plant is full' using errcode = '53400';
        end if;
        insert into public.plant_members (plant_id, user_id) values (pid, uid)
        on conflict do nothing;
    end if;
    return query select p.id, p.data, p.rev from public.plants p where p.id = pid;
end;
$$;
revoke all on function public.join_plant(uuid) from public, anon;
grant execute on function public.join_plant(uuid) to authenticated;

-- plants
drop policy if exists "plants: owner and members can select" on public.plants;
create policy "plants: owner and members can select"
    on public.plants for select to authenticated
    using (private.can_access_plant(id));

drop policy if exists "plants: owner can insert" on public.plants;
create policy "plants: owner can insert"
    on public.plants for insert to authenticated
    with check (owner_id = (select auth.uid()));

drop policy if exists "plants: owner and members can update" on public.plants;
create policy "plants: owner and members can update"
    on public.plants for update to authenticated
    using (private.can_access_plant(id))
    with check (private.can_access_plant(id));

drop policy if exists "plants: owner can delete" on public.plants;
create policy "plants: owner can delete"
    on public.plants for delete to authenticated
    using (owner_id = (select auth.uid()));

-- plant_members: peers see the list; a member may leave, the owner may remove.
drop policy if exists "plant_members: peers can select" on public.plant_members;
create policy "plant_members: peers can select"
    on public.plant_members for select to authenticated
    using (private.can_access_plant(plant_id));

drop policy if exists "plant_members: leave or be removed" on public.plant_members;
create policy "plant_members: leave or be removed"
    on public.plant_members for delete to authenticated
    using (user_id = (select auth.uid()) or private.is_plant_owner(plant_id));

-- plant_invites: owner only.
drop policy if exists "plant_invites: owner only" on public.plant_invites;
create policy "plant_invites: owner only"
    on public.plant_invites for all to authenticated
    using (private.is_plant_owner(plant_id))
    with check (private.is_plant_owner(plant_id));

-- profiles: people who share a plant may also read each other's display_name.
drop policy if exists "profiles: owner and garden peers can read" on public.profiles;
drop policy if exists "profiles: owner and peers can read" on public.profiles;
create policy "profiles: owner and peers can read"
    on public.profiles for select to authenticated
    using (id = (select auth.uid()) or private.shares_garden_with(id) or private.shares_plant_with(id));

-- Realtime: members hear each other's edits.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'plants'
    ) then
        alter publication supabase_realtime add table public.plants;
    end if;
end $$;
