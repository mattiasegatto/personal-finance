-- Test di integrità e isolamento per conto titoli e operazioni su investimenti.
-- Dati fittizi, transazione annullata; marker finale intenzionalmente emesso come eccezione.
do $$
declare
  ua uuid := '00000000-0000-0000-0000-0000000000a7';
  ub uuid := '00000000-0000-0000-0000-0000000000b7';
  sa uuid; sb uuid;
  checking uuid; broker uuid; broker_usd uuid; broker_b uuid;
  etf uuid; other_inv uuid; usd_inv uuid;
  buy1 uuid; sell1 uuid; tid uuid; fee_cat uuid;
  n int := 0; ok boolean; v bigint;
  inv record;
begin
  insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
   (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ta@test.local','{"display_name":"TA"}',now(),now()),
   (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','tb@test.local','{"display_name":"TB"}',now(),now());
  select id into sa from public.spaces where created_by=ua and kind='personal';
  select id into sb from public.spaces where created_by=ub and kind='personal';

  perform set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated')::text,true);
  execute 'set local role authenticated';

  insert into public.accounts(space_id,name,type,currency,initial_balance_cents)
  values(sa,'Conto corrente','checking','EUR',100000) returning id into checking;
  insert into public.accounts(space_id,name,type,currency,initial_balance_cents)
  values(sa,'Conto titoli','brokerage','EUR',0) returning id into broker;
  insert into public.accounts(space_id,name,type,currency,initial_balance_cents)
  values(sa,'Conto titoli USD','brokerage','USD',0) returning id into broker_usd;
  insert into public.investments(space_id,name,type,currency,invested_amount_cents,current_value_cents)
  values(sa,'ETF Mondo','etf','EUR',0,0) returning id into etf;
  insert into public.investments(space_id,name,type,currency,invested_amount_cents,current_value_cents)
  values(sa,'Altro ETF','etf','EUR',0,0) returning id into other_inv;

  -- 1. I 200 euro mensili vanno sul conto titoli con un normale trasferimento.
  perform public.create_transfer(checking, broker, 20000, '2026-11-01', 'Versamento mensile');
  select balance_cents into v from public.account_balances where account_id=broker;
  if v <> 20000 then raise exception 'FAIL saldo conto titoli dopo trasferimento: %', v; end if; n:=n+1;

  -- 2. Acquisto: 180 euro per 2 quote; i 20 restanti restano liquidità del conto titoli.
  buy1 := public.record_investment_trade(etf, broker, 'buy', 18000, 2, '2026-11-02', null);
  select balance_cents into v from public.account_balances where account_id=broker;
  if v <> 2000 then raise exception 'FAIL liquidità residua del conto titoli: %', v; end if; n:=n+1;
  select * into inv from public.investments where id=etf;
  if inv.invested_amount_cents <> 18000 or inv.current_value_cents <> 18000 or inv.quantity <> 2 or inv.account_id <> broker then
    raise exception 'FAIL investimento dopo acquisto: % % % %', inv.invested_amount_cents, inv.current_value_cents, inv.quantity, inv.account_id;
  end if; n:=n+1;
  select transaction_id into tid from public.investment_trades where id=buy1;
  if not exists(select 1 from public.transactions where id=tid and operation_type='investment' and category_id is null
                and direction='outflow' and amount_cents=18000 and description='Acquisto ETF Mondo') then
    raise exception 'FAIL movimento di acquisto'; end if; n:=n+1;
  if exists(select 1 from public.transactions where space_id=sa and operation_type='ordinary') then
    raise exception 'FAIL trasferimento o acquisto registrati come entrata/uscita'; end if; n:=n+1;

  -- 3. Le commissioni sono una normale spesa sul conto titoli.
  select c.id into fee_cat from public.categories c where c.space_id=sa and c.name='Commissioni bancarie';
  insert into public.transactions(space_id,account_id,category_id,direction,amount_cents,occurred_on,description)
  values(sa,broker,fee_cat,'outflow',150,'2026-11-02','Commissione acquisto');
  select balance_cents into v from public.account_balances where account_id=broker;
  if v <> 1850 then raise exception 'FAIL commissione sul conto titoli: %', v; end if; n:=n+1;

  -- 4. Rivalutazione manuale, poi vendita di metà delle quote a 120 euro.
  update public.investments set current_value_cents=22000, valuation_date='2026-11-10' where id=etf;
  sell1 := public.record_investment_trade(etf, broker, 'sell', 12000, 1, '2026-11-11', null);
  select * into inv from public.investments where id=etf;
  if inv.quantity <> 1 or inv.invested_amount_cents <> 9000 or inv.current_value_cents <> 11000 then
    raise exception 'FAIL vendita proporzionale: % % %', inv.quantity, inv.invested_amount_cents, inv.current_value_cents;
  end if; n:=n+1;
  if not exists(select 1 from public.investment_trades where id=sell1 and invested_delta_cents=9000 and value_delta_cents=11000) then
    raise exception 'FAIL costo e valore ceduti registrati'; end if; n:=n+1;
  select balance_cents into v from public.account_balances where account_id=broker;
  if v <> 13850 then raise exception 'FAIL incasso della vendita: %', v; end if; n:=n+1;

  -- 5. Validazioni.
  begin perform public.record_investment_trade(etf, broker, 'sell', 100, 5, '2026-11-12', null); ok:=false;
  exception when others then ok := sqlerrm like 'Quote insufficienti%'; end;
  if not ok then raise exception 'FAIL vendita oltre le quote possedute'; end if; n:=n+1;
  begin perform public.record_investment_trade(other_inv, checking, 'buy', 100, 1, '2026-11-12', null); ok:=false;
  exception when others then ok := sqlerrm like '%conto titoli%'; end;
  if not ok then raise exception 'FAIL acquisto da un conto non titoli'; end if; n:=n+1;
  begin perform public.record_investment_trade(other_inv, broker_usd, 'buy', 100, 1, '2026-11-12', null); ok:=false;
  exception when others then ok := sqlerrm like '%stessa valuta%'; end;
  if not ok then raise exception 'FAIL acquisto con valuta diversa'; end if; n:=n+1;
  begin perform public.record_investment_trade(etf, broker, 'buy', 0, 1, '2026-11-12', null); ok:=false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL importo nullo accettato'; end if; n:=n+1;
  begin perform public.record_investment_trade(etf, broker, 'buy', 100, 0, '2026-11-12', null); ok:=false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL quantità nulla accettata'; end if; n:=n+1;
  begin update public.investments set account_id=checking where id=other_inv; ok:=false;
  exception when others then ok := sqlerrm like '%solo a un conto titoli%'; end;
  if not ok then raise exception 'FAIL investimento collegato a un conto corrente'; end if; n:=n+1;
  begin update public.investments set account_id=broker_usd where id=etf; ok:=false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL cambio conto titoli con operazioni'; end if; n:=n+1;

  -- 6. Le operazioni passano solo dalla funzione dedicata.
  begin
    insert into public.transactions(space_id,account_id,operation_type,direction,amount_cents,occurred_on)
    values(sa,broker,'investment','outflow',100,'2026-11-12');
    ok:=false;
  exception when others then ok := sqlerrm like '%solo tramite la funzione dedicata%'; end;
  if not ok then raise exception 'FAIL movimento di investimento scritto direttamente'; end if; n:=n+1;
  begin update public.transactions set deleted_at=now() where id=tid; ok:=false;
  exception when others then ok := sqlerrm like '%solo tramite la funzione dedicata%'; end;
  if not ok then raise exception 'FAIL gamba di acquisto eliminata direttamente'; end if; n:=n+1;
  begin update public.transactions set amount_cents=1 where id=tid; ok:=false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL gamba di acquisto modificata direttamente'; end if; n:=n+1;
  begin
    insert into public.investment_trades(space_id,investment_id,account_id,transaction_id,kind,occurred_on,
      amount_cents,quantity,invested_delta_cents,value_delta_cents)
    values(sa,etf,broker,tid,'buy','2026-11-12',1,1,1,1);
    ok:=false;
  exception when insufficient_privilege then ok:=true; end;
  if not ok then raise exception 'FAIL scrittura diretta delle operazioni'; end if; n:=n+1;

  -- 7. Annullamento: solo l'ultima operazione, ripristinando esattamente i valori.
  begin perform public.delete_investment_trade(buy1); ok:=false;
  exception when others then ok := sqlerrm like '%solo l''ultima operazione%'; end;
  if not ok then raise exception 'FAIL annullamento di un''operazione non recente'; end if; n:=n+1;
  perform public.delete_investment_trade(sell1);
  select * into inv from public.investments where id=etf;
  if inv.quantity <> 2 or inv.invested_amount_cents <> 18000 or inv.current_value_cents <> 22000 then
    raise exception 'FAIL ripristino dopo annullamento vendita: % % %', inv.quantity, inv.invested_amount_cents, inv.current_value_cents;
  end if; n:=n+1;
  begin perform public.delete_investment_trade(sell1); ok:=false;
  exception when others then ok := sqlerrm like '%già annullata%'; end;
  if not ok then raise exception 'FAIL doppio annullamento'; end if; n:=n+1;
  perform public.delete_investment_trade(buy1);
  select * into inv from public.investments where id=etf;
  if inv.quantity <> 0 or inv.invested_amount_cents <> 0 or inv.current_value_cents <> 4000 then
    raise exception 'FAIL ripristino dopo annullamento acquisto: % % %', inv.quantity, inv.invested_amount_cents, inv.current_value_cents;
  end if; n:=n+1;
  select balance_cents into v from public.account_balances where account_id=broker;
  if v <> 19850 then raise exception 'FAIL saldo conto titoli dopo gli annullamenti: %', v; end if; n:=n+1;

  -- 8. Isolamento: un altro utente non vede né opera sugli investimenti altrui.
  buy1 := public.record_investment_trade(etf, broker, 'buy', 1000, 1, '2026-11-13', null);
  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',ub,'role','authenticated')::text,true);
  execute 'set local role authenticated';
  insert into public.accounts(space_id,name,type,currency,initial_balance_cents)
  values(sb,'Conto titoli B','brokerage','EUR',0) returning id into broker_b;
  if exists(select 1 from public.investment_trades where space_id=sa) then raise exception 'FAIL lettura operazioni altrui'; end if; n:=n+1;
  begin perform public.record_investment_trade(etf, broker_b, 'buy', 100, 1, '2026-11-13', null); ok:=false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL operazione su investimento altrui'; end if; n:=n+1;
  begin perform public.delete_investment_trade(buy1); ok:=false;
  exception when others then ok := true; end;
  if not ok then raise exception 'FAIL annullamento di operazione altrui'; end if; n:=n+1;
  begin
    insert into public.investments(space_id,name,currency,current_value_cents,account_id)
    values(sb,'Furto conto',  'EUR', 0, broker);
    ok:=false;
  exception when others then ok := sqlerrm like '%altro spazio%'; end;
  if not ok then raise exception 'FAIL investimento collegato al conto titoli altrui'; end if; n:=n+1;

  execute 'reset role';
  raise exception 'ALL_PASSED: % controlli', n;
end $$;
