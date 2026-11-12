-- Investimenti e debiti finanziari: valori aggiornati manualmente.
-- I saldi di conti e conti deposito restano derivati da accounts/account_balances.
create type public.investment_type as enum ('etf','stock','bond','fund','crypto','other');
create type public.debt_type as enum ('mortgage','loan','financing','other');

create table public.investments (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  type public.investment_type not null default 'other',
  ticker text check (ticker is null or length(ticker) <= 20),
  currency char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  quantity numeric(24,10) check (quantity is null or quantity >= 0),
  invested_amount_cents bigint not null default 0 check (invested_amount_cents >= 0),
  current_value_cents bigint not null check (current_value_cents >= 0),
  valuation_date date not null default current_date,
  notes text check (notes is null or length(notes) <= 1000),
  archived_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index investments_space_active_idx on public.investments(space_id, archived_at);

create table public.financial_debts (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  name text not null check (length(btrim(name)) between 1 and 120),
  lender text check (lender is null or length(lender) <= 120),
  type public.debt_type not null default 'other',
  currency char(3) not null default 'EUR' check (currency ~ '^[A-Z]{3}$'),
  original_principal_cents bigint not null check (original_principal_cents > 0),
  outstanding_balance_cents bigint not null check (outstanding_balance_cents >= 0 and outstanding_balance_cents <= original_principal_cents),
  annual_interest_rate numeric(8,5) check (annual_interest_rate is null or annual_interest_rate between 0 and 100),
  monthly_payment_cents bigint check (monthly_payment_cents is null or monthly_payment_cents >= 0),
  started_on date,
  due_on date,
  notes text check (notes is null or length(notes) <= 1000),
  archived_at timestamptz,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (due_on is null or started_on is null or due_on >= started_on)
);
create index financial_debts_space_active_idx on public.financial_debts(space_id, archived_at);

grant select, insert, update on public.investments, public.financial_debts to authenticated;
grant all on public.investments, public.financial_debts to service_role;
alter table public.investments enable row level security;
alter table public.financial_debts enable row level security;

create policy "investments: membri leggono" on public.investments for select to authenticated
  using (public.is_space_member(space_id, auth.uid()));
create policy "investments: owner/member creano" on public.investments for insert to authenticated
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id) and created_by = auth.uid());
create policy "investments: owner/member modificano" on public.investments for update to authenticated
  using (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]))
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id));

create policy "debts: membri leggono" on public.financial_debts for select to authenticated
  using (public.is_space_member(space_id, auth.uid()));
create policy "debts: owner/member creano" on public.financial_debts for insert to authenticated
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id) and created_by = auth.uid());
create policy "debts: owner/member modificano" on public.financial_debts for update to authenticated
  using (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]))
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id));

create or replace function public.guard_net_worth_record() returns trigger
language plpgsql set search_path = public as $$
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then raise exception 'Il record non può cambiare spazio.'; end if;
    if new.created_by <> old.created_by then raise exception 'Il creatore non è modificabile.'; end if;
  else
    new.created_by := auth.uid();
  end if;
  if not public.is_personal_space(new.space_id) then raise exception 'Investimenti e debiti devono appartenere a uno spazio personale.'; end if;
  new.updated_at := now();
  return new;
end $$;
create trigger investments_guard before insert or update on public.investments
  for each row execute function public.guard_net_worth_record();
create trigger financial_debts_guard before insert or update on public.financial_debts
  for each row execute function public.guard_net_worth_record();

-- Aggregati separati per valuta: non sommare mai importi in valute differenti.
create view public.net_worth_totals with (security_invoker = true) as
select space_id, currency, 'investment'::text as component,
       sum(current_value_cents)::bigint as amount_cents
from public.investments where archived_at is null
group by space_id, currency
union all
select space_id, currency, 'debt'::text as component,
       sum(outstanding_balance_cents)::bigint as amount_cents
from public.financial_debts where archived_at is null
group by space_id, currency;
grant select on public.net_worth_totals to authenticated;
