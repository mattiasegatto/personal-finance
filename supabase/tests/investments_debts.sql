-- Test di integrità e isolamento per investimenti e debiti.
-- Dati fittizi, transazione annullata; marker finale intenzionalmente emesso come eccezione.
do $$
declare
  ua uuid := '00000000-0000-0000-0000-0000000000e1';
  ub uuid := '00000000-0000-0000-0000-0000000000f1';
  sa uuid; sb uuid; shared_id uuid;
  iid uuid; did uuid; n int := 0; ok boolean;
begin
  insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
   (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','fe@test.local','{"display_name":"E"}',now(),now()),
   (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','ff@test.local','{"display_name":"F"}',now(),now());
  select id into sa from public.spaces where created_by=ua and kind='personal';
  select id into sb from public.spaces where created_by=ub and kind='personal';
  if sa is null or sb is null then raise exception 'FAIL spazi personali'; end if;

  perform set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated','email','fe@test.local')::text,true);
  execute 'set local role authenticated';

  insert into public.investments(space_id,name,type,ticker,currency,quantity,invested_amount_cents,current_value_cents,valuation_date)
  values(sa,'ETF Globale','etf','VWCE','EUR',12.5,120000,135000,'2026-11-12') returning id into iid;
  if not exists(select 1 from public.investments where id=iid and created_by=ua and current_value_cents=135000) then raise exception 'FAIL inserimento investimento'; end if; n:=n+1;

  insert into public.financial_debts(space_id,name,lender,type,currency,original_principal_cents,outstanding_balance_cents,annual_interest_rate,monthly_payment_cents,started_on,due_on)
  values(sa,'Prestito auto','Banca test','loan','EUR',1000000,650000,4.25,25000,'2024-01-01','2028-12-31') returning id into did;
  if not exists(select 1 from public.financial_debts where id=did and created_by=ua and outstanding_balance_cents=650000) then raise exception 'FAIL inserimento debito'; end if; n:=n+1;

  if not exists(select 1 from public.net_worth_totals where space_id=sa and currency='EUR' and component='investment' and amount_cents=135000)
    or not exists(select 1 from public.net_worth_totals where space_id=sa and currency='EUR' and component='debt' and amount_cents=650000) then
    raise exception 'FAIL aggregati patrimonio'; end if; n:=n+1;

  update public.investments set current_value_cents=140000,valuation_date='2026-11-13' where id=iid;
  update public.financial_debts set outstanding_balance_cents=600000 where id=did;
  if (select amount_cents from public.net_worth_totals where space_id=sa and component='investment')<>140000
    or (select amount_cents from public.net_worth_totals where space_id=sa and component='debt')<>600000 then
    raise exception 'FAIL aggiornamento valori correnti'; end if; n:=n+1;

  begin update public.financial_debts set outstanding_balance_cents=-1 where id=did; ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL residuo negativo accettato'; end if; n:=n+1;
  begin insert into public.investments(space_id,name,current_value_cents,currency) values(sa,'Valore negativo',-1,'EUR'); ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL valore investimento negativo accettato'; end if; n:=n+1;

  begin update public.investments set space_id=sb where id=iid; ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL cambio spazio investimento'; end if; n:=n+1;
  begin update public.financial_debts set created_by=ub where id=did; ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL cambio creatore debito'; end if; n:=n+1;

  -- Un utente non può leggere né modificare i dati finanziari dell'altro.
  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',ub,'role','authenticated','email','ff@test.local')::text,true);
  execute 'set local role authenticated';
  if exists(select 1 from public.investments where id=iid) or exists(select 1 from public.financial_debts where id=did)
    or exists(select 1 from public.net_worth_totals where space_id=sa) then raise exception 'FAIL isolamento lettura'; end if; n:=n+1;
  update public.investments set name='Accesso non autorizzato' where id=iid;
  if (select name from public.investments where id=iid) is not null then raise exception 'FAIL isolamento scrittura'; end if; n:=n+1;

  execute 'reset role';
  raise exception 'ALL_PASSED: % controlli',n;
end $$;
