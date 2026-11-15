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
