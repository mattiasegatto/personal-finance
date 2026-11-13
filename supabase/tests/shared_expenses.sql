-- Integrità, autorizzazioni e collegamenti delle spese condivise.
do $$
declare
  ua uuid := '00000000-0000-0000-0000-0000000000a1';
  ub uuid := '00000000-0000-0000-0000-0000000000b1';
  sa uuid; sb uuid; sh uuid; cat_id uuid; personal_cat uuid; account_id uuid;
  tx_id uuid; v_expense_id uuid; settlement_id uuid; ok boolean; n int := 0;
begin
  insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at) values
   (ua,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','shared-a@test.local','{"display_name":"A"}',now(),now()),
   (ub,'00000000-0000-0000-0000-000000000000','authenticated','authenticated','shared-b@test.local','{"display_name":"B"}',now(),now());
  select id into sa from public.spaces where created_by=ua and kind='personal';
  select id into sb from public.spaces where created_by=ub and kind='personal';
  if sa is null or sb is null then raise exception 'FAIL spazi personali test'; end if;

  perform set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated','email','shared-a@test.local')::text,true);
  execute 'set local role authenticated';
  sh := public.create_shared_space('Spese test');
  execute 'reset role';
  insert into public.space_memberships(space_id,user_id,role) values(sh,ub,'member');

  perform set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated','email','shared-a@test.local')::text,true);
  execute 'set local role authenticated';
  insert into public.categories(space_id,kind,name) values(sh,'expense','Spese comuni') returning id into cat_id;
  insert into public.categories(space_id,parent_id,name) values(sh,cat_id,'Alimentari') returning id into cat_id;
  if not exists(select 1 from public.categories where id=cat_id and space_id=sh) then raise exception 'FAIL categoria condivisa'; end if; n:=n+1;

  insert into public.accounts(space_id,name,type,currency) values(sa,'Conto test','checking','EUR') returning id into account_id;
  insert into public.categories(space_id,kind,name) values(sa,'expense','Spese test') returning id into personal_cat;
  insert into public.transactions(space_id,account_id,category_id,direction,amount_cents,occurred_on,description)
  values(sa,account_id,personal_cat,'outflow',10000,current_date,'Spesa collegabile') returning id into tx_id;

  v_expense_id := public.save_shared_expense(null,sh,current_date,'Spesa comune',cat_id,10000,ua,'equal',
    jsonb_build_array(jsonb_build_object('member_user_id',ua,'amount_cents',5000),jsonb_build_object('member_user_id',ub,'amount_cents',5000)),tx_id);
  if not exists(select 1 from public.shared_expenses where id=v_expense_id and linked_transaction_id=tx_id)
    or (select sum(amount_cents) from public.shared_expense_shares where shared_expense_shares.expense_id=v_expense_id)<>10000 then
    raise exception 'FAIL salvataggio spesa e quote'; end if; n:=n+1;

  begin
    update public.transactions set amount_cents=9999 where id=tx_id;
    ok:=false;
  exception when others then
    ok:=true;
  end;
  if not ok or (select amount_cents from public.transactions where id=tx_id)<>10000 then
    raise exception 'FAIL modifica importo movimento collegato'; end if; n:=n+1;

  begin
    update public.transactions set deleted_at=now() where id=tx_id;
    ok:=false;
  exception when others then
    ok:=true;
  end;
  if not ok or (select deleted_at from public.transactions where id=tx_id) is not null then
    raise exception 'FAIL eliminazione movimento collegato'; end if; n:=n+1;

  begin
    perform public.save_shared_settlement(null,sh,current_date,ua,ub,10000,'rimborso','Doppio collegamento',tx_id);
    ok:=false;
  exception when others then
    ok:=true;
  end;
  if not ok or exists(select 1 from public.shared_settlements where note='Doppio collegamento') then
    raise exception 'FAIL movimento collegato contemporaneamente a spesa e rimborso'; end if; n:=n+1;

  begin
    perform public.save_shared_expense(null,sh,current_date,'Importi errati',cat_id,10000,ua,'amount',
      jsonb_build_array(jsonb_build_object('member_user_id',ua,'amount_cents',4000),jsonb_build_object('member_user_id',ub,'amount_cents',5000)),null);
    ok:=false;
  exception when others then ok:=true; end;
  if not ok or exists(select 1 from public.shared_expenses where description='Importi errati') then
    raise exception 'FAIL quote non coerenti accettate'; end if; n:=n+1;

  begin
    perform public.save_shared_expense(v_expense_id,sh,current_date,'Cambio pagatore',cat_id,10000,ub,'equal',
      jsonb_build_array(jsonb_build_object('member_user_id',ua,'amount_cents',5000),jsonb_build_object('member_user_id',ub,'amount_cents',5000)),tx_id);
    ok:=false;
  exception when others then ok:=true; end;
  if not ok then raise exception 'FAIL cambio pagatore con movimento collegato'; end if; n:=n+1;

  perform public.unlink_shared_expense_transaction(v_expense_id);
  perform public.save_shared_expense(v_expense_id,sh,current_date,'Cambio pagatore',cat_id,10000,ub,'equal',
    jsonb_build_array(jsonb_build_object('member_user_id',ua,'amount_cents',5000),jsonb_build_object('member_user_id',ub,'amount_cents',5000)),null);
  if (select paid_by_user_id from public.shared_expenses where id=v_expense_id)<>ub then raise exception 'FAIL cambio pagatore dopo unlink'; end if; n:=n+1;

  settlement_id := public.save_shared_settlement(null,sh,current_date,ub,ua,2500,'rimborso','Rimborso test',null);
  if not exists(select 1 from public.shared_settlements where id=settlement_id and amount_cents=2500) then
    raise exception 'FAIL salvataggio rimborso'; end if; n:=n+1;

  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',ub,'role','authenticated','email','shared-b@test.local')::text,true);
  execute 'set local role authenticated';
  if not exists(select 1 from public.shared_expenses where id=v_expense_id)
    or not exists(select 1 from public.shared_expense_shares where shared_expense_shares.expense_id=v_expense_id)
    or not exists(select 1 from public.shared_settlements where id=settlement_id) then
    raise exception 'FAIL membro non legge dati condivisi'; end if; n:=n+1;
  if exists(select 1 from public.transactions where id=tx_id) then raise exception 'FAIL membro vede movimento personale altrui'; end if; n:=n+1;
  begin
    update public.shared_expenses set description='Tentativo modifica' where id=v_expense_id;
    ok:=false;
  exception when insufficient_privilege then
    ok:=true;
  end;
  if not ok or (select description from public.shared_expenses where id=v_expense_id)<>'Cambio pagatore' then
    raise exception 'FAIL membro non autorizzato a modificare la spesa'; end if; n:=n+1;

  execute 'reset role';
  perform set_config('request.jwt.claims',json_build_object('sub',ua,'role','authenticated','email','shared-a@test.local')::text,true);
  execute 'set local role authenticated';
  perform public.delete_shared_expense(v_expense_id);
  if not exists(select 1 from public.shared_expenses where id=v_expense_id and deleted_at is not null) then
    raise exception 'FAIL annullamento spesa'; end if; n:=n+1;
  execute 'reset role';
  raise exception 'ALL_PASSED: % controlli',n;
end $$;
