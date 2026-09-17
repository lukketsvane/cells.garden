-- cells.garden: let an owner read back the row they just inserted. Safe to run more than once.
--
-- The select policies from 0006/0007 only asked a security definer helper, which
-- looks the row up by id in its own snapshot. During `insert ... returning` (what
-- supabase-js does for `.insert().select()`) the new row is not in that snapshot
-- yet, so the owner's first garden or plant was refused. Checking the owner
-- column directly on the row fixes it and keeps the helper for members.

drop policy if exists "gardens: owner and members can select" on public.gardens;
create policy "gardens: owner and members can select"
    on public.gardens for select to authenticated
    using (user_id = (select auth.uid()) or private.can_access_garden(id));

drop policy if exists "gardens: owner and members can update" on public.gardens;
create policy "gardens: owner and members can update"
    on public.gardens for update to authenticated
    using (user_id = (select auth.uid()) or private.can_access_garden(id))
    with check (user_id = (select auth.uid()) or private.can_access_garden(id));

drop policy if exists "plants: owner and members can select" on public.plants;
create policy "plants: owner and members can select"
    on public.plants for select to authenticated
    using (owner_id = (select auth.uid()) or private.can_access_plant(id));

drop policy if exists "plants: owner and members can update" on public.plants;
create policy "plants: owner and members can update"
    on public.plants for update to authenticated
    using (owner_id = (select auth.uid()) or private.can_access_plant(id))
    with check (owner_id = (select auth.uid()) or private.can_access_plant(id));
