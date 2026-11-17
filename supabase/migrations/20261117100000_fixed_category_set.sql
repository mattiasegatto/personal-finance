-- Fixed, universal category set.
--
-- Product decision (17/11/2026): every space starts with the same predefined
-- categories and users cannot add, rename, move or archive categories. Each
-- space keeps its own copy of the set so that space isolation is preserved;
-- shared spaces receive only the expense part, because they record only shared
-- expenses. The set changes only through reviewed migrations.

create or replace function public.seed_space_categories(_space uuid)
returns void
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare
  s public.spaces;
  grp record;
  child text;
  root_id uuid;
begin
  select * into s from public.spaces where id = _space;
  if s.id is null or s.archived_at is not null then
    return;
  end if;

  for grp in
    select *
    from (
      values
        (1, 'income'::public.category_kind, 'Entrate', array['Stipendio', 'Altre entrate']),
        (2, 'expense'::public.category_kind, 'Casa', array['Affitto e mutuo', 'Utenze']),
        (3, 'expense'::public.category_kind, 'Vita quotidiana',
          array['Spesa alimentare', 'Trasporti', 'Svago'])
    ) as preset(position, kind, name, children)
    order by position
  loop
    continue when s.kind = 'shared' and grp.kind <> 'expense';

    -- Idempotent: reuse an active root category with the same name.
    select c.id into root_id
    from public.categories c
    where c.space_id = _space
      and c.parent_id is null
      and c.archived_at is null
      and lower(c.name) = lower(grp.name);

    if root_id is null then
      insert into public.categories(space_id, kind, name)
      values (_space, grp.kind, grp.name)
      returning id into root_id;
    end if;

    foreach child in array grp.children loop
      insert into public.categories(space_id, parent_id, name)
      select _space, root_id, child
      where not exists (
        select 1
        from public.categories c
        where c.space_id = _space
          and c.parent_id = root_id
          and c.archived_at is null
          and lower(c.name) = lower(child)
      );
    end loop;
  end loop;
end;
$$;

revoke all on function public.seed_space_categories(uuid) from public, anon, authenticated;

-- New personal spaces receive the full set.
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare sid uuid;
begin
  insert into public.profiles(id, display_name)
  values (new.id, left(coalesce(new.raw_user_meta_data->>'display_name', new.raw_user_meta_data->>'full_name', split_part(new.email,'@',1), ''), 80));
  insert into public.spaces(kind, name, created_by) values ('personal', 'Spazio personale', new.id) returning id into sid;
  insert into public.space_memberships(space_id, user_id, role) values (sid, new.id, 'owner');
  perform public.seed_space_categories(sid);
  return new;
end $$;

-- New shared spaces receive the expense part of the set.
create or replace function public.create_shared_space(_name text)
returns uuid
language plpgsql
security definer
set search_path = pg_catalog, public, pg_temp
as $$
declare sid uuid; uid uuid := auth.uid();
begin
  if uid is null then raise exception 'Accesso richiesto'; end if;
  insert into public.spaces(kind, name, created_by) values ('shared', btrim(_name), uid) returning id into sid;
  insert into public.space_memberships(space_id, user_id, role) values (sid, uid, 'owner');
  perform public.seed_space_categories(sid);
  return sid;
end $$;

-- Existing active spaces: add whatever part of the set is missing. Categories
-- created earlier are kept (movements may reference them) but become read-only.
do $$
declare sid uuid;
begin
  for sid in select id from public.spaces where archived_at is null order by created_at loop
    perform public.seed_space_categories(sid);
  end loop;
end $$;

-- Categories are read-only for clients.
drop policy if exists "categories: owner/member creano" on public.categories;
drop policy if exists "categories: owner/member modificano" on public.categories;
revoke insert, update, delete on public.categories from authenticated;
revoke execute on function public.create_starter_categories(uuid) from authenticated;

-- Invoker guard triggers on transactions, recurring items and deadlines lock
-- the referenced category with FOR SHARE. PostgreSQL requires UPDATE privilege
-- on at least one column and an UPDATE USING policy for row locks, so clients
-- keep a column-level grant on updated_at only, while every actual update is
-- rejected by the WITH CHECK clause and by the trigger below.
grant update (updated_at) on public.categories to authenticated;
create policy "categories: lock per i controlli, nessuna modifica" on public.categories
  for update to authenticated
  using (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]))
  with check (false);

create or replace function public.reject_client_category_writes()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
begin
  if current_user in ('authenticated', 'anon') then
    raise exception 'Le categorie sono predefinite e non modificabili.';
  end if;
  return coalesce(new, old);
end;
$$;

revoke all on function public.reject_client_category_writes() from public, anon, authenticated;

create trigger a_categories_read_only
before insert or update or delete on public.categories
for each row execute function public.reject_client_category_writes();
