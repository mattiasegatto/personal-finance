-- Il residuo può superare il capitale originario per interessi/oneri capitalizzati.
-- Individua il CHECK originario tramite la sua definizione, senza dipendere dal nome generato da PostgreSQL.
do $$
declare c record;
begin
  for c in
    select conname
    from pg_constraint
    where conrelid = 'public.financial_debts'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) ilike '%outstanding_balance_cents%'
      and pg_get_constraintdef(oid) ilike '%original_principal_cents%'
  loop
    execute format('alter table public.financial_debts drop constraint %I', c.conname);
  end loop;
end $$;

alter table public.financial_debts
  add constraint financial_debts_outstanding_nonnegative
  check (outstanding_balance_cents >= 0);
