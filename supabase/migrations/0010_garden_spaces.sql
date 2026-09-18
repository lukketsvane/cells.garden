-- cells.garden: garden spaces. Safe to run more than once.
--
-- Besides their own garden, people can make any number of extra gardens
-- ("spaces") and share them like any garden. A space is a gardens row with no
-- user_id and the creator in owner_id. Keeping user_id empty means nothing that
-- looks up "my garden" by user_id (every client build since M1) can ever open a
-- space by mistake. Ownership checks read coalesce(user_id, owner_id).

alter table public.gardens add column if not exists owner_id uuid references public.profiles (id) on delete cascade;
alter table public.gardens alter column user_id drop not null;
create index if not exists gardens_owner_id_idx on public.gardens (owner_id) where owner_id is not null;

do $$
begin
    if not exists (select 1 from pg_constraint where conname = 'gardens_one_owner') then
        -- Exactly one of the two: an own garden has user_id, a space has owner_id.
        alter table public.gardens add constraint gardens_one_owner
            check ((user_id is null) <> (owner_id is null));
    end if;
end $$;

-- Nobody moves a garden between accounts, or turns a space into an own garden.
create or replace function public.gardens_before_update()
returns trigger
language plpgsql
set search_path = ''
as $$
begin
    if new.user_id is distinct from old.user_id or new.owner_id is distinct from old.owner_id then
        raise exception 'a garden''s owner is immutable' using errcode = '42501';
    end if;
    new.updated_at = greatest(coalesce(new.updated_at, now()), old.updated_at);
    new.created_at = old.created_at;
    new.rev = old.rev + 1;
    return new;
end;
$$;

create or replace function private.is_garden_owner(gid uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (select 1 from public.gardens g
                   where g.id = gid and coalesce(g.user_id, g.owner_id) = (select auth.uid()));
$$;

create or replace function private.shares_garden_with(other uuid)
returns boolean
language sql stable security definer set search_path = ''
as $$
    select exists (
        select 1 from public.gardens g
        where (coalesce(g.user_id, g.owner_id) = (select auth.uid())
               or exists (select 1 from public.garden_members m where m.garden_id = g.id and m.user_id = (select auth.uid())))
          and (coalesce(g.user_id, g.owner_id) = other
               or exists (select 1 from public.garden_members m where m.garden_id = g.id and m.user_id = other))
    );
$$;

-- Policies: the owner is user_id for an own garden, owner_id for a space.
drop policy if exists "gardens: owner and members can select" on public.gardens;
create policy "gardens: owner and members can select"
    on public.gardens for select to authenticated
    using (coalesce(user_id, owner_id) = (select auth.uid()) or private.can_access_garden(id));

drop policy if exists "gardens: owner and members can update" on public.gardens;
create policy "gardens: owner and members can update"
    on public.gardens for update to authenticated
    using (coalesce(user_id, owner_id) = (select auth.uid()) or private.can_access_garden(id))
    with check (coalesce(user_id, owner_id) = (select auth.uid()) or private.can_access_garden(id));

drop policy if exists "gardens: owner can insert" on public.gardens;
create policy "gardens: owner can insert"
    on public.gardens for insert to authenticated
    with check (coalesce(user_id, owner_id) = (select auth.uid()));

drop policy if exists "gardens: owner can delete" on public.gardens;
create policy "gardens: owner can delete"
    on public.gardens for delete to authenticated
    using (coalesce(user_id, owner_id) = (select auth.uid()));

-- join_garden: following your own space's link is a no-op, as for an own garden.
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
    if not exists (select 1 from public.gardens g where g.id = gid and coalesce(g.user_id, g.owner_id) = uid)
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

-- friends(): people in a space count like people in an own garden.
create or replace function public.friends()
returns table (user_id uuid, display_name text, avatar_seed text, gardens bigint, plants bigint)
language sql stable security definer set search_path = ''
as $$
    with me as (select (select auth.uid()) as id),
    my_gardens as (
        select g.id from public.gardens g, me where coalesce(g.user_id, g.owner_id) = me.id
        union
        select m.garden_id from public.garden_members m, me where m.user_id = me.id
    ),
    garden_people as (
        select coalesce(g.user_id, g.owner_id) as person, g.id as garden_id from public.gardens g where g.id in (select id from my_gardens)
        union
        select m.user_id, m.garden_id from public.garden_members m where m.garden_id in (select id from my_gardens)
    ),
    my_plants as (
        select p.id from public.plants p, me where p.owner_id = me.id
        union
        select m.plant_id from public.plant_members m, me where m.user_id = me.id
    ),
    plant_people as (
        select p.owner_id as person, p.id as plant_id from public.plants p where p.id in (select id from my_plants)
        union
        select m.user_id, m.plant_id from public.plant_members m where m.plant_id in (select id from my_plants)
    ),
    people as (
        select person from garden_people union select person from plant_people
    )
    select pe.person,
           coalesce(pr.display_name, 'someone'),
           coalesce(pr.avatar_seed, pe.person::text),
           (select count(distinct gp.garden_id) from garden_people gp where gp.person = pe.person),
           (select count(distinct pp.plant_id) from plant_people pp where pp.person = pe.person)
    from people pe
    left join public.profiles pr on pr.id = pe.person
    where pe.person <> (select id from me)
    order by 2;
$$;
revoke all on function public.friends() from public, anon;
grant execute on function public.friends() to authenticated;
