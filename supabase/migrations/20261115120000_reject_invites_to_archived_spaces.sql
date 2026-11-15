-- Invitations must not add members after a shared space has been archived.
-- Lock the space row so invitation creation/acceptance serializes with archival.
create or replace function public.invite_to_space(
  _space uuid,
  _email text,
  _role public.space_role default 'member'
) returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  iid uuid;
  s public.spaces;
begin
  if not public.has_space_role(_space, auth.uid(), array['owner']::public.space_role[]) then
    raise exception 'Solo un owner può invitare';
  end if;

  select * into s
  from public.spaces
  where id = _space
  for share;

  if s.id is null or s.kind <> 'shared' then
    raise exception 'Lo spazio personale non accetta inviti';
  end if;
  if s.archived_at is not null then
    raise exception 'Lo spazio è archiviato';
  end if;
  if _role = 'owner' then
    raise exception 'Gli inviti non possono assegnare il ruolo owner';
  end if;
  if lower(btrim(_email)) = public.current_email() then
    raise exception 'Non puoi invitare te stesso';
  end if;

  insert into public.space_invitations(space_id, email, role, invited_by)
  values (_space, lower(btrim(_email)), _role, auth.uid())
  returning id into iid;

  return iid;
end;
$$;

create or replace function public.accept_invitation(_invitation uuid)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  inv public.space_invitations;
  s public.spaces;
begin
  select * into inv
  from public.space_invitations
  where id = _invitation
  for update;

  if inv.id is null
    or inv.status <> 'pending'
    or inv.email <> public.current_email()
    or public.current_email() = '' then
    raise exception 'Invito non valido';
  end if;

  -- FOR UPDATE is intentional: guard_membership also locks this row, and
  -- this lock must serialize with an archive operation before membership exists.
  select * into s
  from public.spaces
  where id = inv.space_id
  for update;

  if s.id is null or s.kind <> 'shared' or s.archived_at is not null then
    raise exception 'Invito non valido: lo spazio non è più attivo.';
  end if;

  insert into public.space_memberships(space_id, user_id, role)
  values (inv.space_id, auth.uid(), inv.role)
  on conflict (space_id, user_id) do nothing;

  update public.space_invitations
  set status = 'accepted'
  where id = inv.id;

  return inv.space_id;
end;
$$;
