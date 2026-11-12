-- Prevent archiving accounts/categories still required by open financial plans.
-- Recurrences remain actionable while active; deadlines remain actionable while pending.
create or replace function public.guard_account_archive_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    if exists (
      select 1 from public.recurring_items
      where account_id = old.id and active
    ) then
      raise exception 'Non puoi archiviare un conto usato da una ricorrenza attiva.';
    end if;
    if exists (
      select 1 from public.deadlines
      where account_id = old.id and status = 'pending'
    ) then
      raise exception 'Non puoi archiviare un conto usato da una scadenza aperta.';
    end if;
  end if;
  return new;
end;
$$;

create trigger accounts_archive_references_guard
before update of archived_at on public.accounts
for each row execute function public.guard_account_archive_references();

create or replace function public.guard_category_archive_references()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if old.archived_at is null and new.archived_at is not null then
    if exists (
      select 1 from public.recurring_items
      where category_id = old.id and active
    ) then
      raise exception 'Non puoi archiviare una categoria usata da una ricorrenza attiva.';
    end if;
    if exists (
      select 1 from public.deadlines
      where category_id = old.id and status = 'pending'
    ) then
      raise exception 'Non puoi archiviare una categoria usata da una scadenza aperta.';
    end if;
  end if;
  return new;
end;
$$;

create trigger categories_archive_references_guard
before update of archived_at on public.categories
for each row execute function public.guard_category_archive_references();
