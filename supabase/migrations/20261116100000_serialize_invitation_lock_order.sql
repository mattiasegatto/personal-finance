-- Serialize invitation creation and acceptance before either operation
-- takes invitation, membership or space row locks.
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
  pending_id uuid;
  s public.spaces;
  normalized_email text := lower(btrim(coalesce(_email, '')));
  uid uuid := auth.uid();
begin
  if uid is null then
    raise exception 'Accesso richiesto';
  end if;
  if normalized_email = '' then
    raise exception 'Indirizzo email non valido.';
  end if;
  if _role is null or _role = 'owner' then
    raise exception 'Gli inviti non possono assegnare il ruolo owner';
  end if;
  if normalized_email = public.current_email() then
    raise exception 'Non puoi invitare te stesso';
  end if;

  -- Both invitation RPCs acquire the same per-(space,email) lock first.
  -- This removes the old space -> invitation / invitation -> space cycle.
  perform pg_advisory_xact_lock(
    hashtextextended(_space::text || ':' || normalized_email, 0)
  );

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
  if not public.has_space_role(_space, uid, array['owner']::public.space_role[]) then
    raise exception 'Solo un owner può invitare';
  end if;

  select id into pending_id
  from public.space_invitations
  where space_id = _space
    and email = normalized_email
    and status = 'pending'
  for update;

  if pending_id is not null then
    raise exception 'Esiste già un invito pendente per questo indirizzo.';
  end if;

  if exists (
    select 1
    from auth.users u
    join public.space_memberships m on m.user_id = u.id
    where m.space_id = _space
      and lower(u.email) = normalized_email
  ) then
    raise exception 'L’utente è già membro dello spazio.';
  end if;

  insert into public.space_invitations(space_id, email, role, invited_by)
  values (_space, normalized_email, _role, uid)
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
  invitation_space uuid;
  invitation_email text;
begin
  -- Read only the lock key first. Re-read and lock the invitation after
  -- taking the same advisory lock used by invite_to_space().
  select space_id, email
    into invitation_space, invitation_email
  from public.space_invitations
  where id = _invitation;

  if invitation_space is null
    or invitation_email <> public.current_email()
    or public.current_email() = '' then
    raise exception 'Invito non valido';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(invitation_space::text || ':' || invitation_email, 0)
  );

  -- Membership UPDATE/DELETE locks the tuple before guard_membership()
  -- takes the space lock. Acceptance follows that same membership -> space
  -- order, preventing a conflict-row / space-row deadlock.
  perform 1
  from public.space_memberships
  where space_id = invitation_space
    and user_id = auth.uid()
  for update;

  select * into inv
  from public.space_invitations
  where id = _invitation
  for update;

  if inv.id is null
    or inv.status <> 'pending'
    or inv.space_id <> invitation_space
    or inv.email <> public.current_email()
    or public.current_email() = '' then
    raise exception 'Invito non valido';
  end if;

  select * into s
  from public.spaces
  where id = inv.space_id
  for update;

  if s.id is null or s.kind <> 'shared' or s.archived_at is not null then
    raise exception 'Invito non valido: lo spazio non è più attivo.';
  end if;

  -- Idempotent if membership was created by another valid path while the
  -- invitation was pending: do not duplicate membership, but close the invite.
  insert into public.space_memberships(space_id, user_id, role)
  values (inv.space_id, auth.uid(), inv.role)
  on conflict (space_id, user_id) do nothing;

  update public.space_invitations
  set status = 'accepted'
  where id = inv.id;

  return inv.space_id;
end;
$$;

revoke all on function public.invite_to_space(uuid, text, public.space_role) from public, anon;
grant execute on function public.invite_to_space(uuid, text, public.space_role) to authenticated;
revoke all on function public.accept_invitation(uuid) from public, anon;
grant execute on function public.accept_invitation(uuid) to authenticated;
