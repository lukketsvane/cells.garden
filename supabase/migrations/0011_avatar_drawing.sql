-- cells.garden: drawn profile pictures. Safe to run more than once.
--
-- Besides the picture generated from avatar_seed (0009), someone can draw their
-- own in a small pixel editor. The drawing is a short string; null means the
-- generated picture. Nothing else about profiles changes.
--
-- Format, the same as DRAWING_FORMAT in src/core/avatar-pixels.ts (the security
-- check compares the two): "d1:" (version 1), one hex digit for the background
-- (1-f), then 49 hex digits for a 7 by 7 grid, row by row (0 is an empty pixel).
-- Every digit is an index into the app's fixed palette, never a colour of its
-- own, so the stored text never reaches the picture's markup. 53 characters.
--
-- Who sees it: the same people as avatar_seed. Row level security on profiles
-- ("profiles: owner and peers can read", 0007) lets the owner and anyone who
-- shares a garden or a plant with them read the row, and "profiles: owner can
-- update" (0006) lets only the owner change it. There are no column grants on
-- profiles, so a new column is covered by exactly those policies.

alter table public.profiles add column if not exists avatar_drawing text;

alter table public.profiles drop constraint if exists profiles_avatar_drawing_format;
alter table public.profiles add constraint profiles_avatar_drawing_format
    check (avatar_drawing is null
           or (length(avatar_drawing) = 53 and avatar_drawing ~ '^d1:[1-9a-f][0-9a-f]{49}$'));

-- The functions that hand out pictures send the drawing where they sent the
-- seed. Same names, same columns, so every client already out there keeps
-- working: one that predates drawings shows a generated picture made from the
-- drawing's text instead.

-- friends(): as in 0010, with the drawing first.
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
           coalesce(pr.avatar_drawing, pr.avatar_seed, pe.person::text),
           (select count(distinct gp.garden_id) from garden_people gp where gp.person = pe.person),
           (select count(distinct pp.plant_id) from plant_people pp where pp.person = pe.person)
    from people pe
    left join public.profiles pr on pr.id = pe.person
    where pe.person <> (select id from me)
    order by 2;
$$;
revoke all on function public.friends() from public, anon;
grant execute on function public.friends() to authenticated;

-- plant_offers_for_me(): as in 0009, with the drawing first.
create or replace function public.plant_offers_for_me()
returns table (plant_id uuid, from_id uuid, from_name text, from_avatar text, seed text, created_at timestamptz)
language sql stable security definer set search_path = ''
as $$
    select o.plant_id, o.from_id, coalesce(pr.display_name, 'someone'),
           coalesce(pr.avatar_drawing, pr.avatar_seed, o.from_id::text),
           coalesce(p.data ->> 'seed', p.data ->> 'name', 'a plant'), o.created_at
    from public.plant_offers o
    join public.plants p on p.id = o.plant_id
    left join public.profiles pr on pr.id = o.from_id
    where o.to_id = (select auth.uid())
    order by o.created_at desc;
$$;
revoke all on function public.plant_offers_for_me() from public, anon;
grant execute on function public.plant_offers_for_me() to authenticated;
