-- Recurring item integrity and confirmation tests
begin;
do $$
declare u uuid := gen_random_uuid(); v uuid := gen_random_uuid(); s uuid; a uuid; c uuid; r uuid; tx uuid; d date := current_date;
begin
  insert into auth.users(id, aud, role, email, encrypted_password, email_confirmed_at, raw_app_meta_data, raw_user_meta_data, created_at, updated_at)
  values (u,'authenticated','authenticated',u::text||'@example.test','',now(),'{}','{}',now(),now());
  perform set_config('request.jwt.claim.sub',u::text,true);
  perform set_config('request.jwt.claim.role','authenticated',true);
  select id into s from public.spaces where created_by=u and kind='personal';
  insert into public.accounts(space_id,name,type,currency) values(s,'Test conto','checking','EUR') returning id into a;
  insert into public.categories(space_id,kind,name) values(s,'expense','Test spese') returning id into c;
  insert into public.recurring_items(space_id,account_id,category_id,direction,amount_cents,description,frequency,start_on,next_due_on)
  values(s,a,c,'outflow',1234,'Test mensile','monthly',d,d) returning id into r;
  if public.next_recurring_date(date '2026-01-31', date '2026-01-31', 'monthly') <> date '2026-02-28'
     or public.next_recurring_date(date '2026-01-31', date '2026-02-28', 'monthly') <> date '2026-03-31' then
    raise exception 'Ricorrenza mensile non conserva il giorno originario a fine mese';
  end if;
  if public.next_recurring_date(date '2024-02-29', date '2024-02-29', 'yearly') <> date '2025-02-28'
     or public.next_recurring_date(date '2024-02-29', date '2025-02-28', 'yearly') <> date '2026-02-28'
     or public.next_recurring_date(date '2024-02-29', date '2027-02-28', 'yearly') <> date '2028-02-29' then
    raise exception 'Ricorrenza annuale non gestisce correttamente gli anni bisestili';
  end if;
  tx := public.confirm_recurring_item(r,d);
  if not exists(select 1 from public.transactions where id=tx and amount_cents=1234 and occurred_on=d) then
    raise exception 'Movimento non creato correttamente';
  end if;
  if (select next_due_on from public.recurring_items where id=r) <> public.next_recurring_date(d, d, 'monthly') then
    raise exception 'Prossima data non aggiornata';
  end if;
  begin
    perform public.confirm_recurring_item(r,d);
    raise exception 'Era atteso un rifiuto per data non più corrente';
  exception when others then
    if sqlerrm not like '%modificata o disattivata%' then raise; end if;
  end;
  raise exception 'ALL_PASSED: ricorrenza confermata, avanzamento data e doppia conferma bloccata';
end $$;
rollback;
