-- Serialize ordinary transaction writes and child-category creation with archive operations.
-- An archive UPDATE takes a row lock; FOR SHARE here makes the writer wait and
-- re-check the committed archived_at value before it can create a reference.

create or replace function public.guard_category()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  p record;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then
      raise exception 'Una categoria non può cambiare spazio.';
    end if;
    if new.parent_id is distinct from old.parent_id or new.kind is distinct from old.kind then
      if exists (select 1 from public.transactions where category_id = old.id)
         or exists (select 1 from public.categories where parent_id = old.id) then
        raise exception 'Non puoi spostare o cambiare tipo a una categoria già usata.';
      end if;
    end if;
  end if;

  if new.parent_id = new.id then
    raise exception 'Una categoria non può essere padre di sé stessa.';
  end if;

  if new.parent_id is not null then
    select * into p
    from public.categories
    where id = new.parent_id
    for share;

    if p.id is null or p.space_id <> new.space_id then
      raise exception 'La categoria padre appartiene a un altro spazio.';
    end if;
    if p.parent_id is not null then
      raise exception 'Sono ammessi al massimo due livelli di categoria.';
    end if;
    if p.archived_at is not null then
      raise exception 'Non puoi creare una sottocategoria sotto una categoria archiviata.';
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
set search_path = public
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
  if a.archived_at is not null and (tg_op = 'INSERT' or new.account_id <> old.account_id) then
    raise exception 'Il conto è archiviato.';
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
