create type public.account_type as enum ('checking','savings','card','cash','other');
create type public.category_kind as enum ('income','expense');
create type public.tx_direction as enum ('inflow','outflow');
create type public.tx_operation as enum ('ordinary');

create or replace function public.is_personal_space(_space uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.spaces where id = _space and kind = 'personal')
$$;
revoke execute on function public.is_personal_space(uuid) from public, anon;
grant execute on function public.is_personal_space(uuid) to authenticated;

create table public.accounts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id),
  name text not null check (length(btrim(name)) between 1 and 80),
  type public.account_type not null default 'checking',
  currency char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  initial_balance_cents bigint not null default 0,
  opened_on date,
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.accounts(space_id);

create table public.categories (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id),
  parent_id uuid references public.categories(id),
  kind public.category_kind,
  name text not null check (length(btrim(name)) between 1 and 60),
  archived_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint categories_kind_root check ((parent_id is null) = (kind is not null))
);
create index on public.categories(space_id);
create unique index categories_unique_name on public.categories(space_id, coalesce(parent_id, '00000000-0000-0000-0000-000000000000'::uuid), lower(name)) where archived_at is null;

create table public.transactions (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id),
  account_id uuid not null references public.accounts(id),
  category_id uuid not null references public.categories(id),
  operation_type public.tx_operation not null default 'ordinary',
  direction public.tx_direction not null,
  amount_cents bigint not null check (amount_cents > 0),
  occurred_on date not null,
  description text check (description is null or length(description) <= 200),
  created_by uuid not null default auth.uid(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.transactions(space_id, occurred_on desc);
create index on public.transactions(account_id);

create table public.transaction_revisions (
  id bigserial primary key,
  transaction_id uuid not null references public.transactions(id),
  space_id uuid not null,
  action text not null,
  old_row jsonb,
  new_row jsonb,
  changed_by uuid default auth.uid(),
  changed_at timestamptz not null default now()
);

grant select, insert, update on public.accounts to authenticated;
grant select, insert, update on public.categories to authenticated;
grant select, insert, update on public.transactions to authenticated;
grant select on public.transaction_revisions to authenticated;
grant all on public.accounts, public.categories, public.transactions, public.transaction_revisions to service_role;
grant usage on sequence public.transaction_revisions_id_seq to service_role;

alter table public.accounts enable row level security;
alter table public.categories enable row level security;
alter table public.transactions enable row level security;
alter table public.transaction_revisions enable row level security;

create policy "accounts: membri leggono" on public.accounts for select to authenticated using (public.is_space_member(space_id, auth.uid()));
create policy "accounts: owner/member creano" on public.accounts for insert to authenticated
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id));
create policy "accounts: owner/member modificano" on public.accounts for update to authenticated
  using (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]))
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]));

create policy "categories: membri leggono" on public.categories for select to authenticated using (public.is_space_member(space_id, auth.uid()));
create policy "categories: owner/member creano" on public.categories for insert to authenticated
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id));
create policy "categories: owner/member modificano" on public.categories for update to authenticated
  using (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]))
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]));

create policy "transactions: membri leggono" on public.transactions for select to authenticated using (public.is_space_member(space_id, auth.uid()));
create policy "transactions: owner/member creano" on public.transactions for insert to authenticated
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id));
create policy "transactions: owner/member modificano" on public.transactions for update to authenticated
  using (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]))
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]));

create policy "revisions: membri leggono" on public.transaction_revisions for select to authenticated using (public.is_space_member(space_id, auth.uid()));

-- Integrità conti
create or replace function public.guard_account() returns trigger language plpgsql set search_path = public as $$
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
create trigger accounts_guard before insert or update on public.accounts for each row execute function public.guard_account();

-- Integrità categorie: massimo due livelli, stesso spazio, tipo ereditato dal padre
create or replace function public.guard_category() returns trigger language plpgsql set search_path = public as $$
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
    if p.space_id <> new.space_id then raise exception 'La categoria padre appartiene a un altro spazio.'; end if;
    if p.parent_id is not null then raise exception 'Sono ammessi al massimo due livelli di categoria.'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger categories_guard before insert or update on public.categories for each row execute function public.guard_category();

create or replace function public.category_root_kind(_cat uuid) returns public.category_kind
language sql stable set search_path = public as $$
  select coalesce(c.kind, p.kind) from categories c left join categories p on p.id = c.parent_id where c.id = _cat
$$;

-- Integrità movimenti
create or replace function public.guard_transaction() returns trigger language plpgsql set search_path = public as $$
declare a record; c record;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then raise exception 'Un movimento non può cambiare spazio.'; end if;
    if old.deleted_at is not null then raise exception 'Un movimento eliminato non può essere modificato.'; end if;
    if new.created_by <> old.created_by then raise exception 'Campo non modificabile.'; end if;
  else
    new.created_by := auth.uid();
  end if;
  if not public.is_personal_space(new.space_id) then raise exception 'I movimenti personali vanno registrati in uno spazio personale.'; end if;
  select * into a from accounts where id = new.account_id;
  if a.space_id <> new.space_id then raise exception 'Il conto appartiene a un altro spazio.'; end if;
  if a.archived_at is not null and (tg_op = 'INSERT' or new.account_id <> old.account_id) then
    raise exception 'Il conto è archiviato.'; end if;
  select * into c from categories where id = new.category_id;
  if c.space_id <> new.space_id then raise exception 'La categoria appartiene a un altro spazio.'; end if;
  if tg_op = 'INSERT' or new.category_id <> old.category_id then
    if c.archived_at is not null then raise exception 'La categoria è archiviata.'; end if;
    if public.category_root_kind(new.category_id) <> (case when new.direction = 'inflow' then 'income' else 'expense' end)::public.category_kind then
      raise exception 'La categoria non corrisponde alla direzione del movimento.'; end if;
  elsif new.direction <> old.direction then
    if public.category_root_kind(new.category_id) <> (case when new.direction = 'inflow' then 'income' else 'expense' end)::public.category_kind then
      raise exception 'La categoria non corrisponde alla direzione del movimento.'; end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger transactions_guard before insert or update on public.transactions for each row execute function public.guard_transaction();

create or replace function public.log_transaction() returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into transaction_revisions(transaction_id, space_id, action, old_row, new_row)
  values (new.id, new.space_id,
    case when tg_op = 'INSERT' then 'insert' when new.deleted_at is not null and old.deleted_at is null then 'delete' else 'update' end,
    case when tg_op = 'UPDATE' then to_jsonb(old) end, to_jsonb(new));
  return null;
end $$;
revoke execute on function public.log_transaction() from public, anon, authenticated;
create trigger transactions_log after insert or update on public.transactions for each row execute function public.log_transaction();

-- Saldo calcolato: saldo iniziale + entrate - uscite (movimenti non eliminati)
create view public.account_balances with (security_invoker = true) as
select a.id as account_id, a.space_id,
  a.initial_balance_cents
  + coalesce(sum(case when t.direction = 'inflow' then t.amount_cents else -t.amount_cents end) filter (where t.deleted_at is null), 0)
  as balance_cents
from public.accounts a left join public.transactions t on t.account_id = a.id
group by a.id;
grant select on public.account_balances to authenticated;

-- Categorie di partenza (provvisorie)
create or replace function public.create_starter_categories(_space uuid) returns void
language plpgsql security invoker set search_path = public as $$
declare r uuid;
begin
  if exists (select 1 from categories where space_id = _space) then return; end if;
  insert into categories(space_id, kind, name) values (_space,'income','Entrate') returning id into r;
  insert into categories(space_id, parent_id, name) values (_space,r,'Stipendio'),(_space,r,'Altre entrate');
  insert into categories(space_id, kind, name) values (_space,'expense','Casa') returning id into r;
  insert into categories(space_id, parent_id, name) values (_space,r,'Affitto e mutuo'),(_space,r,'Utenze');
  insert into categories(space_id, kind, name) values (_space,'expense','Vita quotidiana') returning id into r;
  insert into categories(space_id, parent_id, name) values (_space,r,'Spesa alimentare'),(_space,r,'Trasporti'),(_space,r,'Svago');
end $$;
revoke execute on function public.create_starter_categories(uuid) from public, anon;
grant execute on function public.create_starter_categories(uuid) to authenticated;