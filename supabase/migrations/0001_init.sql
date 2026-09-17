-- cells.garden — M1 schema
-- Run in the Supabase SQL editor (or `supabase db push`).
-- One row per garden, the whole garden as a JSON blob. No rows per plant yet.

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------------
-- profiles: one per auth user, created automatically on sign-up
-- ---------------------------------------------------------------------------
create table if not exists public.profiles (
    id           uuid primary key references auth.users (id) on delete cascade,
    display_name text,
    created_at   timestamptz not null default now()
);

alter table public.profiles enable row level security;

drop policy if exists "profiles: owner can read" on public.profiles;
create policy "profiles: owner can read"
    on public.profiles for select
    using (id = auth.uid());

drop policy if exists "profiles: owner can update" on public.profiles;
create policy "profiles: owner can update"
    on public.profiles for update
    using (id = auth.uid())
    with check (id = auth.uid());

create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer set search_path = public
as $$
begin
    insert into public.profiles (id, display_name)
    values (new.id, coalesce(new.raw_user_meta_data ->> 'display_name', split_part(new.email, '@', 1)))
    on conflict (id) do nothing;
    return new;
end;
$$;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
    after insert on auth.users
    for each row execute function public.handle_new_user();

-- ---------------------------------------------------------------------------
-- gardens: the whole garden as one JSON blob; last-write-wins on updated_at
-- ---------------------------------------------------------------------------
create table if not exists public.gardens (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references auth.users (id) on delete cascade,
    name       text not null default 'My garden',
    data       jsonb not null default '{}'::jsonb,
    created_at timestamptz not null default now(),
    updated_at timestamptz not null default now()
);

create index if not exists gardens_user_id_idx on public.gardens (user_id);

alter table public.gardens enable row level security;

drop policy if exists "gardens: owner can select" on public.gardens;
create policy "gardens: owner can select"
    on public.gardens for select
    using (user_id = auth.uid());

drop policy if exists "gardens: owner can insert" on public.gardens;
create policy "gardens: owner can insert"
    on public.gardens for insert
    with check (user_id = auth.uid());

drop policy if exists "gardens: owner can update" on public.gardens;
create policy "gardens: owner can update"
    on public.gardens for update
    using (user_id = auth.uid())
    with check (user_id = auth.uid());

drop policy if exists "gardens: owner can delete" on public.gardens;
create policy "gardens: owner can delete"
    on public.gardens for delete
    using (user_id = auth.uid());

-- Keep updated_at honest even if a client forgets to send it.
create or replace function public.touch_updated_at()
returns trigger
language plpgsql
as $$
begin
    new.updated_at = greatest(coalesce(new.updated_at, now()), old.updated_at);
    return new;
end;
$$;

drop trigger if exists gardens_touch_updated_at on public.gardens;
create trigger gardens_touch_updated_at
    before update on public.gardens
    for each row execute function public.touch_updated_at();

-- Realtime: lets a signed-in client hear its own garden change on another device.
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'gardens'
    ) then
        alter publication supabase_realtime add table public.gardens;
    end if;
end $$;
