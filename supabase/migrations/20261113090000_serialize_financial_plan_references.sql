-- Serialize creation/update of open financial plans with account/category archiving.
-- FOR SHARE conflicts with the row lock taken by UPDATE, so either the plan
-- creation sees the archived row or the archive sees the newly-created plan.

create or replace function public.guard_recurring_item()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  a public.accounts;
  c public.categories;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id or new.created_by <> old.created_by then
      raise exception 'Spazio e creatore della ricorrenza non sono modificabili.';
    end if;
  else
    new.created_by := auth.uid();
  end if;

  if not public.is_personal_space(new.space_id) then
    raise exception 'Le ricorrenze appartengono allo spazio personale.';
  end if;

  select * into a
  from public.accounts
  where id = new.account_id
  for share;

  if a.id is null or a.space_id <> new.space_id or a.archived_at is not null then
    raise exception 'Seleziona un conto attivo dello spazio personale.';
  end if;

  select * into c
  from public.categories
  where id = new.category_id
  for share;

  if c.id is null or c.space_id <> new.space_id or c.archived_at is not null then
    raise exception 'Seleziona una categoria attiva dello spazio personale.';
  end if;

  if public.category_root_kind(new.category_id) <>
    (case when new.direction = 'inflow' then 'income' else 'expense' end)::public.category_kind then
    raise exception 'La categoria non corrisponde alla direzione.';
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_deadline()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  a public.accounts;
  c public.categories;
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
      if current_setting('app.deadline_rpc', true) is distinct from 'on' then
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

create or replace function public.guard_active_category_ancestry()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_archived boolean;
begin
  if tg_op = 'UPDATE' then
    if tg_table_name = 'transactions' then
      if new.category_id = old.category_id then
        return new;
      end if;
    elsif tg_table_name = 'recurring_items' then
      if new.category_id = old.category_id and (old.active or not new.active) then
        return new;
      end if;
    elsif tg_table_name = 'deadlines' then
      if new.category_id = old.category_id then
        return new;
      end if;
    end if;
  end if;

  select p.archived_at is not null
    into parent_archived
  from public.categories c
  join public.categories p on p.id = c.parent_id
  where c.id = new.category_id
  for share of p;

  if coalesce(parent_archived, false) then
    raise exception 'La categoria padre è archiviata.';
  end if;

  return new;
end;
$$;
