-- Fase 2: test di conti, categorie e movimenti personali. Dati fittizi, transazione annullata.
-- Al successo termina con l'errore intenzionale "ALL_PASSED: N controlli", che annulla tutto.
do $$
declare
  ua uuid := '00000000-0000-0000-0000-0000000000a1';
  ub uuid := '00000000-0000-0000-0000-0000000000b1';
  sa uuid; sb uuid; acc uuid; accb uuid; inc uuid; exp uuid; expb uuid; t1 uuid; t2 uuid; cycle_cat uuid; v bigint; n int := 0; ok boolean;
begin
  insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
   (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fa@test.local','{"display_name":"A"}',now(),now()),
   (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fb@test.local','{"display_name":"B"}',now(),now());
  select id into sa from public.spaces where created_by = ua and kind = 'personal';
  select id into sb from public.spaces where created_by = ub and kind = 'personal';

  -- come A
  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated','email','fa@test.local')::text, true);
  execute 'set local role authenticated';
  perform public.create_starter_categories(sa);
  select id into inc from public.categories where space_id = sa and name = 'Stipendio';
  select id into exp from public.categories where space_id = sa and name = 'Spesa alimentare';
  if inc is null or exp is null then raise exception 'FAIL categorie di partenza'; end if; n := n + 1;

  -- 1-3 conto, modifica, saldo iniziale
  insert into public.accounts(space_id, name, type, initial_balance_cents) values (sa,'Conto test','checking',100000) returning id into acc;
  update public.accounts set name = 'Conto test rinominato' where id = acc;
  if (select name from public.accounts where id = acc) <> 'Conto test rinominato' then raise exception 'FAIL modifica conto'; end if; n := n + 1;
  select balance_cents into v from public.account_balances where account_id = acc;
  if v <> 100000 then raise exception 'FAIL saldo iniziale %', v; end if; n := n + 1;
  if exists (select 1 from public.transactions where account_id = acc) then raise exception 'FAIL saldo iniziale come movimento'; end if; n := n + 1;

  -- 4-6 entrata, uscita, saldo
  insert into public.transactions(space_id, account_id, category_id, direction, amount_cents, occurred_on) values (sa,acc,inc,'inflow',250000,'2026-11-01') returning id into t1;
  insert into public.transactions(space_id, account_id, category_id, direction, amount_cents, occurred_on, description) values (sa,acc,exp,'outflow',4590,'2026-11-02','Spesa') returning id into t2;
  select balance_cents into v from public.account_balances where account_id = acc;
  if v <> 345410 then raise exception 'FAIL saldo %', v; end if; n := n + 1;

  -- 7 modifica movimento
  update public.transactions set amount_cents = 5000 where id = t2;
  select balance_cents into v from public.account_balances where account_id = acc;
  if v <> 345000 then raise exception 'FAIL saldo dopo modifica %', v; end if; n := n + 1;

  -- 8 eliminazione (logica)
  update public.transactions set deleted_at = now() where id = t2;
  select balance_cents into v from public.account_balances where account_id = acc;
  if v <> 350000 then raise exception 'FAIL saldo dopo eliminazione %', v; end if; n := n + 1;
  if (select count(*) from public.transaction_revisions where transaction_id = t2) <> 3 then raise exception 'FAIL storico revisioni'; end if; n := n + 1;

  -- Categoria non può diventare padre di sé stessa.
  insert into public.categories(space_id, kind, name)
  values (sa, 'expense', 'Categoria ciclo test') returning id into cycle_cat;
  begin
    update public.categories set parent_id = cycle_cat, kind = null where id = cycle_cat;
    ok := false;
  exception when others then
    ok := true;
  end;
  if not ok then raise exception 'FAIL categoria autoreferenziale accettata'; end if; n := n + 1;

  -- regole
  begin insert into public.transactions(space_id, account_id, category_id, direction, amount_cents, occurred_on) values (sa,acc,inc,'outflow',100,'2026-11-03'); ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL categoria/direzione incoerenti accettate'; end if; n := n + 1;
  begin insert into public.transactions(space_id, account_id, category_id, direction, amount_cents, occurred_on) values (sa,acc,exp,'outflow',-100,'2026-11-03'); ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL importo negativo accettato'; end if; n := n + 1;
  begin update public.accounts set archived_at = now() where id = acc; ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL archiviazione con saldo non zero'; end if; n := n + 1;

  -- 11 conto con movimenti non eliminabile
  begin delete from public.accounts where id = acc; ok := false;
  exception when others then ok := true; end;
  if not ok or not exists (select 1 from public.accounts where id = acc) then raise exception 'FAIL eliminato conto con movimenti'; end if; n := n + 1;

  -- come B
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated','email','fb@test.local')::text, true);
  execute 'set local role authenticated';
  perform public.create_starter_categories(sb);
  select id into expb from public.categories where space_id = sb and name = 'Spesa alimentare';
  insert into public.accounts(space_id, name) values (sb,'Conto B') returning id into accb;

  -- 10 isolamento
  if exists (select 1 from public.accounts where space_id = sa) then raise exception 'FAIL B vede conti di A'; end if; n := n + 1;
  if exists (select 1 from public.transactions where space_id = sa) then raise exception 'FAIL B vede movimenti di A'; end if; n := n + 1;
  if exists (select 1 from public.categories where space_id = sa) then raise exception 'FAIL B vede categorie di A'; end if; n := n + 1;
  if exists (select 1 from public.account_balances where space_id = sa) then raise exception 'FAIL B vede saldi di A'; end if; n := n + 1;
  if exists (select 1 from public.transaction_revisions where space_id = sa) then raise exception 'FAIL B vede storico di A'; end if; n := n + 1;
  update public.transactions set amount_cents = 1 where id = t1;
  update public.accounts set name = 'hack' where id = acc;
  delete from public.accounts where id = acc;
  begin insert into public.transactions(space_id, account_id, category_id, direction, amount_cents, occurred_on) values (sa,acc,exp,'outflow',100,'2026-11-03'); ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL B scrive nello spazio di A'; end if; n := n + 1;

  -- 9 conto di un altro spazio
  begin insert into public.transactions(space_id, account_id, category_id, direction, amount_cents, occurred_on) values (sb,acc,expb,'outflow',100,'2026-11-03'); ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL movimento su conto di altro spazio'; end if; n := n + 1;
  begin insert into public.transactions(space_id, account_id, category_id, direction, amount_cents, occurred_on) values (sb,accb,exp,'outflow',100,'2026-11-03'); ok := false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL movimento con categoria di altro spazio'; end if; n := n + 1;

  -- conto vuoto eliminabile
  delete from public.accounts where id = accb;
  if exists (select 1 from public.accounts where id = accb) then raise exception 'FAIL conto vuoto non eliminabile'; end if; n := n + 1;

  execute 'reset role';
  if (select amount_cents from public.transactions where id = t1) <> 250000 or (select name from public.accounts where id = acc) <> 'Conto test rinominato' then
    raise exception 'FAIL B ha modificato dati di A'; end if; n := n + 1;

  -- anonimo
  perform set_config('request.jwt.claims', '{"role":"anon"}', true);
  execute 'set local role anon';
  begin perform 1 from public.accounts; ok := false; exception when others then ok := true; end;
  if not ok then raise exception 'FAIL anonimo legge conti'; end if; n := n + 1;
  execute 'reset role';

  raise exception 'ALL_PASSED: % controlli', n;
end $$;
