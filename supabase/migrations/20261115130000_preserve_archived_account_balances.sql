-- Prevent ordinary edits from changing the balance of an archived account.
-- The existing explicit exception is logical cancellation of a transfer RPC.
create or replace function public.guard_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  bal bigint;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then
      raise exception 'Un conto non può cambiare spazio.';
    end if;

    if old.archived_at is not null
      and new.archived_at is not null
      and new.initial_balance_cents is distinct from old.initial_balance_cents then
      raise exception 'Il saldo iniziale di un conto archiviato non è modificabile.';
    end if;

    if new.currency <> old.currency
      and exists (select 1 from public.transactions where account_id = old.id) then
      raise exception 'Non puoi cambiare la valuta di un conto con movimenti.';
    end if;

    if new.archived_at is not null and old.archived_at is null then
      select new.initial_balance_cents
        + coalesce(sum(case when direction='inflow' then amount_cents else -amount_cents end),0)
        into bal
      from public.transactions
      where account_id = old.id and deleted_at is null;

      if bal <> 0 then
        raise exception 'Puoi archiviare un conto solo con saldo zero.';
      end if;
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_transaction()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  a record;
  c record;
  want public.category_kind;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then
      raise exception 'Un movimento non può cambiare spazio.';
    end if;
    if old.deleted_at is not null then
      raise exception 'Un movimento eliminato non può essere modificato.';
    end if;
    if new.created_by is distinct from old.created_by then
      raise exception 'Campo non modificabile.';
    end if;
    if new.operation_type is distinct from old.operation_type then
      raise exception 'Il tipo di operazione non è modificabile.';
    end if;
  else
    new.created_by := auth.uid();
  end if;

  if not public.is_personal_space(new.space_id) then
    raise exception 'I movimenti personali vanno registrati in uno spazio personale.';
  end if;

  select * into a
  from public.accounts
  where id = new.account_id
  for share;

  if not found or a.space_id is distinct from new.space_id then
    raise exception 'Il conto appartiene a un altro spazio.';
  end if;

  if a.archived_at is not null and (
    tg_op = 'INSERT'
    or new.account_id is distinct from old.account_id
    or new.amount_cents is distinct from old.amount_cents
    or new.direction is distinct from old.direction
    or (
      new.deleted_at is distinct from old.deleted_at
      and not (
        new.operation_type = 'transfer'
        and current_setting('app.transfer_rpc', true) = 'on'
        and new.deleted_at is not null
      )
    )
  ) then
    raise exception 'Il conto è archiviato: non puoi modificare il saldo dei movimenti.';
  end if;

  if new.operation_type = 'transfer' then
    if current_setting('app.transfer_rpc', true) is distinct from 'on' then
      raise exception 'I movimenti di trasferimento possono essere creati o modificati solo tramite la funzione dedicata.';
    end if;
    if new.category_id is not null then
      raise exception 'Un trasferimento non ha categoria.';
    end if;
  else
    if new.category_id is null then
      raise exception 'La categoria è obbligatoria per un movimento ordinario.';
    end if;

    select * into c
    from public.categories
    where id = new.category_id
    for share;

    if not found or c.space_id is distinct from new.space_id then
      raise exception 'La categoria appartiene a un altro spazio.';
    end if;
    if (tg_op = 'INSERT' or new.category_id <> old.category_id) and c.archived_at is not null then
      raise exception 'La categoria è archiviata.';
    end if;

    want := (case when new.direction = 'inflow' then 'income' else 'expense' end)::public.category_kind;
    if public.category_root_kind(new.category_id) is distinct from want then
      raise exception 'La categoria non corrisponde alla direzione del movimento.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

revoke all on function public.guard_account() from public, anon, authenticated;
revoke all on function public.guard_transaction() from public, anon, authenticated;
