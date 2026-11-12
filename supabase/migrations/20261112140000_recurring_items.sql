create type public.recurrence_frequency as enum ('weekly','monthly','yearly');

create table public.recurring_items (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  direction public.tx_direction not null,
  amount_cents bigint not null check (amount_cents > 0),
  description text not null check (length(btrim(description)) between 1 and 200),
  frequency public.recurrence_frequency not null,
  start_on date not null,
  next_due_on date not null,
  end_on date,
  active boolean not null default true,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (end_on is null or end_on >= start_on),
  check (next_due_on >= start_on)
);
create index recurring_items_space_due_idx on public.recurring_items(space_id, next_due_on) where active;

alter table public.recurring_items enable row level security;
grant select, insert, update on public.recurring_items to authenticated;
create policy "recurring: members read" on public.recurring_items for select to authenticated
  using (public.is_space_member(space_id, auth.uid()));
create policy "recurring: owner/member create" on public.recurring_items for insert to authenticated
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id));
create policy "recurring: owner/member update" on public.recurring_items for update to authenticated
  using (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id))
  with check (public.has_space_role(space_id, auth.uid(), array['owner','member']::public.space_role[]) and public.is_personal_space(space_id));

create or replace function public.guard_recurring_item() returns trigger
language plpgsql set search_path = public as $$
declare a public.accounts; c public.categories;
begin
  if tg_op = 'UPDATE' then
    if new.space_id <> old.space_id or new.created_by <> old.created_by then
      raise exception 'Spazio e creatore della ricorrenza non sono modificabili.';
    end if;
  else
    new.created_by := auth.uid();
  end if;
  if not public.is_personal_space(new.space_id) then raise exception 'Le ricorrenze appartengono allo spazio personale.'; end if;
  select * into a from public.accounts where id = new.account_id;
  if a.id is null or a.space_id <> new.space_id or a.archived_at is not null then
    raise exception 'Seleziona un conto attivo dello spazio personale.';
  end if;
  select * into c from public.categories where id = new.category_id;
  if c.id is null or c.space_id <> new.space_id or c.archived_at is not null then
    raise exception 'Seleziona una categoria attiva dello spazio personale.';
  end if;
  if public.category_root_kind(new.category_id) <> (case when new.direction = 'inflow' then 'income' else 'expense' end)::public.category_kind then
    raise exception 'La categoria non corrisponde alla direzione.';
  end if;
  new.updated_at := now();
  return new;
end $$;
create trigger recurring_items_guard before insert or update on public.recurring_items
for each row execute function public.guard_recurring_item();

create or replace function public.advance_recurring_due(_id uuid, _expected_due date)
returns date language plpgsql security definer set search_path = public as $$
declare r public.recurring_items; next_date date;
begin
  select * into r from public.recurring_items where id = _id for update;
  if r.id is null or not public.has_space_role(r.space_id, auth.uid(), array['owner','member']::public.space_role[]) then
    raise exception 'Ricorrenza non disponibile.';
  end if;
  if not r.active or r.next_due_on <> _expected_due then raise exception 'La ricorrenza è stata modificata o disattivata.'; end if;
  next_date := case r.frequency
    when 'weekly' then (r.next_due_on + interval '7 days')::date
    when 'monthly' then (r.next_due_on + interval '1 month')::date
    when 'yearly' then (r.next_due_on + interval '1 year')::date
  end;
  update public.recurring_items
    set next_due_on = next_date,
        active = (r.end_on is null or next_date <= r.end_on)
    where id = r.id;
  return next_date;
end $$;
revoke execute on function public.advance_recurring_due(uuid,date) from public, anon;
grant execute on function public.advance_recurring_due(uuid,date) to authenticated;

create or replace function public.confirm_recurring_item(_id uuid, _expected_due date)
returns uuid language plpgsql security definer set search_path = public as $$
declare r public.recurring_items; tx uuid; next_date date;
begin
  select * into r from public.recurring_items where id = _id for update;
  if r.id is null or not public.has_space_role(r.space_id, auth.uid(), array['owner','member']::public.space_role[]) then
    raise exception 'Ricorrenza non disponibile.';
  end if;
  if not r.active or r.next_due_on <> _expected_due then raise exception 'La ricorrenza è stata modificata o disattivata.'; end if;
  insert into public.transactions(space_id, account_id, category_id, direction, amount_cents, occurred_on, description)
  values (r.space_id, r.account_id, r.category_id, r.direction, r.amount_cents, r.next_due_on, r.description)
  returning id into tx;
  next_date := case r.frequency
    when 'weekly' then (r.next_due_on + interval '7 days')::date
    when 'monthly' then (r.next_due_on + interval '1 month')::date
    when 'yearly' then (r.next_due_on + interval '1 year')::date
  end;
  update public.recurring_items
    set next_due_on = next_date,
        active = (r.end_on is null or next_date <= r.end_on)
    where id = r.id;
  return tx;
end $$;
revoke execute on function public.confirm_recurring_item(uuid,date) from public, anon;
grant execute on function public.confirm_recurring_item(uuid,date) to authenticated;
