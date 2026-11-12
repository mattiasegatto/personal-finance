-- Spese condivise persistenti: dati confinati allo spazio condiviso.
-- I movimenti bancari restano esclusivamente negli spazi personali.
create table public.shared_expenses (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  occurred_on date not null,
  description text not null check (length(btrim(description)) between 1 and 200),
  category_id uuid not null references public.categories(id) on delete restrict,
  amount_cents bigint not null check (amount_cents > 0),
  paid_by_user_id uuid not null,
  split_mode text not null default 'equal' check (split_mode in ('equal','percent','amount')),
  linked_transaction_id uuid references public.transactions(id) on delete restrict,
  deleted_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint shared_expenses_payer_membership_fk
    foreign key (space_id, paid_by_user_id)
    references public.space_memberships(space_id, user_id)
);
create index shared_expenses_space_date_idx on public.shared_expenses(space_id, occurred_on desc)
  where deleted_at is null;
create index shared_expenses_linked_transaction_idx on public.shared_expenses(linked_transaction_id)
  where linked_transaction_id is not null;

create table public.shared_expense_shares (
  expense_id uuid not null references public.shared_expenses(id) on delete cascade,
  member_user_id uuid not null,
  amount_cents bigint not null check (amount_cents >= 0),
  primary key (expense_id, member_user_id)
);
create index shared_expense_shares_member_idx on public.shared_expense_shares(member_user_id);

create table public.shared_settlements (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  occurred_on date not null,
  from_user_id uuid not null,
  to_user_id uuid not null,
  amount_cents bigint not null check (amount_cents > 0),
  kind text not null default 'rimborso' check (kind in ('rimborso','pareggio')),
  note text check (note is null or length(note) <= 200),
  linked_transaction_id uuid references public.transactions(id) on delete restrict,
  deleted_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (from_user_id <> to_user_id),
  foreign key (space_id, from_user_id) references public.space_memberships(space_id, user_id),
  foreign key (space_id, to_user_id) references public.space_memberships(space_id, user_id)
);
create index shared_settlements_space_date_idx on public.shared_settlements(space_id, occurred_on desc)
  where deleted_at is null;
create unique index shared_expenses_one_active_transaction
  on public.shared_expenses(linked_transaction_id)
  where linked_transaction_id is not null and deleted_at is null;
create unique index shared_settlements_one_active_transaction
  on public.shared_settlements(linked_transaction_id)
  where linked_transaction_id is not null and deleted_at is null;

grant select, insert, update on public.shared_expenses, public.shared_expense_shares, public.shared_settlements to authenticated;
grant all on public.shared_expenses, public.shared_expense_shares, public.shared_settlements to service_role;
alter table public.shared_expenses enable row level security;
alter table public.shared_expense_shares enable row level security;
alter table public.shared_settlements enable row level security;

create policy "shared expenses: membri leggono" on public.shared_expenses for select to authenticated
  using (public.is_space_member(space_id, auth.uid()));
create policy "shared expenses: membri leggono quote" on public.shared_expense_shares for select to authenticated
  using (exists (select 1 from public.shared_expenses e where e.id = expense_id and public.is_space_member(e.space_id, auth.uid())));
create policy "shared settlements: membri leggono" on public.shared_settlements for select to authenticated
  using (public.is_space_member(space_id, auth.uid()));

-- La categoria usa la stessa tabella gerarchica delle categorie personali,
-- ma appartiene allo spazio condiviso. Non vengono importate categorie demo.
create or replace function public.guard_shared_expense() returns trigger
language plpgsql security definer set search_path = public as $$
declare c record; payer_space uuid; tx record;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then raise exception 'La spesa non può cambiare spazio.'; end if;
    if new.created_by <> old.created_by then raise exception 'Il creatore non è modificabile.'; end if;
    if old.linked_transaction_id is not null and new.paid_by_user_id <> old.paid_by_user_id then
      raise exception 'Scollega prima il movimento personale, poi modifica il pagatore.';
    end if;
  else
    new.created_by := auth.uid();
  end if;
  if not public.has_space_role(new.space_id, auth.uid(), array['owner','member']::public.space_role[]) then
    raise exception 'Non hai i permessi per modificare questa spesa.';
  end if;
  if not exists (select 1 from public.spaces s where s.id = new.space_id and s.kind = 'shared' and s.archived_at is null) then
    raise exception 'Le spese condivise richiedono uno spazio condiviso attivo.';
  end if;
  if not exists (select 1 from public.space_memberships m where m.space_id = new.space_id and m.user_id = new.paid_by_user_id) then
    raise exception 'Il pagatore non è membro dello spazio.';
  end if;
  select * into c from public.categories where id = new.category_id;
  if c.id is null or c.space_id <> new.space_id or c.archived_at is not null
     or public.category_root_kind(new.category_id) <> 'expense' then
    raise exception 'Seleziona una categoria di spesa attiva dello spazio condiviso.';
  end if;
  if new.linked_transaction_id is not null then
    if new.paid_by_user_id <> auth.uid() then
      raise exception 'Solo il pagatore può collegare un proprio movimento personale.';
    end if;
    select s.created_by into payer_space from public.transactions t
      join public.spaces s on s.id = t.space_id
      where t.id = new.linked_transaction_id and t.deleted_at is null
        and t.direction = 'outflow' and t.amount_cents = new.amount_cents
        and s.kind = 'personal';
    if payer_space is distinct from new.paid_by_user_id then
      raise exception 'Il movimento collegato deve essere un''uscita personale del pagatore con importo identico.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger shared_expenses_guard before insert or update on public.shared_expenses
  for each row execute function public.guard_shared_expense();

create or replace function public.guard_shared_expense_share() returns trigger
language plpgsql security definer set search_path = public as $$
declare e public.shared_expenses;
begin
  select * into e from public.shared_expenses where id = coalesce(new.expense_id, old.expense_id);
  if e.id is null or not public.has_space_role(e.space_id, auth.uid(), array['owner','member']::public.space_role[]) then
    raise exception 'Non hai i permessi per modificare le quote.';
  end if;
  if not exists (select 1 from public.space_memberships where space_id = e.space_id and user_id = coalesce(new.member_user_id, old.member_user_id)) then
    raise exception 'La quota deve appartenere a un membro dello spazio.';
  end if;
  return coalesce(new,old);
end $$;
create trigger shared_expense_shares_guard before insert or update or delete on public.shared_expense_shares
  for each row execute function public.guard_shared_expense_share();

create or replace function public.guard_shared_settlement() returns trigger
language plpgsql security definer set search_path = public as $$
declare tx record;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then raise exception 'Il rimborso non può cambiare spazio.'; end if;
    if new.created_by <> old.created_by then raise exception 'Il creatore non è modificabile.'; end if;
  else
    new.created_by := auth.uid();
  end if;
  if not public.has_space_role(new.space_id, auth.uid(), array['owner','member']::public.space_role[]) then
    raise exception 'Non hai i permessi per registrare rimborsi.';
  end if;
  if not exists (select 1 from public.spaces s where s.id = new.space_id and s.kind = 'shared' and s.archived_at is null) then
    raise exception 'Il rimborso richiede uno spazio condiviso attivo.';
  end if;
  if not exists (select 1 from public.space_memberships where space_id = new.space_id and user_id = new.from_user_id)
     or not exists (select 1 from public.space_memberships where space_id = new.space_id and user_id = new.to_user_id) then
    raise exception 'Entrambi i partecipanti devono appartenere allo spazio.';
  end if;
  if new.linked_transaction_id is not null then
    if new.from_user_id <> auth.uid() then raise exception 'Solo chi effettua il pagamento può collegare il movimento personale.'; end if;
    select t.id into tx from public.transactions t join public.spaces s on s.id=t.space_id
      where t.id=new.linked_transaction_id and t.deleted_at is null and t.direction='outflow'
        and t.amount_cents=new.amount_cents and s.kind='personal' and s.created_by=new.from_user_id;
    if tx.id is null then raise exception 'Il movimento collegato deve essere un''uscita personale del pagante con importo identico.'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger shared_settlements_guard before insert or update on public.shared_settlements
  for each row execute function public.guard_shared_settlement();

-- Scrittura atomica: spesa e quote vengono salvate insieme.
create or replace function public.save_shared_expense(
  _id uuid, _space_id uuid, _occurred_on date, _description text, _category_id uuid,
  _amount_cents bigint, _paid_by_user_id uuid, _split_mode text, _shares jsonb,
  _linked_transaction_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare eid uuid := coalesce(_id, gen_random_uuid()); total bigint; item jsonb; n integer := 0;
begin
  if jsonb_typeof(_shares) <> 'array' or jsonb_array_length(_shares) = 0 then
    raise exception 'Indica almeno una quota.';
  end if;
  if _id is null then
    insert into public.shared_expenses(id,space_id,occurred_on,description,category_id,amount_cents,paid_by_user_id,split_mode,linked_transaction_id)
    values(eid,_space_id,_occurred_on,_description,_category_id,_amount_cents,_paid_by_user_id,_split_mode,_linked_transaction_id);
  else
    update public.shared_expenses set occurred_on=_occurred_on,description=_description,category_id=_category_id,
      amount_cents=_amount_cents,paid_by_user_id=_paid_by_user_id,split_mode=_split_mode,
      linked_transaction_id=_linked_transaction_id where id=eid and space_id=_space_id and deleted_at is null;
    if not found then raise exception 'Spesa non trovata o non modificabile.'; end if;
    delete from public.shared_expense_shares where expense_id=eid;
  end if;
  for item in select value from jsonb_array_elements(_shares) loop
    insert into public.shared_expense_shares(expense_id,member_user_id,amount_cents)
    values(eid,(item->>'member_user_id')::uuid,(item->>'amount_cents')::bigint);
    n := n + 1;
  end loop;
  select coalesce(sum(amount_cents),0) into total from public.shared_expense_shares where expense_id=eid;
  if total <> _amount_cents then raise exception 'La somma delle quote deve coincidere con l''importo della spesa.'; end if;
  return eid;
end $$;

create or replace function public.save_shared_settlement(
  _id uuid, _space_id uuid, _occurred_on date, _from_user_id uuid, _to_user_id uuid,
  _amount_cents bigint, _kind text, _note text, _linked_transaction_id uuid default null
) returns uuid language plpgsql security definer set search_path = public as $$
declare sid uuid := coalesce(_id, gen_random_uuid());
begin
  if _id is null then
    insert into public.shared_settlements(id,space_id,occurred_on,from_user_id,to_user_id,amount_cents,kind,note,linked_transaction_id)
    values(sid,_space_id,_occurred_on,_from_user_id,_to_user_id,_amount_cents,_kind,_note,_linked_transaction_id);
  else
    update public.shared_settlements set occurred_on=_occurred_on,from_user_id=_from_user_id,to_user_id=_to_user_id,
      amount_cents=_amount_cents,kind=_kind,note=_note,linked_transaction_id=_linked_transaction_id
      where id=sid and space_id=_space_id and deleted_at is null;
    if not found then raise exception 'Rimborso non trovato o non modificabile.'; end if;
  end if;
  return sid;
end $$;

create or replace function public.unlink_shared_expense_transaction(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.shared_expenses set linked_transaction_id=null
    where id=_id and deleted_at is null and public.has_space_role(space_id,auth.uid(),array['owner','member']::public.space_role[]);
  if not found then raise exception 'Spesa non trovata o non modificabile.'; end if;
end $$;

create or replace function public.delete_shared_expense(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.shared_expenses set deleted_at=now(),linked_transaction_id=null
    where id=_id and deleted_at is null and public.has_space_role(space_id,auth.uid(),array['owner','member']::public.space_role[]);
  if not found then raise exception 'Spesa non trovata o non modificabile.'; end if;
end $$;

create or replace function public.delete_shared_settlement(_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  update public.shared_settlements set deleted_at=now(),linked_transaction_id=null
    where id=_id and deleted_at is null and public.has_space_role(space_id,auth.uid(),array['owner','member']::public.space_role[]);
  if not found then raise exception 'Rimborso non trovato o non modificabile.'; end if;
end $$;

revoke all on function public.save_shared_expense(uuid,uuid,date,text,uuid,bigint,uuid,text,jsonb,uuid),
  public.save_shared_settlement(uuid,uuid,date,uuid,uuid,bigint,text,text,uuid),
  public.unlink_shared_expense_transaction(uuid), public.delete_shared_expense(uuid),
  public.delete_shared_settlement(uuid) from public, anon;
grant execute on function public.save_shared_expense(uuid,uuid,date,text,uuid,bigint,uuid,text,jsonb,uuid),
  public.save_shared_settlement(uuid,uuid,date,uuid,uuid,bigint,text,text,uuid),
  public.unlink_shared_expense_transaction(uuid), public.delete_shared_expense(uuid),
  public.delete_shared_settlement(uuid) to authenticated;
