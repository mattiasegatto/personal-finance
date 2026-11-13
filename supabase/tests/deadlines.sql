begin;
do $$
declare u uuid:=gen_random_uuid(); s uuid; a uuid; c uuid; subc uuid; d uuid; tx uuid;
begin
 insert into auth.users(id,aud,role,email,encrypted_password,email_confirmed_at,raw_app_meta_data,raw_user_meta_data,created_at,updated_at)
 values(u,'authenticated','authenticated',u::text||'@example.test','',now(),'{}','{}',now(),now());
 perform set_config('request.jwt.claim.sub',u::text,true);
 perform set_config('request.jwt.claim.role','authenticated',true);
 select id into s from public.spaces where created_by=u and kind='personal';
 insert into public.accounts(space_id,name,type,currency) values(s,'Conto scadenze','checking','EUR') returning id into a;
 insert into public.categories(space_id,kind,name) values(s,'expense','Scadenze test') returning id into c;
 insert into public.categories(space_id,parent_id,name) values(s,c,'Sottocategoria scadenze') returning id into subc;
 insert into public.deadlines(space_id,account_id,category_id,direction,amount_cents,title,due_on)
 values(s,a,subc,'outflow',4567,'Bolletta test',current_date) returning id into d;
 begin
   update public.accounts set archived_at=now() where id=a;
   raise exception 'TEST_FAILURE_ACCOUNT_ARCHIVE_WAS_ALLOWED';
 exception when others then
   if sqlerrm = 'TEST_FAILURE_ACCOUNT_ARCHIVE_WAS_ALLOWED' then raise; end if;
   if sqlerrm not like '%scadenza aperta%' then raise; end if;
 end;
 begin
   update public.categories set archived_at=now() where id=c;
   raise exception 'TEST_FAILURE_CATEGORY_ARCHIVE_WAS_ALLOWED';
 exception when others then
   if sqlerrm = 'TEST_FAILURE_CATEGORY_ARCHIVE_WAS_ALLOWED' then raise; end if;
   if sqlerrm not like '%scadenza aperta%' then raise; end if;
 end;
 begin
   update public.categories set archived_at=now() where id=c;
   raise exception 'TEST_FAILURE_PARENT_CATEGORY_ARCHIVE_WAS_ALLOWED';
 exception when others then
   if sqlerrm = 'TEST_FAILURE_PARENT_CATEGORY_ARCHIVE_WAS_ALLOWED' then raise; end if;
   if sqlerrm not like '%scadenza aperta%' then raise; end if;
 end;
 tx:=public.complete_deadline(d);
 if not exists(select 1 from public.transactions where id=tx and amount_cents=4567) then raise exception 'Movimento non creato'; end if;
 if (select status from public.deadlines where id=d)<>'completed' then raise exception 'Scadenza non completata'; end if;
 begin
   perform public.complete_deadline(d);
   raise exception 'Doppio completamento non rifiutato';
 exception when others then
   if sqlerrm not like '%non è più da completare%' then raise; end if;
 end;
 update public.categories set archived_at=now() where id=c;
 begin
   insert into public.deadlines(space_id,account_id,category_id,direction,amount_cents,title,due_on)
   values(s,a,subc,'outflow',4567,'Scadenza con padre archiviato',current_date);
   raise exception 'TEST_FAILURE_DEADLINE_UNDER_ARCHIVED_PARENT_WAS_ALLOWED';
 exception when others then
   if sqlerrm = 'TEST_FAILURE_DEADLINE_UNDER_ARCHIVED_PARENT_WAS_ALLOWED' then raise; end if;
   if sqlerrm not like '%categoria padre è archiviata%' then raise; end if;
 end;
 raise exception 'ALL_PASSED: riferimenti aperti protetti, padre categoria protetto, scadenza completata e doppia conferma bloccata';
end $$;
rollback;
