-- cells.garden: friends and plant offers. Safe to run more than once.
--
-- A friend is anyone you share a garden or a plant with: the people you already
-- grow things with. You can offer one of your shared plants straight to a friend,
-- without a link. The offer waits until they take it into their garden or turn
-- it down; taking it makes them a member, like following the plant's link.

-- The generated profile picture's seed: random for every account, and a new one
-- is a new picture. Existing accounts get theirs here.
alter table public.profiles add column if not exists avatar_seed text;
update public.profiles set avatar_seed = substr(md5(random()::text || clock_timestamp()::text), 1, 16) where avatar_seed is null;
alter table public.profiles alter column avatar_seed set default substr(md5(random()::text || clock_timestamp()::text), 1, 16);

-- Everyone who shares a garden or a plant with the caller, with what they share.
create or replace function public.friends()
returns table (user_id uuid, display_name text, avatar_seed text, gardens bigint, plants bigint)
language sql stable security definer set search_path = ''
as $$
    with me as (select (select auth.uid()) as id),
    my_gardens as (
        select g.id from public.gardens g, me where g.user_id = me.id
        union
        select m.garden_id from public.garden_members m, me where m.user_id = me.id
    ),
    garden_people as (
        select g.user_id as person, g.id as garden_id from public.gardens g where g.id in (select id from my_gardens)
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

create table if not exists public.plant_offers (
    plant_id   uuid not null references public.plants (id) on delete cascade,
    to_id      uuid not null references public.profiles (id) on delete cascade,
    from_id    uuid not null references public.profiles (id) on delete cascade,
    created_at timestamptz not null default now(),
    primary key (plant_id, to_id)
);
create index if not exists plant_offers_to_id_idx on public.plant_offers (to_id);
alter table public.plant_offers enable row level security;

-- The sender and the receiver see an offer; either can withdraw or turn it down.
drop policy if exists "plant_offers: sender and receiver can select" on public.plant_offers;
create policy "plant_offers: sender and receiver can select"
    on public.plant_offers for select to authenticated
    using (to_id = (select auth.uid()) or from_id = (select auth.uid()));

drop policy if exists "plant_offers: sender and receiver can delete" on public.plant_offers;
create policy "plant_offers: sender and receiver can delete"
    on public.plant_offers for delete to authenticated
    using (to_id = (select auth.uid()) or from_id = (select auth.uid()));

-- Offer a plant the caller can open to a friend. Offers are made only here.
create or replace function public.offer_plant(pid uuid, friend uuid)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
    uid uuid := (select auth.uid());
begin
    if uid is null then
        raise exception 'sign in first' using errcode = '28000';
    end if;
    if not private.can_access_plant(pid) then
        raise exception 'not your plant' using errcode = '42501';
    end if;
    if friend = uid or not (private.shares_garden_with(friend) or private.shares_plant_with(friend)) then
        raise exception 'not a friend' using errcode = '42501';
    end if;
    if exists (select 1 from public.plants p where p.id = pid and p.owner_id = friend)
       or exists (select 1 from public.plant_members m where m.plant_id = pid and m.user_id = friend) then
        return; -- they have it already
    end if;
    insert into public.plant_offers (plant_id, to_id, from_id) values (pid, friend, uid)
    on conflict (plant_id, to_id) do update set from_id = excluded.from_id, created_at = now();
end;
$$;
revoke all on function public.offer_plant(uuid, uuid) from public, anon;
grant execute on function public.offer_plant(uuid, uuid) to authenticated;

-- What is waiting for the caller: the plant's name and who sent it.
create or replace function public.plant_offers_for_me()
returns table (plant_id uuid, from_id uuid, from_name text, from_avatar text, seed text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
    select o.plant_id, o.from_id, coalesce(pr.display_name, 'someone'), coalesce(pr.avatar_seed, o.from_id::text),
           coalesce(p.data ->> 'seed', p.data ->> 'name', 'a plant'), o.created_at
    from public.plant_offers o
    join public.plants p on p.id = o.plant_id
    left join public.profiles pr on pr.id = o.from_id
    where o.to_id = (select auth.uid())
    order by o.created_at desc;
$$;
revoke all on function public.plant_offers_for_me() from public, anon;
grant execute on function public.plant_offers_for_me() to authenticated;

-- Take an offer: become a member and get the plant back, as join_plant does.
create or replace function public.accept_plant_offer(pid uuid)
returns table (plant_id uuid, owner_id uuid, data jsonb, rev bigint)
language plpgsql security definer set search_path = ''
as $$
#variable_conflict use_column
declare
    uid uuid := (select auth.uid());
begin
    if uid is null then
        raise exception 'sign in first' using errcode = '28000';
    end if;
    if not exists (select 1 from public.plant_offers o where o.plant_id = pid and o.to_id = uid) then
        raise exception 'no such offer' using errcode = 'P0002';
    end if;
    delete from public.plant_offers o where o.plant_id = pid and o.to_id = uid;
    if not exists (select 1 from public.plants p where p.id = pid and p.owner_id = uid) then
        if (select count(*) from public.plant_members m where m.plant_id = pid) >= 20 then
            raise exception 'plant is full' using errcode = '53400';
        end if;
        insert into public.plant_members (plant_id, user_id) values (pid, uid)
        on conflict do nothing;
    end if;
    return query select p.id, p.owner_id, p.data, p.rev from public.plants p where p.id = pid;
end;
$$;
revoke all on function public.accept_plant_offer(uuid) from public, anon;
grant execute on function public.accept_plant_offer(uuid) to authenticated;
