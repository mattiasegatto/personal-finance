-- Category taxonomy v1 (decided 18/11/2026).
--
-- Replaces the provisional set (Entrate, Casa, Vita quotidiana) with the
-- definitive fixed set. Existing provisional categories are transformed in
-- place (renamed or moved within the same kind), so every movement, recurring
-- item, deadline and shared expense keeps its category without being touched;
-- the missing categories are then added. Categories not belonging to the
-- provisional set are left unchanged.

-- 1. Moving a category is safe as long as its root kind (income/expense) does
--    not change: references stay consistent with movement directions. The
--    previous rule rejected any move of a used category and only looked at
--    transactions; this one checks every reference and still forbids kind
--    changes of used categories and three-level trees.
create or replace function public.guard_category()
returns trigger
language plpgsql
set search_path = pg_catalog, public, pg_temp
as $$
declare
  p record;
  old_root public.category_kind;
  new_root public.category_kind;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id then raise exception 'Una categoria non può cambiare spazio.'; end if;
    if new.parent_id is distinct from old.parent_id or new.kind is distinct from old.kind then
      old_root := public.category_root_kind(old.id);
      new_root := case
        when new.parent_id is null then new.kind
        else public.category_root_kind(new.parent_id)
      end;
      if old_root is distinct from new_root and (
        exists (select 1 from public.categories where parent_id = old.id)
        or exists (select 1 from public.transactions where category_id = old.id)
        or exists (select 1 from public.recurring_items where category_id = old.id)
        or exists (select 1 from public.deadlines where category_id = old.id)
        or exists (select 1 from public.shared_expenses where category_id = old.id)
      ) then
        raise exception 'Non puoi spostare o cambiare tipo a una categoria già usata.';
      end if;
      if new.parent_id is not null and exists (select 1 from public.categories where parent_id = old.id) then
        raise exception 'Sono ammessi al massimo due livelli di categoria.';
      end if;
    end if;
  end if;
  if new.parent_id is not null then
    if new.parent_id = new.id then
      raise exception 'Una categoria non può essere padre di sé stessa.';
    end if;
    select * into p from public.categories where id = new.parent_id for share;
    if not found or p.space_id is distinct from new.space_id then raise exception 'La categoria padre appartiene a un altro spazio.'; end if;
    if p.archived_at is not null then raise exception 'La categoria padre è archiviata.'; end if;
    if p.parent_id is not null then raise exception 'Sono ammessi al massimo due livelli di categoria.'; end if;
  end if;
  new.updated_at := now();
  return new;
end
$$;

revoke all on function public.guard_category() from public, anon, authenticated;

-- 2. The definitive set. Shared spaces receive only the expense groups.
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
        (1, 'income'::public.category_kind, 'Lavoro',
          array['Stipendio', 'Tredicesima e premi', 'Lavoro autonomo', 'Rimborsi spese di lavoro']),
        (2, 'income'::public.category_kind, 'Rendite',
          array['Interessi', 'Dividendi e cedole', 'Affitti percepiti']),
        (3, 'income'::public.category_kind, 'Rimborsi e sussidi',
          array['Rimborsi fiscali', 'Rimborsi assicurativi', 'Bonus e sussidi pubblici']),
        (4, 'income'::public.category_kind, 'Altre entrate',
          array['Regali ricevuti', 'Vendita di beni usati', 'Varie']),
        (5, 'expense'::public.category_kind, 'Casa',
          array['Affitto', 'Mutuo', 'Condominio', 'Manutenzione e riparazioni',
                'Arredamento ed elettrodomestici', 'Assicurazione casa']),
        (6, 'expense'::public.category_kind, 'Utenze',
          array['Luce', 'Gas', 'Acqua', 'Internet e telefono', 'Rifiuti']),
        (7, 'expense'::public.category_kind, 'Alimentazione',
          array['Spesa alimentare', 'Ristoranti e bar', 'Asporto e consegne']),
        (8, 'expense'::public.category_kind, 'Trasporti',
          array['Carburante', 'Mezzi pubblici', 'Manutenzione veicolo', 'Assicurazione e bollo',
                'Parcheggi e pedaggi', 'Taxi e sharing']),
        (9, 'expense'::public.category_kind, 'Salute',
          array['Visite ed esami', 'Farmaci', 'Dentista', 'Ottica', 'Assicurazione sanitaria']),
        (10, 'expense'::public.category_kind, 'Cura personale e abbigliamento',
          array['Abbigliamento e calzature', 'Parrucchiere ed estetica', 'Prodotti per la persona']),
        (11, 'expense'::public.category_kind, 'Tempo libero',
          array['Sport e palestra', 'Hobby', 'Spettacoli ed eventi', 'Libri, musica e giochi',
                'Abbonamenti digitali']),
        (12, 'expense'::public.category_kind, 'Viaggi e vacanze',
          array['Trasporti di viaggio', 'Alloggi', 'Attività e visite']),
        (13, 'expense'::public.category_kind, 'Istruzione e formazione',
          array['Corsi', 'Libri e materiali', 'Rette scolastiche']),
        (14, 'expense'::public.category_kind, 'Famiglia e animali',
          array['Figli', 'Animali domestici', 'Aiuti ai familiari']),
        (15, 'expense'::public.category_kind, 'Regali e donazioni',
          array['Regali', 'Beneficenza']),
        (16, 'expense'::public.category_kind, 'Tasse e oneri finanziari',
          array['Imposte', 'Commissioni bancarie', 'Interessi passivi', 'Bolli e altre tasse']),
        (17, 'expense'::public.category_kind, 'Altre spese',
          array['Varie', 'Imprevisti'])
    ) as preset(position, kind, name, children)
    order by position
  loop
    continue when s.kind = 'shared' and grp.kind <> 'expense';

    -- Idempotent: reuse an active root category with the same name and kind.
    select c.id into root_id
    from public.categories c
    where c.space_id = _space
      and c.parent_id is null
      and c.archived_at is null
      and c.kind = grp.kind
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

-- 3. Transform the provisional set in place.
create function pg_temp.active_category(_space uuid, _parent text, _name text)
returns uuid
language sql
stable
as $$
  select c.id
  from public.categories c
  left join public.categories p on p.id = c.parent_id
  where c.space_id = _space
    and c.archived_at is null
    and lower(c.name) = lower(_name)
    and (
      (_parent is null and c.parent_id is null)
      or (_parent is not null and p.archived_at is null and lower(p.name) = lower(_parent))
    )
$$;

create function pg_temp.ensure_root(_space uuid, _kind public.category_kind, _name text)
returns uuid
language plpgsql
as $$
declare rid uuid;
begin
  rid := pg_temp.active_category(_space, null, _name);
  if rid is null then
    insert into public.categories(space_id, kind, name) values (_space, _kind, _name) returning id into rid;
  end if;
  return rid;
end
$$;

do $$
declare
  sid uuid;
  src uuid;
  dst_root uuid;
begin
  for sid in select id from public.spaces where archived_at is null order by created_at loop
    -- Entrate › Altre entrate  →  Altre entrate › Varie
    src := pg_temp.active_category(sid, 'Entrate', 'Altre entrate');
    if src is not null then
      dst_root := pg_temp.ensure_root(sid, 'income', 'Altre entrate');
      if pg_temp.active_category(sid, 'Altre entrate', 'Varie') is null then
        update public.categories set parent_id = dst_root, name = 'Varie' where id = src;
      end if;
    end if;

    -- Entrate (con Stipendio)  →  Lavoro
    src := pg_temp.active_category(sid, null, 'Entrate');
    if src is not null and pg_temp.active_category(sid, null, 'Lavoro') is null then
      update public.categories set name = 'Lavoro' where id = src;
    end if;

    -- Casa › Affitto e mutuo  →  Casa › Affitto
    src := pg_temp.active_category(sid, 'Casa', 'Affitto e mutuo');
    if src is not null and pg_temp.active_category(sid, 'Casa', 'Affitto') is null then
      update public.categories set name = 'Affitto' where id = src;
    end if;

    -- Casa › Utenze  →  Utenze (principale)
    src := pg_temp.active_category(sid, 'Casa', 'Utenze');
    if src is not null and pg_temp.active_category(sid, null, 'Utenze') is null then
      update public.categories set parent_id = null, kind = 'expense' where id = src;
    end if;

    -- Vita quotidiana › Spesa alimentare  →  Alimentazione › Spesa alimentare
    src := pg_temp.active_category(sid, 'Vita quotidiana', 'Spesa alimentare');
    if src is not null then
      dst_root := pg_temp.ensure_root(sid, 'expense', 'Alimentazione');
      if pg_temp.active_category(sid, 'Alimentazione', 'Spesa alimentare') is null then
        update public.categories set parent_id = dst_root where id = src;
      end if;
    end if;

    -- Vita quotidiana › Trasporti  →  Trasporti (principale)
    src := pg_temp.active_category(sid, 'Vita quotidiana', 'Trasporti');
    if src is not null and pg_temp.active_category(sid, null, 'Trasporti') is null then
      update public.categories set parent_id = null, kind = 'expense' where id = src;
    end if;

    -- Vita quotidiana › Svago  →  Tempo libero (principale)
    src := pg_temp.active_category(sid, 'Vita quotidiana', 'Svago');
    if src is not null and pg_temp.active_category(sid, null, 'Tempo libero') is null then
      update public.categories set parent_id = null, kind = 'expense', name = 'Tempo libero' where id = src;
    end if;

    -- Vita quotidiana  →  Altre spese
    src := pg_temp.active_category(sid, null, 'Vita quotidiana');
    if src is not null and pg_temp.active_category(sid, null, 'Altre spese') is null then
      update public.categories set name = 'Altre spese' where id = src;
    end if;

    -- 4. Add whatever is missing from the definitive set.
    perform public.seed_space_categories(sid);
  end loop;
end
$$;
