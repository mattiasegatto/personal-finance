-- A settlement payer cannot change in the same operation that removes
-- its linked personal movement. Require an explicit unlink step first.
create or replace function public.guard_shared_settlement()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  tx record;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then
      raise exception 'Il rimborso non può cambiare spazio.';
    end if;
    if new.created_by <> old.created_by then
      raise exception 'Il creatore non è modificabile.';
    end if;
    if old.linked_transaction_id is not null and new.from_user_id <> old.from_user_id then
      raise exception 'Scollega prima il movimento personale, poi modifica chi ha effettuato il pagamento.';
    end if;
  else
    new.created_by := auth.uid();
  end if;

  perform 1
  from public.spaces s
  where s.id = new.space_id and s.kind = 'shared' and s.archived_at is null
  for share;
  if not found then
    raise exception 'Il rimborso richiede uno spazio condiviso attivo.';
  end if;
  if not public.has_space_role(new.space_id, auth.uid(), array['owner','member']::public.space_role[]) then
    raise exception 'Non hai i permessi per registrare rimborsi.';
  end if;
  if not exists (
    select 1 from public.space_memberships
    where space_id = new.space_id and user_id = new.from_user_id
  ) or not exists (
    select 1 from public.space_memberships
    where space_id = new.space_id and user_id = new.to_user_id
  ) then
    raise exception 'Entrambi i partecipanti devono appartenere allo spazio.';
  end if;

  if new.linked_transaction_id is not null then
    if new.from_user_id <> auth.uid() then
      raise exception 'Solo chi effettua il pagamento può collegare il movimento personale.';
    end if;

    select t.id into tx
    from public.transactions t
    join public.spaces s on s.id = t.space_id
    where t.id = new.linked_transaction_id
      and t.deleted_at is null
      and t.operation_type = 'ordinary'
      and t.direction = 'outflow'
      and t.amount_cents = new.amount_cents
      and s.kind = 'personal'
      and s.created_by = new.from_user_id
    for share of t;

    if tx.id is null then
      raise exception 'Il movimento collegato deve essere un''uscita personale ordinaria del pagante con importo identico.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(new.linked_transaction_id::text, 0));
    if exists (
      select 1 from public.shared_expenses e
      where e.linked_transaction_id = new.linked_transaction_id
        and e.deleted_at is null
    ) then
      raise exception 'Il movimento personale è già collegato a una spesa condivisa.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;
revoke all on function public.guard_shared_settlement() from public, anon, authenticated;
