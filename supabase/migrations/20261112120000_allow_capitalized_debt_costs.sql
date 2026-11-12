-- Il residuo può superare il capitale originario per interessi/oneri capitalizzati.
alter table public.financial_debts
  drop constraint financial_debts_outstanding_balance_cents_check;
alter table public.financial_debts
  add constraint financial_debts_outstanding_balance_cents_check
  check (outstanding_balance_cents >= 0);
