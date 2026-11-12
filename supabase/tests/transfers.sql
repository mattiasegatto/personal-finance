-- Test dei trasferimenti personali. Dati fittizi, transazione annullata.
-- Al successo termina con l'errore intenzionale "ALL_PASSED: N controlli".
do $$
declare
  ua uuid := '00000000-0000-0000-0000-0000000000c1';
  ub uuid := '00000000-0000-0000-0000-0000000000d1';
  sa uuid; sb uuid;
  a1 uuid; a2 uuid; a3 uuid; b1 uuid;
  tid uuid; stx uuid; dtx uuid;
  v1 bigint; v2 bigint; n int := 0; ok boolean;
begin
  insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
   (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fc@test.local','{"display_name":"C"}',now(),now()),
   (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fd@test.local','{"display_name":"D"}',now(),now());
  select id into sa from public.spaces where created_by = ua and kind = 'personal';
  select id into sb from public.spaces where created_by = ub and kind = 'personal';
  if sa is null or sb is null then raise exception 'FAIL spazi personali non creati'; end if;

  perform set_config('request.jwt.claims', json_build_object('sub',ua,'role','authenticated','email','fc@test.local')::text, true);
  execute 'set local role authenticated';

  insert into public.accounts(space_id,name,initial_balance_cents) values
    (sa,'Sorgente',100000),(sa,'Destinazione',20000),(sa,'Valuta diversa',0)
    returning id into a1;
  select id into a2 from public.accounts where space_id=sa and name='Destinazione';
  select id into a3 from public.accounts where space_id=sa and name='Valuta diversa';
  update public.accounts set currency='USD' where id=a3;
  insert into public.accounts(space_id,name) values (sb,'Conto B') returning id into b1;

  -- 1 creazione e due gambe coerenti
  tid := public.create_transfer(a1,a2,25000,'2026-11-10','Giroconto test');
  select source_transaction_id,destination_transaction_id into stx,dtx from public.transfers where id=tid;
  if stx is null or dtx is null or stx=dtx then raise exception 'FAIL gambe mancanti o duplicate'; end if; n:=n+1;
  if (select count(*) from public.transfer_transaction_links where transfer_id=tid) <> 2 then raise exception 'FAIL collegamenti'; end if; n:=n+1;
  if not exists(select 1 from public.transactions where id=stx and operation_type='transfer' and direction='outflow' and account_id=a1 and amount_cents=25000 and category_id is null and occurred_on='2026-11-10' and description='Giroconto test')
     or not exists(select 1 from public.transactions where id=dtx and operation_type='transfer' and direction='inflow' and account_id=a2 and amount_cents=25000 and category_id is null and occurred_on='2026-11-10' and description='Giroconto test') then
    raise exception 'FAIL contenuto delle gambe'; end if; n:=n+1;
  select balance_cents into v1 from public.account_balances where account_id=a1;
  select balance_cents into v2 from public.account_balances where account_id=a2;
  if v1<>75000 or v2<>45000 then raise exception 'FAIL saldi dopo creazione: %, %',v1,v2; end if; n:=n+1;

  -- 2 modifica atomica: importo, data, descrizione
  perform public.update_transfer(tid,a1,a2,30000,'2026-11-11','Giroconto aggiornato');
  select balance_cents into v1 from public.account_balances where account_id=a1;
  select balance_cents into v2 from public.account_balances where account_id=a2;
  if v1<>70000 or v2<>50000 then raise exception 'FAIL saldi dopo modifica: %, %',v1,v2; end if; n:=n+1;
  if not exists(select 1 from public.transactions where id=stx and amount_cents=30000 and occurred_on='2026-11-11' and description='Giroconto aggiornato')
     or not exists(select 1 from public.transactions where id=dtx and amount_cents=30000 and occurred_on='2026-11-11' and description='Giroconto aggiornato') then
    raise exception 'FAIL modifica non propagata a entrambe le gambe'; end if; n:=n+1;

  -- 3 errore durante modifica: nessuna variazione parziale
  begin
    perform public.update_transfer(tid,a1,a3,40000,'2026-11-12','Non valido');
    ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL valuta diversa accettata'; end if; n:=n+1;
  if (select amount_cents from public.transfers where id=tid)<>30000
     or (select amount_cents from public.transactions where id=stx)<>30000
     or (select amount_cents from public.transactions where id=dtx)<>30000 then
    raise exception 'FAIL modifica fallita non atomica'; end if; n:=n+1;

  -- 4 regole di validazione in creazione
  begin perform public.create_transfer(a1,a1,100,'2026-11-12',null); ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL stesso conto accettato'; end if; n:=n+1;
  begin perform public.create_transfer(a1,a3,100,'2026-11-12',null); ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL valute diverse accettate'; end if; n:=n+1;
  begin perform public.create_transfer(a1,b1,100,'2026-11-12',null); ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL conto di altro spazio accettato'; end if; n:=n+1;

  -- 5 scritture dirette e cancellazione fisica impedite
  begin
    insert into public.transactions(space_id,account_id,category_id,operation_type,direction,amount_cents,occurred_on)
    values(sa,a1,null,'transfer','outflow',100,'2026-11-12');
    ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL gamba transfer diretta accettata'; end if; n:=n+1;
  begin update public.transfers set description='Modifica diretta' where id=tid; ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL modifica diretta testata accettata'; end if; n:=n+1;
  begin delete from public.transfers where id=tid; ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL cancellazione fisica accettata'; end if; n:=n+1;

  -- 6 annullamento logico di entrambe le gambe e ripristino saldi
  perform public.delete_transfer(tid);
  if (select deleted_at from public.transfers where id=tid) is null
     or (select deleted_at from public.transactions where id=stx) is null
     or (select deleted_at from public.transactions where id=dtx) is null then
    raise exception 'FAIL annullamento incompleto'; end if; n:=n+1;
  select balance_cents into v1 from public.account_balances where account_id=a1;
  select balance_cents into v2 from public.account_balances where account_id=a2;
  if v1<>100000 or v2<>20000 then raise exception 'FAIL saldi dopo annullamento: %, %',v1,v2; end if; n:=n+1;
  begin perform public.delete_transfer(tid); ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL doppio annullamento accettato'; end if; n:=n+1;

  -- 7 ordinari: la categoria resta obbligatoria
  begin
    insert into public.transactions(space_id,account_id,category_id,direction,amount_cents,occurred_on)
    values(sa,a1,null,'outflow',100,'2026-11-12');
    ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL movimento ordinario senza categoria accettato'; end if; n:=n+1;

  -- 8 isolamento utente B su testate, collegamenti e gambe
  execute 'reset role';
  perform set_config('request.jwt.claims', json_build_object('sub',ub,'role','authenticated','email','fd@test.local')::text, true);
  execute 'set local role authenticated';
  if exists(select 1 from public.transfers where id=tid) then raise exception 'FAIL B vede trasferimento A'; end if; n:=n+1;
  if exists(select 1 from public.transfer_transaction_links where transfer_id=tid) then raise exception 'FAIL B vede collegamenti A'; end if; n:=n+1;
  if exists(select 1 from public.transactions where id in (stx,dtx)) then raise exception 'FAIL B vede gambe A'; end if; n:=n+1;
  begin perform public.delete_transfer(tid); ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL B annulla trasferimento A'; end if; n:=n+1;

  execute 'reset role';
  raise exception 'ALL_PASSED: % controlli',n;
end $$;
