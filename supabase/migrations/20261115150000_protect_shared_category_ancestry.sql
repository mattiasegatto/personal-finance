-- Serialize category-parent changes with child creation and prevent
-- shared expenses from using a child whose parent category is archived.
create or replace function public.guard_category() returns trigger language plpgsql security definer set search_path = pg_catalog, public, pg_temp as $$
declare p record;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then raise exception 'Una categoria non può cambiare spazio.'; end if;
    if new.parent_id is distinct from old.parent_id or new.kind is distinct from old.kind then
      if exists (select 1 from transactions where category_id = old.id)
         or exists (select 1 from categories where parent_id = old.id) then
        raise exception 'Non puoi spostare o cambiare tipo a una categoria già usata.'; end if;
    end if;
  end if;
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Una categoria non può essere padre di sé stessa.';
    end if;
    select * into p from public.categories where id = new.parent_id for share;
    if not found or p.space_id is distinct from new.space_id then raise exception 'La categoria padre appartiene a un altro spazio.'; end if;
    if p.archived_at is not null then raise exception 'La categoria padre è archiviata.'; end if;
    if p.parent_id is not null then raise exception 'Sono ammessi al massimo due livelli di categoria.'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;

create or replace function public.guard_shared_expense()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  c record;
  payer_space uuid;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then
      raise exception 'La spesa non può cambiare spazio.';
    end if;
    if new.created_by <> old.created_by then
      raise exception 'Il creatore non è modificabile.';
    end if;
    if old.linked_transaction_id is not null and new.paid_by_user_id <> old.paid_by_user_id then
      raise exception 'Scollega prima il movimento personale, poi modifica il pagatore.';
    end if;
  else
    new.created_by := auth.uid();
  end if;

  perform 1
  from public.spaces s
  where s.id = new.space_id and s.kind = 'shared' and s.archived_at is null
  for share;
  if not found then
    raise exception 'Le spese condivise richiedono uno spazio condiviso attivo.';
  end if;
  if not public.has_space_role(new.space_id, auth.uid(), array['owner','member']::public.space_role[]) then
    raise exception 'Non hai i permessi per modificare questa spesa.';
  end if;
  if not exists (
    select 1 from public.space_memberships m
    where m.space_id = new.space_id and m.user_id = new.paid_by_user_id
  ) then
    raise exception 'Il pagatore non è membro dello spazio.';
  end if;

  select * into c from public.categories where id = new.category_id for share;
  if c.id is null or c.space_id <> new.space_id or c.archived_at is not null
     or public.category_root_kind(new.category_id) <> 'expense' then
    raise exception 'Seleziona una categoria di spesa attiva dello spazio condiviso.';
  end if;

  if new.linked_transaction_id is not null then
    if new.paid_by_user_id <> auth.uid() then
      raise exception 'Solo il pagatore può collegare un proprio movimento personale.';
    end if;

    select s.created_by into payer_space
    from public.transactions t
    join public.spaces s on s.id = t.space_id
    where t.id = new.linked_transaction_id
      and t.deleted_at is null
      and t.operation_type = 'ordinary'
      and t.direction = 'outflow'
      and t.amount_cents = new.amount_cents
      and s.kind = 'personal'
    for share of t;

    if payer_space is distinct from new.paid_by_user_id then
      raise exception 'Il movimento collegato deve essere un''uscita personale ordinaria del pagatore con importo identico.';
    end if;

    perform pg_advisory_xact_lock(hashtextextended(new.linked_transaction_id::text, 0));
    if exists (
      select 1 from public.shared_settlements ss
      where ss.linked_transaction_id = new.linked_transaction_id
        and ss.deleted_at is null
    ) then
      raise exception 'Il movimento personale è già collegato a un rimborso.';
    end if;
  end if;

  new.updated_at := now();
  return new;
end;
$$;

create or replace function public.guard_active_category_ancestry()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $q$
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
    elsif tg_table_name = 'shared_expenses' then
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
$q$;

create trigger a_active_category_ancestry_shared_expenses
before insert or update on public.shared_expenses
for each row execute function public.guard_active_category_ancestry();

revoke all on function public.guard_category() from public, anon, authenticated;
revoke all on function public.guard_shared_expense() from public, anon, authenticated;
