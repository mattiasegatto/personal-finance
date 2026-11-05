-- Test di autorizzazione e isolamento. Eseguito in una transazione annullata: non lascia dati.
-- Ogni controllo che fallisce interrompe lo script con un errore "FAIL: ...".
begin;

create temp table _r(test text, ok boolean) on commit drop;
grant all on _r to authenticated, anon;

insert into auth.users(id, instance_id, aud, role, email, raw_user_meta_data, created_at, updated_at)
values
 ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-000000000000','authenticated','authenticated','a@test.local','{"display_name":"Utente A"}',now(),now()),
 ('00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-000000000000','authenticated','authenticated','b@test.local','{"display_name":"Utente B"}',now(),now()),
 ('00000000-0000-0000-0000-00000000000c','00000000-0000-0000-0000-000000000000','authenticated','authenticated','c@test.local','{"display_name":"Utente C"}',now(),now());

create or replace function pg_temp.as_user(_id uuid, _email text) returns void language plpgsql as $$
begin
  perform set_config('role','authenticated',true);
  perform set_config('request.jwt.claims', json_build_object('sub',_id,'email',_email,'role','authenticated')::text, true);
end $$;
create or replace function pg_temp.check(_name text, _ok boolean) returns void language plpgsql as $$
begin insert into _r values (_name, _ok); if not _ok then raise exception 'FAIL: %', _name; end if; end $$;
create or replace function pg_temp.fails(_sql text) returns boolean language plpgsql as $$
begin execute _sql; return false; exception when others then return true; end $$;

-- 1. Registrazione crea profilo e spazio personale
reset role;
select pg_temp.check('registrazione: 3 spazi personali', (select count(*) from public.spaces where kind='personal' and created_by in ('00000000-0000-0000-0000-00000000000a','00000000-0000-0000-0000-00000000000b','00000000-0000-0000-0000-00000000000c')) = 3);

-- 2. A crea uno spazio condiviso e invita B come member e C come viewer
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','a@test.local');
create temp table _ids as select public.create_shared_space('Casa test') as sid;
select public.invite_to_space((select sid from _ids), 'b@test.local', 'member');
select public.invite_to_space((select sid from _ids), 'c@test.local', 'viewer');
select pg_temp.check('A vede solo personale + condiviso', (select count(*) from public.spaces) = 2);
select pg_temp.check('spazio personale rifiuta inviti', pg_temp.fails($$select public.invite_to_space((select id from public.spaces where kind='personal'),'b@test.local','member')$$));
select pg_temp.check('nessun invito come owner', pg_temp.fails($$select public.invite_to_space((select sid from _ids),'x@test.local','owner')$$));
select pg_temp.check('spazio personale non archiviabile', pg_temp.fails($$update public.spaces set archived_at=now() where kind='personal'$$));
select pg_temp.check('tipo spazio immutabile', pg_temp.fails($$update public.spaces set kind='personal' where id=(select sid from _ids)$$));

-- 3. B prima di accettare: non vede lo spazio condiviso né quello personale di A
select pg_temp.as_user('00000000-0000-0000-0000-00000000000b','b@test.local');
select pg_temp.check('B vede solo il proprio spazio prima di accettare', (select count(*) from public.spaces) = 1);
select pg_temp.check('B vede il proprio invito', (select count(*) from public.space_invitations) = 1);
select pg_temp.check('B non può accettare invito altrui', pg_temp.fails($$select public.accept_invitation((select id from public.space_invitations where email='c@test.local'))$$) );
select public.accept_invitation((select id from public.space_invitations where email='b@test.local'));
select pg_temp.check('B ora vede personale + condiviso', (select count(*) from public.spaces) = 2);
select pg_temp.check('B NON vede lo spazio personale di A', (select count(*) from public.spaces where kind='personal' and created_by='00000000-0000-0000-0000-00000000000a') = 0);
select pg_temp.check('B NON vede le appartenenze personali di A', (select count(*) from public.space_memberships where user_id='00000000-0000-0000-0000-00000000000a') = 1);
select pg_temp.check('B vede il nome di A (spazio condiviso)', (select count(*) from public.profiles) = 2);
-- tentativi di scrittura sullo spazio personale di A: 0 righe toccate
with u as (update public.spaces set name='hack' where kind='personal' and created_by='00000000-0000-0000-0000-00000000000a' returning 1)
select pg_temp.check('B non può rinominare lo spazio personale di A', (select count(*) from u) = 0);
select pg_temp.check('B non può entrare nello spazio personale di A', pg_temp.fails($$insert into public.space_memberships(space_id,user_id,role) select id,'00000000-0000-0000-0000-00000000000b','member' from public.spaces limit 1$$));
-- member non gestisce persone
with u as (update public.space_memberships set role='owner' where user_id='00000000-0000-0000-0000-00000000000b' returning 1)
select pg_temp.check('member non si promuove owner', (select count(*) from u) = 0);
with d as (delete from public.space_memberships where user_id='00000000-0000-0000-0000-00000000000a' returning 1)
select pg_temp.check('member non rimuove owner', (select count(*) from d) = 0);
select pg_temp.check('member non invita', pg_temp.fails($$select public.invite_to_space((select sid from _ids),'z@test.local','member')$$));
with u as (update public.spaces set name='x' where id=(select sid from _ids) returning 1)
select pg_temp.check('member non rinomina lo spazio condiviso', (select count(*) from u) = 0);
with u as (update public.profiles set display_name='x' where id='00000000-0000-0000-0000-00000000000a' returning 1)
select pg_temp.check('B non modifica il profilo di A', (select count(*) from u) = 0);
select pg_temp.check('B non esce dal proprio spazio personale', pg_temp.fails($$delete from public.space_memberships where user_id='00000000-0000-0000-0000-00000000000b' and space_id=(select id from public.spaces where kind='personal')$$));

-- 4. C accetta come viewer: non modifica nulla
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c','c@test.local');
select public.accept_invitation((select id from public.space_invitations where email='c@test.local'));
with u as (update public.spaces set name='x' where id=(select sid from _ids) returning 1)
select pg_temp.check('viewer non modifica lo spazio', (select count(*) from u) = 0);
select pg_temp.check('viewer non vede spazi personali altrui', (select count(*) from public.spaces where kind='personal') = 1);

-- 5. Owner: ultimo owner protetto
select pg_temp.as_user('00000000-0000-0000-0000-00000000000a','a@test.local');
select pg_temp.check('ultimo owner non può uscire', pg_temp.fails($$delete from public.space_memberships where user_id='00000000-0000-0000-0000-00000000000a' and space_id=(select sid from _ids)$$));
select pg_temp.check('ultimo owner non può declassarsi', pg_temp.fails($$update public.space_memberships set role='member' where user_id='00000000-0000-0000-0000-00000000000a' and space_id=(select sid from _ids)$$));
with d as (delete from public.space_memberships where user_id='00000000-0000-0000-0000-00000000000c' returning 1)
select pg_temp.check('owner rimuove il viewer', (select count(*) from d) = 1);

-- 6. Dopo la rimozione, C perde accesso
select pg_temp.as_user('00000000-0000-0000-0000-00000000000c','c@test.local');
select pg_temp.check('C rimosso non vede più lo spazio condiviso', (select count(*) from public.spaces) = 1);
select pg_temp.check('C rimosso non vede più i profili di A e B', (select count(*) from public.profiles) = 1);

-- 7. Anonimo: nessun accesso
reset role;
set local role anon;
select pg_temp.check('anonimo non legge spazi', pg_temp.fails($$select count(*) from public.spaces$$));
select pg_temp.check('anonimo non crea spazi', pg_temp.fails($$select public.create_shared_space('x')$$));

reset role;
select json_agg(json_build_object('test',test,'ok',ok)) as risultati, count(*) filter (where ok) as superati, count(*) as totali from _r;
rollback;
