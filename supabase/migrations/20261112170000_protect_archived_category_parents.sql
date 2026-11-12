-- Keep child categories from remaining usable when their parent is archived.
-- Open plans that reference a child also prevent archiving its parent.
create or replace function public.guard_category_archive_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    if exists (
      select 1
      from public.recurring_items ri
      join public.categories child on child.id = ri.category_id
      where (ri.category_id = old.id or child.parent_id = old.id)
        and ri.active
    ) then
      raise exception 'Non puoi archiviare una categoria usata da una ricorrenza attiva.';
    end if;
    if exists (
      select 1
      from public.deadlines d
      join public.categories child on child.id = d.category_id
      where (d.category_id = old.id or child.parent_id = old.id)
        and d.status = 'pending'
    ) then
      raise exception 'Non puoi archiviare una categoria usata da una scadenza aperta.';
    end if;
  end if;
  return new;
end;
$$;

create or replace function public.guard_active_category_ancestry()
returns trigger
language plpgsql
set search_path = public
as $$
declare
  parent_archived boolean;
begin
  select p.archived_at is not null
    into parent_archived
  from public.categories c
  join public.categories p on p.id = c.parent_id
  where c.id = new.category_id;

  if coalesce(parent_archived, false) then
    raise exception 'La categoria padre è archiviata.';
  end if;
  return new;
end;
$$;

create trigger a_active_category_ancestry_transactions
before insert or update on public.transactions
for each row execute function public.guard_active_category_ancestry();

create trigger a_active_category_ancestry_recurring
before insert or update on public.recurring_items
for each row execute function public.guard_active_category_ancestry();

create trigger a_active_category_ancestry_deadlines
before insert or update on public.deadlines
for each row execute function public.guard_active_category_ancestry();
