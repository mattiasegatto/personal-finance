create or replace function public.guard_transaction() returns trigger language plpgsql security definer set search_path = public as $$
declare a record; c record; want public.category_kind;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then raise exception 'Un movimento non può cambiare spazio.'; end if;
    if old.deleted_at is not null then raise exception 'Un movimento eliminato non può essere modificato.'; end if;
    if new.created_by is distinct from old.created_by then raise exception 'Campo non modificabile.'; end if;
  else
    new.created_by := auth.uid();
  end if;
  if not public.is_personal_space(new.space_id) then raise exception 'I movimenti personali vanno registrati in uno spazio personale.'; end if;
  select * into a from accounts where id = new.account_id;
  if not found or a.space_id is distinct from new.space_id then raise exception 'Il conto appartiene a un altro spazio.'; end if;
  if a.archived_at is not null and (tg_op = 'INSERT' or new.account_id <> old.account_id) then
    raise exception 'Il conto è archiviato.'; end if;
  select * into c from categories where id = new.category_id;
  if not found or c.space_id is distinct from new.space_id then raise exception 'La categoria appartiene a un altro spazio.'; end if;
  if (tg_op = 'INSERT' or new.category_id <> old.category_id) and c.archived_at is not null then
    raise exception 'La categoria è archiviata.'; end if;
  want := (case when new.direction = 'inflow' then 'income' else 'expense' end)::public.category_kind;
  if public.category_root_kind(new.category_id) is distinct from want then
    raise exception 'La categoria non corrisponde alla direzione del movimento.'; end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.guard_transaction() from public, anon, authenticated;

create or replace function public.guard_category() returns trigger language plpgsql security definer set search_path = public as $$
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
    select * into p from categories where id = new.parent_id;
    if not found or p.space_id is distinct from new.space_id then raise exception 'La categoria padre appartiene a un altro spazio.'; end if;
    if p.parent_id is not null then raise exception 'Sono ammessi al massimo due livelli di categoria.'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.guard_category() from public, anon, authenticated;

create or replace function public.guard_account() returns trigger language plpgsql security definer set search_path = public as $$
declare bal bigint;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then raise exception 'Un conto non può cambiare spazio.'; end if;
    if new.currency <> old.currency and exists (select 1 from transactions where account_id = old.id) then
      raise exception 'Non puoi cambiare la valuta di un conto con movimenti.'; end if;
    if new.archived_at is not null and old.archived_at is null then
      select new.initial_balance_cents + coalesce(sum(case when direction='inflow' then amount_cents else -amount_cents end),0)
        into bal from transactions where account_id = old.id and deleted_at is null;
      if bal <> 0 then raise exception 'Puoi archiviare un conto solo con saldo zero.'; end if;
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke execute on function public.guard_account() from public, anon, authenticated;
revoke execute on function public.guard_account_delete() from public, anon, authenticated;