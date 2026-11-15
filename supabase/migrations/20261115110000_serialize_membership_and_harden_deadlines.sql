-- Serialize membership mutations per space so concurrent owner removals
-- cannot leave a shared space without an owner.
create or replace function public.guard_space_update()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $q$
begin
  -- RLS may have evaluated USING before waiting on the space row lock.
  -- Recheck ownership after the UPDATE has acquired that lock.
  if auth.uid() is not null
    and not public.has_space_role(old.id, auth.uid(), array['owner']::public.space_role[]) then
    raise exception 'Solo un owner può modificare lo spazio.';
  end if;

  if new.kind <> old.kind or new.created_by <> old.created_by or new.created_at <> old.created_at then
    raise exception 'Tipo, autore e data di creazione di uno spazio non sono modificabili';
  end if;
  if old.kind = 'personal' and new.archived_at is not null then
    raise exception 'Lo spazio personale non può essere archiviato';
  end if;
  return new;
end;
$q$;

revoke all on function public.guard_space_update() from public, anon, authenticated;

create or replace function public.guard_membership()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  s public.spaces;
begin
  if tg_op = 'INSERT' then
    select * into s
    from public.spaces
    where id = new.space_id
    for update;

    if s.id is null then
      raise exception 'Spazio non disponibile.';
    end if;
    if s.kind = 'personal'
      and (new.user_id <> s.created_by or new.role <> 'owner') then
      raise exception 'Lo spazio personale appartiene solo al suo titolare';
    end if;
    return new;
  end if;

  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id or new.user_id <> old.user_id then
      raise exception 'Spazio e utente di un''appartenenza non sono modificabili';
    end if;
  end if;

  -- A single per-space row lock serializes all owner-role transitions and
  -- membership removals, including invitation acceptance.
  select * into s
  from public.spaces
  where id = old.space_id
  for update;

  -- The parent space may already be deleted during ON DELETE CASCADE.
  if s.id is null then
    return coalesce(new, old);
  end if;

  -- Recheck the actor after taking the per-space lock. A former owner may
  -- still have passed the RLS USING snapshot before waiting for this lock.
  if tg_op = 'UPDATE' and auth.uid() is not null
    and not public.has_space_role(old.space_id, auth.uid(), array['owner']::public.space_role[]) then
    raise exception 'Solo un owner può modificare le appartenenze.';
  end if;
  if tg_op = 'DELETE' and auth.uid() is not null
    and auth.uid() <> old.user_id
    and not public.has_space_role(old.space_id, auth.uid(), array['owner']::public.space_role[]) then
    raise exception 'Solo un owner può rimuovere altri membri.';
  end if;

  if s.kind = 'personal' and tg_op = 'DELETE' then
    raise exception 'Non si può uscire dal proprio spazio personale';
  end if;

  if s.kind = 'shared'
    and old.role = 'owner'
    and (
      tg_op = 'DELETE'
      or new.role <> 'owner'
    )
    and not exists (
      select 1
      from public.space_memberships
      where space_id = old.space_id
        and role = 'owner'
        and user_id <> old.user_id
    ) then
    raise exception 'Uno spazio condiviso deve avere almeno un owner';
  end if;

  return coalesce(new, old);
end;
$$;

revoke all on function public.guard_membership() from public, anon, authenticated;

-- Do not use a caller-settable custom GUC as authorization for deadline state
-- transitions. Only the owner of the completion RPC may perform the transition.
create or replace function public.guard_deadline()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  a public.accounts;
  c public.categories;
  rpc_owner name;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id or new.created_by <> old.created_by then
      raise exception 'Spazio e creatore non sono modificabili.';
    end if;
    if old.status <> 'pending' then
      raise exception 'Una scadenza chiusa non può essere modificata.';
    end if;
    if new.status <> old.status
      or new.transaction_id is distinct from old.transaction_id
      or new.completed_at is distinct from old.completed_at then
      select pg_get_userbyid(p.proowner)
        into rpc_owner
      from pg_proc p
      where p.oid = 'public.complete_deadline(uuid)'::regprocedure;
      if rpc_owner is null or current_user <> rpc_owner then
        raise exception 'Lo stato si modifica solo tramite la funzione dedicata.';
      end if;
    end if;
  else
    new.created_by := auth.uid();
  end if;

  if not public.is_personal_space(new.space_id) then
    raise exception 'Le scadenze appartengono allo spazio personale.';
  end if;

  select * into a
  from public.accounts
  where id = new.account_id
  for share;

  if a.id is null or a.space_id <> new.space_id or a.archived_at is not null then
    raise exception 'Conto non valido o archiviato.';
  end if;

  select * into c
  from public.categories
  where id = new.category_id
  for share;

  if c.id is null or c.space_id <> new.space_id or c.archived_at is not null then
    raise exception 'Categoria non valida o archiviata.';
  end if;

  if public.category_root_kind(new.category_id) <>
    (case when new.direction = 'inflow' then 'income' else 'expense' end)::public.category_kind then
    raise exception 'La categoria non corrisponde alla direzione.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.guard_deadline() from public, anon, authenticated;
