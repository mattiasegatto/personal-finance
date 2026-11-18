-- Brokerage accounts and investment trades (decided 18/11/2026).
--
-- Money moved to a brokerage account is an ordinary transfer. Buying or
-- selling an investment is an atomic trade: one movement on the brokerage
-- account (operation_type 'investment', no category) plus an update of the
-- investment's invested capital, quantity and current value. Trades are not
-- income or expenses; uninvested cash stays as the brokerage account balance,
-- which counts as liquidity. Commissions and taxes are ordinary expenses.

-- 1. Investments may be held in a brokerage account of the same space.
alter table public.investments
  add column account_id uuid references public.accounts(id) on delete restrict;
create index investments_account_idx on public.investments(account_id);

create type public.investment_trade_kind as enum ('buy', 'sell');

create table public.investment_trades (
  id uuid primary key default gen_random_uuid(),
  -- Strict insertion order: now() is constant within a transaction, so
  -- created_at cannot tell which of two trades in one transaction is the latest.
  seq bigint generated always as identity unique,
  space_id uuid not null references public.spaces(id) on delete restrict,
  investment_id uuid not null references public.investments(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  transaction_id uuid not null unique references public.transactions(id) on delete restrict,
  kind public.investment_trade_kind not null,
  occurred_on date not null,
  amount_cents bigint not null check (amount_cents > 0),
  quantity numeric(24,10) not null check (quantity > 0),
  -- Capital and value added (buy) or removed (sell), kept to reverse the trade exactly.
  invested_delta_cents bigint not null check (invested_delta_cents >= 0),
  value_delta_cents bigint not null check (value_delta_cents >= 0),
  description text check (description is null or length(description) <= 200),
  created_by uuid not null default auth.uid(),
  deleted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index investment_trades_investment_idx on public.investment_trades(investment_id, deleted_at, seq);
create index investment_trades_space_idx on public.investment_trades(space_id, occurred_on);

alter table public.investment_trades enable row level security;
grant select on public.investment_trades to authenticated;
grant all on public.investment_trades to service_role;
create policy "investment_trades: membri leggono" on public.investment_trades for select to authenticated
  using (public.is_space_member(space_id, auth.uid()));

-- 2. The holding account must be a brokerage account of the same space, and
--    it cannot change once trades exist.
create or replace function public.guard_investment_account()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare a record;
begin
  if new.account_id is not null then
    select * into a from public.accounts where id = new.account_id for share;
    if not found or a.space_id is distinct from new.space_id then
      raise exception 'Il conto titoli appartiene a un altro spazio.';
    end if;
    if a.type <> 'brokerage' then
      raise exception 'Un investimento può essere collegato solo a un conto titoli.';
    end if;
    if a.currency <> new.currency then
      raise exception 'Il conto titoli deve avere la stessa valuta dell''investimento.';
    end if;
  end if;
  -- The first link (from no account) is allowed; moving to another account is not.
  if tg_op = 'UPDATE' and old.account_id is not null and new.account_id is distinct from old.account_id
     and exists (select 1 from public.investment_trades t where t.investment_id = old.id and t.deleted_at is null) then
    raise exception 'Non puoi cambiare il conto titoli di un investimento con operazioni registrate.';
  end if;
  return new;
end
$$;

revoke all on function public.guard_investment_account() from public, anon, authenticated;

create trigger investments_account_guard
before insert or update of account_id, currency on public.investments
for each row execute function public.guard_investment_account();

-- 3. Investment movements, like transfer legs, are written only by their RPC.
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
  elsif new.operation_type = 'investment' then
    if current_setting('app.investment_rpc', true) is distinct from 'on' then
      raise exception 'I movimenti di investimento possono essere creati o modificati solo tramite la funzione dedicata.';
    end if;
    if new.category_id is not null then
      raise exception 'Un''operazione su investimenti non ha categoria.';
    end if;
    if a.type <> 'brokerage' then
      raise exception 'Le operazioni su investimenti si registrano su un conto titoli.';
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

-- 4. Record a buy or a sell.
create or replace function public.record_investment_trade(
  _investment uuid,
  _account uuid,
  _kind public.investment_trade_kind,
  _amount_cents bigint,
  _quantity numeric,
  _occurred_on date,
  _description text default null
)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  inv public.investments;
  acc public.accounts;
  invested_delta bigint;
  value_delta bigint;
  txid uuid;
  trade_id uuid;
  descr text;
begin
  if uid is null then raise exception 'Accesso richiesto'; end if;
  if _kind is null then raise exception 'Tipo di operazione obbligatorio'; end if;
  if _amount_cents is null or _amount_cents <= 0 then raise exception 'Importo non valido'; end if;
  if _quantity is null or _quantity <= 0 then raise exception 'Quantità non valida'; end if;
  if _occurred_on is null then raise exception 'Data obbligatoria'; end if;

  select * into inv from public.investments where id = _investment for update;
  if inv.id is null then raise exception 'Investimento non trovato'; end if;
  if not public.has_space_role(inv.space_id, uid, array['owner','member']::public.space_role[]) then
    raise exception 'Non sei autorizzato su questo spazio';
  end if;
  if inv.archived_at is not null then raise exception 'L''investimento è archiviato'; end if;

  select * into acc from public.accounts where id = _account for share;
  if acc.id is null or acc.space_id <> inv.space_id then raise exception 'Conto non trovato'; end if;
  if acc.type <> 'brokerage' then raise exception 'Le operazioni su investimenti si registrano su un conto titoli.'; end if;
  if acc.archived_at is not null then raise exception 'Il conto titoli è archiviato'; end if;
  if acc.currency <> inv.currency then raise exception 'Il conto titoli deve avere la stessa valuta dell''investimento.'; end if;
  if inv.account_id is not null and inv.account_id <> acc.id then
    raise exception 'L''investimento è detenuto in un altro conto titoli.';
  end if;

  if _kind = 'buy' then
    invested_delta := _amount_cents;
    value_delta := _amount_cents;
  else
    if coalesce(inv.quantity, 0) < _quantity then
      raise exception 'Quote insufficienti: ne possiedi %.', coalesce(inv.quantity, 0);
    end if;
    if _quantity = inv.quantity then
      invested_delta := inv.invested_amount_cents;
      value_delta := inv.current_value_cents;
    else
      invested_delta := round(inv.invested_amount_cents * _quantity / inv.quantity);
      value_delta := round(inv.current_value_cents * _quantity / inv.quantity);
    end if;
  end if;

  descr := coalesce(
    nullif(btrim(coalesce(_description, '')), ''),
    (case when _kind = 'buy' then 'Acquisto ' else 'Vendita ' end) || inv.name
  );

  perform set_config('app.investment_rpc', 'on', true);

  insert into public.transactions(space_id, account_id, category_id, operation_type,
    direction, amount_cents, occurred_on, description)
  values (inv.space_id, acc.id, null, 'investment',
    (case when _kind = 'buy' then 'outflow' else 'inflow' end)::public.tx_direction,
    _amount_cents, _occurred_on, left(descr, 200))
  returning id into txid;

  insert into public.investment_trades(space_id, investment_id, account_id, transaction_id, kind,
    occurred_on, amount_cents, quantity, invested_delta_cents, value_delta_cents, description, created_by)
  values (inv.space_id, inv.id, acc.id, txid, _kind, _occurred_on, _amount_cents, _quantity,
    invested_delta, value_delta, left(descr, 200), uid)
  returning id into trade_id;

  update public.investments
  set account_id = acc.id,
      quantity = case when _kind = 'buy' then coalesce(quantity, 0) + _quantity else quantity - _quantity end,
      invested_amount_cents = case when _kind = 'buy' then invested_amount_cents + invested_delta
                                   else invested_amount_cents - invested_delta end,
      current_value_cents = case when _kind = 'buy' then current_value_cents + value_delta
                                 else current_value_cents - value_delta end
  where id = inv.id;

  perform set_config('app.investment_rpc', 'off', true);
  return trade_id;
end
$$;

-- 5. Cancel the most recent trade of an investment, reversing it exactly.
create or replace function public.delete_investment_trade(_trade uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  uid uuid := auth.uid();
  t public.investment_trades;
  inv public.investments;
  latest uuid;
begin
  if uid is null then raise exception 'Accesso richiesto'; end if;

  select * into t from public.investment_trades where id = _trade;
  if t.id is null then raise exception 'Operazione non trovata'; end if;
  if not public.has_space_role(t.space_id, uid, array['owner','member']::public.space_role[]) then
    raise exception 'Non sei autorizzato su questo spazio';
  end if;

  -- Same lock order as record_investment_trade: investment first, then trade.
  select * into inv from public.investments where id = t.investment_id for update;
  select * into t from public.investment_trades where id = _trade for update;
  if t.deleted_at is not null then raise exception 'L''operazione è già annullata'; end if;

  select id into latest
  from public.investment_trades
  where investment_id = t.investment_id and deleted_at is null
  order by seq desc
  limit 1;
  if latest <> t.id then
    raise exception 'Puoi annullare solo l''ultima operazione di questo investimento.';
  end if;

  if t.kind = 'buy' and coalesce(inv.quantity, 0) < t.quantity then
    raise exception 'Le quote attuali non permettono di annullare l''acquisto.';
  end if;

  perform set_config('app.investment_rpc', 'on', true);

  update public.transactions set deleted_at = now() where id = t.transaction_id;
  update public.investment_trades set deleted_at = now(), updated_at = now() where id = t.id;
  update public.investments
  set quantity = case when t.kind = 'buy' then quantity - t.quantity else coalesce(quantity, 0) + t.quantity end,
      invested_amount_cents = case when t.kind = 'buy' then greatest(invested_amount_cents - t.invested_delta_cents, 0)
                                   else invested_amount_cents + t.invested_delta_cents end,
      current_value_cents = case when t.kind = 'buy' then greatest(current_value_cents - t.value_delta_cents, 0)
                                 else current_value_cents + t.value_delta_cents end
  where id = inv.id;

  perform set_config('app.investment_rpc', 'off', true);
end
$$;

revoke all on function public.record_investment_trade(uuid, uuid, public.investment_trade_kind, bigint, numeric, date, text)
  from public, anon;
revoke all on function public.delete_investment_trade(uuid) from public, anon;
grant execute on function public.record_investment_trade(uuid, uuid, public.investment_trade_kind, bigint, numeric, date, text)
  to authenticated;
grant execute on function public.delete_investment_trade(uuid) to authenticated;
