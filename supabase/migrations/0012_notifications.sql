-- cells.garden: notifications and Web Push subscriptions. Safe to run more than once.
--
-- Someone assigns you a cell; the app calls the notify Edge Function
-- (supabase/functions/notify), which checks with the service role that the two
-- of you share that garden or plant, writes one row here per person and pushes
-- it to every device they turned notifications on for. Nothing here lets a
-- client write a notification: the function is the only writer.
--
-- The recipient reads their own rows and marks them read, and the app hears new
-- ones over realtime. A device's push subscription is its owner's alone.

-- ---------------------------------------------------------------------------
-- 1. notifications: one row per person told.
-- ---------------------------------------------------------------------------
create table if not exists public.notifications (
    id         uuid primary key default gen_random_uuid(),
    user_id    uuid not null references public.profiles (id) on delete cascade,
    actor_id   uuid references public.profiles (id) on delete set null,
    kind       text not null,
    garden_id  uuid references public.gardens (id) on delete cascade,
    plant_id   uuid references public.plants (id) on delete set null,
    project_id text not null,
    item_id    text not null,
    title      text not null,
    body       text not null default '',
    created_at timestamptz not null default now(),
    read_at    timestamptz
);

-- Named, so a later kind can widen the list by dropping and adding this one.
alter table public.notifications drop constraint if exists notifications_kind;
alter table public.notifications add constraint notifications_kind check (kind in ('assigned'));
alter table public.notifications drop constraint if exists notifications_sizes;
alter table public.notifications add constraint notifications_sizes
    check (char_length(title) <= 200 and char_length(body) <= 500
           and char_length(project_id) between 1 and 200 and char_length(item_id) between 1 and 200);

create index if not exists notifications_user_created_idx on public.notifications (user_id, created_at desc);
create index if not exists notifications_unread_idx on public.notifications (user_id) where read_at is null;
-- The function counts what one person sent in the last minute (its rate limit).
create index if not exists notifications_actor_created_idx on public.notifications (actor_id, created_at desc);

alter table public.notifications enable row level security;

-- Only the recipient sees a row, and the only thing they can change is read_at.
drop policy if exists "notifications: recipient can select" on public.notifications;
create policy "notifications: recipient can select"
    on public.notifications for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "notifications: recipient can mark read" on public.notifications;
create policy "notifications: recipient can mark read"
    on public.notifications for update to authenticated
    using (user_id = (select auth.uid()))
    with check (user_id = (select auth.uid()));

-- No insert or delete policy: clients never write a notification. Column
-- grants keep an update to read_at, whatever a policy would allow.
revoke all on public.notifications from public, anon, authenticated;
grant select on public.notifications to authenticated;
grant update (read_at) on public.notifications to authenticated;
grant all on public.notifications to service_role;

-- ---------------------------------------------------------------------------
-- 2. push_subscriptions: where to push, one row per device and account.
--    The endpoint is the browser's own address for the device; p256dh and
--    auth are the keys a push is encrypted to.
-- ---------------------------------------------------------------------------
create table if not exists public.push_subscriptions (
    id           uuid primary key default gen_random_uuid(),
    user_id      uuid not null references public.profiles (id) on delete cascade,
    endpoint     text not null unique,
    p256dh       text not null,
    auth         text not null,
    user_agent   text,
    created_at   timestamptz not null default now(),
    last_used_at timestamptz
);

alter table public.push_subscriptions drop constraint if exists push_subscriptions_sizes;
alter table public.push_subscriptions add constraint push_subscriptions_sizes
    check (endpoint like 'https://%' and char_length(endpoint) <= 1000
           and char_length(p256dh) between 80 and 100 and char_length(auth) between 16 and 32
           and (user_agent is null or char_length(user_agent) <= 400));

create index if not exists push_subscriptions_user_id_idx on public.push_subscriptions (user_id);

alter table public.push_subscriptions enable row level security;

drop policy if exists "push_subscriptions: owner can select" on public.push_subscriptions;
create policy "push_subscriptions: owner can select"
    on public.push_subscriptions for select to authenticated
    using (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions: owner can insert" on public.push_subscriptions;
create policy "push_subscriptions: owner can insert"
    on public.push_subscriptions for insert to authenticated
    with check (user_id = (select auth.uid()));

drop policy if exists "push_subscriptions: owner can delete" on public.push_subscriptions;
create policy "push_subscriptions: owner can delete"
    on public.push_subscriptions for delete to authenticated
    using (user_id = (select auth.uid()));

revoke all on public.push_subscriptions from public, anon, authenticated;
grant select, insert, delete on public.push_subscriptions to authenticated;
grant all on public.push_subscriptions to service_role;

-- ---------------------------------------------------------------------------
-- 3. Saving a device's subscription. One device has one endpoint whoever is
--    signed in on it, so a new account there takes the row over, and the
--    account before it stops getting pushes on that device. Keeps the ten
--    newest devices per account.
-- ---------------------------------------------------------------------------
create or replace function public.save_push_subscription(sub_endpoint text, sub_p256dh text, sub_auth text, sub_user_agent text)
returns void
language plpgsql security definer set search_path = ''
as $$
declare
    uid uuid := (select auth.uid());
begin
    if uid is null then
        raise exception 'sign in first' using errcode = '28000';
    end if;
    insert into public.push_subscriptions (user_id, endpoint, p256dh, auth, user_agent)
    values (uid, sub_endpoint, sub_p256dh, sub_auth, left(sub_user_agent, 400))
    on conflict (endpoint) do update
        set user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth,
            user_agent = excluded.user_agent, created_at = now();
    delete from public.push_subscriptions s
    where s.user_id = uid
      and s.id not in (select k.id from public.push_subscriptions k
                       where k.user_id = uid order by k.created_at desc limit 10);
end;
$$;
revoke all on function public.save_push_subscription(text, text, text, text) from public, anon;
grant execute on function public.save_push_subscription(text, text, text, text) to authenticated;

-- ---------------------------------------------------------------------------
-- 4. Realtime: an open app hears its new notifications. Realtime applies the
--    select policy above, so nobody hears anyone else's.
-- ---------------------------------------------------------------------------
do $$
begin
    if not exists (
        select 1 from pg_publication_tables
        where pubname = 'supabase_realtime' and schemaname = 'public' and tablename = 'notifications'
    ) then
        alter publication supabase_realtime add table public.notifications;
    end if;
end $$;
