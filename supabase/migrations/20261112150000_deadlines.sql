create type public.deadline_status as enum ('pending','completed','cancelled');

create table public.deadlines (
  id uuid primary key default gen_random_uuid(),
  space_id uuid not null references public.spaces(id) on delete restrict,
  account_id uuid not null references public.accounts(id) on delete restrict,
  category_id uuid not null references public.categories(id) on delete restrict,
  direction public.tx_direction not null,
  amount_cents bigint not null check (amount_cents > 0),
  title text not null check (length(btrim(title)) between 1 and 160),
  due_on date not null,
  notes text check (notes is null or length(notes) <= 500),
  status public.deadline_status not null default 'pending',
  transaction_id uuid references public.transactions(id) on delete restrict,
  created_by uuid not null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed') = (transaction_id is not null)),
  check ((status = 'completed') = (completed_at is not null))
);
create index deadlines_space_due_idx on public.deadlines(space_id,due_on) where status='pending';

alter table public.deadlines enable row level security;
grant select, insert, update on public.deadlines to authenticated;
create policy "deadlines: members read" on public.deadlines for select to authenticated
  using (public.is_space_member(space_id,auth.uid()));
create policy "deadlines: owner/member create" on public.deadlines for insert to authenticated
  with check (public.has_space_role(space_id,auth.uid(),array['owner','member']::public.space_role[]) and public.is_personal_space(space_id));
create policy "deadlines: owner/member update" on public.deadlines for update to authenticated
  using (public.has_space_role(space_id,auth.uid(),array['owner','member']::public.space_role[]) and public.is_personal_space(space_id))
  with check (public.has_space_role(space_id,auth.uid(),array['owner','member']::public.space_role[]));

create or replace function public.guard_deadline() returns trigger
language plpgsql set search_path=public as $$
declare a public.accounts; c public.categories;
begin
  if tg_op='UPDATE' then
    if new.space_id<>old.space_id or new.created_by<>old.created_by then raise exception 'Spazio e creatore non sono modificabili.'; end if;
    if old.status<>'pending' then raise exception 'Una scadenza chiusa non può essere modificata.'; end if;
    if new.status<>old.status or new.transaction_id is distinct from old.transaction_id or new.completed_at is distinct from old.completed_at then
      if current_setting('app.deadline_rpc',true) is distinct from 'on' then raise exception 'Lo stato si modifica solo tramite la funzione dedicata.'; end if;
    end if;
  else
    new.created_by:=auth.uid();
  end if;
  if not public.is_personal_space(new.space_id) then raise exception 'Le scadenze appartengono allo spazio personale.'; end if;
  select * into a from public.accounts where id=new.account_id;
  if a.id is null or a.space_id<>new.space_id or a.archived_at is not null then raise exception 'Conto non valido o archiviato.'; end if;
  select * into c from public.categories where id=new.category_id;
  if c.id is null or c.space_id<>new.space_id or c.archived_at is not null then raise exception 'Categoria non valida o archiviata.'; end if;
  if public.category_root_kind(new.category_id)<>(case when new.direction='inflow' then 'income' else 'expense' end)::public.category_kind then
    raise exception 'La categoria non corrisponde alla direzione.';
  end if;
  new.updated_at:=now();
  return new;
end $$;
create trigger deadlines_guard before insert or update on public.deadlines for each row execute function public.guard_deadline();

create or replace function public.complete_deadline(_id uuid)
returns uuid language plpgsql security definer set search_path=public as $$
declare d public.deadlines; tx uuid;
begin
  select * into d from public.deadlines where id=_id for update;
  if d.id is null or not public.has_space_role(d.space_id,auth.uid(),array['owner','member']::public.space_role[]) then raise exception 'Scadenza non disponibile.'; end if;
  if d.status<>'pending' then raise exception 'La scadenza non è più da completare.'; end if;
  insert into public.transactions(space_id,account_id,category_id,direction,amount_cents,occurred_on,description)
  values(d.space_id,d.account_id,d.category_id,d.direction,d.amount_cents,d.due_on,d.title)
  returning id into tx;
  perform set_config('app.deadline_rpc','on',true);
  update public.deadlines set status='completed',transaction_id=tx,completed_at=now() where id=d.id;
  perform set_config('app.deadline_rpc','off',true);
  return tx;
end $$;
revoke execute on function public.complete_deadline(uuid) from public,anon;
grant execute on function public.complete_deadline(uuid) to authenticated;

create or replace function public.cancel_deadline(_id uuid)
returns void language plpgsql security definer set search_path=public as $$
declare d public.deadlines;
begin
  select * into d from public.deadlines where id=_id for update;
  if d.id is null or not public.has_space_role(d.space_id,auth.uid(),array['owner','member']::public.space_role[]) then raise exception 'Scadenza non disponibile.'; end if;
  if d.status<>'pending' then raise exception 'La scadenza non è più aperta.'; end if;
  perform set_config('app.deadline_rpc','on',true);
  update public.deadlines set status='cancelled' where id=d.id;
  perform set_config('app.deadline_rpc','off',true);
end $$;
revoke execute on function public.cancel_deadline(uuid) from public,anon;
grant execute on function public.cancel_deadline(uuid) to authenticated;
