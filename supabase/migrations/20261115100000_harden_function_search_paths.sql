-- Prevent caller-controlled temporary objects from shadowing application
-- relations inside trigger and SECURITY DEFINER functions.
--
-- pg_temp is deliberately explicit and last: PostgreSQL otherwise searches
-- the session's temporary schema before ordinary schemas for relations.
-- pg_catalog is first so built-ins cannot be shadowed either.
revoke create on schema public from public, anon, authenticated;

do $$
declare
  app_function record;
begin
  for app_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
  loop
    execute format(
      'alter function %s set search_path = pg_catalog, public, pg_temp',
      app_function.signature
    );
  end loop;
end;
$$;

-- Trigger functions are implementation details, never RPC endpoints. Their
-- execution as triggers does not require callers to hold EXECUTE privileges.
do $$
declare
  trigger_function record;
begin
  for trigger_function in
    select p.oid::regprocedure as signature
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prokind = 'f'
      and p.prorettype = 'trigger'::regtype
  loop
    execute format(
      'revoke all on function %s from public, anon, authenticated',
      trigger_function.signature
    );
  end loop;
end;
$$;

-- Fail closed on table/sequence privileges, including grants inherited from
-- default privileges in a Supabase project. Regrant only the operations used
-- by the application; privileged writes remain inside validated RPCs.
revoke all on all tables in schema public from public, anon, authenticated;
revoke all on all sequences in schema public from public, anon, authenticated;

grant select, update on public.profiles to authenticated;
grant select, update on public.spaces to authenticated;
grant select, update, delete on public.space_memberships to authenticated;
grant select on public.space_invitations to authenticated;
grant update (status) on public.space_invitations to authenticated;

grant select, insert, update, delete on public.accounts to authenticated;
grant select, insert, update on public.categories to authenticated;
grant select, insert, update on public.transactions to authenticated;
grant select on public.transaction_revisions to authenticated;
grant select on public.account_balances to authenticated;

grant select on public.transfers, public.transfer_transaction_links to authenticated;
grant select, insert, update on public.investments, public.financial_debts to authenticated;
grant select on public.shared_expenses, public.shared_expense_shares,
  public.shared_settlements to authenticated;
grant select, insert, update on public.recurring_items, public.deadlines to authenticated;
grant select on public.net_worth_totals to authenticated;

-- New application objects must not silently inherit broad API permissions.
alter default privileges for role postgres in schema public
  revoke all on tables from public, anon, authenticated;
alter default privileges for role postgres in schema public
  revoke all on sequences from public, anon, authenticated;
alter default privileges for role postgres
  revoke execute on functions from public;
alter default privileges for role postgres in schema public
  revoke execute on functions from anon, authenticated;

-- Remove PostgreSQL's default PUBLIC EXECUTE grant from every existing
-- application function. Authenticated RPC/helper grants declared by earlier
-- migrations remain intact; trigger functions were revoked above.
revoke execute on all functions in schema public from public, anon;
