-- Privilege and exposure audit for the public schema.
--
-- These checks pin the database's client-facing surface. A new migration that
-- exposes a function, grants a table write, disables RLS or ships an unsafe
-- SECURITY DEFINER function fails here until the allowlists below are updated
-- deliberately and reviewed.
\set ON_ERROR_STOP 1

do $audit$
declare
  failures text[] := '{}';
  r record;

  -- Every function in public that the authenticated role may execute.
  allowed_rpc text[] := array[
    -- Membership predicates (answer only for auth.uid()).
    'has_space_role(uuid,uuid,space_role[])',
    'is_personal_space(uuid)',
    'is_space_member(uuid,uuid)',
    'shares_shared_space(uuid,uuid)',
    'current_email()',
    -- Spaces and invitations.
    'create_shared_space(text)',
    'invite_to_space(uuid,text,space_role)',
    'accept_invitation(uuid)',
    -- Categories are a fixed set (read-only for clients).
    'category_root_kind(uuid)',
    -- Transfers.
    'create_transfer(uuid,uuid,bigint,date,text)',
    'update_transfer(uuid,uuid,uuid,bigint,date,text)',
    'delete_transfer(uuid)',
    -- Shared expenses and settlements.
    'save_shared_expense(uuid,uuid,date,text,uuid,bigint,uuid,text,jsonb,uuid)',
    'save_shared_settlement(uuid,uuid,date,uuid,uuid,bigint,text,text,uuid)',
    'unlink_shared_expense_transaction(uuid)',
    'delete_shared_expense(uuid)',
    'delete_shared_settlement(uuid)',
    -- Investment trades (atomic movement + investment update).
    'record_investment_trade(uuid,uuid,investment_trade_kind,bigint,numeric,date,text)',
    'delete_investment_trade(uuid)',
    -- Recurring items and deadlines.
    'next_recurring_date(date,date,recurrence_frequency)',
    'advance_recurring_due(uuid,date)',
    'confirm_recurring_item(uuid,date)',
    'complete_deadline(uuid)',
    'cancel_deadline(uuid)'
  ];

  -- Direct table writes the authenticated role may perform (still subject to
  -- RLS and guard triggers). Shared expenses, shares, settlements, transfers,
  -- revisions, invitations and membership inserts must stay RPC-only.
  allowed_writes text[] := array[
    'accounts:DELETE', 'accounts:INSERT', 'accounts:UPDATE',
    'deadlines:INSERT', 'deadlines:UPDATE',
    'financial_debts:INSERT', 'financial_debts:UPDATE',
    'investments:INSERT', 'investments:UPDATE',
    'profiles:UPDATE',
    'recurring_items:INSERT', 'recurring_items:UPDATE',
    'space_memberships:DELETE', 'space_memberships:UPDATE',
    'spaces:UPDATE',
    'transactions:INSERT', 'transactions:UPDATE'
  ];

  allowed_column_writes text[] := array[
    'categories.updated_at:UPDATE',
    'space_invitations.status:UPDATE'
  ];
begin
  -- 1. SECURITY DEFINER functions must pin a search_path ending in pg_temp.
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prosecdef
      and not exists (
        select 1 from unnest(coalesce(p.proconfig, '{}')) c
        where c like 'search_path=%' and c like '%pg_temp'
      )
  loop
    failures := failures || format('SECURITY DEFINER senza search_path sicuro: %s', r.fn);
  end loop;

  -- 2. No public function is executable by anon or granted to PUBLIC.
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and (
        has_function_privilege('anon', p.oid, 'execute')
        or exists (
          select 1
          from aclexplode(coalesce(p.proacl, acldefault('f', p.proowner))) a
          where a.grantee = 0 and a.privilege_type = 'EXECUTE'
        )
      )
  loop
    failures := failures || format('Funzione eseguibile da anon/PUBLIC: %s', r.fn);
  end loop;

  -- 3. Trigger functions are never callable by clients.
  for r in
    select p.oid::regprocedure as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype = 'trigger'::regtype
      and (
        has_function_privilege('authenticated', p.oid, 'execute')
        or has_function_privilege('anon', p.oid, 'execute')
      )
  loop
    failures := failures || format('Funzione trigger eseguibile dai client: %s', r.fn);
  end loop;

  -- 4. The authenticated RPC surface matches the reviewed allowlist exactly.
  for r in
    select p.oid::regprocedure::text as fn
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.prorettype <> 'trigger'::regtype
      and has_function_privilege('authenticated', p.oid, 'execute')
      and p.oid::regprocedure::text <> all (allowed_rpc)
  loop
    failures := failures || format('Funzione esposta ad authenticated non approvata: %s', r.fn);
  end loop;

  for r in
    select a.fn
    from unnest(allowed_rpc) a(fn)
    where to_regprocedure('public.' || a.fn) is null
       or not has_function_privilege('authenticated', to_regprocedure('public.' || a.fn), 'execute')
  loop
    failures := failures || format('RPC attesa mancante o non eseguibile: %s', r.fn);
  end loop;

  -- 5. RLS is enabled on every table in public.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p')
      and not c.relrowsecurity
  loop
    failures := failures || format('Tabella senza RLS: %s', r.relname);
  end loop;

  -- 6. anon holds no privilege on any table, view or sequence in public.
  for r in
    select c.relname, c.relkind
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm', 'S')
      and exists (
        select 1
        from aclexplode(coalesce(c.relacl, acldefault((case when c.relkind = 'S' then 's' else 'r' end)::"char", c.relowner))) a
        where a.grantee in (0, 'anon'::regrole)
      )
  loop
    failures := failures || format('Oggetto accessibile ad anon/PUBLIC: %s (%s)', r.relname, r.relkind);
  end loop;

  -- 7. Direct writes by authenticated match the reviewed allowlist exactly.
  for r in
    select c.relname || ':' || a.privilege_type as grant_key
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(coalesce(c.relacl, acldefault('r', c.relowner))) a
    where n.nspname = 'public'
      and c.relkind in ('r', 'p', 'v', 'm')
      and a.grantee = 'authenticated'::regrole
      and a.privilege_type in ('INSERT', 'UPDATE', 'DELETE', 'TRUNCATE', 'REFERENCES', 'TRIGGER')
      and c.relname || ':' || a.privilege_type <> all (allowed_writes)
  loop
    failures := failures || format('Scrittura diretta non approvata per authenticated: %s', r.grant_key);
  end loop;

  -- 7b. Column-level write grants match the reviewed allowlist exactly:
  --     categories.updated_at is needed by FOR SHARE in invoker guards (actual
  --     updates are rejected); space_invitations.status lets owners revoke.
  for r in
    select c.relname || '.' || a.attname || ':' || x.privilege_type as grant_key
    from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    cross join lateral aclexplode(a.attacl) x
    where n.nspname = 'public'
      and a.attacl is not null
      and x.grantee in ('authenticated'::regrole, 'anon'::regrole, 0)
      and x.privilege_type in ('INSERT', 'UPDATE', 'REFERENCES')
      and c.relname || '.' || a.attname || ':' || x.privilege_type <> all (allowed_column_writes)
  loop
    failures := failures || format('Privilegio di colonna non approvato: %s', r.grant_key);
  end loop;

  -- 8. Views run with the caller's privileges so RLS still applies.
  for r in
    select c.relname
    from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public'
      and c.relkind = 'v'
      and not coalesce('security_invoker=true' = any (c.reloptions), false)
  loop
    failures := failures || format('Vista senza security_invoker: %s', r.relname);
  end loop;

  if cardinality(failures) > 0 then
    raise exception E'Audit dei privilegi fallito:\n%', array_to_string(failures, E'\n');
  end if;
end;
$audit$;

select 'ALL_PASSED: privilegi di funzioni, tabelle, viste e RLS conformi alle allowlist' as result;
