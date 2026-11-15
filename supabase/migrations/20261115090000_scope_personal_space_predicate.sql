-- Do not expose whether an arbitrary UUID belongs to another user's personal space.
-- This predicate is used by RLS and integrity triggers, so it must answer only
-- for the authenticated caller. The caller still needs the relevant membership
-- role checks at each write path.
create or replace function public.is_personal_space(_space uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
    from public.spaces
    where id = _space
      and kind = 'personal'
      and created_by = auth.uid()
  )
$$;

revoke all on function public.is_personal_space(uuid) from public, anon;
grant execute on function public.is_personal_space(uuid) to authenticated;
